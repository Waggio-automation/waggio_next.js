-- AlterTable
ALTER TABLE "PayrollRun"
ADD COLUMN "sendAt" TIMESTAMP(3);

-- Backfill existing sendAt values from meta JSON when present
UPDATE "PayrollRun"
SET "sendAt" = ("meta"::jsonb ->> 'sendAt')::timestamp
WHERE "sendAt" IS NULL
  AND "meta" IS NOT NULL
  AND ("meta"::jsonb ? 'sendAt')
  AND NULLIF("meta"::jsonb ->> 'sendAt', '') IS NOT NULL;

-- CreateIndex
CREATE INDEX "PayrollRun_sendAt_idx" ON "PayrollRun"("sendAt");
