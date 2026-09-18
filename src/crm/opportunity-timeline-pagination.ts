import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface TimelineKey {
  id: string;
  occurredAt: Date;
}

interface TimelineCursor {
  v: 1;
  opportunityId: string;
  id: string;
  occurredAt: string;
}

export function encodeTimelineCursor(opportunityId: string, key: TimelineKey) {
  const value: TimelineCursor = {
    v: 1,
    opportunityId,
    id: key.id,
    occurredAt: key.occurredAt.toISOString(),
  };
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeTimelineCursor(
  encoded: string | undefined,
  opportunityId: string,
): TimelineKey | null {
  if (!encoded) return null;
  try {
    if (encoded.length > 512 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
      throw new Error('Invalid encoding');
    }
    const value: unknown = JSON.parse(
      Buffer.from(encoded, 'base64url').toString(),
    );
    if (!value || typeof value !== 'object') throw new Error('Invalid value');
    const cursor = value as Partial<TimelineCursor>;
    if (
      cursor.v !== 1 ||
      cursor.opportunityId !== opportunityId ||
      typeof cursor.id !== 'string' ||
      !/^(stage|activity|visit|reservation|proposal|sale):[A-Za-z0-9_-]+$/.test(
        cursor.id,
      ) ||
      typeof cursor.occurredAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(cursor.occurredAt)
    ) {
      throw new Error('Invalid cursor');
    }
    const occurredAt = new Date(cursor.occurredAt);
    if (
      Number.isNaN(occurredAt.getTime()) ||
      occurredAt.toISOString() !== cursor.occurredAt
    ) {
      throw new Error('Invalid date');
    }
    return { id: cursor.id, occurredAt };
  } catch {
    throw new BadRequestException('Cursor da timeline inválido');
  }
}

/**
 * Select only page keys, not full rows. Every source uses the exact same
 * effective timestamp as the public timeline projection. The global LIMIT
 * is applied after UNION ALL, so no source can hide an older event.
 */
export function timelineKeysQuery(
  organizationId: string,
  opportunityId: string,
  after: TimelineKey | null,
  take: number,
): Prisma.Sql {
  const boundary = after
    ? Prisma.sql`WHERE (events."occurredAt" < ${after.occurredAt}
        OR (events."occurredAt" = ${after.occurredAt} AND events.id > ${after.id}))`
    : Prisma.empty;
  return Prisma.sql`
    SELECT events.id, events."occurredAt" FROM (
      SELECT 'stage:' || id AS id, "changedAt" AS "occurredAt"
        FROM "OpportunityStageHistory" WHERE "organizationId" = ${organizationId} AND "opportunityId" = ${opportunityId}
      UNION ALL
      SELECT 'activity:' || id, COALESCE("completedAt", "createdAt")
        FROM "SalesActivity" WHERE "organizationId" = ${organizationId} AND "opportunityId" = ${opportunityId}
      UNION ALL
      SELECT 'visit:' || id, COALESCE("completedAt", "cancelledAt", "scheduledAt")
        FROM "SalesVisit" WHERE "organizationId" = ${organizationId} AND "opportunityId" = ${opportunityId}
      UNION ALL
      SELECT 'reservation:' || id, COALESCE("convertedAt", "cancelledAt", "createdAt")
        FROM "UnitReservation" WHERE "organizationId" = ${organizationId} AND "opportunityId" = ${opportunityId}
      UNION ALL
      SELECT 'proposal:' || id, COALESCE("convertedToSaleAt", "acceptedAt", "rejectedAt", "sentAt", "createdAt")
        FROM "SalesProposal" WHERE "organizationId" = ${organizationId} AND "opportunityId" = ${opportunityId}
      UNION ALL
      SELECT 'sale:' || id, "saleDate"
        FROM "Sale" WHERE "organizationId" = ${organizationId} AND "opportunityId" = ${opportunityId}
    ) AS events
    ${boundary}
    ORDER BY events."occurredAt" DESC, events.id ASC
    LIMIT ${take}
  `;
}
