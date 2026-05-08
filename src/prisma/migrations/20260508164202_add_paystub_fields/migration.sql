-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "addrCity" TEXT,
ADD COLUMN     "addrLine1" TEXT,
ADD COLUMN     "addrLine2" TEXT,
ADD COLUMN     "addrPostal" TEXT,
ADD COLUMN     "addrProvince" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "bankAccount" TEXT,
ADD COLUMN     "bankTransit" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "employeeNumber" TEXT,
ADD COLUMN     "jobTitle" TEXT;

-- AlterTable
ALTER TABLE "PayHistory" ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3),
ADD COLUMN     "sequenceNumber" TEXT;
