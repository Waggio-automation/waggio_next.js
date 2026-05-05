/*
  Warnings:

  - You are about to drop the column `basePay` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `holidayHours` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `holidayPay` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `hourlyRateSnapshot` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `includeVacation` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `overtimeHours` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `overtimePay` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `payTypeSnapshot` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `paystubUrl` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `periodEnd` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `periodStart` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `regularHours` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `sentAt` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `vacationPay` on the `PayHistory` table. All the data in the column will be lost.
  - You are about to drop the column `vacationPctSnapshot` on the `PayHistory` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PayHistory" DROP COLUMN "basePay",
DROP COLUMN "holidayHours",
DROP COLUMN "holidayPay",
DROP COLUMN "hourlyRateSnapshot",
DROP COLUMN "includeVacation",
DROP COLUMN "overtimeHours",
DROP COLUMN "overtimePay",
DROP COLUMN "payTypeSnapshot",
DROP COLUMN "paystubUrl",
DROP COLUMN "periodEnd",
DROP COLUMN "periodStart",
DROP COLUMN "regularHours",
DROP COLUMN "sentAt",
DROP COLUMN "vacationPay",
DROP COLUMN "vacationPctSnapshot",
ADD COLUMN     "hoursWorked" DECIMAL(65,30);
