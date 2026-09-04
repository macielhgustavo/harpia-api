CREATE TYPE "SalesVisitStatus" AS ENUM (
  'AGENDADA',
  'REALIZADA',
  'CANCELADA',
  'NAO_COMPARECEU'
);

CREATE TYPE "SalesVisitOutcome" AS ENUM (
  'INTERESSE_ALTO',
  'INTERESSE_MEDIO',
  'INTERESSE_BAIXO',
  'SEM_INTERESSE',
  'REAGENDAR'
);

CREATE TABLE "SalesVisit" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "assignedUserId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "developmentId" TEXT,
  "unitId" TEXT,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "durationMinutes" INTEGER NOT NULL DEFAULT 60,
  "status" "SalesVisitStatus" NOT NULL DEFAULT 'AGENDADA',
  "outcome" "SalesVisitOutcome",
  "location" TEXT,
  "result" TEXT,
  "notes" TEXT,
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesVisit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SalesVisit"
ADD CONSTRAINT "SalesVisit_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalesVisit"
ADD CONSTRAINT "SalesVisit_opportunityId_fkey"
FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalesVisit"
ADD CONSTRAINT "SalesVisit_personId_fkey"
FOREIGN KEY ("personId") REFERENCES "Person"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesVisit"
ADD CONSTRAINT "SalesVisit_assignedUserId_fkey"
FOREIGN KEY ("assignedUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SalesVisit"
ADD CONSTRAINT "SalesVisit_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesVisit"
ADD CONSTRAINT "SalesVisit_developmentId_fkey"
FOREIGN KEY ("developmentId") REFERENCES "Development"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SalesVisit"
ADD CONSTRAINT "SalesVisit_unitId_fkey"
FOREIGN KEY ("unitId") REFERENCES "Unit"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SalesVisit_organizationId_scheduledAt_idx"
ON "SalesVisit"("organizationId", "scheduledAt");

CREATE INDEX "SalesVisit_organizationId_status_scheduledAt_idx"
ON "SalesVisit"("organizationId", "status", "scheduledAt");

CREATE INDEX "SalesVisit_organizationId_assignedUserId_scheduledAt_idx"
ON "SalesVisit"("organizationId", "assignedUserId", "scheduledAt");

CREATE INDEX "SalesVisit_organizationId_opportunityId_scheduledAt_idx"
ON "SalesVisit"("organizationId", "opportunityId", "scheduledAt");

CREATE INDEX "SalesVisit_organizationId_personId_scheduledAt_idx"
ON "SalesVisit"("organizationId", "personId", "scheduledAt");
