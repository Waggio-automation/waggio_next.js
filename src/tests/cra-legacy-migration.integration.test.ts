import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { getDownloadableDocument } from "../lib/document-access.ts";
import { getCraDashboard } from "../lib/cra.ts";

const prisma = new PrismaClient();
const migrationFile = path.resolve(
  process.cwd(),
  "src/prisma/migrations/20260720120000_quarantine_legacy_cra_artifacts/migration.sql"
);

function applyLegacyQuarantineMigration() {
  const result = spawnSync(
    "npx",
    ["prisma", "db", "execute", "--schema", "src/prisma/schema.prisma", "--file", migrationFile],
    { cwd: process.cwd(), env: process.env, encoding: "utf8" }
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test("legacy CRA data migration quarantines unvalidated artifacts idempotently", async () => {
  const [{ current_database: databaseName }] = await prisma.$queryRawUnsafe<
    Array<{ current_database: string }>
  >("select current_database()");
  assert.equal(databaseName.endsWith("_integration"), true);

  const company = await prisma.company.create({
    data: { name: "Legacy migration", adminEmail: "legacy-migration@integration.invalid" },
  });
  const employee = await prisma.employee.create({
    data: {
      companyId: company.id,
      firstName: "Legacy",
      lastName: "Employee",
      email: "legacy-employee@integration.invalid",
      sin: "legacy-ciphertext",
      addrLine1: "1 Legacy Way",
      addrCity: "Ottawa",
      addrPostal: "K1A0B1",
      birthDate: new Date("1990-01-01T00:00:00.000Z"),
      employmentType: "FULL_TIME",
      hireDate: new Date("2020-01-01T00:00:00.000Z"),
      payType: "SALARY",
      salary: 50000,
    },
  });
  const mutableSummary = await prisma.t4Summary.create({
    data: { companyId: company.id, taxYear: 2024, status: "GENERATED" },
  });
  const mutableSlip = await prisma.t4Slip.create({
    data: {
      companyId: company.id,
      employeeId: employee.id,
      taxYear: 2024,
      status: "GENERATED",
      summaryId: mutableSummary.id,
    },
  });
  const finalizedSummary = await prisma.t4Summary.create({
    data: {
      companyId: company.id,
      taxYear: 2023,
      status: "FINALIZED",
      finalizedAt: new Date("2024-02-29T00:00:00.000Z"),
    },
  });
  const finalizedSlip = await prisma.t4Slip.create({
    data: {
      companyId: company.id,
      employeeId: employee.id,
      taxYear: 2023,
      status: "FINALIZED",
      finalizedAt: new Date("2024-02-29T00:00:00.000Z"),
      summaryId: finalizedSummary.id,
    },
  });
  const [remittance] = await prisma.$queryRaw<Array<{ id: bigint }>>`
    INSERT INTO "public"."Remittance" (
      "companyId", "periodStart", "periodEnd", "remitterTypeSnapshot",
      "dueDate", "totalPayable", "updatedAt"
    ) VALUES (
      ${company.id}, ${new Date("2024-01-01T00:00:00.000Z")},
      ${new Date("2024-01-31T00:00:00.000Z")},
      ${"MONTHLY"}::"public"."RemitterType",
      ${new Date("2024-02-15T00:00:00.000Z")}, 100, CURRENT_TIMESTAMP
    )
    RETURNING "id"
  `;
  await prisma.remittancePayment.create({
    data: {
      remittanceId: remittance.id,
      paymentDate: new Date("2024-02-10T00:00:00.000Z"),
      amountPaid: 40,
      status: "RECORDED",
      referenceNumber: "legacy-payment-evidence",
    },
  });

  const documents = await Promise.all([
    prisma.document.create({
      data: {
        companyId: company.id,
        documentType: "T4_SLIP",
        fileName: "legacy-slip.pdf",
        storagePath: "generated/cra/legacy-slip.pdf",
        mimeType: "application/pdf",
        linkedEntityType: "T4_SLIP",
        linkedEntityId: mutableSlip.id,
        t4SlipId: mutableSlip.id,
      },
    }),
    prisma.document.create({
      data: {
        companyId: company.id,
        documentType: "OTHER",
        fileName: "legacy-summary.xml",
        storagePath: "generated/cra/legacy-summary.xml",
        mimeType: "application/xml",
        linkedEntityType: "T4_SUMMARY",
        linkedEntityId: mutableSummary.id,
        t4SummaryId: mutableSummary.id,
      },
    }),
    prisma.document.create({
      data: {
        companyId: company.id,
        documentType: "OTHER",
        fileName: "legacy-finalized.xml",
        storagePath: "generated/cra/legacy-finalized.xml",
        mimeType: "application/xml",
        linkedEntityType: "T4_SUMMARY",
        linkedEntityId: finalizedSummary.id,
        t4SummaryId: finalizedSummary.id,
      },
    }),
    prisma.document.create({
      data: {
        companyId: company.id,
        documentType: "T4_SLIP",
        fileName: "legacy-finalized-slip.pdf",
        storagePath: "generated/cra/legacy-finalized-slip.pdf",
        mimeType: "application/pdf",
        linkedEntityType: "T4_SLIP",
        linkedEntityId: finalizedSlip.id,
        t4SlipId: finalizedSlip.id,
      },
    }),
    prisma.document.create({
      data: {
        companyId: company.id,
        documentType: "REMITTANCE_REPORT",
        fileName: "legacy-remittance.pdf",
        storagePath: "generated/cra/legacy-remittance.pdf",
        mimeType: "application/pdf",
        linkedEntityType: "REMITTANCE",
        linkedEntityId: remittance.id,
        remittanceId: remittance.id,
      },
    }),
    prisma.document.create({
      data: {
        companyId: company.id,
        documentType: "OTHER",
        fileName: "trusted-unrelated.pdf",
        storagePath: "generated/cra/trusted-unrelated.pdf",
        mimeType: "application/pdf",
        linkedEntityType: "COMPANY",
        linkedEntityId: company.id,
      },
    }),
    prisma.document.create({
      data: {
        companyId: company.id,
        documentType: "OTHER",
        fileName: "unrelated-company-export.xml",
        storagePath: "generated/cra/unrelated-company-export.xml",
        mimeType: "application/xml",
        linkedEntityType: "COMPANY",
        linkedEntityId: company.id,
      },
    }),
  ]);

  applyLegacyQuarantineMigration();
  applyLegacyQuarantineMigration();

  const migratedDocuments = await prisma.document.findMany({
    where: { id: { in: documents.map((document) => document.id) } },
    orderBy: { id: "asc" },
  });
  const legacyCraDocumentIds = new Set(documents.slice(0, 5).map((document) => document.id));
  for (const document of migratedDocuments.filter((item) => legacyCraDocumentIds.has(item.id))) {
    assert.equal(document.validationStatus, "QUARANTINED");
    assert.equal(document.validationReason, "LEGACY_UNVALIDATED_ARTIFACT");
    assert.equal(await getDownloadableDocument(company.id, document.id), null);
  }
  for (const document of migratedDocuments.filter((item) => !legacyCraDocumentIds.has(item.id))) {
    assert.equal(document.validationStatus, "ACTIVE");
  }
  assert.equal(await getDownloadableDocument(company.id, documents[1].id), null);

  assert.equal((await prisma.t4Summary.findUniqueOrThrow({ where: { id: mutableSummary.id } })).status, "QUARANTINED");
  assert.equal((await prisma.t4Slip.findUniqueOrThrow({ where: { id: mutableSlip.id } })).status, "QUARANTINED");
  assert.equal((await prisma.t4Summary.findUniqueOrThrow({ where: { id: finalizedSummary.id } })).status, "FINALIZED");
  assert.equal((await prisma.t4Slip.findUniqueOrThrow({ where: { id: finalizedSlip.id } })).status, "FINALIZED");
  assert.equal(await prisma.auditLog.count({
    where: {
      companyId: company.id,
      action: "T4_FINALIZED_LEGACY_ARTIFACT_REVIEW_REQUIRED",
      targetId: finalizedSummary.id.toString(),
    },
  }), 1);

  const migratedRemittance = await prisma.remittance.findUniqueOrThrow({
    where: { id: remittance.id },
    include: { payments: true },
  });
  assert.equal(migratedRemittance.status, "REVIEW_REQUIRED");
  assert.equal(migratedRemittance.totalPayable.toFixed(2), "100.00");
  assert.equal(migratedRemittance.payments.length, 1);
  assert.equal(Number(
    (migratedRemittance.reconciliationSummary as {
      priorPublishedSnapshot?: { totalPayable?: string };
    }).priorPublishedSnapshot?.totalPayable
  ), 100);
  const dashboard = await getCraDashboard(company.id);
  assert.equal(dashboard.outstandingTotal.toFixed(2), "0.00");
  assert.equal(dashboard.nextDue, null);
  assert.equal(await prisma.auditLog.count({
    where: {
      companyId: company.id,
      action: "REMITTANCE_LEGACY_REPORT_REVIEW_REQUIRED",
      targetId: remittance.id.toString(),
    },
  }), 1);
});

test.after(async () => prisma.$disconnect());
