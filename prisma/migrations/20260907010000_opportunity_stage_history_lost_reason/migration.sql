-- Makes the commercial history the source of truth for the reason of a loss.
-- "Opportunity"."lostReason" describes only the current state and is cleared
-- when the opportunity leaves the lost stage, which made the reason of a past
-- loss unrecoverable (BUG-06 / CRM-FIX-06).
--
-- Additive, idempotent and non-destructive: adds one nullable column, drops
-- nothing and rewrites no row. Existing history rows stay NULL on purpose —
-- no backfill is attempted here. The recovery analysis for losses recorded
-- before this migration is documented in docs/crm-master-audit.md and must be
-- run explicitly, never as part of a deploy.
ALTER TABLE "OpportunityStageHistory"
ADD COLUMN IF NOT EXISTS "lostReason" TEXT;
