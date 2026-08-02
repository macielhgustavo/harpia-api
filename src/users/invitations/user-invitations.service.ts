import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { getAuthConfigInteger } from '../../auth/auth-config';
import { emailFingerprint, normalizeEmail } from '../../auth/email.utils';
import { assertStrongPassword } from '../../auth/password-policy';
import { PrismaService } from '../../prisma/prisma.service';
import { acquireTransactionAdvisoryLock } from '../../prisma/advisory-lock';
import { AcceptUserInvitationDto } from './dto/accept-user-invitation.dto';
import { CreateUserInvitationDto } from './dto/create-user-invitation.dto';
import {
  USER_INVITATION_NOTIFIER,
  UserInvitationNotifier,
} from './user-invitation-notifier';
import {
  createUserInvitationToken,
  hashUserInvitationToken,
} from './user-invitation-token.utils';

const BCRYPT_ROUNDS = 10;
const DEFAULT_INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;
const INVALID_INVITATION_MESSAGE = 'Convite inválido ou expirado.';
const CREATE_INVITATION_CONFLICT_MESSAGE = 'Não foi possível criar o convite.';

const SAFE_INVITATION_SELECT = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
  invitedBy: {
    select: {
      id: true,
      name: true,
    },
  },
} as const satisfies Prisma.UserInvitationSelect;

const ACCEPTED_USER_SELECT = {
  id: true,
  email: true,
  organizationId: true,
  tokenVersion: true,
  role: true,
} as const satisfies Prisma.UserSelect;

export interface UserInvitationActor {
  id: string;
  organizationId: string;
  role: UserRole;
}

@Injectable()
export class UserInvitationsService {
  private readonly logger = new Logger(UserInvitationsService.name);
  private readonly invitationTtlSeconds: number;
  private readonly invitationFrontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(USER_INVITATION_NOTIFIER)
    private readonly invitationNotifier: UserInvitationNotifier,
  ) {
    this.invitationTtlSeconds = getAuthConfigInteger(
      configService,
      'USER_INVITATION_TTL_SECONDS',
      DEFAULT_INVITATION_TTL_SECONDS,
      60,
      31 * 24 * 60 * 60,
    );
    this.invitationFrontendUrl =
      configService.get<string>('USER_INVITATION_FRONTEND_URL') ??
      'http://localhost:4200/accept-invitation';

    try {
      new URL(this.invitationFrontendUrl);
    } catch {
      throw new Error('USER_INVITATION_FRONTEND_URL deve ser uma URL válida.');
    }
  }

  async create(actor: UserInvitationActor, dto: CreateUserInvitationDto) {
    const email = normalizeEmail(dto.email);
    this.assertActorCanManageRole(actor, dto.role);

    const token = createUserInvitationToken();
    const tokenHash = hashUserInvitationToken(token);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.invitationTtlSeconds * 1000,
    );

    let invitation: Prisma.UserInvitationGetPayload<{
      select: typeof SAFE_INVITATION_SELECT;
    }>;

    try {
      invitation = await this.prisma.$transaction(async (tx) => {
        await this.lockEmail(tx, email);

        const existingUser = await tx.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { id: true },
        });

        if (existingUser) {
          throw new ConflictException(CREATE_INVITATION_CONFLICT_MESSAGE);
        }

        await tx.userInvitation.updateMany({
          where: {
            organizationId: actor.organizationId,
            email: { equals: email, mode: 'insensitive' },
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { lte: now },
          },
          data: { revokedAt: now },
        });

        const pendingInvitation = await tx.userInvitation.findFirst({
          where: {
            email: { equals: email, mode: 'insensitive' },
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          select: { id: true },
        });

        if (pendingInvitation) {
          throw new ConflictException(CREATE_INVITATION_CONFLICT_MESSAGE);
        }

        return tx.userInvitation.create({
          data: {
            organizationId: actor.organizationId,
            email,
            role: dto.role,
            tokenHash,
            invitedById: actor.id,
            expiresAt,
          },
          select: SAFE_INVITATION_SELECT,
        });
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException(CREATE_INVITATION_CONFLICT_MESSAGE);
      }

      throw error;
    }

    try {
      await this.invitationNotifier.sendUserInvitation({
        invitationId: invitation.id,
        organizationId: actor.organizationId,
        invitedById: actor.id,
        email,
        role: invitation.role,
        acceptUrl: this.createInvitationUrl(token),
        expiresAt: invitation.expiresAt,
      });
    } catch {
      this.logger.warn(
        JSON.stringify({
          event: 'user_invitation_notification_failed',
          invitationId: invitation.id,
          organizationId: actor.organizationId,
          emailFingerprint: emailFingerprint(email),
        }),
      );
    }

    return invitation;
  }

  findAll(organizationId: string) {
    return this.prisma.userInvitation.findMany({
      where: { organizationId },
      select: SAFE_INVITATION_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(id: string, actor: UserInvitationActor) {
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.userInvitation.findFirst({
        where: { id, organizationId: actor.organizationId },
        select: { id: true, role: true },
      });

      if (!invitation) {
        throw new NotFoundException('Convite não encontrado.');
      }

      this.assertActorCanManageRole(actor, invitation.role);

      const now = new Date();
      const revoked = await tx.userInvitation.updateMany({
        where: {
          id,
          organizationId: actor.organizationId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });

      if (revoked.count !== 1) {
        throw new ConflictException('O convite não está mais pendente.');
      }

      const result = await tx.userInvitation.findFirst({
        where: { id, organizationId: actor.organizationId },
        select: SAFE_INVITATION_SELECT,
      });

      if (!result) {
        throw new NotFoundException('Convite não encontrado.');
      }

      return result;
    });
  }

  async accept(dto: AcceptUserInvitationDto) {
    const tokenHash = hashUserInvitationToken(dto.token);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const invitation = await tx.userInvitation.findUnique({
          where: { tokenHash },
          select: {
            id: true,
            organizationId: true,
            email: true,
            role: true,
            createdAt: true,
          },
        });

        if (!invitation) {
          throw new BadRequestException(INVALID_INVITATION_MESSAGE);
        }

        await this.lockEmail(tx, invitation.email);

        const now = new Date();
        const claimed = await tx.userInvitation.updateMany({
          where: {
            id: invitation.id,
            tokenHash,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { acceptedAt: now },
        });

        if (claimed.count !== 1) {
          throw new BadRequestException(INVALID_INVITATION_MESSAGE);
        }

        const name = dto.name.trim();
        if (!name) {
          throw new BadRequestException('Nome é obrigatório.');
        }

        assertStrongPassword(dto.password, invitation.email);

        const existingUser = await tx.user.findFirst({
          where: {
            email: { equals: invitation.email, mode: 'insensitive' },
          },
          select: { id: true },
        });

        if (existingUser) {
          throw new BadRequestException(INVALID_INVITATION_MESSAGE);
        }

        const password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

        return tx.user.create({
          data: {
            organizationId: invitation.organizationId,
            email: invitation.email,
            role: invitation.role,
            name,
            password,
            isActive: true,
            invitedAt: invitation.createdAt,
            acceptedAt: now,
          },
          select: ACCEPTED_USER_SELECT,
        });
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new BadRequestException(INVALID_INVITATION_MESSAGE);
      }

      throw error;
    }
  }

  private assertActorCanManageRole(actor: UserInvitationActor, role: UserRole) {
    if (actor.role === UserRole.ADMIN && role === UserRole.OWNER) {
      throw new ForbiddenException(
        'ADMIN não pode gerenciar convite de OWNER.',
      );
    }
  }

  private lockEmail(tx: Prisma.TransactionClient, email: string) {
    return acquireTransactionAdvisoryLock(tx, email);
  }

  private createInvitationUrl(token: string): string {
    const url = new URL(this.invitationFrontendUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
