/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { applyOpportunityStageChange } from './opportunity-stage';

describe('applyOpportunityStageChange', () => {
  const opportunity = { id: 'opportunity-1', stageId: 'stage-negotiation' };
  let tx: {
    opportunity: { update: jest.Mock };
    opportunityStageHistory: { create: jest.Mock };
  };

  beforeEach(() => {
    tx = {
      opportunity: { update: jest.fn() },
      opportunityStageHistory: { create: jest.fn() },
    };
  });

  const run = (
    change: Partial<Parameters<typeof applyOpportunityStageChange>[1]> = {},
  ) =>
    applyOpportunityStageChange(tx as unknown as Prisma.TransactionClient, {
      organizationId: 'org-a',
      actorUserId: 'user-1',
      opportunity,
      toStage: { id: 'stage-won', isWon: true, isLost: false },
      ...change,
    });

  it('stamps the stage entry timestamp and records the commercial history', async () => {
    const before = Date.now();

    const entries = await run();

    const [[call]] = tx.opportunity.update.mock.calls as [
      [
        {
          where: { id: string };
          data: { stageId: string; stageEnteredAt: Date };
        },
      ],
    ];
    expect(call.where).toEqual({ id: 'opportunity-1' });
    expect(call.data.stageId).toBe('stage-won');
    expect(call.data.stageEnteredAt).toBeInstanceOf(Date);
    expect(call.data.stageEnteredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(tx.opportunityStageHistory.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-a',
        opportunityId: 'opportunity-1',
        fromStageId: 'stage-negotiation',
        toStageId: 'stage-won',
        changedByUserId: 'user-1',
      },
    });
    expect(entries).toEqual([
      expect.objectContaining({
        organizationId: 'org-a',
        actorUserId: 'user-1',
        action: AUDIT_ACTIONS.OPPORTUNITY_STAGE_CHANGED,
        entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY,
        entityId: 'opportunity-1',
      }),
      expect.objectContaining({ action: AUDIT_ACTIONS.OPPORTUNITY_WON }),
    ]);
  });

  it('writes nothing when the opportunity already sits in the target stage', async () => {
    const entries = await applyOpportunityStageChange(
      tx as unknown as Prisma.TransactionClient,
      {
        organizationId: 'org-a',
        actorUserId: 'user-1',
        opportunity: { id: 'opportunity-1', stageId: 'stage-won' },
        toStage: { id: 'stage-won', isWon: true, isLost: false },
      },
    );

    expect(entries).toEqual([]);
    expect(tx.opportunity.update).not.toHaveBeenCalled();
    expect(tx.opportunityStageHistory.create).not.toHaveBeenCalled();
  });

  it('never lets additional columns override the stage invariants', async () => {
    await run({
      additionalData: {
        unitId: 'unit-1',
        stageId: 'stage-forged',
        stageEnteredAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });

    const [[call]] = tx.opportunity.update.mock.calls as [
      [{ data: { stageId: string; stageEnteredAt: Date; unitId: string } }],
    ];
    expect(call.data.unitId).toBe('unit-1');
    expect(call.data.stageId).toBe('stage-won');
    expect(call.data.stageEnteredAt.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('persists the loss reason only for a lost stage and audits the loss', async () => {
    const entries = await run({
      toStage: { id: 'stage-lost', isWon: false, isLost: true },
      lostReason: '  sem orçamento  ',
    });

    expect(tx.opportunity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lostReason: 'sem orçamento' }),
      }),
    );
    expect(entries).toHaveLength(2);
    expect(entries[1].action).toBe(AUDIT_ACTIONS.OPPORTUNITY_LOST);
  });

  it('clears the loss reason and emits a single event on a non terminal stage', async () => {
    const entries = await run({
      toStage: { id: 'stage-qualified', isWon: false, isLost: false },
      lostReason: 'ignorado',
    });

    expect(tx.opportunity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lostReason: null }),
      }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe(AUDIT_ACTIONS.OPPORTUNITY_STAGE_CHANGED);
  });

  it('carries the caller metadata and tenant into every entry', async () => {
    const entries = await run({
      organizationId: 'org-b',
      auditMetadata: { proposalId: 'proposal-1' },
    });

    for (const entry of entries) {
      expect(entry.organizationId).toBe('org-b');
      expect(entry.metadata).toEqual({
        fromStageId: 'stage-negotiation',
        toStageId: 'stage-won',
        proposalId: 'proposal-1',
      });
    }
    expect(tx.opportunityStageHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org-b' }),
    });
  });
});
