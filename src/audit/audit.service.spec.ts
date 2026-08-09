import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: AuditService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AuditService(prisma as unknown as PrismaService);
  });

  it('records sanitized metadata with the supplied transaction', async () => {
    const tx = createPrismaMock();
    tx.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await service.record(
      {
        organizationId: 'org-a',
        actorUserId: 'user-a',
        action: 'UPDATE',
        entityType: 'USER',
        entityId: 'user-b',
        metadata: {
          changedFields: ['name'],
          password: 'do-not-store',
          nested: { jwt: 'do-not-store-either', safe: true },
        },
      },
      tx as unknown as Prisma.TransactionClient,
    );

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-a',
        actorUserId: 'user-a',
        action: 'UPDATE',
        entityType: 'USER',
        entityId: 'user-b',
        metadata: {
          changedFields: ['name'],
          nested: { safe: true },
        },
      },
    });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('records cascade events in sanitized batches with the supplied transaction', async () => {
    const tx = createPrismaMock();
    tx.auditLog.createMany.mockResolvedValue({ count: 2 });

    await expect(
      service.recordMany(
        [
          {
            organizationId: 'org-a',
            actorUserId: 'user-a',
            action: 'DELETE',
            entityType: 'RETURN',
            entityId: 'return-a',
            metadata: { cascadeSource: 'investment-a', token: 'omit' },
          },
          {
            organizationId: 'org-a',
            actorUserId: 'user-a',
            action: 'DELETE',
            entityType: 'ALLOCATION',
            entityId: 'allocation-a',
          },
        ],
        tx as unknown as Prisma.TransactionClient,
      ),
    ).resolves.toEqual({ count: 2 });

    expect(tx.auditLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          entityId: 'return-a',
          metadata: { cascadeSource: 'investment-a' },
        }),
        expect.objectContaining({ entityId: 'allocation-a' }),
      ],
    });
    expect(prisma.auditLog.createMany).not.toHaveBeenCalled();
  });

  it('applies tenant, filters and pagination to list queries', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      auditLogRow({ id: 'audit-1' }),
    ]);
    prisma.auditLog.count.mockResolvedValue(41);

    const result = await service.findAll('org-a', {
      action: 'UPDATE',
      entityType: 'USER',
      entityId: 'user-b',
      actorUserId: 'user-a',
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-02T23:59:59.999Z',
      page: 2,
      pageSize: 20,
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-a',
          action: 'UPDATE',
          entityType: 'USER',
          entityId: 'user-b',
          actorUserId: 'user-a',
          createdAt: {
            gte: new Date('2026-08-01T00:00:00.000Z'),
            lte: new Date('2026-08-02T23:59:59.999Z'),
          },
        },
        skip: 20,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-a',
        action: 'UPDATE',
        entityType: 'USER',
        entityId: 'user-b',
        actorUserId: 'user-a',
        createdAt: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lte: new Date('2026-08-02T23:59:59.999Z'),
        },
      },
    });
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          id: 'audit-1',
          organizationId: 'org-a',
          actor: null,
        }),
      ],
      pagination: { page: 2, pageSize: 20, total: 41, totalPages: 3 },
    });
  });

  it('never projects actor details from a different tenant', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      auditLogRow({
        actorUserId: 'user-from-org-b',
        actor: {
          id: 'user-from-org-b',
          name: 'Other tenant user',
          email: 'other@example.com',
          role: 'OWNER',
          organizationId: 'org-b',
        },
      }),
    ]);
    prisma.auditLog.count.mockResolvedValue(1);

    const result = await service.findAll('org-a', {});

    expect(result.data[0]).toMatchObject({
      organizationId: 'org-a',
      actorUserId: null,
      actor: null,
    });
    expect(JSON.stringify(result)).not.toContain('other@example.com');
  });

  it('treats date-only boundaries as full UTC calendar days', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);

    await service.findAll('org-a', {
      startDate: '2026-12-31',
      endDate: '2026-12-31',
    });

    const expectedWhere = {
      organizationId: 'org-a',
      createdAt: {
        gte: new Date('2026-12-31T00:00:00.000Z'),
        lt: new Date('2027-01-01T00:00:00.000Z'),
      },
    };
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: expectedWhere,
    });
  });

  it('keeps a full end timestamp as an inclusive lte boundary', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);

    await service.findAll('org-a', {
      endDate: '2026-08-02T12:34:56.789Z',
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-a',
          createdAt: { lte: new Date('2026-08-02T12:34:56.789Z') },
        },
      }),
    );
  });

  it('rejects an inverted date interval', async () => {
    await expect(
      service.findAll('org-a', {
        startDate: '2026-08-03T00:00:00.000Z',
        endDate: '2026-08-02T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('rejects a start at the exclusive next-day boundary', async () => {
    await expect(
      service.findAll('org-a', {
        startDate: '2026-08-03T00:00:00.000Z',
        endDate: '2026-08-02',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing or cross-tenant audit record', async () => {
    prisma.auditLog.findFirst.mockResolvedValue(null);

    await expect(service.findOne('audit-from-org-b', 'org-a')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.auditLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'audit-from-org-b', organizationId: 'org-a' },
      }),
    );
  });
});

function createPrismaMock() {
  return {
    auditLog: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
  };
}

function auditLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit-1',
    organizationId: 'org-a',
    actorUserId: null,
    action: 'UPDATE',
    entityType: 'USER',
    entityId: 'user-a',
    metadata: null,
    createdAt: new Date('2026-08-09T12:00:00.000Z'),
    actor: null,
    ...overrides,
  };
}
