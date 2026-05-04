CREATE TYPE "public"."CraAccountVerificationStatus" AS ENUM ('UNVERIFIED', 'USER_CONFIRMED', 'CRA_ACCEPTED', 'REJECTED');

ALTER TABLE "public"."CompanyPayrollSettings"
ADD COLUMN "craAccountVerificationStatus" "public"."CraAccountVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN "craAccountVerifiedAt" TIMESTAMP(3),
ADD COLUMN "craAccountVerificationSource" TEXT,
ADD COLUMN "craAccountRejectedReason" TEXT;
