ALTER TABLE "public"."Employee"
RENAME COLUMN "stripeAccountId" TO "trolleyRecipientId";

DROP INDEX IF EXISTS "public"."Employee_stripeAccountId_key";

ALTER TABLE "public"."Employee"
ADD COLUMN "trolleyRecipientAccountId" TEXT,
ADD COLUMN "trolleyRecipientAccountType" TEXT;

CREATE UNIQUE INDEX "Employee_trolleyRecipientId_key"
ON "public"."Employee"("trolleyRecipientId");

CREATE UNIQUE INDEX "Employee_trolleyRecipientAccountId_key"
ON "public"."Employee"("trolleyRecipientAccountId");

DROP INDEX IF EXISTS "public"."CompanySettings_stripeAccountId_key";

ALTER TABLE "public"."CompanySettings"
DROP COLUMN IF EXISTS "stripeAccountId",
DROP COLUMN IF EXISTS "stripeCustomerId",
DROP COLUMN IF EXISTS "fundingPaymentMethodId",
ADD COLUMN "defaultPayoutCurrency" TEXT NOT NULL DEFAULT 'CAD',
ADD COLUMN "defaultPayoutCountry" TEXT NOT NULL DEFAULT 'CA',
ADD COLUMN "trolleyBatchPrefix" TEXT;
