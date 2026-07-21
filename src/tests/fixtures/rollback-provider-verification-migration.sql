DROP TABLE IF EXISTS "public"."PayrollProviderVerificationAttempt";

ALTER TABLE "public"."PayrollRun"
  DROP COLUMN IF EXISTS "providerVerificationLastAttemptAt",
  DROP COLUMN IF EXISTS "providerVerificationLastSucceededAt",
  DROP COLUMN IF EXISTS "providerVerificationFailureCode",
  DROP COLUMN IF EXISTS "providerVerificationConsecutiveFailures",
  DROP COLUMN IF EXISTS "providerVerificationStatus",
  DROP COLUMN IF EXISTS "providerEvidenceVersion";

DROP TYPE IF EXISTS "public"."ProviderVerificationAttemptOutcome";
DROP TYPE IF EXISTS "public"."ProviderVerificationStatus";

DELETE FROM "public"."_prisma_migrations"
 WHERE "migration_name" = '20260720140000_add_provider_verification_evidence';
