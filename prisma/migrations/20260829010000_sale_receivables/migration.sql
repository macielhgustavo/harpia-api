CREATE TYPE "ReceivableSourceType" AS ENUM ('SALE_PAYMENT_PLAN');
CREATE TYPE "ReceivableStatus" AS ENUM ('PENDENTE', 'PARCIAL', 'PAGO', 'CANCELADO');

CREATE TABLE "Receivable" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "bankAccountId" TEXT,
    "saleId" TEXT,
    "salePaymentPlanId" TEXT,
    "sourceType" "ReceivableSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceSequence" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "originalAmount" DECIMAL(18,2) NOT NULL,
    "adjustedAmount" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'PENDENTE',
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receivable_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Receivable_positive_sequence" CHECK ("sourceSequence" > 0),
    CONSTRAINT "Receivable_amounts" CHECK (
      "originalAmount" >= 0
      AND "adjustedAmount" >= 0
      AND "paidAmount" >= 0
      AND "paidAmount" <= "adjustedAmount"
    ),
    CONSTRAINT "Receivable_state" CHECK (
      (
        "status" = 'PENDENTE'
        AND "paidAmount" = 0
        AND "paidAt" IS NULL
        AND "cancelledAt" IS NULL
      )
      OR (
        "status" = 'PARCIAL'
        AND "paidAmount" > 0
        AND "paidAmount" < "adjustedAmount"
        AND "paidAt" IS NULL
        AND "cancelledAt" IS NULL
      )
      OR (
        "status" = 'PAGO'
        AND "paidAmount" = "adjustedAmount"
        AND "paidAt" IS NOT NULL
        AND "cancelledAt" IS NULL
      )
      OR (
        "status" = 'CANCELADO'
        AND "paidAmount" = 0
        AND "paidAt" IS NULL
        AND "cancelledAt" IS NOT NULL
      )
    )
);

CREATE TABLE "FinancialPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialPayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinancialPayment_positive_amount" CHECK ("amount" > 0),
    CONSTRAINT "FinancialPayment_reversal_state" CHECK (
      (
        "reversedAt" IS NULL
        AND "reversedByUserId" IS NULL
        AND "reversalReason" IS NULL
      )
      OR (
        "reversedAt" IS NOT NULL
        AND "reversedByUserId" IS NOT NULL
        AND length(trim("reversalReason")) > 0
      )
    )
);

CREATE UNIQUE INDEX "Receivable_organizationId_sourceType_sourceId_sourceSequence_key"
ON "Receivable"("organizationId", "sourceType", "sourceId", "sourceSequence");
CREATE INDEX "Receivable_organizationId_status_dueDate_idx"
ON "Receivable"("organizationId", "status", "dueDate");
CREATE INDEX "Receivable_organizationId_saleId_dueDate_idx"
ON "Receivable"("organizationId", "saleId", "dueDate");
CREATE INDEX "Receivable_organizationId_companyId_dueDate_idx"
ON "Receivable"("organizationId", "companyId", "dueDate");
CREATE INDEX "Receivable_organizationId_bankAccountId_dueDate_idx"
ON "Receivable"("organizationId", "bankAccountId", "dueDate");
CREATE INDEX "FinancialPayment_organizationId_receivableId_paidAt_idx"
ON "FinancialPayment"("organizationId", "receivableId", "paidAt");
CREATE INDEX "FinancialPayment_organizationId_bankAccountId_paidAt_idx"
ON "FinancialPayment"("organizationId", "bankAccountId", "paidAt");
CREATE INDEX "FinancialPayment_organizationId_reversedAt_idx"
ON "FinancialPayment"("organizationId", "reversedAt");

ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_bankAccountId_fkey"
FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_saleId_fkey"
FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_salePaymentPlanId_fkey"
FOREIGN KEY ("salePaymentPlanId") REFERENCES "SalePaymentPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialPayment" ADD CONSTRAINT "FinancialPayment_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialPayment" ADD CONSTRAINT "FinancialPayment_receivableId_fkey"
FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialPayment" ADD CONSTRAINT "FinancialPayment_bankAccountId_fkey"
FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialPayment" ADD CONSTRAINT "FinancialPayment_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialPayment" ADD CONSTRAINT "FinancialPayment_reversedByUserId_fkey"
FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill sales created between phases 4 and 5. The condition amount is the
-- total for that payment-plan group, so cents are split without loss and the
-- final installment receives the remainder.
WITH expanded AS (
  SELECT
    spp."id" AS "planId",
    spp."organizationId",
    spp."saleId",
    s."saleNumber",
    s."saleDate",
    d."companyId",
    d."expectedDeliveryDate",
    spp."type",
    spp."amount",
    spp."firstDueDate",
    spp."intervalMonths",
    spp."description" AS "planDescription",
    CASE
      WHEN spp."type" = 'PARCELAS'
        THEN GREATEST(COALESCE(spp."installments", 1), 1)
      ELSE 1
    END AS "installmentCount"
  FROM "SalePaymentPlan" spp
  INNER JOIN "Sale" s ON s."id" = spp."saleId"
  INNER JOIN "Development" d ON d."id" = s."developmentId"
), sequenced AS (
  SELECT expanded.*, sequence."value" AS "sourceSequence"
  FROM expanded
  CROSS JOIN LATERAL generate_series(1, expanded."installmentCount") AS sequence("value")
), valued AS (
  SELECT
    sequenced.*,
    (sequenced."amount" * 100)::BIGINT AS "totalCents",
    floor((sequenced."amount" * 100) / sequenced."installmentCount")::BIGINT AS "baseCents"
  FROM sequenced
)
INSERT INTO "Receivable" (
  "id",
  "organizationId",
  "companyId",
  "saleId",
  "salePaymentPlanId",
  "sourceType",
  "sourceId",
  "sourceSequence",
  "description",
  "dueDate",
  "originalAmount",
  "adjustedAmount",
  "paidAmount",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  'rcv_' || substr(md5(valued."organizationId" || ':' || valued."planId" || ':' || valued."sourceSequence"), 1, 24),
  valued."organizationId",
  valued."companyId",
  valued."saleId",
  valued."planId",
  'SALE_PAYMENT_PLAN'::"ReceivableSourceType",
  valued."planId",
  valued."sourceSequence",
  COALESCE(
    NULLIF(trim(valued."planDescription"), ''),
    CASE valued."type"
      WHEN 'ENTRADA' THEN 'Entrada'
      WHEN 'PARCELAS' THEN 'Parcela ' || lpad(valued."sourceSequence"::TEXT, 2, '0') || '/' || valued."installmentCount"
      WHEN 'SALDO_CHAVES' THEN 'Saldo nas chaves'
      WHEN 'FINANCIAMENTO' THEN 'Financiamento'
      ELSE 'Outro recebível'
    END
  ),
  COALESCE(
    valued."firstDueDate",
    CASE WHEN valued."type" = 'SALDO_CHAVES' THEN valued."expectedDeliveryDate" END,
    valued."saleDate"
  ) + make_interval(months => ((valued."sourceSequence" - 1) * COALESCE(valued."intervalMonths", 1))::INTEGER),
  (
    CASE
      WHEN valued."sourceSequence" = valued."installmentCount"
        THEN valued."totalCents" - valued."baseCents" * (valued."installmentCount" - 1)
      ELSE valued."baseCents"
    END
  )::DECIMAL / 100,
  (
    CASE
      WHEN valued."sourceSequence" = valued."installmentCount"
        THEN valued."totalCents" - valued."baseCents" * (valued."installmentCount" - 1)
      ELSE valued."baseCents"
    END
  )::DECIMAL / 100,
  0,
  'PENDENTE'::"ReceivableStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM valued
ON CONFLICT ("organizationId", "sourceType", "sourceId", "sourceSequence") DO NOTHING;
