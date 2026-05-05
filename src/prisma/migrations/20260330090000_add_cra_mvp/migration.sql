-- CreateEnum
CREATE TYPE "public"."RemitterType" AS ENUM ('MONTHLY', 'QUARTERLY', 'ACCELERATED_THRESHOLD_1', 'ACCELERATED_THRESHOLD_2');

-- CreateEnum
CREATE TYPE "public"."RemittanceStatus" AS ENUM ('DUE', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "public"."RemittancePaymentStatus" AS ENUM ('RECORDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "public"."T4GenerationStatus" AS ENUM ('NOT_GENERATED', 'GENERATED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "public"."ReminderState" AS ENUM ('UPCOMING', 'DUE_TODAY', 'OVERDUE', 'PAID_NO_REMINDER');

-- CreateEnum
CREATE TYPE "public"."DocumentType" AS ENUM ('REMITTANCE_REPORT', 'REMITTANCE_PAYMENT_PROOF', 'T4_SLIP', 'T4_SUMMARY', 'OWNER_UPLOADED_RECEIPT', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."LinkedEntityType" AS ENUM ('REMITTANCE', 'REMITTANCE_PAYMENT', 'T4_SLIP', 'T4_SUMMARY', 'COMPANY');

-- CreateTable
CREATE TABLE "public"."CompanyPayrollSettings" (
    "id" BIGSERIAL NOT NULL,
    "companyId" BIGINT NOT NULL,
    "legalName" TEXT,
    "businessNumber" TEXT,
    "payrollProgramAccount" TEXT,
    "remitterType" "public"."RemitterType" NOT NULL DEFAULT 'MONTHLY',
    "contactEmail" TEXT,
    "preDueReminderDays" INTEGER NOT NULL DEFAULT 7,
    "postDueReminderFrequencyDays" INTEGER NOT NULL DEFAULT 7,
    "firstRemittancePeriodStart" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPayrollSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Remittance" (
    "id" BIGSERIAL NOT NULL,
    "companyId" BIGINT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "remitterTypeSnapshot" "public"."RemitterType" NOT NULL,
    "status" "public"."RemittanceStatus" NOT NULL DEFAULT 'DUE',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "totalIncomeTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalCppEmployee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalCppEmployer" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalEiEmployee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalEiEmployer" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalPayable" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Remittance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RemittancePayHistory" (
    "remittanceId" BIGINT NOT NULL,
    "payHistoryId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemittancePayHistory_pkey" PRIMARY KEY ("remittanceId","payHistoryId")
);

-- CreateTable
CREATE TABLE "public"."RemittancePayment" (
    "id" BIGSERIAL NOT NULL,
    "remittanceId" BIGINT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amountPaid" DECIMAL(65,30) NOT NULL,
    "paymentMethod" TEXT,
    "referenceNumber" TEXT,
    "status" "public"."RemittancePaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemittancePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."T4Slip" (
    "id" BIGSERIAL NOT NULL,
    "companyId" BIGINT NOT NULL,
    "employeeId" BIGINT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "status" "public"."T4GenerationStatus" NOT NULL DEFAULT 'NOT_GENERATED',
    "employmentIncome" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "incomeTaxDeducted" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cppContributionsEmployee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "eiPremiumsEmployee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "otherBoxPayload" JSONB,
    "generatedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "summaryId" BIGINT,

    CONSTRAINT "T4Slip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."T4Summary" (
    "id" BIGSERIAL NOT NULL,
    "companyId" BIGINT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "status" "public"."T4GenerationStatus" NOT NULL DEFAULT 'NOT_GENERATED',
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "totalEmploymentIncome" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalIncomeTaxDeducted" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalCppEmployee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalEiEmployee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "T4Summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReminderEvent" (
    "id" BIGSERIAL NOT NULL,
    "companyId" BIGINT NOT NULL,
    "remittanceId" BIGINT,
    "reminderState" "public"."ReminderState" NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "channel" TEXT NOT NULL DEFAULT 'dashboard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Document" (
    "id" BIGSERIAL NOT NULL,
    "companyId" BIGINT NOT NULL,
    "documentType" "public"."DocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/json',
    "linkedEntityType" "public"."LinkedEntityType" NOT NULL,
    "linkedEntityId" BIGINT NOT NULL,
    "taxYear" INTEGER,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remittanceId" BIGINT,
    "remittancePaymentId" BIGINT,
    "t4SlipId" BIGINT,
    "t4SummaryId" BIGINT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "companyId" BIGINT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPayrollSettings_companyId_key" ON "public"."CompanyPayrollSettings"("companyId");
CREATE UNIQUE INDEX "Remittance_companyId_periodStart_periodEnd_key" ON "public"."Remittance"("companyId", "periodStart", "periodEnd");
CREATE UNIQUE INDEX "RemittancePayHistory_payHistoryId_key" ON "public"."RemittancePayHistory"("payHistoryId");
CREATE UNIQUE INDEX "T4Slip_companyId_employeeId_taxYear_key" ON "public"."T4Slip"("companyId", "employeeId", "taxYear");
CREATE UNIQUE INDEX "T4Summary_companyId_taxYear_key" ON "public"."T4Summary"("companyId", "taxYear");
CREATE INDEX "Remittance_companyId_dueDate_status_idx" ON "public"."Remittance"("companyId", "dueDate", "status");
CREATE INDEX "RemittancePayment_remittanceId_paymentDate_idx" ON "public"."RemittancePayment"("remittanceId", "paymentDate");
CREATE INDEX "T4Slip_companyId_taxYear_status_idx" ON "public"."T4Slip"("companyId", "taxYear", "status");
CREATE INDEX "ReminderEvent_companyId_scheduledFor_idx" ON "public"."ReminderEvent"("companyId", "scheduledFor");
CREATE INDEX "ReminderEvent_remittanceId_reminderState_idx" ON "public"."ReminderEvent"("remittanceId", "reminderState");
CREATE INDEX "Document_companyId_documentType_uploadedAt_idx" ON "public"."Document"("companyId", "documentType", "uploadedAt");
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "public"."AuditLog"("companyId", "createdAt");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "public"."AuditLog"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "public"."CompanyPayrollSettings"
ADD CONSTRAINT "CompanyPayrollSettings_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."Remittance"
ADD CONSTRAINT "Remittance_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."RemittancePayHistory"
ADD CONSTRAINT "RemittancePayHistory_remittanceId_fkey"
FOREIGN KEY ("remittanceId") REFERENCES "public"."Remittance"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."RemittancePayHistory"
ADD CONSTRAINT "RemittancePayHistory_payHistoryId_fkey"
FOREIGN KEY ("payHistoryId") REFERENCES "public"."PayHistory"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."RemittancePayment"
ADD CONSTRAINT "RemittancePayment_remittanceId_fkey"
FOREIGN KEY ("remittanceId") REFERENCES "public"."Remittance"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."T4Slip"
ADD CONSTRAINT "T4Slip_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."T4Slip"
ADD CONSTRAINT "T4Slip_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."T4Slip"
ADD CONSTRAINT "T4Slip_summaryId_fkey"
FOREIGN KEY ("summaryId") REFERENCES "public"."T4Summary"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."T4Summary"
ADD CONSTRAINT "T4Summary_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ReminderEvent"
ADD CONSTRAINT "ReminderEvent_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ReminderEvent"
ADD CONSTRAINT "ReminderEvent_remittanceId_fkey"
FOREIGN KEY ("remittanceId") REFERENCES "public"."Remittance"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."Document"
ADD CONSTRAINT "Document_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."Document"
ADD CONSTRAINT "Document_remittanceId_fkey"
FOREIGN KEY ("remittanceId") REFERENCES "public"."Remittance"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."Document"
ADD CONSTRAINT "Document_remittancePaymentId_fkey"
FOREIGN KEY ("remittancePaymentId") REFERENCES "public"."RemittancePayment"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."Document"
ADD CONSTRAINT "Document_t4SlipId_fkey"
FOREIGN KEY ("t4SlipId") REFERENCES "public"."T4Slip"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."Document"
ADD CONSTRAINT "Document_t4SummaryId_fkey"
FOREIGN KEY ("t4SummaryId") REFERENCES "public"."T4Summary"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AuditLog"
ADD CONSTRAINT "AuditLog_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
