ALTER TABLE "public"."CompanyPayrollSettings"
ADD COLUMN "addressLine1" TEXT,
ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "provinceCode" TEXT,
ADD COLUMN "postalCode" TEXT,
ADD COLUMN "countryCode" TEXT DEFAULT 'CAN',
ADD COLUMN "contactName" TEXT,
ADD COLUMN "contactPhone" TEXT,
ADD COLUMN "contactPhoneExtension" TEXT,
ADD COLUMN "transmitterAccountNumber" TEXT,
ADD COLUMN "transmitterRepId" TEXT,
ADD COLUMN "submissionLanguageCode" TEXT DEFAULT 'E';
