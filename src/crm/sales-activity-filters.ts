import { Prisma, SalesActivityStatus } from '@prisma/client';
import { ListSalesActivitiesQueryDto } from './dto/list-sales-activities-query.dto';

/**
 * Statuses that make an activity count as open, i.e. still demanding action
 * from the commercial team. Single source of truth for `openOnly`.
 */
export const OPEN_SALES_ACTIVITY_STATUSES: readonly SalesActivityStatus[] = [
  SalesActivityStatus.PENDENTE,
  SalesActivityStatus.EM_ANDAMENTO,
];

/**
 * Resolves `status` and `openOnly` into a single status predicate.
 *
 * The two are independent filters combined with AND, never overriding each
 * other: `openOnly` narrows the result to the open statuses and `status` pins
 * one exact status, so asking for both is a set intersection. Requesting a
 * closed status together with `openOnly` is therefore unsatisfiable and yields
 * an empty result instead of silently ignoring one of the filters.
 */
export function buildSalesActivityStatusFilter(
  status?: SalesActivityStatus,
  openOnly?: boolean,
): Prisma.SalesActivityWhereInput['status'] {
  if (!openOnly) return status;
  const allowed = status
    ? OPEN_SALES_ACTIVITY_STATUSES.filter((open) => open === status)
    : [...OPEN_SALES_ACTIVITY_STATUSES];
  return { in: allowed };
}

/**
 * Single place where the activity listing predicate is assembled. The tenant is
 * always applied from the validated session and never read from the query, and
 * no filter can override another through object spread ordering.
 */
export function buildSalesActivityWhere(
  organizationId: string,
  query: ListSalesActivitiesQueryDto,
): Prisma.SalesActivityWhereInput {
  const status = buildSalesActivityStatusFilter(query.status, query.openOnly);
  return {
    organizationId,
    ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
    ...(query.personId ? { personId: query.personId } : {}),
    ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(status === undefined ? {} : { status }),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.scheduledFrom || query.scheduledTo
      ? {
          scheduledAt: {
            ...(query.scheduledFrom
              ? { gte: new Date(query.scheduledFrom) }
              : {}),
            ...(query.scheduledTo ? { lte: new Date(query.scheduledTo) } : {}),
          },
        }
      : {}),
  };
}
