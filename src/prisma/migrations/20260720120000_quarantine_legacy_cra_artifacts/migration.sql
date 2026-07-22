ALTER TABLE "public"."Remittance"
  ADD COLUMN IF NOT EXISTS "sourceFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "reportPublishedAt" TIMESTAMP(3);

-- Documents created before generation validation metadata existed must not inherit
-- the ACTIVE default added by the preceding schema migration.
UPDATE "public"."Document"
   SET "validationStatus" = 'QUARANTINED',
       "validationReason" = 'LEGACY_UNVALIDATED_ARTIFACT',
       "quarantinedAt" = COALESCE("quarantinedAt", CURRENT_TIMESTAMP)
 WHERE (
     "documentType" IN ('T4_SLIP', 'T4_SUMMARY', 'REMITTANCE_REPORT')
     OR (
       "documentType" = 'OTHER'
       AND "mimeType" = 'application/xml'
       AND "linkedEntityType" = 'T4_SUMMARY'
       AND "t4SummaryId" IS NOT NULL
     )
   )
   AND "generationVersion" IS NULL
   AND (
     "validationStatus" <> 'QUARANTINED'
     OR "validationReason" IS DISTINCT FROM 'LEGACY_UNVALIDATED_ARTIFACT'
   );

-- Preserve FINALIZED filing state. Only mutable legacy generation records are
-- invalidated; FINALIZED records are handled through the review audit below.
UPDATE "public"."T4Summary"
   SET "status" = 'QUARANTINED'
 WHERE "generationVersion" IS NULL
   AND "status" <> 'FINALIZED'
   AND "status" <> 'QUARANTINED';

UPDATE "public"."T4Slip"
   SET "status" = 'QUARANTINED'
 WHERE "generationVersion" IS NULL
   AND "status" <> 'FINALIZED'
   AND "status" <> 'QUARANTINED';

-- A report-backed remittance with no source version has never been reconciled
-- against the strict payroll eligibility contract. Preserve its published
-- totals and payment evidence, but exclude it from payable dashboard state.
UPDATE "public"."Remittance" remittance
   SET "status" = 'REVIEW_REQUIRED',
       "reviewRequiredAt" = COALESCE(remittance."reviewRequiredAt", CURRENT_TIMESTAMP),
       "reconciliationSummary" = jsonb_build_object(
         'reasonCode', 'LEGACY_UNVALIDATED_ARTIFACT',
         'priorPublishedSnapshot', jsonb_build_object(
           'employeeCount', remittance."employeeCount",
           'totalIncomeTax', remittance."totalIncomeTax"::text,
           'totalCppEmployee', remittance."totalCppEmployee"::text,
           'totalCppEmployer', remittance."totalCppEmployer"::text,
           'totalEiEmployee', remittance."totalEiEmployee"::text,
           'totalEiEmployer', remittance."totalEiEmployer"::text,
           'totalPayable', remittance."totalPayable"::text,
           'sourceFingerprint', remittance."sourceFingerprint",
           'sourceVersion', remittance."sourceVersion",
           'reportPublishedAt', remittance."reportPublishedAt"
         ),
         'recordedPaymentCount', (
           SELECT count(*)
             FROM "public"."RemittancePayment" payment
            WHERE payment."remittanceId" = remittance."id"
              AND payment."status" = 'RECORDED'
         )
       )
 WHERE remittance."sourceVersion" IS NULL
   AND EXISTS (
     SELECT 1
       FROM "public"."Document" document
      WHERE document."remittanceId" = remittance."id"
        AND document."documentType" = 'REMITTANCE_REPORT'
        AND document."generationVersion" IS NULL
        AND document."validationReason" = 'LEGACY_UNVALIDATED_ARTIFACT'
   )
   AND (
     remittance."status" <> 'REVIEW_REQUIRED'
     OR remittance."reconciliationSummary"->>'reasonCode' IS DISTINCT FROM 'LEGACY_UNVALIDATED_ARTIFACT'
   );

INSERT INTO "public"."AuditLog" (
  "companyId", "actorType", "action", "targetType", "targetId", "metadataJson", "createdAt"
)
SELECT
  remittance."companyId",
  'SYSTEM',
  'REMITTANCE_LEGACY_REPORT_REVIEW_REQUIRED',
  'Remittance',
  remittance."id"::text,
  remittance."reconciliationSummary",
  CURRENT_TIMESTAMP
FROM "public"."Remittance" remittance
WHERE remittance."status" = 'REVIEW_REQUIRED'
  AND remittance."reconciliationSummary"->>'reasonCode' = 'LEGACY_UNVALIDATED_ARTIFACT'
  AND NOT EXISTS (
    SELECT 1
      FROM "public"."AuditLog" audit
     WHERE audit."companyId" = remittance."companyId"
       AND audit."action" = 'REMITTANCE_LEGACY_REPORT_REVIEW_REQUIRED'
       AND audit."targetType" = 'Remittance'
       AND audit."targetId" = remittance."id"::text
  );

-- Idempotently register every FINALIZED legacy T4 package whose documents are
-- now download-blocked for manual/legal review.
INSERT INTO "public"."AuditLog" (
  "companyId",
  "actorType",
  "action",
  "targetType",
  "targetId",
  "metadataJson",
  "createdAt"
)
SELECT
  summary."companyId",
  'SYSTEM',
  'T4_FINALIZED_LEGACY_ARTIFACT_REVIEW_REQUIRED',
  'T4Summary',
  summary."id"::text,
  jsonb_build_object(
    'reasonCode', 'LEGACY_UNVALIDATED_ARTIFACT',
    'taxYear', summary."taxYear",
    'statusPreserved', 'FINALIZED'
  ),
  CURRENT_TIMESTAMP
FROM "public"."T4Summary" summary
WHERE summary."status" = 'FINALIZED'
  AND summary."generationVersion" IS NULL
  AND EXISTS (
    SELECT 1
     FROM "public"."Document" document
     WHERE (
       document."t4SummaryId" = summary."id"
       OR document."t4SlipId" IN (
         SELECT slip."id"
           FROM "public"."T4Slip" slip
          WHERE slip."summaryId" = summary."id"
       )
     )
       AND document."validationReason" = 'LEGACY_UNVALIDATED_ARTIFACT'
  )
  AND NOT EXISTS (
    SELECT 1
      FROM "public"."AuditLog" audit
     WHERE audit."companyId" = summary."companyId"
       AND audit."action" = 'T4_FINALIZED_LEGACY_ARTIFACT_REVIEW_REQUIRED'
       AND audit."targetType" = 'T4Summary'
       AND audit."targetId" = summary."id"::text
  );

-- Repair any duplicate ACTIVE reports that may have been published by concurrent
-- legacy syncs before enforcing the one-active-report invariant.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "remittanceId"
      ORDER BY "uploadedAt" DESC, "id" DESC
    ) AS position
  FROM "public"."Document"
  WHERE "documentType" = 'REMITTANCE_REPORT'
    AND "validationStatus" = 'ACTIVE'
    AND "remittanceId" IS NOT NULL
)
UPDATE "public"."Document" document
   SET "validationStatus" = 'QUARANTINED',
       "validationReason" = 'DUPLICATE_ACTIVE_REMITTANCE_REPORT',
       "quarantinedAt" = COALESCE(document."quarantinedAt", CURRENT_TIMESTAMP)
  FROM ranked
 WHERE document."id" = ranked."id"
   AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Document_one_active_remittance_report_idx"
  ON "public"."Document"("remittanceId")
  WHERE "documentType" = 'REMITTANCE_REPORT'
    AND "validationStatus" = 'ACTIVE'
    AND "remittanceId" IS NOT NULL;
