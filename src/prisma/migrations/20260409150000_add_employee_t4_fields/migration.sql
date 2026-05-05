CREATE TYPE "public"."DentalBenefitsCoverage" AS ENUM (
  'NONE',
  'EMPLOYEE_ONLY',
  'EMPLOYEE_AND_SPOUSE',
  'EMPLOYEE_AND_CHILDREN',
  'EMPLOYEE_AND_FAMILY'
);

ALTER TABLE "public"."Employee"
ADD COLUMN "dentalBenefitsCoverage" "public"."DentalBenefitsCoverage" NOT NULL DEFAULT 'NONE',
ADD COLUMN "rppDpspRegistrationNumber" TEXT,
ADD COLUMN "pensionAdjustmentOverride" DECIMAL(65,30);
