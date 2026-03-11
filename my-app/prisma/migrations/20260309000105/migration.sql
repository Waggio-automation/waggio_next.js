/*
  Warnings:

  - A unique constraint covering the columns `[companyId]` on the table `CompanySettings` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "PayrollRunStatus" ADD VALUE 'PROCESSED';

-- CreateIndex
CREATE UNIQUE INDEX "CompanySettings_companyId_key" ON "CompanySettings"("companyId");
