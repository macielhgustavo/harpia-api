-- CreateTable: MonetaryIndex
CREATE TABLE "MonetaryIndex" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "periodicity" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonetaryIndex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: MonetaryIndex_organizationId_name_key
CREATE UNIQUE INDEX "MonetaryIndex_organizationId_name_key" ON "MonetaryIndex"("organizationId", "name");

-- CreateIndex: MonetaryIndex_organizationId_code_key
CREATE UNIQUE INDEX "MonetaryIndex_organizationId_code_key" ON "MonetaryIndex"("organizationId", "code");

-- CreateIndex: MonetaryIndex_organizationId_active_index
CREATE INDEX "MonetaryIndex_organizationId_active_index" ON "MonetaryIndex"("organizationId", "active");

-- AddForeignKey: MonetaryIndex_organizationId_fkey
ALTER TABLE "MonetaryIndex" ADD CONSTRAINT "MonetaryIndex_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: MonetaryIndexValue
CREATE TABLE "MonetaryIndexValue" (
  "id" TEXT NOT NULL,
  "monetaryIndexId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "competence" TIMESTAMP(3) NOT NULL,
  "percentage" DECIMAL(5,4) NOT NULL,
  "source" TEXT,
  "publishedAt" TIMESTAMP(3),
  "responsibleId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonetaryIndexValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: MonetaryIndexValue_organizationId_monetaryIndexId_competence_key
CREATE UNIQUE INDEX "MonetaryIndexValue_organizationId_monetaryIndexId_competence_key" ON "MonetaryIndexValue"("organizationId", "monetaryIndexId", "competence");

-- AddForeignKey: MonetaryIndexValue_monetaryIndexId_fkey
ALTER TABLE "MonetaryIndexValue" ADD CONSTRAINT "MonetaryIndexValue_monetaryIndexId_fkey" FOREIGN KEY ("monetaryIndexId") REFERENCES "MonetaryIndex"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: MonetaryIndexValue_organizationId_fkey
ALTER TABLE "MonetaryIndexValue" ADD CONSTRAINT "MonetaryIndexValue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: MonetaryIndexValue_responsibleId_fkey
ALTER TABLE "MonetaryIndexValue" ADD CONSTRAINT "MonetaryIndexValue_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: ReceivableAdjustmentPolicy
CREATE TABLE "ReceivableAdjustmentPolicy" (
  "id" TEXT NOT NULL,
  "receivableId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "monetaryIndexId" TEXT NOT NULL,
  "baseDate" TIMESTAMP(3) NOT NULL,
  "periodicity" TEXT NOT NULL,
  "lag" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReceivableAdjustmentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: ReceivableAdjustmentPolicy_organizationId_receivableId_key
CREATE UNIQUE INDEX "ReceivableAdjustmentPolicy_organizationId_receivableId_key" ON "ReceivableAdjustmentPolicy"("organizationId", "receivableId");

-- AddForeignKey: ReceivableAdjustmentPolicy_receivableId_fkey
ALTER TABLE "ReceivableAdjustmentPolicy" ADD CONSTRAINT "ReceivableAdjustmentPolicy_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ReceivableAdjustmentPolicy_organizationId_fkey
ALTER TABLE "ReceivableAdjustmentPolicy" ADD CONSTRAINT "ReceivableAdjustmentPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ReceivableAdjustmentPolicy_monetaryIndexId_fkey
ALTER TABLE "ReceivableAdjustmentPolicy" ADD CONSTRAINT "ReceivableAdjustmentPolicy_monetaryIndexId_fkey" FOREIGN KEY ("monetaryIndexId") REFERENCES "MonetaryIndex"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: ReceivableAdjustment
CREATE TABLE "ReceivableAdjustment" (
  "id" TEXT NOT NULL,
  "receivableId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "previousAmount" DECIMAL(18,2) NOT NULL,
  "adjustedAmount" DECIMAL(18,2) NOT NULL,
  "difference" DECIMAL(18,2) NOT NULL,
  "startCompetence" TIMESTAMP(3) NOT NULL,
  "endCompetence" TIMESTAMP(3) NOT NULL,
  "indexValues" JSONB,
  "appliedAt" TIMESTAMP(3),
  "appliedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReceivableAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: ReceivableAdjustment_organizationId_receivableId_appliedAt_index
CREATE INDEX "ReceivableAdjustment_organizationId_receivableId_appliedAt_index" ON "ReceivableAdjustment"("organizationId", "receivableId", "appliedAt");

-- AddForeignKey: ReceivableAdjustment_receivableId_fkey
ALTER TABLE "ReceivableAdjustment" ADD CONSTRAINT "ReceivableAdjustment_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ReceivableAdjustment_organizationId_fkey
ALTER TABLE "ReceivableAdjustment" ADD CONSTRAINT "ReceivableAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ReceivableAdjustment_appliedById_fkey
ALTER TABLE "ReceivableAdjustment" ADD CONSTRAINT "ReceivableAdjustment_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
