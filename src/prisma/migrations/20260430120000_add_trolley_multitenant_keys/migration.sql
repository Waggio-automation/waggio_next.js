ALTER TABLE "public"."Company"
ADD COLUMN "trolleyTenantKey" TEXT;

ALTER TABLE "public"."Employee"
ADD COLUMN "trolleyReferenceId" TEXT;

UPDATE "public"."Company"
SET "trolleyTenantKey" = 'company-' || "id"::text
WHERE "trolleyTenantKey" IS NULL;

UPDATE "public"."Employee"
SET "trolleyReferenceId" = 'company:' || COALESCE("companyId"::text, 'unassigned') || ':employee:' || "id"::text
WHERE "trolleyReferenceId" IS NULL;

CREATE UNIQUE INDEX "Company_trolleyTenantKey_key"
ON "public"."Company"("trolleyTenantKey");

CREATE UNIQUE INDEX "Employee_trolleyReferenceId_key"
ON "public"."Employee"("trolleyReferenceId");

CREATE INDEX "Employee_companyId_trolleyReferenceId_idx"
ON "public"."Employee"("companyId", "trolleyReferenceId");
