-- CreateTable
CREATE TABLE "public"."Company" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT,
    "adminEmail" TEXT NOT NULL,
    "adminTokenHash" TEXT,
    "adminTokenCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "public"."Employee" ADD COLUMN     "companyId" BIGINT;

-- AlterTable
ALTER TABLE "public"."CompanySettings"
ADD COLUMN     "companyId" BIGINT,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "fundingPaymentMethodId" TEXT;

-- CreateIndex
CREATE INDEX "Employee_companyId_idx" ON "public"."Employee"("companyId");

-- CreateIndex
CREATE INDEX "CompanySettings_companyId_idx" ON "public"."CompanySettings"("companyId");

-- AddForeignKey
ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CompanySettings" ADD CONSTRAINT "CompanySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
