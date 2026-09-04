CREATE TYPE "NotificationStatus" AS ENUM ('PENDENTE', 'ENVIADO', 'FALHOU', 'LIDO');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDENTE', 'ENVIADO', 'FALHOU');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'FALHOU_PERMANENTEMENTE');

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "recipientType" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "data" JSONB,
  "type" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDENTE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "recipientType" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "internal" BOOLEAN NOT NULL DEFAULT true,
  "email" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "provider" TEXT,
  "providerId" TEXT,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDENTE',
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationOutbox" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDENTE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");
CREATE INDEX "Notification_recipientType_recipientId_status_idx" ON "Notification"("recipientType", "recipientId", "status");
CREATE INDEX "Notification_type_status_idx" ON "Notification"("type", "status");
CREATE UNIQUE INDEX "NotifPref_recipient_type_key" ON "NotificationPreference"("organizationId", "recipientType", "recipientId", "type");
CREATE INDEX "NotifPref_recipient_idx" ON "NotificationPreference"("organizationId", "recipientType", "recipientId");
CREATE INDEX "NotificationDelivery_notificationId_status_idx" ON "NotificationDelivery"("notificationId", "status");
CREATE INDEX "NotificationDelivery_provider_providerId_idx" ON "NotificationDelivery"("provider", "providerId");
CREATE UNIQUE INDEX "NotificationOutbox_notificationId_key" ON "NotificationOutbox"("notificationId");
CREATE INDEX "NotificationOutbox_organizationId_status_idx" ON "NotificationOutbox"("organizationId", "status");
CREATE INDEX "NotificationOutbox_nextAttemptAt_idx" ON "NotificationOutbox"("nextAttemptAt");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
