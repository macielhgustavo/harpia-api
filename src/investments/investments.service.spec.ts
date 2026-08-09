import { InvestmentType } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvestmentsService } from './investments.service';

describe('InvestmentsService audit', () => {
  it('audits create, update and delete without storing financial values', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'investment-1' }])
        .mockResolvedValueOnce([{ id: 'allocation-1' }]),
      investment: {
        create: jest.fn().mockResolvedValue({ id: 'investment-1' }),
        update: jest.fn().mockResolvedValue({ id: 'investment-1' }),
        delete: jest.fn().mockResolvedValue({ id: 'investment-1' }),
      },
      return: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'return-1' }, { id: 'return-2' }]),
      },
    };
    const prisma = {
      person: { findFirst: jest.fn().mockResolvedValue({ id: 'person-1' }) },
      personRole: { findUnique: jest.fn().mockResolvedValue({ id: 'role-1' }) },
      investment: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'investment-1', allocations: [] })
          .mockResolvedValueOnce({ id: 'investment-1' }),
      },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      recordMany: jest.fn().mockResolvedValue({ count: 3 }),
    };
    const service = new InvestmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    const actor = { id: 'user-1', organizationId: 'org-a' };

    await service.create(actor, {
      investorId: 'person-1',
      amount: 100_000,
      date: '2026-08-01',
      type: InvestmentType.FINANCEIRO,
    });
    await service.update('investment-1', actor, {
      amount: 120_000,
      notes: 'sensitive financial note',
    });
    await service.remove('investment-1', actor);

    expect(audit.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: AUDIT_ACTIONS.CREATE,
        entityType: AUDIT_ENTITY_TYPES.INVESTMENT,
        entityId: 'investment-1',
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
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.return.findMany).toHaveBeenCalledWith({
      where: {
        allocationId: { in: ['allocation-1'] },
        organizationId: 'org-a',
      },
      select: { id: true },
    });
    expect(audit.recordMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          organizationId: 'org-a',
          actorUserId: 'user-1',
          action: AUDIT_ACTIONS.DELETE,
          entityType: AUDIT_ENTITY_TYPES.ALLOCATION,
          entityId: 'allocation-1',
          metadata: {
            cascadeSource: {
              entityType: AUDIT_ENTITY_TYPES.INVESTMENT,
              entityId: 'investment-1',
            },
          },
        }),
        expect.objectContaining({
          entityType: AUDIT_ENTITY_TYPES.RETURN,
          entityId: 'return-1',
        }),
        expect.objectContaining({
          entityType: AUDIT_ENTITY_TYPES.RETURN,
          entityId: 'return-2',
        }),
      ],
      transaction,
    );
    expect(transaction.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      transaction.return.findMany.mock.invocationCallOrder[0],
    );
    expect(
      transaction.return.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(transaction.investment.delete.mock.invocationCallOrder[0]);
  });
});
