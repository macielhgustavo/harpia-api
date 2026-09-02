import { BadRequestException } from '@nestjs/common';
import { ReturnStatus } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PayablesService } from '../finance/payables.service';
import { ReturnsService } from './returns.service';

describe('ReturnsService audit', () => {
  const actor = { id: 'user-1', organizationId: 'org-a' };
  let transaction: ReturnType<typeof createTransactionMock>;
  let prisma: ReturnType<typeof createPrismaMock>;
  let audit: { record: jest.Mock };
  let payables: {
    createForInvestorReturn: jest.Mock;
    syncInvestorReturnTerms: jest.Mock;
  };
  let service: ReturnsService;

  beforeEach(() => {
    transaction = createTransactionMock();
    prisma = createPrismaMock(transaction);
    audit = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    payables = {
      createForInvestorReturn: jest.fn().mockResolvedValue({ id: 'payable-1' }),
      syncInvestorReturnTerms: jest.fn().mockResolvedValue(undefined),
    };
    service = new ReturnsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      payables as unknown as PayablesService,
    );
  });

  it('rejects a paid create without realized date and amount', async () => {
    await expect(
      service.create(actor, {
        allocationId: 'allocation-1',
        expectedAmount: 1500,
        expectedDate: '2026-08-15',
        status: ReturnStatus.PAGO,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.allocation.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('never persists the computed ATRASADO status', async () => {
    await expect(
      service.create(actor, {
        allocationId: 'allocation-1',
        expectedAmount: 1500,
        expectedDate: '2026-08-15',
        status: ReturnStatus.ATRASADO,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.update('return-1', actor, { status: ReturnStatus.ATRASADO }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(transaction.return.create).not.toHaveBeenCalled();
    expect(transaction.return.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('creates the investor payable in the same transaction', async () => {
    prisma.allocation.findFirst.mockResolvedValue({ id: 'allocation-1' });
    transaction.return.create.mockResolvedValue({
      id: 'return-1',
      status: ReturnStatus.PENDENTE,
    });

    await service.create(actor, {
      allocationId: 'allocation-1',
      expectedAmount: 1500,
      expectedDate: '2026-08-15',
    });

    expect(audit.record).toHaveBeenNthCalledWith(
      1,
      {
        organizationId: 'org-a',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.CREATE,
        entityType: AUDIT_ENTITY_TYPES.RETURN,
        entityId: 'return-1',
      },
      transaction,
    );
    expect(payables.createForInvestorReturn).toHaveBeenCalledWith(
      'return-1',
      actor,
      transaction,
    );
  });

  it('rejects direct paid transitions because finance owns realization', async () => {
    transaction.$queryRaw.mockResolvedValue([
      {
        id: 'return-1',
        status: ReturnStatus.PENDENTE,
        realizedDate: null,
        realizedAmount: null,
      },
    ]);
    await expect(
      service.update('return-1', actor, {
        realizedDate: '2026-08-10',
        realizedAmount: 1500,
        status: ReturnStatus.PAGO,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(transaction.return.update).not.toHaveBeenCalled();
  });

  it('does not mutate or audit an invalid paid transition', async () => {
    transaction.$queryRaw.mockResolvedValue([
      {
        id: 'return-1',
        status: ReturnStatus.PENDENTE,
        realizedDate: null,
        realizedAmount: null,
      },
    ]);

    await expect(
      service.update('return-1', actor, { status: ReturnStatus.PAGO }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.return.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('syncs forecast edits to the linked payable', async () => {
    transaction.$queryRaw.mockResolvedValue([
      {
        id: 'return-1',
        status: ReturnStatus.PENDENTE,
        realizedDate: null,
        realizedAmount: null,
      },
    ]);
    transaction.return.update.mockResolvedValue({
      id: 'return-1',
      status: ReturnStatus.PENDENTE,
      expectedAmount: 1600,
      expectedDate: new Date('2026-08-20'),
    });

    await service.update('return-1', actor, {
      expectedAmount: 1600,
      expectedDate: '2026-08-20',
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.UPDATE,
        metadata: { changedFields: ['expectedAmount', 'expectedDate'] },
      }),
      transaction,
    );
    expect(payables.syncInvestorReturnTerms).toHaveBeenCalledWith(
      'return-1',
      'org-a',
      1600,
      new Date('2026-08-20'),
      transaction,
    );
  });

  it('deletes and audits the return in the same transaction', async () => {
    prisma.return.findFirst.mockResolvedValue({ id: 'return-1' });
    transaction.return.delete.mockResolvedValue({ id: 'return-1' });
    transaction.payable.findFirst.mockResolvedValue(null);

    await service.remove('return-1', actor);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.DELETE,
        entityId: 'return-1',
      }),
      transaction,
    );
  });
});

function createTransactionMock() {
  return {
    $queryRaw: jest.fn(),
    return: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    payable: { findFirst: jest.fn(), delete: jest.fn() },
  };
}

function createPrismaMock(
  transaction: ReturnType<typeof createTransactionMock>,
) {
  return {
    allocation: { findFirst: jest.fn() },
    return: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
}
