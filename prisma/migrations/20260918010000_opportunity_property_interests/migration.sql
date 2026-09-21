CREATE TYPE "PropertyInterestPurpose" AS ENUM (
  'MORADIA',
  'INVESTIMENTO',
  'SEGUNDA_MORADIA',
  'OUTRO'
);

CREATE TABLE "OpportunityPropertyInterest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "developmentId" TEXT,
  "unitTypeId" TEXT,
  "minBedrooms" INTEGER,
  "maxBedrooms" INTEGER,
  "minArea" DOUBLE PRECISION,
  "maxArea" DOUBLE PRECISION,
  "minPrice" DECIMAL(18,2),
  "maxPrice" DECIMAL(18,2),
  "availableDownPayment" DECIMAL(18,2),
  "purpose" "PropertyInterestPurpose",
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OpportunityPropertyInterest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpportunityPropertyInterest_bedrooms_nonnegative_check"
    CHECK (("minBedrooms" IS NULL OR "minBedrooms" >= 0) AND ("maxBedrooms" IS NULL OR "maxBedrooms" >= 0)),
  CONSTRAINT "OpportunityPropertyInterest_bedrooms_range_check"
    CHECK ("minBedrooms" IS NULL OR "maxBedrooms" IS NULL OR "minBedrooms" <= "maxBedrooms"),
  CONSTRAINT "OpportunityPropertyInterest_area_nonnegative_check"
    CHECK (("minArea" IS NULL OR "minArea" >= 0) AND ("maxArea" IS NULL OR "maxArea" >= 0)),
  CONSTRAINT "OpportunityPropertyInterest_area_range_check"
    CHECK ("minArea" IS NULL OR "maxArea" IS NULL OR "minArea" <= "maxArea"),
  CONSTRAINT "OpportunityPropertyInterest_price_nonnegative_check"
    CHECK (("minPrice" IS NULL OR "minPrice" >= 0) AND ("maxPrice" IS NULL OR "maxPrice" >= 0) AND ("availableDownPayment" IS NULL OR "availableDownPayment" >= 0)),
  CONSTRAINT "OpportunityPropertyInterest_price_range_check"
    CHECK ("minPrice" IS NULL OR "maxPrice" IS NULL OR "minPrice" <= "maxPrice")
);

CREATE UNIQUE INDEX "OpportunityPropertyInterest_opportunityId_key"
  ON "OpportunityPropertyInterest"("opportunityId");
CREATE INDEX "OpportunityPropertyInterest_organizationId_opportunityId_idx"
  ON "OpportunityPropertyInterest"("organizationId", "opportunityId");
CREATE INDEX "OpportunityPropertyInterest_developmentId_organizationId_idx"
  ON "OpportunityPropertyInterest"("developmentId", "organizationId");
CREATE INDEX "OpportunityPropertyInterest_unitTypeId_organizationId_idx"
  ON "OpportunityPropertyInterest"("unitTypeId", "organizationId");

ALTER TABLE "OpportunityPropertyInterest"
  ADD CONSTRAINT "OpportunityPropertyInterest_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpportunityPropertyInterest"
  ADD CONSTRAINT "OpportunityPropertyInterest_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpportunityPropertyInterest"
  ADD CONSTRAINT "OpportunityPropertyInterest_developmentId_fkey"
  FOREIGN KEY ("developmentId") REFERENCES "Development"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OpportunityPropertyInterest"
  ADD CONSTRAINT "OpportunityPropertyInterest_unitTypeId_fkey"
  FOREIGN KEY ("unitTypeId") REFERENCES "UnitType"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
