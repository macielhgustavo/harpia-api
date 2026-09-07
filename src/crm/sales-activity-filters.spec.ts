import {
  SalesActivityPriority,
  SalesActivityStatus,
  SalesActivityType,
} from '@prisma/client';
import { ListSalesActivitiesQueryDto } from './dto/list-sales-activities-query.dto';
import {
  OPEN_SALES_ACTIVITY_STATUSES,
  buildSalesActivityStatusFilter,
  buildSalesActivityWhere,
} from './sales-activity-filters';

const OPEN = [...OPEN_SALES_ACTIVITY_STATUSES];

const query = (
  overrides: Partial<ListSalesActivitiesQueryDto> = {},
): ListSalesActivitiesQueryDto => ({ ...overrides });

describe('buildSalesActivityStatusFilter', () => {
  it('treats only PENDENTE and EM_ANDAMENTO as open', () => {
    expect(OPEN).toEqual([
      SalesActivityStatus.PENDENTE,
      SalesActivityStatus.EM_ANDAMENTO,
    ]);
  });

  it('pins the exact status when only status is requested', () => {
    expect(
      buildSalesActivityStatusFilter(SalesActivityStatus.CONCLUIDA, undefined),
    ).toBe(SalesActivityStatus.CONCLUIDA);
  });

  it('narrows to every open status when only openOnly is requested', () => {
    expect(buildSalesActivityStatusFilter(undefined, true)).toEqual({
      in: OPEN,
    });
  });

  it('intersects both filters when the requested status is open', () => {
    expect(
      buildSalesActivityStatusFilter(SalesActivityStatus.PENDENTE, true),
    ).toEqual({ in: [SalesActivityStatus.PENDENTE] });
    expect(
      buildSalesActivityStatusFilter(SalesActivityStatus.EM_ANDAMENTO, true),
    ).toEqual({ in: [SalesActivityStatus.EM_ANDAMENTO] });
  });

  it('yields an unsatisfiable predicate for a closed status with openOnly', () => {
    expect(
      buildSalesActivityStatusFilter(SalesActivityStatus.CONCLUIDA, true),
    ).toEqual({ in: [] });
    expect(
      buildSalesActivityStatusFilter(SalesActivityStatus.CANCELADA, true),
    ).toEqual({ in: [] });
  });

  it('applies no status predicate when neither filter is requested', () => {
    expect(
      buildSalesActivityStatusFilter(undefined, undefined),
    ).toBeUndefined();
    expect(buildSalesActivityStatusFilter(undefined, false)).toBeUndefined();
  });

  it('ignores openOnly=false and keeps the explicit status', () => {
    expect(
      buildSalesActivityStatusFilter(SalesActivityStatus.CONCLUIDA, false),
    ).toBe(SalesActivityStatus.CONCLUIDA);
  });
});

describe('buildSalesActivityWhere', () => {
  it('scopes to the session tenant and applies no other predicate by default', () => {
    expect(buildSalesActivityWhere('org-a', query())).toEqual({
      organizationId: 'org-a',
    });
  });

  it('never lets the caller query another tenant', () => {
    const where = buildSalesActivityWhere(
      'org-a',
      query({
        organizationId: 'org-b',
      } as Partial<ListSalesActivitiesQueryDto>),
    );

    expect(where.organizationId).toBe('org-a');
    expect(Object.keys(where)).toEqual(['organizationId']);
  });

  it('filters by the exact status when openOnly is absent', () => {
    expect(
      buildSalesActivityWhere(
        'org-a',
        query({ status: SalesActivityStatus.CONCLUIDA }),
      ),
    ).toEqual({
      organizationId: 'org-a',
      status: SalesActivityStatus.CONCLUIDA,
    });
  });

  it('filters by every open status when only openOnly is sent', () => {
    expect(buildSalesActivityWhere('org-a', query({ openOnly: true }))).toEqual(
      { organizationId: 'org-a', status: { in: OPEN } },
    );
  });

  it('combines status=PENDENTE with openOnly instead of overriding it', () => {
    expect(
      buildSalesActivityWhere(
        'org-a',
        query({ status: SalesActivityStatus.PENDENTE, openOnly: true }),
      ),
    ).toEqual({
      organizationId: 'org-a',
      status: { in: [SalesActivityStatus.PENDENTE] },
    });
  });

  it('returns an unsatisfiable predicate for status=CONCLUIDA with openOnly', () => {
    expect(
      buildSalesActivityWhere(
        'org-a',
        query({ status: SalesActivityStatus.CONCLUIDA, openOnly: true }),
      ),
    ).toEqual({ organizationId: 'org-a', status: { in: [] } });
  });

  it('returns an unsatisfiable predicate for status=CANCELADA with openOnly', () => {
    expect(
      buildSalesActivityWhere(
        'org-a',
        query({ status: SalesActivityStatus.CANCELADA, openOnly: true }),
      ),
    ).toEqual({ organizationId: 'org-a', status: { in: [] } });
  });

  it('keeps the scheduling range alongside the composed status filter', () => {
    expect(
      buildSalesActivityWhere(
        'org-a',
        query({
          status: SalesActivityStatus.CONCLUIDA,
          openOnly: true,
          scheduledFrom: '2026-09-01T00:00:00.000Z',
          scheduledTo: '2026-09-30T23:59:59.000Z',
        }),
      ),
    ).toEqual({
      organizationId: 'org-a',
      status: { in: [] },
      scheduledAt: {
        gte: new Date('2026-09-01T00:00:00.000Z'),
        lte: new Date('2026-09-30T23:59:59.000Z'),
      },
    });
  });

  it('accepts an open ended scheduling range', () => {
    expect(
      buildSalesActivityWhere(
        'org-a',
        query({ scheduledFrom: '2026-09-01T00:00:00.000Z' }),
      ),
    ).toEqual({
      organizationId: 'org-a',
      scheduledAt: { gte: new Date('2026-09-01T00:00:00.000Z') },
    });
  });

  it('keeps priority independent from the composed status filter', () => {
    expect(
      buildSalesActivityWhere(
        'org-a',
        query({ priority: SalesActivityPriority.URGENTE, openOnly: true }),
      ),
    ).toEqual({
      organizationId: 'org-a',
      status: { in: OPEN },
      priority: SalesActivityPriority.URGENTE,
    });
  });

  it('preserves every remaining filter', () => {
    expect(
      buildSalesActivityWhere(
        'org-a',
        query({
          opportunityId: 'opportunity-1',
          personId: 'person-1',
          assignedUserId: 'user-1',
          type: SalesActivityType.LIGACAO,
          priority: SalesActivityPriority.ALTA,
          status: SalesActivityStatus.EM_ANDAMENTO,
          openOnly: true,
        }),
      ),
    ).toEqual({
      organizationId: 'org-a',
      opportunityId: 'opportunity-1',
      personId: 'person-1',
      assignedUserId: 'user-1',
      type: SalesActivityType.LIGACAO,
      priority: SalesActivityPriority.ALTA,
      status: { in: [SalesActivityStatus.EM_ANDAMENTO] },
    });
  });
});
