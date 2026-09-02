CREATE TYPE "FinancialCategoryType" AS ENUM ('RECEITA', 'DESPESA');
CREATE TYPE "PayableStatus" AS ENUM ('PENDENTE', 'PARCIAL', 'PAGO', 'CANCELADO');
CREATE TYPE "PayableSourceType" AS ENUM ('INVESTOR_RETURN', 'SALE_COMMISSION', 'MANUAL');
CREATE TYPE "FinancialTransactionType" AS ENUM ('ENTRADA', 'SAIDA');

CREATE TABLE "FinancialCategory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "FinancialCategoryType" NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostCenter" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "companyId" TEXT,
  "developmentId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payable" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "companyId" TEXT,
  "developmentId" TEXT,
  "bankAccountId" TEXT,
  "categoryId" TEXT,
  "costCenterId" TEXT,
  "supplierPersonId" TEXT,
  "saleCommissionId" TEXT,
  "investorReturnId" TEXT,
  "description" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "originalAmount" DECIMAL(18,2) NOT NULL,
  "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "status" "PayableStatus" NOT NULL DEFAULT 'PENDENTE',
  "sourceType" "PayableSourceType",
  "sourceId" TEXT,
  "paidAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payable_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Payable_amounts" CHECK (
    "originalAmount" > 0
    AND "paidAmount" >= 0
    AND "paidAmount" <= "originalAmount"
  ),
  CONSTRAINT "Payable_source" CHECK (
    ("sourceType" IS NULL AND "sourceId" IS NULL)
    OR ("sourceType" IS NOT NULL AND "sourceId" IS NOT NULL)
  ),
  CONSTRAINT "Payable_state" CHECK (
    ("status" = 'PENDENTE' AND "paidAmount" = 0 AND "paidAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'PARCIAL' AND "paidAmount" > 0 AND "paidAmount" < "originalAmount" AND "paidAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'PAGO' AND "paidAmount" = "originalAmount" AND "paidAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELADO' AND "paidAmount" = 0 AND "paidAt" IS NULL AND "cancelledAt" IS NOT NULL)
  )
);

ALTER TABLE "FinancialPayment"
  ALTER COLUMN "receivableId" DROP NOT NULL,
  ADD COLUMN "payableId" TEXT;

ALTER TABLE "FinancialPayment" DROP CONSTRAINT "FinancialPayment_bankAccountId_fkey";
ALTER TABLE "FinancialPayment" ALTER COLUMN "bankAccountId" SET NOT NULL;
ALTER TABLE "FinancialPayment" ADD CONSTRAINT "FinancialPayment_target"
CHECK (
  ("receivableId" IS NOT NULL AND "payableId" IS NULL)
  OR ("receivableId" IS NULL AND "payableId" IS NOT NULL)
);

CREATE TABLE "FinancialTransaction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "companyId" TEXT,
  "developmentId" TEXT,
  "costCenterId" TEXT,
  "paymentId" TEXT NOT NULL,
  "receivableId" TEXT,
  "payableId" TEXT,
  "type" "FinancialTransactionType" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "reversedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialTransaction_positive_amount" CHECK ("amount" > 0),
  CONSTRAINT "FinancialTransaction_target" CHECK (
    ("receivableId" IS NOT NULL AND "payableId" IS NULL AND "type" = 'ENTRADA')
    OR ("receivableId" IS NULL AND "payableId" IS NOT NULL AND "type" = 'SAIDA')
  )
);

CREATE UNIQUE INDEX "FinancialCategory_organizationId_name_type_key"
ON "FinancialCategory"("organizationId", "name", "type");
CREATE INDEX "FinancialCategory_organizationId_type_active_idx"
ON "FinancialCategory"("organizationId", "type", "active");
CREATE UNIQUE INDEX "CostCenter_organizationId_name_key"
ON "CostCenter"("organizationId", "name");
CREATE INDEX "CostCenter_organizationId_active_idx" ON "CostCenter"("organizationId", "active");
CREATE INDEX "CostCenter_organizationId_companyId_idx" ON "CostCenter"("organizationId", "companyId");
CREATE INDEX "CostCenter_organizationId_developmentId_idx" ON "CostCenter"("organizationId", "developmentId");
CREATE UNIQUE INDEX "Payable_saleCommissionId_key" ON "Payable"("saleCommissionId");
CREATE UNIQUE INDEX "Payable_investorReturnId_key" ON "Payable"("investorReturnId");
CREATE UNIQUE INDEX "Payable_organizationId_sourceType_sourceId_key"
ON "Payable"("organizationId", "sourceType", "sourceId");
CREATE INDEX "Payable_organizationId_status_dueDate_idx" ON "Payable"("organizationId", "status", "dueDate");
CREATE INDEX "Payable_organizationId_companyId_dueDate_idx" ON "Payable"("organizationId", "companyId", "dueDate");
CREATE INDEX "Payable_organizationId_developmentId_dueDate_idx" ON "Payable"("organizationId", "developmentId", "dueDate");
CREATE INDEX "Payable_organizationId_costCenterId_dueDate_idx" ON "Payable"("organizationId", "costCenterId", "dueDate");
CREATE INDEX "FinancialPayment_organizationId_payableId_paidAt_idx"
ON "FinancialPayment"("organizationId", "payableId", "paidAt");
CREATE UNIQUE INDEX "FinancialTransaction_paymentId_key" ON "FinancialTransaction"("paymentId");
CREATE INDEX "FinancialTransaction_organizationId_date_type_idx" ON "FinancialTransaction"("organizationId", "date", "type");
CREATE INDEX "FinancialTransaction_organizationId_companyId_date_idx" ON "FinancialTransaction"("organizationId", "companyId", "date");
CREATE INDEX "FinancialTransaction_organizationId_developmentId_date_idx" ON "FinancialTransaction"("organizationId", "developmentId", "date");
CREATE INDEX "FinancialTransaction_organizationId_costCenterId_date_idx" ON "FinancialTransaction"("organizationId", "costCenterId", "date");
CREATE INDEX "FinancialTransaction_organizationId_bankAccountId_date_idx" ON "FinancialTransaction"("organizationId", "bankAccountId", "date");

ALTER TABLE "FinancialCategory" ADD CONSTRAINT "FinancialCategory_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_developmentId_fkey"
FOREIGN KEY ("developmentId") REFERENCES "Development"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_developmentId_fkey"
FOREIGN KEY ("developmentId") REFERENCES "Development"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_bankAccountId_fkey"
FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_costCenterId_fkey"
FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_supplierPersonId_fkey"
FOREIGN KEY ("supplierPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_saleCommissionId_fkey"
FOREIGN KEY ("saleCommissionId") REFERENCES "SaleCommission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_investorReturnId_fkey"
FOREIGN KEY ("investorReturnId") REFERENCES "Return"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialPayment" ADD CONSTRAINT "FinancialPayment_payableId_fkey"
FOREIGN KEY ("payableId") REFERENCES "Payable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialPayment" ADD CONSTRAINT "FinancialPayment_bankAccountId_fkey"
FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_bankAccountId_fkey"
FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_developmentId_fkey"
FOREIGN KEY ("developmentId") REFERENCES "Development"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_costCenterId_fkey"
FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "FinancialPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_receivableId_fkey"
FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_payableId_fkey"
FOREIGN KEY ("payableId") REFERENCES "Payable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defaults are data, not permanent code: they can be renamed, disabled or extended.
INSERT INTO "FinancialCategory" ("id", "organizationId", "name", "type", "isDefault", "updatedAt")
SELECT
  'fcat_' || substr(md5(o."id" || ':' || seed."type" || ':' || seed."name"), 1, 24),
  o."id",
  seed."name",
  seed."type"::"FinancialCategoryType",
  true,
  CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES
  ('RECEITA', 'Venda de unidade'),
  ('RECEITA', 'Investimento'),
  ('RECEITA', 'Outras receitas'),
  ('DESPESA', 'Obra'),
  ('DESPESA', 'Marketing'),
  ('DESPESA', 'Comissão'),
  ('DESPESA', 'Retorno de investidor'),
  ('DESPESA', 'Administrativo'),
  ('DESPESA', 'Tributos'),
  ('DESPESA', 'Distrato'),
  ('DESPESA', 'Outras despesas')
) AS seed("type", "name")
ON CONFLICT ("organizationId", "name", "type") DO NOTHING;

INSERT INTO "CostCenter" ("id", "organizationId", "name", "companyId", "updatedAt")
SELECT
  'cc_' || substr(md5(o."id" || ':Incorporadora geral'), 1, 24),
  o."id",
  'Incorporadora geral',
  (SELECT c."id" FROM "Company" c WHERE c."organizationId" = o."id" AND c."type" = 'INCORPORADORA' ORDER BY c."createdAt" LIMIT 1),
  CURRENT_TIMESTAMP
FROM "Organization" o
ON CONFLICT ("organizationId", "name") DO NOTHING;

INSERT INTO "CostCenter" ("id", "organizationId", "name", "companyId", "updatedAt")
SELECT
  'cc_' || substr(md5(c."organizationId" || ':' || c."id"), 1, 24),
  c."organizationId",
  c."name",
  c."id",
  CURRENT_TIMESTAMP
FROM "Company" c
WHERE c."type" = 'SPE'
ON CONFLICT ("organizationId", "name") DO NOTHING;

-- Existing pending investor returns enter the general incorporator's payables.
INSERT INTO "Payable" (
  "id", "organizationId", "companyId", "categoryId", "costCenterId",
  "investorReturnId", "description", "dueDate", "originalAmount",
  "sourceType", "sourceId", "updatedAt"
)
SELECT
  'pay_' || substr(md5(r."organizationId" || ':return:' || r."id"), 1, 24),
  r."organizationId",
  cc."companyId",
  fc."id",
  cc."id",
  r."id",
  'Retorno de investidor · ' || p."name",
  r."expectedDate",
  r."expectedAmount"::DECIMAL(18,2),
  'INVESTOR_RETURN'::"PayableSourceType",
  r."id",
  CURRENT_TIMESTAMP
FROM "Return" r
INNER JOIN "Allocation" a ON a."id" = r."allocationId"
INNER JOIN "Investment" i ON i."id" = a."investmentId"
INNER JOIN "Person" p ON p."id" = i."investorId"
LEFT JOIN "CostCenter" cc ON cc."organizationId" = r."organizationId" AND cc."name" = 'Incorporadora geral'
LEFT JOIN "FinancialCategory" fc ON fc."organizationId" = r."organizationId" AND fc."type" = 'DESPESA' AND fc."name" = 'Retorno de investidor'
WHERE r."status" <> 'PAGO'
ON CONFLICT ("organizationId", "sourceType", "sourceId") DO NOTHING;

INSERT INTO "Payable" (
  "id", "organizationId", "companyId", "developmentId", "categoryId",
  "saleCommissionId", "supplierPersonId", "description", "dueDate",
  "originalAmount", "sourceType", "sourceId", "updatedAt"
)
SELECT
  'pay_' || substr(md5(sc."organizationId" || ':commission:' || sc."id"), 1, 24),
  sc."organizationId",
  d."companyId",
  s."developmentId",
  fc."id",
  sc."id",
  sc."personId",
  'Comissão · venda ' || s."saleNumber",
  CURRENT_TIMESTAMP,
  sc."amount",
  'SALE_COMMISSION'::"PayableSourceType",
  sc."id",
  CURRENT_TIMESTAMP
FROM "SaleCommission" sc
INNER JOIN "Sale" s ON s."id" = sc."saleId"
INNER JOIN "Development" d ON d."id" = s."developmentId"
LEFT JOIN "FinancialCategory" fc ON fc."organizationId" = sc."organizationId" AND fc."type" = 'DESPESA' AND fc."name" = 'Comissão'
WHERE sc."status" = 'DEVIDA'
ON CONFLICT ("organizationId", "sourceType", "sourceId") DO NOTHING;
