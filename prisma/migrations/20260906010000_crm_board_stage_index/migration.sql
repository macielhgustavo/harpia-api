-- Supports the Kanban board: each stage is paged independently with
-- ORDER BY "updatedAt" DESC, and the existing stage indexes only cover
-- "createdAt" and "stageEnteredAt". Additive and idempotent: creates an
-- index, drops nothing and rewrites no data.
CREATE INDEX IF NOT EXISTS "Opportunity_organizationId_stageId_updatedAt_idx"
ON "Opportunity"("organizationId", "stageId", "updatedAt");
