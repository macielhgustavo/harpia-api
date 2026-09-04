import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PersonRoleType, SalesActivityType } from '@prisma/client';
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
      data: { organizationId: string; personId: string };
    };
    expect(activityInput.data.organizationId).toBe('org-a');
    expect(activityInput.data.personId).toBe('person-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.SALES_ACTIVITY_CREATED,
        entityId: 'activity-1',
      }),
      tx,
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
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      Promise.resolve(callback(transaction)),
    ),
    salesPipeline: { findMany: jest.fn() },
    opportunity: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    opportunityStageHistory: { findMany: jest.fn() },
    salesActivity: { findMany: jest.fn(), count: jest.fn() },
  };
}
