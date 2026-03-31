import { promises as fs } from "fs";
import path from "path";
import { Prisma, RemittanceStatus, RemitterType, ReminderState, T4GenerationStatus } from "@prisma/client";
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

function fmtDate(value: Date) {
  return value.toISOString().slice(0, 10);
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
    remitterType?: RemitterType;
    contactEmail?: string | null;
    preDueReminderDays?: number;
    postDueReminderFrequencyDays?: number;
  }
) {
  await getOrCreateCompanyPayrollSettings(companyId);

  const updated = await prisma.companyPayrollSettings.update({
    where: { companyId },
    data: {
      legalName: input.legalName?.trim() || null,
      businessNumber: input.businessNumber?.trim() || null,
      payrollProgramAccount: input.payrollProgramAccount?.trim() || null,
      remitterType: input.remitterType ?? undefined,
      contactEmail: input.contactEmail?.trim() || null,
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

function deriveRemittanceStatus(dueDate: Date, paidAt: Date | null) {
  if (paidAt) return RemittanceStatus.PAID;
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

async function writeCraDocument(params: {
  companyId: bigint;
  fileName: string;
  payload: unknown;
}) {
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const relativePath = path.join("generated", "cra", `${params.companyId.toString()}-${params.fileName}`);
  const absolutePath = path.join(process.cwd(), relativePath);
  await fs.writeFile(absolutePath, JSON.stringify(params.payload, null, 2), "utf8");
  return relativePath;
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

    const activePayment = await prisma.remittancePayment.findFirst({
      where: {
        remittanceId: remittance.id,
        status: "RECORDED",
      },
      orderBy: { paymentDate: "desc" },
    });

    await prisma.remittance.update({
      where: { id: remittance.id },
      data: {
        paidAt: activePayment?.paymentDate ?? null,
        status: deriveRemittanceStatus(dueDate, activePayment?.paymentDate ?? null),
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

    const storagePath = await writeCraDocument({
      companyId,
      fileName: `remittance-${fmtDate(period.start)}-${fmtDate(period.end)}.json`,
      payload: reportPayload,
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

  const payment = await prisma.remittancePayment.create({
    data: {
      remittanceId: remittance.id,
      paymentDate: params.paymentDate,
      amountPaid: roundMoney(params.amountPaid),
      paymentMethod: params.paymentMethod?.trim() || null,
      referenceNumber: params.referenceNumber?.trim() || null,
      notes: params.notes?.trim() || null,
    },
  });

  await prisma.remittance.update({
    where: { id: remittance.id },
    data: {
      paidAt: params.paymentDate,
      status: RemittanceStatus.PAID,
      notes: params.notes?.trim() || remittance.notes,
    },
  });

  await logAudit({
    companyId: params.companyId,
    action: "REMITTANCE_MARKED_PAID",
    targetType: "Remittance",
    targetId: remittance.id.toString(),
    metadata: {
      paymentId: payment.id.toString(),
      amountPaid: params.amountPaid,
      paymentDate: params.paymentDate.toISOString(),
    },
  });

  return payment;
}

export async function generateT4Package(companyId: bigint, taxYear: number) {
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
        },
      },
    },
    orderBy: [{ employeeId: "asc" }, { payDate: "asc" }],
  });

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
    eiPremiumsEmployee: ZERO,
  };

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

    summary.employmentIncome = summary.employmentIncome.add(employmentIncome);
    summary.incomeTaxDeducted = summary.incomeTaxDeducted.add(incomeTaxDeducted);
    summary.cppContributionsEmployee = summary.cppContributionsEmployee.add(cppContributionsEmployee);
    summary.eiPremiumsEmployee = summary.eiPremiumsEmployee.add(eiPremiumsEmployee);

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
        generatedAt: new Date(),
        summaryId: t4Summary.id,
      },
    });

    const slipPayload = {
      taxYear,
      employee: {
        id: employee.id.toString(),
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
      },
      boxes: {
        employmentIncome: employmentIncome.toNumber(),
        incomeTaxDeducted: incomeTaxDeducted.toNumber(),
        cppContributionsEmployee: cppContributionsEmployee.toNumber(),
        eiPremiumsEmployee: eiPremiumsEmployee.toNumber(),
      },
    };

    const slipStoragePath = await writeCraDocument({
      companyId,
      fileName: `t4-slip-${taxYear}-${employee.id.toString()}.json`,
      payload: slipPayload,
    });

    await prisma.document.create({
      data: {
        companyId,
        documentType: "T4_SLIP",
        fileName: path.basename(slipStoragePath),
        storagePath: slipStoragePath,
        linkedEntityType: "T4_SLIP",
        linkedEntityId: slip.id,
        taxYear,
        t4SlipId: slip.id,
      },
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

  const summaryPayload = {
    taxYear,
    employeeCount: byEmployee.size,
    totals: {
      employmentIncome: roundMoney(summary.employmentIncome).toNumber(),
      incomeTaxDeducted: roundMoney(summary.incomeTaxDeducted).toNumber(),
      cppEmployee: roundMoney(summary.cppContributionsEmployee).toNumber(),
      eiEmployee: roundMoney(summary.eiPremiumsEmployee).toNumber(),
    },
  };

  const summaryStoragePath = await writeCraDocument({
    companyId,
    fileName: `t4-summary-${taxYear}.json`,
    payload: summaryPayload,
  });

  await prisma.document.create({
    data: {
      companyId,
      documentType: "T4_SUMMARY",
      fileName: path.basename(summaryStoragePath),
      storagePath: summaryStoragePath,
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
    metadata: { taxYear, employeeCount: byEmployee.size },
  });

  return t4Summary;
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
      take: 20,
    }),
    prisma.auditLog.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 20,
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
    documents,
    auditLogs,
    nextDue,
    overdueCount,
    outstandingTotal: roundMoney(outstandingTotal),
  };
}
