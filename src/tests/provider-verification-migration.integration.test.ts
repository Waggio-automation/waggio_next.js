import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

test("provider verification migration classifies legacy PAID rows without inferring success", async () => {
  const [{ current_database: databaseName }] = await prisma.$queryRawUnsafe<
    Array<{ current_database: string }>
  >("select current_database()");
  assert.equal(databaseName.endsWith("_integration"), true);

  const [company] = await prisma.$queryRaw<Array<{ id: bigint }>>`
    INSERT INTO "public"."Company" (
      "adminEmail", "createdAt", "updatedAt"
    ) VALUES (
      'provider-verification-migration@integration.invalid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    ) RETURNING "id"
  `;
  const legacyRows = await prisma.$queryRaw<Array<{ id: bigint; status: string }>>`
    INSERT INTO "public"."PayrollRun" (
      "companyId", "payDate", "status", "providerRef", "createdAt", "updatedAt"
    ) VALUES
      (${company.id}, ${new Date("2025-12-31T00:00:00.000Z")}, 'PAID', 'legacy-provider-reference', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      (${company.id}, ${new Date("2025-12-30T00:00:00.000Z")}, 'PAID', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      (${company.id}, ${new Date("2026-01-15T00:00:00.000Z")}, 'PAYING', 'current-provider-reference', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING "id", "status"::text
  `;

  const migrate = spawnSync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", "src/prisma/schema.prisma"],
    { cwd: process.cwd(), env: process.env, encoding: "utf8" }
  );
  assert.equal(migrate.status, 0, `${migrate.stdout}\n${migrate.stderr}`);

  const migrated = await prisma.payrollRun.findMany({
    where: { id: { in: legacyRows.map((row) => row.id) } },
    orderBy: { id: "asc" },
  });
  const legacyPaid = migrated.find((row) => row.status === "PAID" && row.providerRef !== null)!;
  const legacyPaidMissingReference = migrated.find(
    (row) => row.status === "PAID" && row.providerRef === null
  )!;
  const paying = migrated.find((row) => row.status === "PAYING")!;
  assert.equal(legacyPaid.providerVerificationStatus, "LEGACY_UNVERIFIED");
  assert.equal(legacyPaid.providerVerificationLastAttemptAt, null);
  assert.equal(legacyPaid.providerVerificationLastSucceededAt, null);
  assert.equal(legacyPaid.providerVerificationFailureCode, null);
  assert.equal(legacyPaid.providerVerificationConsecutiveFailures, 0);
  assert.equal(legacyPaid.providerEvidenceVersion, null);
  assert.equal(legacyPaidMissingReference.providerVerificationStatus, "LEGACY_UNVERIFIED");
  assert.equal(legacyPaidMissingReference.providerVerificationLastSucceededAt, null);
  assert.equal(paying.providerVerificationStatus, "UNVERIFIED");
  assert.equal(await prisma.payrollProviderVerificationAttempt.count(), 0);
});

test.after(async () => prisma.$disconnect());
