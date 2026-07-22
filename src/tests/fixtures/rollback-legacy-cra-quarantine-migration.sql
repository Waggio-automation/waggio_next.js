DROP INDEX IF EXISTS "public"."Document_one_active_remittance_report_idx";

ALTER TABLE "public"."Remittance"
  DROP COLUMN IF EXISTS "sourceFingerprint",
  DROP COLUMN IF EXISTS "sourceVersion",
  DROP COLUMN IF EXISTS "reportPublishedAt";

DELETE FROM "public"."_prisma_migrations"
 WHERE "migration_name" = '20260720120000_quarantine_legacy_cra_artifacts';
