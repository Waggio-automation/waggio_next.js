/*
  Warnings:

  - The `status` column on the `PayHistory` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "PayHistoryStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'READY', 'SENT');

-- AlterTable
ALTER TABLE "PayHistory" ADD COLUMN     "deliveryStatus" TEXT,
ADD COLUMN     "emailProvider" TEXT,
ADD COLUMN     "emailSentAt" TIMESTAMP(3),
DROP COLUMN "status",
ADD COLUMN     "status" "PayHistoryStatus" NOT NULL DEFAULT 'PENDING';

-- DropEnum
DROP TYPE "PayStatus";
