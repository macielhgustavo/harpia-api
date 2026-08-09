import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { getAuthConfigInteger } from './auth-config';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { emailFingerprint, normalizeEmail } from './email.utils';
import { assertStrongPassword } from './password-policy';
import {
  createPasswordResetToken,
  hashPasswordResetToken,
} from './password-reset-token.utils';
import { PASSWORD_RESET_NOTIFIER } from './password-reset-notifier';
import type { PasswordResetNotifier } from './password-reset-notifier';
import { AcceptUserInvitationDto } from '../users/invitations/dto/accept-user-invitation.dto';
import { UserInvitationsService } from '../users/invitations/user-invitations.service';
import { acquireTransactionAdvisoryLock } from '../prisma/advisory-lock';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';

const BCRYPT_ROUNDS = 10;
const DUMMY_PASSWORD_HASH =
  '$2b$10$ASD5BFOzVjiLgDa2UVvp2edSYMmRKsgmV1s6Poek0oxiD5Hvw3ZbS';
const INVALID_CREDENTIALS_MESSAGE = 'Credenciais inválidas';
const FORGOT_PASSWORD_MESSAGE =
  'Se o e-mail estiver cadastrado, você receberá instruções para redefinir a senha.';
const INVALID_RESET_TOKEN_MESSAGE =
  'Token de redefinição inválido ou expirado.';

interface TokenUser {
  id: string;
  email: string;
  organizationId: string;
  tokenVersion: number;
  role: UserRole;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly passwordResetTtlSeconds: number;
  private readonly passwordResetFrontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(PASSWORD_RESET_NOTIFIER)
    private readonly passwordResetNotifier: PasswordResetNotifier,
    private readonly userInvitationsService: UserInvitationsService,
    private readonly auditService: AuditService,
  ) {
    this.passwordResetTtlSeconds = getAuthConfigInteger(
      configService,
      'PASSWORD_RESET_TOKEN_TTL_SECONDS',
      1800,
      60,
      86400,
    );
    this.passwordResetFrontendUrl =
      configService.get<string>('PASSWORD_RESET_FRONTEND_URL') ??
      'http://localhost:3000/reset-password';

    try {
      new URL(this.passwordResetFrontendUrl);
    } catch {
      throw new Error('PASSWORD_RESET_FRONTEND_URL deve ser uma URL válida.');
    }
  }

  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);
    assertStrongPassword(dto.password, email);

    const existing = await this.findUserByEmail(email);
    if (existing) {
      throw new ConflictException('E-mail já cadastrado');
    }

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        // Serialize normalized e-mail creation across API instances without
        // applying an unsafe data-normalization migration to legacy accounts.
        await acquireTransactionAdvisoryLock(tx, email);

        const concurrentUser = await tx.user.findFirst({
          where: {
            email: {
              equals: email,
              mode: 'insensitive',
            },
          },
          select: { id: true },
        });

        if (concurrentUser) {
          throw new ConflictException('E-mail já cadastrado');
        }

        const pendingInvitation = await tx.userInvitation.findFirst({
          where: {
            email: { equals: email, mode: 'insensitive' },
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });

        if (pendingInvitation) {
          throw new ConflictException('E-mail já cadastrado');
        }

        const organization = await tx.organization.create({
          data: { name: dto.organizationName },
        });

        return tx.user.create({
          data: {
            name: dto.name,
            email,
            password: hashedPassword,
            organizationId: organization.id,
            role: UserRole.OWNER,
            acceptedAt: new Date(),
          },
        });
      });

      this.logSecurityEvent('auth_registered', {
        userId: user.id,
        emailFingerprint: emailFingerprint(email),
      });

      return this.signToken(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('E-mail já cadastrado');
      }

      throw error;
    }
  }

  async login(dto: LoginDto) {
    const email = normalizeEmail(dto.email);
    const user = await this.findUserByEmail(email);
    const validPassword = await bcrypt.compare(
      dto.password,
      user?.password ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !validPassword || !user.isActive) {
      this.warnSecurityEvent('auth_login_failed', {
        emailFingerprint: emailFingerprint(email),
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const authenticatedUser = await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
        select: {
          id: true,
          email: true,
          organizationId: true,
          tokenVersion: true,
          role: true,
        },
      });

      await this.auditService.record(
        {
          organizationId: updatedUser.organizationId,
          actorUserId: updatedUser.id,
          action: AUDIT_ACTIONS.AUTH_LOGIN,
          entityType: AUDIT_ENTITY_TYPES.AUTH_SESSION,
          entityId: updatedUser.id,
        },
        tx,
      );

      return updatedUser;
    });

    this.logSecurityEvent('auth_login_succeeded', {
      userId: user.id,
      emailFingerprint: emailFingerprint(email),
    });

    return this.signToken(authenticatedUser);
  }

  async acceptInvitation(dto: AcceptUserInvitationDto) {
    const user = await this.userInvitationsService.accept(dto);
    return this.signToken(user);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = normalizeEmail(dto.email);
    const user = await this.findUserByEmail(email);

    if (!user || !user.isActive) {
      this.logSecurityEvent('auth_password_reset_requested', {
        outcome: 'ignored',
        emailFingerprint: emailFingerprint(email),
      });
      return { message: FORGOT_PASSWORD_MESSAGE };
    }

    const token = createPasswordResetToken();
    const expiresAt = new Date(
      Date.now() + this.passwordResetTtlSeconds * 1000,
    );

    await this.prisma.$transaction(async (tx) => {
      // Serializes requests for the same account so that only the newest token remains usable.
      await tx.$queryRaw`
        SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE
      `;
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashPasswordResetToken(token),
          expiresAt,
        },
      });
    });

    try {
      await this.passwordResetNotifier.sendPasswordReset({
        userId: user.id,
        email: user.email,
        resetUrl: this.createPasswordResetUrl(token),
      });
    } catch {
      this.warnSecurityEvent('auth_password_reset_notification_failed', {
        userId: user.id,
        emailFingerprint: emailFingerprint(email),
      });
    }

    this.logSecurityEvent('auth_password_reset_requested', {
      outcome: 'accepted',
      userId: user.id,
      emailFingerprint: emailFingerprint(email),
    });

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = hashPasswordResetToken(dto.token);
    let resetUser: { id: string; email: string } | undefined;

    await this.prisma.$transaction(async (tx) => {
      const resetToken = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true },
      });
      const now = new Date();

      if (!resetToken) {
        throw new BadRequestException(INVALID_RESET_TOKEN_MESSAGE);
      }

      const claimedToken = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          tokenHash,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (claimedToken.count !== 1) {
        throw new BadRequestException(INVALID_RESET_TOKEN_MESSAGE);
      }

      const user = await tx.user.findUnique({
        where: { id: resetToken.userId },
        select: {
          id: true,
          email: true,
          password: true,
          isActive: true,
          organizationId: true,
        },
      });

      if (!user || !user.isActive) {
        throw new BadRequestException(INVALID_RESET_TOKEN_MESSAGE);
      }

      assertStrongPassword(dto.newPassword, user.email);

      if (await bcrypt.compare(dto.newPassword, user.password)) {
        throw new BadRequestException(
          'A nova senha não pode ser igual à senha atual.',
        );
      }

      const password = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

      await tx.user.update({
        where: { id: user.id },
        data: {
          password,
          tokenVersion: { increment: 1 },
        },
      });
      await tx.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          id: { not: resetToken.id },
          usedAt: null,
        },
        data: { usedAt: now },
      });
      await this.auditService.record(
        {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
          entityType: AUDIT_ENTITY_TYPES.USER,
          entityId: user.id,
        },
        tx,
      );
      resetUser = user;
    });

    if (resetUser) {
      this.logSecurityEvent('auth_password_reset_applied', {
        userId: resetUser.id,
        emailFingerprint: emailFingerprint(resetUser.email),
      });
    }

    return { message: 'Senha redefinida com sucesso.' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const changedUser = await this.prisma.$transaction(async (tx) => {
      // Wait for any concurrent password change, then validate against the
      // latest committed hash while keeping the row locked until audit commit.
      await tx.$queryRaw`
        SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
      `;

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          password: true,
          organizationId: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('Sessão inválida');
      }

      if (!(await bcrypt.compare(dto.currentPassword, user.password))) {
        this.warnSecurityEvent('auth_change_password_failed', { userId });
        throw new UnauthorizedException('Senha atual inválida');
      }

      assertStrongPassword(dto.newPassword, user.email);

      if (await bcrypt.compare(dto.newPassword, user.password)) {
        throw new BadRequestException(
          'A nova senha não pode ser igual à senha atual.',
        );
      }

      const password = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
      const now = new Date();

      await tx.user.update({
        where: { id: user.id },
        data: {
          password,
          tokenVersion: { increment: 1 },
        },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      await this.auditService.record(
        {
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED,
          entityType: AUDIT_ENTITY_TYPES.USER,
          entityId: user.id,
        },
        tx,
      );

      return { id: user.id, email: user.email };
    });

    this.logSecurityEvent('auth_password_changed', {
      userId: changedUser.id,
      emailFingerprint: emailFingerprint(changedUser.email),
    });

    return { message: 'Senha alterada com sucesso. Faça login novamente.' };
  }

  private async findUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });
  }

  private signToken(user: TokenUser) {
    return {
      access_token: this.jwtService.sign({
        sub: user.id,
        email: user.email,
        organizationId: user.organizationId,
        tokenVersion: user.tokenVersion,
        role: user.role,
      }),
    };
  }

  private createPasswordResetUrl(token: string): string {
    const url = new URL(this.passwordResetFrontendUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private logSecurityEvent(event: string, details: Record<string, unknown>) {
    this.logger.log(JSON.stringify({ event, ...details }));
  }

  private warnSecurityEvent(event: string, details: Record<string, unknown>) {
    this.logger.warn(JSON.stringify({ event, ...details }));
  }
}
