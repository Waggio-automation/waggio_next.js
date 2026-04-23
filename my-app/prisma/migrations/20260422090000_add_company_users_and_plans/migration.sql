CREATE TYPE "public"."CompanyPlan" AS ENUM ('BASIC', 'PRO');

CREATE TYPE "public"."CompanyUserRole" AS ENUM ('OWNER', 'ADMIN');

ALTER TABLE "public"."Company"
ADD COLUMN "currentPlan" "public"."CompanyPlan",
ADD COLUMN "planSelectedAt" TIMESTAMP(3);

CREATE TABLE "public"."CompanyUser" (
    "id" BIGSERIAL NOT NULL,
    "companyId" BIGINT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" "public"."CompanyUserRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyUser_email_key" ON "public"."CompanyUser"("email");
CREATE INDEX "CompanyUser_companyId_createdAt_idx" ON "public"."CompanyUser"("companyId", "createdAt");

ALTER TABLE "public"."CompanyUser"
ADD CONSTRAINT "CompanyUser_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
