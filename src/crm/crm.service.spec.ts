/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PersonRoleType,
  SalesActivityPriority,
  SalesActivityStatus,
  SalesActivityType,
  SalesVisitStatus,
} from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CrmService } from './crm.service';

describe('CrmService', () => {
  const actor = { id: 'user-1', organizationId: 'org-a' };
  let tx: ReturnType<typeof createTransactionMock>;
  let prisma: ReturnType<typeof createPrismaMock>;
  let audit: { record: jest.Mock; recordMany: jest.Mock };
  let service: CrmService;

  beforeEach(() => {
    tx = createTransactionMock();
    prisma = createPrismaMock(tx);
    audit = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      recordMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    service = new CrmService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  it('creates an opportunity and promotes its person to lead atomically', async () => {
    tx.person.findFirst.mockResolvedValue({ id: 'person-1' });
    tx.salesPipeline.findFirst.mockResolvedValue({ id: 'pipeline-1' });
    tx.salesStage.findFirst.mockResolvedValue({
      id: 'stage-1',
      isWon: false,
      isLost: false,
      defaultProbability: 15,
    });
    tx.user.findFirst.mockResolvedValue({ id: 'user-2' });
    tx.development.findFirst.mockResolvedValue({ id: 'development-1' });
    tx.opportunity.create.mockResolvedValue({ id: 'opportunity-1' });

    await service.createOpportunity(actor, {
      personId: 'person-1',
      pipelineId: 'pipeline-1',
      assignedUserId: 'user-2',
      developmentId: 'development-1',
      estimatedValue: '125000.50',
    });

    expect(tx.opportunity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ probability: 15 }),
      }),
    );

    expect(tx.person.findFirst).toHaveBeenCalledWith({
      where: { id: 'person-1', organizationId: 'org-a' },
      select: { id: true },
    });
    const roleCalls = tx.personRole.upsert.mock.calls as unknown[][];
    const roleInput = roleCalls[0][0] as {
      where: { personId_role: { personId: string; role: PersonRoleType } };
      create: { organizationId: string };
    };
    expect(roleInput.where.personId_role).toEqual({
      personId: 'person-1',
      role: PersonRoleType.LEAD,
    });
    expect(roleInput.create.organizationId).toBe('org-a');
    const historyCalls = tx.opportunityStageHistory.create.mock
      .calls as unknown[][];
    const initialHistory = historyCalls[0][0] as {
      data: {
        organizationId: string;
        opportunityId: string;
        toStageId: string;
      };
    };
    expect(initialHistory.data).toEqual(
      expect.objectContaining({
        organizationId: 'org-a',
        opportunityId: 'opportunity-1',
        toStageId: 'stage-1',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.OPPORTUNITY_CREATED,
        entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY,
        entityId: 'opportunity-1',
      }),
      tx,
    );
  });

  it('rejects a person from another organization before writing', async () => {
    tx.person.findFirst.mockResolvedValue(null);

    await expect(
      service.createOpportunity(actor, {
        personId: 'person-other-tenant',
        pipelineId: 'pipeline-1',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.opportunity.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects an inactive or cross-tenant assigned user', async () => {
    tx.person.findFirst.mockResolvedValue({ id: 'person-1' });
    tx.salesPipeline.findFirst.mockResolvedValue({ id: 'pipeline-1' });
    tx.salesStage.findFirst.mockResolvedValue({
      id: 'stage-1',
      isWon: false,
      isLost: false,
    });
    tx.user.findFirst.mockResolvedValue(null);

    await expect(
      service.createOpportunity(actor, {
        personId: 'person-1',
        pipelineId: 'pipeline-1',
        assignedUserId: 'user-other-tenant',
      }),
    ).rejects.toThrow('Responsável inválido para esta organização');

    expect(tx.personRole.upsert).not.toHaveBeenCalled();
    expect(tx.opportunity.create).not.toHaveBeenCalled();
  });

  it('moves an opportunity, persists history, and audits a win', async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'opportunity-1',
        personId: 'person-1',
        pipelineId: 'pipeline-1',
        stageId: 'stage-old',
        assignedUserId: null,
        developmentId: null,
        unitId: null,
      },
    ]);
    tx.salesStage.findFirst.mockResolvedValue({
      id: 'stage-won',
      pipelineId: 'pipeline-1',
      isWon: true,
      isLost: false,
    });
    tx.opportunity.update.mockResolvedValue({ id: 'opportunity-1' });

    await service.moveOpportunity('opportunity-1', actor, {
      stageId: 'stage-won',
    });

    expect(tx.opportunity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stageId: 'stage-won',
          stageEnteredAt: expect.any(Date),
        }),
      }),
    );

    expect(tx.salesStage.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'stage-won',
        organizationId: 'org-a',
        pipelineId: 'pipeline-1',
      },
    });
    expect(tx.opportunityStageHistory.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-a',
        opportunityId: 'opportunity-1',
        fromStageId: 'stage-old',
        toStageId: 'stage-won',
        changedByUserId: 'user-1',
        lostReason: null,
      },
    });
    expect(audit.recordMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          action: AUDIT_ACTIONS.OPPORTUNITY_STAGE_CHANGED,
        }),
        expect.objectContaining({ action: AUDIT_ACTIONS.OPPORTUNITY_WON }),
      ],
      tx,
    );
  });

  it('requires a reason when moving to a lost stage', async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'opportunity-1',
        pipelineId: 'pipeline-1',
        stageId: 'stage-old',
      },
    ]);
    tx.salesStage.findFirst.mockResolvedValue({
      id: 'stage-lost',
      isWon: false,
      isLost: true,
    });

    await expect(
      service.moveOpportunity('opportunity-1', actor, {
        stageId: 'stage-lost',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.opportunity.update).not.toHaveBeenCalled();
    expect(audit.recordMany).not.toHaveBeenCalled();
  });

  it('keeps the stage entry timestamp untouched when the target stage is the current one', async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'opportunity-1',
        personId: 'person-1',
        pipelineId: 'pipeline-1',
        stageId: 'stage-current',
        assignedUserId: null,
        developmentId: null,
        unitId: null,
      },
    ]);
    tx.salesStage.findFirst.mockResolvedValue({
      id: 'stage-current',
      pipelineId: 'pipeline-1',
      isWon: false,
      isLost: false,
    });
    tx.opportunity.findUniqueOrThrow.mockResolvedValue({
      id: 'opportunity-1',
      stageId: 'stage-current',
    });

    await service.moveOpportunity('opportunity-1', actor, {
      stageId: 'stage-current',
    });

    expect(tx.opportunity.update).not.toHaveBeenCalled();
    expect(tx.opportunityStageHistory.create).not.toHaveBeenCalled();
    expect(audit.recordMany).not.toHaveBeenCalled();
  });

  it('creates a tenant-scoped activity for the opportunity person', async () => {
    tx.opportunity.findFirst.mockResolvedValue({
      id: 'opportunity-1',
      personId: 'person-1',
    });
    tx.salesActivity.create.mockResolvedValue({ id: 'activity-1' });

    await service.createActivity(actor, {
      opportunityId: 'opportunity-1',
      type: SalesActivityType.LIGACAO,
      summary: 'Retorno comercial',
    });

    expect(tx.opportunity.findFirst).toHaveBeenCalledWith({
      where: { id: 'opportunity-1', organizationId: 'org-a' },
      select: { id: true, personId: true },
    });
    const activityCalls = tx.salesActivity.create.mock.calls as unknown[][];
    const activityInput = activityCalls[0][0] as {
      data: {
        organizationId: string;
        personId: string;
        status: SalesActivityStatus;
      };
    };
    expect(activityInput.data.organizationId).toBe('org-a');
    expect(activityInput.data.personId).toBe('person-1');
    expect(activityInput.data.status).toBe(SalesActivityStatus.PENDENTE);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.SALES_ACTIVITY_CREATED,
        entityId: 'activity-1',
      }),
      tx,
    );
  });

  it('completes an activity with a consistent status and timestamp', async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        id: 'activity-1',
        assignedUserId: null,
        status: SalesActivityStatus.PENDENTE,
        scheduledAt: null,
        completedAt: null,
      },
    ]);
    tx.salesActivity.update.mockResolvedValue({ id: 'activity-1' });

    await service.updateActivity('activity-1', actor, {
      status: SalesActivityStatus.CONCLUIDA,
      priority: SalesActivityPriority.ALTA,
      result: 'Cliente confirmou interesse.',
    });

    expect(tx.salesActivity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SalesActivityStatus.CONCLUIDA,
          priority: SalesActivityPriority.ALTA,
          completedAt: expect.any(Date),
          result: 'Cliente confirmou interesse.',
        }),
      }),
    );
  });

  it('fails closed when a locked opportunity is not in the tenant', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      service.removeOpportunity('opportunity-other-tenant', actor),
    ).rejects.toThrow(NotFoundException);

    expect(tx.opportunity.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('paginates and scopes opportunity searches to the organization', async () => {
    tx.salesPipeline.findFirst.mockResolvedValue({
      id: 'pipeline-1',
      stages: [],
    });
    prisma.opportunity.findMany.mockResolvedValue([{ id: 'opportunity-1' }]);
    prisma.opportunity.count.mockResolvedValue(21);

    const result = await service.findOpportunities('org-a', {
      page: 2,
      pageSize: 10,
      search: ' Ana ',
    });

    const listCalls = prisma.opportunity.findMany.mock.calls as unknown[][];
    const listInput = listCalls[0][0] as {
      where: { organizationId: string };
      skip: number;
      take: number;
    };
    expect(listInput.where.organizationId).toBe('org-a');
    expect(listInput.skip).toBe(10);
    expect(listInput.take).toBe(10);
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 10,
      total: 21,
      totalPages: 3,
    });
  });

  it('composes status and openOnly into the activity query without overriding either', async () => {
    prisma.salesActivity.findMany.mockResolvedValue([]);
    prisma.salesActivity.count.mockResolvedValue(0);

    const result = await service.findActivities('org-a', {
      status: SalesActivityStatus.CONCLUIDA,
      openOnly: true,
      page: 1,
      pageSize: 20,
    });

    const listCalls = prisma.salesActivity.findMany.mock.calls as unknown[][];
    const countCalls = prisma.salesActivity.count.mock.calls as unknown[][];
    const listInput = listCalls[0][0] as {
      where: Record<string, unknown>;
      skip: number;
      take: number;
    };
    const countInput = countCalls[0][0] as { where: Record<string, unknown> };
    expect(listInput.where).toEqual({
      organizationId: 'org-a',
      status: { in: [] },
    });
    // The count must share the very same predicate or pagination would lie.
    expect(countInput.where).toEqual(listInput.where);
    expect(listInput.skip).toBe(0);
    expect(listInput.take).toBe(20);
    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  it('keeps the open activity agenda working when only openOnly is sent', async () => {
    prisma.salesActivity.findMany.mockResolvedValue([{ id: 'activity-1' }]);
    prisma.salesActivity.count.mockResolvedValue(1);

    await service.findActivities('org-a', {
      openOnly: true,
      assignedUserId: 'user-1',
    });

    const listCalls = prisma.salesActivity.findMany.mock.calls as unknown[][];
    const listInput = listCalls[0][0] as { where: Record<string, unknown> };
    expect(listInput.where).toEqual({
      organizationId: 'org-a',
      assignedUserId: 'user-1',
      status: {
        in: [SalesActivityStatus.PENDENTE, SalesActivityStatus.EM_ANDAMENTO],
      },
    });
  });

  it('builds a tenant-scoped opportunity timeline in reverse chronology', async () => {
    prisma.opportunity.findFirst.mockResolvedValue({ id: 'opportunity-1' });
    prisma.$queryRaw.mockResolvedValue([
      { id: 'visit:visit-1', occurredAt: new Date('2026-09-03T10:00:00.000Z') },
      {
        id: 'activity:activity-1',
        occurredAt: new Date('2026-09-02T11:00:00.000Z'),
      },
      {
        id: 'stage:history-1',
        occurredAt: new Date('2026-09-01T10:00:00.000Z'),
      },
    ]);
    prisma.opportunityStageHistory.findMany.mockResolvedValue([
      {
        id: 'history-1',
        changedAt: new Date('2026-09-01T10:00:00.000Z'),
        fromStage: null,
        toStage: { name: 'Novo' },
        changedByUser: { id: 'user-1', name: 'Ana' },
      },
    ]);
    prisma.salesActivity.findMany.mockResolvedValue([
      {
        id: 'activity-1',
        type: SalesActivityType.LIGACAO,
        status: SalesActivityStatus.CONCLUIDA,
        summary: 'Contato realizado',
        notes: null,
        result: 'Visita agendada',
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
        completedAt: new Date('2026-09-02T11:00:00.000Z'),
        assignedUser: { id: 'user-1', name: 'Ana' },
      },
    ]);
    prisma.salesVisit.findMany.mockResolvedValue([
      {
        id: 'visit-1',
        scheduledAt: new Date('2026-09-03T10:00:00.000Z'),
        completedAt: null,
        cancelledAt: null,
        status: SalesVisitStatus.AGENDADA,
        result: null,
        notes: 'Conhecer o decorado',
        location: null,
        assignedUser: { id: 'user-1', name: 'Ana' },
        unit: { identifier: '305' },
      },
    ]);
    prisma.unitReservation.findMany.mockResolvedValue([]);
    prisma.salesProposal.findMany.mockResolvedValue([]);
    prisma.sale.findMany.mockResolvedValue([]);

    const timeline = await service.findOpportunityTimeline(
      'opportunity-1',
      'org-a',
    );

    expect(timeline.data.map((item) => item.id)).toEqual([
      'visit:visit-1',
      'activity:activity-1',
      'stage:history-1',
    ]);
    expect(timeline.data[0]).toEqual(
      expect.objectContaining({
        title: 'Visita à unidade 305',
        description: 'Conhecer o decorado',
        status: SalesVisitStatus.AGENDADA,
      }),
    );
    expect(prisma.salesVisit.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['visit-1'] },
        opportunityId: 'opportunity-1',
        organizationId: 'org-a',
      },
      include: {
        assignedUser: { select: { id: true, name: true } },
        unit: { select: { identifier: true } },
      },
    });
    expect(prisma.unitReservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [] },
          opportunityId: 'opportunity-1',
          organizationId: 'org-a',
        },
      }),
    );
  });

  describe('opportunity pagination', () => {
    const date = (day: number) =>
      new Date(`2026-09-${String(day).padStart(2, '0')}T10:00:00.000Z`);
    const stage = (id: string, changedAt: Date) => ({
      id,
      changedAt,
      fromStage: { name: 'Novo' },
      toStage: { name: 'Qualificado', isLost: false },
      lostReason: null,
      changedByUser: { id: 'user-1', name: 'Ana' },
    });

    beforeEach(() => {
      prisma.opportunity.findFirst.mockResolvedValue({ id: 'opportunity-1' });
      prisma.salesActivity.findMany.mockResolvedValue([]);
      prisma.salesVisit.findMany.mockResolvedValue([]);
      prisma.unitReservation.findMany.mockResolvedValue([]);
      prisma.salesProposal.findMany.mockResolvedValue([]);
      prisma.sale.findMany.mockResolvedValue([]);
    });

    it('returns an empty timeline without hydration queries', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      expect(
        await service.findOpportunityTimeline('opportunity-1', 'org-a'),
      ).toEqual({
        data: [],
        nextCursor: null,
      });
      expect(prisma.opportunityStageHistory.findMany).not.toHaveBeenCalled();
    });

    it('keeps all six event types in a timestamp tie', async () => {
      const occurredAt = date(5);
      const ids = [
        'activity:a',
        'proposal:p',
        'reservation:r',
        'sale:s',
        'stage:h',
        'visit:v',
      ];
      prisma.$queryRaw.mockResolvedValue(ids.map((id) => ({ id, occurredAt })));
      prisma.opportunityStageHistory.findMany.mockResolvedValue([
        stage('h', occurredAt),
      ]);
      prisma.salesActivity.findMany.mockResolvedValue([
        {
          id: 'a',
          summary: 'Contato',
          type: SalesActivityType.LIGACAO,
          status: SalesActivityStatus.CONCLUIDA,
          result: null,
          notes: null,
          completedAt: occurredAt,
          createdAt: occurredAt,
          assignedUser: null,
        },
      ]);
      prisma.salesVisit.findMany.mockResolvedValue([
        {
          id: 'v',
          scheduledAt: occurredAt,
          completedAt: null,
          cancelledAt: null,
          status: SalesVisitStatus.AGENDADA,
          result: null,
          notes: null,
          location: null,
          unit: null,
          assignedUser: null,
        },
      ]);
      prisma.unitReservation.findMany.mockResolvedValue([
        {
          id: 'r',
          unit: { identifier: '101' },
          status: 'ATIVA',
          createdByUser: null,
          createdAt: occurredAt,
          convertedAt: null,
          cancelledAt: null,
        },
      ]);
      prisma.salesProposal.findMany.mockResolvedValue([
        {
          id: 'p',
          unit: { identifier: '101' },
          status: 'RASCUNHO',
          createdByUser: null,
          createdAt: occurredAt,
          convertedToSaleAt: null,
          acceptedAt: null,
          rejectedAt: null,
          sentAt: null,
        },
      ]);
      prisma.sale.findMany.mockResolvedValue([
        {
          id: 's',
          saleDate: occurredAt,
          saleNumber: '1',
          unit: { identifier: '101' },
          status: 'ATIVA',
          createdByUser: null,
        },
      ]);

      const page = await service.findOpportunityTimeline(
        'opportunity-1',
        'org-a',
      );
      expect(page.data.map((item) => item.id)).toEqual(ids);
      expect(page.nextCursor).toBeNull();
      for (const source of [
        'activity',
        'visit',
        'reservation',
        'proposal',
        'sale',
      ]) {
        const model = (
          {
            activity: prisma.salesActivity,
            visit: prisma.salesVisit,
            reservation: prisma.unitReservation,
            proposal: prisma.salesProposal,
            sale: prisma.sale,
          } as Record<string, { findMany: jest.Mock }>
        )[source];
        expect(model.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              organizationId: 'org-a',
              opportunityId: 'opportunity-1',
            }),
          }),
        );
      }
    });

    it('pages without gaps or repeats, including tied timestamps and a new event', async () => {
      const rows = [
        stage('a', date(5)),
        stage('b', date(5)),
        stage('c', date(4)),
        stage('d', date(3)),
        stage('e', date(2)),
      ];
      prisma.$queryRaw.mockImplementation((sql: { values: unknown[] }) => {
        const boundary = sql.values.find((value) => value instanceof Date);
        const boundaryId = boundary
          ? (sql.values.find(
              (value) =>
                typeof value === 'string' && value.startsWith('stage:'),
            ) as string)
          : undefined;
        return Promise.resolve(
          rows
            .map((row) => ({
              id: `stage:${row.id}`,
              occurredAt: row.changedAt,
            }))
            .filter(
              (key) =>
                !boundary ||
                key.occurredAt < boundary ||
                (key.occurredAt.getTime() === boundary.getTime() &&
                  key.id > boundaryId!),
            )
            .sort(
              (a, b) =>
                b.occurredAt.getTime() - a.occurredAt.getTime() ||
                (a.id < b.id ? -1 : 1),
            )
            .slice(0, sql.values[sql.values.length - 1] as number),
        );
      });
      prisma.opportunityStageHistory.findMany.mockImplementation(
        ({
          where,
        }: {
          where: {
            id: { in: string[] };
            organizationId: string;
            opportunityId: string;
          };
        }) => {
          expect(where.organizationId).toBe('org-a');
          expect(where.opportunityId).toBe('opportunity-1');
          return Promise.resolve(
            rows.filter((row) => where.id.in.includes(row.id)),
          );
        },
      );

      const first = await service.findOpportunityTimeline(
        'opportunity-1',
        'org-a',
        { limit: 2 },
      );
      expect(first.data.map((item) => item.id)).toEqual(['stage:a', 'stage:b']);
      expect(first.nextCursor).toBeTruthy();
      rows.push(stage('new', date(6)));
      const second = await service.findOpportunityTimeline(
        'opportunity-1',
        'org-a',
        { limit: 2, cursor: first.nextCursor! },
      );
      const third = await service.findOpportunityTimeline(
        'opportunity-1',
        'org-a',
        { limit: 2, cursor: second.nextCursor! },
      );
      expect(
        [...first.data, ...second.data, ...third.data].map((item) => item.id),
      ).toEqual(['stage:a', 'stage:b', 'stage:c', 'stage:d', 'stage:e']);
      expect(third.nextCursor).toBeNull();
    });

    it('returns no cursor for exactly one page and rejects cross-opportunity cursors', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'stage:a', occurredAt: date(5) },
      ]);
      prisma.opportunityStageHistory.findMany.mockResolvedValue([
        stage('a', date(5)),
      ]);
      const page = await service.findOpportunityTimeline(
        'opportunity-1',
        'org-a',
        { limit: 1 },
      );
      expect(page.nextCursor).toBeNull();
      const foreign = Buffer.from(
        JSON.stringify({
          v: 1,
          opportunityId: 'other',
          id: 'stage:a',
          occurredAt: date(5).toISOString(),
        }),
      ).toString('base64url');
      await expect(
        service.findOpportunityTimeline('opportunity-1', 'org-a', {
          cursor: foreign,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('paginates stage history with total and tenant scope', async () => {
      prisma.opportunityStageHistory.findMany.mockResolvedValue([
        stage('c', date(3)),
      ]);
      prisma.opportunityStageHistory.count.mockResolvedValue(5);
      const page = await service.findOpportunityHistory(
        'opportunity-1',
        'org-a',
        { page: 2, pageSize: 2 },
      );
      expect(page.pagination).toEqual({
        page: 2,
        pageSize: 2,
        total: 5,
        totalPages: 3,
      });
      expect(prisma.opportunityStageHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-a', opportunityId: 'opportunity-1' },
          skip: 2,
          take: 2,
          orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        }),
      );
      expect(prisma.opportunityStageHistory.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-a', opportunityId: 'opportunity-1' },
      });
    });

    it('does not query another tenant’s opportunity', async () => {
      prisma.opportunity.findFirst.mockResolvedValue(null);
      await expect(
        service.findOpportunityTimeline('opportunity-1', 'org-b'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.findOpportunityHistory('opportunity-1', 'org-b'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('loss reason', () => {
    const lockOpportunityAt = (stageId: string) =>
      tx.$queryRaw.mockResolvedValue([
        {
          id: 'opportunity-1',
          personId: 'person-1',
          pipelineId: 'pipeline-1',
          stageId,
          assignedUserId: null,
          developmentId: null,
          unitId: null,
        },
      ]);

    const stageIs = (id: string, flags: { isWon: boolean; isLost: boolean }) =>
      tx.salesStage.findFirst.mockResolvedValue({
        id,
        pipelineId: 'pipeline-1',
        ...flags,
      });

    const historyData = () =>
      (tx.opportunityStageHistory.create.mock.calls as unknown[][]).map(
        (call) => (call[0] as { data: Record<string, unknown> }).data,
      );

    const updatedData = () =>
      (tx.opportunity.update.mock.calls as unknown[][]).map(
        (call) => (call[0] as { data: Record<string, unknown> }).data,
      );

    const auditedEntries = () =>
      (audit.recordMany.mock.calls as unknown[][]).flatMap(
        (call) =>
          call[0] as { action: string; metadata: Record<string, unknown> }[],
      );

    beforeEach(() => {
      tx.opportunity.update.mockResolvedValue({ id: 'opportunity-1' });
      tx.opportunity.findUniqueOrThrow.mockResolvedValue({
        id: 'opportunity-1',
      });
    });

    it('records the reason in the commercial history when losing', async () => {
      lockOpportunityAt('stage-negotiation');
      stageIs('stage-lost', { isWon: false, isLost: true });

      await service.moveOpportunity('opportunity-1', actor, {
        stageId: 'stage-lost',
        lostReason: 'Preço acima do orçamento',
      });

      expect(historyData()[0]).toEqual({
        organizationId: 'org-a',
        opportunityId: 'opportunity-1',
        fromStageId: 'stage-negotiation',
        toStageId: 'stage-lost',
        changedByUserId: 'user-1',
        lostReason: 'Preço acima do orçamento',
      });
      const entries = auditedEntries();
      expect(entries.map((entry) => entry.action)).toEqual([
        AUDIT_ACTIONS.OPPORTUNITY_STAGE_CHANGED,
        AUDIT_ACTIONS.OPPORTUNITY_LOST,
      ]);
      expect(entries[1].metadata).toEqual({
        fromStageId: 'stage-negotiation',
        toStageId: 'stage-lost',
        lostReason: 'Preço acima do orçamento',
      });
    });

    it('clears only the current state when the opportunity is reopened', async () => {
      lockOpportunityAt('stage-lost');
      stageIs('stage-qualified', { isWon: false, isLost: false });

      await service.moveOpportunity('opportunity-1', actor, {
        stageId: 'stage-qualified',
      });

      expect(updatedData()[0].lostReason).toBeNull();
      // The reopening writes its own row; the losing row is never touched.
      expect(historyData()[0].lostReason).toBeNull();
      expect(tx.opportunityStageHistory.create).toHaveBeenCalledTimes(1);
    });

    it('never writes a loss reason when the opportunity is won', async () => {
      lockOpportunityAt('stage-negotiation');
      stageIs('stage-won', { isWon: true, isLost: false });

      await service.moveOpportunity('opportunity-1', actor, {
        stageId: 'stage-won',
        lostReason: 'não deveria vazar',
      });

      expect(historyData()[0].lostReason).toBeNull();
      expect(updatedData()[0].lostReason).toBeNull();
      for (const entry of auditedEntries()) {
        expect(entry.metadata).not.toHaveProperty('lostReason');
      }
    });

    it('fails closed before recording a loss for another tenant', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(
        service.moveOpportunity('opportunity-other-tenant', actor, {
          stageId: 'stage-lost',
          lostReason: 'Preço',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(tx.opportunityStageHistory.create).not.toHaveBeenCalled();
      expect(audit.recordMany).not.toHaveBeenCalled();
    });

    it('reads the commercial history only inside the tenant', async () => {
      prisma.opportunity.findFirst.mockResolvedValue({ id: 'opportunity-1' });
      prisma.opportunityStageHistory.findMany.mockResolvedValue([]);
      prisma.opportunityStageHistory.count.mockResolvedValue(0);

      await service.findOpportunityHistory('opportunity-1', 'org-a');

      expect(prisma.opportunityStageHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { opportunityId: 'opportunity-1', organizationId: 'org-a' },
        }),
      );
    });

    it('shows every past loss in the timeline, even after a later win', async () => {
      prisma.opportunity.findFirst.mockResolvedValue({ id: 'opportunity-1' });
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'stage:history-won',
          occurredAt: new Date('2026-09-05T10:00:00.000Z'),
        },
        {
          id: 'stage:history-lost',
          occurredAt: new Date('2026-09-01T10:00:00.000Z'),
        },
      ]);
      prisma.opportunityStageHistory.findMany.mockResolvedValue([
        {
          id: 'history-lost',
          changedAt: new Date('2026-09-01T10:00:00.000Z'),
          fromStage: { name: 'Qualificado' },
          toStage: { name: 'Perdido', isLost: true },
          lostReason: 'Preço acima do orçamento',
          changedByUser: { id: 'user-1', name: 'Ana' },
        },
        {
          id: 'history-won',
          changedAt: new Date('2026-09-05T10:00:00.000Z'),
          fromStage: { name: 'Negociação' },
          toStage: { name: 'Ganho', isLost: false },
          lostReason: null,
          changedByUser: { id: 'user-1', name: 'Ana' },
        },
      ]);
      prisma.salesActivity.findMany.mockResolvedValue([]);
      prisma.salesVisit.findMany.mockResolvedValue([]);
      prisma.unitReservation.findMany.mockResolvedValue([]);
      prisma.salesProposal.findMany.mockResolvedValue([]);
      prisma.sale.findMany.mockResolvedValue([]);

      const timeline = await service.findOpportunityTimeline(
        'opportunity-1',
        'org-a',
      );

      const lost = timeline.data.find(
        (item) => item.id === 'stage:history-lost',
      )!;
      expect(lost.title).toBe('Oportunidade marcada como perdida');
      expect(lost.description).toBe(
        'Movida de Qualificado para Perdido. Motivo: Preço acima do orçamento',
      );

      const won = timeline.data.find(
        (item) => item.id === 'stage:history-won',
      )!;
      expect(won.title).toBe('Etapa alterada para Ganho');
      expect(won.description).toBe('Movida de Negociação para Ganho.');
    });
  });
});

function createTransactionMock() {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn(),
    salesPipeline: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    salesStage: { findFirst: jest.fn() },
    person: { findFirst: jest.fn() },
    personRole: { upsert: jest.fn() },
    user: { findFirst: jest.fn() },
    development: { findFirst: jest.fn() },
    unit: { findFirst: jest.fn() },
    opportunity: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    opportunityStageHistory: { create: jest.fn() },
    salesActivity: {
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
    $queryRaw: jest.fn(),
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      Promise.resolve(callback(transaction)),
    ),
    salesPipeline: { findMany: jest.fn(), findFirst: jest.fn() },
    opportunity: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      groupBy: jest.fn(),
    },
    opportunityStageHistory: { findMany: jest.fn(), count: jest.fn() },
    salesActivity: { findMany: jest.fn(), count: jest.fn() },
    salesVisit: { findMany: jest.fn() },
    unitReservation: { findMany: jest.fn() },
    salesProposal: { findMany: jest.fn() },
    sale: { findMany: jest.fn() },
  };
}
