import { promises as fs } from "fs";
import path from "path";
import { createHash, randomUUID } from "node:crypto";
import puppeteer from "puppeteer";
import type { Browser } from "puppeteer";
import {
  Prisma,
  RemittanceStatus,
  RemitterType,
  ReminderState,
  T4GenerationStatus,
} from "@prisma/client";
import {
  buildT4SubmissionXml,
  renderEmployeeT4SlipHtml,
  renderEmployerT4SummaryHtml,
  type T4SlipData,
  type T4SummaryData,
} from "./t4-filing.ts";
import { prisma } from "./prisma.ts";
import {
  compliancePayrollWhere,
  createComplianceSourceMembershipFingerprint,
  partitionCompliancePayrollRows,
} from "./payroll/compliance-eligibility.ts";
import { getProviderVerificationCutoff } from "./payroll/provider-evidence-policy.ts";
import {
  CompliancePublicationLockTimeoutError,
  lockCompanyComplianceScope,
} from "./payroll/compliance-publication-lock.ts";
import { resolveSinForT4, type T4SinFailureReason } from "./sin.ts";
import {
  addUtcDateOnlyDays,
  compareUtcDateOnly,
  createUtcDateOnly,
  getDateOnlyParts,
  getTodayUtcDateOnly,
  getUtcDateOnlyYearRange,
  normalizeUtcDateOnly,
  serializeUtcDateOnly,
} from "./date-only.ts";
import {
  getCompanyProviderVerificationFreshness,
  getProviderVerificationBlockedScope,
} from "./payments/provider-verification.ts";

const T4_GENERATION_VERSION = "t4-secure-v2";
const REMITTANCE_GENERATION_VERSION = "remittance-eligible-v3";
const REMITTANCE_SOURCE_VERSION = "remittance-source-v1";

const GENERATED_DIR = path.resolve(
  process.env.CRA_GENERATED_DIR ?? path.join(process.cwd(), "generated", "cra")
);

const ZERO = new Prisma.Decimal(0);

const COMPLIANCE_PAYROLL_RUN_SELECT = {
  status: true,
  companyId: true,
  providerRef: true,
  providerVerificationStatus: true,
  providerVerificationLastSucceededAt: true,
  providerEvidenceVersion: true,
} satisfies Prisma.PayrollRunSelect;

function sameBigIntIds(left: bigint[], right: bigint[]) {
  if (left.length !== right.length) return false;
  const orderedLeft = [...left].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const orderedRight = [...right].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return orderedLeft.every((value, index) => value === orderedRight[index]);
}

function createT4ComplianceSourceFingerprint(rows: Array<{
  id: bigint;
  payrollRunId: bigint | null;
  employeeId: bigint;
  payDate: Date;
  updatedAt: Date;
  grossPay: Prisma.Decimal;
  ded_cpp: Prisma.Decimal;
  ded_ei: Prisma.Decimal;
  ded_income_tax: Prisma.Decimal;
}>) {
  return createHash("sha256").update(JSON.stringify(
    [...rows]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((row) => ({
        payHistoryId: row.id.toString(),
        payrollRunId: row.payrollRunId?.toString() ?? null,
        employeeId: row.employeeId.toString(),
        payDate: row.payDate.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        grossPay: row.grossPay.toFixed(2),
        cpp: row.ded_cpp.toFixed(2),
        ei: row.ded_ei.toFixed(2),
        incomeTax: row.ded_income_tax.toFixed(2),
      }))
  )).digest("hex");
}

export function getCraGeneratedDirectory() {
  return GENERATED_DIR;
}

function decimal(value: Prisma.Decimal | number | string | null | undefined) {
  if (value == null) return ZERO;
  return new Prisma.Decimal(value);
}

function roundMoney(value: Prisma.Decimal | number | string) {
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

function addMoney(...values: Array<Prisma.Decimal | number | string | null | undefined>) {
  return values.reduce<Prisma.Decimal>((sum, value) => sum.add(decimal(value)), ZERO);
}

function sumRecordedPayments(
  payments: Array<{ amountPaid: Prisma.Decimal; status?: string }>
) {
  return payments.reduce((sum, payment) => {
    if (payment.status && payment.status !== "RECORDED") {
      return sum;
    }

    return sum.add(payment.amountPaid);
  }, ZERO);
}

function fmtDate(value: Date) {
  return serializeUtcDateOnly(value);
}

function periodIdentity(periodStart: Date, periodEnd: Date) {
  return `${periodStart.toISOString()}::${periodEnd.toISOString()}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getMissingT4SettingsFromSettings(settings: {
  legalName: string | null;
  payrollProgramAccount: string | null;
  addressLine1: string | null;
  city: string | null;
  provinceCode: string | null;
  postalCode: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  transmitterAccountNumber: string | null;
  transmitterRepId: string | null;
}) {
  const contactPhone = splitPhoneNumber(settings.contactPhone);

  return [
    !settings.legalName && "legalName",
    !settings.payrollProgramAccount && "payrollProgramAccount",
    !settings.addressLine1 && "addressLine1",
    !settings.city && "city",
    !settings.provinceCode && "provinceCode",
    !settings.postalCode && "postalCode",
    !settings.contactName && "contactName",
    !settings.contactPhone && "contactPhone",
    !settings.contactEmail && "contactEmail",
    !contactPhone && "contactPhone format",
    !(settings.transmitterAccountNumber || settings.transmitterRepId) &&
      "transmitterAccountNumber or transmitterRepId",
  ].filter(Boolean);
}

function selectDashboardDocuments(
  documents: Array<{
    id: bigint;
    documentType: string;
    fileName: string;
    mimeType: string;
    taxYear: number | null;
    uploadedAt: Date;
    linkedEntityType: string;
    linkedEntityId: bigint;
  }>
) {
  const dashboardDocumentTypes = new Set(["REMITTANCE_REPORT", "T4_SUMMARY"]);
  const seen = new Set<string>();

  return documents.filter((document) => {
    if (!dashboardDocumentTypes.has(document.documentType)) {
      return false;
    }

    const key = [
      document.documentType,
      document.linkedEntityType,
      document.linkedEntityId.toString(),
    ].join(":");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function selectDashboardAuditLogs(
  auditLogs: Array<{
    id: bigint;
    action: string;
    createdAt: Date;
    targetType: string;
    targetId: string;
    metadataJson: Prisma.JsonValue;
  }>
) {
  const dashboardActions = new Set([
    "REMITTANCE_MARKED_PAID",
    "REMITTANCE_SOURCE_EVALUATED",
    "REMITTANCE_QUARANTINED",
    "T4_PACKAGE_GENERATED",
    "T4_PACKAGE_GENERATION_FAILED",
    "T4_FINALIZED_REVALIDATION_REVIEW_REQUIRED",
  ]);
  const seen = new Set<string>();

  return auditLogs.filter((entry) => {
    if (!dashboardActions.has(entry.action)) {
      return false;
    }

    const key = [entry.action, entry.targetType, entry.targetId].join(":");
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getMonthRange(year: number, month: number) {
  const start = createUtcDateOnly(year, month, 1);
  const end = createUtcDateOnly(year, month + 1, 0);
  return { start, end };
}

function getQuarterRange(year: number, quarterIndex: number) {
  const startMonth = quarterIndex * 3;
  const start = createUtcDateOnly(year, startMonth, 1);
  const end = createUtcDateOnly(year, startMonth + 3, 0);
  return { start, end };
}

function getQuarterLabel(date: Date) {
  const { year, monthIndex } = getDateOnlyParts(date);
  return `Q${Math.floor(monthIndex / 3) + 1} ${year}`;
}

function normalizeOptionalText(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeUpperText(value?: string | null, fallback?: string) {
  const normalized = value?.trim().toUpperCase();
  return normalized || fallback || null;
}

function formatMoneyString(value: Prisma.Decimal | number | string) {
  return roundMoney(value).toFixed(2);
}

function mapDentalBenefitsCoverageToCode(value: string) {
  switch (value) {
    case "EMPLOYEE_ONLY":
      return "2" as const;
    case "EMPLOYEE_AND_FAMILY":
      return "3" as const;
    case "EMPLOYEE_AND_SPOUSE":
      return "4" as const;
    case "EMPLOYEE_AND_CHILDREN":
      return "5" as const;
    default:
      return "1" as const;
  }
}

function normalizeCountryCode(value?: string | null) {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return "CAN";
  if (normalized === "CA") return "CAN";
  if (normalized === "US") return "USA";
  return normalized;
}

function normalizeProvinceCode(value?: string | null, countryCode = "CAN") {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) {
    return countryCode === "CAN" || countryCode === "USA" ? "" : "ZZ";
  }
  return normalized;
}

function normalizePostalCode(value?: string | null) {
  return value?.trim().toUpperCase().replace(/\s+/g, "") || "";
}

function splitPhoneNumber(value?: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;

  return {
    areaCode: digits.slice(0, 3),
    phoneNumber: `${digits.slice(3, 6)}-${digits.slice(6, 10)}`,
  };
}

function generateSubmissionReferenceId(companyId: bigint, taxYear: number) {
  const base = `${companyId.toString().slice(-4)}${String(taxYear).slice(-2)}${Date.now().toString().slice(-2)}`;
  return base.slice(0, 8);
}

async function writeGeneratedFile(params: {
  companyId: bigint;
  fileName: string;
  contents: string | Buffer;
}) {
  await fs.mkdir(GENERATED_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(GENERATED_DIR, 0o700);
  const absolutePath = path.join(GENERATED_DIR, `${params.companyId.toString()}-${params.fileName}`);
  const relativePath = path.relative(process.cwd(), absolutePath);
  const temporaryPath = `${absolutePath}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, params.contents, { flag: "wx", mode: 0o600 });
    await fs.chmod(temporaryPath, 0o600);
    await fs.rename(temporaryPath, absolutePath);
    await fs.chmod(absolutePath, 0o600);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return relativePath;
}

export async function reconcileCraArtifactStorage(params: {
  apply?: boolean;
  minimumAgeMs?: number;
} = {}) {
  const apply = params.apply ?? false;
  const minimumAgeMs = Math.max(params.minimumAgeMs ?? 60 * 60 * 1000, 0);
  await fs.mkdir(GENERATED_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(GENERATED_DIR, 0o700);

  const referenced = new Set(
    (await prisma.document.findMany({ select: { storagePath: true } })).map((document) =>
      path.resolve(process.cwd(), document.storagePath)
    )
  );
  const entries = await fs.readdir(GENERATED_DIR, { withFileTypes: true });
  const reasonCounts = {
    UNPUBLISHED_TEMPORARY_FILE: 0,
    UNREFERENCED_ARTIFACT: 0,
  };
  let removedCount = 0;
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolutePath = path.join(GENERATED_DIR, entry.name);
    const stat = await fs.stat(absolutePath);
    if (now - stat.mtimeMs < minimumAgeMs) continue;

    const reason = entry.name.includes(".tmp-")
      ? "UNPUBLISHED_TEMPORARY_FILE" as const
      : referenced.has(absolutePath)
        ? null
        : "UNREFERENCED_ARTIFACT" as const;
    if (!reason) continue;
    reasonCounts[reason] += 1;

    if (apply) {
      await fs.unlink(absolutePath);
      removedCount += 1;
    }
  }

  return {
    mode: apply ? "apply" as const : "dry-run" as const,
    detectedCount: reasonCounts.UNPUBLISHED_TEMPORARY_FILE + reasonCounts.UNREFERENCED_ARTIFACT,
    removedCount,
    reasonCounts,
  };
}

async function renderPdfBuffer(browser: Browser, html: string) {
  const page = await browser.newPage();

  try {
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    return Buffer.from(await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "16px",
        right: "16px",
        bottom: "16px",
        left: "16px",
      },
    }));
  } finally {
    await page.close();
  }
}

function renderRemittanceReportHtml(input: {
  label: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  employeeCount: number;
  totals: {
    incomeTax: number;
    cppEmployee: number;
    cppEmployer: number;
    eiEmployee: number;
    eiEmployer: number;
    totalPayable: number;
  };
}) {
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(value);

  const rows = [
    ["Income tax withheld", formatCurrency(input.totals.incomeTax)],
    ["CPP employee", formatCurrency(input.totals.cppEmployee)],
    ["CPP employer", formatCurrency(input.totals.cppEmployer)],
    ["EI employee", formatCurrency(input.totals.eiEmployee)],
    ["EI employer", formatCurrency(input.totals.eiEmployer)],
  ]
    .map(
      ([label, value]) => `
        <tr>
          <td>${escapeHtml(label)}</td>
          <td>${escapeHtml(value)}</td>
        </tr>
      `
    )
    .join("");

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(input.label)} remittance report</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          color: #111827;
          margin: 0;
          padding: 32px;
        }
        .page {
          border: 1px solid #e5e7eb;
          border-radius: 24px;
          padding: 32px;
        }
        h1 {
          font-size: 28px;
          margin: 0 0 8px;
        }
        .subtitle {
          color: #4b5563;
          margin: 0 0 24px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 24px;
        }
        .card {
          background: #f9fafb;
          border-radius: 16px;
          padding: 16px;
        }
        .label {
          color: #6b7280;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 8px;
        }
        .value {
          font-size: 18px;
          font-weight: 700;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 12px;
        }
        th, td {
          border-bottom: 1px solid #e5e7eb;
          padding: 12px 0;
          text-align: left;
          font-size: 14px;
        }
        th {
          color: #6b7280;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .total-row td {
          font-weight: 700;
          border-bottom: 0;
          padding-top: 16px;
        }
      </style>
    </head>
    <body>
      <main class="page">
        <h1>${escapeHtml(input.label)} remittance report</h1>
        <p class="subtitle">Payroll remittance filing summary</p>
        <section class="grid">
          <div class="card">
            <div class="label">Period</div>
            <div class="value">${escapeHtml(input.periodStart)} to ${escapeHtml(input.periodEnd)}</div>
          </div>
          <div class="card">
            <div class="label">CRA due date</div>
            <div class="value">${escapeHtml(input.dueDate)}</div>
          </div>
          <div class="card">
            <div class="label">Employees included</div>
            <div class="value">${escapeHtml(String(input.employeeCount))}</div>
          </div>
          <div class="card">
            <div class="label">Total payable</div>
            <div class="value">${escapeHtml(formatCurrency(input.totals.totalPayable))}</div>
          </div>
        </section>
        <section>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
              <tr class="total-row">
                <td>Total payable</td>
                <td>${escapeHtml(formatCurrency(input.totals.totalPayable))}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </main>
    </body>
  </html>`;
}

export async function getOrCreateCompanyPayrollSettings(companyId: bigint) {
  const existing = await prisma.companyPayrollSettings.findUnique({
    where: { companyId },
  });

  if (existing) return existing;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      name: true,
      adminEmail: true,
    },
  });

  return prisma.companyPayrollSettings.create({
    data: {
      companyId,
      legalName: company?.name ?? null,
      contactEmail: company?.adminEmail ?? null,
    },
  });
}

export async function updateCompanyPayrollSettings(
  companyId: bigint,
  input: {
    legalName?: string | null;
    businessNumber?: string | null;
    payrollProgramAccount?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    provinceCode?: string | null;
    postalCode?: string | null;
    countryCode?: string | null;
    remitterType?: RemitterType;
    contactName?: string | null;
    contactPhone?: string | null;
    contactPhoneExtension?: string | null;
    contactEmail?: string | null;
    transmitterAccountNumber?: string | null;
    transmitterRepId?: string | null;
    submissionLanguageCode?: string | null;
    preDueReminderDays?: number;
    postDueReminderFrequencyDays?: number;
  }
) {
  await getOrCreateCompanyPayrollSettings(companyId);
  const nextBusinessNumber = normalizeOptionalText(input.businessNumber);
  const nextPayrollProgramAccount = normalizeUpperText(input.payrollProgramAccount);
  const nextTransmitterAccountNumber = normalizeUpperText(input.transmitterAccountNumber);
  const nextTransmitterRepId = normalizeUpperText(input.transmitterRepId);

  const updated = await prisma.companyPayrollSettings.update({
    where: { companyId },
    data: {
      legalName: normalizeOptionalText(input.legalName),
      businessNumber: nextBusinessNumber,
      payrollProgramAccount: nextPayrollProgramAccount,
      addressLine1: normalizeOptionalText(input.addressLine1),
      addressLine2: normalizeOptionalText(input.addressLine2),
      city: normalizeOptionalText(input.city),
      provinceCode: normalizeUpperText(input.provinceCode),
      postalCode: normalizePostalCode(input.postalCode),
      countryCode: normalizeCountryCode(input.countryCode),
      remitterType: input.remitterType ?? undefined,
      contactName: normalizeOptionalText(input.contactName),
      contactPhone: normalizeOptionalText(input.contactPhone),
      contactPhoneExtension: normalizeOptionalText(input.contactPhoneExtension),
      contactEmail: normalizeOptionalText(input.contactEmail),
      transmitterAccountNumber: nextTransmitterAccountNumber,
      transmitterRepId: nextTransmitterRepId,
      submissionLanguageCode: normalizeUpperText(input.submissionLanguageCode, "E"),
      preDueReminderDays: input.preDueReminderDays ?? undefined,
      postDueReminderFrequencyDays: input.postDueReminderFrequencyDays ?? undefined,
    },
  });

  await logAudit({
    companyId,
    action: "COMPANY_PAYROLL_SETTINGS_UPDATED",
    targetType: "CompanyPayrollSettings",
    targetId: updated.id.toString(),
  });

  return updated;
}

export async function getMissingT4FilingSettings(companyId: bigint) {
  const settings = await getOrCreateCompanyPayrollSettings(companyId);
  return getMissingT4SettingsFromSettings(settings);
}

export function calculateRemittanceDueDate(remitterType: RemitterType, periodEnd: Date) {
  const end = getDateOnlyParts(periodEnd);

  if (remitterType === "QUARTERLY") {
    return createUtcDateOnly(end.year, end.monthIndex + 1, 15);
  }

  if (remitterType === "ACCELERATED_THRESHOLD_1" || remitterType === "ACCELERATED_THRESHOLD_2") {
    // MVP structure-ready fallback. Real accelerated rules should replace this later.
    return createUtcDateOnly(end.year, end.monthIndex + 1, 15);
  }

  return createUtcDateOnly(end.year, end.monthIndex + 1, 15);
}

export function deriveRemittanceStatus(
  dueDate: Date,
  totalPayable: Prisma.Decimal | number | string,
  totalPaid: Prisma.Decimal | number | string,
  today = getTodayUtcDateOnly()
) {
  const payable = decimal(totalPayable);
  const paid = decimal(totalPaid);

  if (paid.greaterThanOrEqualTo(payable) && payable.greaterThan(0)) {
    return RemittanceStatus.PAID;
  }

  if (paid.greaterThan(0)) {
    return RemittanceStatus.PARTIALLY_PAID;
  }

  if (compareUtcDateOnly(dueDate, today) < 0) return RemittanceStatus.OVERDUE;
  return RemittanceStatus.DUE;
}

export function getReminderState(
  remittance: { dueDate: Date; status: RemittanceStatus },
  now = new Date()
) {
  if (
    remittance.status === RemittanceStatus.PAID ||
    remittance.status === RemittanceStatus.REVIEW_REQUIRED
  ) {
    return ReminderState.PAID_NO_REMINDER;
  }

  const today = getTodayUtcDateOnly(now);
  const comparison = compareUtcDateOnly(remittance.dueDate, today);
  if (comparison === 0) return ReminderState.DUE_TODAY;
  if (comparison < 0) return ReminderState.OVERDUE;
  return ReminderState.UPCOMING;
}

type RemittanceSourceRow = {
  id: bigint;
  employeeId: bigint;
  payrollRunId: bigint | null;
  payDate: Date;
  ded_income_tax: Prisma.Decimal;
  ded_cpp: Prisma.Decimal;
  ded_ei: Prisma.Decimal;
  updatedAt: Date;
};

type RemittancePeriod = {
  label: string;
  start: Date;
  end: Date;
  rows: RemittanceSourceRow[];
};

function buildPeriods(rows: RemittanceSourceRow[], remitterType: RemitterType) {
  const groups = new Map<string, RemittancePeriod>();

  for (const row of rows) {
    const date = row.payDate;
    const { year, monthIndex } = getDateOnlyParts(date);

    let key: string;
    let label: string;
    let range: { start: Date; end: Date };

    if (remitterType === "QUARTERLY") {
      const quarterIndex = Math.floor(monthIndex / 3);
      range = getQuarterRange(year, quarterIndex);
      label = getQuarterLabel(date);
      key = `${year}-Q${quarterIndex + 1}`;
    } else {
      range = getMonthRange(year, monthIndex);
      label = `${date.toLocaleString("en-CA", { month: "long", timeZone: "UTC" })} ${year}`;
      key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    }

    const current = groups.get(key);
    if (current) {
      current.rows.push(row);
      continue;
    }

    groups.set(key, {
      label,
      start: range.start,
      end: range.end,
      rows: [row],
    });
  }

  return Array.from(groups.values()).sort((a, b) => b.start.getTime() - a.start.getTime());
}

function calculateRemittancePeriod(period: RemittancePeriod, remitterType: RemitterType) {
  const incomeTax = period.rows.reduce((sum, row) => sum.add(row.ded_income_tax), ZERO);
  const cppEmployee = period.rows.reduce((sum, row) => sum.add(row.ded_cpp), ZERO);
  const eiEmployee = period.rows.reduce((sum, row) => sum.add(row.ded_ei), ZERO);
  const cppEmployer = roundMoney(cppEmployee);
  const eiEmployer = roundMoney(eiEmployee.mul(1.4));
  const totalPayable = roundMoney(addMoney(incomeTax, cppEmployee, cppEmployer, eiEmployee, eiEmployer));
  const employeeCount = new Set(period.rows.map((row) => row.employeeId.toString())).size;
  const dueDate = calculateRemittanceDueDate(remitterType, period.end);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    version: REMITTANCE_SOURCE_VERSION,
    remitterType,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    dueDate: dueDate.toISOString(),
    rows: [...period.rows]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((row) => ({
        id: row.id.toString(),
        employeeId: row.employeeId.toString(),
        payDate: row.payDate.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        incomeTax: row.ded_income_tax.toFixed(2),
        cpp: row.ded_cpp.toFixed(2),
        ei: row.ded_ei.toFixed(2),
      })),
  })).digest("hex");

  return {
    incomeTax: roundMoney(incomeTax),
    cppEmployee: roundMoney(cppEmployee),
    cppEmployer,
    eiEmployee: roundMoney(eiEmployee),
    eiEmployer,
    totalPayable,
    employeeCount,
    dueDate,
    fingerprint,
  };
}

async function lockRemittancePeriod(
  tx: Prisma.TransactionClient,
  companyId: bigint,
  periodStart: Date,
  periodEnd: Date
) {
  const key = `${companyId.toString()}:${periodStart.toISOString()}:${periodEnd.toISOString()}`;
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS "lock"
  `;
}

function priorRemittanceSnapshot(remittance: {
  employeeCount: number;
  totalIncomeTax: Prisma.Decimal;
  totalCppEmployee: Prisma.Decimal;
  totalCppEmployer: Prisma.Decimal;
  totalEiEmployee: Prisma.Decimal;
  totalEiEmployer: Prisma.Decimal;
  totalPayable: Prisma.Decimal;
  sourceFingerprint: string | null;
  sourceVersion: string | null;
  reportPublishedAt: Date | null;
}) {
  return {
    employeeCount: remittance.employeeCount,
    totalIncomeTax: remittance.totalIncomeTax.toFixed(2),
    totalCppEmployee: remittance.totalCppEmployee.toFixed(2),
    totalCppEmployer: remittance.totalCppEmployer.toFixed(2),
    totalEiEmployee: remittance.totalEiEmployee.toFixed(2),
    totalEiEmployer: remittance.totalEiEmployer.toFixed(2),
    totalPayable: remittance.totalPayable.toFixed(2),
    sourceFingerprint: remittance.sourceFingerprint,
    sourceVersion: remittance.sourceVersion,
    reportPublishedAt: remittance.reportPublishedAt?.toISOString() ?? null,
  };
}

async function logAudit(params: {
  companyId: bigint;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({
    data: {
      companyId: params.companyId,
      actorType: "SYSTEM",
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadataJson: params.metadata,
    },
  });
}

export type RemittanceSyncTestHooks = {
  afterPdfRendered?: (context: { fingerprint: string }) => Promise<void>;
  afterReportWritten?: (context: { fingerprint: string; storagePath: string }) => Promise<void>;
  afterEligibilityRevalidated?: (context: { payrollRunCount: number }) => Promise<void>;
  beforePublicationCommit?: (context: { fingerprint: string; remittanceId: bigint }) => Promise<void>;
  publicationLockTimeoutMs?: number;
};

export async function syncRemittancesForCompany(
  companyId: bigint,
  testHooks: RemittanceSyncTestHooks = {}
) {
  const operationNow = new Date();
  const verificationCutoff = getProviderVerificationCutoff(operationNow);
  const settings = await getOrCreateCompanyPayrollSettings(companyId);
  const sourceRows = await prisma.payHistory.findMany({
    where: {
      employee: {
        companyId,
      },
    },
    select: {
      id: true,
      employeeId: true,
      payDate: true,
      ded_income_tax: true,
      ded_cpp: true,
      ded_ei: true,
      updatedAt: true,
      status: true,
      paidAt: true,
      paymentProvider: true,
      paymentRef: true,
      payrollRunId: true,
      payrollRun: {
        select: COMPLIANCE_PAYROLL_RUN_SELECT,
      },
    },
    orderBy: { payDate: "asc" },
  });

  const payrollSelection = partitionCompliancePayrollRows(
    sourceRows,
    companyId,
    verificationCutoff
  );
  const eligibilityEvaluationFingerprint = createHash("sha256").update(JSON.stringify({
    rows: sourceRows.map((row) => ({
      id: row.id.toString(),
      updatedAt: row.updatedAt.toISOString(),
      childStatus: row.status,
      hasPaidAt: Boolean(row.paidAt),
      hasPaymentProvider: Boolean(row.paymentProvider?.trim()),
      hasPaymentRef: Boolean(row.paymentRef?.trim()),
      parentStatus: row.payrollRun?.status ?? null,
      hasProviderRef: Boolean(row.payrollRun?.providerRef?.trim()),
      verificationStatus: row.payrollRun?.providerVerificationStatus ?? null,
      lastSucceededAt: row.payrollRun?.providerVerificationLastSucceededAt?.toISOString() ?? null,
      evidenceVersion: row.payrollRun?.providerEvidenceVersion ?? null,
    })),
    includedCount: payrollSelection.included.length,
    excludedCount: payrollSelection.excludedCount,
    reasonCounts: payrollSelection.reasonCounts,
  })).digest("hex");
  const payHistory = payrollSelection.included;
  const periods = buildPeriods(payHistory, settings.remitterType);
  const eligiblePeriodKeys = new Set(
    periods.map((period) => periodIdentity(period.start, period.end))
  );
  const existingRemittances = await prisma.remittance.findMany({
    where: { companyId },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      sourceFingerprint: true,
      sourceVersion: true,
      status: true,
      allocations: { select: { payHistoryId: true } },
      documents: {
        where: { documentType: "REMITTANCE_REPORT", validationStatus: "ACTIVE" },
        select: { id: true },
      },
    },
  });
  const excludedPayHistoryIds = new Set(
    sourceRows
      .filter((row) => !payrollSelection.included.some((included) => included.id === row.id))
      .map((row) => row.id.toString())
  );
  const reviewRequiredPeriodKeys = new Set<string>();

  for (const existing of existingRemittances) {
    const periodKey = periodIdentity(existing.periodStart, existing.periodEnd);
    const hasIneligibleAllocation = existing.allocations.some((allocation) =>
      excludedPayHistoryIds.has(allocation.payHistoryId.toString())
    );
    if (eligiblePeriodKeys.has(periodKey) && !hasIneligibleAllocation) {
      continue;
    }

    const periodSourceRows = sourceRows.filter(
      (row) => row.payDate >= existing.periodStart && row.payDate <= existing.periodEnd
    );
    const periodSelection = partitionCompliancePayrollRows(
      periodSourceRows,
      companyId,
      verificationCutoff
    );
    const reasonCode = hasIneligibleAllocation
      ? "INELIGIBLE_PROVIDER_EVIDENCE_FOR_PERIOD"
      : "NO_ELIGIBLE_PAYROLL_FOR_PERIOD";
    reviewRequiredPeriodKeys.add(periodKey);

    await prisma.$transaction(async (tx) => {
      await lockRemittancePeriod(tx, companyId, existing.periodStart, existing.periodEnd);
      const current = await tx.remittance.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          payments: { where: { status: "RECORDED" }, select: { id: true } },
          allocations: { select: { payHistoryId: true } },
          documents: {
            where: { documentType: "REMITTANCE_REPORT", validationStatus: "ACTIVE" },
            select: { id: true },
          },
        },
      });
      const alreadyQuarantined =
        current.status === RemittanceStatus.REVIEW_REQUIRED &&
        current.allocations.length === 0 &&
        current.documents.length === 0;
      if (alreadyQuarantined) return;

      const reviewRequiredAt = new Date();
      const priorSnapshot = priorRemittanceSnapshot(current);
      await tx.reminderEvent.deleteMany({
        where: { remittanceId: existing.id, sentAt: null },
      });
      await tx.remittancePayHistory.deleteMany({
        where: { remittanceId: existing.id },
      });
      await tx.document.updateMany({
        where: {
          remittanceId: existing.id,
          documentType: "REMITTANCE_REPORT",
          validationStatus: "ACTIVE",
        },
        data: {
          validationStatus: "QUARANTINED",
          validationReason: reasonCode,
          quarantinedAt: reviewRequiredAt,
        },
      });
      await tx.remittance.update({
        where: { id: existing.id },
        data: {
          status: "REVIEW_REQUIRED",
          reviewRequiredAt,
          reconciliationSummary: {
            reasonCode,
            recordedPaymentCount: current.payments.length,
            priorPublishedSnapshot: priorSnapshot,
            includedCount: periodSelection.included.length,
            excludedCount: periodSelection.excludedCount,
            reasonCounts: periodSelection.reasonCounts,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          actorType: "SYSTEM",
          action: "REMITTANCE_QUARANTINED",
          targetType: "Remittance",
          targetId: existing.id.toString(),
          metadataJson: {
            reasonCode,
            recordedPaymentCount: current.payments.length,
            priorPublishedSnapshot: priorSnapshot,
            includedCount: periodSelection.included.length,
            excludedCount: periodSelection.excludedCount,
            reasonCounts: periodSelection.reasonCounts,
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  if (
    periods.length === 0 &&
    payrollSelection.excludedCount > 0 &&
    existingRemittances.length === 0
  ) {
    const priorEvaluation = await prisma.auditLog.findFirst({
      where: {
        companyId,
        action: "REMITTANCE_GENERATION_SKIPPED",
        targetType: "Company",
        targetId: companyId.toString(),
      },
      orderBy: { id: "desc" },
      select: { metadataJson: true },
    });
    const priorFingerprint = (
      priorEvaluation?.metadataJson as { eligibilityEvaluationFingerprint?: string } | null
    )?.eligibilityEvaluationFingerprint;
    if (priorFingerprint !== eligibilityEvaluationFingerprint) {
      await logAudit({
        companyId,
        action: "REMITTANCE_GENERATION_SKIPPED",
        targetType: "Company",
        targetId: companyId.toString(),
        metadata: {
          reasonCode: "NO_ELIGIBLE_PAYROLL",
          includedCount: 0,
          excludedCount: payrollSelection.excludedCount,
          reasonCounts: payrollSelection.reasonCounts,
          eligibilityEvaluationFingerprint,
        },
      });
    }
  }
  let browser: Browser | null = null;

  try {
    for (const period of periods) {
      const periodKey = periodIdentity(period.start, period.end);
      if (reviewRequiredPeriodKeys.has(periodKey)) continue;
      const periodSourceRows = sourceRows.filter(
        (row) => row.payDate >= period.start && row.payDate <= period.end
      );
      const periodSelection = partitionCompliancePayrollRows(
        periodSourceRows,
        companyId,
        verificationCutoff
      );
      const periodSourceMembershipFingerprint =
        createComplianceSourceMembershipFingerprint(periodSourceRows);
      const calculated = calculateRemittancePeriod(period, settings.remitterType);
      const existing = existingRemittances.find(
        (item) => periodIdentity(item.periodStart, item.periodEnd) === periodIdentity(period.start, period.end)
      );
      if (
        existing?.sourceFingerprint === calculated.fingerprint &&
        existing.sourceVersion === REMITTANCE_SOURCE_VERSION &&
        existing.documents.length === 1 &&
        existing.status !== RemittanceStatus.REVIEW_REQUIRED &&
        existing.allocations.length === period.rows.length
      ) {
        continue;
      }

      const reportPayload = {
        label: period.label,
        periodStart: fmtDate(period.start),
        periodEnd: fmtDate(period.end),
        dueDate: fmtDate(calculated.dueDate),
        employeeCount: calculated.employeeCount,
        totals: {
          incomeTax: calculated.incomeTax.toNumber(),
          cppEmployee: calculated.cppEmployee.toNumber(),
          cppEmployer: calculated.cppEmployer.toNumber(),
          eiEmployee: calculated.eiEmployee.toNumber(),
          eiEmployer: calculated.eiEmployer.toNumber(),
          totalPayable: calculated.totalPayable.toNumber(),
        },
      };

      if (!browser) {
        browser = await puppeteer.launch({ headless: true });
      }

      const reportPdfBuffer = await renderPdfBuffer(browser, renderRemittanceReportHtml(reportPayload));
      await testHooks.afterPdfRendered?.({ fingerprint: calculated.fingerprint });
      const generationId = randomUUID();
      let storagePath: string | null = null;
      try {
        storagePath = await writeGeneratedFile({
          companyId,
          fileName: `remittance-${fmtDate(period.start)}-${fmtDate(period.end)}-${generationId}.pdf`,
          contents: reportPdfBuffer,
        });
        await testHooks.afterReportWritten?.({ fingerprint: calculated.fingerprint, storagePath });

        const publication = await prisma.$transaction(async (tx) => {
          const lockedPayrollRunIds = await lockCompanyComplianceScope(
            tx,
            companyId,
            periodSourceRows.map((row) => row.payrollRunId),
            { timeoutMs: testHooks.publicationLockTimeoutMs }
          );
          await lockRemittancePeriod(tx, companyId, period.start, period.end);
          const transactionSettings = await tx.companyPayrollSettings.findUniqueOrThrow({
            where: { companyId },
            select: { remitterType: true, preDueReminderDays: true },
          });
          if (transactionSettings.remitterType !== settings.remitterType) {
            throw new Error("REMITTANCE_SOURCE_CHANGED_DURING_PUBLICATION");
          }

          const transactionRows = await tx.payHistory.findMany({
            where: {
              employee: { companyId },
              payDate: { gte: period.start, lte: period.end },
            },
            select: {
              id: true,
              employeeId: true,
              payDate: true,
              ded_income_tax: true,
              ded_cpp: true,
              ded_ei: true,
              updatedAt: true,
              status: true,
              paidAt: true,
              paymentProvider: true,
              paymentRef: true,
              payrollRunId: true,
              payrollRun: { select: COMPLIANCE_PAYROLL_RUN_SELECT },
            },
            orderBy: [{ payDate: "asc" }, { id: "asc" }],
          });
          const transactionSelection = partitionCompliancePayrollRows(
            transactionRows,
            companyId,
            verificationCutoff
          );
          const transactionSourceMembershipFingerprint =
            createComplianceSourceMembershipFingerprint(transactionRows);
          if (!sameBigIntIds(
            transactionSelection.included.map((row) => row.id),
            period.rows.map((row) => row.id)
          ) || transactionSelection.excludedCount !== periodSelection.excludedCount ||
            JSON.stringify(transactionSelection.reasonCounts) !==
              JSON.stringify(periodSelection.reasonCounts) ||
            transactionSourceMembershipFingerprint !== periodSourceMembershipFingerprint) {
            throw new Error("REMITTANCE_PROVIDER_EVIDENCE_CHANGED_DURING_PUBLICATION");
          }
          const transactionPeriod = buildPeriods(transactionSelection.included, settings.remitterType)
            .find((candidate) => periodIdentity(candidate.start, candidate.end) === periodIdentity(period.start, period.end));
          if (!transactionPeriod) {
            throw new Error("REMITTANCE_SOURCE_CHANGED_DURING_PUBLICATION");
          }
          const transactionCalculated = calculateRemittancePeriod(transactionPeriod, settings.remitterType);
          if (transactionCalculated.fingerprint !== calculated.fingerprint) {
            throw new Error("REMITTANCE_SOURCE_CHANGED_DURING_PUBLICATION");
          }
          await testHooks.afterEligibilityRevalidated?.({
            payrollRunCount: lockedPayrollRunIds.length,
          });

          const current = await tx.remittance.findUnique({
            where: {
              companyId_periodStart_periodEnd: {
                companyId,
                periodStart: period.start,
                periodEnd: period.end,
              },
            },
            include: {
              payments: { where: { status: "RECORDED" }, orderBy: { paymentDate: "desc" } },
              documents: {
                where: { documentType: "REMITTANCE_REPORT", validationStatus: "ACTIVE" },
                select: { id: true },
              },
              allocations: { select: { payHistoryId: true } },
            },
          });
          if (
            current?.sourceFingerprint === calculated.fingerprint &&
            current.sourceVersion === REMITTANCE_SOURCE_VERSION &&
            current.documents.length === 1 &&
            current.status !== RemittanceStatus.REVIEW_REQUIRED &&
            current.allocations.length === period.rows.length
          ) {
            return { published: false, remittanceId: current.id };
          }

          const recordedPayments = current?.payments ?? [];
          const totalPaid = sumRecordedPayments(recordedPayments);
          const status = deriveRemittanceStatus(
            calculated.dueDate,
            calculated.totalPayable,
            totalPaid
          );
          const publishedAt = new Date();
          const remittance = await tx.remittance.upsert({
            where: {
              companyId_periodStart_periodEnd: {
                companyId,
                periodStart: period.start,
                periodEnd: period.end,
              },
            },
            update: {
              remitterTypeSnapshot: settings.remitterType,
              dueDate: calculated.dueDate,
              employeeCount: calculated.employeeCount,
              totalIncomeTax: calculated.incomeTax,
              totalCppEmployee: calculated.cppEmployee,
              totalCppEmployer: calculated.cppEmployer,
              totalEiEmployee: calculated.eiEmployee,
              totalEiEmployer: calculated.eiEmployer,
              totalPayable: calculated.totalPayable,
              paidAt: status === RemittanceStatus.PAID ? recordedPayments[0]?.paymentDate ?? null : null,
              status,
              reviewRequiredAt: null,
              sourceFingerprint: calculated.fingerprint,
              sourceVersion: REMITTANCE_SOURCE_VERSION,
              reportPublishedAt: publishedAt,
              reconciliationSummary: {
                reasonCode: "ELIGIBLE_PAYROLL_RECONCILED",
                eligiblePayrollCount: period.rows.length,
                excludedPayrollCount: periodSelection.excludedCount,
                reasonCounts: periodSelection.reasonCounts,
                sourceFingerprint: calculated.fingerprint,
                sourceVersion: REMITTANCE_SOURCE_VERSION,
              },
            },
            create: {
              companyId,
              periodStart: period.start,
              periodEnd: period.end,
              remitterTypeSnapshot: settings.remitterType,
              dueDate: calculated.dueDate,
              employeeCount: calculated.employeeCount,
              totalIncomeTax: calculated.incomeTax,
              totalCppEmployee: calculated.cppEmployee,
              totalCppEmployer: calculated.cppEmployer,
              totalEiEmployee: calculated.eiEmployee,
              totalEiEmployer: calculated.eiEmployer,
              totalPayable: calculated.totalPayable,
              paidAt: status === RemittanceStatus.PAID ? recordedPayments[0]?.paymentDate ?? null : null,
              status,
              sourceFingerprint: calculated.fingerprint,
              sourceVersion: REMITTANCE_SOURCE_VERSION,
              reportPublishedAt: publishedAt,
              reconciliationSummary: {
                reasonCode: "ELIGIBLE_PAYROLL_RECONCILED",
                eligiblePayrollCount: period.rows.length,
                excludedPayrollCount: periodSelection.excludedCount,
                reasonCounts: periodSelection.reasonCounts,
                sourceFingerprint: calculated.fingerprint,
                sourceVersion: REMITTANCE_SOURCE_VERSION,
              },
            },
          });

          await tx.remittancePayHistory.deleteMany({ where: { remittanceId: remittance.id } });
          await tx.remittancePayHistory.createMany({
            data: period.rows.map((row) => ({ remittanceId: remittance.id, payHistoryId: row.id })),
          });
          const [allocationCount, eligibleAllocationCount] = await Promise.all([
            tx.remittancePayHistory.count({ where: { remittanceId: remittance.id } }),
            tx.remittancePayHistory.count({
              where: {
                remittanceId: remittance.id,
                payHistory: { is: compliancePayrollWhere(companyId, verificationCutoff) },
              },
            }),
          ]);
          if (allocationCount !== period.rows.length || eligibleAllocationCount !== allocationCount) {
            throw new Error("Remittance allocation eligibility invariant failed");
          }

          await tx.document.updateMany({
            where: {
              remittanceId: remittance.id,
              documentType: "REMITTANCE_REPORT",
              validationStatus: "ACTIVE",
            },
            data: {
              validationStatus: "QUARANTINED",
              validationReason: "SUPERSEDED_BY_RECONCILIATION",
              quarantinedAt: publishedAt,
            },
          });
          await tx.document.create({
            data: {
              companyId,
              documentType: "REMITTANCE_REPORT",
              fileName: path.basename(storagePath!),
              storagePath: storagePath!,
              mimeType: "application/pdf",
              linkedEntityType: "REMITTANCE",
              linkedEntityId: remittance.id,
              remittanceId: remittance.id,
              validationStatus: "ACTIVE",
              generationId,
              generationVersion: REMITTANCE_GENERATION_VERSION,
            },
          });
          await tx.reminderEvent.deleteMany({
            where: { remittanceId: remittance.id, sentAt: null },
          });
          const reminderDates = [
            Math.max(transactionSettings.preDueReminderDays, 1), 3, 1,
          ].filter((days, index, list) => days > 0 && list.indexOf(days) === index)
            .map((days) => addUtcDateOnlyDays(calculated.dueDate, -days));
          await tx.reminderEvent.createMany({
            data: [
              ...reminderDates.map((scheduledFor) => ({
                companyId,
                remittanceId: remittance.id,
                reminderState: ReminderState.UPCOMING,
                scheduledFor,
              })),
              {
                companyId,
                remittanceId: remittance.id,
                reminderState: ReminderState.DUE_TODAY,
                scheduledFor: calculated.dueDate,
              },
              {
                companyId,
                remittanceId: remittance.id,
                reminderState: ReminderState.OVERDUE,
                scheduledFor: addUtcDateOnlyDays(calculated.dueDate, 1),
              },
            ],
          });
          await tx.auditLog.create({
            data: {
              companyId,
              actorType: "SYSTEM",
              action: "REMITTANCE_REPORT_PUBLISHED",
              targetType: "Remittance",
              targetId: remittance.id.toString(),
              metadataJson: {
                generationId,
                generationVersion: REMITTANCE_GENERATION_VERSION,
                sourceFingerprint: calculated.fingerprint,
                sourceVersion: REMITTANCE_SOURCE_VERSION,
                includedCount: period.rows.length,
                excludedCount: periodSelection.excludedCount,
                reasonCounts: periodSelection.reasonCounts,
              },
            },
          });
          await testHooks.beforePublicationCommit?.({
            fingerprint: calculated.fingerprint,
            remittanceId: remittance.id,
          });
          return { published: true, remittanceId: remittance.id };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

        if (!publication.published) {
          await fs.unlink(path.resolve(process.cwd(), storagePath)).catch(() => undefined);
        }
      } catch (error) {
        if (storagePath) {
          await fs.unlink(path.resolve(process.cwd(), storagePath)).catch(() => undefined);
        }
        throw error;
      }
    }

    return prisma.remittance.findMany({
      where: { companyId },
      orderBy: [{ periodStart: "desc" }],
      include: {
        payments: {
          where: { status: "RECORDED" },
          orderBy: { paymentDate: "desc" },
        },
      },
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function recordRemittancePayment(params: {
  companyId: bigint;
  remittanceId: bigint;
  paymentDate: Date | string;
  amountPaid: number;
  paymentMethod?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
}) {
  const remittance = await prisma.remittance.findFirst({
    where: {
      id: params.remittanceId,
      companyId: params.companyId,
    },
  });

  if (!remittance) {
    throw new Error("Remittance not found");
  }
  if (remittance.status === RemittanceStatus.REVIEW_REQUIRED) {
    throw new Error("Remittance requires reconciliation review before recording payments");
  }

  const normalizedPaymentDate = normalizeUtcDateOnly(params.paymentDate);
  const normalizedAmountPaid = roundMoney(params.amountPaid);
  const paymentMethod = params.paymentMethod?.trim() || null;
  const referenceNumber = params.referenceNumber?.trim() || null;
  const notes = params.notes?.trim() || null;

  const existingPayment = await prisma.remittancePayment.findFirst({
    where: {
      remittanceId: remittance.id,
      status: "RECORDED",
      paymentDate: normalizedPaymentDate,
      amountPaid: normalizedAmountPaid,
    },
  });

  const payment = existingPayment
    ? await prisma.remittancePayment.update({
        where: { id: existingPayment.id },
        data: {
          paymentMethod,
          referenceNumber,
          notes,
        },
      })
    : await prisma.remittancePayment.create({
        data: {
          remittanceId: remittance.id,
          paymentDate: normalizedPaymentDate,
          amountPaid: normalizedAmountPaid,
          paymentMethod,
          referenceNumber,
          notes,
        },
      });

  const recordedPayments = existingPayment
    ? await prisma.remittancePayment.findMany({
        where: {
          remittanceId: remittance.id,
          status: "RECORDED",
        },
        orderBy: { paymentDate: "desc" },
      })
    : [payment, ...(await prisma.remittancePayment.findMany({
        where: {
          remittanceId: remittance.id,
          status: "RECORDED",
          id: { not: payment.id },
        },
        orderBy: { paymentDate: "desc" },
      }))];

  const totalPaid = sumRecordedPayments(recordedPayments);
  const status = deriveRemittanceStatus(remittance.dueDate, remittance.totalPayable, totalPaid);
  const paidInFull =
    status === RemittanceStatus.PAID;

  await prisma.remittance.update({
    where: { id: remittance.id },
    data: {
      paidAt: paidInFull ? normalizedPaymentDate : null,
      status,
      notes: notes || remittance.notes,
    },
  });

  if (!existingPayment) {
    await logAudit({
      companyId: params.companyId,
      action: "REMITTANCE_MARKED_PAID",
      targetType: "Remittance",
      targetId: remittance.id.toString(),
      metadata: {
        paymentId: payment.id.toString(),
        amountPaid: normalizedAmountPaid.toNumber(),
        paymentDate: normalizedPaymentDate.toISOString(),
      },
    });
  }

  return payment;
}

async function quarantineT4GenerationFailure(params: {
  companyId: bigint;
  taxYear: number;
  reasonCode: string;
  metadata?: Prisma.InputJsonObject;
}) {
  const quarantinedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const summary = await tx.t4Summary.findUnique({
      where: {
        companyId_taxYear: {
          companyId: params.companyId,
          taxYear: params.taxYear,
        },
      },
      select: { id: true, status: true },
    });

    if (summary?.status === T4GenerationStatus.FINALIZED) {
      await tx.auditLog.create({
        data: {
          companyId: params.companyId,
          actorType: "SYSTEM",
          action: "T4_FINALIZED_REVALIDATION_REVIEW_REQUIRED",
          targetType: "T4Summary",
          targetId: summary.id.toString(),
          metadataJson: {
            taxYear: params.taxYear,
            reasonCode: params.reasonCode,
            ...params.metadata,
          },
        },
      });
      return "FINALIZED_UNCHANGED" as const;
    }

    if (summary) {
      const mutableSlips = await tx.t4Slip.findMany({
        where: {
          summaryId: summary.id,
          status: { not: T4GenerationStatus.FINALIZED },
        },
        select: { id: true },
      });
      const mutableSlipIds = mutableSlips.map((slip) => slip.id);

      if (mutableSlipIds.length > 0) {
        await tx.document.updateMany({
          where: {
            t4SlipId: { in: mutableSlipIds },
            validationStatus: "ACTIVE",
          },
          data: {
            validationStatus: "QUARANTINED",
            validationReason: params.reasonCode,
            quarantinedAt,
          },
        });
        await tx.t4Slip.updateMany({
          where: { id: { in: mutableSlipIds } },
          data: { status: T4GenerationStatus.QUARANTINED },
        });
      }

      await tx.document.updateMany({
        where: {
          t4SummaryId: summary.id,
          validationStatus: "ACTIVE",
        },
        data: {
          validationStatus: "QUARANTINED",
          validationReason: params.reasonCode,
          quarantinedAt,
        },
      });
      await tx.t4Summary.updateMany({
        where: {
          id: summary.id,
          status: { not: T4GenerationStatus.FINALIZED },
        },
        data: {
          status: T4GenerationStatus.QUARANTINED,
          validationSummary: {
            reasonCode: params.reasonCode,
            ...params.metadata,
          },
          validatedAt: quarantinedAt,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        actorType: "SYSTEM",
        action: "T4_PACKAGE_GENERATION_FAILED",
        targetType: summary ? "T4Summary" : "Company",
        targetId: summary?.id.toString() ?? params.companyId.toString(),
        metadataJson: {
          taxYear: params.taxYear,
          reasonCode: params.reasonCode,
          existingArtifactQuarantined: Boolean(summary),
          ...params.metadata,
        },
      },
    });

    return summary ? "QUARANTINED" as const : "NO_EXISTING_ARTIFACT" as const;
  });
}

export type T4GenerationTestHooks = {
  afterArtifactsWritten?: () => Promise<void>;
  afterEligibilityRevalidated?: (context: { payrollRunCount: number }) => Promise<void>;
  beforeTransactionCommit?: () => Promise<void>;
  publicationLockTimeoutMs?: number;
};

type ComplianceSourceSummary = {
  includedCount: number;
  excludedCount: number;
  reasonCounts: Record<string, number>;
  sourceFingerprint: string;
  sourceMembershipFingerprint: string;
};

class T4SourceEligibilityChangedError extends Error {
  readonly sourceSummary: ComplianceSourceSummary;

  constructor(sourceSummary: ComplianceSourceSummary) {
    super("T4 provider evidence changed during publication.");
    this.name = "T4SourceEligibilityChangedError";
    this.sourceSummary = sourceSummary;
  }
}

export async function generateT4Package(
  companyId: bigint,
  taxYear: number,
  testHooks: T4GenerationTestHooks = {}
) {
  const operationNow = new Date();
  const verificationCutoff = getProviderVerificationCutoff(operationNow);
  const taxYearRange = getUtcDateOnlyYearRange(taxYear);
  const settings = await getOrCreateCompanyPayrollSettings(companyId);
  const missingSettings = getMissingT4SettingsFromSettings(settings);
  if (missingSettings.length > 0) {
    await quarantineT4GenerationFailure({
      companyId,
      taxYear,
      reasonCode: "T4_SETTINGS_VALIDATION_FAILED",
      metadata: { missingSettingCount: missingSettings.length },
    });
    throw new Error(`CRA T4 filing settings incomplete: ${missingSettings.join(", ")}`);
  }

  const existingSummary = await prisma.t4Summary.findUnique({
    where: { companyId_taxYear: { companyId, taxYear } },
    select: { id: true, status: true },
  });
  if (existingSummary?.status === T4GenerationStatus.FINALIZED) {
    await quarantineT4GenerationFailure({
      companyId,
      taxYear,
      reasonCode: "FINALIZED_ARTIFACT_REGENERATION_REQUESTED",
    });
    throw new Error("A finalized T4 package cannot be regenerated");
  }

  const sourceRows = await prisma.payHistory.findMany({
    where: {
      employee: {
        companyId,
      },
      payDate: {
        gte: taxYearRange.start,
        lt: taxYearRange.endExclusive,
      },
    },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          sin: true,
          addrLine1: true,
          addrLine2: true,
          addrCity: true,
          addrProvince: true,
          addrPostal: true,
          addrCountry: true,
          employmentType: true,
          dentalBenefitsCoverage: true,
          rppDpspRegistrationNumber: true,
          pensionAdjustmentOverride: true,
        },
      },
      payrollRun: {
        select: COMPLIANCE_PAYROLL_RUN_SELECT,
      },
    },
    orderBy: [{ employeeId: "asc" }, { payDate: "asc" }],
  });

  const contactPhone = splitPhoneNumber(settings.contactPhone);
  const payrollSelection = partitionCompliancePayrollRows(
    sourceRows,
    companyId,
    verificationCutoff
  );
  const rows = payrollSelection.included;

  const byEmployee = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.employeeId.toString();
    const current = byEmployee.get(key);
    if (current) {
      current.push(row);
    } else {
      byEmployee.set(key, [row]);
    }
  }

  const sourceSummary = {
    includedCount: rows.length,
    excludedCount: payrollSelection.excludedCount,
    reasonCounts: payrollSelection.reasonCounts,
    sourceFingerprint: createT4ComplianceSourceFingerprint(rows),
    sourceMembershipFingerprint: createComplianceSourceMembershipFingerprint(sourceRows),
  };

  if (payrollSelection.excludedCount > 0) {
    await quarantineT4GenerationFailure({
      companyId,
      taxYear,
      reasonCode: "INELIGIBLE_PAYROLL_SOURCE_PRESENT",
      metadata: {
        ...sourceSummary,
      },
    });
    throw new Error("T4 generation blocked by ineligible payroll source records");
  }

  if (rows.length === 0) {
    await quarantineT4GenerationFailure({
      companyId,
      taxYear,
      reasonCode: "NO_ELIGIBLE_PAYROLL",
      metadata: sourceSummary,
    });
    throw new Error("T4 generation blocked because there is no eligible finalized payroll");
  }

  const resolvedSinByEmployee = new Map<string, string>();
  const sinReasonCounts: Record<T4SinFailureReason, number> = {
    SIN_ENCRYPTION_STATE_UNKNOWN: 0,
    SIN_DECRYPTION_FAILED: 0,
    INVALID_DECRYPTED_SIN: 0,
  };

  for (const [employeeId, employeeRows] of byEmployee) {
    const storedSin = employeeRows[0]?.employee.sin;
    const resolved = storedSin ? resolveSinForT4(storedSin) : {
      ok: false as const,
      reason: "SIN_ENCRYPTION_STATE_UNKNOWN" as const,
    };
    if (!resolved.ok) {
      sinReasonCounts[resolved.reason] += 1;
      continue;
    }
    resolvedSinByEmployee.set(employeeId, resolved.sin);
  }

  const invalidSinCount = Object.values(sinReasonCounts).reduce((sum, count) => sum + count, 0);
  if (invalidSinCount > 0) {
    await quarantineT4GenerationFailure({
      companyId,
      taxYear,
      reasonCode: "T4_SIN_VALIDATION_FAILED",
      metadata: {
        ...sourceSummary,
        invalidEmployeeCount: invalidSinCount,
        reasonCounts: {
          ...sourceSummary.reasonCounts,
          ...sinReasonCounts,
        },
      },
    });
    throw new Error("T4 generation blocked by employee tax identifier validation");
  }

  const summary = {
    employmentIncome: ZERO,
    incomeTaxDeducted: ZERO,
    cppContributionsEmployee: ZERO,
    cpp2ContributionsEmployee: ZERO,
    eiPremiumsEmployee: ZERO,
    pensionAdjustment: ZERO,
    employerCpp: ZERO,
    employerCpp2: ZERO,
    employerEi: ZERO,
  };

  const recordedRemittances = await prisma.remittancePayment.findMany({
    where: {
      remittance: { companyId },
      status: "RECORDED",
      paymentDate: {
        gte: taxYearRange.start,
        lt: taxYearRange.endExclusive,
      },
    },
    select: { amountPaid: true },
  });
  const summaryAddress = {
    line1: settings.addressLine1!,
    line2: settings.addressLine2,
    city: settings.city!,
    provinceCode: normalizeProvinceCode(settings.provinceCode, settings.countryCode ?? "CAN"),
    countryCode: normalizeCountryCode(settings.countryCode),
    postalCode: normalizePostalCode(settings.postalCode),
  };

  const summaryContact = {
    name: settings.contactName!,
    phoneAreaCode: contactPhone!.areaCode,
    phoneNumber: contactPhone!.phoneNumber,
    extension: settings.contactPhoneExtension,
    email: settings.contactEmail!,
  };

  const slipJobs: Array<{
    employeeId: bigint;
    data: T4SlipData;
    values: {
      employmentIncome: Prisma.Decimal;
      incomeTaxDeducted: Prisma.Decimal;
      cppContributionsEmployee: Prisma.Decimal;
      eiPremiumsEmployee: Prisma.Decimal;
      otherBoxPayload: Prisma.InputJsonValue;
    };
  }> = [];

  let browser: Browser | null = null;
  const unpublishedStoragePaths: string[] = [];

  try {
    for (const [employeeKey, employeeRows] of byEmployee) {
      const employee = employeeRows[0]?.employee;
      if (!employee) continue;

      const employmentIncome = roundMoney(
        employeeRows.reduce((sum, row) => sum.add(row.grossPay), ZERO)
      );
      const incomeTaxDeducted = roundMoney(
        employeeRows.reduce((sum, row) => sum.add(row.ded_income_tax), ZERO)
      );
      const cppContributionsEmployee = roundMoney(
        employeeRows.reduce((sum, row) => sum.add(row.ded_cpp), ZERO)
      );
      const eiPremiumsEmployee = roundMoney(
        employeeRows.reduce((sum, row) => sum.add(row.ded_ei), ZERO)
      );
      const cpp2ContributionsEmployee = ZERO;
      const employerCpp = roundMoney(cppContributionsEmployee);
      const employerCpp2 = ZERO;
      const employerEi = roundMoney(eiPremiumsEmployee.mul(1.4));
      const countryCode = normalizeCountryCode(employee.addrCountry);
      const provinceCode = normalizeProvinceCode(employee.addrProvince, countryCode) || "ON";
      const insurableAndPensionableEarnings =
        employee.employmentType === "CONTRACTOR" ? ZERO : employmentIncome;
      const dentalBenefitsCode = mapDentalBenefitsCoverageToCode(employee.dentalBenefitsCoverage);
      const pensionAdjustment = roundMoney(employee.pensionAdjustmentOverride ?? 0);

      summary.employmentIncome = summary.employmentIncome.add(employmentIncome);
      summary.incomeTaxDeducted = summary.incomeTaxDeducted.add(incomeTaxDeducted);
      summary.cppContributionsEmployee = summary.cppContributionsEmployee.add(cppContributionsEmployee);
      summary.cpp2ContributionsEmployee = summary.cpp2ContributionsEmployee.add(cpp2ContributionsEmployee);
      summary.eiPremiumsEmployee = summary.eiPremiumsEmployee.add(eiPremiumsEmployee);
      summary.pensionAdjustment = summary.pensionAdjustment.add(pensionAdjustment);
      summary.employerCpp = summary.employerCpp.add(employerCpp);
      summary.employerCpp2 = summary.employerCpp2.add(employerCpp2);
      summary.employerEi = summary.employerEi.add(employerEi);

      const otherBoxPayload = {
        provinceOfEmployment: provinceCode,
        dentalBenefitsCode,
        rppDpspRegistrationNumber: employee.rppDpspRegistrationNumber,
        pensionAdjustment: pensionAdjustment.toNumber(),
        eiInsurableEarnings: insurableAndPensionableEarnings.toNumber(),
        pensionableEarnings: insurableAndPensionableEarnings.toNumber(),
        employeeAddress: {
          line1: employee.addrLine1,
          line2: employee.addrLine2,
          city: employee.addrCity,
          provinceCode,
          postalCode: normalizePostalCode(employee.addrPostal),
          countryCode,
        },
      };

      const slipData: T4SlipData = {
        employee: {
          firstName: employee.firstName,
          lastName: employee.lastName,
          sin: resolvedSinByEmployee.get(employeeKey)!,
          address: {
            line1: employee.addrLine1,
            line2: employee.addrLine2,
            city: employee.addrCity,
            provinceCode,
            countryCode,
            postalCode: normalizePostalCode(employee.addrPostal),
          },
        },
        payrollAccountNumber: settings.payrollProgramAccount!,
        rppDpspRegistrationNumber: employee.rppDpspRegistrationNumber,
        reportTypeCode: "O",
        provinceOfEmployment: provinceCode,
        cppExemptCode: employee.employmentType === "CONTRACTOR" ? "1" : "0",
        eiExemptCode: employee.employmentType === "CONTRACTOR" ? "1" : "0",
        dentalBenefitsCode,
        employmentIncome: formatMoneyString(employmentIncome),
        cppContributions: formatMoneyString(cppContributionsEmployee),
        cpp2Contributions: formatMoneyString(cpp2ContributionsEmployee),
        eiPremiums: formatMoneyString(eiPremiumsEmployee),
        incomeTaxDeducted: formatMoneyString(incomeTaxDeducted),
        eiInsurableEarnings: formatMoneyString(insurableAndPensionableEarnings),
        pensionableEarnings: formatMoneyString(insurableAndPensionableEarnings),
        pensionAdjustment: pensionAdjustment.greaterThan(0)
          ? formatMoneyString(pensionAdjustment)
          : null,
      };

      slipJobs.push({
        employeeId: employee.id,
        data: slipData,
        values: {
          employmentIncome,
          incomeTaxDeducted,
          cppContributionsEmployee,
          eiPremiumsEmployee,
          otherBoxPayload,
        },
      });
    }

    const summaryData: T4SummaryData = {
      payrollAccountNumber: settings.payrollProgramAccount!,
      employerName: settings.legalName!,
      employerAddress: summaryAddress,
      contact: summaryContact,
      taxYear,
      slipCount: byEmployee.size,
      reportTypeCode: "O",
      totals: {
        employmentIncome: formatMoneyString(summary.employmentIncome),
        employeeCpp: formatMoneyString(summary.cppContributionsEmployee),
        employeeCpp2: formatMoneyString(summary.cpp2ContributionsEmployee),
        employeeEi: formatMoneyString(summary.eiPremiumsEmployee),
        rppContributions: formatMoneyString(0),
        incomeTaxDeducted: formatMoneyString(summary.incomeTaxDeducted),
        pensionAdjustment: formatMoneyString(summary.pensionAdjustment),
        employerCpp: formatMoneyString(summary.employerCpp),
        employerCpp2: formatMoneyString(summary.employerCpp2),
        employerEi: formatMoneyString(summary.employerEi),
      },
    };

    browser = await puppeteer.launch({ headless: true });
    const renderedSlips: Array<{ employeeId: bigint; pdf: Buffer }> = [];
    for (const job of slipJobs) {
      const slipHtml = renderEmployeeT4SlipHtml(job.data, taxYear, settings.legalName!);
      renderedSlips.push({
        employeeId: job.employeeId,
        pdf: await renderPdfBuffer(browser, slipHtml),
      });
    }

    const remittancesReported = sumRecordedPayments(recordedRemittances);
    const summaryHtml = renderEmployerT4SummaryHtml(
      summaryData,
      formatMoneyString(remittancesReported)
    );
    const summaryPdfBuffer = await renderPdfBuffer(browser, summaryHtml);

    const submissionXml = buildT4SubmissionXml({
      transmitterAccountNumber: settings.transmitterAccountNumber,
      transmitterRepId: settings.transmitterRepId,
      submissionReferenceId: generateSubmissionReferenceId(companyId, taxYear),
      summaryCount: 1,
      languageCode: (settings.submissionLanguageCode === "F" ? "F" : "E"),
      transmitterName: settings.legalName!,
      transmitterCountryCode: normalizeCountryCode(settings.countryCode),
      transmitterContact: summaryContact,
      slips: slipJobs.map((job) => job.data),
      summary: summaryData,
    });

    await browser.close();
    browser = null;

    // Use generation-unique names so a failed attempt can never overwrite a
    // previously published artifact. Files are published to the database only
    // after every PDF and the complete XML have been rendered successfully.
    const generationId = randomUUID();
    const slipStoragePaths = new Map<string, string>();
    for (const rendered of renderedSlips) {
      const storagePath = await writeGeneratedFile({
        companyId,
        fileName: `t4-slip-${taxYear}-${rendered.employeeId.toString()}-${generationId}.pdf`,
        contents: rendered.pdf,
      });
      unpublishedStoragePaths.push(storagePath);
      slipStoragePaths.set(rendered.employeeId.toString(), storagePath);
    }
    const summaryStoragePath = await writeGeneratedFile({
      companyId,
      fileName: `t4-summary-${taxYear}-${generationId}.pdf`,
      contents: summaryPdfBuffer,
    });
    unpublishedStoragePaths.push(summaryStoragePath);
    const xmlStoragePath = await writeGeneratedFile({
      companyId,
      fileName: `t4-return-${taxYear}-${generationId}.xml`,
      contents: submissionXml,
    });
    unpublishedStoragePaths.push(xmlStoragePath);
    await testHooks.afterArtifactsWritten?.();

    const generatedAt = new Date();
    const t4Summary = await prisma.$transaction(async (tx) => {
      const lockedPayrollRunIds = await lockCompanyComplianceScope(
        tx,
        companyId,
        sourceRows.map((row) => row.payrollRunId),
        { timeoutMs: testHooks.publicationLockTimeoutMs }
      );
      const currentSummary = await tx.t4Summary.findUnique({
        where: { companyId_taxYear: { companyId, taxYear } },
      });
      if (currentSummary?.status === T4GenerationStatus.FINALIZED) {
        throw new Error("FINALIZED_T4_SUMMARY_IS_IMMUTABLE");
      }

      const transactionRows = await tx.payHistory.findMany({
        where: {
          employee: { companyId },
          payDate: {
            gte: taxYearRange.start,
            lt: taxYearRange.endExclusive,
          },
        },
        select: {
          id: true,
          employeeId: true,
          payDate: true,
          updatedAt: true,
          grossPay: true,
          ded_cpp: true,
          ded_ei: true,
          ded_income_tax: true,
          payrollRunId: true,
          status: true,
          paidAt: true,
          paymentProvider: true,
          paymentRef: true,
          payrollRun: { select: COMPLIANCE_PAYROLL_RUN_SELECT },
        },
        orderBy: [{ employeeId: "asc" }, { payDate: "asc" }],
      });
      const transactionSelection = partitionCompliancePayrollRows(
        transactionRows,
        companyId,
        verificationCutoff
      );
      const transactionSourceSummary = {
        includedCount: transactionSelection.included.length,
        excludedCount: transactionSelection.excludedCount,
        reasonCounts: transactionSelection.reasonCounts,
        sourceFingerprint: createT4ComplianceSourceFingerprint(transactionSelection.included),
        sourceMembershipFingerprint:
          createComplianceSourceMembershipFingerprint(transactionRows),
      };
      if (
        transactionSelection.excludedCount > 0 ||
        !sameBigIntIds(
          transactionSelection.included.map((row) => row.id),
          rows.map((row) => row.id)
        ) ||
        transactionSourceSummary.includedCount !== sourceSummary.includedCount ||
        transactionSourceSummary.excludedCount !== sourceSummary.excludedCount ||
        JSON.stringify(transactionSourceSummary.reasonCounts) !==
          JSON.stringify(sourceSummary.reasonCounts) ||
        transactionSourceSummary.sourceFingerprint !== sourceSummary.sourceFingerprint ||
        transactionSourceSummary.sourceMembershipFingerprint !==
          sourceSummary.sourceMembershipFingerprint
      ) {
        throw new T4SourceEligibilityChangedError(transactionSourceSummary);
      }
      await testHooks.afterEligibilityRevalidated?.({
        payrollRunCount: lockedPayrollRunIds.length,
      });

      let persistedSummary;
      if (currentSummary) {
        const updated = await tx.t4Summary.updateMany({
          where: {
            id: currentSummary.id,
            status: { not: T4GenerationStatus.FINALIZED },
          },
          data: {
            employeeCount: slipJobs.length,
            totalEmploymentIncome: roundMoney(summary.employmentIncome),
            totalIncomeTaxDeducted: roundMoney(summary.incomeTaxDeducted),
            totalCppEmployee: roundMoney(summary.cppContributionsEmployee),
            totalEiEmployee: roundMoney(summary.eiPremiumsEmployee),
            status: T4GenerationStatus.GENERATED,
            generatedAt,
            generationId,
            generationVersion: T4_GENERATION_VERSION,
            validationSummary: sourceSummary,
            validatedAt: generatedAt,
          },
        });
        if (updated.count !== 1) {
          throw new Error("T4_SUMMARY_CHANGED_CONCURRENTLY");
        }
        persistedSummary = await tx.t4Summary.findUniqueOrThrow({
          where: { id: currentSummary.id },
        });
      } else {
        persistedSummary = await tx.t4Summary.create({
          data: {
            companyId,
            taxYear,
            employeeCount: slipJobs.length,
            totalEmploymentIncome: roundMoney(summary.employmentIncome),
            totalIncomeTaxDeducted: roundMoney(summary.incomeTaxDeducted),
            totalCppEmployee: roundMoney(summary.cppContributionsEmployee),
            totalEiEmployee: roundMoney(summary.eiPremiumsEmployee),
            status: T4GenerationStatus.GENERATED,
            generatedAt,
            generationId,
            generationVersion: T4_GENERATION_VERSION,
            validationSummary: sourceSummary,
            validatedAt: generatedAt,
          },
        });
      }

      const finalizedSlipCount = await tx.t4Slip.count({
        where: { companyId, taxYear, status: T4GenerationStatus.FINALIZED },
      });
      if (finalizedSlipCount > 0) {
        throw new Error("FINALIZED_T4_SLIP_IS_IMMUTABLE");
      }

      const currentEmployeeIds = slipJobs.map((job) => job.employeeId);
      const staleSlips = await tx.t4Slip.findMany({
        where: {
          companyId,
          taxYear,
          employeeId: { notIn: currentEmployeeIds },
          status: { not: T4GenerationStatus.FINALIZED },
        },
        select: { id: true },
      });
      if (staleSlips.length > 0) {
        const staleSlipIds = staleSlips.map((slip) => slip.id);
        await tx.document.updateMany({
          where: { t4SlipId: { in: staleSlipIds }, validationStatus: "ACTIVE" },
          data: {
            validationStatus: "QUARANTINED",
            validationReason: "NOT_PRESENT_IN_CURRENT_GENERATION",
            quarantinedAt: generatedAt,
          },
        });
        await tx.t4Slip.updateMany({
          where: { id: { in: staleSlipIds } },
          data: { status: T4GenerationStatus.QUARANTINED, validatedAt: generatedAt },
        });
      }

      for (const job of slipJobs) {
        const currentSlip = await tx.t4Slip.findUnique({
          where: {
            companyId_employeeId_taxYear: { companyId, employeeId: job.employeeId, taxYear },
          },
        });
        if (currentSlip?.status === T4GenerationStatus.FINALIZED) {
          throw new Error("FINALIZED_T4_SLIP_IS_IMMUTABLE");
        }

        let slip;
        if (currentSlip) {
          const updated = await tx.t4Slip.updateMany({
            where: { id: currentSlip.id, status: { not: T4GenerationStatus.FINALIZED } },
            data: {
              status: T4GenerationStatus.GENERATED,
              ...job.values,
              generatedAt,
              summaryId: persistedSummary.id,
              generationId,
              generationVersion: T4_GENERATION_VERSION,
              validatedAt: generatedAt,
            },
          });
          if (updated.count !== 1) throw new Error("T4_SLIP_CHANGED_CONCURRENTLY");
          slip = await tx.t4Slip.findUniqueOrThrow({ where: { id: currentSlip.id } });
        } else {
          slip = await tx.t4Slip.create({
            data: {
              companyId,
              employeeId: job.employeeId,
              taxYear,
              status: T4GenerationStatus.GENERATED,
              ...job.values,
              generatedAt,
              summaryId: persistedSummary.id,
              generationId,
              generationVersion: T4_GENERATION_VERSION,
              validatedAt: generatedAt,
            },
          });
        }

        await tx.document.updateMany({
          where: {
            t4SlipId: slip.id,
            documentType: "T4_SLIP",
            validationStatus: "ACTIVE",
          },
          data: {
            validationStatus: "QUARANTINED",
            validationReason: "SUPERSEDED_BY_NEW_GENERATION",
            quarantinedAt: generatedAt,
          },
        });
        const storagePath = slipStoragePaths.get(job.employeeId.toString())!;
        await tx.document.create({
          data: {
            companyId,
            documentType: "T4_SLIP",
            fileName: path.basename(storagePath),
            storagePath,
            mimeType: "application/pdf",
            linkedEntityType: "T4_SLIP",
            linkedEntityId: slip.id,
            taxYear,
            t4SlipId: slip.id,
            validationStatus: "ACTIVE",
            generationId,
            generationVersion: T4_GENERATION_VERSION,
          },
        });
      }

      await tx.document.updateMany({
        where: {
          t4SummaryId: persistedSummary.id,
          validationStatus: "ACTIVE",
          OR: [{ documentType: "T4_SUMMARY" }, { mimeType: "application/xml" }],
        },
        data: {
          validationStatus: "QUARANTINED",
          validationReason: "SUPERSEDED_BY_NEW_GENERATION",
          quarantinedAt: generatedAt,
        },
      });
      await tx.document.createMany({
        data: [
          {
            companyId,
            documentType: "T4_SUMMARY",
            fileName: path.basename(summaryStoragePath),
            storagePath: summaryStoragePath,
            mimeType: "application/pdf",
            linkedEntityType: "T4_SUMMARY",
            linkedEntityId: persistedSummary.id,
            taxYear,
            t4SummaryId: persistedSummary.id,
            validationStatus: "ACTIVE",
            generationId,
            generationVersion: T4_GENERATION_VERSION,
          },
          {
            companyId,
            documentType: "OTHER",
            fileName: path.basename(xmlStoragePath),
            storagePath: xmlStoragePath,
            mimeType: "application/xml",
            linkedEntityType: "T4_SUMMARY",
            linkedEntityId: persistedSummary.id,
            taxYear,
            t4SummaryId: persistedSummary.id,
            validationStatus: "ACTIVE",
            generationId,
            generationVersion: T4_GENERATION_VERSION,
          },
        ],
      });
      await tx.auditLog.create({
        data: {
          companyId,
          actorType: "SYSTEM",
          action: "T4_PACKAGE_GENERATED",
          targetType: "T4Summary",
          targetId: persistedSummary.id.toString(),
          metadataJson: {
            taxYear,
            employeeCount: slipJobs.length,
            generationId,
            generationVersion: T4_GENERATION_VERSION,
            ...sourceSummary,
          },
        },
      });
      await testHooks.beforeTransactionCommit?.();
      return persistedSummary;
    }, {
      // The shared advisory lock must be followed by a fresh statement snapshot so a
      // reversal that committed while this transaction waited is visible here.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });

    unpublishedStoragePaths.length = 0;
    return t4Summary;
  } catch (error) {
    await Promise.all(
      unpublishedStoragePaths.map((storagePath) =>
        fs.unlink(path.join(process.cwd(), storagePath)).catch(() => undefined)
      )
    );
    if (error instanceof T4SourceEligibilityChangedError) {
      await quarantineT4GenerationFailure({
        companyId,
        taxYear,
        reasonCode: "T4_SOURCE_ELIGIBILITY_CHANGED_DURING_PUBLICATION",
        metadata: error.sourceSummary,
      }).catch(() => undefined);
    } else {
      await logAudit({
        companyId,
        action: "T4_PACKAGE_GENERATION_FAILED",
        targetType: "Company",
        targetId: companyId.toString(),
        metadata: {
          taxYear,
          reasonCode: error instanceof CompliancePublicationLockTimeoutError
            ? error.code
            : "ARTIFACT_GENERATION_FAILED",
          retryable: error instanceof CompliancePublicationLockTimeoutError,
          ...sourceSummary,
        },
      }).catch(() => undefined);
    }
    throw new Error("T4 package generation failed");
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function getCraDashboard(companyId: bigint) {
  const [
    settings,
    remittances,
    t4Summaries,
    documents,
    auditLogs,
    providerVerification,
    blockedScope,
  ] = await Promise.all([
    prisma.companyPayrollSettings.findUnique({ where: { companyId } }),
    prisma.remittance.findMany({
      where: { companyId },
      include: {
        payments: {
          where: { status: "RECORDED" },
          orderBy: { paymentDate: "desc" },
          take: 1,
        },
        reminders: {
          orderBy: { scheduledFor: "asc" },
          where: {
            sentAt: null,
          },
          take: 4,
        },
      },
      orderBy: [{ dueDate: "asc" }],
    }),
    prisma.t4Summary.findMany({
      where: { companyId },
      orderBy: [{ taxYear: "desc" }],
      include: {
        slips: true,
      },
    }),
    prisma.document.findMany({
      where: { companyId, validationStatus: "ACTIVE" },
      orderBy: { uploadedAt: "desc" },
      take: 100,
    }),
    prisma.auditLog.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    getCompanyProviderVerificationFreshness(companyId),
    getProviderVerificationBlockedScope(companyId),
  ]);

  const effectiveRemittances = remittances.map((remittance) =>
    blockedScope.remittanceIds.has(remittance.id)
      ? { ...remittance, status: RemittanceStatus.REVIEW_REQUIRED }
      : remittance
  );

  const nextDue = effectiveRemittances.find((item) =>
    item.status !== RemittanceStatus.PAID && item.status !== RemittanceStatus.REVIEW_REQUIRED
  ) ?? null;
  const overdueCount = effectiveRemittances.filter(
    (item) => item.status === RemittanceStatus.OVERDUE
  ).length;
  const outstandingTotal = effectiveRemittances
    .filter((item) =>
      item.status !== RemittanceStatus.PAID && item.status !== RemittanceStatus.REVIEW_REQUIRED
    )
    .reduce((sum, item) => sum.add(item.totalPayable), ZERO);

  return {
    settings,
    remittances: effectiveRemittances,
    t4Summaries,
    documents: selectDashboardDocuments(
      documents.filter((document) => !blockedScope.documentIds.has(document.id))
    ).slice(0, 12),
    providerVerification: {
      eligiblePaidRunCount: providerVerification.eligiblePaidRunCount,
      successfullyVerifiedWithinSlaCount:
        providerVerification.successfullyVerifiedWithinSlaCount,
      neverSuccessfullyVerifiedCount:
        providerVerification.neverSuccessfullyVerifiedCount,
      staleVerificationCount: providerVerification.staleVerificationCount,
      evidenceVersionMismatchCount: providerVerification.evidenceVersionMismatchCount,
      unresolvedFailureCount: providerVerification.unresolvedFailureCount,
      unverifiedStatusCount: providerVerification.unverifiedStatusCount,
      providerReferenceMissingCount: providerVerification.providerReferenceMissingCount,
      legacyUnverifiedCount: providerVerification.legacyUnverifiedCount,
      unverifiedReasonCounts: providerVerification.unverifiedReasonCounts,
      reviewRequired:
        providerVerification.neverSuccessfullyVerifiedCount > 0 ||
        providerVerification.staleVerificationCount > 0 ||
        providerVerification.evidenceVersionMismatchCount > 0 ||
        providerVerification.unverifiedStatusCount > 0 ||
        providerVerification.providerReferenceMissingCount > 0,
      blockedDocumentCount: blockedScope.documentIds.size,
    },
    auditLogs: selectDashboardAuditLogs(auditLogs).slice(0, 12),
    nextDue,
    overdueCount,
    outstandingTotal: roundMoney(outstandingTotal),
  };
}
