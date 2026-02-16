-- CreateTable
CREATE TABLE "public"."CompanySettings" (
    "id" BIGSERIAL NOT NULL,
    "stripeAccountId" TEXT,
    "payoutEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutSetupStatus" "public"."PayoutSetupStatus" NOT NULL DEFAULT 'REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanySettings_stripeAccountId_key" ON "public"."CompanySettings"("stripeAccountId");
