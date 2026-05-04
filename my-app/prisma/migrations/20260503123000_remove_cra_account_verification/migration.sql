ALTER TABLE "public"."CompanyPayrollSettings"
DROP COLUMN "craAccountVerificationStatus",
DROP COLUMN "craAccountVerifiedAt",
DROP COLUMN "craAccountVerificationSource",
DROP COLUMN "craAccountRejectedReason";

DROP TYPE "public"."CraAccountVerificationStatus";
