/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import {
  MAX_LOST_REASON_LENGTH,
  applyOpportunityStageChange,
} from './opportunity-stage';

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
        lostReason: null,
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
        lostReason: 'forged loss reason',
      },
    });

    const [[call]] = tx.opportunity.update.mock.calls as [
      [
        {
          data: {
            stageId: string;
            stageEnteredAt: Date;
            unitId: string;
            lostReason: string | null;
          };
        },
      ],
    ];
    expect(call.data.unitId).toBe('unit-1');
    expect(call.data.stageId).toBe('stage-won');
    expect(call.data.stageEnteredAt.getUTCFullYear()).toBeGreaterThan(2020);
    expect(call.data.lostReason).toBeNull();
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

  describe('historical preservation of the loss reason', () => {
    const lose = (reason: string, from = 'stage-negotiation') =>
      applyOpportunityStageChange(tx as unknown as Prisma.TransactionClient, {
        organizationId: 'org-a',
        actorUserId: 'user-1',
        opportunity: { id: 'opportunity-1', stageId: from },
        toStage: { id: 'stage-lost', isWon: false, isLost: true },
        lostReason: reason,
      });

    const historyData = () =>
      (tx.opportunityStageHistory.create.mock.calls as unknown[][]).map(
        (call) => (call[0] as { data: { lostReason: string | null } }).data,
      );

    it('writes the reason into the commercial history row of that loss', async () => {
      await lose('  Preço acima do orçamento  ');

      expect(tx.opportunityStageHistory.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-a',
          opportunityId: 'opportunity-1',
          fromStageId: 'stage-negotiation',
          toStageId: 'stage-lost',
          changedByUserId: 'user-1',
          lostReason: 'Preço acima do orçamento',
        },
      });
    });

    it('keeps the historical reason when the opportunity is reopened', async () => {
      await lose('Preço');
      await applyOpportunityStageChange(
        tx as unknown as Prisma.TransactionClient,
        {
          organizationId: 'org-a',
          actorUserId: 'user-1',
          opportunity: { id: 'opportunity-1', stageId: 'stage-lost' },
          toStage: { id: 'stage-qualified', isWon: false, isLost: false },
        },
      );

      // The current state is cleared, the historical row is not rewritten.
      const [, reopen] = tx.opportunity.update.mock.calls as [
        [{ data: { lostReason: string | null } }],
        [{ data: { lostReason: string | null } }],
      ];
      expect(reopen[0].data.lostReason).toBeNull();
      expect(historyData()).toEqual([
        expect.objectContaining({
          toStageId: 'stage-lost',
          lostReason: 'Preço',
        }),
        expect.objectContaining({
          toStageId: 'stage-qualified',
          lostReason: null,
        }),
      ]);
    });

    it('keeps one reason per loss when the opportunity is lost twice', async () => {
      await lose('Sem orçamento', 'stage-qualified');
      await lose('Escolheu concorrente', 'stage-proposal');

      expect(historyData().map((data) => data.lostReason)).toEqual([
        'Sem orçamento',
        'Escolheu concorrente',
      ]);
    });

    it('does not erase a past loss when the opportunity is won later', async () => {
      await lose('Preço');
      await run({
        opportunity: { id: 'opportunity-1', stageId: 'stage-lost' },
      });

      expect(historyData()).toEqual([
        expect.objectContaining({ lostReason: 'Preço' }),
        expect.objectContaining({ toStageId: 'stage-won', lostReason: null }),
      ]);
    });

    it('carries the reason into the loss audit trail', async () => {
      const entries = await lose('Preço acima do orçamento');

      for (const entry of entries) {
        expect(entry.metadata).toEqual({
          fromStageId: 'stage-negotiation',
          toStageId: 'stage-lost',
          lostReason: 'Preço acima do orçamento',
        });
      }
      expect(entries[1].action).toBe(AUDIT_ACTIONS.OPPORTUNITY_LOST);
    });

    it('never puts a loss reason in the audit of a win', async () => {
      const entries = await run({ lostReason: 'não deveria vazar' });

      for (const entry of entries) {
        expect(entry.metadata).not.toHaveProperty('lostReason');
      }
      expect(historyData()[0].lostReason).toBeNull();
    });

    it('never lets caller metadata forge the canonical audit fields', async () => {
      const entries = await lose('Preço');
      tx.opportunityStageHistory.create.mockClear();

      const forged = await applyOpportunityStageChange(
        tx as unknown as Prisma.TransactionClient,
        {
          organizationId: 'org-a',
          actorUserId: 'user-1',
          opportunity: { id: 'opportunity-1', stageId: 'stage-negotiation' },
          toStage: { id: 'stage-lost', isWon: false, isLost: true },
          lostReason: 'Preço',
          auditMetadata: {
            fromStageId: 'forged',
            toStageId: 'forged',
            lostReason: 'forjado',
          },
        },
      );

      expect(entries[0].metadata).toEqual(forged[0].metadata);
      expect(forged[0].metadata).toEqual({
        fromStageId: 'stage-negotiation',
        toStageId: 'stage-lost',
        lostReason: 'Preço',
      });
    });

    it('trims and caps the reason so no caller can persist an unbounded text', async () => {
      const entries = await lose(
        `  ${'x'.repeat(MAX_LOST_REASON_LENGTH + 250)}  `,
      );

      const persisted = historyData()[0].lostReason;
      expect(persisted).toHaveLength(MAX_LOST_REASON_LENGTH);
      expect(tx.opportunity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lostReason: persisted }),
        }),
      );
      expect(entries[1].metadata?.lostReason).toBe(persisted);
    });

    it('uses the same character limit as DTO validation for Unicode text', async () => {
      await lose('🦅'.repeat(MAX_LOST_REASON_LENGTH + 1));

      expect([...historyData()[0].lostReason!]).toHaveLength(
        MAX_LOST_REASON_LENGTH,
      );
    });

    it.each([undefined, null, '', '   '])(
      'rejects a lost stage without a usable reason (%p)',
      async (lostReason) => {
        await expect(
          applyOpportunityStageChange(
            tx as unknown as Prisma.TransactionClient,
            {
              organizationId: 'org-a',
              actorUserId: 'user-1',
              opportunity,
              toStage: { id: 'stage-lost', isWon: false, isLost: true },
              lostReason,
            },
          ),
        ).rejects.toThrow(
          'Informe o motivo ao marcar a oportunidade como perdida',
        );

        expect(tx.opportunity.update).not.toHaveBeenCalled();
        expect(tx.opportunityStageHistory.create).not.toHaveBeenCalled();
      },
    );
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
