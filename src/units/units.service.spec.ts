import { UnitCategory, UnitStatus } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnitsService } from './units.service';

describe('UnitsService audit', () => {
  it('audits create, status update and delete with the actor tenant', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'unit-1',
          developmentId: 'development-1',
          status: UnitStatus.DISPONIVEL,
        },
      ]),
      unit: {
        create: jest.fn().mockResolvedValue({ id: 'unit-1' }),
        update: jest.fn().mockResolvedValue({ id: 'unit-1' }),
        delete: jest.fn().mockResolvedValue({ id: 'unit-1' }),
      },
      unitPrice: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'price-1', unitId: 'unit-1', priceTableId: 'table-1' },
          ]),
      },
      unitType: { findFirst: jest.fn() },
    };
    const prisma = {
      development: {
        findFirst: jest.fn().mockResolvedValue({ id: 'development-1' }),
      },
      unit: {
        findFirst: jest.fn().mockResolvedValue({ id: 'unit-1' }),
      },
      unitType: { findFirst: jest.fn() },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      recordMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const service = new UnitsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    const actor = { id: 'user-1', organizationId: 'org-a' };

    await service.create(actor, {
      developmentId: 'development-1',
      identifier: '101',
      category: UnitCategory.APARTAMENTO,
    });
    await service.update('unit-1', actor, {
      status: UnitStatus.RESERVADA,
    });
    await service.remove('unit-1', actor);

    expect(audit.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        organizationId: 'org-a',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.CREATE,
        entityType: AUDIT_ENTITY_TYPES.UNIT,
        entityId: 'unit-1',
      }),
      transaction,
    );
    expect(audit.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: AUDIT_ACTIONS.UPDATE,
        metadata: {
          changedFields: ['status'],
          oldStatus: UnitStatus.DISPONIVEL,
          newStatus: UnitStatus.RESERVADA,
        },
      }),
      transaction,
    );
    expect(audit.record).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ action: AUDIT_ACTIONS.DELETE }),
      transaction,
    );
    expect(transaction.unitPrice.findMany).toHaveBeenCalledWith({
      where: { unitId: 'unit-1', organizationId: 'org-a' },
      select: { id: true, unitId: true, priceTableId: true },
    });
    expect(audit.recordMany).toHaveBeenCalledWith(
      [
        {
          organizationId: 'org-a',
          actorUserId: 'user-1',
          action: AUDIT_ACTIONS.DELETE,
          entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
          entityId: 'table-1',
          metadata: {
            unitPriceId: 'price-1',
            unitId: 'unit-1',
            cascadeSource: {
              entityType: AUDIT_ENTITY_TYPES.UNIT,
              entityId: 'unit-1',
            },
          },
        },
      ],
      transaction,
    );
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.unit.update.mock.invocationCallOrder[0],
    );
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      transaction.unitPrice.findMany.mock.invocationCallOrder[0],
    );
    expect(
      transaction.unitPrice.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(transaction.unit.delete.mock.invocationCallOrder[0]);
  });
});
