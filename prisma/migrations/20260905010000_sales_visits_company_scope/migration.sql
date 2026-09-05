ALTER TABLE "SalesVisit"
ADD COLUMN IF NOT EXISTS "companyId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'SalesVisit_companyId_fkey'
      AND conrelid = '"SalesVisit"'::regclass
  ) THEN
    ALTER TABLE "SalesVisit"
    ADD CONSTRAINT "SalesVisit_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
