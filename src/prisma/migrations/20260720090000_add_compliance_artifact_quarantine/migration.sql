ALTER TYPE "public"."RemittanceStatus" ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';
ALTER TYPE "public"."T4GenerationStatus" ADD VALUE IF NOT EXISTS 'QUARANTINED';

CREATE TYPE "public"."ArtifactValidationStatus" AS ENUM ('ACTIVE', 'QUARANTINED');

ALTER TABLE "public"."Remittance"
  ADD COLUMN "reconciliationSummary" JSONB,
  ADD COLUMN "reviewRequiredAt" TIMESTAMP(3);

ALTER TABLE "public"."T4Slip"
  ADD COLUMN "generationId" TEXT,
  ADD COLUMN "generationVersion" TEXT,
  ADD COLUMN "validatedAt" TIMESTAMP(3);

ALTER TABLE "public"."T4Summary"
  ADD COLUMN "generationId" TEXT,
  ADD COLUMN "generationVersion" TEXT,
  ADD COLUMN "validationSummary" JSONB,
  ADD COLUMN "validatedAt" TIMESTAMP(3);

ALTER TABLE "public"."Document"
  ADD COLUMN "validationStatus" "public"."ArtifactValidationStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "validationReason" TEXT,
  ADD COLUMN "generationId" TEXT,
  ADD COLUMN "generationVersion" TEXT,
  ADD COLUMN "quarantinedAt" TIMESTAMP(3);

CREATE INDEX "Document_companyId_validationStatus_uploadedAt_idx"
  ON "public"."Document"("companyId", "validationStatus", "uploadedAt");
