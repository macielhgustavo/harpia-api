-- CreateTable
CREATE TABLE "UserInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserInvitation_email_normalized_check" CHECK (
        "email" = LOWER(BTRIM("email")) AND CHAR_LENGTH("email") > 0
    ),
    CONSTRAINT "UserInvitation_terminal_state_check" CHECK (
        NOT ("acceptedAt" IS NOT NULL AND "revokedAt" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "UserInvitation_tokenHash_key" ON "UserInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "UserInvitation_organizationId_createdAt_idx" ON "UserInvitation"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "UserInvitation_organizationId_email_idx" ON "UserInvitation"("organizationId", "email");

-- CreateIndex
CREATE INDEX "UserInvitation_email_acceptedAt_revokedAt_expiresAt_idx" ON "UserInvitation"("email", "acceptedAt", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "UserInvitation_expiresAt_idx" ON "UserInvitation"("expiresAt");

-- CreateIndex
CREATE INDEX "UserInvitation_invitedById_idx" ON "UserInvitation"("invitedById");

-- AddForeignKey
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
