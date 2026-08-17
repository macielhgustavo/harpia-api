CREATE TYPE "SalesActivityType" AS ENUM (
  'LIGACAO',
  'WHATSAPP',
  'EMAIL',
  'REUNIAO',
  'VISITA',
  'FOLLOW_UP',
  'OUTRO'
);

CREATE TABLE "SalesPipeline" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesPipeline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesStage" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "pipelineId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "colorKey" TEXT NOT NULL,
  "isWon" BOOLEAN NOT NULL DEFAULT false,
  "isLost" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesStage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesStage_terminal_state_check" CHECK (NOT ("isWon" AND "isLost")),
  CONSTRAINT "SalesStage_position_check" CHECK ("position" >= 0)
);

CREATE TABLE "Opportunity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "pipelineId" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "assignedUserId" TEXT,
  "developmentId" TEXT,
  "unitId" TEXT,
  "source" TEXT,
  "estimatedValue" DECIMAL(18,2),
  "probability" INTEGER,
  "nextContactAt" TIMESTAMP(3),
  "expectedCloseDate" TIMESTAMP(3),
  "lostReason" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Opportunity_estimated_value_check" CHECK ("estimatedValue" IS NULL OR "estimatedValue" >= 0),
  CONSTRAINT "Opportunity_probability_check" CHECK ("probability" IS NULL OR ("probability" >= 0 AND "probability" <= 100))
);

CREATE TABLE "OpportunityStageHistory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "fromStageId" TEXT,
  "toStageId" TEXT NOT NULL,
  "changedByUserId" TEXT NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpportunityStageHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesActivity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "assignedUserId" TEXT,
  "type" "SalesActivityType" NOT NULL,
  "scheduledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "summary" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesPipeline_organizationId_isActive_idx" ON "SalesPipeline"("organizationId", "isActive");
CREATE INDEX "SalesPipeline_organizationId_createdAt_idx" ON "SalesPipeline"("organizationId", "createdAt");
CREATE UNIQUE INDEX "SalesPipeline_one_default_per_organization" ON "SalesPipeline"("organizationId") WHERE "isDefault" = true;

CREATE UNIQUE INDEX "SalesStage_pipelineId_code_key" ON "SalesStage"("pipelineId", "code");
CREATE UNIQUE INDEX "SalesStage_pipelineId_position_key" ON "SalesStage"("pipelineId", "position");
CREATE INDEX "SalesStage_organizationId_pipelineId_idx" ON "SalesStage"("organizationId", "pipelineId");

CREATE INDEX "Opportunity_organizationId_stageId_createdAt_idx" ON "Opportunity"("organizationId", "stageId", "createdAt");
CREATE INDEX "Opportunity_organizationId_pipelineId_createdAt_idx" ON "Opportunity"("organizationId", "pipelineId", "createdAt");
CREATE INDEX "Opportunity_organizationId_assignedUserId_createdAt_idx" ON "Opportunity"("organizationId", "assignedUserId", "createdAt");
CREATE INDEX "Opportunity_organizationId_developmentId_createdAt_idx" ON "Opportunity"("organizationId", "developmentId", "createdAt");
CREATE INDEX "Opportunity_organizationId_personId_createdAt_idx" ON "Opportunity"("organizationId", "personId", "createdAt");
CREATE INDEX "Opportunity_organizationId_unitId_idx" ON "Opportunity"("organizationId", "unitId");
CREATE INDEX "Opportunity_organizationId_nextContactAt_idx" ON "Opportunity"("organizationId", "nextContactAt");

CREATE INDEX "OpportunityStageHistory_organizationId_opportunityId_changedAt_idx" ON "OpportunityStageHistory"("organizationId", "opportunityId", "changedAt");
CREATE INDEX "OpportunityStageHistory_changedByUserId_changedAt_idx" ON "OpportunityStageHistory"("changedByUserId", "changedAt");

CREATE INDEX "SalesActivity_organizationId_opportunityId_createdAt_idx" ON "SalesActivity"("organizationId", "opportunityId", "createdAt");
CREATE INDEX "SalesActivity_organizationId_personId_createdAt_idx" ON "SalesActivity"("organizationId", "personId", "createdAt");
CREATE INDEX "SalesActivity_organizationId_assignedUserId_scheduledAt_idx" ON "SalesActivity"("organizationId", "assignedUserId", "scheduledAt");
CREATE INDEX "SalesActivity_organizationId_completedAt_scheduledAt_idx" ON "SalesActivity"("organizationId", "completedAt", "scheduledAt");

ALTER TABLE "SalesPipeline" ADD CONSTRAINT "SalesPipeline_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesStage" ADD CONSTRAINT "SalesStage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesStage" ADD CONSTRAINT "SalesStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "SalesPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "SalesPipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "SalesStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_developmentId_fkey" FOREIGN KEY ("developmentId") REFERENCES "Development"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "SalesStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "SalesStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
