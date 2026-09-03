-- CreateEnum
CREATE TYPE "BankStatementEntryType" AS ENUM ('CREDITO', 'DEBITO');

-- CreateEnum
CREATE TYPE "BankReconciliationStatus" AS ENUM ('PENDENTE', 'CONCILIADO', 'IGNORADO');

-- CreateTable
CREATE TABLE "BankStatementEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "externalId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "type" "BankStatementEntryType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "BankReconciliationStatus" NOT NULL DEFAULT 'PENDENTE',
    "matchedTransactionId" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "ignoredAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankStatementEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BankStatementEntry_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "BankStatementEntry_state_consistent" CHECK (
      ("status" = 'PENDENTE' AND "matchedTransactionId" IS NULL AND "reconciledAt" IS NULL AND "ignoredAt" IS NULL)
      OR ("status" = 'CONCILIADO' AND "matchedTransactionId" IS NOT NULL AND "reconciledAt" IS NOT NULL AND "ignoredAt" IS NULL)
      OR ("status" = 'IGNORADO' AND "matchedTransactionId" IS NULL AND "reconciledAt" IS NULL AND "ignoredAt" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementEntry_matchedTransactionId_key" ON "BankStatementEntry"("matchedTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementEntry_organizationId_bankAccountId_fingerprint_key" ON "BankStatementEntry"("organizationId", "bankAccountId", "fingerprint");

-- CreateIndex
CREATE INDEX "BankStatementEntry_organizationId_bankAccountId_status_date_idx" ON "BankStatementEntry"("organizationId", "bankAccountId", "status", "date");

-- CreateIndex
CREATE INDEX "BankStatementEntry_organizationId_status_date_idx" ON "BankStatementEntry"("organizationId", "status", "date");

-- AddForeignKey
ALTER TABLE "BankStatementEntry" ADD CONSTRAINT "BankStatementEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementEntry" ADD CONSTRAINT "BankStatementEntry_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementEntry" ADD CONSTRAINT "BankStatementEntry_matchedTransactionId_fkey" FOREIGN KEY ("matchedTransactionId") REFERENCES "FinancialTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
