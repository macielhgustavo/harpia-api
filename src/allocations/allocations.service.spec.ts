import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AllocationsService } from './allocations.service';

describe('AllocationsService audit', () => {
  it('audits create, update and delete without storing allocation values', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'allocation-1' }]),
      allocation: {
        create: jest.fn().mockResolvedValue({ id: 'allocation-1' }),
        update: jest.fn().mockResolvedValue({ id: 'allocation-1' }),
        delete: jest.fn().mockResolvedValue({ id: 'allocation-1' }),
      },
      return: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'return-1' }, { id: 'return-2' }]),
      },
    };
    const prisma = {
      investment: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'investment-1', amount: 200_000 }),
      },
      development: { findFirst: jest.fn() },
      allocation: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'allocation-1',
            investmentId: 'investment-1',
            investment: { amount: 200_000 },
          })
          .mockResolvedValueOnce({ id: 'allocation-1' }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 50_000 } }),
      },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      recordMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    const service = new AllocationsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    const actor = { id: 'user-1', organizationId: 'org-a' };

    await service.create(actor, {
      investmentId: 'investment-1',
      amount: 50_000,
      date: '2026-08-01',
    });
    await service.update('allocation-1', actor, {
      amount: 60_000,
      notes: 'private allocation note',
    });
    await service.remove('allocation-1', actor);

    expect(audit.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: AUDIT_ACTIONS.CREATE,
        entityType: AUDIT_ENTITY_TYPES.ALLOCATION,
        entityId: 'allocation-1',
      }),
      transaction,
    );
    expect(audit.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: AUDIT_ACTIONS.UPDATE,
        metadata: { changedFields: ['amount', 'notes'] },
      }),
      transaction,
    );
    expect(audit.record).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ action: AUDIT_ACTIONS.DELETE }),
      transaction,
    );
    expect(transaction.return.findMany).toHaveBeenCalledWith({
      where: { allocationId: 'allocation-1', organizationId: 'org-a' },
      select: { id: true },
    });
    expect(audit.recordMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          organizationId: 'org-a',
          actorUserId: 'user-1',
          action: AUDIT_ACTIONS.DELETE,
          entityType: AUDIT_ENTITY_TYPES.RETURN,
          entityId: 'return-1',
          metadata: {
            cascadeSource: {
              entityType: AUDIT_ENTITY_TYPES.ALLOCATION,
              entityId: 'allocation-1',
            },
          },
        }),
        expect.objectContaining({
          entityType: AUDIT_ENTITY_TYPES.RETURN,
          entityId: 'return-2',
        }),
      ],
      transaction,
    );
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.return.findMany.mock.invocationCallOrder[0],
    );
    expect(
      transaction.return.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(transaction.allocation.delete.mock.invocationCallOrder[0]);
  });
});
