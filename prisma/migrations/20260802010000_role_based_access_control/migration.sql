-- Add internal account roles and lifecycle state while preserving existing access.
CREATE TYPE "UserRole" AS ENUM (
  'OWNER',
  'ADMIN',
  'FINANCEIRO',
  'COMERCIAL',
  'OPERACIONAL',
  'LEITURA'
);

ALTER TABLE "User"
  ADD COLUMN "role" "UserRole",
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "invitedAt" TIMESTAMP(3),
  ADD COLUMN "acceptedAt" TIMESTAMP(3);

-- Legacy accounts had unrestricted access before RBAC and therefore remain owners.
UPDATE "User"
SET
  "role" = 'OWNER',
  "acceptedAt" = "createdAt";

ALTER TABLE "User"
  ALTER COLUMN "role" SET NOT NULL,
  ALTER COLUMN "role" SET DEFAULT 'LEITURA';

CREATE INDEX "User_organizationId_role_idx"
  ON "User"("organizationId", "role");

CREATE INDEX "User_organizationId_isActive_idx"
  ON "User"("organizationId", "isActive");
