/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
    const createCalls = tx.salesVisit.create.mock.calls as unknown[][];
    const createArgs = createCalls[0][0] as VisitWriteArgs;
    expect(createArgs.data).not.toHaveProperty('companyId');
    expect(createArgs.include).not.toHaveProperty('company');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.SALES_VISIT_CREATED,
        entityType: AUDIT_ENTITY_TYPES.SALES_VISIT,
        entityId: 'visit-1',
      }),
      tx,
    );
  });

  it('creates a visit for an opportunity with a development and no unit', async () => {
    tx.opportunity.findFirst.mockResolvedValue({
      id: 'opportunity-1',
      personId: 'person-1',
      assignedUserId: null,
      developmentId: 'development-1',
      unitId: null,
    });
    tx.development.findFirst.mockResolvedValue({ id: 'development-1' });
    tx.salesVisit.create.mockResolvedValue({ id: 'visit-1' });

    await service.create(actor, {
      opportunityId: 'opportunity-1',
      scheduledAt: '2026-09-10T14:00:00.000Z',
    });

    expect(tx.development.findFirst).toHaveBeenCalledWith({
      where: { id: 'development-1', organizationId: 'org-a' },
      select: { id: true },
    });
    expect(tx.unit.findFirst).not.toHaveBeenCalled();
    expect(tx.salesVisit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          developmentId: 'development-1',
          unitId: null,
        }),
      }),
    );
  });

  it('creates a visit for an opportunity without a development or unit', async () => {
    tx.opportunity.findFirst.mockResolvedValue({
      id: 'opportunity-1',
      personId: 'person-1',
      assignedUserId: null,
      developmentId: null,
      unitId: null,
    });
    tx.salesVisit.create.mockResolvedValue({ id: 'visit-1' });

    await service.create(actor, {
      opportunityId: 'opportunity-1',
      scheduledAt: '2026-09-10T14:00:00.000Z',
    });

    expect(tx.development.findFirst).not.toHaveBeenCalled();
    expect(tx.unit.findFirst).not.toHaveBeenCalled();
    expect(tx.salesVisit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ developmentId: null, unitId: null }),
      }),
    );
  });

  it('derives the development from an explicitly selected unit', async () => {
    tx.opportunity.findFirst.mockResolvedValue({
      id: 'opportunity-1',
      personId: 'person-1',
      assignedUserId: null,
      developmentId: null,
      unitId: null,
    });
    tx.unit.findFirst.mockResolvedValue({
      id: 'unit-2',
      developmentId: 'development-2',
    });
    tx.salesVisit.create.mockResolvedValue({ id: 'visit-1' });

    await service.create(actor, {
      opportunityId: 'opportunity-1',
      unitId: 'unit-2',
      scheduledAt: '2026-09-10T14:00:00.000Z',
    });

    expect(tx.unit.findFirst).toHaveBeenCalledWith({
      where: { id: 'unit-2', organizationId: 'org-a' },
      select: { id: true, developmentId: true },
    });
    expect(tx.salesVisit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          developmentId: 'development-2',
          unitId: 'unit-2',
        }),
      }),
    );
  });

  it('fails closed when the opportunity does not belong to the tenant', async () => {
    tx.opportunity.findFirst.mockResolvedValue(null);

    await expect(
      service.create(actor, {
        opportunityId: 'opportunity-other-tenant',
        scheduledAt: '2026-09-10T14:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.opportunity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'opportunity-other-tenant',
          organizationId: 'org-a',
        },
      }),
    );
    expect(tx.salesVisit.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lists visits with tenant scope and no company predicate or include', async () => {
    prisma.salesVisit.findMany.mockResolvedValue([{ id: 'visit-1' }]);
    prisma.salesVisit.count.mockResolvedValue(1);

    const result = await service.findMany('org-a', {
      opportunityId: 'opportunity-1',
      page: 2,
      pageSize: 10,
    });

    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    const findCalls = prisma.salesVisit.findMany.mock.calls as unknown[][];
    const findArgs = findCalls[0][0] as VisitFindArgs;
    expect(findArgs.where).toEqual({
      organizationId: 'org-a',
      opportunityId: 'opportunity-1',
    });
    expect(findArgs.where).not.toHaveProperty('companyId');
    expect(findArgs.include).not.toHaveProperty('company');
    expect(prisma.salesVisit.count).toHaveBeenCalledWith({
      where: findArgs.where,
    });
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
    expect(audit.record).not.toHaveBeenCalled();
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

  it('edits the visit and audits the changed fields without company data', async () => {
    tx.$queryRaw.mockResolvedValue([lockedVisit()]);
    tx.salesVisit.update.mockResolvedValue({ id: 'visit-1' });

    await service.update('visit-1', actor, {
      scheduledAt: '2026-09-11T15:30:00.000Z',
      durationMinutes: 90,
      notes: 'Reagendada com o cliente',
    });

    const updateCalls = tx.salesVisit.update.mock.calls as unknown[][];
    const updateArgs = updateCalls[0][0] as VisitWriteArgs;
    expect(updateArgs.where).toEqual({ id: 'visit-1' });
    expect(updateArgs.data).toEqual(
      expect.objectContaining({
        scheduledAt: new Date('2026-09-11T15:30:00.000Z'),
        durationMinutes: 90,
        notes: 'Reagendada com o cliente',
      }),
    );
    expect(updateArgs.data).not.toHaveProperty('companyId');
    expect(updateArgs.include).not.toHaveProperty('company');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-a',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.SALES_VISIT_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.SALES_VISIT,
        entityId: 'visit-1',
        metadata: {
          changedFields: ['scheduledAt', 'durationMinutes', 'notes'],
          status: SalesVisitStatus.AGENDADA,
        },
      }),
      tx,
    );
  });

  it('does not write or audit a same-state no-op', async () => {
    tx.$queryRaw.mockResolvedValue([lockedVisit()]);
    tx.salesVisit.findUniqueOrThrow.mockResolvedValue({ id: 'visit-1' });

    await expect(
      service.update('visit-1', actor, { status: SalesVisitStatus.AGENDADA }),
    ).resolves.toEqual({ id: 'visit-1' });

    expect(tx.salesVisit.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(tx.salesVisit.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'visit-1' } }),
    );
  });

  it('persists and audits a cancellation reason without a result', async () => {
    tx.$queryRaw.mockResolvedValue([lockedVisit()]);
    tx.salesVisit.update.mockResolvedValue({ id: 'visit-1' });

    await service.update('visit-1', actor, {
      status: SalesVisitStatus.CANCELADA,
      cancellationReason: ' Cliente desistiu ',
    });

    expect(tx.salesVisit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SalesVisitStatus.CANCELADA,
          cancellationReason: 'Cliente desistiu',
          result: null,
          outcome: null,
          completedAt: null,
          cancelledAt: expect.any(Date),
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          changedFields: ['status', 'cancellationReason'],
          status: SalesVisitStatus.CANCELADA,
        },
      }),
      tx,
    );
  });

  it('rejects a stale second transition after the locked row becomes terminal', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([lockedVisit()])
      .mockResolvedValueOnce([
        { ...lockedVisit(), status: SalesVisitStatus.REALIZADA },
      ]);
    tx.salesVisit.update.mockResolvedValue({ id: 'visit-1' });

    await service.update('visit-1', actor, {
      status: SalesVisitStatus.REALIZADA,
    });
    await expect(
      service.update('visit-1', actor, {
        status: SalesVisitStatus.CANCELADA,
        cancellationReason: 'Tarde demais',
      }),
    ).rejects.toThrow(ConflictException);

    expect(tx.salesVisit.update).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('keeps the row lock scoped to the session tenant', async () => {
    tx.$queryRaw.mockResolvedValue([lockedVisit()]);
    tx.salesVisit.findUniqueOrThrow.mockResolvedValue({ id: 'visit-1' });
    await service.update('visit-1', actor, {});
    const [query] = tx.$queryRaw.mock.calls[0] as [string[]];
    expect(query.join('')).toContain('"organizationId" = ');
    expect(tx.$queryRaw.mock.calls[0]).toContain('org-a');
  });
});

function lockedVisit() {
  return {
    id: 'visit-1',
    assignedUserId: null,
    scheduledAt: new Date('2026-09-10T14:00:00.000Z'),
    durationMinutes: 60,
    status: SalesVisitStatus.AGENDADA,
    outcome: null,
    location: null,
    result: null,
    notes: null,
    cancellationReason: null,
    completedAt: null,
    cancelledAt: null,
  };
}

interface VisitWriteArgs {
  where?: Record<string, unknown>;
  data: Record<string, unknown>;
  include: Record<string, unknown>;
}

interface VisitFindArgs {
  where: Record<string, unknown>;
  include: Record<string, unknown>;
}

function transactionMock() {
  return {
    $queryRaw: jest.fn(),
    opportunity: { findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
    unit: { findFirst: jest.fn() },
    development: { findFirst: jest.fn() },
    salesVisit: {
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
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
