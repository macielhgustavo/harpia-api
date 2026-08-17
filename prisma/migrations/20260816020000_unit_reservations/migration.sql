CREATE TYPE "UnitReservationStatus" AS ENUM ('ATIVA', 'CANCELADA', 'EXPIRADA', 'CONVERTIDA');

CREATE TABLE "UnitReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "UnitReservationStatus" NOT NULL DEFAULT 'ATIVA',
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancellationReason" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UnitReservation_valid_expiration" CHECK ("expiresAt" > "startsAt"),
    CONSTRAINT "UnitReservation_cancellation_state" CHECK (
      ("status" = 'CANCELADA' AND "cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL AND length(trim("cancellationReason")) > 0)
      OR
      ("status" <> 'CANCELADA' AND "cancelledAt" IS NULL AND "cancelledByUserId" IS NULL AND "cancellationReason" IS NULL)
    ),
    CONSTRAINT "UnitReservation_conversion_state" CHECK (
      ("status" = 'CONVERTIDA' AND "convertedAt" IS NOT NULL AND "convertedByUserId" IS NOT NULL)
      OR
      ("status" <> 'CONVERTIDA' AND "convertedAt" IS NULL AND "convertedByUserId" IS NULL)
    )
);

CREATE UNIQUE INDEX "UnitReservation_one_active_per_unit" ON "UnitReservation"("unitId") WHERE "status" = 'ATIVA';
CREATE INDEX "UnitReservation_organizationId_status_expiresAt_idx" ON "UnitReservation"("organizationId", "status", "expiresAt");
CREATE INDEX "UnitReservation_organizationId_unitId_createdAt_idx" ON "UnitReservation"("organizationId", "unitId", "createdAt");
CREATE INDEX "UnitReservation_organizationId_personId_createdAt_idx" ON "UnitReservation"("organizationId", "personId", "createdAt");
CREATE INDEX "UnitReservation_organizationId_opportunityId_createdAt_idx" ON "UnitReservation"("organizationId", "opportunityId", "createdAt");

ALTER TABLE "UnitReservation" ADD CONSTRAINT "UnitReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitReservation" ADD CONSTRAINT "UnitReservation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnitReservation" ADD CONSTRAINT "UnitReservation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnitReservation" ADD CONSTRAINT "UnitReservation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UnitReservation" ADD CONSTRAINT "UnitReservation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnitReservation" ADD CONSTRAINT "UnitReservation_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnitReservation" ADD CONSTRAINT "UnitReservation_convertedByUserId_fkey" FOREIGN KEY ("convertedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
