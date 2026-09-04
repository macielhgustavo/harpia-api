ALTER TABLE "SalesStage"
ADD COLUMN "defaultProbability" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SalesStage"
ADD CONSTRAINT "SalesStage_defaultProbability_check"
CHECK ("defaultProbability" >= 0 AND "defaultProbability" <= 100);

UPDATE "SalesStage"
SET "defaultProbability" = CASE "code"
  WHEN 'NOVO' THEN 5
  WHEN 'CONTATO_INICIAL' THEN 15
  WHEN 'QUALIFICADO' THEN 30
  WHEN 'VISITA' THEN 50
  WHEN 'PROPOSTA' THEN 70
  WHEN 'NEGOCIACAO' THEN 85
  WHEN 'GANHO' THEN 100
  WHEN 'PERDIDO' THEN 0
  ELSE "defaultProbability"
END;

ALTER TABLE "Opportunity"
ADD COLUMN "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Opportunity" AS opportunity
SET "stageEnteredAt" = COALESCE(
  (
    SELECT MAX(history."changedAt")
    FROM "OpportunityStageHistory" AS history
    WHERE history."opportunityId" = opportunity."id"
      AND history."organizationId" = opportunity."organizationId"
  ),
  opportunity."createdAt"
);

CREATE INDEX "Opportunity_organizationId_stageId_stageEnteredAt_idx"
ON "Opportunity"("organizationId", "stageId", "stageEnteredAt");
