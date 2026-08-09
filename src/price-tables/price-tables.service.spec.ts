import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PriceTablesService } from './price-tables.service';

describe('PriceTablesService audit', () => {
  const actor = { id: 'user-1', organizationId: 'org-a' };
  let transaction: ReturnType<typeof createTransactionMock>;
  let prisma: ReturnType<typeof createPrismaMock>;
  let audit: { record: jest.Mock; recordMany: jest.Mock };
  let service: PriceTablesService;

  beforeEach(() => {
    transaction = createTransactionMock();
    prisma = createPrismaMock(transaction);
    audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      recordMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    service = new PriceTablesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  it('audits price-table create, update and delete atomically', async () => {
    prisma.development.findFirst.mockResolvedValue({ id: 'development-1' });
    prisma.priceTable.findFirst.mockResolvedValue({ id: 'table-1' });
    transaction.priceTable.create.mockResolvedValue({ id: 'table-1' });
    transaction.priceTable.update.mockResolvedValue({ id: 'table-1' });
    transaction.priceTable.delete.mockResolvedValue({ id: 'table-1' });
    transaction.unitPrice.findMany.mockResolvedValue([
      { id: 'price-1', unitId: 'unit-1', priceTableId: 'table-1' },
    ]);

    await service.create(actor, {
      developmentId: 'development-1',
      name: 'Tabela A',
      phase: 'Lançamento',
      active: true,
    });
    await service.update('table-1', actor, {
      name: 'Tabela B',
      active: false,
    });
    await service.remove('table-1', actor);

    expect(audit.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: AUDIT_ACTIONS.CREATE,
        entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
        entityId: 'table-1',
      }),
      transaction,
    );
    expect(audit.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: AUDIT_ACTIONS.UPDATE,
        metadata: { changedFields: ['name', 'active'] },
      }),
      transaction,
    );
    expect(audit.record).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ action: AUDIT_ACTIONS.DELETE }),
      transaction,
    );
    expect(transaction.unitPrice.findMany).toHaveBeenCalledWith({
      where: { priceTableId: 'table-1', organizationId: 'org-a' },
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
              entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
              entityId: 'table-1',
            },
          },
        },
      ],
      transaction,
    );
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.unitPrice.findMany.mock.invocationCallOrder[0],
    );
    expect(
      transaction.unitPrice.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(transaction.priceTable.delete.mock.invocationCallOrder[0]);
  });

  it('audits a new unit price as CREATE in the upsert transaction', async () => {
    arrangeValidUnitPriceScope(prisma);
    transaction.unitPrice.findFirst.mockResolvedValue(null);
    transaction.unitPrice.upsert.mockResolvedValue({
      id: 'price-1',
      priceTableId: 'table-1',
      unitId: 'unit-1',
    });

    await service.setPrice('table-1', actor, {
      unitId: 'unit-1',
      value: 500_000,
    });

    expect(audit.record).toHaveBeenCalledWith(
      {
        organizationId: 'org-a',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.CREATE,
        entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
        entityId: 'table-1',
        metadata: { unitPriceId: 'price-1', unitId: 'unit-1' },
      },
      transaction,
    );
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.unitPrice.findFirst.mock.invocationCallOrder[0],
    );
  });

  it('audits an existing unit price as UPDATE without recording its value', async () => {
    arrangeValidUnitPriceScope(prisma);
    transaction.unitPrice.findFirst.mockResolvedValue({ id: 'price-1' });
    transaction.unitPrice.upsert.mockResolvedValue({
      id: 'price-1',
      priceTableId: 'table-1',
      unitId: 'unit-1',
    });

    await service.setPrice('table-1', actor, {
      unitId: 'unit-1',
      value: 600_000,
    });

    expect(audit.record).toHaveBeenCalledWith(
      {
        organizationId: 'org-a',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.UPDATE,
        entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
        entityId: 'table-1',
        metadata: {
          unitPriceId: 'price-1',
          unitId: 'unit-1',
          changedFields: ['value'],
        },
      },
      transaction,
    );
  });

  it('keeps PATCH and DELETE unit-price events correlated to their table', async () => {
    prisma.unitPrice.findFirst.mockResolvedValue({ id: 'price-1' });
    transaction.unitPrice.update.mockResolvedValue({
      id: 'price-1',
      priceTableId: 'table-1',
      unitId: 'unit-1',
    });
    transaction.unitPrice.delete.mockResolvedValue({
      id: 'price-1',
      priceTableId: 'table-1',
      unitId: 'unit-1',
    });

    await service.updatePrice('price-1', actor, { value: 650_000 });
    await service.removePrice('price-1', actor);

    expect(audit.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: AUDIT_ACTIONS.UPDATE,
        entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
        entityId: 'table-1',
        metadata: {
          unitPriceId: 'price-1',
          unitId: 'unit-1',
          changedFields: ['value'],
        },
      }),
      transaction,
    );
    expect(audit.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: AUDIT_ACTIONS.DELETE,
        entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
        entityId: 'table-1',
        metadata: { unitPriceId: 'price-1', unitId: 'unit-1' },
      }),
      transaction,
    );
  });
});

function arrangeValidUnitPriceScope(
  prisma: ReturnType<typeof createPrismaMock>,
) {
  prisma.priceTable.findFirst.mockResolvedValue({
    id: 'table-1',
    developmentId: 'development-1',
  });
  prisma.unit.findFirst.mockResolvedValue({ id: 'unit-1' });
}

function createTransactionMock() {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'table-1' }]),
    priceTable: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    unitPrice: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function createPrismaMock(
  transaction: ReturnType<typeof createTransactionMock>,
) {
  return {
    development: { findFirst: jest.fn() },
    priceTable: { findFirst: jest.fn() },
    unit: { findFirst: jest.fn() },
    unitPrice: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
}
