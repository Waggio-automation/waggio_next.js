import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculatePayrollAmounts } from "@/lib/payroll/calculatePayroll";
import { CPP, EI } from "@/lib/payroll/cra-constants-2026";
import { z } from "zod";
import { requirePayrollApiAuth } from "@/lib/payroll-api-auth";
import { utcDateOnlySchema } from "@/lib/validation/date-only";

const itemSchema = z.object({
  employeeId: z.string().regex(/^\d+$/),       // stringified BIGINT
  hoursWorked: z.number().nullable(),  // null for SALARY
  overtime: z.number().default(0),
  holidayHours: z.number().default(0),
  includeVacation: z.boolean().default(true),
});

const payloadSchema = z.object({
  periodStart: utcDateOnlySchema,
  periodEnd: utcDateOnlySchema,
  payDate: utcDateOnlySchema,
  items: z.array(itemSchema).min(1),
}).superRefine((data, ctx) => {
  if (data.periodStart > data.periodEnd) {
    ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "Invalid payroll period" });
  }
  if (new Set(data.items.map((item) => item.employeeId)).size !== data.items.length) {
    ctx.addIssue({ code: "custom", path: ["items"], message: "Employee IDs must be unique" });
  }
});

function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, currentValue) =>
      typeof currentValue === "bigint" ? currentValue.toString() : currentValue
    )
  ) as T;
}

export async function GET(req: NextRequest) {
  const auth = await requirePayrollApiAuth();
  if (!auth.ok) return auth.response;

  const payrollRunId = req.nextUrl.searchParams.get("payrollRunId");
  if (!payrollRunId) {
    return NextResponse.json({ error: "Missing payrollRunId query parameter" }, { status: 400 });
  }

  let payrollRunIdBigInt: bigint;
  try {
    payrollRunIdBigInt = BigInt(payrollRunId);
  } catch {
    return NextResponse.json({ error: "Invalid payrollRunId" }, { status: 400 });
  }

  const payrollRun = await prisma.payrollRun.findFirst({
    where: { id: payrollRunIdBigInt, companyId: auth.company.id },
    select: { id: true },
  });
  if (!payrollRun) {
    return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
  }

  const data = await prisma.payHistory.findMany({
    where: {
      payrollRunId: payrollRunIdBigInt,
      employee: { companyId: auth.company.id },
    },
    select: {
      id: true,
      employeeId: true,
      payrollRunId: true,
      payDate: true,
      periodStart: true,
      periodEnd: true,
      hoursWorked: true,
      grossPay: true,
      ded_cpp: true,
      ded_ei: true,
      ded_income_tax: true,
      ded_eht: true,
      ded_wsib: true,
      netPay: true,
      status: true,
      paidAt: true,
      createdAt: true,
      updatedAt: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeNumber: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });

  return NextResponse.json(serializeBigInt(data));
}

export async function POST(req: NextRequest) {
  const auth = await requirePayrollApiAuth();
  if (!auth.ok) return auth.response;
  if (!auth.company.currentPlan) {
    return NextResponse.json(
      { error: "Choose a plan before creating pay history." },
      { status: 402 }
    );
  }
  const json = await req.json().catch(() => null);
  if (!json) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  // 멱등 키로 중복 방지하고 싶다면 여기에 로직 추가 가능 (예: 별도 테이블)
  const { payDate, periodStart, periodEnd, items } = parsed.data;
  const employeeIds = items.map((item) => BigInt(item.employeeId));
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, companyId: auth.company.id },
    select: {
      id: true,
      payType: true,
      hourlyRate: true,
      salary: true,
      payGroup: true,
      vacationPay: true,
      federalTD1: true,
      provincialTD1: true,
    },
  });
  if (employees.length !== employeeIds.length) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }
  const employeesById = new Map(employees.map((employee) => [employee.id.toString(), employee]));

  // See the identical block in src/app/api/payroll/run/route.ts for why this is needed:
  // CPP/EI cap on cumulative YTD earnings, not a per-period average.
  const yearStart = new Date(Date.UTC(payDate.getUTCFullYear(), 0, 1));
  const ytdSums = await prisma.payHistory.groupBy({
    by: ["employeeId"],
    where: {
      employeeId: { in: employeeIds },
      payDate: { gte: yearStart, lt: payDate },
      status: { not: "FAILED" },
    },
    _sum: { ded_cpp: true, ded_ei: true },
  });
  const ytdByEmployee = new Map(
    ytdSums.map((row) => [
      row.employeeId.toString(),
      {
        ytdPensionableEarnings: Number(row._sum.ded_cpp ?? 0) / CPP.rate,
        ytdInsurableEarnings: Number(row._sum.ded_ei ?? 0) / EI.rate,
      },
    ])
  );

  let createdCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const it of items) {
      const emp = employeesById.get(it.employeeId);
      if (!emp) throw new Error("PAYROLL_INPUT_CHANGED_BEFORE_COMMIT");

      const ytd = ytdByEmployee.get(it.employeeId);

      const amounts = calculatePayrollAmounts({
        payType: emp.payType,
        payGroup: emp.payGroup,
        hourlyRate: Number(emp.hourlyRate ?? 0),
        salary: Number(emp.salary ?? 0),
        vacationPay: Number(emp.vacationPay ?? 0),
        hoursWorked: it.hoursWorked,
        overtime: it.overtime,
        holidayHours: it.holidayHours,
        includeVacation: it.includeVacation,
        federalTD1: Number(emp.federalTD1 ?? 0),
        provincialTD1: Number(emp.provincialTD1 ?? 0),
        ytdPensionableEarnings: ytd?.ytdPensionableEarnings ?? 0,
        ytdInsurableEarnings: ytd?.ytdInsurableEarnings ?? 0,
      });

      await tx.payHistory.create({
        data: {
          employeeId: emp.id,
          payDate,
          periodStart,
          periodEnd,
          hoursWorked: emp.payType === "HOURLY" ? Number(it.hoursWorked ?? 0) : null,
          grossPay: amounts.grossPay,
          ded_cpp: amounts.ded_cpp,
          ded_ei: amounts.ded_ei,
          ded_income_tax: amounts.ded_tax,
          ded_eht: amounts.ded_eht,
          ded_wsib: amounts.ded_wsib,
          netPay: amounts.netPay,
          status: "PENDING",                    // 기본 상태
          review_valid: true,
          review_errors: [],
          review_warnings: [],
        },
      });

      createdCount += 1;
    }
  });

  return NextResponse.json({ ok: true, count: createdCount });
}

const statusPatchSchema = z.object({
  ids: z.array(z.union([z.string(), z.number()])).min(1), // PayHistory.id (BIGSERIAL)
  status: z.enum(["PENDING", "PROCESSED", "READY", "SENDING", "SENT", "EMAIL_SENT", "FAILED"]),
  pdfUrl: z.string().optional(),
  emailSentAt: z.string().optional(),
  emailProvider: z.string().optional(),
  deliveryStatus: z.string().optional(),
  failureReason: z.string().optional(),
});

export async function PATCH(req: NextRequest) {
  const auth = await requirePayrollApiAuth();
  if (!auth.ok) return auth.response;
  if (!auth.company.currentPlan) {
    return NextResponse.json(
      { error: "Choose a plan before updating pay history." },
      { status: 402 }
    );
  }

  const json = await req.json();
  const parsed = statusPatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  const { ids, status, pdfUrl, emailSentAt, emailProvider, deliveryStatus, failureReason } = parsed.data;

  const idList: bigint[] = [];
  for (const value of ids) {
    try {
      idList.push(BigInt(value));
    } catch {
      return NextResponse.json({ error: `Invalid PayHistory id: ${String(value)}` }, { status: 400 });
    }
  }
  const uniqueIds = [...new Set(idList)];

  const ownedRows = await prisma.payHistory.count({
    where: {
      id: { in: uniqueIds },
      employee: { companyId: auth.company.id },
    },
  });
  if (ownedRows !== uniqueIds.length) {
    return NextResponse.json({ error: "Pay history not found" }, { status: 404 });
  }

  const updateData = {
    status,
    ...(pdfUrl !== undefined ? { pdfUrl } : {}),
    ...(emailSentAt !== undefined ? { emailSentAt: new Date(emailSentAt) } : {}),
    ...(emailProvider !== undefined ? { emailProvider } : {}),
    ...(deliveryStatus !== undefined ? { deliveryStatus } : {}),
    ...(failureReason !== undefined ? { failureReason } : {}),
  };

  const updated = await prisma.payHistory.updateMany({
    where: {
      id: { in: idList },
      employee: { companyId: auth.company.id },
    },
    data: updateData,
  });

  return NextResponse.json({ ok: true, updated: updated.count });
}
