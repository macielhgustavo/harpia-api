/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CrmService } from './crm.service';

type Bucket = {
  stageId: string;
  probability: number | null;
  _count: { _all: number };
  _sum: { estimatedValue: Prisma.Decimal | null };
};

const bucket = (
  stageId: string,
  probability: number | null,
  count: number,
  sum: string | null,
): Bucket => ({
  stageId,
  probability,
  _count: { _all: count },
  _sum: { estimatedValue: sum === null ? null : new Prisma.Decimal(sum) },
});

const STAGES = [
  {
    id: 'stage-negotiation',
    name: 'Negociação',
    position: 0,
    defaultProbability: 85,
    isWon: false,
    isLost: false,
  },
  {
    id: 'stage-won',
    name: 'Ganho',
    position: 1,
    defaultProbability: 100,
    isWon: true,
    isLost: false,
  },
];

describe('CrmService.findBoard', () => {
  let prisma: {
    $transaction: jest.Mock;
    salesPipeline: { findFirst: jest.Mock };
    opportunity: { findMany: jest.Mock; groupBy: jest.Mock };
  };
  let service: CrmService;

  const pipeline = {
    id: 'pipeline-1',
    name: 'Pipeline comercial',
    isDefault: true,
    stages: STAGES,
  };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
      salesPipeline: { findFirst: jest.fn().mockResolvedValue(pipeline) },
      opportunity: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    service = new CrmService(
      prisma as unknown as PrismaService,
      { record: jest.fn(), recordMany: jest.fn() } as unknown as AuditService,
    );
  });

  /** Rows returned for the page of a given stage. */
  function pageFor(pages: Record<string, unknown[]>) {
    prisma.opportunity.findMany.mockImplementation(
      ({ where }: { where: { stageId: string } }) =>
        Promise.resolve(pages[where.stageId] ?? []),
    );
  }

  it('reports a stage that fits in a single page as complete', async () => {
    prisma.opportunity.groupBy.mockResolvedValue([
      bucket('stage-negotiation', 50, 2, '1000.00'),
    ]);
    pageFor({ 'stage-negotiation': [{ id: 'a' }, { id: 'b' }] });

    const board = await service.findBoard('org-a', {
      pipelineId: 'pipeline-1',
      stageLimit: 20,
    });

    const stage = board.stages[0];
    expect(stage.summary.total).toBe(2);
    expect(stage.summary.loaded).toBe(2);
    expect(stage.summary.hasMore).toBe(false);
    expect(stage.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
    });
  });

  it('reports more records than the page holds', async () => {
    prisma.opportunity.groupBy.mockResolvedValue([
      bucket('stage-negotiation', 50, 87, '14350000.00'),
    ]);
    pageFor({
      'stage-negotiation': Array.from({ length: 20 }, (_, index) => ({
        id: `opportunity-${index}`,
      })),
    });

    const board = await service.findBoard('org-a', {
      pipelineId: 'pipeline-1',
      stageLimit: 20,
    });

    expect(board.stages[0].summary).toEqual(
      jasmineLike({
        total: 87,
        loaded: 20,
        hasMore: true,
        estimatedValue: '14350000.00',
      }),
    );
    expect(board.stages[0].pagination.totalPages).toBe(5);
  });

  it('sums money over every record, not only the loaded page', async () => {
    prisma.opportunity.groupBy.mockResolvedValue([
      bucket('stage-negotiation', 50, 2, '1000.55'),
      bucket('stage-negotiation', 20, 3, '2000.45'),
    ]);
    pageFor({ 'stage-negotiation': [{ id: 'only-one-loaded' }] });

    const board = await service.findBoard('org-a', {
      pipelineId: 'pipeline-1',
      stageLimit: 20,
    });

    expect(board.stages[0].summary.total).toBe(5);
    expect(board.stages[0].summary.loaded).toBe(1);
    expect(board.stages[0].summary.estimatedValue).toBe('3001.00');
  });

  it('weights each bucket by its own probability without floating point', async () => {
    prisma.opportunity.groupBy.mockResolvedValue([
      bucket('stage-negotiation', 50, 1, '1000.00'),
      bucket('stage-negotiation', 10, 1, '0.10'),
    ]);

    const board = await service.findBoard('org-a', {
      pipelineId: 'pipeline-1',
      stageLimit: 0,
    });

    // 1000.00 * 0.5 + 0.10 * 0.1 = 500.01 exactly.
    expect(board.stages[0].summary.weightedValue).toBe('500.01');
  });

  it('falls back to the stage probability when the opportunity has none', async () => {
    prisma.opportunity.groupBy.mockResolvedValue([
      bucket('stage-negotiation', null, 1, '200.00'),
    ]);

    const board = await service.findBoard('org-a', {
      pipelineId: 'pipeline-1',
      stageLimit: 0,
    });

    // Stage default is 85%.
    expect(board.stages[0].summary.weightedValue).toBe('170.00');
  });

  it('treats a missing money sum as zero', async () => {
    prisma.opportunity.groupBy.mockResolvedValue([
      bucket('stage-negotiation', 50, 3, null),
    ]);

    const board = await service.findBoard('org-a', {
      pipelineId: 'pipeline-1',
      stageLimit: 0,
    });

    expect(board.stages[0].summary.total).toBe(3);
    expect(board.stages[0].summary.estimatedValue).toBe('0.00');
    expect(board.stages[0].summary.weightedValue).toBe('0.00');
  });

  it('returns an empty stage with zeroed aggregates', async () => {
    prisma.opportunity.groupBy.mockResolvedValue([
      bucket('stage-negotiation', 50, 1, '10.00'),
    ]);

    const board = await service.findBoard('org-a', {
      pipelineId: 'pipeline-1',
      stageLimit: 20,
    });

    const won = board.stages[1];
    expect(won.stage.id).toBe('stage-won');
    expect(won.summary).toEqual(
      jasmineLike({
        total: 0,
        loaded: 0,
        hasMore: false,
        estimatedValue: '0.00',
        weightedValue: '0.00',
      }),
    );
    expect(won.opportunities).toEqual([]);
  });

  it('consolidates the pipeline totals across stages', async () => {
    prisma.opportunity.groupBy.mockResolvedValue([
      bucket('stage-negotiation', 50, 2, '100.00'),
      bucket('stage-won', 100, 1, '900.00'),
    ]);

    const board = await service.findBoard('org-a', {
      pipelineId: 'pipeline-1',
      stageLimit: 0,
    });

    expect(board.summary.total).toBe(3);
    expect(board.summary.estimatedValue).toBe('1000.00');
    expect(board.summary.weightedValue).toBe('950.00');
  });

  describe('filters and tenancy', () => {
    it('applies the same predicate to the aggregate and to every page', async () => {
      await service.findBoard('org-a', {
        pipelineId: 'pipeline-1',
        assignedUserId: 'user-1',
        developmentId: 'development-1',
        search: '  Ana  ',
        stageLimit: 20,
      });

      const aggregateWhere = prisma.opportunity.groupBy.mock.calls[0][0].where;
      expect(aggregateWhere).toEqual(
        jasmineLike({
          organizationId: 'org-a',
          pipelineId: 'pipeline-1',
          assignedUserId: 'user-1',
          developmentId: 'development-1',
        }),
      );
      expect(aggregateWhere.OR).toBeDefined();

      for (const call of prisma.opportunity.findMany.mock.calls) {
        const { stageId, ...rest } = call[0].where;
        expect(stageId).toBeDefined();
        expect(rest).toEqual(aggregateWhere);
      }
    });

    it('never lets the caller reach another tenant', async () => {
      await service.findBoard('org-a', {
        pipelineId: 'pipeline-1',
        organizationId: 'org-b',
      } as never);

      expect(prisma.salesPipeline.findFirst.mock.calls[0][0].where).toEqual({
        id: 'pipeline-1',
        organizationId: 'org-a',
        isActive: true,
      });
      expect(
        prisma.opportunity.groupBy.mock.calls[0][0].where.organizationId,
      ).toBe('org-a');
    });

    it('refuses a pipeline from another tenant', async () => {
      prisma.salesPipeline.findFirst.mockResolvedValue(null);

      await expect(
        service.findBoard('org-a', { pipelineId: 'pipeline-of-org-b' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('stage pagination', () => {
    it('orders every stage page deterministically and honours the limit', async () => {
      await service.findBoard('org-a', {
        pipelineId: 'pipeline-1',
        stageLimit: 5,
      });

      for (const call of prisma.opportunity.findMany.mock.calls) {
        expect(call[0].take).toBe(5);
        expect(call[0].orderBy).toEqual([
          { updatedAt: 'desc' },
          { id: 'desc' },
        ]);
      }
    });

    it('asks for one page per stage, never a single unbounded query', async () => {
      await service.findBoard('org-a', {
        pipelineId: 'pipeline-1',
        stageLimit: 20,
      });

      expect(prisma.opportunity.findMany).toHaveBeenCalledTimes(STAGES.length);
      expect(prisma.opportunity.groupBy).toHaveBeenCalledTimes(1);
    });

    it('skips the row queries entirely when only summaries are requested', async () => {
      prisma.opportunity.groupBy.mockResolvedValue([
        bucket('stage-negotiation', 50, 40, '400.00'),
      ]);

      const board = await service.findBoard('org-a', {
        pipelineId: 'pipeline-1',
        stageLimit: 0,
      });

      expect(prisma.opportunity.findMany).not.toHaveBeenCalled();
      expect(board.stages[0].summary.total).toBe(40);
      expect(board.stages[0].summary.loaded).toBe(0);
      expect(board.stages[0].summary.hasMore).toBe(true);
    });
  });
});

/** Small helper so object assertions stay readable. */
function jasmineLike(value: object): jest.AsymmetricMatcher {
  return expect.objectContaining(value) as jest.AsymmetricMatcher;
}
