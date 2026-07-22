import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PrismaClient } from "@prisma/client";
import { TrolleyApiError, TrolleyRequestTimeoutError, type Payment } from "../lib/trolley.ts";
import { encryptSin } from "../lib/crypto.ts";
import { runSinBackfill } from "../lib/sin-backfill.ts";
import { getDownloadableDocument } from "../lib/document-access.ts";
import {
  generateT4Package,
  getCraGeneratedDirectory,
  getCraDashboard,
  getReminderState,
  recordRemittancePayment,
  reconcileCraArtifactStorage,
  syncRemittancesForCompany,
} from "../lib/cra.ts";
import {
  PayrollPaymentReconciliationError,
  TROLLEY_PAID_REVALIDATION_JOB,
  TROLLEY_PAYING_RECONCILIATION_JOB,
  getPaidRevalidationHttpStatus,
  getPaidRevalidationOperationalHealth,
  reconcilePayingPayrollRunsFromTrolley,
  reconcilePayrollRunFromTrolley,
  revalidatePaidPayrollRunsFromTrolley,
} from "../lib/payments/payroll-payment-reconciliation.ts";
import { buildTrolleyPayHistoryExternalId } from "../lib/payments/trolley-tenancy.ts";
import { runPayrollSendDueJob } from "../lib/payments/payroll-cron.ts";
import { getT4SlipDocumentLabel, getT4SummaryDisplayStatus } from "../lib/t4-artifact-policy.ts";
import { formatUtcDateOnly, serializeUtcDateOnly } from "../lib/date-only.ts";
import { CURRENT_PROVIDER_EVIDENCE_VERSION } from "../lib/payroll/provider-evidence-policy.ts";
import {
  CompliancePublicationLockTimeoutError,
  lockCompanyComplianceScope,
} from "../lib/payroll/compliance-publication-lock.ts";

const prisma = new PrismaClient();
const TEST_ONLY_SIN = "000000018";
const TAX_YEAR = 2026;
const OFFICIAL_TROLLEY_PROCESSED_FIXTURE = JSON.parse(readFileSync(
  path.resolve(process.cwd(), "src/tests/fixtures/trolley-payment-processed-response.json"),
  "utf8"
)) as { ok: true; payment: Payment };

async function resetDedicatedDatabase() {
  const [{ current_database: databaseName }] = await prisma.$queryRawUnsafe<
    Array<{ current_database: string }>
  >("select current_database()");
  assert.equal(databaseName.endsWith("_integration"), true);
  await prisma.$executeRawUnsafe(`
    DO $$
    DECLARE tables text;
    BEGIN
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
        INTO tables
        FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
      IF tables IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
      END IF;
    END $$;
  `);
}

async function createPayrollFixture(
  label: string,
  payDate = new Date(`${TAX_YEAR}-01-15T12:00:00.000Z`)
) {
  const company = await prisma.company.create({
    data: {
      name: `Integration ${label}`,
      adminEmail: `${label}@integration.invalid`,
      currentPlan: "PRO",
      payrollSettings: {
        create: {
          legalName: `Integration ${label}`,
          businessNumber: "000000000",
          payrollProgramAccount: "000000000RP0001",
          addressLine1: "1 Test Way",
          city: "Ottawa",
          provinceCode: "ON",
          postalCode: "K1A0B1",
          countryCode: "CAN",
          contactName: "Integration Test",
          contactPhone: "6135550100",
          contactEmail: `${label}@integration.invalid`,
          transmitterAccountNumber: "000000000",
        },
      },
    },
  });
  const ciphertext = encryptSin(TEST_ONLY_SIN);
  const employee = await prisma.employee.create({
    data: {
      companyId: company.id,
      firstName: "Integration",
      lastName: "Employee",
      email: `${label}-employee@integration.invalid`,
      sin: ciphertext,
      addrLine1: "1 Test Way",
      addrCity: "Ottawa",
      addrProvince: "ON",
      addrPostal: "K1A0B1",
      addrCountry: "CA",
      birthDate: new Date("1990-01-01T00:00:00.000Z"),
      employmentType: "FULL_TIME",
      hireDate: new Date("2025-01-01T00:00:00.000Z"),
      payType: "SALARY",
      salary: 52000,
    },
  });
  const payrollRun = await prisma.payrollRun.create({
    data: {
      companyId: company.id,
      payDate,
      status: "PAID",
      providerRef: `B-${label}`,
      providerVerificationLastAttemptAt: new Date(),
      providerVerificationLastSucceededAt: new Date(),
      providerVerificationStatus: "VERIFIED",
      providerEvidenceVersion: CURRENT_PROVIDER_EVIDENCE_VERSION,
    },
  });
  const payHistory = await prisma.payHistory.create({
    data: {
      employeeId: employee.id,
      payrollRunId: payrollRun.id,
      payDate: payrollRun.payDate,
      grossPay: 2000,
      ded_cpp: 100,
      ded_ei: 30,
      ded_income_tax: 250,
      netPay: 1620,
      status: "SENT",
      paidAt: payrollRun.payDate,
      paymentProvider: "trolley",
      paymentRef: `P-${label}`,
    },
  });
  return { company, employee, payrollRun, payHistory, ciphertext };
}

type PayrollFixture = Awaited<ReturnType<typeof createPayrollFixture>>;

async function addPayrollSourceToFixture(
  fixture: PayrollFixture,
  label: string,
  options: {
    verificationStatus?: "VERIFIED" | "UNVERIFIED" | "LEGACY_UNVERIFIED";
    providerRef?: string | null;
    lastSucceededAt?: Date | null;
    evidenceVersion?: string | null;
    paymentProvider?: string | null;
    paymentRef?: string | null;
    status?: "SENT" | "EMAIL_SENT" | "READY";
    paidAt?: Date | null;
    grossPay?: number;
    cpp?: number;
    ei?: number;
    incomeTax?: number;
  } = {}
) {
  const now = new Date();
  const run = await prisma.payrollRun.create({
    data: {
      companyId: fixture.company.id,
      payDate: fixture.payrollRun.payDate,
      status: "PAID",
      providerRef: options.providerRef === undefined ? `B-${label}` : options.providerRef,
      providerVerificationLastAttemptAt: now,
      providerVerificationLastSucceededAt:
        options.lastSucceededAt === undefined ? now : options.lastSucceededAt,
      providerVerificationStatus: options.verificationStatus ?? "VERIFIED",
      providerEvidenceVersion:
        options.evidenceVersion === undefined
          ? CURRENT_PROVIDER_EVIDENCE_VERSION
          : options.evidenceVersion,
    },
  });
  const grossPay = options.grossPay ?? 1000;
  const cpp = options.cpp ?? 50;
  const ei = options.ei ?? 15;
  const incomeTax = options.incomeTax ?? 125;
  const history = await prisma.payHistory.create({
    data: {
      employeeId: fixture.employee.id,
      payrollRunId: run.id,
      payDate: run.payDate,
      grossPay,
      ded_cpp: cpp,
      ded_ei: ei,
      ded_income_tax: incomeTax,
      netPay: grossPay - cpp - ei - incomeTax,
      status: options.status ?? "SENT",
      paidAt: options.paidAt === undefined ? run.payDate : options.paidAt,
      paymentProvider:
        options.paymentProvider === undefined ? "trolley" : options.paymentProvider,
      paymentRef: options.paymentRef === undefined ? `P-${label}` : options.paymentRef,
    },
  });
  return { run, history };
}

function trolleyProcessedPayment(
  fixture: PayrollFixture,
  params: {
    batchId?: string;
    paymentId?: string;
    payHistory?: { id: bigint; netPay: { toFixed(decimalPlaces?: number): string } };
    overrides?: Partial<Payment>;
  } = {}
): Payment {
  const payHistory = params.payHistory ?? fixture.payHistory;
  const batchId = params.batchId ?? `B-${fixture.payrollRun.id.toString()}`;
  const paymentId = params.paymentId ?? `P-${payHistory.id.toString()}`;
  return {
    ...OFFICIAL_TROLLEY_PROCESSED_FIXTURE.payment,
    id: paymentId,
    batch: { ...OFFICIAL_TROLLEY_PROCESSED_FIXTURE.payment.batch, id: batchId },
    sourceAmount: payHistory.netPay.toFixed(2),
    sourceCurrency: "CAD",
    currency: "CAD",
    externalId: buildTrolleyPayHistoryExternalId({
      companyId: fixture.company.id,
      payHistoryId: payHistory.id,
    }),
    ...params.overrides,
  };
}

async function preparePayingTrolleyFixture(label: string, payDate?: Date) {
  const fixture = await createPayrollFixture(label, payDate);
  const batchId = `B-${label}`;
  const paymentId = `P-${label}`;
  await prisma.payrollRun.update({
    where: { id: fixture.payrollRun.id },
    data: {
      status: "PAYING",
      providerRef: batchId,
      providerVerificationLastAttemptAt: null,
      providerVerificationLastSucceededAt: null,
      providerVerificationFailureCode: null,
      providerVerificationConsecutiveFailures: 0,
      providerVerificationStatus: "UNVERIFIED",
      providerEvidenceVersion: null,
    },
  });
  await prisma.payHistory.update({
    where: { id: fixture.payHistory.id },
    data: {
      status: "SENDING",
      paidAt: null,
      paymentProvider: "trolley",
      paymentRef: paymentId,
    },
  });
  return { ...fixture, batchId, paymentId };
}

async function markPayingFixtureAsLegacyPaid(
  fixture: Awaited<ReturnType<typeof preparePayingTrolleyFixture>>
) {
  await prisma.$transaction([
    prisma.payrollRun.update({
      where: { id: fixture.payrollRun.id },
      data: {
        status: "PAID",
        providerVerificationLastAttemptAt: null,
        providerVerificationLastSucceededAt: null,
        providerVerificationFailureCode: null,
        providerVerificationConsecutiveFailures: 0,
        providerVerificationStatus: "LEGACY_UNVERIFIED",
        providerEvidenceVersion: null,
      },
    }),
    prisma.payHistory.update({
      where: { id: fixture.payHistory.id },
      data: {
        status: "SENT",
        paidAt: new Date("2026-01-16T11:00:00.000Z"),
      },
    }),
  ]);
}

async function extractPdfText(filePath: string) {
  const bytes = new Uint8Array(await fs.readFile(filePath));
  const loadingTask = getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const text: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ("str" in item) text.push(item.str);
    }
  }
  await loadingTask.destroy();
  return text.join(" ");
}

async function listCompanyArtifactFiles(companyId: bigint) {
  const prefix = `${companyId.toString()}-`;
  return (await fs.readdir(getCraGeneratedDirectory()))
    .filter((fileName) => fileName.startsWith(prefix))
    .sort();
}

function integrationPasswordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function deferredSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function assertPromiseIsPending(promise: Promise<unknown>) {
  const state = await Promise.race([
    promise.then(
      () => "settled",
      () => "settled"
    ),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
  ]);
  assert.equal(state, "pending");
}

async function stopTestServer(server: ChildProcess) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function startAuthenticatedTestServer(params: {
  companyId: bigint;
  email: string;
  password: string;
}) {
  await prisma.companyUser.create({
    data: {
      companyId: params.companyId,
      email: params.email,
      passwordHash: integrationPasswordHash(params.password),
      role: "OWNER",
    },
  });
  const port = 39_000 + (process.pid % 1_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  let output = "";
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", port.toString()],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
        COMPANY_ADMIN_SESSION_SECRET: "cra-integration-session-secret",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const collectOutput = (chunk: Buffer) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-8_000);
  };
  server.stdout?.on("data", collectOutput);
  server.stderr?.on("data", collectOutput);

  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (server.exitCode !== null) {
        throw new Error(`Next test server exited early (${server.exitCode}).\n${output}`);
      }
      try {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: params.email, password: params.password }),
        });
        if (response.ok) {
          const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
          if (!cookie) throw new Error("Login response did not include a session cookie");
          return { server, baseUrl, cookie };
        }
        lastError = new Error(`Login returned ${response.status}: ${await response.text()}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Next test server did not become ready: ${String(lastError)}\n${output}`);
  } catch (error) {
    await stopTestServer(server);
    throw error;
  }
}

test("CRA security integration", async (t) => {
  await resetDedicatedDatabase();
  const artifactDirectory = getCraGeneratedDirectory();

  await t.test("UTC date-only remittance due reminder display and payment lifecycle preserve calendar dates", async () => {
    const fixture = await createPayrollFixture(
      "utc-date-only-remittance",
      new Date("2026-01-15")
    );
    await syncRemittancesForCompany(fixture.company.id);
    const remittance = await prisma.remittance.findFirstOrThrow({
      where: { companyId: fixture.company.id },
      include: { reminders: { orderBy: { scheduledFor: "asc" } } },
    });

    assert.equal(remittance.periodStart.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(remittance.periodEnd.toISOString(), "2026-01-31T00:00:00.000Z");
    assert.equal(remittance.dueDate.toISOString(), "2026-02-15T00:00:00.000Z");
    assert.equal(formatUtcDateOnly(remittance.dueDate), "Feb 15, 2026");
    assert.equal(
      getReminderState(remittance, new Date("2026-02-14T17:00:00.000Z")),
      "UPCOMING"
    );
    assert.equal(
      getReminderState(remittance, new Date("2026-02-15T17:00:00.000Z")),
      "DUE_TODAY"
    );
    assert.equal(
      getReminderState(remittance, new Date("2026-02-16T17:00:00.000Z")),
      "OVERDUE"
    );
    assert.deepEqual(
      remittance.reminders.map((reminder) => serializeUtcDateOnly(reminder.scheduledFor)),
      ["2026-02-08", "2026-02-12", "2026-02-14", "2026-02-15", "2026-02-16"]
    );

    const payment = await recordRemittancePayment({
      companyId: fixture.company.id,
      remittanceId: remittance.id,
      paymentDate: "2026-02-15",
      amountPaid: 1,
    });
    assert.equal(payment.paymentDate.toISOString(), "2026-02-15T00:00:00.000Z");
    assert.equal(
      (await prisma.remittance.findUniqueOrThrow({ where: { id: remittance.id } })).status,
      "PARTIALLY_PAID"
    );
  });

  await t.test("payroll run API rejects malformed overflow reversed and invalid-employee input with 400 and no writes", async () => {
    const fixture = await createPayrollFixture("invalid-date-api");
    const email = "invalid-date-api-admin@integration.invalid";
    const password = "integration-password";
    const { server, baseUrl, cookie } = await startAuthenticatedTestServer({
      companyId: fixture.company.id,
      email,
      password,
    });
    const validPayload = {
      items: [{
        employeeId: fixture.employee.id.toString(),
        hoursWorked: 8,
        overtime: 0,
        holidayHours: 0,
        includeVacation: true,
      }],
      payDate: "2026-02-15",
      periodStart: "2026-02-01",
      periodEnd: "2026-02-14",
      sendAt: "2099-02-15T14:00:00.000Z",
      timezone: "America/Toronto",
    };
    const before = {
      runs: await prisma.payrollRun.count({ where: { companyId: fixture.company.id } }),
      histories: await prisma.payHistory.count({
        where: { employee: { companyId: fixture.company.id } },
      }),
      employees: await prisma.employee.count({ where: { companyId: fixture.company.id } }),
    };

    try {
      const invalidPayloads = [
        { ...validPayload, payDate: "02/15/2026" },
        { ...validPayload, payDate: "2026-02-30" },
        { ...validPayload, periodStart: "2026-02-20", periodEnd: "2026-02-14" },
        {
          ...validPayload,
          items: [{ ...validPayload.items[0], employeeId: "999999999999999999" }],
        },
      ];
      for (const payload of invalidPayloads) {
        const response = await fetch(`${baseUrl}/api/payroll/run`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify(payload),
        });
        assert.equal(response.status, 400);
        const body = await response.json() as Record<string, unknown>;
        assert.deepEqual(body, { error: "Validation failed" });
        const serialized = JSON.stringify(body).toLowerCase();
        assert.equal(serialized.includes("stack"), false);
        assert.equal(serialized.includes("path"), false);
        assert.equal(serialized.includes("internal"), false);
      }
    } finally {
      await stopTestServer(server);
    }

    assert.deepEqual({
      runs: await prisma.payrollRun.count({ where: { companyId: fixture.company.id } }),
      histories: await prisma.payHistory.count({
        where: { employee: { companyId: fixture.company.id } },
      }),
      employees: await prisma.employee.count({ where: { companyId: fixture.company.id } }),
    }, before);
  });

  await t.test("legacy unverified payroll cannot publish a T4 package or remittance report", async () => {
    const fixture = await createPayrollFixture("legacy-unverified-source-blocked");
    await prisma.payrollRun.update({
      where: { id: fixture.payrollRun.id },
      data: {
        providerVerificationStatus: "LEGACY_UNVERIFIED",
        providerVerificationLastSucceededAt: null,
        providerEvidenceVersion: null,
      },
    });

    assert.deepEqual(await syncRemittancesForCompany(fixture.company.id), []);
    assert.deepEqual(await syncRemittancesForCompany(fixture.company.id), []);
    await assert.rejects(
      generateT4Package(fixture.company.id, TAX_YEAR),
      /ineligible payroll source records/
    );
    assert.equal(await prisma.remittance.count({ where: { companyId: fixture.company.id } }), 0);
    assert.equal(await prisma.t4Summary.count({ where: { companyId: fixture.company.id } }), 0);
    assert.equal(await prisma.t4Slip.count({ where: { companyId: fixture.company.id } }), 0);
    assert.equal(await prisma.document.count({ where: { companyId: fixture.company.id } }), 0);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { companyId: fixture.company.id, action: "T4_PACKAGE_GENERATION_FAILED" },
      orderBy: { id: "desc" },
    });
    const metadata = audit.metadataJson as {
      reasonCode?: string;
      includedCount?: number;
      excludedCount?: number;
      reasonCounts?: Record<string, number>;
    };
    assert.equal(metadata.reasonCode, "INELIGIBLE_PAYROLL_SOURCE_PRESENT");
    assert.equal(metadata.includedCount, 0);
    assert.equal(metadata.excludedCount, 1);
    assert.equal(metadata.reasonCounts?.PROVIDER_EVIDENCE_UNVERIFIED, 1);
    const remittanceAudit = await prisma.auditLog.findFirstOrThrow({
      where: { companyId: fixture.company.id, action: "REMITTANCE_GENERATION_SKIPPED" },
      orderBy: { id: "desc" },
    });
    assert.equal(
      (remittanceAudit.metadataJson as { reasonCounts?: Record<string, number> }).reasonCounts
        ?.PROVIDER_EVIDENCE_UNVERIFIED,
      1
    );
    assert.equal(await prisma.auditLog.count({
      where: { companyId: fixture.company.id, action: "REMITTANCE_GENERATION_SKIPPED" },
    }), 1);
  });

  await t.test("mixed T4 source fails whole without publishing a partial package", async () => {
    const fixture = await createPayrollFixture("mixed-t4-source");
    await addPayrollSourceToFixture(fixture, "mixed-t4-unverified", {
      verificationStatus: "LEGACY_UNVERIFIED",
      lastSucceededAt: null,
      evidenceVersion: null,
    });

    await assert.rejects(
      generateT4Package(fixture.company.id, TAX_YEAR),
      /ineligible payroll source records/
    );
    assert.equal(await prisma.t4Summary.count({ where: { companyId: fixture.company.id } }), 0);
    assert.equal(await prisma.t4Slip.count({ where: { companyId: fixture.company.id } }), 0);
    assert.equal(await prisma.document.count({ where: { companyId: fixture.company.id } }), 0);
    assert.deepEqual(await listCompanyArtifactFiles(fixture.company.id), []);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { companyId: fixture.company.id, action: "T4_PACKAGE_GENERATION_FAILED" },
      orderBy: { id: "desc" },
    });
    const metadata = audit.metadataJson as {
      includedCount?: number;
      excludedCount?: number;
      reasonCounts?: Record<string, number>;
    };
    assert.equal(metadata.includedCount, 1);
    assert.equal(metadata.excludedCount, 1);
    assert.equal(metadata.reasonCounts?.PROVIDER_EVIDENCE_UNVERIFIED, 1);
  });

  await t.test("mixed remittance source publishes totals and allocations from verified payroll only", async () => {
    const fixture = await createPayrollFixture("mixed-remittance-source");
    const excluded = await addPayrollSourceToFixture(fixture, "mixed-remittance-unverified", {
      verificationStatus: "UNVERIFIED",
      lastSucceededAt: null,
      evidenceVersion: null,
      grossPay: 9000,
      cpp: 900,
      ei: 900,
      incomeTax: 900,
    });

    await syncRemittancesForCompany(fixture.company.id);
    const remittance = await prisma.remittance.findFirstOrThrow({
      where: { companyId: fixture.company.id },
      include: { allocations: true, documents: true },
    });
    assert.equal(remittance.totalIncomeTax.toNumber(), 250);
    assert.equal(remittance.totalCppEmployee.toNumber(), 100);
    assert.equal(remittance.totalEiEmployee.toNumber(), 30);
    assert.equal(remittance.employeeCount, 1);
    assert.deepEqual(remittance.allocations.map((item) => item.payHistoryId), [fixture.payHistory.id]);
    assert.equal(remittance.allocations.some((item) => item.payHistoryId === excluded.history.id), false);
    assert.equal(remittance.documents.filter((item) => item.validationStatus === "ACTIVE").length, 1);
    const reconciliation = remittance.reconciliationSummary as {
      eligiblePayrollCount?: number;
      excludedPayrollCount?: number;
      reasonCounts?: Record<string, number>;
    };
    assert.equal(reconciliation.eligiblePayrollCount, 1);
    assert.equal(reconciliation.excludedPayrollCount, 1);
    assert.equal(reconciliation.reasonCounts?.PROVIDER_EVIDENCE_UNVERIFIED, 1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { companyId: fixture.company.id, action: "REMITTANCE_REPORT_PUBLISHED" },
      orderBy: { id: "desc" },
    });
    assert.equal(
      (audit.metadataJson as { reasonCounts?: Record<string, number> }).reasonCounts
        ?.PROVIDER_EVIDENCE_UNVERIFIED,
      1
    );
  });

  await t.test("new PAID rows remain ineligible until current provider evidence is verified", async () => {
    const fixture = await createPayrollFixture("new-paid-unverified");
    await prisma.payrollRun.update({
      where: { id: fixture.payrollRun.id },
      data: {
        providerVerificationStatus: "UNVERIFIED",
        providerVerificationLastSucceededAt: null,
        providerEvidenceVersion: null,
      },
    });
    const missingReference = await addPayrollSourceToFixture(fixture, "new-paid-no-reference", {
      verificationStatus: "UNVERIFIED",
      providerRef: null,
      lastSucceededAt: null,
      evidenceVersion: null,
    });

    assert.deepEqual(await syncRemittancesForCompany(fixture.company.id), []);
    await assert.rejects(generateT4Package(fixture.company.id, TAX_YEAR));
    const runs = await prisma.payrollRun.findMany({
      where: { id: { in: [fixture.payrollRun.id, missingReference.run.id] } },
      orderBy: { id: "asc" },
    });
    assert.equal(runs.every((run) => run.status === "PAID"), true);
    assert.equal(runs.every((run) => run.providerVerificationStatus === "UNVERIFIED"), true);
    assert.equal(await prisma.remittance.count({ where: { companyId: fixture.company.id } }), 0);
    assert.equal(await prisma.document.count({ where: { companyId: fixture.company.id } }), 0);
    const dashboard = await getCraDashboard(fixture.company.id);
    assert.equal(dashboard.providerVerification.eligiblePaidRunCount, 2);
    assert.equal(dashboard.providerVerification.unverifiedStatusCount, 2);
    assert.equal(dashboard.providerVerification.providerReferenceMissingCount, 1);
    assert.equal(dashboard.providerVerification.reviewRequired, true);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { companyId: fixture.company.id, action: "T4_PACKAGE_GENERATION_FAILED" },
      orderBy: { id: "desc" },
    });
    const reasonCounts = (audit.metadataJson as { reasonCounts?: Record<string, number> }).reasonCounts;
    assert.equal(reasonCounts?.PROVIDER_EVIDENCE_UNVERIFIED, 1);
    assert.equal(reasonCounts?.PROVIDER_REFERENCE_MISSING, 1);
  });

  await t.test("stale provider evidence marks published CRA artifacts review-required without losing snapshots", async () => {
    const fixture = await createPayrollFixture("stale-provider-after-publication");
    await syncRemittancesForCompany(fixture.company.id);
    await generateT4Package(fixture.company.id, TAX_YEAR);
    const originalRemittance = await prisma.remittance.findFirstOrThrow({
      where: { companyId: fixture.company.id },
      include: { documents: true },
    });
    await prisma.remittancePayment.create({
      data: {
        remittanceId: originalRemittance.id,
        paymentDate: new Date("2026-02-15"),
        amountPaid: 100,
        status: "RECORDED",
      },
    });
    const documents = await prisma.document.findMany({
      where: { companyId: fixture.company.id, validationStatus: "ACTIVE" },
    });
    assert.equal(documents.length >= 4, true);
    await prisma.payrollRun.update({
      where: { id: fixture.payrollRun.id },
      data: {
        providerVerificationLastSucceededAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });

    const dashboard = await getCraDashboard(fixture.company.id);
    assert.equal(dashboard.providerVerification.staleVerificationCount, 1);
    assert.equal(
      dashboard.providerVerification.unverifiedReasonCounts.PROVIDER_VERIFICATION_STALE,
      1
    );
    assert.equal(dashboard.providerVerification.reviewRequired, true);
    assert.equal(dashboard.providerVerification.blockedDocumentCount, documents.length);
    assert.equal(dashboard.documents.length, 0);
    assert.equal(dashboard.remittances[0]?.status, "REVIEW_REQUIRED");
    assert.equal(dashboard.outstandingTotal.toNumber(), 0);
    assert.equal(dashboard.nextDue, null);
    const summary = dashboard.t4Summaries[0];
    assert.equal(getT4SummaryDisplayStatus(summary.status, 0), "REVIEW REQUIRED");
    assert.equal(getT4SlipDocumentLabel(summary.slips[0].status, false), "Review required — no validated file");
    for (const document of documents) {
      assert.equal(await getDownloadableDocument(fixture.company.id, document.id), null);
      assert.equal(Boolean(await fs.stat(path.resolve(process.cwd(), document.storagePath))), true);
    }
    const uiServer = await startAuthenticatedTestServer({
      companyId: fixture.company.id,
      email: "legacy-provider-review-admin@integration.invalid",
      password: "integration-password",
    });
    try {
      const response = await fetch(`${uiServer.baseUrl}/cra`, {
        headers: { cookie: uiServer.cookie },
      });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.equal(html.includes("REVIEW REQUIRED"), true);
      const visibleText = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
      assert.equal(visibleText.includes(`Blocked documents: ${documents.length}`), true);
      for (const document of documents) {
        assert.equal(html.includes(`/api/documents/${document.id.toString()}`), false);
      }
      const t4Response = await fetch(`${uiServer.baseUrl}/cra/t4`, {
        headers: { cookie: uiServer.cookie },
      });
      assert.equal(t4Response.status, 200);
      const t4Html = await t4Response.text();
      assert.equal(t4Html.includes("REVIEW REQUIRED"), true);
      for (const document of documents) {
        assert.equal(t4Html.includes(`/api/documents/${document.id.toString()}`), false);
      }

      await syncRemittancesForCompany(fixture.company.id);
      const reviewedRemittance = await prisma.remittance.findUniqueOrThrow({
        where: { id: originalRemittance.id },
        include: { payments: true, documents: true },
      });
      assert.equal(reviewedRemittance.status, "REVIEW_REQUIRED");
      assert.equal(
        reviewedRemittance.totalPayable.toFixed(2),
        originalRemittance.totalPayable.toFixed(2)
      );
      assert.equal(reviewedRemittance.payments.length, 1);
      assert.equal(
        reviewedRemittance.documents.every((document) => document.validationStatus === "QUARANTINED"),
        true
      );
      assert.equal(
        (await prisma.t4Summary.findFirstOrThrow({ where: { companyId: fixture.company.id } })).status,
        "GENERATED"
      );
      for (const document of documents) {
        assert.equal(Boolean(await fs.stat(path.resolve(process.cwd(), document.storagePath))), true);
      }
    } finally {
      await stopTestServer(uiServer.server);
      await prisma.payrollRun.update({
        where: { id: fixture.payrollRun.id },
        data: { status: "REVIEW_REQUIRED" },
      });
    }
  });

  await t.test("stale remittance preserves published totals and quarantines allocations/report", async () => {
    const fixture = await createPayrollFixture("remittance-stale");
    await prisma.payHistory.create({
      data: {
        employeeId: fixture.employee.id,
        payrollRunId: fixture.payrollRun.id,
        payDate: fixture.payrollRun.payDate,
        grossPay: 9999,
        ded_cpp: 999,
        ded_ei: 999,
        ded_income_tax: 999,
        netPay: 7002,
        status: "READY",
        paidAt: fixture.payrollRun.payDate,
      },
    });
    await syncRemittancesForCompany(fixture.company.id);
    const initial = await prisma.remittance.findFirstOrThrow({
      where: { companyId: fixture.company.id },
      include: { documents: true, allocations: true },
    });
    assert.equal(initial.allocations.length, 1);
    assert.equal(initial.totalIncomeTax.toNumber(), 250);
    assert.equal(initial.documents.some((document) => document.validationStatus === "ACTIVE"), true);
    await prisma.remittancePayment.create({
      data: {
        remittanceId: initial.id,
        paymentDate: new Date(`${TAX_YEAR}-02-01T12:00:00.000Z`),
        amountPaid: initial.totalPayable,
        status: "RECORDED",
      },
    });
    await prisma.payHistory.update({
      where: { id: fixture.payHistory.id },
      data: { status: "READY" },
    });

    await syncRemittancesForCompany(fixture.company.id);
    const reconciled = await prisma.remittance.findUniqueOrThrow({
      where: { id: initial.id },
      include: { documents: true, allocations: true, payments: true },
    });
    assert.equal(reconciled.status, "REVIEW_REQUIRED");
    assert.equal(reconciled.totalPayable.toNumber(), initial.totalPayable.toNumber());
    assert.equal(reconciled.employeeCount, initial.employeeCount);
    assert.equal(
      (reconciled.reconciliationSummary as { reasonCode?: string } | null)?.reasonCode,
      "INELIGIBLE_PROVIDER_EVIDENCE_FOR_PERIOD"
    );
    assert.equal(reconciled.allocations.length, 0);
    assert.equal(reconciled.payments.length, 1);
    assert.equal(reconciled.documents.every((document) => document.validationStatus === "QUARANTINED"), true);
    assert.equal(
      await getDownloadableDocument(fixture.company.id, initial.documents[0].id),
      null
    );
    const reconciliation = reconciled.reconciliationSummary as {
      priorPublishedSnapshot?: { totalPayable?: string; employeeCount?: number };
    };
    assert.equal(reconciliation.priorPublishedSnapshot?.totalPayable, initial.totalPayable.toFixed(2));
    assert.equal(reconciliation.priorPublishedSnapshot?.employeeCount, initial.employeeCount);
    const dashboard = await getCraDashboard(fixture.company.id);
    assert.equal(dashboard.outstandingTotal.toNumber(), 0);
    assert.equal(dashboard.nextDue, null);
  });

  await t.test("official Trolley processed response atomically creates compliance eligibility", async () => {
    const lifecycle = await preparePayingTrolleyFixture("trusted-payment-lifecycle");
    const processedPayment = trolleyProcessedPayment(lifecycle, {
      batchId: lifecycle.batchId,
      paymentId: lifecycle.paymentId,
    });
    assert.equal(OFFICIAL_TROLLEY_PROCESSED_FIXTURE.payment.status, "processed");
    assert.equal(processedPayment.processedAt, "2026-01-16T11:00:00.000Z");

    const result = await reconcilePayrollRunFromTrolley(lifecycle.payrollRun.id, {
      loadBatchPayments: async (batchId) => {
        assert.equal(batchId, lifecycle.batchId);
        return {
          items: [processedPayment],
          hasMore: false,
        };
      },
    });
    assert.equal(result.changed, true);
    const [run, child] = await Promise.all([
      prisma.payrollRun.findUniqueOrThrow({ where: { id: lifecycle.payrollRun.id } }),
      prisma.payHistory.findUniqueOrThrow({ where: { id: lifecycle.payHistory.id } }),
    ]);
    assert.equal(run.status, "PAID");
    assert.equal(child.status, "SENT");
    assert.equal(child.paidAt?.toISOString(), "2026-01-16T11:00:00.000Z");

    await syncRemittancesForCompany(lifecycle.company.id);
    assert.equal(await prisma.remittancePayHistory.count({
      where: { payHistoryId: lifecycle.payHistory.id },
    }), 1);

    const repeated = await reconcilePayrollRunFromTrolley(lifecycle.payrollRun.id, {
      loadBatchPayments: async () => ({
        items: [processedPayment],
        hasMore: false,
      }),
    });
    assert.equal(repeated.changed, false);
    assert.equal(await prisma.auditLog.count({
      where: {
        companyId: lifecycle.company.id,
        action: "PAYROLL_PROVIDER_PAYMENT_RECONCILED",
      },
    }), 1);
  });

  await t.test("provider payment exact-set rejects missing duplicate and unexpected IDs atomically", async () => {
    const cases: Array<{
      label: string;
      reasonCode: string;
      payments: (fixture: Awaited<ReturnType<typeof preparePayingTrolleyFixture>>) => Payment[];
    }> = [
      {
        label: "missing-id",
        reasonCode: "PROVIDER_PAYMENT_ID_MISSING",
        payments: (fixture) => [trolleyProcessedPayment(fixture, {
          batchId: fixture.batchId,
          paymentId: "",
        })],
      },
      {
        label: "duplicate-provider-id",
        reasonCode: "DUPLICATE_PROVIDER_PAYMENT_ID",
        payments: (fixture) => {
          const payment = trolleyProcessedPayment(fixture, {
            batchId: fixture.batchId,
            paymentId: fixture.paymentId,
          });
          return [payment, { ...payment }];
        },
      },
      {
        label: "unexpected-provider-id",
        reasonCode: "UNEXPECTED_PROVIDER_PAYMENT",
        payments: (fixture) => {
          const expected = trolleyProcessedPayment(fixture, {
            batchId: fixture.batchId,
            paymentId: fixture.paymentId,
          });
          return [expected, { ...expected, id: `P-unrelated-${fixture.payrollRun.id.toString()}` }];
        },
      },
    ];

    for (const testCase of cases) {
      const fixture = await preparePayingTrolleyFixture(`exact-set-${testCase.label}`);
      const childBefore = await prisma.payHistory.findUniqueOrThrow({
        where: { id: fixture.payHistory.id },
      });
      await assert.rejects(
        reconcilePayrollRunFromTrolley(fixture.payrollRun.id, {
          loadBatchPayments: async () => ({ items: testCase.payments(fixture), hasMore: false }),
        }),
        (error) => error instanceof PayrollPaymentReconciliationError && error.code === testCase.reasonCode
      );
      const [parentAfter, childAfter, audit] = await Promise.all([
        prisma.payrollRun.findUniqueOrThrow({ where: { id: fixture.payrollRun.id } }),
        prisma.payHistory.findUniqueOrThrow({ where: { id: fixture.payHistory.id } }),
        prisma.auditLog.findFirstOrThrow({
          where: {
            companyId: fixture.company.id,
            action: "PAYROLL_PROVIDER_PAYMENT_RECONCILIATION_REJECTED",
            targetId: fixture.payrollRun.id.toString(),
          },
          orderBy: { id: "desc" },
        }),
      ]);
      assert.equal(parentAfter.status, "PAYING");
      assert.deepEqual(
        { status: childAfter.status, paidAt: childAfter.paidAt, paymentRef: childAfter.paymentRef },
        { status: childBefore.status, paidAt: childBefore.paidAt, paymentRef: childBefore.paymentRef }
      );
      assert.equal((audit.metadataJson as { reasonCode?: string }).reasonCode, testCase.reasonCode);
    }

    const paidFixture = await preparePayingTrolleyFixture("exact-set-paid-revalidation");
    const expected = trolleyProcessedPayment(paidFixture, {
      batchId: paidFixture.batchId,
      paymentId: paidFixture.paymentId,
    });
    await reconcilePayrollRunFromTrolley(paidFixture.payrollRun.id, {
      loadBatchPayments: async () => ({ items: [expected], hasMore: false }),
    });
    await syncRemittancesForCompany(paidFixture.company.id);
    await generateT4Package(paidFixture.company.id, TAX_YEAR);
    const unexpected = { ...expected, id: `P-unrelated-paid-${paidFixture.payrollRun.id.toString()}` };
    const reviewed = await reconcilePayrollRunFromTrolley(paidFixture.payrollRun.id, {
      loadBatchPayments: async () => ({ items: [expected, unexpected], hasMore: false }),
    });
    assert.equal(reviewed.reviewRequired, true);
    assert.equal("reasonCode" in reviewed ? reviewed.reasonCode : null, "UNEXPECTED_PROVIDER_PAYMENT");
    assert.equal(
      (await prisma.payrollRun.findUniqueOrThrow({ where: { id: paidFixture.payrollRun.id } })).status,
      "REVIEW_REQUIRED"
    );
    assert.equal(await prisma.document.count({
      where: { companyId: paidFixture.company.id, validationStatus: "ACTIVE" },
    }), 0);
  });

  await t.test("contradictory child states and evidence roll back parent PAID transition with reason audits", async () => {
    const cases: Array<{
      label: string;
      reasonCode: string;
      arrange: (fixture: Awaited<ReturnType<typeof preparePayingTrolleyFixture>>) => Promise<Payment[]>;
    }> = [
      {
        label: "child-failed",
        reasonCode: "PAID_PARENT_CHILD_STATUS_CONFLICT",
        arrange: async (fixture) => {
          await prisma.payHistory.update({ where: { id: fixture.payHistory.id }, data: { status: "FAILED" } });
          return [trolleyProcessedPayment(fixture, { batchId: fixture.batchId, paymentId: fixture.paymentId })];
        },
      },
      {
        label: "child-ready",
        reasonCode: "PAID_PARENT_CHILD_STATUS_CONFLICT",
        arrange: async (fixture) => {
          await prisma.payHistory.update({ where: { id: fixture.payHistory.id }, data: { status: "READY" } });
          return [trolleyProcessedPayment(fixture, { batchId: fixture.batchId, paymentId: fixture.paymentId })];
        },
      },
      {
        label: "missing-child-reference",
        reasonCode: "MISSING_CHILD_PROVIDER_REFERENCE",
        arrange: async (fixture) => {
          await prisma.payHistory.update({
            where: { id: fixture.payHistory.id },
            data: { paymentRef: null },
          });
          return [];
        },
      },
      {
        label: "duplicate-reference",
        reasonCode: "DUPLICATE_CHILD_PROVIDER_REFERENCE",
        arrange: async (fixture) => {
          await prisma.payHistory.create({
            data: {
              employeeId: fixture.employee.id,
              payrollRunId: fixture.payrollRun.id,
              payDate: fixture.payrollRun.payDate,
              grossPay: 100,
              netPay: 80,
              status: "SENDING",
              paymentProvider: "trolley",
              paymentRef: fixture.paymentId,
            },
          });
          return [trolleyProcessedPayment(fixture, { batchId: fixture.batchId, paymentId: fixture.paymentId })];
        },
      },
      {
        label: "missing-evidence",
        reasonCode: "MISSING_PROVIDER_PAYMENT_EVIDENCE",
        arrange: async () => [],
      },
    ];

    for (const testCase of cases) {
      const fixture = await preparePayingTrolleyFixture(`conflict-${testCase.label}`);
      const payments = await testCase.arrange(fixture);
      const childBefore = await prisma.payHistory.findMany({
        where: { payrollRunId: fixture.payrollRun.id },
        orderBy: { id: "asc" },
      });
      await assert.rejects(
        reconcilePayrollRunFromTrolley(fixture.payrollRun.id, {
          loadBatchPayments: async () => ({ items: payments, hasMore: false }),
        }),
        (error) => error instanceof PayrollPaymentReconciliationError && error.code === testCase.reasonCode
      );
      const parent = await prisma.payrollRun.findUniqueOrThrow({ where: { id: fixture.payrollRun.id } });
      const childAfter = await prisma.payHistory.findMany({
        where: { payrollRunId: fixture.payrollRun.id },
        orderBy: { id: "asc" },
      });
      assert.equal(parent.status, "PAYING");
      assert.deepEqual(
        childAfter.map(({ id, status, paidAt, paymentRef }) => ({ id, status, paidAt, paymentRef })),
        childBefore.map(({ id, status, paidAt, paymentRef }) => ({ id, status, paidAt, paymentRef }))
      );
      const rejectedAudit = await prisma.auditLog.findFirstOrThrow({
        where: {
          companyId: fixture.company.id,
          action: "PAYROLL_PROVIDER_PAYMENT_RECONCILIATION_REJECTED",
          targetId: fixture.payrollRun.id.toString(),
        },
        orderBy: { id: "desc" },
      });
      assert.equal(
        (rejectedAudit.metadataJson as { reasonCode?: string }).reasonCode,
        testCase.reasonCode
      );
    }
  });

  await t.test("Trolley batch external metadata amount and currency mismatches fail closed", async () => {
    const cases: Array<{ label: string; reasonCode: string; override: Partial<Payment> }> = [
      {
        label: "batch",
        reasonCode: "PROVIDER_BATCH_ID_MISMATCH",
        override: { batch: { id: "B-wrong-batch" } },
      },
      {
        label: "external-id",
        reasonCode: "PROVIDER_EXTERNAL_ID_MISMATCH",
        override: { externalId: "company:wrong:pay-history:wrong" },
      },
      {
        label: "metadata",
        reasonCode: "PROVIDER_METADATA_MISMATCH",
        override: { metadata: { companyId: "wrong", payrollRunId: "wrong", payHistoryId: "wrong" } },
      },
      {
        label: "amount",
        reasonCode: "PROVIDER_AMOUNT_MISMATCH",
        override: { sourceAmount: "9999.99" },
      },
      {
        label: "currency",
        reasonCode: "PROVIDER_CURRENCY_MISMATCH",
        override: { sourceCurrency: "USD" },
      },
    ];

    for (const testCase of cases) {
      const fixture = await preparePayingTrolleyFixture(`identity-${testCase.label}`);
      const payment = trolleyProcessedPayment(fixture, {
        batchId: fixture.batchId,
        paymentId: fixture.paymentId,
        overrides: testCase.override,
      });
      await assert.rejects(
        reconcilePayrollRunFromTrolley(fixture.payrollRun.id, {
          loadBatchPayments: async () => ({ items: [payment], hasMore: false }),
        }),
        (error) => error instanceof PayrollPaymentReconciliationError && error.code === testCase.reasonCode
      );
      assert.equal(
        (await prisma.payrollRun.findUniqueOrThrow({ where: { id: fixture.payrollRun.id } })).status,
        "PAYING"
      );
      assert.equal(
        (await prisma.payHistory.findUniqueOrThrow({ where: { id: fixture.payHistory.id } })).paidAt,
        null
      );
    }
  });

  await t.test("91-day-old returned payment quarantines the complete multi-employee CRA package", async () => {
    const returnedFixture = await preparePayingTrolleyFixture("processed-then-returned");
    const secondEmployee = await prisma.employee.create({
      data: {
        companyId: returnedFixture.company.id,
        firstName: "Second",
        lastName: "Employee",
        email: "processed-returned-second@integration.invalid",
        sin: returnedFixture.ciphertext,
        addrLine1: "2 Test Way",
        addrCity: "Ottawa",
        addrProvince: "ON",
        addrPostal: "K1A0B2",
        addrCountry: "CA",
        birthDate: new Date("1991-01-01T00:00:00.000Z"),
        employmentType: "FULL_TIME",
        hireDate: new Date("2025-01-01T00:00:00.000Z"),
        payType: "SALARY",
        salary: 50000,
      },
    });
    const secondPaymentId = "P-processed-then-returned-second";
    const secondPayHistory = await prisma.payHistory.create({
      data: {
        employeeId: secondEmployee.id,
        payrollRunId: returnedFixture.payrollRun.id,
        payDate: returnedFixture.payrollRun.payDate,
        grossPay: 1800,
        ded_cpp: 90,
        ded_ei: 25,
        ded_income_tax: 220,
        netPay: 1465,
        status: "SENDING",
        paidAt: null,
        paymentProvider: "trolley",
        paymentRef: secondPaymentId,
      },
    });
    const processed = trolleyProcessedPayment(returnedFixture, {
      batchId: returnedFixture.batchId,
      paymentId: returnedFixture.paymentId,
    });
    const secondProcessed = trolleyProcessedPayment(returnedFixture, {
      batchId: returnedFixture.batchId,
      paymentId: secondPaymentId,
      payHistory: secondPayHistory,
    });
    await reconcilePayrollRunFromTrolley(returnedFixture.payrollRun.id, {
      loadBatchPayments: async () => ({ items: [processed, secondProcessed], hasMore: false }),
    });
    await syncRemittancesForCompany(returnedFixture.company.id);
    await generateT4Package(returnedFixture.company.id, TAX_YEAR);
    const generatedSummary = await prisma.t4Summary.findFirstOrThrow({
      where: { companyId: returnedFixture.company.id, taxYear: TAX_YEAR },
    });
    await prisma.$transaction([
      prisma.t4Summary.update({
        where: { id: generatedSummary.id },
        data: { status: "FINALIZED", finalizedAt: new Date("2026-02-28T12:00:00.000Z") },
      }),
      prisma.t4Slip.updateMany({
        where: { summaryId: generatedSummary.id },
        data: { status: "FINALIZED", finalizedAt: new Date("2026-02-28T12:00:00.000Z") },
      }),
    ]);

    const remittanceBefore = await prisma.remittance.findFirstOrThrow({
      where: { companyId: returnedFixture.company.id },
      include: { allocations: true },
    });
    assert.equal(remittanceBefore.allocations.length, 2);
    const activeDocuments = await prisma.document.findMany({
      where: { companyId: returnedFixture.company.id, validationStatus: "ACTIVE" },
    });
    assert.equal(activeDocuments.length, 5);
    const retainedPaths = activeDocuments.map((document) => path.resolve(process.cwd(), document.storagePath));

    await prisma.payrollRun.updateMany({
      where: { id: { not: returnedFixture.payrollRun.id } },
      data: { providerRef: null },
    });
    const moreThanNinetyOneDaysAgo = new Date(Date.now() - 92 * 24 * 60 * 60 * 1000);
    await prisma.payrollRun.update({
      where: { id: returnedFixture.payrollRun.id },
      data: { updatedAt: moreThanNinetyOneDaysAgo },
    });
    const returned = trolleyProcessedPayment(returnedFixture, {
      batchId: returnedFixture.batchId,
      paymentId: returnedFixture.paymentId,
      overrides: {
        status: "returned",
        returnedAt: "2026-02-01T12:00:00.000Z",
        returnedReason: ["bank_account_closed"],
      },
    });
    const revalidation = await revalidatePaidPayrollRunsFromTrolley({
      loadBatchPayments: async (batchId) => {
        assert.equal(batchId, returnedFixture.batchId);
        return { items: [returned, secondProcessed], hasMore: false };
      },
    });
    assert.equal(revalidation.reviewRequired, 1);
    assert.equal(revalidation.failed, 0);

    const [reviewedRun, reviewedChildren, reviewedRemittance, reviewedSummary, reviewedSlips, reviewedDocuments] = await Promise.all([
      prisma.payrollRun.findUniqueOrThrow({ where: { id: returnedFixture.payrollRun.id } }),
      prisma.payHistory.findMany({
        where: { payrollRunId: returnedFixture.payrollRun.id },
        orderBy: { id: "asc" },
      }),
      prisma.remittance.findUniqueOrThrow({
        where: { id: remittanceBefore.id },
        include: { allocations: true, payments: true },
      }),
      prisma.t4Summary.findFirstOrThrow({
        where: { companyId: returnedFixture.company.id, taxYear: TAX_YEAR },
      }),
      prisma.t4Slip.findMany({
        where: { companyId: returnedFixture.company.id, taxYear: TAX_YEAR },
        orderBy: { id: "asc" },
      }),
      prisma.document.findMany({ where: { companyId: returnedFixture.company.id } }),
    ]);
    assert.equal(reviewedRun.status, "REVIEW_REQUIRED");
    assert.equal(reviewedRun.failureReason, "TROLLEY_PAYMENT_RETURNED");
    assert.equal(reviewedChildren.length, 2);
    assert.equal(reviewedChildren.every((child) => child.status === "REVIEW_REQUIRED"), true);
    assert.equal(reviewedRemittance.status, "REVIEW_REQUIRED");
    assert.equal(reviewedRemittance.totalPayable.toFixed(2), remittanceBefore.totalPayable.toFixed(2));
    assert.equal(reviewedRemittance.allocations.length, 0);
    assert.equal(reviewedSummary.status, "FINALIZED");
    assert.equal(reviewedSlips.length, 2);
    assert.equal(reviewedSlips.every((slip) => slip.status === "FINALIZED"), true);
    assert.deepEqual(reviewedSummary.validationSummary, generatedSummary.validationSummary);
    assert.equal(reviewedDocuments.every((document) => document.validationStatus === "QUARANTINED"), true);
    for (const document of reviewedDocuments) {
      assert.equal(await getDownloadableDocument(returnedFixture.company.id, document.id), null);
    }
    for (const retainedPath of retainedPaths) {
      assert.equal(Boolean(await fs.stat(retainedPath)), true);
    }
    assert.equal(getT4SummaryDisplayStatus(reviewedSummary.status, 0), "FINALIZED — REVIEW REQUIRED");
    assert.equal(
      reviewedSlips.every((slip) =>
        getT4SlipDocumentLabel(slip.status, false) === "Review required — no validated file"
      ),
      true
    );
    const dashboard = await getCraDashboard(returnedFixture.company.id);
    assert.equal(dashboard.outstandingTotal.toFixed(2), "0.00");
    assert.equal(dashboard.nextDue, null);
    assert.equal(await prisma.auditLog.count({
      where: {
        companyId: returnedFixture.company.id,
        action: "PAYROLL_PROVIDER_PAYMENT_REVIEW_REQUIRED",
      },
    }), 1);
    const t4Audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        companyId: returnedFixture.company.id,
        action: "T4_PROVIDER_PAYMENT_REVIEW_REQUIRED",
        targetId: reviewedSummary.id.toString(),
      },
      orderBy: { id: "desc" },
    });
    assert.deepEqual(t4Audit.metadataJson, {
      reasonCode: "TROLLEY_PAYMENT_RETURNED",
      providerStatus: "returned",
      generationId: reviewedSummary.generationId,
      affectedSummaryCount: 1,
      affectedSlipCount: 2,
      affectedDocumentCount: 4,
      finalizedSummaryCount: 1,
      finalizedSlipCount: 2,
    });
    const auditMetadata = await prisma.auditLog.findMany({
      where: { companyId: returnedFixture.company.id },
      select: { metadataJson: true },
    });
    const serializedAuditMetadata = JSON.stringify(auditMetadata);
    assert.equal(serializedAuditMetadata.includes(TEST_ONLY_SIN), false);
    assert.equal(serializedAuditMetadata.includes(returnedFixture.ciphertext), false);

    const failedFixture = await preparePayingTrolleyFixture("processed-then-failed");
    const failedProcessed = trolleyProcessedPayment(failedFixture, {
      batchId: failedFixture.batchId,
      paymentId: failedFixture.paymentId,
    });
    await reconcilePayrollRunFromTrolley(failedFixture.payrollRun.id, {
      loadBatchPayments: async () => ({ items: [failedProcessed], hasMore: false }),
    });
    const failed = { ...failedProcessed, status: "failed", failureMessage: "recipient bank rejected" };
    const failedResult = await reconcilePayrollRunFromTrolley(failedFixture.payrollRun.id, {
      loadBatchPayments: async () => ({ items: [failed], hasMore: false }),
    });
    assert.equal(failedResult.reviewRequired, true);
    assert.equal("reasonCode" in failedResult ? failedResult.reasonCode : null, "TROLLEY_PAYMENT_FAILED");
    assert.equal(
      (await prisma.payrollRun.findUniqueOrThrow({ where: { id: failedFixture.payrollRun.id } })).status,
      "REVIEW_REQUIRED"
    );
  });

  await t.test("UTC-midnight January 1 reversal quarantines only the correct T4 tax year", async () => {
    const boundaryFixture = await preparePayingTrolleyFixture(
      "tax-year-utc-boundary",
      new Date("2026-01-01")
    );
    assert.equal(boundaryFixture.payrollRun.payDate.toISOString(), "2026-01-01T00:00:00.000Z");
    const processed = trolleyProcessedPayment(boundaryFixture, {
      batchId: boundaryFixture.batchId,
      paymentId: boundaryFixture.paymentId,
    });
    await reconcilePayrollRunFromTrolley(boundaryFixture.payrollRun.id, {
      loadBatchPayments: async () => ({ items: [processed], hasMore: false }),
    });

    const priorRun = await prisma.payrollRun.create({
      data: {
        companyId: boundaryFixture.company.id,
        payDate: new Date("2025-12-31"),
        status: "PAID",
        providerRef: "B-tax-year-2025",
        providerVerificationLastAttemptAt: new Date(),
        providerVerificationLastSucceededAt: new Date(),
        providerVerificationStatus: "VERIFIED",
        providerEvidenceVersion: CURRENT_PROVIDER_EVIDENCE_VERSION,
      },
    });
    await prisma.payHistory.create({
      data: {
        employeeId: boundaryFixture.employee.id,
        payrollRunId: priorRun.id,
        payDate: new Date("2025-12-31"),
        grossPay: 1700,
        ded_cpp: 80,
        ded_ei: 25,
        ded_income_tax: 200,
        netPay: 1395,
        status: "SENT",
        paidAt: new Date("2025-12-31"),
        paymentProvider: "trolley",
        paymentRef: "P-tax-year-2025",
      },
    });

    await syncRemittancesForCompany(boundaryFixture.company.id);
    const remittancePeriods = await prisma.remittance.findMany({
      where: { companyId: boundaryFixture.company.id },
      orderBy: { periodStart: "asc" },
      select: { periodStart: true, periodEnd: true },
    });
    assert.deepEqual(remittancePeriods.map((period) => ({
      start: period.periodStart.toISOString(),
      end: period.periodEnd.toISOString(),
    })), [
      { start: "2025-12-01T00:00:00.000Z", end: "2025-12-31T00:00:00.000Z" },
      { start: "2026-01-01T00:00:00.000Z", end: "2026-01-31T00:00:00.000Z" },
    ]);

    await generateT4Package(boundaryFixture.company.id, 2025);
    await generateT4Package(boundaryFixture.company.id, 2026);
    const summaries = await prisma.t4Summary.findMany({
      where: { companyId: boundaryFixture.company.id },
      orderBy: { taxYear: "asc" },
    });
    assert.deepEqual(summaries.map((summary) => summary.taxYear), [2025, 2026]);
    await prisma.$transaction([
      prisma.t4Summary.updateMany({
        where: { companyId: boundaryFixture.company.id },
        data: { status: "FINALIZED", finalizedAt: new Date("2026-02-28T00:00:00.000Z") },
      }),
      prisma.t4Slip.updateMany({
        where: { companyId: boundaryFixture.company.id },
        data: { status: "FINALIZED", finalizedAt: new Date("2026-02-28T00:00:00.000Z") },
      }),
    ]);
    const documentsBefore = await prisma.document.findMany({
      where: { companyId: boundaryFixture.company.id, validationStatus: "ACTIVE" },
    });
    const retainedPaths = documentsBefore.map((document) =>
      path.resolve(process.cwd(), document.storagePath)
    );
    assert.equal(documentsBefore.filter((document) => document.taxYear === 2025).length, 3);
    assert.equal(documentsBefore.filter((document) => document.taxYear === 2026).length, 3);

    const returned = {
      ...processed,
      status: "returned",
      returnedAt: "2026-03-01T00:00:00.000Z",
      returnedReason: ["bank_account_closed"],
    };
    const reviewed = await reconcilePayrollRunFromTrolley(boundaryFixture.payrollRun.id, {
      loadBatchPayments: async () => ({ items: [returned], hasMore: false }),
    });
    assert.equal(reviewed.reviewRequired, true);

    const [summariesAfter, slipsAfter, documentsAfter] = await Promise.all([
      prisma.t4Summary.findMany({
        where: { companyId: boundaryFixture.company.id },
        orderBy: { taxYear: "asc" },
      }),
      prisma.t4Slip.findMany({
        where: { companyId: boundaryFixture.company.id },
        orderBy: { taxYear: "asc" },
      }),
      prisma.document.findMany({
        where: { companyId: boundaryFixture.company.id },
        orderBy: { id: "asc" },
      }),
    ]);
    assert.equal(summariesAfter.every((summary) => summary.status === "FINALIZED"), true);
    assert.equal(slipsAfter.every((slip) => slip.status === "FINALIZED"), true);
    const documents2025 = documentsAfter.filter((document) => document.taxYear === 2025);
    const documents2026 = documentsAfter.filter((document) => document.taxYear === 2026);
    assert.equal(documents2025.every((document) => document.validationStatus === "ACTIVE"), true);
    assert.equal(documents2026.every((document) => document.validationStatus === "QUARANTINED"), true);
    for (const document of documents2025) {
      assert.notEqual(await getDownloadableDocument(boundaryFixture.company.id, document.id), null);
    }
    for (const document of documents2026) {
      assert.equal(await getDownloadableDocument(boundaryFixture.company.id, document.id), null);
    }
    for (const retainedPath of retainedPaths) {
      assert.equal(Boolean(await fs.stat(retainedPath)), true);
    }
  });

  await t.test("100 percent provider timeout persists failure evidence breaches freshness SLA and blocks CRA downloads until recovery", async () => {
    await prisma.payrollRun.updateMany({
      where: { status: "PAID" },
      data: { status: "REVIEW_REQUIRED", providerRef: null },
    });
    await prisma.payrollProviderVerificationAttempt.deleteMany();
    await prisma.payrollReconciliationCheckpoint.deleteMany({
      where: { jobName: TROLLEY_PAID_REVALIDATION_JOB },
    });
    const fixture = await preparePayingTrolleyFixture("verification-timeout-recovery");
    const processedPayment = trolleyProcessedPayment(fixture, {
      batchId: fixture.batchId,
      paymentId: fixture.paymentId,
    });
    await reconcilePayrollRunFromTrolley(fixture.payrollRun.id, {
      loadBatchPayments: async () => ({ items: [processedPayment], hasMore: false }),
    });
    await syncRemittancesForCompany(fixture.company.id);
    await generateT4Package(fixture.company.id, TAX_YEAR);
    const documents = await prisma.document.findMany({
      where: { companyId: fixture.company.id, validationStatus: "ACTIVE" },
    });
    assert.equal(documents.length >= 4, true);
    const retainedPaths = documents.map((document) => path.resolve(process.cwd(), document.storagePath));
    await prisma.payrollRun.update({
      where: { id: fixture.payrollRun.id },
      data: {
        providerVerificationLastSucceededAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });

    const timedOut = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 1,
      loadBatchPayments: async (_batchId, { timeoutMs }) => {
        throw new TrolleyRequestTimeoutError(timeoutMs ?? 0);
      },
    });
    assert.deepEqual({
      processed: timedOut.processed,
      failed: timedOut.failed,
      attemptedProviderRequests: timedOut.attemptedProviderRequests,
      successfulProviderRequests: timedOut.successfulProviderRequests,
      timedOutRequests: timedOut.timedOutRequests,
      pagesFetched: timedOut.pagesFetched,
    }, {
      processed: 0,
      failed: 1,
      attemptedProviderRequests: 1,
      successfulProviderRequests: 0,
      timedOutRequests: 1,
      pagesFetched: 0,
    });
    const failedRun = await prisma.payrollRun.findUniqueOrThrow({
      where: { id: fixture.payrollRun.id },
    });
    assert.equal(failedRun.status, "PAID");
    assert.equal(failedRun.providerVerificationStatus, "RETRYABLE_FAILURE");
    assert.equal(failedRun.providerVerificationLastAttemptAt !== null, true);
    assert.equal(failedRun.providerVerificationLastSucceededAt !== null, true);
    assert.equal(failedRun.providerVerificationFailureCode, "TROLLEY_PROVIDER_REQUEST_TIMEOUT");
    assert.equal(failedRun.providerVerificationConsecutiveFailures, 1);

    const failedHealth = await getPaidRevalidationOperationalHealth();
    assert.equal(failedHealth.eligiblePaidRunCount, 1);
    assert.equal(failedHealth.successfullyVerifiedWithinSlaCount, 0);
    assert.equal(failedHealth.neverSuccessfullyVerifiedCount, 0);
    assert.equal(failedHealth.staleVerificationCount, 1);
    assert.equal(failedHealth.unresolvedFailureCount, 1);
    assert.equal(failedHealth.failedCount, 1);
    assert.equal(failedHealth.timedOutRequests, 1);
    assert.equal(failedHealth.slaBreached, true);
    assert.equal(getPaidRevalidationHttpStatus(failedHealth), 503);
    const failedDashboard = await getCraDashboard(fixture.company.id);
    assert.equal(failedDashboard.providerVerification.reviewRequired, true);
    assert.equal(failedDashboard.providerVerification.neverSuccessfullyVerifiedCount, 0);
    assert.equal(failedDashboard.providerVerification.staleVerificationCount, 1);
    assert.equal(failedDashboard.providerVerification.blockedDocumentCount, documents.length);
    assert.equal(failedDashboard.documents.length, 0);
    assert.equal(failedDashboard.remittances.every((item) => item.status === "REVIEW_REQUIRED"), true);
    assert.equal(failedDashboard.outstandingTotal.toNumber(), 0);
    assert.equal(failedDashboard.nextDue, null);
    for (const document of documents) {
      assert.equal(await getDownloadableDocument(fixture.company.id, document.id), null);
    }
    for (const retainedPath of retainedPaths) {
      assert.equal(Boolean(await fs.stat(retainedPath)), true);
    }

    const recovered = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 1,
      loadBatchPayments: async () => ({ items: [processedPayment], hasMore: false }),
    });
    assert.equal(recovered.processed, 1);
    const recoveredRun = await prisma.payrollRun.findUniqueOrThrow({
      where: { id: fixture.payrollRun.id },
    });
    assert.equal(recoveredRun.providerVerificationStatus, "VERIFIED");
    assert.equal(recoveredRun.providerVerificationLastSucceededAt !== null, true);
    assert.equal(recoveredRun.providerVerificationFailureCode, null);
    assert.equal(recoveredRun.providerVerificationConsecutiveFailures, 0);
    const recoveredHealth = await getPaidRevalidationOperationalHealth();
    assert.equal(recoveredHealth.successfullyVerifiedWithinSlaCount, 1);
    assert.equal(recoveredHealth.neverSuccessfullyVerifiedCount, 0);
    assert.equal(recoveredHealth.unresolvedFailureCount, 0);
    assert.equal(recoveredHealth.slaBreached, false);
    assert.equal(getPaidRevalidationHttpStatus(recoveredHealth), 200);
    for (const document of documents) {
      assert.notEqual(await getDownloadableDocument(fixture.company.id, document.id), null);
    }
    await prisma.payrollRun.update({
      where: { id: fixture.payrollRun.id },
      data: { providerEvidenceVersion: "obsolete-provider-contract" },
    });
    const outdatedContractHealth = await getPaidRevalidationOperationalHealth();
    assert.equal(outdatedContractHealth.evidenceVersionMismatchCount, 1);
    assert.equal(outdatedContractHealth.slaBreached, true);
    for (const document of documents) {
      assert.equal(await getDownloadableDocument(fixture.company.id, document.id), null);
    }
    await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 1,
      loadBatchPayments: async () => ({ items: [processedPayment], hasMore: false }),
    });
    await prisma.payrollRun.update({
      where: { id: fixture.payrollRun.id },
      data: {
        providerVerificationLastSucceededAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });
    const staleHealth = await getPaidRevalidationOperationalHealth();
    assert.equal(staleHealth.staleVerificationCount, 1);
    assert.equal(staleHealth.slaBreached, true);
    for (const document of documents) {
      assert.equal(await getDownloadableDocument(fixture.company.id, document.id), null);
    }
    await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 1,
      loadBatchPayments: async () => ({ items: [processedPayment], hasMore: false }),
    });
  });

  await t.test("partial provider success uses persisted freshness rather than completed sweeps", async () => {
    await prisma.payrollRun.updateMany({
      where: { status: "PAID" },
      data: { status: "REVIEW_REQUIRED", providerRef: null },
    });
    await prisma.payrollProviderVerificationAttempt.deleteMany();
    await prisma.payrollReconciliationCheckpoint.deleteMany({
      where: { jobName: TROLLEY_PAID_REVALIDATION_JOB },
    });
    const succeeds = await preparePayingTrolleyFixture("verification-partial-success");
    const timesOut = await preparePayingTrolleyFixture("verification-partial-timeout");
    await markPayingFixtureAsLegacyPaid(succeeds);
    await markPayingFixtureAsLegacyPaid(timesOut);
    const successfulPayment = trolleyProcessedPayment(succeeds, {
      batchId: succeeds.batchId,
      paymentId: succeeds.paymentId,
    });

    const result = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 2,
      loadBatchPayments: async (batchId, { timeoutMs }) => {
        if (batchId === timesOut.batchId) {
          throw new TrolleyRequestTimeoutError(timeoutMs ?? 0);
        }
        return { items: [successfulPayment], hasMore: false };
      },
    });
    assert.deepEqual({
      processed: result.processed,
      failed: result.failed,
      attemptedProviderRequests: result.attemptedProviderRequests,
      successfulProviderRequests: result.successfulProviderRequests,
      timedOutRequests: result.timedOutRequests,
      completedSweeps: result.completedSweeps,
    }, {
      processed: 1,
      failed: 1,
      attemptedProviderRequests: 2,
      successfulProviderRequests: 1,
      timedOutRequests: 1,
      completedSweeps: 1,
    });
    const health = await getPaidRevalidationOperationalHealth();
    assert.equal(health.eligiblePaidRunCount, 2);
    assert.equal(health.successfullyVerifiedWithinSlaCount, 1);
    assert.equal(health.neverSuccessfullyVerifiedCount, 1);
    assert.equal(health.attemptedCount, 2);
    assert.equal(health.succeededCount, 1);
    assert.equal(health.failedCount, 1);
    assert.equal(health.completedSweeps, 1);
    assert.equal(health.slaBreached, true);
  });

  await t.test("pagination request budget and sanitized 429 evidence are retried without false success", async () => {
    await prisma.payrollRun.updateMany({
      where: { status: "PAID" },
      data: { status: "REVIEW_REQUIRED", providerRef: null },
    });
    await prisma.payrollProviderVerificationAttempt.deleteMany();
    await prisma.payrollReconciliationCheckpoint.deleteMany({
      where: { jobName: TROLLEY_PAID_REVALIDATION_JOB },
    });
    const paginated = await preparePayingTrolleyFixture("verification-request-budget");
    await markPayingFixtureAsLegacyPaid(paginated);
    const payment = trolleyProcessedPayment(paginated, {
      batchId: paginated.batchId,
      paymentId: paginated.paymentId,
    });

    const exhausted = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 1,
      maxProviderRequestsPerInvocation: 1,
      loadBatchPayments: async () => ({ items: [payment], hasMore: true }),
    });
    assert.equal(exhausted.processed, 0);
    assert.equal(exhausted.failed, 1);
    assert.equal(exhausted.attemptedProviderRequests, 1);
    assert.equal(exhausted.successfulProviderRequests, 1);
    assert.equal(exhausted.pagesFetched, 1);
    const exhaustedRun = await prisma.payrollRun.findUniqueOrThrow({
      where: { id: paginated.payrollRun.id },
    });
    assert.equal(exhaustedRun.providerVerificationLastSucceededAt, null);
    assert.equal(
      exhaustedRun.providerVerificationFailureCode,
      "TROLLEY_PROVIDER_REQUEST_BUDGET_EXHAUSTED"
    );

    const retried = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 1,
      maxProviderRequestsPerInvocation: 1,
      loadBatchPayments: async () => ({ items: [payment], hasMore: false }),
    });
    assert.equal(retried.processed, 1);
    assert.equal(
      (await prisma.payrollRun.findUniqueOrThrow({ where: { id: paginated.payrollRun.id } }))
        .providerVerificationStatus,
      "VERIFIED"
    );

    await prisma.payrollRun.update({
      where: { id: paginated.payrollRun.id },
      data: { providerRef: null },
    });
    await prisma.payrollProviderVerificationAttempt.deleteMany();
    await prisma.payrollReconciliationCheckpoint.deleteMany({
      where: { jobName: TROLLEY_PAID_REVALIDATION_JOB },
    });
    const rateLimited = await preparePayingTrolleyFixture("verification-rate-limit");
    await markPayingFixtureAsLegacyPaid(rateLimited);
    const providerBodySentinel = "provider-rate-limit-body-secret";
    const limited = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 1,
      loadBatchPayments: async () => {
        throw new TrolleyApiError({
          status: 429,
          code: "provider-internal-code",
          message: providerBodySentinel,
          details: { body: providerBodySentinel },
        });
      },
    });
    assert.equal(limited.failed, 1);
    assert.equal(limited.rateLimitedRequests, 1);
    const limitedRun = await prisma.payrollRun.findUniqueOrThrow({
      where: { id: rateLimited.payrollRun.id },
    });
    assert.equal(limitedRun.providerVerificationFailureCode, "TROLLEY_PROVIDER_RATE_LIMITED");
    assert.equal(limitedRun.providerVerificationLastSucceededAt, null);
    const attempt = await prisma.payrollProviderVerificationAttempt.findFirstOrThrow({
      where: { payrollRunId: rateLimited.payrollRun.id },
      orderBy: { id: "desc" },
    });
    assert.equal(attempt.failureCode, "TROLLEY_PROVIDER_RATE_LIMITED");
    assert.equal(attempt.rateLimitedRequests, 1);
    const stored = JSON.stringify({
      attempt,
      audits: await prisma.auditLog.findMany({
        where: { companyId: rateLimited.company.id },
        select: { metadataJson: true },
      }),
    }, (_key, value) => typeof value === "bigint" ? value.toString() : value);
    assert.equal(stored.includes(providerBodySentinel), false);
    assert.equal(stored.includes(rateLimited.batchId), false);
    assert.equal(stored.includes(rateLimited.paymentId), false);
    assert.equal(stored.includes(rateLimited.ciphertext), false);
    assert.equal(stored.includes(TEST_ONLY_SIN), false);

    await prisma.payrollRun.update({
      where: { id: rateLimited.payrollRun.id },
      data: { providerRef: null },
    });
    await prisma.payrollProviderVerificationAttempt.deleteMany();
    await prisma.payrollReconciliationCheckpoint.deleteMany({
      where: { jobName: TROLLEY_PAID_REVALIDATION_JOB },
    });
    const boundedRetry = await preparePayingTrolleyFixture("verification-rate-limit-retry-after");
    await markPayingFixtureAsLegacyPaid(boundedRetry);
    const retryPayment = trolleyProcessedPayment(boundedRetry, {
      batchId: boundedRetry.batchId,
      paymentId: boundedRetry.paymentId,
    });
    let calls = 0;
    const retriedAfterRateLimit = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 1,
      maxProviderRequestsPerInvocation: 2,
      loadBatchPayments: async () => {
        calls += 1;
        if (calls === 1) {
          throw new TrolleyApiError({
            status: 429,
            message: "sanitized fixture rate limit",
            retryAfterMs: 0,
          });
        }
        return { items: [retryPayment], hasMore: false };
      },
    });
    assert.equal(retriedAfterRateLimit.processed, 1);
    assert.equal(retriedAfterRateLimit.attemptedProviderRequests, 2);
    assert.equal(retriedAfterRateLimit.successfulProviderRequests, 1);
    assert.equal(retriedAfterRateLimit.rateLimitedRequests, 1);
    assert.equal(
      (await prisma.payrollRun.findUniqueOrThrow({ where: { id: boundedRetry.payrollRun.id } }))
        .providerVerificationStatus,
      "VERIFIED"
    );
  });

  await t.test("persisted PAID cursor resumes wraps and does not block PAYING or due payroll", async () => {
    await prisma.payrollRun.updateMany({
      where: { status: "PAID" },
      data: { status: "REVIEW_REQUIRED", providerRef: null },
    });
    await prisma.payrollProviderVerificationAttempt.deleteMany();
    await prisma.payrollReconciliationCheckpoint.deleteMany({
      where: { jobName: TROLLEY_PAID_REVALIDATION_JOB },
    });

    const backlog: Array<Awaited<ReturnType<typeof preparePayingTrolleyFixture>>> = [];
    const paymentsByBatch = new Map<string, Payment>();
    for (let index = 0; index < 5; index += 1) {
      const fixture = await preparePayingTrolleyFixture(`cursor-backlog-${index}`);
      const payment = trolleyProcessedPayment(fixture, {
        batchId: fixture.batchId,
        paymentId: fixture.paymentId,
      });
      await reconcilePayrollRunFromTrolley(fixture.payrollRun.id, {
        loadBatchPayments: async () => ({ items: [payment], hasMore: false }),
      });
      backlog.push(fixture);
      paymentsByBatch.set(fixture.batchId, payment);
    }

    const calls: string[] = [];
    const loadWithOneRetryableFailure = async (batchId: string) => {
      calls.push(batchId);
      if (batchId === backlog[1].batchId && calls.filter((id) => id === batchId).length === 1) {
        throw new TrolleyRequestTimeoutError(5_000);
      }
      return { items: [paymentsByBatch.get(batchId)!], hasMore: false };
    };

    const first = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 2,
      timeBudgetMs: 10_000,
      loadBatchPayments: loadWithOneRetryableFailure,
    });
    assert.deepEqual(
      { processed: first.processed, failed: first.failed, wrapped: first.wrapped },
      { processed: 1, failed: 1, wrapped: false }
    );
    assert.equal(first.nextCursor, backlog[1].payrollRun.id.toString());
    const afterFirst = await prisma.payrollReconciliationCheckpoint.findUniqueOrThrow({
      where: { jobName: TROLLEY_PAID_REVALIDATION_JOB },
    });
    assert.equal(afterFirst.cursorPayrollRunId, backlog[1].payrollRun.id);
    assert.equal(
      (await prisma.payrollRun.findUniqueOrThrow({ where: { id: backlog[1].payrollRun.id } })).status,
      "PAID"
    );
    const retryAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        companyId: backlog[1].company.id,
        action: "TROLLEY_PAID_REVALIDATION_FAILED",
        targetId: backlog[1].payrollRun.id.toString(),
      },
    });
    assert.deepEqual(retryAudit.metadataJson, {
      reasonCode: "TROLLEY_PROVIDER_REQUEST_TIMEOUT",
      retryable: true,
    });
    assert.equal(afterFirst.leaseToken, null);
    assert.equal(afterFirst.leaseExpiresAt, null);

    const second = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 2,
      timeBudgetMs: 10_000,
      loadBatchPayments: loadWithOneRetryableFailure,
    });
    assert.equal(second.processed, 2);
    assert.equal(second.nextCursor, backlog[3].payrollRun.id.toString());

    const third = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 2,
      timeBudgetMs: 10_000,
      loadBatchPayments: loadWithOneRetryableFailure,
    });
    assert.equal(third.processed, 1);
    assert.equal(third.wrapped, true);
    assert.equal(third.nextCursor, null);
    assert.equal(calls.includes(backlog[4].batchId), true);

    const nextSweep = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 2,
      timeBudgetMs: 10_000,
      loadBatchPayments: loadWithOneRetryableFailure,
    });
    assert.equal(nextSweep.processed, 2);
    assert.equal(calls.filter((batchId) => batchId === backlog[0].batchId).length, 2);
    assert.equal(calls.filter((batchId) => batchId === backlog[1].batchId).length, 2);

    await prisma.payrollReconciliationCheckpoint.delete({
      where: { jobName: TROLLEY_PAID_REVALIDATION_JOB },
    });
    const clockValues = [0, 0, 0, 10];
    const timeLimited = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 5,
      timeBudgetMs: 10,
      clock: () => clockValues.shift() ?? 10,
      loadBatchPayments: async (batchId) => ({
        items: [paymentsByBatch.get(batchId)!],
        hasMore: false,
      }),
    });
    assert.equal(timeLimited.processed, 1);
    assert.equal(timeLimited.nextCursor, backlog[0].payrollRun.id.toString());
    const resumedAfterTimeBudget = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 1,
      timeBudgetMs: 10_000,
      loadBatchPayments: async (batchId) => ({
        items: [paymentsByBatch.get(batchId)!],
        hasMore: false,
      }),
    });
    assert.equal(resumedAfterTimeBudget.nextCursor, backlog[1].payrollRun.id.toString());

    await prisma.payrollReconciliationCheckpoint.delete({
      where: { jobName: TROLLEY_PAID_REVALIDATION_JOB },
    });
    let releaseLease!: () => void;
    let notifyLeaseAcquired!: () => void;
    const leaseAcquired = new Promise<void>((resolve) => { notifyLeaseAcquired = resolve; });
    const holdLease = new Promise<void>((resolve) => { releaseLease = resolve; });
    const concurrentCalls: string[] = [];
    const firstConcurrent = revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 1,
      timeBudgetMs: 10_000,
      loadBatchPayments: async (batchId) => {
        concurrentCalls.push(batchId);
        return { items: [paymentsByBatch.get(batchId)!], hasMore: false };
      },
      testHooks: {
        afterLeaseAcquired: async () => {
          notifyLeaseAcquired();
          await holdLease;
        },
      },
    });
    await leaseAcquired;
    const secondConcurrent = await revalidatePaidPayrollRunsFromTrolley({
      maxRuns: 1,
      timeBudgetMs: 10_000,
      loadBatchPayments: async () => {
        throw new Error("LOCKED_INVOCATION_MUST_NOT_CALL_PROVIDER");
      },
    });
    assert.equal(secondConcurrent.skippedLocked, true);
    releaseLease();
    const firstConcurrentResult = await firstConcurrent;
    assert.equal(firstConcurrentResult.processed, 1);
    assert.deepEqual(concurrentCalls, [backlog[0].batchId]);
    const concurrentCheckpoint = await prisma.payrollReconciliationCheckpoint.findUniqueOrThrow({
      where: { jobName: TROLLEY_PAID_REVALIDATION_JOB },
    });
    assert.equal(concurrentCheckpoint.cursorPayrollRunId, backlog[0].payrollRun.id);

    const health = await getPaidRevalidationOperationalHealth();
    assert.equal(health.eligiblePaidRunCount >= backlog.length, true);
    assert.equal(
      health.successfullyVerifiedWithinSlaCount,
      health.eligiblePaidRunCount
    );
    assert.equal(health.neverSuccessfullyVerifiedCount, 0);
    assert.equal(health.staleVerificationCount, 0);
    assert.equal(health.unresolvedFailureCount, 0);
    assert.equal(health.completedSweeps >= 0, true);
    assert.equal(health.lastCompletedAt !== null, true);
    assert.equal(health.failedCount >= 1, true);
    assert.equal(health.attemptedCount >= health.succeededCount, true);
    assert.equal(typeof health.checkpointAgeSeconds, "number");
    assert.equal(
      health.nominalCapacityEstimateMinutes,
      Math.max(15, Math.ceil(health.eligiblePaidRunCount / 25) * 15)
    );
    assert.equal(health.slaMinutes, 24 * 60);

    const paying = await preparePayingTrolleyFixture("paying-before-due");
    const payingPayment = trolleyProcessedPayment(paying, {
      batchId: paying.batchId,
      paymentId: paying.paymentId,
    });
    const order: string[] = [];
    const sendJob = await runPayrollSendDueJob({
      reconcilePaying: async () => {
        order.push("PAYING");
        return reconcilePayingPayrollRunsFromTrolley({
          loadBatchPayments: async (batchId) => {
            assert.equal(batchId, paying.batchId);
            return { items: [payingPayment], hasMore: false };
          },
        });
      },
      sendDue: async () => {
        order.push("DUE");
        return { count: 1, processed: [{ payrollRunId: "test-due-run" }] };
      },
    });
    assert.deepEqual(order, ["PAYING", "DUE"]);
    assert.deepEqual(sendJob, {
      paying: {
        processed: 1,
        reviewRequired: 0,
        failed: 0,
        maxProviderRequestsPerInvocation: 20,
        attemptedProviderRequests: 1,
        successfulProviderRequests: 1,
        timedOutRequests: 0,
        rateLimitedRequests: 0,
        pagesFetched: 1,
      },
      due: { processed: 1, succeeded: 1, failed: 0 },
    });
    const serializedCronResponses = JSON.stringify({ first, second, third, nextSweep, sendJob });
    for (const fixture of [...backlog, paying]) {
      assert.equal(serializedCronResponses.includes(fixture.batchId), false);
      assert.equal(serializedCronResponses.includes(fixture.paymentId), false);
      assert.equal(serializedCronResponses.includes(fixture.ciphertext), false);
    }
    assert.equal(serializedCronResponses.includes(TEST_ONLY_SIN), false);
  });

  await t.test("bounded PAYING timeout advances safely processes another run and does not block due dispatch", async () => {
    await prisma.payrollRun.updateMany({
      where: { status: "PAID" },
      data: { status: "REVIEW_REQUIRED", providerRef: null },
    });
    await prisma.payrollReconciliationCheckpoint.deleteMany({
      where: { jobName: TROLLEY_PAYING_RECONCILIATION_JOB },
    });
    const timedOut = await preparePayingTrolleyFixture("paying-timeout-retry");
    const succeeds = await preparePayingTrolleyFixture("paying-after-timeout");
    const successfulPayments = new Map<string, Payment>([
      [timedOut.batchId, trolleyProcessedPayment(timedOut, {
        batchId: timedOut.batchId,
        paymentId: timedOut.paymentId,
      })],
      [succeeds.batchId, trolleyProcessedPayment(succeeds, {
        batchId: succeeds.batchId,
        paymentId: succeeds.paymentId,
      })],
    ]);
    const order: string[] = [];
    const providerBodySentinel = "provider-secret-error-body";
    const startedAt = Date.now();
    const result = await runPayrollSendDueJob({
      reconcilePaying: async () => reconcilePayingPayrollRunsFromTrolley({
        maxRuns: 2,
        timeBudgetMs: 2_000,
        loadBatchPayments: async (batchId, { timeoutMs }) => {
          order.push(batchId);
          if (batchId === timedOut.batchId) {
            throw new TrolleyRequestTimeoutError(timeoutMs ?? 0);
          }
          return { items: [successfulPayments.get(batchId)!], hasMore: false };
        },
      }),
      sendDue: async () => {
        order.push("DUE_DISPATCH");
        return { count: 1, processed: [{ payrollRunId: "count-only" }] };
      },
    });
    assert.equal(Date.now() - startedAt < 2_000, true);
    assert.deepEqual(order, [timedOut.batchId, succeeds.batchId, "DUE_DISPATCH"]);
    assert.deepEqual(result, {
      paying: {
        processed: 1,
        reviewRequired: 0,
        failed: 1,
        maxProviderRequestsPerInvocation: 20,
        attemptedProviderRequests: 2,
        successfulProviderRequests: 1,
        timedOutRequests: 1,
        rateLimitedRequests: 0,
        pagesFetched: 1,
      },
      due: { processed: 1, succeeded: 1, failed: 0 },
    });
    assert.equal(
      (await prisma.payrollRun.findUniqueOrThrow({ where: { id: timedOut.payrollRun.id } })).status,
      "PAYING"
    );
    assert.equal(
      (await prisma.payrollRun.findUniqueOrThrow({ where: { id: succeeds.payrollRun.id } })).status,
      "PAID"
    );
    const checkpoint = await prisma.payrollReconciliationCheckpoint.findUniqueOrThrow({
      where: { jobName: TROLLEY_PAYING_RECONCILIATION_JOB },
    });
    assert.equal(checkpoint.cursorPayrollRunId, null);
    assert.equal(checkpoint.leaseToken, null);
    assert.equal(checkpoint.leaseExpiresAt, null);
    const timeoutAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        companyId: timedOut.company.id,
        action: "TROLLEY_PAYING_RECONCILIATION_FAILED",
        targetId: timedOut.payrollRun.id.toString(),
      },
      orderBy: { id: "desc" },
    });
    assert.deepEqual(timeoutAudit.metadataJson, {
      reasonCode: "TROLLEY_PROVIDER_REQUEST_TIMEOUT",
      retryable: true,
    });

    const retried = await reconcilePayingPayrollRunsFromTrolley({
      maxRuns: 1,
      timeBudgetMs: 2_000,
      loadBatchPayments: async (batchId) => ({
        items: [successfulPayments.get(batchId)!],
        hasMore: false,
      }),
    });
    assert.equal(retried.processed, 1);
    assert.equal(
      (await prisma.payrollRun.findUniqueOrThrow({ where: { id: timedOut.payrollRun.id } })).status,
      "PAID"
    );
    const serialized = JSON.stringify({ result, timeoutAudit: timeoutAudit.metadataJson });
    assert.equal(serialized.includes(providerBodySentinel), false);
    assert.equal(serialized.includes(timedOut.batchId), false);
    assert.equal(serialized.includes(timedOut.paymentId), false);
    assert.equal(serialized.includes(timedOut.ciphertext), false);
    assert.equal(serialized.includes(TEST_ONLY_SIN), false);
  });

  await t.test("remittance publication and returned reversal serialize across both commit orders", async () => {
    const publicationFirst = await createPayrollFixture("remittance-toctou-publication-first");
    const publicationFirstReturned = {
      ...trolleyProcessedPayment(publicationFirst, {
        batchId: `B-remittance-toctou-publication-first`,
        paymentId: `P-remittance-toctou-publication-first`,
      }),
      status: "returned",
      returnedAt: "2026-03-01T00:00:00.000Z",
      returnedReason: ["bank_account_closed"],
    };
    const publicationRevalidated = deferredSignal();
    const releasePublication = deferredSignal();
    const providerLoaded = deferredSignal();
    const publicationFirstReversalLocked = deferredSignal();
    const releasePublicationFirstReversal = deferredSignal();
    const publication = syncRemittancesForCompany(publicationFirst.company.id, {
      afterEligibilityRevalidated: async ({ payrollRunCount }) => {
        assert.equal(payrollRunCount, 1);
        publicationRevalidated.resolve();
        await releasePublication.promise;
      },
    });
    await publicationRevalidated.promise;
    const reversal = reconcilePayrollRunFromTrolley(publicationFirst.payrollRun.id, {
      loadBatchPayments: async () => {
        providerLoaded.resolve();
        return { items: [publicationFirstReturned], hasMore: false };
      },
      testHooks: {
        afterPayrollRunLocked: async () => {
          publicationFirstReversalLocked.resolve();
          await releasePublicationFirstReversal.promise;
        },
      },
    });
    await providerLoaded.promise;
    await assertPromiseIsPending(reversal);
    releasePublication.resolve();
    await publication;
    await publicationFirstReversalLocked.promise;
    const committedRemittance = await prisma.remittance.findFirstOrThrow({
      where: { companyId: publicationFirst.company.id },
    });
    await prisma.remittancePayment.create({
      data: {
        remittanceId: committedRemittance.id,
        paymentDate: new Date("2026-02-15"),
        amountPaid: 100,
        status: "RECORDED",
      },
    });
    releasePublicationFirstReversal.resolve();
    const reviewed = await reversal;
    assert.equal(reviewed.reviewRequired, true);

    const publishedThenReviewed = await prisma.remittance.findFirstOrThrow({
      where: { companyId: publicationFirst.company.id },
      include: { documents: true, allocations: true, payments: true },
    });
    assert.equal(publishedThenReviewed.status, "REVIEW_REQUIRED");
    assert.equal(publishedThenReviewed.totalPayable.toNumber() > 0, true);
    assert.equal(publishedThenReviewed.allocations.length, 0);
    assert.equal(publishedThenReviewed.payments.length, 1);
    assert.equal(
      ((publishedThenReviewed.reconciliationSummary as {
        priorPublishedSnapshot?: { totalPayable?: string };
      } | null)?.priorPublishedSnapshot?.totalPayable),
      publishedThenReviewed.totalPayable.toFixed(2)
    );
    assert.equal(publishedThenReviewed.documents.length, 1);
    assert.equal(
      publishedThenReviewed.documents.every((document) => document.validationStatus === "QUARANTINED"),
      true
    );
    assert.equal(await prisma.document.count({
      where: {
        companyId: publicationFirst.company.id,
        documentType: "REMITTANCE_REPORT",
        validationStatus: "ACTIVE",
      },
    }), 0);
    for (const document of publishedThenReviewed.documents) {
      assert.equal(Boolean(await fs.stat(path.resolve(process.cwd(), document.storagePath))), true);
    }
    assert.equal(await prisma.auditLog.count({
      where: { companyId: publicationFirst.company.id, action: "REMITTANCE_REPORT_PUBLISHED" },
    }), 1);
    assert.equal(await prisma.auditLog.count({
      where: {
        companyId: publicationFirst.company.id,
        action: "REMITTANCE_PROVIDER_PAYMENT_REVIEW_REQUIRED",
      },
    }), 1);

    const reversalFirst = await createPayrollFixture("remittance-toctou-reversal-first");
    const reversalFirstReturned = {
      ...trolleyProcessedPayment(reversalFirst, {
        batchId: `B-remittance-toctou-reversal-first`,
        paymentId: `P-remittance-toctou-reversal-first`,
      }),
      status: "returned",
      returnedAt: "2026-03-01T00:00:00.000Z",
      returnedReason: ["bank_account_closed"],
    };
    const reversalLocked = deferredSignal();
    const releaseReversal = deferredSignal();
    const reportWritten = deferredSignal();
    const firstReversal = reconcilePayrollRunFromTrolley(reversalFirst.payrollRun.id, {
      loadBatchPayments: async () => ({ items: [reversalFirstReturned], hasMore: false }),
      testHooks: {
        afterPayrollRunLocked: async () => {
          reversalLocked.resolve();
          await releaseReversal.promise;
        },
      },
    });
    await reversalLocked.promise;
    const losingPublication = syncRemittancesForCompany(reversalFirst.company.id, {
      afterReportWritten: async () => { reportWritten.resolve(); },
    });
    await reportWritten.promise;
    await assertPromiseIsPending(losingPublication);
    releaseReversal.resolve();
    const reversalResult = await firstReversal;
    assert.equal(reversalResult.reviewRequired, true);
    await assert.rejects(losingPublication, /PROVIDER_EVIDENCE_CHANGED_DURING_PUBLICATION/);
    assert.equal(await prisma.remittance.count({ where: { companyId: reversalFirst.company.id } }), 0);
    assert.equal(await prisma.document.count({ where: { companyId: reversalFirst.company.id } }), 0);
    assert.deepEqual(await listCompanyArtifactFiles(reversalFirst.company.id), []);
    assert.equal(await prisma.auditLog.count({
      where: { companyId: reversalFirst.company.id, action: "REMITTANCE_REPORT_PUBLISHED" },
    }), 0);
    const reversalAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        companyId: reversalFirst.company.id,
        action: "PAYROLL_PROVIDER_PAYMENT_REVIEW_REQUIRED",
      },
    });
    assert.equal(
      (reversalAudit.metadataJson as { affectedRemittanceCount?: number }).affectedRemittanceCount,
      0
    );
  });

  await t.test("eligibility gain committed first makes an A-only remittance publication roll back", async () => {
    const fixture = await createPayrollFixture("remittance-gain-verification-first");
    const added = await addPayrollSourceToFixture(
      fixture,
      "remittance-gain-verification-first-b",
      {
        verificationStatus: "UNVERIFIED",
        lastSucceededAt: null,
        evidenceVersion: null,
      }
    );
    const verificationLocked = deferredSignal();
    const releaseVerification = deferredSignal();
    const reportWritten = deferredSignal();
    const verification = reconcilePayrollRunFromTrolley(added.run.id, {
      loadBatchPayments: async () => ({
        items: [trolleyProcessedPayment(fixture, {
          payHistory: added.history,
          batchId: `B-remittance-gain-verification-first-b`,
          paymentId: `P-remittance-gain-verification-first-b`,
        })],
        hasMore: false,
      }),
      testHooks: {
        afterPayrollRunLocked: async () => {
          verificationLocked.resolve();
          await releaseVerification.promise;
        },
      },
    });
    await verificationLocked.promise;

    const publication = syncRemittancesForCompany(fixture.company.id, {
      afterReportWritten: async () => { reportWritten.resolve(); },
    });
    await reportWritten.promise;
    await assertPromiseIsPending(publication);
    releaseVerification.resolve();
    const verified = await verification;
    assert.equal(verified.reviewRequired, false);
    await assert.rejects(
      publication,
      /REMITTANCE_PROVIDER_EVIDENCE_CHANGED_DURING_PUBLICATION/
    );

    const refreshed = await prisma.payrollRun.findUniqueOrThrow({ where: { id: added.run.id } });
    assert.equal(refreshed.providerVerificationStatus, "VERIFIED");
    assert.equal(await prisma.remittance.count({ where: { companyId: fixture.company.id } }), 0);
    assert.equal(await prisma.document.count({ where: { companyId: fixture.company.id } }), 0);
    assert.deepEqual(await listCompanyArtifactFiles(fixture.company.id), []);
    assert.equal(await prisma.auditLog.count({
      where: { companyId: fixture.company.id, action: "REMITTANCE_REPORT_PUBLISHED" },
    }), 0);
  });

  await t.test("eligibility gain after an A-only remittance publication preserves and reviews the snapshot", async () => {
    const fixture = await createPayrollFixture("remittance-gain-publication-first");
    const added = await addPayrollSourceToFixture(
      fixture,
      "remittance-gain-publication-first-b",
      {
        verificationStatus: "UNVERIFIED",
        lastSucceededAt: null,
        evidenceVersion: null,
      }
    );
    const publicationRevalidated = deferredSignal();
    const releasePublication = deferredSignal();
    const providerLoaded = deferredSignal();
    const verificationLocked = deferredSignal();
    const releaseVerification = deferredSignal();
    const publication = syncRemittancesForCompany(fixture.company.id, {
      afterEligibilityRevalidated: async ({ payrollRunCount }) => {
        // Both the initially included and excluded source runs are locked.
        assert.equal(payrollRunCount, 2);
        publicationRevalidated.resolve();
        await releasePublication.promise;
      },
    });
    await publicationRevalidated.promise;
    const verification = reconcilePayrollRunFromTrolley(added.run.id, {
      loadBatchPayments: async () => {
        providerLoaded.resolve();
        return {
          items: [trolleyProcessedPayment(fixture, {
            payHistory: added.history,
            batchId: `B-remittance-gain-publication-first-b`,
            paymentId: `P-remittance-gain-publication-first-b`,
          })],
          hasMore: false,
        };
      },
      testHooks: {
        afterPayrollRunLocked: async () => {
          verificationLocked.resolve();
          await releaseVerification.promise;
        },
      },
    });
    await providerLoaded.promise;
    await assertPromiseIsPending(verification);
    releasePublication.resolve();
    await publication;
    await verificationLocked.promise;

    const published = await prisma.remittance.findFirstOrThrow({
      where: { companyId: fixture.company.id },
      include: { documents: true, allocations: true },
    });
    const publishedTotal = published.totalPayable.toFixed(2);
    const publishedPath = published.documents[0]?.storagePath;
    assert.ok(publishedPath);
    assert.deepEqual(
      published.allocations.map((allocation) => allocation.payHistoryId),
      [fixture.payHistory.id]
    );
    await prisma.remittancePayment.create({
      data: {
        remittanceId: published.id,
        paymentDate: new Date("2026-02-15T00:00:00.000Z"),
        amountPaid: 100,
        status: "RECORDED",
      },
    });
    releaseVerification.resolve();
    assert.equal((await verification).reviewRequired, false);

    const reviewed = await prisma.remittance.findUniqueOrThrow({
      where: { id: published.id },
      include: { documents: true, allocations: true, payments: true },
    });
    assert.equal(reviewed.status, "REVIEW_REQUIRED");
    assert.equal(reviewed.totalPayable.toFixed(2), publishedTotal);
    assert.equal(reviewed.allocations.length, 0);
    assert.equal(reviewed.payments.length, 1);
    assert.equal(reviewed.documents.length, 1);
    assert.equal(reviewed.documents[0]?.validationStatus, "QUARANTINED");
    assert.equal(reviewed.documents[0]?.validationReason,
      "PROVIDER_ELIGIBILITY_GAIN_INVALIDATED_ARTIFACT");
    assert.equal(await getDownloadableDocument(fixture.company.id, reviewed.documents[0]!.id), null);
    assert.equal(Boolean(await fs.stat(path.resolve(process.cwd(), publishedPath))), true);
    assert.equal(await prisma.document.count({
      where: {
        companyId: fixture.company.id,
        documentType: "REMITTANCE_REPORT",
        validationStatus: "ACTIVE",
      },
    }), 0);
    assert.equal(await prisma.auditLog.count({
      where: { companyId: fixture.company.id, action: "REMITTANCE_REPORT_PUBLISHED" },
    }), 1);
    assert.equal(await prisma.auditLog.count({
      where: {
        companyId: fixture.company.id,
        action: "REMITTANCE_PROVIDER_ELIGIBILITY_GAIN_REVIEW_REQUIRED",
      },
    }), 1);
  });

  await t.test("newly verified tax-year source quarantines the whole finalized T4 package", async () => {
    const fixture = await createPayrollFixture("t4-eligibility-gain");
    await generateT4Package(fixture.company.id, TAX_YEAR);
    const before = await prisma.document.findMany({ where: { companyId: fixture.company.id } });
    assert.equal(before.length, 3);
    await prisma.$transaction([
      prisma.t4Summary.updateMany({
        where: { companyId: fixture.company.id },
        data: { status: "FINALIZED", finalizedAt: new Date("2027-02-28T00:00:00.000Z") },
      }),
      prisma.t4Slip.updateMany({
        where: { companyId: fixture.company.id },
        data: { status: "FINALIZED", finalizedAt: new Date("2027-02-28T00:00:00.000Z") },
      }),
    ]);
    const added = await addPayrollSourceToFixture(fixture, "t4-eligibility-gain-b", {
      verificationStatus: "UNVERIFIED",
      lastSucceededAt: null,
      evidenceVersion: null,
    });
    const verified = await reconcilePayrollRunFromTrolley(added.run.id, {
      loadBatchPayments: async () => ({
        items: [trolleyProcessedPayment(fixture, {
          payHistory: added.history,
          batchId: "B-t4-eligibility-gain-b",
          paymentId: "P-t4-eligibility-gain-b",
        })],
        hasMore: false,
      }),
    });
    assert.equal(verified.reviewRequired, false);

    const [summary, slips, documents] = await Promise.all([
      prisma.t4Summary.findFirstOrThrow({ where: { companyId: fixture.company.id } }),
      prisma.t4Slip.findMany({ where: { companyId: fixture.company.id } }),
      prisma.document.findMany({ where: { companyId: fixture.company.id } }),
    ]);
    assert.equal(summary.status, "FINALIZED");
    assert.equal(slips.every((slip) => slip.status === "FINALIZED"), true);
    assert.equal(getT4SummaryDisplayStatus(summary.status, 0), "FINALIZED — REVIEW REQUIRED");
    assert.equal(documents.length, 3);
    assert.equal(documents.every((document) =>
      document.validationStatus === "QUARANTINED" &&
      document.validationReason === "PROVIDER_ELIGIBILITY_GAIN_INVALIDATED_ARTIFACT"
    ), true);
    for (const document of documents) {
      assert.equal(await getDownloadableDocument(fixture.company.id, document.id), null);
      assert.equal(Boolean(await fs.stat(path.resolve(process.cwd(), document.storagePath))), true);
    }
    assert.deepEqual(
      (await listCompanyArtifactFiles(fixture.company.id)).sort(),
      before.map((document) => path.basename(document.storagePath)).sort()
    );
    assert.equal(await prisma.auditLog.count({
      where: {
        companyId: fixture.company.id,
        action: "PAYROLL_PROVIDER_ELIGIBILITY_GAIN_INVALIDATED_ARTIFACTS",
      },
    }), 1);
  });

  await t.test("source membership phantom gained after initial remittance read cannot publish incomplete totals", async () => {
    const fixture = await createPayrollFixture("remittance-membership-phantom");
    const verificationLocked = deferredSignal();
    const releaseVerification = deferredSignal();
    const reportWritten = deferredSignal();
    let verification!: ReturnType<typeof reconcilePayrollRunFromTrolley>;
    const publication = syncRemittancesForCompany(fixture.company.id, {
      afterReportWritten: async () => {
        const added = await addPayrollSourceToFixture(fixture, "remittance-membership-phantom-b", {
          verificationStatus: "UNVERIFIED",
          lastSucceededAt: null,
          evidenceVersion: null,
        });
        verification = reconcilePayrollRunFromTrolley(added.run.id, {
          loadBatchPayments: async () => ({
            items: [trolleyProcessedPayment(fixture, {
              payHistory: added.history,
              batchId: "B-remittance-membership-phantom-b",
              paymentId: "P-remittance-membership-phantom-b",
            })],
            hasMore: false,
          }),
          testHooks: {
            afterPayrollRunLocked: async () => {
              verificationLocked.resolve();
              await releaseVerification.promise;
            },
          },
        });
        await verificationLocked.promise;
        reportWritten.resolve();
      },
    });
    await reportWritten.promise;
    await assertPromiseIsPending(publication);
    releaseVerification.resolve();
    assert.equal((await verification).reviewRequired, false);
    await assert.rejects(
      publication,
      /REMITTANCE_PROVIDER_EVIDENCE_CHANGED_DURING_PUBLICATION/
    );
    assert.equal(await prisma.remittance.count({ where: { companyId: fixture.company.id } }), 0);
    assert.equal(await prisma.document.count({ where: { companyId: fixture.company.id } }), 0);
    assert.deepEqual(await listCompanyArtifactFiles(fixture.company.id), []);
  });

  await t.test("T4 publication lock makes concurrent returned reversal quarantine the committed package", async () => {
    const fixture = await createPayrollFixture("t4-toctou-publication-first");
    const returned = {
      ...trolleyProcessedPayment(fixture, {
        batchId: "B-t4-toctou-publication-first",
        paymentId: "P-t4-toctou-publication-first",
      }),
      status: "returned",
      returnedAt: "2026-03-01T00:00:00.000Z",
      returnedReason: ["bank_account_closed"],
    };
    const eligibilityRevalidated = deferredSignal();
    const releasePublication = deferredSignal();
    const reversalLocked = deferredSignal();
    const releaseReversal = deferredSignal();
    const generation = generateT4Package(fixture.company.id, TAX_YEAR, {
      afterEligibilityRevalidated: async ({ payrollRunCount }) => {
        assert.equal(payrollRunCount, 1);
        eligibilityRevalidated.resolve();
        await releasePublication.promise;
      },
    });
    await eligibilityRevalidated.promise;
    const reversal = reconcilePayrollRunFromTrolley(fixture.payrollRun.id, {
      loadBatchPayments: async () => ({ items: [returned], hasMore: false }),
      testHooks: {
        afterPayrollRunLocked: async () => {
          reversalLocked.resolve();
          await releaseReversal.promise;
        },
      },
    });
    await assertPromiseIsPending(reversal);
    releasePublication.resolve();
    await generation;
    await reversalLocked.promise;
    await prisma.$transaction([
      prisma.t4Summary.updateMany({
        where: { companyId: fixture.company.id },
        data: { status: "FINALIZED", finalizedAt: new Date("2026-02-28T00:00:00.000Z") },
      }),
      prisma.t4Slip.updateMany({
        where: { companyId: fixture.company.id },
        data: { status: "FINALIZED", finalizedAt: new Date("2026-02-28T00:00:00.000Z") },
      }),
    ]);
    releaseReversal.resolve();
    assert.equal((await reversal).reviewRequired, true);

    const [summary, slips, documents] = await Promise.all([
      prisma.t4Summary.findFirstOrThrow({ where: { companyId: fixture.company.id } }),
      prisma.t4Slip.findMany({ where: { companyId: fixture.company.id } }),
      prisma.document.findMany({ where: { companyId: fixture.company.id } }),
    ]);
    assert.equal(summary.status, "FINALIZED");
    assert.equal(slips.every((slip) => slip.status === "FINALIZED"), true);
    assert.equal(documents.length, 3);
    assert.equal(documents.every((document) => document.validationStatus === "QUARANTINED"), true);
    assert.equal(await prisma.document.count({
      where: { companyId: fixture.company.id, validationStatus: "ACTIVE" },
    }), 0);
    for (const document of documents) {
      assert.equal(await getDownloadableDocument(fixture.company.id, document.id), null);
      assert.equal(Boolean(await fs.stat(path.resolve(process.cwd(), document.storagePath))), true);
    }
    assert.deepEqual(
      (await listCompanyArtifactFiles(fixture.company.id)).sort(),
      documents.map((document) => path.basename(document.storagePath)).sort()
    );
    assert.equal(await prisma.auditLog.count({
      where: { companyId: fixture.company.id, action: "T4_PACKAGE_GENERATED" },
    }), 1);
    assert.equal(await prisma.auditLog.count({
      where: { companyId: fixture.company.id, action: "T4_PROVIDER_PAYMENT_REVIEW_REQUIRED" },
    }), 1);
  });

  await t.test("compliance publication lock timeout is bounded sanitized and leaves no remittance artifact", async () => {
    const fixture = await createPayrollFixture("remittance-publication-lock-timeout");
    const lockAcquired = deferredSignal();
    const releaseLock = deferredSignal();
    let unpublishedDocumentPath = "";
    const holder = prisma.$transaction(async (tx) => {
      await lockCompanyComplianceScope(tx, fixture.company.id, [fixture.payrollRun.id]);
      lockAcquired.resolve();
      await releaseLock.promise;
    }, { timeout: 10_000 });
    await lockAcquired.promise;
    try {
      await assert.rejects(
        syncRemittancesForCompany(fixture.company.id, {
          publicationLockTimeoutMs: 50,
          afterReportWritten: async ({ storagePath }) => {
            unpublishedDocumentPath = storagePath;
          },
        }),
        (error: unknown) => {
          assert.equal(error instanceof CompliancePublicationLockTimeoutError, true);
          const serialized = String(error);
          assert.equal(serialized.includes(fixture.payrollRun.providerRef ?? "missing"), false);
          assert.equal(serialized.includes(fixture.payHistory.paymentRef ?? "missing"), false);
          assert.equal(serialized.includes(TEST_ONLY_SIN), false);
          assert.equal(serialized.includes(fixture.ciphertext), false);
          assert.equal(serialized.includes(unpublishedDocumentPath), false);
          return true;
        }
      );
    } finally {
      releaseLock.resolve();
      await holder;
    }
    assert.equal(await prisma.remittance.count({ where: { companyId: fixture.company.id } }), 0);
    assert.equal(await prisma.document.count({ where: { companyId: fixture.company.id } }), 0);
    assert.deepEqual(await listCompanyArtifactFiles(fixture.company.id), []);
    assert.equal(await prisma.auditLog.count({
      where: { companyId: fixture.company.id, action: "REMITTANCE_REPORT_PUBLISHED" },
    }), 0);
    const serializedAudits = JSON.stringify((await prisma.auditLog.findMany({
      where: { companyId: fixture.company.id },
      select: { action: true, metadataJson: true },
    })).map((audit) => ({ action: audit.action, metadata: audit.metadataJson })));
    assert.equal(serializedAudits.includes(fixture.payrollRun.providerRef ?? "missing"), false);
    assert.equal(serializedAudits.includes(fixture.payHistory.paymentRef ?? "missing"), false);
    assert.equal(serializedAudits.includes(TEST_ONLY_SIN), false);
    assert.equal(serializedAudits.includes(fixture.ciphertext), false);
    assert.equal(serializedAudits.includes(unpublishedDocumentPath), false);
  });

  await t.test("provider evidence changes inside publication transactions roll back remittance and T4 artifacts", async () => {
    const fixture = await createPayrollFixture("provider-evidence-publication-race");
    const filesBefore = await listCompanyArtifactFiles(fixture.company.id);

    await assert.rejects(
      syncRemittancesForCompany(fixture.company.id, {
        afterReportWritten: async () => {
          await prisma.payrollRun.update({
            where: { id: fixture.payrollRun.id },
            data: { providerEvidenceVersion: "obsolete-provider-contract" },
          });
        },
      }),
      /REMITTANCE_PROVIDER_EVIDENCE_CHANGED_DURING_PUBLICATION/
    );
    assert.equal(await prisma.remittance.count({ where: { companyId: fixture.company.id } }), 0);
    assert.equal(await prisma.document.count({ where: { companyId: fixture.company.id } }), 0);
    assert.deepEqual(await listCompanyArtifactFiles(fixture.company.id), filesBefore);

    await prisma.payrollRun.update({
      where: { id: fixture.payrollRun.id },
      data: {
        providerVerificationStatus: "VERIFIED",
        providerVerificationLastSucceededAt: new Date(),
        providerEvidenceVersion: CURRENT_PROVIDER_EVIDENCE_VERSION,
      },
    });
    await assert.rejects(generateT4Package(fixture.company.id, TAX_YEAR, {
      afterArtifactsWritten: async () => {
        await prisma.payrollRun.update({
          where: { id: fixture.payrollRun.id },
          data: { providerEvidenceVersion: "obsolete-provider-contract" },
        });
      },
    }));
    assert.equal(await prisma.t4Summary.count({ where: { companyId: fixture.company.id } }), 0);
    assert.equal(await prisma.t4Slip.count({ where: { companyId: fixture.company.id } }), 0);
    assert.equal(await prisma.document.count({ where: { companyId: fixture.company.id } }), 0);
    assert.deepEqual(await listCompanyArtifactFiles(fixture.company.id), filesBefore);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { companyId: fixture.company.id, action: "T4_PACKAGE_GENERATION_FAILED" },
      orderBy: { id: "desc" },
    });
    const metadata = audit.metadataJson as {
      reasonCode?: string;
      includedCount?: number;
      excludedCount?: number;
      reasonCounts?: Record<string, number>;
    };
    assert.equal(metadata.reasonCode, "T4_SOURCE_ELIGIBILITY_CHANGED_DURING_PUBLICATION");
    assert.equal(metadata.includedCount, 0);
    assert.equal(metadata.excludedCount, 1);
    assert.equal(metadata.reasonCounts?.PROVIDER_EVIDENCE_VERSION_MISMATCH, 1);
  });

  await t.test("remittance PDF and publication transaction failures preserve prior publication", async () => {
    const failure = await createPayrollFixture("remittance-publication-failure");
    await syncRemittancesForCompany(failure.company.id);
    const before = await prisma.remittance.findFirstOrThrow({
      where: { companyId: failure.company.id },
      include: { allocations: true, documents: true },
    });
    const beforeFiles = await listCompanyArtifactFiles(failure.company.id);
    const beforeAuditCount = await prisma.auditLog.count({
      where: { companyId: failure.company.id },
    });
    await prisma.payHistory.update({
      where: { id: failure.payHistory.id },
      data: { ded_income_tax: 275 },
    });

    await assert.rejects(syncRemittancesForCompany(failure.company.id, {
      afterPdfRendered: async () => {
        throw new Error("INTEGRATION_PDF_STAGE_FAILURE");
      },
    }));
    await assert.rejects(syncRemittancesForCompany(failure.company.id, {
      beforePublicationCommit: async () => {
        throw new Error("INTEGRATION_REMITTANCE_TRANSACTION_FAILURE");
      },
    }));

    const after = await prisma.remittance.findUniqueOrThrow({
      where: { id: before.id },
      include: { allocations: true, documents: true },
    });
    assert.equal(after.totalPayable.toFixed(2), before.totalPayable.toFixed(2));
    assert.equal(after.sourceFingerprint, before.sourceFingerprint);
    assert.deepEqual(
      after.allocations.map((item) => item.payHistoryId),
      before.allocations.map((item) => item.payHistoryId)
    );
    assert.deepEqual(
      after.documents.map(({ id, validationStatus, generationId }) => ({ id, validationStatus, generationId })),
      before.documents.map(({ id, validationStatus, generationId }) => ({ id, validationStatus, generationId }))
    );
    assert.equal(await prisma.auditLog.count({ where: { companyId: failure.company.id } }), beforeAuditCount);
    assert.deepEqual(await listCompanyArtifactFiles(failure.company.id), beforeFiles);
  });

  await t.test("consecutive dashboard reads do not create remittance files documents or audits", async () => {
    const idempotent = await createPayrollFixture("dashboard-read-idempotency");
    await syncRemittancesForCompany(idempotent.company.id);
    const before = {
      documents: await prisma.document.count({ where: { companyId: idempotent.company.id } }),
      audits: await prisma.auditLog.count({ where: { companyId: idempotent.company.id } }),
      files: await listCompanyArtifactFiles(idempotent.company.id),
    };
    await syncRemittancesForCompany(idempotent.company.id);
    await getCraDashboard(idempotent.company.id);
    await getCraDashboard(idempotent.company.id);
    assert.equal(await prisma.document.count({ where: { companyId: idempotent.company.id } }), before.documents);
    assert.equal(await prisma.auditLog.count({ where: { companyId: idempotent.company.id } }), before.audits);
    assert.deepEqual(await listCompanyArtifactFiles(idempotent.company.id), before.files);
  });

  await t.test("concurrent remittance sync publishes exactly one ACTIVE report", async () => {
    const concurrent = await createPayrollFixture("remittance-concurrent");
    await syncRemittancesForCompany(concurrent.company.id);
    await prisma.payHistory.update({
      where: { id: concurrent.payHistory.id },
      data: { ded_cpp: 111 },
    });

    let written = 0;
    let release!: () => void;
    const bothWritten = new Promise<void>((resolve) => { release = resolve; });
    const afterReportWritten = async () => {
      written += 1;
      if (written === 2) release();
      await bothWritten;
    };
    await Promise.all([
      syncRemittancesForCompany(concurrent.company.id, { afterReportWritten }),
      syncRemittancesForCompany(concurrent.company.id, { afterReportWritten }),
    ]);

    const remittance = await prisma.remittance.findFirstOrThrow({
      where: { companyId: concurrent.company.id },
    });
    assert.equal(await prisma.document.count({
      where: {
        remittanceId: remittance.id,
        documentType: "REMITTANCE_REPORT",
        validationStatus: "ACTIVE",
      },
    }), 1);
    assert.equal(await prisma.auditLog.count({
      where: {
        companyId: concurrent.company.id,
        action: "REMITTANCE_REPORT_PUBLISHED",
      },
    }), 2);
    const documents = await prisma.document.findMany({
      where: { companyId: concurrent.company.id, documentType: "REMITTANCE_REPORT" },
    });
    assert.deepEqual(
      (await listCompanyArtifactFiles(concurrent.company.id)).sort(),
      documents.map((document) => path.basename(document.storagePath)).sort()
    );
  });

  const fixture = await createPayrollFixture("t4-lifecycle");

  await t.test("Puppeteer PDF contains validated plaintext SIN and no ciphertext", async () => {
    await generateT4Package(fixture.company.id, TAX_YEAR);
    const document = await prisma.document.findFirstOrThrow({
      where: {
        companyId: fixture.company.id,
        documentType: "T4_SLIP",
        validationStatus: "ACTIVE",
      },
    });
    const filePath = path.resolve(process.cwd(), document.storagePath);
    const pdfText = (await extractPdfText(filePath)).replace(/\s/g, "");
    assert.equal(pdfText.includes(TEST_ONLY_SIN), true);
    assert.equal(pdfText.includes(fixture.ciphertext), false);
    assert.equal(document.generationVersion, "t4-secure-v2");
    const summary = await prisma.t4Summary.findFirstOrThrow({
      where: { companyId: fixture.company.id, taxYear: TAX_YEAR },
    });
    assert.equal(summary.generationId, document.generationId);
    assert.equal(summary.generationVersion, "t4-secure-v2");
    assert.equal((await fs.stat(artifactDirectory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
  });

  await t.test("transaction failure rolls back DB/documents and removes unpublished files", async () => {
    const beforeSummary = await prisma.t4Summary.findFirstOrThrow({
      where: { companyId: fixture.company.id, taxYear: TAX_YEAR },
    });
    const beforeDocuments = await prisma.document.findMany({
      where: { companyId: fixture.company.id },
      orderBy: { id: "asc" },
    });
    const beforeSlips = await prisma.t4Slip.findMany({
      where: { companyId: fixture.company.id, taxYear: TAX_YEAR },
      orderBy: { id: "asc" },
    });
    const beforeFiles = (await fs.readdir(artifactDirectory)).sort();

    await assert.rejects(
      generateT4Package(fixture.company.id, TAX_YEAR, {
        beforeTransactionCommit: async () => {
          throw new Error("INTEGRATION_TRANSACTION_FAILURE");
        },
      })
    );

    const afterSummary = await prisma.t4Summary.findUniqueOrThrow({
      where: { id: beforeSummary.id },
    });
    const afterDocuments = await prisma.document.findMany({
      where: { companyId: fixture.company.id },
      orderBy: { id: "asc" },
    });
    const afterSlips = await prisma.t4Slip.findMany({
      where: { companyId: fixture.company.id, taxYear: TAX_YEAR },
      orderBy: { id: "asc" },
    });
    assert.equal(afterSummary.generationId, beforeSummary.generationId);
    assert.equal(afterSummary.status, beforeSummary.status);
    assert.deepEqual(
      afterDocuments.map(({ id, validationStatus, validationReason, generationId }) => ({ id, validationStatus, validationReason, generationId })),
      beforeDocuments.map(({ id, validationStatus, validationReason, generationId }) => ({ id, validationStatus, validationReason, generationId }))
    );
    assert.deepEqual(
      afterSlips.map(({ id, status, generationId }) => ({ id, status, generationId })),
      beforeSlips.map(({ id, status, generationId }) => ({ id, status, generationId }))
    );
    assert.deepEqual((await fs.readdir(artifactDirectory)).sort(), beforeFiles);
  });

  await t.test("failed revalidation quarantines prior GENERATED artifacts without deleting files", async () => {
    const activeBefore = await prisma.document.findMany({
      where: { companyId: fixture.company.id, validationStatus: "ACTIVE" },
    });
    const existingPaths = activeBefore.map((document) => path.resolve(process.cwd(), document.storagePath));
    await prisma.employee.update({
      where: { id: fixture.employee.id },
      data: { sin: TEST_ONLY_SIN },
    });
    await assert.rejects(generateT4Package(fixture.company.id, TAX_YEAR));

    const summary = await prisma.t4Summary.findFirstOrThrow({
      where: { companyId: fixture.company.id, taxYear: TAX_YEAR },
    });
    const documents = await prisma.document.findMany({ where: { companyId: fixture.company.id } });
    assert.equal(summary.status, "QUARANTINED");
    assert.equal(documents.some((document) => document.validationStatus === "ACTIVE"), false);
    assert.equal(await getDownloadableDocument(fixture.company.id, activeBefore[0].id), null);
    for (const filePath of existingPaths) {
      assert.equal(Boolean(await fs.stat(filePath)), true);
    }
  });

  await t.test("concurrent FINALIZED change cannot be reverted and creates no orphan", async () => {
    await prisma.employee.update({
      where: { id: fixture.employee.id },
      data: { sin: fixture.ciphertext },
    });
    await generateT4Package(fixture.company.id, TAX_YEAR);
    const beforeSummary = await prisma.t4Summary.findFirstOrThrow({
      where: { companyId: fixture.company.id, taxYear: TAX_YEAR },
    });
    const beforeFiles = (await fs.readdir(artifactDirectory)).sort();

    await assert.rejects(
      generateT4Package(fixture.company.id, TAX_YEAR, {
        afterArtifactsWritten: async () => {
          await prisma.$transaction([
            prisma.t4Summary.update({
              where: { id: beforeSummary.id },
              data: { status: "FINALIZED", finalizedAt: new Date() },
            }),
            prisma.t4Slip.updateMany({
              where: { summaryId: beforeSummary.id },
              data: { status: "FINALIZED", finalizedAt: new Date() },
            }),
          ]);
        },
      })
    );

    const finalized = await prisma.t4Summary.findUniqueOrThrow({ where: { id: beforeSummary.id } });
    const finalizedDocuments = await prisma.document.findMany({
      where: { t4SummaryId: beforeSummary.id, validationStatus: "ACTIVE" },
    });
    assert.equal(finalized.status, "FINALIZED");
    assert.equal(finalized.generationId, beforeSummary.generationId);
    assert.equal(finalizedDocuments.length, 2);
    assert.deepEqual((await fs.readdir(artifactDirectory)).sort(), beforeFiles);
  });

  await t.test("generateT4Package child-process crash after artifact write is reconciled", async () => {
    const crashFixture = await createPayrollFixture("t4-real-process-crash");
    const beforeFiles = (await fs.readdir(artifactDirectory)).sort();
    const crashed = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/t4-crash-after-artifacts.ts",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          T4_CRASH_COMPANY_ID: crashFixture.company.id.toString(),
          T4_CRASH_TAX_YEAR: TAX_YEAR.toString(),
        },
        encoding: "utf8",
      }
    );
    assert.equal(crashed.status, 17, `${crashed.stdout}\n${crashed.stderr}`);
    assert.equal(await prisma.document.count({ where: { companyId: crashFixture.company.id } }), 0);
    assert.equal(await prisma.t4Summary.count({ where: { companyId: crashFixture.company.id } }), 0);
    const afterCrashFiles = (await fs.readdir(artifactDirectory)).sort();
    const orphanFiles = afterCrashFiles.filter((fileName) => !beforeFiles.includes(fileName));
    assert.equal(orphanFiles.length, 3);
    const old = new Date(Date.now() - 10_000);
    await Promise.all(orphanFiles.map((fileName) =>
      fs.utimes(path.join(artifactDirectory, fileName), old, old)
    ));

    const dryRun = await reconcileCraArtifactStorage({ minimumAgeMs: 1 });
    assert.equal(dryRun.detectedCount, orphanFiles.length);
    assert.equal(dryRun.removedCount, 0);
    const applied = await reconcileCraArtifactStorage({ apply: true, minimumAgeMs: 1 });
    assert.equal(applied.removedCount, orphanFiles.length);
    assert.deepEqual((await fs.readdir(artifactDirectory)).sort(), beforeFiles);
    const referencedDocument = await prisma.document.findFirstOrThrow({
      where: { companyId: fixture.company.id },
    });
    assert.equal(Boolean(await fs.stat(path.resolve(process.cwd(), referencedDocument.storagePath))), true);
  });

  await t.test("backfill concurrent update is counted as quarantine", async () => {
    const employee = await prisma.employee.create({
      data: {
        companyId: fixture.company.id,
        firstName: "Concurrent",
        lastName: "Backfill",
        email: "concurrent-backfill@integration.invalid",
        sin: TEST_ONLY_SIN,
        addrLine1: "1 Test Way",
        addrCity: "Ottawa",
        addrPostal: "K1A0B1",
        birthDate: new Date("1990-01-01T00:00:00.000Z"),
        employmentType: "FULL_TIME",
        hireDate: new Date("2025-01-01T00:00:00.000Z"),
        payType: "SALARY",
        salary: 52000,
      },
    });
    let concurrentMutationApplied = false;
    const counts = await runSinBackfill({
      apply: true,
      repository: {
        readBatch: async ({ afterId, take }) => prisma.employee.findMany({
          where: { id: employee.id, ...(afterId ? { id: { gt: afterId, equals: employee.id } } : {}) },
          take,
          select: { id: true, sin: true },
        }),
        updateIfUnchanged: async ({ id, previous, encrypted }) => {
          if (!concurrentMutationApplied) {
            concurrentMutationApplied = true;
            await prisma.employee.update({ where: { id }, data: { sin: "concurrent-change" } });
          }
          const updated = await prisma.employee.updateMany({
            where: { id, sin: previous },
            data: { sin: encrypted },
          });
          return updated.count === 1;
        },
      },
    });
    assert.equal(counts.concurrentlyChanged, 1);
    assert.equal(counts.quarantined, 1);
    const stored = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    assert.equal(stored.sin, "concurrent-change");
  });
});

test.after(async () => {
  try {
    await resetDedicatedDatabase();
  } finally {
    await prisma.$disconnect();
  }
});
