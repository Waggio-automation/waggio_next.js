/*
  Warnings:

  - The values [PAID] on the enum `PayStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PayStatus_new" AS ENUM ('PENDING', 'PROCESSED', 'SENT');
ALTER TABLE "public"."PayHistory" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PayHistory" ALTER COLUMN "status" TYPE "PayStatus_new" USING ("status"::text::"PayStatus_new");
ALTER TYPE "PayStatus" RENAME TO "PayStatus_old";
ALTER TYPE "PayStatus_new" RENAME TO "PayStatus";
DROP TYPE "public"."PayStatus_old";
ALTER TABLE "PayHistory" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;
