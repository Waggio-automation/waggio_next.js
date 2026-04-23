ALTER TABLE "public"."PayrollRun"
ADD COLUMN "billingMonthKey" TEXT,
ADD COLUMN "extraRunSequence" INTEGER,
ADD COLUMN "extraRunFeeCents" INTEGER,
ADD COLUMN "extraRunInvoiceItemId" TEXT,
ADD COLUMN "extraRunBilledAt" TIMESTAMP(3),
ADD COLUMN "extraRunBillingError" TEXT;

CREATE INDEX "PayrollRun_companyId_billingMonthKey_idx" ON "public"."PayrollRun"("companyId", "billingMonthKey");
