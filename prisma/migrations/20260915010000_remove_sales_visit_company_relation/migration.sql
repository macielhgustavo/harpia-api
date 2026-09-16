DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'SalesVisit'
      AND column_name = 'companyId'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM "SalesVisit"
      WHERE "companyId" IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'Cannot remove SalesVisit.companyId while non-null values exist',
        HINT = 'Review the documented CRM-FIX-07 read-only query before retrying the migration.';
    END IF;
  END IF;
END $$;

ALTER TABLE "SalesVisit"
DROP CONSTRAINT IF EXISTS "SalesVisit_companyId_fkey";

ALTER TABLE "SalesVisit"
DROP COLUMN IF EXISTS "companyId";
