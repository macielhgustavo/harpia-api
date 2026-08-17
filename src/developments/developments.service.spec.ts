import { BadRequestException } from '@nestjs/common';
import { DevelopmentStatus, DevelopmentType } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { type AuditEntry, AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { DevelopmentsService } from './developments.service';

describe('DevelopmentsService audit', () => {
  it('audits create, status update and delete in each mutation transaction', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'development-1',
            status: DevelopmentStatus.EM_OBRA,
          },
        ])
        .mockResolvedValueOnce([{ id: 'development-1' }])
        .mockResolvedValueOnce([{ id: 'type-1' }])
        .mockResolvedValueOnce([{ id: 'unit-1' }])
        .mockResolvedValueOnce([{ id: 'table-1' }]),
      development: {
        create: jest.fn().mockResolvedValue({ id: 'development-1' }),
        update: jest.fn().mockResolvedValue({ id: 'development-1' }),
        delete: jest.fn().mockResolvedValue({ id: 'development-1' }),
      },
      allocation: { count: jest.fn().mockResolvedValue(0) },
      unitReservation: { count: jest.fn().mockResolvedValue(0) },
      unitPrice: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'price-1', unitId: 'unit-1', priceTableId: 'table-1' },
          ]),
      },
    };
    const prisma = {
      development: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'development-1',
          status: DevelopmentStatus.PRONTO,
        }),
      },
      allocation: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      recordMany: jest.fn().mockResolvedValue({ count: 4 }),
    };
    const service = new DevelopmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    const actor = { id: 'user-1', organizationId: 'org-a' };

    await service.create(actor, {
      name: 'Residencial Norte',
      type: DevelopmentType.PREDIO,
    });
    await service.update('development-1', actor, {
      status: DevelopmentStatus.PRONTO,
    });
    await service.remove('development-1', actor);

    expect(audit.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: AUDIT_ACTIONS.CREATE,
        entityType: AUDIT_ENTITY_TYPES.DEVELOPMENT,
        entityId: 'development-1',
      }),
      transaction,
    );
    expect(audit.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: AUDIT_ACTIONS.UPDATE,
        metadata: {
          changedFields: ['status'],
          oldStatus: DevelopmentStatus.EM_OBRA,
          newStatus: DevelopmentStatus.PRONTO,
        },
      }),
      transaction,
    );
    expect(audit.record).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ action: AUDIT_ACTIONS.DELETE }),
      transaction,
    );
    expect(transaction.allocation.count).toHaveBeenCalledWith({
      where: { developmentId: 'development-1' },
    });
    expect(transaction.unitPrice.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-a',
        OR: [
          { unit: { developmentId: 'development-1' } },
          { priceTable: { developmentId: 'development-1' } },
        ],
      },
      select: { id: true, unitId: true, priceTableId: true },
    });
    const unitPriceAuditEntry: AuditEntry = {
      organizationId: 'org-a',
      actorUserId: 'user-1',
      action: AUDIT_ACTIONS.DELETE,
      entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
      entityId: 'table-1',
      metadata: {
        unitPriceId: 'price-1',
        unitId: 'unit-1',
        cascadeSource: {
          entityType: AUDIT_ENTITY_TYPES.DEVELOPMENT,
          entityId: 'development-1',
        },
      },
    };
    expect(audit.recordMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          entityType: AUDIT_ENTITY_TYPES.UNIT,
          entityId: 'unit-1',
        }),
        expect.objectContaining({
          action: AUDIT_ACTIONS.DELETE,
          entityType: AUDIT_ENTITY_TYPES.UNIT_TYPE,
          entityId: 'type-1',
          metadata: {
            cascadeSource: {
              entityType: AUDIT_ENTITY_TYPES.DEVELOPMENT,
              entityId: 'development-1',
            },
          },
        }),
        expect.objectContaining({
          entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
          entityId: 'table-1',
        }),
        unitPriceAuditEntry,
      ],
      transaction,
    );
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.development.update.mock.invocationCallOrder[0],
    );
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(5);
    expect(transaction.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      transaction.allocation.count.mock.invocationCallOrder[0],
    );
    expect(transaction.$queryRaw.mock.invocationCallOrder[4]).toBeLessThan(
      transaction.unitPrice.findMany.mock.invocationCallOrder[0],
    );
    expect(
      transaction.unitPrice.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(transaction.development.delete.mock.invocationCallOrder[0]);

    expect(audit.recordMany).toHaveBeenCalledWith(
      expect.not.arrayContaining([
        expect.objectContaining({
          action: AUDIT_ACTIONS.UPDATE,
          entityType: AUDIT_ENTITY_TYPES.UNIT,
        }),
      ]),
      transaction,
    );
  });

  it('persists null expected dates while leaving absent dates untouched', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'development-1',
          status: DevelopmentStatus.EM_OBRA,
        },
      ]),
      development: {
        update: jest.fn().mockResolvedValue({ id: 'development-1' }),
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
    const service = new DevelopmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await service.update(
      'development-1',
      { id: 'user-1', organizationId: 'org-a' },
      { expectedLaunchDate: null },
    );

    expect(transaction.development.update).toHaveBeenCalledWith({
      where: { id: 'development-1' },
      data: {
        name: undefined,
        description: undefined,
        type: undefined,
        companyId: undefined,
        address: undefined,
        city: undefined,
        status: undefined,
        expectedLaunchDate: null,
        expectedDeliveryDate: undefined,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { changedFields: ['expectedLaunchDate'] },
      }),
      transaction,
    );
  });

  it('rejects an inverted expected date pair before creating', async () => {
    const prisma = { $transaction: jest.fn() };
    const audit = { record: jest.fn() };
    const service = new DevelopmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await expect(
      service.create(
        { id: 'user-1', organizationId: 'org-a' },
        {
          name: 'Datas invertidas',
          type: DevelopmentType.PREDIO,
          expectedLaunchDate: '2027-06-01',
          expectedDeliveryDate: '2027-05-31',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'delivery before the persisted launch',
      dto: { expectedDeliveryDate: '2027-05-31' },
    },
    {
      label: 'launch after the persisted delivery',
      dto: { expectedLaunchDate: '2027-07-02' },
    },
  ])('rejects $label on a partial update', async ({ dto }) => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'development-1',
          status: DevelopmentStatus.EM_OBRA,
          expectedLaunchDate: new Date('2027-06-01T00:00:00.000Z'),
          expectedDeliveryDate: new Date('2027-07-01T00:00:00.000Z'),
        },
      ]),
      development: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = { record: jest.fn() };
    const service = new DevelopmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    await expect(
      service.update(
        'development-1',
        { id: 'user-1', organizationId: 'org-a' },
        dto,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.development.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
