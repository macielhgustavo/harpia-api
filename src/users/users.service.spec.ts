/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let transaction: ReturnType<typeof createTransactionMock>;
  let service: UsersService;

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
    service = new UsersService(prisma as unknown as PrismaService);
  });

  it('lists only the tenant users with role, status and normalized search filters', async () => {
    prisma.user.findMany.mockResolvedValue([safeUser()]);

    await expect(
      service.findAll('org-a', {
        role: UserRole.FINANCEIRO,
        isActive: false,
        search: '  ana  ',
      }),
    ).resolves.toEqual([safeUser()]);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-a',
        role: UserRole.FINANCEIRO,
        isActive: false,
        OR: [
          { name: { contains: 'ana', mode: 'insensitive' } },
          { email: { contains: 'ana', mode: 'insensitive' } },
        ],
      },
      select: expect.not.objectContaining({
        password: expect.anything(),
        tokenVersion: expect.anything(),
      }),
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    });
  });

  it('returns 404 instead of exposing a user from another tenant', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.findOne('user-from-org-b', 'org-a')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-from-org-b', organizationId: 'org-a' },
      }),
    );
  });

  it('changes a role under the organization lock and revokes existing tokens', async () => {
    transaction.user.findFirst.mockResolvedValue(safeUser());
    transaction.user.update.mockResolvedValue(
      safeUser({ role: UserRole.FINANCEIRO }),
    );

    await expect(
      service.updateRole('user-1', owner, UserRole.FINANCEIRO),
    ).resolves.toMatchObject({ role: UserRole.FINANCEIRO });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        role: UserRole.FINANCEIRO,
        tokenVersion: { increment: 1 },
      },
      select: expect.not.objectContaining({
        password: expect.anything(),
        tokenVersion: expect.anything(),
      }),
    });
  });

  it('changes status and revokes existing tokens', async () => {
    transaction.user.findFirst.mockResolvedValue(safeUser());
    transaction.user.update.mockResolvedValue(safeUser({ isActive: false }));

    await expect(
      service.updateStatus('user-1', owner, false),
    ).resolves.toMatchObject({ isActive: false });

    expect(transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          isActive: false,
          tokenVersion: { increment: 1 },
        },
      }),
    );
  });

  it('does not let a user deactivate itself', async () => {
    await expect(service.updateStatus(owner.id, owner, false)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not let an ADMIN alter an OWNER or assign the OWNER role', async () => {
    transaction.user.findFirst.mockResolvedValue(
      safeUser({ id: 'owner-2', role: UserRole.OWNER }),
    );

    await expect(service.updateStatus('owner-2', admin, false)).rejects.toThrow(
      ForbiddenException,
    );

    transaction.user.findFirst.mockResolvedValue(safeUser());
    await expect(
      service.updateRole('user-1', admin, UserRole.OWNER),
    ).rejects.toThrow(ForbiddenException);
    expect(transaction.user.update).not.toHaveBeenCalled();
  });

  it('does not demote or deactivate the last active OWNER', async () => {
    const lastOwner = safeUser({ id: 'owner-2', role: UserRole.OWNER });
    transaction.user.findFirst.mockResolvedValue(lastOwner);
    transaction.user.count.mockResolvedValue(0);

    await expect(
      service.updateRole('owner-2', owner, UserRole.ADMIN),
    ).rejects.toThrow(ConflictException);
    await expect(service.updateStatus('owner-2', owner, false)).rejects.toThrow(
      ConflictException,
    );

    expect(transaction.user.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-a',
        role: UserRole.OWNER,
        isActive: true,
        id: { not: 'owner-2' },
      },
    });
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.user.count.mock.invocationCallOrder[0],
    );
    expect(transaction.user.update).not.toHaveBeenCalled();
  });

  it('does not increment tokenVersion for role or status no-ops', async () => {
    const unchanged = safeUser({ role: UserRole.FINANCEIRO, isActive: true });
    transaction.user.findFirst.mockResolvedValue(unchanged);

    await expect(
      service.updateRole('user-1', owner, UserRole.FINANCEIRO),
    ).resolves.toEqual(unchanged);
    await expect(service.updateStatus('user-1', owner, true)).resolves.toEqual(
      unchanged,
    );

    expect(transaction.user.update).not.toHaveBeenCalled();
  });

  it('returns 404 for a cross-tenant mutation while holding only the actor tenant lock', async () => {
    transaction.user.findFirst.mockResolvedValue(null);

    await expect(
      service.updateRole('user-from-org-b', owner, UserRole.COMERCIAL),
    ).rejects.toThrow(NotFoundException);
    expect(transaction.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-from-org-b', organizationId: 'org-a' },
      }),
    );
    expect(transaction.user.update).not.toHaveBeenCalled();
  });
});

function safeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'ana@example.com',
    name: 'Ana',
    role: UserRole.LEITURA,
    isActive: true,
    lastLoginAt: null,
    invitedAt: null,
    acceptedAt: null,
    personId: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createTransactionMock() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: {
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };
}

function createPrismaMock(
  transaction: ReturnType<typeof createTransactionMock>,
) {
  return {
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
}
