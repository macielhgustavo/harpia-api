import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnitTypesService } from './unit-types.service';

const actor = { id: 'user-1', organizationId: 'org-a' };

function p2025() {
  return new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: '5.22.0',
  });
}

describe('UnitTypesService audited mutations', () => {
  it('creates in the actor tenant and records audit in the same transaction', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'development-1' }]),
      unitType: {
        create: jest.fn().mockResolvedValue({
          id: 'type-1',
          developmentId: 'development-1',
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };
    const service = new UnitTypesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await service.create(actor, {
      developmentId: 'development-1',
      name: 'Dois quartos',
      bedrooms: 2,
    });

    expect(transaction.unitType.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-a',
        developmentId: 'development-1',
        name: 'Dois quartos',
        bedrooms: 2,
        suites: undefined,
        standardArea: undefined,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      {
        organizationId: 'org-a',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.CREATE,
        entityType: AUDIT_ENTITY_TYPES.UNIT_TYPE,
        entityId: 'type-1',
        metadata: { developmentId: 'development-1' },
      },
      transaction,
    );
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.unitType.create.mock.invocationCallOrder[0],
    );
  });

  it('rejects a development outside the actor tenant before creating or auditing', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      unitType: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = { record: jest.fn() };
    const service = new UnitTypesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await expect(
      service.create(actor, {
        developmentId: 'development-from-org-b',
        name: 'Cross tenant',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.unitType.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('locks and updates only a tenant-owned type with safe changedFields metadata', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: 'type-1', developmentId: 'development-1' }]),
      unitType: {
        update: jest.fn().mockResolvedValue({ id: 'type-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };
    const service = new UnitTypesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await service.update('type-1', actor, {
      name: 'Premium',
      suites: 2,
      standardArea: null,
    });

    expect(transaction.unitType.update).toHaveBeenCalledWith({
      where: { id: 'type-1' },
      data: {
        name: 'Premium',
        bedrooms: undefined,
        suites: 2,
        standardArea: null,
      },
    });

    expect(audit.record).toHaveBeenCalledWith(
      {
        organizationId: 'org-a',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.UPDATE,
        entityType: AUDIT_ENTITY_TYPES.UNIT_TYPE,
        entityId: 'type-1',
        metadata: { changedFields: ['name', 'suites', 'standardArea'] },
      },
      transaction,
    );
  });

  it('returns 404 for a cross-tenant update without touching the row or audit', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      unitType: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = { record: jest.fn() };
    const service = new UnitTypesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await expect(
      service.update('type-from-org-b', actor, { name: 'Inválida' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.unitType.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('maps a P2025 update race to the public 404 contract', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: 'type-1', developmentId: 'development-1' }]),
      unitType: { update: jest.fn().mockRejectedValue(p2025()) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = { record: jest.fn() };
    const service = new UnitTypesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await expect(
      service.update('type-1', actor, { bedrooms: 3 }),
    ).rejects.toThrow('Tipologia não encontrada');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('returns 404 for a cross-tenant delete without touching the row or audit', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      unitType: { delete: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = { record: jest.fn(), recordMany: jest.fn() };
    const service = new UnitTypesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await expect(
      service.remove('type-from-org-b', actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.unitType.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(audit.recordMany).not.toHaveBeenCalled();
  });

  it('maps a P2025 delete race to the public 404 contract', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'type-1', developmentId: 'development-1' },
        ])
        .mockResolvedValueOnce([]),
      unitType: { delete: jest.fn().mockRejectedValue(p2025()) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = { record: jest.fn(), recordMany: jest.fn() };
    const service = new UnitTypesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await expect(service.remove('type-1', actor)).rejects.toThrow(
      'Tipologia não encontrada',
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(audit.recordMany).not.toHaveBeenCalled();
  });

  it('deletes atomically and audits every unit detached by SetNull', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'type-1', developmentId: 'development-1' },
        ])
        .mockResolvedValueOnce([{ id: 'unit-1' }, { id: 'unit-2' }]),
      unitType: {
        delete: jest.fn().mockResolvedValue({ id: 'type-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      recordMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    const service = new UnitTypesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await service.remove('type-1', actor);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-a',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.DELETE,
        entityType: AUDIT_ENTITY_TYPES.UNIT_TYPE,
        entityId: 'type-1',
        metadata: {
          developmentId: 'development-1',
          detachedUnitCount: 2,
        },
      }),
      transaction,
    );
    expect(audit.recordMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          action: AUDIT_ACTIONS.UPDATE,
          entityType: AUDIT_ENTITY_TYPES.UNIT,
          entityId: 'unit-1',
          metadata: {
            changedFields: ['unitTypeId'],
            oldUnitTypeId: 'type-1',
            newUnitTypeId: null,
            cascadeSource: {
              entityType: AUDIT_ENTITY_TYPES.UNIT_TYPE,
              entityId: 'type-1',
            },
          },
        }),
        expect.objectContaining({ entityId: 'unit-2' }),
      ],
      transaction,
    );
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      transaction.unitType.delete.mock.invocationCallOrder[0],
    );
  });

  it('does not expose a mutation when delete audit fails', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'type-1', developmentId: 'development-1' },
        ])
        .mockResolvedValueOnce([]),
      unitType: {
        delete: jest.fn().mockResolvedValue({ id: 'type-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const auditError = new Error('audit unavailable');
    const audit = {
      record: jest.fn().mockRejectedValue(auditError),
      recordMany: jest.fn(),
    };
    const service = new UnitTypesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await expect(service.remove('type-1', actor)).rejects.toBe(auditError);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.any(Object), transaction);
    expect(audit.recordMany).not.toHaveBeenCalled();
  });
});
