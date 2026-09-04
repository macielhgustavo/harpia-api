import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalesVisitStatus } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { VisitsService } from './visits.service';

describe('VisitsService', () => {
  const actor = { id: 'user-1', organizationId: 'org-a' };
  let tx: ReturnType<typeof transactionMock>;
  let prisma: ReturnType<typeof prismaMock>;
  let audit: { record: jest.Mock };
  let service: VisitsService;

  beforeEach(() => {
    tx = transactionMock();
    prisma = prismaMock(tx);
    audit = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    service = new VisitsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  it('creates a tenant-scoped visit using the opportunity relationships', async () => {
    tx.opportunity.findFirst.mockResolvedValue({
      id: 'opportunity-1',
      personId: 'person-1',
      assignedUserId: 'user-2',
      developmentId: 'development-1',
      unitId: 'unit-1',
    });
    tx.user.findFirst.mockResolvedValue({ id: 'user-2' });
    tx.unit.findFirst.mockResolvedValue({
      id: 'unit-1',
      developmentId: 'development-1',
    });
    tx.salesVisit.create.mockResolvedValue({ id: 'visit-1' });

    await service.create(actor, {
      opportunityId: 'opportunity-1',
      scheduledAt: '2026-09-10T14:00:00.000Z',
    });

    expect(tx.opportunity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'opportunity-1', organizationId: 'org-a' },
      }),
    );
    expect(tx.salesVisit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-a',
          personId: 'person-1',
          assignedUserId: 'user-2',
          developmentId: 'development-1',
          unitId: 'unit-1',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.SALES_VISIT_CREATED,
        entityType: AUDIT_ENTITY_TYPES.SALES_VISIT,
        entityId: 'visit-1',
      }),
      tx,
    );
  });

  it('requires a reason to cancel a visit', async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'visit-1',
        assignedUserId: null,
        status: SalesVisitStatus.AGENDADA,
        outcome: null,
        cancellationReason: null,
        completedAt: null,
        cancelledAt: null,
      },
    ]);

    await expect(
      service.update('visit-1', actor, {
        status: SalesVisitStatus.CANCELADA,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.salesVisit.update).not.toHaveBeenCalled();
  });

  it('fails closed when the visit does not belong to the tenant', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      service.update('visit-other-tenant', actor, {
        status: SalesVisitStatus.REALIZADA,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(tx.salesVisit.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

function transactionMock() {
  return {
    $queryRaw: jest.fn(),
    opportunity: { findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
    unit: { findFirst: jest.fn() },
    development: { findFirst: jest.fn() },
    salesVisit: { create: jest.fn(), update: jest.fn() },
  };
}

function prismaMock(tx: ReturnType<typeof transactionMock>) {
  return {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      Promise.resolve(callback(tx)),
    ),
    salesVisit: { findMany: jest.fn(), count: jest.fn() },
  };
}
