CREATE TYPE "ProviderVerificationStatus" AS ENUM (
  'UNVERIFIED',
  'LEGACY_UNVERIFIED',
  'VERIFIED',
  'RETRYABLE_FAILURE',
  'REVIEW_REQUIRED'
);

CREATE TYPE "ProviderVerificationAttemptOutcome" AS ENUM (
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'REVIEW_REQUIRED'
);

ALTER TABLE "PayrollRun"
  ADD COLUMN "providerVerificationLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "providerVerificationLastSucceededAt" TIMESTAMP(3),
  ADD COLUMN "providerVerificationFailureCode" TEXT,
  ADD COLUMN "providerVerificationConsecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "providerVerificationStatus" "ProviderVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "providerEvidenceVersion" TEXT;

UPDATE "PayrollRun"
   SET "providerVerificationStatus" = 'LEGACY_UNVERIFIED'
 WHERE "status" = 'PAID';

CREATE TABLE "PayrollProviderVerificationAttempt" (
  "id" BIGSERIAL NOT NULL,
  "companyId" BIGINT NOT NULL,
  "payrollRunId" BIGINT NOT NULL,
  "jobName" TEXT NOT NULL,
  "outcome" "ProviderVerificationAttemptOutcome" NOT NULL,
  "failureCode" TEXT,
  "providerEvidenceVersion" TEXT,
  "attemptedProviderRequests" INTEGER NOT NULL DEFAULT 0,
  "successfulProviderRequests" INTEGER NOT NULL DEFAULT 0,
  "timedOutRequests" INTEGER NOT NULL DEFAULT 0,
  "rateLimitedRequests" INTEGER NOT NULL DEFAULT 0,
  "pagesFetched" INTEGER NOT NULL DEFAULT 0,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PayrollProviderVerificationAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollProviderVerificationAttempt_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PayrollProviderVerificationAttempt_payrollRunId_fkey"
    FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PayrollProviderVerificationAttempt_companyId_completedAt_idx"
  ON "PayrollProviderVerificationAttempt"("companyId", "completedAt");
CREATE INDEX "PayrollProviderVerificationAttempt_payrollRunId_completedAt_idx"
  ON "PayrollProviderVerificationAttempt"("payrollRunId", "completedAt");
CREATE INDEX "PayrollProviderVerificationAttempt_outcome_completedAt_idx"
  ON "PayrollProviderVerificationAttempt"("outcome", "completedAt");

-- Existing PAID rows are explicitly LEGACY_UNVERIFIED. Historical success is
-- not inferred from providerRef, child status, paidAt, or legacy CRA artifacts.
