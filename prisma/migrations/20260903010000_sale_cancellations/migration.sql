CREATE TABLE "SaleCancellation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "cancelledByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaleCancellation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SaleCancellation_saleId_key" ON "SaleCancellation"("saleId");
CREATE INDEX "SaleCancellation_organizationId_createdAt_idx" ON "SaleCancellation"("organizationId", "createdAt");
CREATE INDEX "SaleCancellation_organizationId_cancelledByUserId_idx" ON "SaleCancellation"("organizationId", "cancelledByUserId");

ALTER TABLE "SaleCancellation" ADD CONSTRAINT "SaleCancellation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleCancellation" ADD CONSTRAINT "SaleCancellation_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleCancellation" ADD CONSTRAINT "SaleCancellation_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
