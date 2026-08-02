/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UserInvitationsService } from './user-invitations.service';

describe('UserInvitationsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let transaction: ReturnType<typeof createTransactionMock>;
  let notifier: { sendUserInvitation: jest.Mock };
  let service: UserInvitationsService;

  const owner = {
    id: 'owner-1',
    organizationId: 'org-a',
    role: UserRole.OWNER,
  };
  const admin = {
    id: 'admin-1',
    organizationId: 'org-a',
    role: UserRole.ADMIN,
  };

  beforeEach(() => {
    transaction = createTransactionMock();
    prisma = createPrismaMock(transaction);
    notifier = { sendUserInvitation: jest.fn().mockResolvedValue(undefined) };
    service = createService(prisma, notifier);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a tenant invitation under the global normalized email lock', async () => {
    transaction.user.findFirst.mockResolvedValue(null);
    transaction.userInvitation.updateMany.mockResolvedValue({ count: 1 });
    transaction.userInvitation.findFirst.mockResolvedValue(null);
    transaction.userInvitation.create.mockResolvedValue(safeInvitation());

    const result = await service.create(owner, {
      email: '  CONVIDADO@EXAMPLE.COM ',
      role: UserRole.FINANCEIRO,
    });

    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw.mock.calls[0][1]).toBe(
      'convidado@example.com',
    );
    expect(transaction.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'convidado@example.com', mode: 'insensitive' },
      },
      select: { id: true },
    });
    expect(transaction.userInvitation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        email: {
          equals: 'convidado@example.com',
          mode: 'insensitive',
        },
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { lte: expect.any(Date) },
      }),
      data: { revokedAt: expect.any(Date) },
    });
    expect(transaction.userInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-a',
        invitedById: 'owner-1',
        email: 'convidado@example.com',
        role: UserRole.FINANCEIRO,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: expect.any(Date),
      }),
      select: expect.not.objectContaining({ tokenHash: expect.anything() }),
    });
    const expiredCutoff = transaction.userInvitation.updateMany.mock.calls[0][0]
      .where.expiresAt.lte as Date;
    const createdExpiry = transaction.userInvitation.create.mock.calls[0][0]
      .data.expiresAt as Date;
    expect(createdExpiry.getTime() - expiredCutoff.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
    expect(notifier.sendUserInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        invitationId: 'invitation-1',
        email: 'convidado@example.com',
        acceptUrl: expect.stringMatching(
          /^https:\/\/app\.example\.com\/accept-invitation\?token=/,
        ),
      }),
    );
    expect(result).not.toHaveProperty('tokenHash');
    expect(result).not.toHaveProperty('organizationId');
    expect(result.invitedBy).not.toHaveProperty('email');
  });

  it('rejects an invitation when a case-insensitive user already exists', async () => {
    transaction.user.findFirst.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.create(owner, {
        email: 'existing@example.com',
        role: UserRole.LEITURA,
      }),
    ).rejects.toThrow(CREATE_INVITATION_CONFLICT_MESSAGE);

    expect(transaction.userInvitation.create).not.toHaveBeenCalled();
    expect(notifier.sendUserInvitation).not.toHaveBeenCalled();
  });

  it('revokes expired pending invitations and rejects an active duplicate', async () => {
    transaction.user.findFirst.mockResolvedValue(null);
    transaction.userInvitation.updateMany.mockResolvedValue({ count: 2 });
    transaction.userInvitation.findFirst.mockResolvedValue({
      id: 'still-active',
    });

    await expect(
      service.create(owner, {
        email: 'pending@example.com',
        role: UserRole.COMERCIAL,
      }),
    ).rejects.toThrow(CREATE_INVITATION_CONFLICT_MESSAGE);

    expect(transaction.userInvitation.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.userInvitation.create).not.toHaveBeenCalled();
  });

  it('maps a creation uniqueness race to the same generic conflict', async () => {
    transaction.user.findFirst.mockResolvedValue(null);
    transaction.userInvitation.updateMany.mockResolvedValue({ count: 0 });
    transaction.userInvitation.findFirst.mockResolvedValue(null);
    transaction.userInvitation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    await expect(
      service.create(owner, {
        email: 'race@example.com',
        role: UserRole.LEITURA,
      }),
    ).rejects.toThrow(CREATE_INVITATION_CONFLICT_MESSAGE);
  });

  it('prevents ADMIN from inviting OWNER while allowing OWNER to do it', async () => {
    await expect(
      service.create(admin, {
        email: 'new-owner@example.com',
        role: UserRole.OWNER,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();

    transaction.user.findFirst.mockResolvedValue(null);
    transaction.userInvitation.updateMany.mockResolvedValue({ count: 0 });
    transaction.userInvitation.findFirst.mockResolvedValue(null);
    transaction.userInvitation.create.mockResolvedValue(
      safeInvitation({ role: UserRole.OWNER }),
    );

    await expect(
      service.create(owner, {
        email: 'new-owner@example.com',
        role: UserRole.OWNER,
      }),
    ).resolves.toMatchObject({ role: UserRole.OWNER });
  });

  it('lists only tenant invitations through the safe projection', async () => {
    prisma.userInvitation.findMany.mockResolvedValue([safeInvitation()]);

    await expect(service.findAll('org-a')).resolves.toEqual([safeInvitation()]);
    expect(prisma.userInvitation.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a' },
      select: expect.not.objectContaining({ tokenHash: expect.anything() }),
      orderBy: { createdAt: 'desc' },
    });
    const select = prisma.userInvitation.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('organizationId');
    expect(select.invitedBy.select).not.toHaveProperty('email');
  });

  it('revokes a pending invitation once and within the actor tenant', async () => {
    transaction.userInvitation.findFirst
      .mockResolvedValueOnce({ id: 'invitation-1', role: UserRole.LEITURA })
      .mockResolvedValueOnce(safeInvitation({ revokedAt: new Date() }));
    transaction.userInvitation.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.revoke('invitation-1', owner)).resolves.toMatchObject({
      id: 'invitation-1',
      revokedAt: expect.any(Date),
    });
    expect(transaction.userInvitation.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: 'invitation-1', organizationId: 'org-a' },
      select: { id: true, role: true },
    });
    expect(transaction.userInvitation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'invitation-1',
        organizationId: 'org-a',
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      }),
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('does not reveal or mutate an invitation from another tenant', async () => {
    transaction.userInvitation.findFirst.mockResolvedValue(null);

    await expect(service.revoke('org-b-invitation', owner)).rejects.toThrow(
      NotFoundException,
    );
    expect(transaction.userInvitation.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a second revoke and prevents ADMIN from revoking an OWNER invitation', async () => {
    transaction.userInvitation.findFirst.mockResolvedValue({
      id: 'invitation-1',
      role: UserRole.LEITURA,
    });
    transaction.userInvitation.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.revoke('invitation-1', owner)).rejects.toThrow(
      ConflictException,
    );

    transaction.userInvitation.findFirst.mockResolvedValue({
      id: 'owner-invitation',
      role: UserRole.OWNER,
    });
    await expect(service.revoke('owner-invitation', admin)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('atomically accepts an invitation using only its tenant, email and role', async () => {
    transaction.userInvitation.findUnique.mockResolvedValue(rawInvitation());
    transaction.userInvitation.updateMany.mockResolvedValue({ count: 1 });
    transaction.user.findFirst.mockResolvedValue(null);
    transaction.user.create.mockImplementation(({ data }: any) =>
      Promise.resolve(
        acceptedUser({
          email: data.email,
          organizationId: data.organizationId,
          role: data.role,
        }),
      ),
    );

    const result = await service.accept({
      token: 'valid-raw-token',
      name: '  Ana Silva  ',
      password: 'SenhaForte#123',
    });

    expect(transaction.userInvitation.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      select: expect.not.objectContaining({ tokenHash: expect.anything() }),
    });
    expect(transaction.userInvitation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'invitation-1',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      }),
      data: { acceptedAt: expect.any(Date) },
    });
    expect(transaction.$executeRaw.mock.calls[0][1]).toBe(
      'convidado@example.com',
    );
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-a',
        email: 'convidado@example.com',
        role: UserRole.FINANCEIRO,
        name: 'Ana Silva',
        password: expect.stringMatching(/^\$2[aby]\$10\$/),
        isActive: true,
        invitedAt: rawInvitation().createdAt,
        acceptedAt: expect.any(Date),
      },
      select: {
        id: true,
        email: true,
        organizationId: true,
        tokenVersion: true,
        role: true,
      },
    });
    expect(result).toEqual(acceptedUser());
  });

  it('rejects an unknown token with the generic invitation error', async () => {
    transaction.userInvitation.findUnique.mockResolvedValue(null);

    await expect(
      service.accept({
        token: 'unknown-token',
        name: 'Ana',
        password: 'SenhaForte#123',
      }),
    ).rejects.toThrow(INVALID_INVITATION_MESSAGE);
    expect(transaction.userInvitation.updateMany).not.toHaveBeenCalled();
  });

  it.each(['expired', 'revoked', 'already used'])(
    'rejects an %s invitation through the same atomic claim',
    async () => {
      transaction.userInvitation.findUnique.mockResolvedValue(rawInvitation());
      transaction.userInvitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.accept({
          token: 'unusable-token',
          name: 'Ana',
          password: 'SenhaForte#123',
        }),
      ).rejects.toThrow(INVALID_INVITATION_MESSAGE);
      expect(transaction.user.create).not.toHaveBeenCalled();
    },
  );

  it('allows only one winner when the same invitation is accepted concurrently', async () => {
    let available = true;
    transaction.userInvitation.findUnique.mockResolvedValue(rawInvitation());
    transaction.userInvitation.updateMany.mockImplementation(() => {
      const count = available ? 1 : 0;
      available = false;
      return Promise.resolve({ count });
    });
    transaction.user.findFirst.mockResolvedValue(null);
    transaction.user.create.mockResolvedValue(acceptedUser());

    const attempts = await Promise.allSettled([
      service.accept({
        token: 'same-token',
        name: 'Ana',
        password: 'SenhaForte#123',
      }),
      service.accept({
        token: 'same-token',
        name: 'Ana',
        password: 'SenhaForte#123',
      }),
    ]);

    expect(
      attempts.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    expect(transaction.user.create).toHaveBeenCalledTimes(1);
  });

  it('rejects acceptance if an account appeared before the claim completed', async () => {
    transaction.userInvitation.findUnique.mockResolvedValue(rawInvitation());
    transaction.userInvitation.updateMany.mockResolvedValue({ count: 1 });
    transaction.user.findFirst.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.accept({
        token: 'valid-token',
        name: 'Ana',
        password: 'SenhaForte#123',
      }),
    ).rejects.toThrow(INVALID_INVITATION_MESSAGE);
    expect(transaction.user.create).not.toHaveBeenCalled();
  });

  it('maps a database uniqueness race to a generic conflict', async () => {
    transaction.userInvitation.findUnique.mockResolvedValue(rawInvitation());
    transaction.userInvitation.updateMany.mockResolvedValue({ count: 1 });
    transaction.user.findFirst.mockResolvedValue(null);
    transaction.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    await expect(
      service.accept({
        token: 'valid-token',
        name: 'Ana',
        password: 'SenhaForte#123',
      }),
    ).rejects.toThrow(INVALID_INVITATION_MESSAGE);
  });

  it('keeps the invitation when notification fails and logs no secret', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    transaction.user.findFirst.mockResolvedValue(null);
    transaction.userInvitation.updateMany.mockResolvedValue({ count: 0 });
    transaction.userInvitation.findFirst.mockResolvedValue(null);
    transaction.userInvitation.create.mockResolvedValue(safeInvitation());
    notifier.sendUserInvitation.mockRejectedValue(new Error('provider down'));

    await expect(
      service.create(owner, {
        email: 'convidado@example.com',
        role: UserRole.LEITURA,
      }),
    ).resolves.toEqual(safeInvitation());

    const notification = notifier.sendUserInvitation.mock.calls[0][0];
    const rawToken = new URL(notification.acceptUrl).searchParams.get('token');
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).not.toContain(rawToken);
    expect(logged).not.toContain('tokenHash');
    expect(logged).not.toContain('convidado@example.com');
  });
});

const INVALID_INVITATION_MESSAGE = 'Convite inválido ou expirado.';
const CREATE_INVITATION_CONFLICT_MESSAGE = 'Não foi possível criar o convite.';
const CREATED_AT = new Date('2026-08-02T10:00:00.000Z');
const EXPIRES_AT = new Date('2026-08-09T10:00:00.000Z');

function createService(
  prisma: ReturnType<typeof createPrismaMock>,
  notifier: { sendUserInvitation: jest.Mock },
) {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'USER_INVITATION_FRONTEND_URL') {
        return 'https://app.example.com/accept-invitation';
      }

      return undefined;
    }),
  };

  return new UserInvitationsService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    notifier,
  );
}

function createPrismaMock(
  transaction: ReturnType<typeof createTransactionMock>,
) {
  return {
    userInvitation: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
}

function createTransactionMock() {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    userInvitation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  };
}

function rawInvitation() {
  return {
    id: 'invitation-1',
    organizationId: 'org-a',
    email: 'convidado@example.com',
    role: UserRole.FINANCEIRO,
    createdAt: CREATED_AT,
  };
}

function safeInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invitation-1',
    email: 'convidado@example.com',
    role: UserRole.FINANCEIRO,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    acceptedAt: null,
    revokedAt: null,
    updatedAt: CREATED_AT,
    invitedBy: {
      id: 'owner-1',
      name: 'Owner',
    },
    ...overrides,
  };
}

function acceptedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'convidado@example.com',
    organizationId: 'org-a',
    tokenVersion: 0,
    role: UserRole.FINANCEIRO,
    ...overrides,
  };
}
