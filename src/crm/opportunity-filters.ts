import { Prisma } from '@prisma/client';
import { ListOpportunitiesQueryDto } from './dto/list-opportunities-query.dto';

/**
 * Single place where the opportunity predicate is assembled. The listing, the
 * board columns and the board aggregates all read from here, so a filter can
 * never narrow the cards without narrowing the totals shown above them.
 *
 * The tenant always comes from the validated session and is never read from
 * the query object.
 */
export function buildOpportunityWhere(
  organizationId: string,
  query: ListOpportunitiesQueryDto,
): Prisma.OpportunityWhereInput {
  const search = query.search?.trim();
  return {
    organizationId,
    ...(query.stageId ? { stageId: query.stageId } : {}),
    ...(query.pipelineId ? { pipelineId: query.pipelineId } : {}),
    ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
    ...(query.developmentId ? { developmentId: query.developmentId } : {}),
    ...(query.personId ? { personId: query.personId } : {}),
    ...(query.source
      ? { source: { equals: query.source, mode: 'insensitive' } }
      : {}),
    ...(search
      ? {
          OR: [
            { person: { name: { contains: search, mode: 'insensitive' } } },
            { person: { email: { contains: search, mode: 'insensitive' } } },
            { source: { contains: search, mode: 'insensitive' } },
            { notes: { contains: search, mode: 'insensitive' } },
            { unit: { identifier: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
}

/**
 * Deterministic order for every opportunity page. `id` breaks ties so a record
 * can never be skipped or repeated while paging through a stage.
 */
export const OPPORTUNITY_ORDER: Prisma.OpportunityOrderByWithRelationInput[] = [
  { updatedAt: 'desc' },
  { id: 'desc' },
];
