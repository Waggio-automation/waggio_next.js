import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { encryptSin } from "../lib/crypto.ts";
import {
  classifyStoredSin,
  isValidSin,
  maskStoredSinForDisplay,
  resolveSinForT4,
} from "../lib/sin.ts";
import { buildT4SubmissionXml, renderEmployeeT4SlipHtml, type T4SlipData } from "../lib/t4-filing.ts";
import { partitionCompliancePayrollRows } from "../lib/payroll/compliance-eligibility.ts";
import { runSinBackfill } from "../lib/sin-backfill.ts";
import type { PayrollRunStatus } from "@prisma/client";

const TEST_KEY = "11".repeat(32);
const OTHER_TEST_KEY = "22".repeat(32);
// Prefix 0 is not issued by the Canadian SIN program. This checksum-valid value is test-only.
const TEST_ONLY_SIN = "000000018";

function withEncryptionKey<T>(key: string, action: () => T) {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = key;
  try {
    return action();
  } finally {
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
  }
}

function slipData(sin: string): T4SlipData {
  return {
    employee: {
      firstName: "Test",
      lastName: "Employee",
      sin,
      address: {
        line1: "1 Test Way",
        city: "Ottawa",
        provinceCode: "ON",
        countryCode: "CAN",
        postalCode: "K1A0B1",
      },
    },
    payrollAccountNumber: "000000000RP0001",
    reportTypeCode: "O",
    provinceOfEmployment: "ON",
    cppExemptCode: "0",
    eiExemptCode: "0",
    dentalBenefitsCode: "1",
    employmentIncome: "100.00",
    cppContributions: "1.00",
    cpp2Contributions: "0.00",
    eiPremiums: "1.00",
    incomeTaxDeducted: "1.00",
    eiInsurableEarnings: "100.00",
    pensionableEarnings: "100.00",
  };
}

test("encrypted SIN is resolved only for complete T4 XML and PDF inputs", () => {
  const ciphertext = withEncryptionKey(TEST_KEY, () => encryptSin(TEST_ONLY_SIN));
  const resolved = withEncryptionKey(TEST_KEY, () => resolveSinForT4(ciphertext));
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  const slip = slipData(resolved.sin);
  const xml = buildT4SubmissionXml({
    submissionReferenceId: "TEST0001",
    summaryCount: 1,
    languageCode: "E",
    transmitterName: "Test Employer",
    transmitterCountryCode: "CAN",
    transmitterContact: { name: "Test", phoneAreaCode: "613", phoneNumber: "555-0100" },
    slips: [slip],
    summary: {
      payrollAccountNumber: "000000000RP0001",
      employerName: "Test Employer",
      employerAddress: {
        line1: "1 Test Way",
        city: "Ottawa",
        provinceCode: "ON",
        countryCode: "CAN",
        postalCode: "K1A0B1",
      },
      contact: { name: "Test", phoneAreaCode: "613", phoneNumber: "555-0100" },
      taxYear: 2026,
      slipCount: 1,
      reportTypeCode: "O",
      totals: {
        employmentIncome: "100.00",
        employeeCpp: "1.00",
        employeeCpp2: "0.00",
        employeeEi: "1.00",
        rppContributions: "0.00",
        incomeTaxDeducted: "1.00",
        pensionAdjustment: "0.00",
        employerCpp: "1.00",
        employerCpp2: "0.00",
        employerEi: "1.40",
      },
    },
  });
  const html = renderEmployeeT4SlipHtml(slip, 2026, "Test Employer");

  assert.equal(xml.includes(`<sin>${TEST_ONLY_SIN}</sin>`), true);
  assert.equal(html.includes(`SIN: ${TEST_ONLY_SIN}`), true);
  assert.equal(xml.includes(ciphertext), false);
  assert.equal(html.includes(ciphertext), false);
});

test("plaintext, unknown, failed decryption, and invalid decrypted SIN are blocked safely", () => {
  assert.deepEqual(resolveSinForT4(TEST_ONLY_SIN), {
    ok: false,
    reason: "SIN_ENCRYPTION_STATE_UNKNOWN",
  });
  assert.deepEqual(resolveSinForT4("***-***-018"), {
    ok: false,
    reason: "SIN_ENCRYPTION_STATE_UNKNOWN",
  });

  const ciphertext = withEncryptionKey(TEST_KEY, () => encryptSin(TEST_ONLY_SIN));
  const wrongKeyResult = withEncryptionKey(OTHER_TEST_KEY, () => resolveSinForT4(ciphertext));
  assert.deepEqual(wrongKeyResult, { ok: false, reason: "SIN_DECRYPTION_FAILED" });

  const invalidCiphertext = withEncryptionKey(TEST_KEY, () => encryptSin("123456789"));
  const invalidResult = withEncryptionKey(TEST_KEY, () => resolveSinForT4(invalidCiphertext));
  assert.deepEqual(invalidResult, { ok: false, reason: "INVALID_DECRYPTED_SIN" });
  assert.doesNotMatch(JSON.stringify(invalidResult), /123456789|[0-9a-f]{32}:/i);
});

test("masking never exposes ciphertext suffixes and can fully hide the SIN", () => {
  const ciphertext = withEncryptionKey(TEST_KEY, () => encryptSin(TEST_ONLY_SIN));
  assert.equal(
    withEncryptionKey(TEST_KEY, () => maskStoredSinForDisplay(ciphertext, { revealLastThree: true })),
    "***-***-018"
  );
  assert.equal(maskStoredSinForDisplay(ciphertext, { revealLastThree: false }), "***-***-***");
  assert.equal(
    withEncryptionKey(OTHER_TEST_KEY, () => maskStoredSinForDisplay(ciphertext, { revealLastThree: true })),
    "***-***-***"
  );
  assert.notEqual(maskStoredSinForDisplay("not-ciphertext", { revealLastThree: true }).slice(-3), "ext");
});

test("only PAID payroll runs are eligible and legacy or ambiguous rows are counted", () => {
  const companyId = BigInt(10);
  const paidAt = new Date("2026-01-01T00:00:00.000Z");
  const verificationCutoff = new Date("2025-12-31T00:00:00.000Z");
  const verifiedRun = {
    status: "PAID" as const,
    companyId,
    providerRef: "batch-reference",
    providerVerificationStatus: "VERIFIED" as const,
    providerVerificationLastSucceededAt: paidAt,
    providerEvidenceVersion: "trolley-processed-exact-set-v1",
  };
  const childEvidence = {
    status: "SENT" as const,
    paidAt,
    paymentProvider: "trolley",
    paymentRef: "payment-reference",
  };
  const selection = partitionCompliancePayrollRows([
    { id: "paid", ...childEvidence, payrollRunId: BigInt(1), payrollRun: verifiedRun },
    { id: "draft", ...childEvidence, payrollRunId: BigInt(2), payrollRun: { ...verifiedRun, status: "SCHEDULED" as const } },
    { id: "failed", ...childEvidence, payrollRunId: BigInt(3), payrollRun: { ...verifiedRun, status: "FAILED" as const } },
    {
      id: "unknown",
      ...childEvidence,
      payrollRunId: BigInt(4),
      payrollRun: { ...verifiedRun, status: "UNKNOWN_LEGACY" as PayrollRunStatus },
    },
    { id: "legacy", ...childEvidence, payrollRunId: null, payrollRun: null },
    { id: "wrong-company", ...childEvidence, payrollRunId: BigInt(5), payrollRun: { ...verifiedRun, companyId: BigInt(11) } },
    { id: "child-conflict", ...childEvidence, status: "READY" as const, payrollRunId: BigInt(6), payrollRun: verifiedRun },
    { id: "missing-evidence", ...childEvidence, status: "EMAIL_SENT" as const, paidAt: null, payrollRunId: BigInt(7), payrollRun: verifiedRun },
    { id: "provider-ref", ...childEvidence, payrollRunId: BigInt(8), payrollRun: { ...verifiedRun, providerRef: null } },
    { id: "unverified", ...childEvidence, payrollRunId: BigInt(9), payrollRun: { ...verifiedRun, providerVerificationStatus: "UNVERIFIED" as const, providerVerificationLastSucceededAt: null } },
    { id: "stale", ...childEvidence, payrollRunId: BigInt(10), payrollRun: { ...verifiedRun, providerVerificationLastSucceededAt: new Date("2025-12-30T00:00:00.000Z") } },
    { id: "version", ...childEvidence, payrollRunId: BigInt(11), payrollRun: { ...verifiedRun, providerEvidenceVersion: "obsolete" } },
    { id: "payment-link", ...childEvidence, paymentRef: null, payrollRunId: BigInt(12), payrollRun: verifiedRun },
  ], companyId, verificationCutoff);

  assert.deepEqual(selection.included.map((row) => row.id), ["paid"]);
  assert.equal(selection.excludedCount, 12);
  assert.deepEqual(selection.reasonCounts, {
    AMBIGUOUS_PAYROLL_STATUS: 3,
    LEGACY_STATUS_MISSING: 1,
    PAYROLL_RUN_COMPANY_MISMATCH: 1,
    PAID_PARENT_CHILD_STATUS_CONFLICT: 1,
    PAID_PARENT_CHILD_PAYMENT_EVIDENCE_MISSING: 1,
    PROVIDER_REFERENCE_MISSING: 1,
    PROVIDER_EVIDENCE_UNVERIFIED: 1,
    PROVIDER_EVIDENCE_STALE: 1,
    PROVIDER_EVIDENCE_VERSION_MISMATCH: 1,
    PROVIDER_PAYMENT_LINK_MISSING: 1,
  });
});

test("SIN backfill is dry-run by default behavior, idempotent, and quarantines ambiguous values", async () => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
  const rows = [
    { id: BigInt(1), sin: TEST_ONLY_SIN },
    { id: BigInt(2), sin: "***-***-018" },
    { id: BigInt(3), sin: "corrupt-value" },
    { id: BigInt(4), sin: encryptSin("123456789") },
  ];
  let writes = 0;
  const repository = {
    readBatch: async ({ afterId, take }: { afterId: bigint | null; take: number }) =>
      rows.filter((row) => afterId === null || row.id > afterId).slice(0, take),
    updateIfUnchanged: async ({ id, previous, encrypted }: { id: bigint; previous: string; encrypted: string }) => {
      const row = rows.find((candidate) => candidate.id === id && candidate.sin === previous);
      if (!row) return false;
      row.sin = encrypted;
      writes += 1;
      return true;
    },
  };

  const dryRun = await runSinBackfill({ repository, apply: false, batchSize: 2 });
  assert.equal(dryRun.candidates, 1);
  assert.equal(dryRun.changed, 0);
  assert.equal(writes, 0);
  assert.equal(classifyStoredSin(rows[0].sin), "PLAINTEXT_VALID");

  const applied = await runSinBackfill({ repository, apply: true, batchSize: 2 });
  assert.equal(applied.changed, 1);
  assert.equal(writes, 1);
  assert.equal(classifyStoredSin(rows[0].sin), "CIPHERTEXT");
  assert.equal(rows[1].sin, "***-***-018");
  assert.equal(rows[2].sin, "corrupt-value");
  assert.equal(applied.CORRUPT_CIPHERTEXT, 1);
  assert.equal(applied.quarantined, 3);

  const repeated = await runSinBackfill({ repository, apply: true });
  assert.equal(repeated.changed, 0);
  assert.equal(writes, 1);
  assert.equal(isValidSin(TEST_ONLY_SIN), true);
});

test("employee APIs do not serialize stored SIN and T4 publication is transactional", () => {
  const employeeRoute = readFileSync(resolve(process.cwd(), "src/app/api/employees/route.ts"), "utf8");
  const cra = readFileSync(resolve(process.cwd(), "src/lib/cra.ts"), "utf8");
  const getHandler = employeeRoute.split("export async function POST")[0];

  assert.doesNotMatch(getHandler, /\bsin\s*:/i);
  assert.match(employeeRoute, /sin:\s*encryptSin\(parsed\.sin\)/);
  assert.doesNotMatch(employeeRoute, /error:\s*e instanceof Error \? e\.message/);
  assert.match(cra, /resolvedSinByEmployee\.get\(employeeKey\)/);
  assert.doesNotMatch(cra, /sin:\s*employee\.sin/);
  assert.ok((cra.match(/partitionCompliancePayrollRows\(/g)?.length ?? 0) >= 2);
  assert.match(cra, /await prisma\.\$transaction/);
  assert.match(cra, /Files are published to the database only/);
});
