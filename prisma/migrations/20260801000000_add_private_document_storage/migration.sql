-- Add persistent-storage metadata without removing the legacy compatibility field.
ALTER TABLE "Document"
  ADD COLUMN "storageKey" TEXT,
  ADD COLUMN "storageProvider" TEXT,
  ADD COLUMN "originalName" TEXT,
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "size" INTEGER;

-- Existing documents were stored below ./uploads. Keep them addressable by the
-- local driver and turn fileUrl into the authenticated download route.
UPDATE "Document"
SET
  "storageKey" = replace("fileUrl", 'uploads/', ''),
  "storageProvider" = 'local',
  "originalName" = "name",
  "mimeType" = 'application/octet-stream',
  "size" = 0,
  "fileUrl" = '/documents/' || "id" || '/download';

ALTER TABLE "Document"
  ALTER COLUMN "storageKey" SET NOT NULL,
  ALTER COLUMN "storageProvider" SET NOT NULL,
  ALTER COLUMN "originalName" SET NOT NULL,
  ALTER COLUMN "mimeType" SET NOT NULL,
  ALTER COLUMN "size" SET NOT NULL;
