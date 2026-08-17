CREATE TYPE "SalesProposalStatus" AS ENUM ('RASCUNHO', 'ENVIADA', 'EM_NEGOCIACAO', 'ACEITA', 'RECUSADA', 'EXPIRADA', 'CANCELADA');
CREATE TYPE "ProposalPaymentConditionType" AS ENUM ('ENTRADA', 'PARCELAS', 'SALDO_CHAVES', 'FINANCIAMENTO', 'OUTRO');

CREATE TABLE "SalesProposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "reservationId" TEXT,
    "personId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "status" "SalesProposalStatus" NOT NULL DEFAULT 'RASCUNHO',
    "currentVersionId" TEXT,
    "validUntil" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesProposal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SalesProposal_acceptance_state" CHECK (
      ("status" = 'ACEITA' AND "acceptedAt" IS NOT NULL AND "acceptedByUserId" IS NOT NULL)
      OR
      ("status" <> 'ACEITA' AND "acceptedAt" IS NULL AND "acceptedByUserId" IS NULL)
    ),
    CONSTRAINT "SalesProposal_rejection_state" CHECK (
      ("status" = 'RECUSADA' AND "rejectedAt" IS NOT NULL AND "rejectedByUserId" IS NOT NULL AND length(trim("rejectionReason")) > 0)
      OR
      ("status" <> 'RECUSADA' AND "rejectedAt" IS NULL AND "rejectedByUserId" IS NULL AND "rejectionReason" IS NULL)
    )
);

CREATE TABLE "ProposalVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "basePrice" DECIMAL(18,2) NOT NULL,
    "discount" DECIMAL(18,2) NOT NULL,
    "finalPrice" DECIMAL(18,2) NOT NULL,
    "downPayment" DECIMAL(18,2) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "sourcePriceTableId" TEXT,
    "sourcePriceTableName" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProposalVersion_positive_version" CHECK ("version" > 0),
    CONSTRAINT "ProposalVersion_nonnegative_values" CHECK (
      "basePrice" >= 0 AND "discount" >= 0 AND "finalPrice" >= 0 AND "downPayment" >= 0
    ),
    CONSTRAINT "ProposalVersion_price_math" CHECK ("finalPrice" = "basePrice" - "discount"),
    CONSTRAINT "ProposalVersion_down_payment_limit" CHECK ("downPayment" <= "finalPrice")
);

CREATE TABLE "ProposalPaymentCondition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "type" "ProposalPaymentConditionType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "installments" INTEGER,
    "firstDueDate" TIMESTAMP(3),
    "intervalMonths" INTEGER,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalPaymentCondition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProposalPaymentCondition_nonnegative_amount" CHECK ("amount" >= 0),
    CONSTRAINT "ProposalPaymentCondition_positive_installments" CHECK ("installments" IS NULL OR "installments" > 0),
    CONSTRAINT "ProposalPaymentCondition_positive_interval" CHECK ("intervalMonths" IS NULL OR "intervalMonths" > 0),
    CONSTRAINT "ProposalPaymentCondition_nonnegative_position" CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX "SalesProposal_currentVersionId_key" ON "SalesProposal"("currentVersionId");
CREATE INDEX "SalesProposal_organizationId_opportunityId_createdAt_idx" ON "SalesProposal"("organizationId", "opportunityId", "createdAt");
CREATE INDEX "SalesProposal_organizationId_reservationId_createdAt_idx" ON "SalesProposal"("organizationId", "reservationId", "createdAt");
CREATE INDEX "SalesProposal_organizationId_personId_createdAt_idx" ON "SalesProposal"("organizationId", "personId", "createdAt");
CREATE INDEX "SalesProposal_organizationId_unitId_createdAt_idx" ON "SalesProposal"("organizationId", "unitId", "createdAt");
CREATE INDEX "SalesProposal_organizationId_status_validUntil_idx" ON "SalesProposal"("organizationId", "status", "validUntil");
CREATE UNIQUE INDEX "ProposalVersion_proposalId_version_key" ON "ProposalVersion"("proposalId", "version");
CREATE INDEX "ProposalVersion_organizationId_proposalId_createdAt_idx" ON "ProposalVersion"("organizationId", "proposalId", "createdAt");
CREATE INDEX "ProposalPaymentCondition_organizationId_versionId_position_idx" ON "ProposalPaymentCondition"("organizationId", "versionId", "position");

ALTER TABLE "SalesProposal" ADD CONSTRAINT "SalesProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProposal" ADD CONSTRAINT "SalesProposal_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesProposal" ADD CONSTRAINT "SalesProposal_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "UnitReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesProposal" ADD CONSTRAINT "SalesProposal_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesProposal" ADD CONSTRAINT "SalesProposal_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesProposal" ADD CONSTRAINT "SalesProposal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesProposal" ADD CONSTRAINT "SalesProposal_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesProposal" ADD CONSTRAINT "SalesProposal_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesProposal" ADD CONSTRAINT "SalesProposal_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "SalesProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProposalPaymentCondition" ADD CONSTRAINT "ProposalPaymentCondition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposalPaymentCondition" ADD CONSTRAINT "ProposalPaymentCondition_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProposalVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalesProposal" ADD CONSTRAINT "SalesProposal_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ProposalVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
