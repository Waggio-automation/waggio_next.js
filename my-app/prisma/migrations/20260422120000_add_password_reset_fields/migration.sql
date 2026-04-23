ALTER TABLE "public"."CompanyUser"
ADD COLUMN "passwordResetTokenHash" TEXT,
ADD COLUMN "passwordResetRequestedAt" TIMESTAMP(3);
