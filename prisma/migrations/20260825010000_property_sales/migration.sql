CREATE TYPE "SaleStatus" AS ENUM ('ATIVA', 'QUITADA', 'CANCELADA', 'DISTRATADA');
CREATE TYPE "SaleCommissionStatus" AS ENUM ('PREVISTA', 'DEVIDA', 'PAGA', 'CANCELADA');

ALTER TABLE "SalesProposal"
  ADD COLUMN "convertedToSaleAt" TIMESTAMP(3),
  ADD COLUMN "convertedToSaleByUserId" TEXT,
  ADD CONSTRAINT "SalesProposal_sale_conversion_state" CHECK (
    ("convertedToSaleAt" IS NULL AND "convertedToSaleByUserId" IS NULL)
    OR
    ("convertedToSaleAt" IS NOT NULL AND "convertedToSaleByUserId" IS NOT NULL)
  );

CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "developmentId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "proposalId" TEXT,
    "saleNumber" TEXT NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'ATIVA',
    "saleDate" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "discountAmount" DECIMAL(18,2) NOT NULL,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Sale_nonnegative_amounts" CHECK (
      "grossAmount" >= 0 AND "discountAmount" >= 0 AND "netAmount" >= 0
    ),
    CONSTRAINT "Sale_amount_math" CHECK (
      "netAmount" = "grossAmount" - "discountAmount"
    ),
    CONSTRAINT "Sale_cancellation_state" CHECK (
      ("status" IN ('CANCELADA', 'DISTRATADA') AND "cancelledAt" IS NOT NULL)
      OR
      ("status" IN ('ATIVA', 'QUITADA') AND "cancelledAt" IS NULL)
    )
);

CREATE TABLE "SaleBuyer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "participationPercentage" DECIMAL(5,2),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleBuyer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SaleBuyer_percentage_range" CHECK (
      "participationPercentage" IS NULL
      OR ("participationPercentage" > 0 AND "participationPercentage" <= 100)
    )
);

CREATE TABLE "SalePaymentPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "type" "ProposalPaymentConditionType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "installments" INTEGER,
    "firstDueDate" TIMESTAMP(3),
    "intervalMonths" INTEGER,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalePaymentPlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SalePaymentPlan_nonnegative_amount" CHECK ("amount" >= 0),
    CONSTRAINT "SalePaymentPlan_positive_installments" CHECK ("installments" IS NULL OR "installments" > 0),
    CONSTRAINT "SalePaymentPlan_positive_interval" CHECK ("intervalMonths" IS NULL OR "intervalMonths" > 0),
    CONSTRAINT "SalePaymentPlan_nonnegative_position" CHECK ("position" >= 0)
);

CREATE TABLE "SaleCommission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "personId" TEXT,
    "userId" TEXT,
    "percentage" DECIMAL(5,2),
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "SaleCommissionStatus" NOT NULL DEFAULT 'PREVISTA',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleCommission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SaleCommission_beneficiary" CHECK (
      ("personId" IS NOT NULL AND "userId" IS NULL)
      OR
      ("personId" IS NULL AND "userId" IS NOT NULL)
    ),
    CONSTRAINT "SaleCommission_nonnegative_amount" CHECK ("amount" >= 0),
    CONSTRAINT "SaleCommission_percentage_range" CHECK (
      "percentage" IS NULL OR ("percentage" > 0 AND "percentage" <= 100)
    )
);

CREATE UNIQUE INDEX "Sale_proposalId_key" ON "Sale"("proposalId");
CREATE UNIQUE INDEX "Sale_organizationId_saleNumber_key" ON "Sale"("organizationId", "saleNumber");
CREATE UNIQUE INDEX "Sale_active_unit_key" ON "Sale"("unitId") WHERE "status" IN ('ATIVA', 'QUITADA');
CREATE INDEX "Sale_organizationId_status_saleDate_idx" ON "Sale"("organizationId", "status", "saleDate");
CREATE INDEX "Sale_organizationId_developmentId_saleDate_idx" ON "Sale"("organizationId", "developmentId", "saleDate");
CREATE INDEX "Sale_organizationId_unitId_status_idx" ON "Sale"("organizationId", "unitId", "status");
CREATE INDEX "Sale_organizationId_opportunityId_idx" ON "Sale"("organizationId", "opportunityId");

CREATE UNIQUE INDEX "SaleBuyer_saleId_personId_key" ON "SaleBuyer"("saleId", "personId");
CREATE UNIQUE INDEX "SaleBuyer_one_primary_per_sale" ON "SaleBuyer"("saleId") WHERE "isPrimary" = true;
CREATE INDEX "SaleBuyer_organizationId_personId_createdAt_idx" ON "SaleBuyer"("organizationId", "personId", "createdAt");
CREATE INDEX "SaleBuyer_organizationId_saleId_idx" ON "SaleBuyer"("organizationId", "saleId");

CREATE INDEX "SalePaymentPlan_organizationId_saleId_position_idx" ON "SalePaymentPlan"("organizationId", "saleId", "position");
CREATE INDEX "SaleCommission_organizationId_saleId_status_idx" ON "SaleCommission"("organizationId", "saleId", "status");
CREATE INDEX "SaleCommission_organizationId_personId_idx" ON "SaleCommission"("organizationId", "personId");
CREATE INDEX "SaleCommission_organizationId_userId_idx" ON "SaleCommission"("organizationId", "userId");

ALTER TABLE "SalesProposal" ADD CONSTRAINT "SalesProposal_convertedToSaleByUserId_fkey" FOREIGN KEY ("convertedToSaleByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_developmentId_fkey" FOREIGN KEY ("developmentId") REFERENCES "Development"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "SalesProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleBuyer" ADD CONSTRAINT "SaleBuyer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleBuyer" ADD CONSTRAINT "SaleBuyer_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleBuyer" ADD CONSTRAINT "SaleBuyer_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalePaymentPlan" ADD CONSTRAINT "SalePaymentPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalePaymentPlan" ADD CONSTRAINT "SalePaymentPlan_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SaleCommission" ADD CONSTRAINT "SaleCommission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleCommission" ADD CONSTRAINT "SaleCommission_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleCommission" ADD CONSTRAINT "SaleCommission_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleCommission" ADD CONSTRAINT "SaleCommission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
