/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { hashPasswordResetToken } from './password-reset-token.utils';
import type { PasswordResetNotification } from './password-reset-notifier';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';

describe('AuthService', () => {
  let prisma: any;
  let transaction: any;
  let jwtService: { sign: jest.Mock };
  let notifier: { sendPasswordReset: jest.Mock };
  let invitationsService: { accept: jest.Mock };
  let auditService: { record: jest.Mock };
  let service: AuthService;

  const makeUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'user@example.com',
    password: 'password-hash',
    organizationId: 'organization-1',
    tokenVersion: 0,
    role: UserRole.OWNER,
    isActive: true,
    ...overrides,
  });

  beforeEach(() => {
    transaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      organization: {
        create: jest.fn().mockResolvedValue({ id: 'organization-1' }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(makeUser()),
        update: jest.fn().mockResolvedValue(makeUser()),
      },
      passwordResetToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'reset-token-1' }),
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userInvitation: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(makeUser()),
      },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    };
    jwtService = { sign: jest.fn().mockReturnValue('signed-token') };
    notifier = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };
    invitationsService = { accept: jest.fn() };
    auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'PASSWORD_RESET_FRONTEND_URL') {
          return 'https://app.example.com/reset-password';
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new AuthService(
      prisma,
      jwtService as unknown as JwtService,
      configService,
      notifier,
      invitationsService as any,
      auditService as any,
    );
  });

  it('keeps the legacy seed password able to log in and normalizes the e-mail', async () => {
    const seedUser = makeUser({
      email: 'admin@harpia.com',
      password: await bcrypt.hash('harpia123', 10),
    });
    prisma.user.findFirst.mockResolvedValue(seedUser);
    transaction.user.update.mockResolvedValue(seedUser);

    await expect(
      service.login({ email: ' Admin@Harpia.com ', password: 'harpia123' }),
    ).resolves.toEqual({ access_token: 'signed-token' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'admin@harpia.com', mode: 'insensitive' },
      },
    });
    expect(jwtService.sign).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'admin@harpia.com',
      organizationId: 'organization-1',
      tokenVersion: 0,
      role: UserRole.OWNER,
    });
    expect(transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { lastLoginAt: expect.any(Date) },
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      {
        organizationId: 'organization-1',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.AUTH_LOGIN,
        entityType: AUDIT_ENTITY_TYPES.AUTH_SESSION,
        entityId: 'user-1',
      },
      transaction,
    );
  });

  it('returns the same generic error for an unknown account and a wrong password', async () => {
    await expect(
      service.login({ email: 'missing@example.com', password: 'anything' }),
    ).rejects.toMatchObject<Partial<UnauthorizedException>>({
      message: 'Credenciais inválidas',
    });

    prisma.user.findFirst.mockResolvedValue(
      makeUser({ password: await bcrypt.hash('SenhaCorreta1!', 10) }),
    );
    await expect(
      service.login({ email: 'user@example.com', password: 'SenhaErrada1!' }),
    ).rejects.toMatchObject<Partial<UnauthorizedException>>({
      message: 'Credenciais inválidas',
    });
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('rejects inactive accounts with the generic login error', async () => {
    prisma.user.findFirst.mockResolvedValue(
      makeUser({
        password: await bcrypt.hash('SenhaCorreta1!', 10),
        isActive: false,
      }),
    );

    await expect(
      service.login({
        email: 'user@example.com',
        password: 'SenhaCorreta1!',
      }),
    ).rejects.toMatchObject<Partial<UnauthorizedException>>({
      message: 'Credenciais inválidas',
    });
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('enforces the policy, serializes normalized registration and signs tokenVersion', async () => {
    const result = await service.register({
      name: 'Novo Usuário',
      organizationName: 'Nova Organização',
      email: ' NEW@Example.com ',
      password: 'SenhaForte1!',
    });

    expect(result).toEqual({ access_token: 'signed-token' });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'new@example.com' }),
      }),
    );
    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenVersion: 0,
        role: UserRole.OWNER,
      }),
    );
  });

  it('does not let an invited e-mail create a separate OWNER tenant', async () => {
    transaction.userInvitation.findFirst.mockResolvedValue({
      id: 'invitation-1',
    });

    await expect(
      service.register({
        name: 'Usuário Convidado',
        organizationName: 'Tenant Incorreto',
        email: 'invited@example.com',
        password: 'SenhaForte1!',
      }),
    ).rejects.toMatchObject({ message: 'E-mail já cadastrado' });

    expect(transaction.organization.create).not.toHaveBeenCalled();
    expect(transaction.user.create).not.toHaveBeenCalled();
  });

  it('signs a normal JWT after atomically accepting an invitation', async () => {
    const invitedUser = makeUser({
      email: 'invited@example.com',
      role: UserRole.LEITURA,
    });
    invitationsService.accept.mockResolvedValue(invitedUser);

    await expect(
      service.acceptInvitation({
        token: 'raw-invitation-token',
        name: 'Usuário Convidado',
        password: 'SenhaForte1!',
      }),
    ).resolves.toEqual({ access_token: 'signed-token' });

    expect(invitationsService.accept).toHaveBeenCalledWith({
      token: 'raw-invitation-token',
      name: 'Usuário Convidado',
      password: 'SenhaForte1!',
    });
    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'invited@example.com',
        role: UserRole.LEITURA,
      }),
    );
  });

  it('always returns the generic forgot-password response and persists only a token hash', async () => {
    const user = makeUser();
    prisma.user.findFirst.mockResolvedValue(user);

    const response = await service.forgotPassword({ email: user.email });

    expect(response).toEqual({
      message:
        'Se o e-mail estiver cadastrado, você receberá instruções para redefinir a senha.',
    });
    const notification = notifier.sendPasswordReset.mock
      .calls[0][0] as PasswordResetNotification;
    const rawToken = new URL(notification.resetUrl).searchParams.get('token');
    const persisted =
      transaction.passwordResetToken.create.mock.calls[0][0].data;

    expect(rawToken).toBeTruthy();
    expect(persisted.tokenHash).toBe(hashPasswordResetToken(rawToken!));
    expect(persisted.tokenHash).not.toBe(rawToken);
    expect(persisted.expiresAt).toBeInstanceOf(Date);
    expect(persisted.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 29 * 60_000,
    );
    expect(transaction.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: user.id },
    });

    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.forgotPassword({ email: 'missing@example.com' }),
    ).resolves.toEqual(response);
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('atomically applies a reset, revokes previous JWTs and invalidates sibling tokens', async () => {
    const currentPassword = 'SenhaAtual1!';
    const user = makeUser({ password: await bcrypt.hash(currentPassword, 10) });
    transaction.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-token-1',
      userId: user.id,
    });
    transaction.passwordResetToken.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 });
    transaction.user.findUnique.mockResolvedValue(user);

    await expect(
      service.resetPassword({
        token: 'raw-reset-token',
        newPassword: 'SenhaNova1!',
      }),
    ).resolves.toEqual({ message: 'Senha redefinida com sucesso.' });

    expect(transaction.passwordResetToken.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: hashPasswordResetToken('raw-reset-token'),
          usedAt: null,
        }),
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      {
        organizationId: 'organization-1',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
        entityType: AUDIT_ENTITY_TYPES.USER,
        entityId: 'user-1',
      },
      transaction,
    );
    expect(transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenVersion: { increment: 1 } }),
      }),
    );
    expect(transaction.passwordResetToken.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 'reset-token-1' } }),
      }),
    );
  });

  it('rejects invalid reset tokens and prevents changing to the current password', async () => {
    await expect(
      service.resetPassword({ token: 'missing', newPassword: 'SenhaNova1!' }),
    ).rejects.toMatchObject<Partial<BadRequestException>>({
      message: 'Token de redefinição inválido ou expirado.',
    });

    const password = await bcrypt.hash('SenhaAtual1!', 10);
    transaction.user.findUnique.mockResolvedValue(makeUser({ password }));
    await expect(
      service.changePassword('user-1', {
        currentPassword: 'SenhaAtual1!',
        newPassword: 'SenhaAtual1!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses one uniform response for expired or already-used reset tokens', async () => {
    transaction.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-token-1',
      userId: 'user-1',
    });
    transaction.passwordResetToken.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      service.resetPassword({
        token: 'expired-or-used',
        newPassword: 'SenhaNova1!',
      }),
    ).rejects.toMatchObject<Partial<BadRequestException>>({
      message: 'Token de redefinição inválido ou expirado.',
    });
  });

  it('does not change a password when the authenticated current password is wrong', async () => {
    transaction.user.findUnique.mockResolvedValue(
      makeUser({ password: await bcrypt.hash('SenhaAtual1!', 10) }),
    );

    await expect(
      service.changePassword('user-1', {
        currentPassword: 'SenhaErrada1!',
        newPassword: 'SenhaNova1!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('rechecks the current hash after locking out a concurrent password change', async () => {
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ password: await bcrypt.hash('SenhaAtual1!', 10) }),
    );
    transaction.user.findUnique.mockResolvedValue(
      makeUser({ password: await bcrypt.hash('SenhaConcorrente1!', 10) }),
    );

    await expect(
      service.changePassword('user-1', {
        currentPassword: 'SenhaAtual1!',
        newPassword: 'SenhaNova1!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.user.findUnique.mock.invocationCallOrder[0],
    );
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('changes the password only after validating the current password and invalidates reset tokens', async () => {
    const user = makeUser({ password: await bcrypt.hash('SenhaAtual1!', 10) });
    transaction.user.findUnique.mockResolvedValue(user);

    await expect(
      service.changePassword('user-1', {
        currentPassword: 'SenhaAtual1!',
        newPassword: 'SenhaNova1!',
      }),
    ).resolves.toEqual({
      message: 'Senha alterada com sucesso. Faça login novamente.',
    });

    expect(transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenVersion: { increment: 1 } }),
      }),
    );
    expect(transaction.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', usedAt: null } }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      {
        organizationId: 'organization-1',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED,
        entityType: AUDIT_ENTITY_TYPES.USER,
        entityId: 'user-1',
      },
      transaction,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.user.findUnique.mock.invocationCallOrder[0],
    );
    expect(
      transaction.user.findUnique.mock.invocationCallOrder[0],
    ).toBeLessThan(transaction.user.update.mock.invocationCallOrder[0]);
  });

  it('keeps password mutation and audit in one transaction boundary', async () => {
    const user = makeUser({ password: await bcrypt.hash('SenhaAtual1!', 10) });
    transaction.user.findUnique.mockResolvedValue(user);
    auditService.record.mockRejectedValue(new Error('audit unavailable'));

    await expect(
      service.changePassword('user-1', {
        currentPassword: 'SenhaAtual1!',
        newPassword: 'SenhaNova1!',
      }),
    ).rejects.toThrow('audit unavailable');

    expect(auditService.record.mock.calls[0][1]).toBe(transaction);
  });
});
