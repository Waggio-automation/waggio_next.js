-- CreateEnum
CREATE TYPE "public"."PayoutSetupStatus" AS ENUM ('REQUIRED', 'PENDING', 'READY', 'ISSUE');

-- CreateEnum
CREATE TYPE "public"."PayrollRunStatus" AS ENUM ('SCHEDULED', 'FUNDING', 'FUNDS_CONFIRMED', 'PAYING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."PayrollFailureType" AS ENUM ('FUNDING', 'EMPLOYEE');

-- AlterTable
ALTER TABLE "public"."Employee"
ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "payoutEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payoutSetupStatus" "public"."PayoutSetupStatus" NOT NULL DEFAULT 'REQUIRED',
DROP COLUMN    "bankName",
DROP COLUMN    "bankAccount",
DROP COLUMN    "transitNumber",
DROP COLUMN    "institutionNumber";

-- AlterTable
ALTER TABLE "public"."PayHistory"
ADD COLUMN     "payrollRunId" BIGINT;

-- CreateTable
CREATE TABLE "public"."PayrollRun" (
    "id" BIGSERIAL NOT NULL,
    "payDate" TIMESTAMP(3) NOT NULL,
    "status" "public"."PayrollRunStatus" NOT NULL DEFAULT 'SCHEDULED',
    "failureType" "public"."PayrollFailureType",
    "failureReason" TEXT,
    "providerRef" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_stripeAccountId_key" ON "public"."Employee"("stripeAccountId");

-- CreateIndex
CREATE INDEX "PayHistory_payrollRunId_idx" ON "public"."PayHistory"("payrollRunId");

-- CreateIndex
CREATE INDEX "PayrollRun_payDate_status_idx" ON "public"."PayrollRun"("payDate", "status");

-- AddForeignKey
ALTER TABLE "public"."PayHistory" ADD CONSTRAINT "PayHistory_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "public"."PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
