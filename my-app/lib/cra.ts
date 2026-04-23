import { promises as fs } from "fs";
import path from "path";
import puppeteer from "puppeteer";
import type { Browser } from "puppeteer";
import { Prisma, RemittanceStatus, RemitterType, ReminderState, T4GenerationStatus } from "@prisma/client";
import {
  buildT4SubmissionXml,
  renderEmployeeT4SlipHtml,
  renderEmployerT4SummaryHtml,
  type T4SlipData,
  type T4SummaryData,
} from "@/lib/t4-filing";
import { prisma } from "@/lib/prisma";

const CPP_RATE = 0.0595;
const EI_RATE = 0.0166;

const GENERATED_DIR = path.join(process.cwd(), "generated", "cra");

const ZERO = new Prisma.Decimal(0);

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

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
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
  return value.toISOString().slice(0, 10);
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
  }>
) {
  const dashboardActions = new Set([
    "REMITTANCE_MARKED_PAID",
    "T4_PACKAGE_GENERATED",
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
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return { start, end };
}

function getQuarterRange(year: number, quarterIndex: number) {
  const startMonth = quarterIndex * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  return { start, end };
}

function getQuarterLabel(date: Date) {
  return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
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
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const relativePath = path.join("generated", "cra", `${params.companyId.toString()}-${params.fileName}`);
  const absolutePath = path.join(process.cwd(), relativePath);
  await fs.writeFile(absolutePath, params.contents);
  return relativePath;
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

  const updated = await prisma.companyPayrollSettings.update({
    where: { companyId },
    data: {
      legalName: normalizeOptionalText(input.legalName),
      businessNumber: normalizeOptionalText(input.businessNumber),
      payrollProgramAccount: normalizeUpperText(input.payrollProgramAccount),
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
      transmitterAccountNumber: normalizeUpperText(input.transmitterAccountNumber),
      transmitterRepId: normalizeUpperText(input.transmitterRepId),
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
  const end = startOfDay(periodEnd);

  if (remitterType === "QUARTERLY") {
    return new Date(end.getFullYear(), end.getMonth() + 1, 15);
  }

  if (remitterType === "ACCELERATED_THRESHOLD_1" || remitterType === "ACCELERATED_THRESHOLD_2") {
    // MVP structure-ready fallback. Real accelerated rules should replace this later.
    return new Date(end.getFullYear(), end.getMonth() + 1, 15);
  }

  return new Date(end.getFullYear(), end.getMonth() + 1, 15);
}

function deriveRemittanceStatus(
  dueDate: Date,
  totalPayable: Prisma.Decimal | number | string,
  totalPaid: Prisma.Decimal | number | string
) {
  const payable = decimal(totalPayable);
  const paid = decimal(totalPaid);

  if (paid.greaterThanOrEqualTo(payable) && payable.greaterThan(0)) {
    return RemittanceStatus.PAID;
  }

  if (paid.greaterThan(0)) {
    return RemittanceStatus.PARTIALLY_PAID;
  }

  const today = startOfDay(new Date());
  if (startOfDay(dueDate) < today) return RemittanceStatus.OVERDUE;
  return RemittanceStatus.DUE;
}

export function getReminderState(remittance: { dueDate: Date; status: RemittanceStatus }) {
  if (remittance.status === RemittanceStatus.PAID) {
    return ReminderState.PAID_NO_REMINDER;
  }

  const today = startOfDay(new Date());
  const dueDate = startOfDay(remittance.dueDate);
  if (dueDate.getTime() === today.getTime()) return ReminderState.DUE_TODAY;
  if (dueDate < today) return ReminderState.OVERDUE;
  return ReminderState.UPCOMING;
}

type RemittanceSourceRow = {
  id: bigint;
  employeeId: bigint;
  payDate: Date;
  ded_income_tax: Prisma.Decimal;
  ded_cpp: Prisma.Decimal;
  ded_ei: Prisma.Decimal;
};

function buildPeriods(rows: RemittanceSourceRow[], remitterType: RemitterType) {
  const groups = new Map<string, { label: string; start: Date; end: Date; rows: RemittanceSourceRow[] }>();

  for (const row of rows) {
    const date = row.payDate;
    const year = date.getFullYear();

    let key: string;
    let label: string;
    let range: { start: Date; end: Date };

    if (remitterType === "QUARTERLY") {
      const quarterIndex = Math.floor(date.getMonth() / 3);
      range = getQuarterRange(year, quarterIndex);
      label = getQuarterLabel(date);
      key = `${year}-Q${quarterIndex + 1}`;
    } else {
      range = getMonthRange(year, date.getMonth());
      label = `${date.toLocaleString("en-CA", { month: "long" })} ${year}`;
      key = `${year}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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

export async function syncRemittancesForCompany(companyId: bigint) {
  const settings = await getOrCreateCompanyPayrollSettings(companyId);
  const payHistory = await prisma.payHistory.findMany({
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
    },
    orderBy: { payDate: "asc" },
  });

  const periods = buildPeriods(payHistory, settings.remitterType);
  let browser: Browser | null = null;

  try {
    for (const period of periods) {
      const incomeTax = period.rows.reduce((sum, row) => sum.add(row.ded_income_tax), ZERO);
      const cppEmployee = period.rows.reduce((sum, row) => sum.add(row.ded_cpp), ZERO);
      const eiEmployee = period.rows.reduce((sum, row) => sum.add(row.ded_ei), ZERO);
      const cppEmployer = roundMoney(cppEmployee.mul(CPP_RATE).div(CPP_RATE));
      const eiEmployer = roundMoney(eiEmployee.mul(EI_RATE * 1.4).div(EI_RATE));
      const totalPayable = roundMoney(addMoney(incomeTax, cppEmployee, cppEmployer, eiEmployee, eiEmployer));

      const employeeCount = new Set(period.rows.map((row) => row.employeeId.toString())).size;
      const dueDate = calculateRemittanceDueDate(settings.remitterType, period.end);

      const remittance = await prisma.remittance.upsert({
        where: {
          companyId_periodStart_periodEnd: {
            companyId,
            periodStart: period.start,
            periodEnd: period.end,
          },
        },
        update: {
          remitterTypeSnapshot: settings.remitterType,
          dueDate,
          employeeCount,
          totalIncomeTax: roundMoney(incomeTax),
          totalCppEmployee: roundMoney(cppEmployee),
          totalCppEmployer: roundMoney(cppEmployer),
          totalEiEmployee: roundMoney(eiEmployee),
          totalEiEmployer: roundMoney(eiEmployer),
          totalPayable,
        },
        create: {
          companyId,
          periodStart: period.start,
          periodEnd: period.end,
          remitterTypeSnapshot: settings.remitterType,
          dueDate,
          employeeCount,
          totalIncomeTax: roundMoney(incomeTax),
          totalCppEmployee: roundMoney(cppEmployee),
          totalCppEmployer: roundMoney(cppEmployer),
          totalEiEmployee: roundMoney(eiEmployee),
          totalEiEmployer: roundMoney(eiEmployer),
          totalPayable,
        },
      });

      const recordedPayments = await prisma.remittancePayment.findMany({
        where: {
          remittanceId: remittance.id,
          status: "RECORDED",
        },
        orderBy: { paymentDate: "desc" },
      });

      const totalPaid = sumRecordedPayments(recordedPayments);
      const paidInFull = totalPaid.greaterThanOrEqualTo(totalPayable) && totalPayable.greaterThan(0);

      await prisma.remittance.update({
        where: { id: remittance.id },
        data: {
          paidAt: paidInFull ? recordedPayments[0]?.paymentDate ?? null : null,
          status: deriveRemittanceStatus(dueDate, totalPayable, totalPaid),
        },
      });

      await prisma.remittancePayHistory.deleteMany({
        where: { remittanceId: remittance.id },
      });

      if (period.rows.length > 0) {
        await prisma.remittancePayHistory.createMany({
          data: period.rows.map((row) => ({
            remittanceId: remittance.id,
            payHistoryId: row.id,
          })),
          skipDuplicates: true,
        });
      }

      const reportPayload = {
        label: period.label,
        periodStart: fmtDate(period.start),
        periodEnd: fmtDate(period.end),
        dueDate: fmtDate(dueDate),
        employeeCount,
        totals: {
          incomeTax: roundMoney(incomeTax).toNumber(),
          cppEmployee: roundMoney(cppEmployee).toNumber(),
          cppEmployer: roundMoney(cppEmployer).toNumber(),
          eiEmployee: roundMoney(eiEmployee).toNumber(),
          eiEmployer: roundMoney(eiEmployer).toNumber(),
          totalPayable: totalPayable.toNumber(),
        },
      };

      if (!browser) {
        browser = await puppeteer.launch({ headless: true });
      }

      const reportPdfBuffer = await renderPdfBuffer(browser, renderRemittanceReportHtml(reportPayload));
      const storagePath = await writeGeneratedFile({
        companyId,
        fileName: `remittance-${fmtDate(period.start)}-${fmtDate(period.end)}.pdf`,
        contents: reportPdfBuffer,
      });

      await prisma.document.deleteMany({
        where: {
          remittanceId: remittance.id,
          documentType: "REMITTANCE_REPORT",
        },
      });

      await prisma.document.create({
        data: {
          companyId,
          documentType: "REMITTANCE_REPORT",
          fileName: path.basename(storagePath),
          storagePath,
          mimeType: "application/pdf",
          linkedEntityType: "REMITTANCE",
          linkedEntityId: remittance.id,
          remittanceId: remittance.id,
        },
      });

      await syncReminderEvents(companyId, remittance.id, dueDate, settings.preDueReminderDays);
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

async function syncReminderEvents(
  companyId: bigint,
  remittanceId: bigint,
  dueDate: Date,
  preDueReminderDays: number
) {
  await prisma.reminderEvent.deleteMany({
    where: { remittanceId },
  });

  const reminderDates = [
    Math.max(preDueReminderDays, 1),
    3,
    1,
  ]
    .filter((days, index, list) => days > 0 && list.indexOf(days) === index)
    .map((days) => new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() - days));

  const overdueDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() + 1);

  const data = [
    ...reminderDates.map((scheduledFor) => ({
      companyId,
      remittanceId,
      reminderState: ReminderState.UPCOMING,
      scheduledFor,
    })),
    {
      companyId,
      remittanceId,
      reminderState: ReminderState.DUE_TODAY,
      scheduledFor: dueDate,
    },
    {
      companyId,
      remittanceId,
      reminderState: ReminderState.OVERDUE,
      scheduledFor: overdueDate,
    },
  ];

  await prisma.reminderEvent.createMany({ data });
}

export async function recordRemittancePayment(params: {
  companyId: bigint;
  remittanceId: bigint;
  paymentDate: Date;
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

  const normalizedPaymentDate = startOfDay(params.paymentDate);
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

export async function generateT4Package(companyId: bigint, taxYear: number) {
  const settings = await getOrCreateCompanyPayrollSettings(companyId);
  const rows = await prisma.payHistory.findMany({
    where: {
      employee: {
        companyId,
      },
      payDate: {
        gte: new Date(taxYear, 0, 1),
        lt: new Date(taxYear + 1, 0, 1),
      },
    },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
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
    },
    orderBy: [{ employeeId: "asc" }, { payDate: "asc" }],
  });

  const contactPhone = splitPhoneNumber(settings.contactPhone);
  const missingSettings = getMissingT4SettingsFromSettings(settings);

  if (missingSettings.length > 0) {
    throw new Error(`CRA T4 filing settings incomplete: ${missingSettings.join(", ")}`);
  }

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
        gte: new Date(taxYear, 0, 1),
        lt: new Date(taxYear + 1, 0, 1),
      },
    },
    select: { amountPaid: true },
  });

  let t4Summary = await prisma.t4Summary.upsert({
    where: {
      companyId_taxYear: {
        companyId,
        taxYear,
      },
    },
    update: {
      status: T4GenerationStatus.GENERATED,
      generatedAt: new Date(),
    },
    create: {
      companyId,
      taxYear,
      status: T4GenerationStatus.GENERATED,
      generatedAt: new Date(),
    },
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

  const slipPdfJobs: Array<{
    slipId: bigint;
    employeeId: bigint;
    data: T4SlipData;
  }> = [];

  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({ headless: true });

    for (const employeeRows of byEmployee.values()) {
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

      const slip = await prisma.t4Slip.upsert({
        where: {
          companyId_employeeId_taxYear: {
            companyId,
            employeeId: employee.id,
            taxYear,
          },
        },
        update: {
          status: T4GenerationStatus.GENERATED,
          employmentIncome,
          incomeTaxDeducted,
          cppContributionsEmployee,
          eiPremiumsEmployee,
          otherBoxPayload,
          generatedAt: new Date(),
          summaryId: t4Summary.id,
        },
        create: {
          companyId,
          employeeId: employee.id,
          taxYear,
          status: T4GenerationStatus.GENERATED,
          employmentIncome,
          incomeTaxDeducted,
          cppContributionsEmployee,
          eiPremiumsEmployee,
          otherBoxPayload,
          generatedAt: new Date(),
          summaryId: t4Summary.id,
        },
      });

      const slipData: T4SlipData = {
        employee: {
          firstName: employee.firstName,
          lastName: employee.lastName,
          sin: employee.sin,
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

      slipPdfJobs.push({
        slipId: slip.id,
        employeeId: employee.id,
        data: slipData,
      });
    }

    t4Summary = await prisma.t4Summary.update({
      where: { id: t4Summary.id },
      data: {
        employeeCount: byEmployee.size,
        totalEmploymentIncome: roundMoney(summary.employmentIncome),
        totalIncomeTaxDeducted: roundMoney(summary.incomeTaxDeducted),
        totalCppEmployee: roundMoney(summary.cppContributionsEmployee),
        totalEiEmployee: roundMoney(summary.eiPremiumsEmployee),
        status: T4GenerationStatus.GENERATED,
        generatedAt: new Date(),
      },
    });

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

    for (const job of slipPdfJobs) {
      const slipHtml = renderEmployeeT4SlipHtml(job.data, taxYear, settings.legalName!);
      const slipPdfBuffer = await renderPdfBuffer(browser, slipHtml);
      const slipStoragePath = await writeGeneratedFile({
        companyId,
        fileName: `t4-slip-${taxYear}-${job.employeeId.toString()}.pdf`,
        contents: slipPdfBuffer,
      });

      await prisma.document.deleteMany({
        where: {
          t4SlipId: job.slipId,
          documentType: "T4_SLIP",
        },
      });

      await prisma.document.create({
        data: {
          companyId,
          documentType: "T4_SLIP",
          fileName: path.basename(slipStoragePath),
          storagePath: slipStoragePath,
          mimeType: "application/pdf",
          linkedEntityType: "T4_SLIP",
          linkedEntityId: job.slipId,
          taxYear,
          t4SlipId: job.slipId,
        },
      });
    }

    const remittancesReported = sumRecordedPayments(recordedRemittances);
    const summaryHtml = renderEmployerT4SummaryHtml(
      summaryData,
      formatMoneyString(remittancesReported)
    );
    const summaryPdfBuffer = await renderPdfBuffer(browser, summaryHtml);
    const summaryStoragePath = await writeGeneratedFile({
      companyId,
      fileName: `t4-summary-${taxYear}.pdf`,
      contents: summaryPdfBuffer,
    });

    await prisma.document.deleteMany({
      where: {
        t4SummaryId: t4Summary.id,
        documentType: "T4_SUMMARY",
      },
    });

    await prisma.document.create({
      data: {
        companyId,
        documentType: "T4_SUMMARY",
        fileName: path.basename(summaryStoragePath),
        storagePath: summaryStoragePath,
        mimeType: "application/pdf",
        linkedEntityType: "T4_SUMMARY",
        linkedEntityId: t4Summary.id,
        taxYear,
        t4SummaryId: t4Summary.id,
      },
    });

    const submissionXml = buildT4SubmissionXml({
      transmitterAccountNumber: settings.transmitterAccountNumber,
      transmitterRepId: settings.transmitterRepId,
      submissionReferenceId: generateSubmissionReferenceId(companyId, taxYear),
      summaryCount: 1,
      languageCode: (settings.submissionLanguageCode === "F" ? "F" : "E"),
      transmitterName: settings.legalName!,
      transmitterCountryCode: normalizeCountryCode(settings.countryCode),
      transmitterContact: summaryContact,
      slips: slipPdfJobs.map((job) => job.data),
      summary: summaryData,
    });

    const xmlStoragePath = await writeGeneratedFile({
      companyId,
      fileName: `t4-return-${taxYear}.xml`,
      contents: submissionXml,
    });

    await prisma.document.deleteMany({
      where: {
        t4SummaryId: t4Summary.id,
        documentType: "OTHER",
        fileName: path.basename(xmlStoragePath),
      },
    });

    await prisma.document.create({
      data: {
        companyId,
        documentType: "OTHER",
        fileName: path.basename(xmlStoragePath),
        storagePath: xmlStoragePath,
        mimeType: "application/xml",
        linkedEntityType: "T4_SUMMARY",
        linkedEntityId: t4Summary.id,
        taxYear,
        t4SummaryId: t4Summary.id,
      },
    });

    await logAudit({
      companyId,
      action: "T4_PACKAGE_GENERATED",
      targetType: "T4Summary",
      targetId: t4Summary.id.toString(),
      metadata: { taxYear, employeeCount: byEmployee.size, xmlStoragePath },
    });

    return t4Summary;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function getCraDashboard(companyId: bigint) {
  await getOrCreateCompanyPayrollSettings(companyId);
  await syncRemittancesForCompany(companyId);

  const [settings, remittances, t4Summaries, documents, auditLogs] = await Promise.all([
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
      where: { companyId },
      orderBy: { uploadedAt: "desc" },
      take: 100,
    }),
    prisma.auditLog.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const nextDue = remittances.find((item) => item.status !== RemittanceStatus.PAID) ?? null;
  const overdueCount = remittances.filter((item) => item.status === RemittanceStatus.OVERDUE).length;
  const outstandingTotal = remittances
    .filter((item) => item.status !== RemittanceStatus.PAID)
    .reduce((sum, item) => sum.add(item.totalPayable), ZERO);

  return {
    settings,
    remittances,
    t4Summaries,
    documents: selectDashboardDocuments(documents).slice(0, 12),
    auditLogs: selectDashboardAuditLogs(auditLogs).slice(0, 12),
    nextDue,
    overdueCount,
    outstandingTotal: roundMoney(outstandingTotal),
  };
}
