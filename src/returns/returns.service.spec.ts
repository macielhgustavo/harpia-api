import { BadRequestException } from '@nestjs/common';
import { ReturnStatus } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReturnsService } from './returns.service';

describe('ReturnsService audit', () => {
  const actor = { id: 'user-1', organizationId: 'org-a' };
  let transaction: ReturnType<typeof createTransactionMock>;
  let prisma: ReturnType<typeof createPrismaMock>;
  let audit: { record: jest.Mock };
  let service: ReturnsService;

  beforeEach(() => {
    transaction = createTransactionMock();
    prisma = createPrismaMock(transaction);
    audit = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    service = new ReturnsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
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

  it('records CREATE and RETURN_PAID when a return starts as paid', async () => {
    prisma.allocation.findFirst.mockResolvedValue({ id: 'allocation-1' });
    transaction.return.create.mockResolvedValue({
      id: 'return-1',
      status: ReturnStatus.PAGO,
    });

    await service.create(actor, {
      allocationId: 'allocation-1',
      expectedAmount: 1500,
      expectedDate: '2026-08-15',
      realizedDate: '2026-08-10',
      realizedAmount: 1500,
      status: ReturnStatus.PAGO,
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
    expect(audit.record).toHaveBeenNthCalledWith(
      2,
      {
        organizationId: 'org-a',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.RETURN_PAID,
        entityType: AUDIT_ENTITY_TYPES.RETURN,
        entityId: 'return-1',
        metadata: { newStatus: ReturnStatus.PAGO },
      },
      transaction,
    );
  });

  it('records paid/status transitions and only the changed field names', async () => {
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
      status: ReturnStatus.PAGO,
    });

    await service.update('return-1', actor, {
      realizedDate: '2026-08-10',
      realizedAmount: 1500,
      status: ReturnStatus.PAGO,
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-a',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.RETURN_PAID,
        entityType: AUDIT_ENTITY_TYPES.RETURN,
        entityId: 'return-1',
        metadata: {
          changedFields: ['realizedDate', 'realizedAmount', 'status'],
          oldStatus: ReturnStatus.PENDENTE,
          newStatus: ReturnStatus.PAGO,
        },
      }),
      transaction,
    );
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.return.update.mock.invocationCallOrder[0],
    );
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

  it('keeps UPDATE for edits to an already-paid return', async () => {
    transaction.$queryRaw.mockResolvedValue([
      {
        id: 'return-1',
        status: ReturnStatus.PAGO,
        realizedDate: new Date('2026-08-10'),
        realizedAmount: 1500,
      },
    ]);
    transaction.return.update.mockResolvedValue({
      id: 'return-1',
      status: ReturnStatus.PAGO,
    });

    await service.update('return-1', actor, {
      realizedAmount: 1600,
      status: ReturnStatus.PAGO,
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.UPDATE,
        metadata: { changedFields: ['realizedAmount', 'status'] },
      }),
      transaction,
    );
  });

  it('deletes and audits the return in the same transaction', async () => {
    prisma.return.findFirst.mockResolvedValue({ id: 'return-1' });
    transaction.return.delete.mockResolvedValue({ id: 'return-1' });

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
