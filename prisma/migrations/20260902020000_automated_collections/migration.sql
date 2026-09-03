-- CreateEnum
CREATE TYPE "CollectionDispatchStatus" AS ENUM ('PENDENTE', 'ENVIANDO', 'ENVIADO', 'FALHOU', 'CANCELADO');

-- CreateTable
CREATE TABLE "CollectionRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daysOffset" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CollectionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionDispatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "status" "CollectionDispatchStatus" NOT NULL DEFAULT 'PENDENTE',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "recipient" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "balanceSnapshot" DECIMAL(18,2) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CollectionDispatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CollectionRule_organizationId_name_key" ON "CollectionRule"("organizationId", "name");
CREATE INDEX "CollectionRule_organizationId_active_daysOffset_idx" ON "CollectionRule"("organizationId", "active", "daysOffset");
CREATE UNIQUE INDEX "CollectionDispatch_ruleId_receivableId_scheduledFor_key" ON "CollectionDispatch"("ruleId", "receivableId", "scheduledFor");
CREATE INDEX "CollectionDispatch_organizationId_status_scheduledFor_idx" ON "CollectionDispatch"("organizationId", "status", "scheduledFor");
CREATE INDEX "CollectionDispatch_organizationId_receivableId_createdAt_idx" ON "CollectionDispatch"("organizationId", "receivableId", "createdAt");

ALTER TABLE "CollectionRule" ADD CONSTRAINT "CollectionRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionDispatch" ADD CONSTRAINT "CollectionDispatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionDispatch" ADD CONSTRAINT "CollectionDispatch_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CollectionRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollectionDispatch" ADD CONSTRAINT "CollectionDispatch_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
