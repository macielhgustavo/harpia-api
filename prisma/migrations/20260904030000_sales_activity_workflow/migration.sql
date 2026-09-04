CREATE TYPE "SalesActivityStatus" AS ENUM (
  'PENDENTE',
  'EM_ANDAMENTO',
  'CONCLUIDA',
  'CANCELADA'
);

CREATE TYPE "SalesActivityPriority" AS ENUM (
  'BAIXA',
  'NORMAL',
  'ALTA',
  'URGENTE'
);

ALTER TABLE "SalesActivity"
ADD COLUMN "status" "SalesActivityStatus" NOT NULL DEFAULT 'PENDENTE',
ADD COLUMN "priority" "SalesActivityPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN "reminderAt" TIMESTAMP(3),
ADD COLUMN "result" TEXT;

UPDATE "SalesActivity"
SET "status" = 'CONCLUIDA'
WHERE "completedAt" IS NOT NULL;

CREATE INDEX "SalesActivity_organizationId_status_scheduledAt_idx"
ON "SalesActivity"("organizationId", "status", "scheduledAt");

CREATE INDEX "SalesActivity_organizationId_reminderAt_idx"
ON "SalesActivity"("organizationId", "reminderAt");
