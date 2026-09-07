import { Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditEntry } from '../audit/audit.service';

/**
 * Opportunity fields the caller must have read under a tenant-scoped
 * `FOR UPDATE` lock before asking for a transition.
 */
export interface StageChangeOpportunity {
  id: string;
  stageId: string;
}

/** Target stage fields required to derive the terminal audit event. */
export interface StageChangeTarget {
  id: string;
  isWon: boolean;
  isLost: boolean;
}

export interface OpportunityStageChange {
  organizationId: string;
  actorUserId: string;
  opportunity: StageChangeOpportunity;
  toStage: StageChangeTarget;
  /** Only persisted when the target stage is a lost stage. */
  lostReason?: string | null;
  /**
   * Extra columns written in the same UPDATE, such as the unit resolved by the
   * proposal or sale flow. Never allowed to override the stage invariants.
   */
  additionalData?: Prisma.OpportunityUncheckedUpdateInput;
  /** Extra audit metadata, such as the proposal that triggered the change. */
  auditMetadata?: Record<string, unknown>;
}

/**
 * Single writer for `Opportunity.stageId`.
 *
 * Every stage change — manual movement, proposal acceptance and sale
 * conversion — must go through here so the stage timestamp, the commercial
 * history and the audit events can never drift apart. Callers are responsible
 * for opening the transaction, locking the opportunity within their tenant and
 * persisting the returned entries; the caller decides whether to record them
 * immediately or batch them with its own events.
 *
 * Returns an empty list and writes nothing when the opportunity is already in
 * the target stage, so a repeated call cannot duplicate history, audit events
 * or artificially reset the stage timestamp.
 */
export async function applyOpportunityStageChange(
  tx: Prisma.TransactionClient,
  change: OpportunityStageChange,
): Promise<AuditEntry[]> {
  const { organizationId, actorUserId, opportunity, toStage } = change;
  if (toStage.id === opportunity.stageId) return [];

  const lostReason = toStage.isLost
    ? (change.lostReason?.trim() ?? null)
    : null;

  await tx.opportunity.update({
    where: { id: opportunity.id },
    data: {
      // Spread first so the stage invariants below always win.
      ...change.additionalData,
      stageId: toStage.id,
      stageEnteredAt: new Date(),
      lostReason,
    },
  });

  await tx.opportunityStageHistory.create({
    data: {
      organizationId,
      opportunityId: opportunity.id,
      fromStageId: opportunity.stageId,
      toStageId: toStage.id,
      changedByUserId: actorUserId,
    },
  });

  const metadata = {
    fromStageId: opportunity.stageId,
    toStageId: toStage.id,
    ...change.auditMetadata,
  };
  const entries: AuditEntry[] = [
    {
      organizationId,
      actorUserId,
      action: AUDIT_ACTIONS.OPPORTUNITY_STAGE_CHANGED,
      entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY,
      entityId: opportunity.id,
      metadata,
    },
  ];
  if (toStage.isWon || toStage.isLost) {
    entries.push({
      organizationId,
      actorUserId,
      action: toStage.isWon
        ? AUDIT_ACTIONS.OPPORTUNITY_WON
        : AUDIT_ACTIONS.OPPORTUNITY_LOST,
      entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY,
      entityId: opportunity.id,
      metadata,
    });
  }
  return entries;
}
