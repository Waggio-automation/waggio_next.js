import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculatePayrollAmounts } from "@/lib/payroll/calculatePayroll";
import { z } from "zod";

const itemSchema = z.object({
  employeeId: z.string().min(1),       // stringified BIGINT
  hoursWorked: z.number().nullable(),  // null for SALARY
  overtime: z.number().default(0),
  holidayHours: z.number().default(0),
  includeVacation: z.boolean().default(true),
});

const payloadSchema = z.object({
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  payDate: z.string().min(1),
  items: z.array(itemSchema).min(1),
});

function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, currentValue) =>
      typeof currentValue === "bigint" ? currentValue.toString() : currentValue
    )
  ) as T;
}

export async function GET(req: NextRequest) {
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

  const data = await prisma.payHistory.findMany({
    where: { payrollRunId: payrollRunIdBigInt },
    include: { employee: true },
  });

  return NextResponse.json(serializeBigInt(data));
}

export async function POST(req: NextRequest) {
  const idem = req.headers.get("Idempotency-Key") || undefined;
  const json = await req.json();
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  // 멱등 키로 중복 방지하고 싶다면 여기에 로직 추가 가능 (예: 별도 테이블)
  const { periodStart, periodEnd, payDate, items } = parsed.data;

  let createdCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const it of items) {
      const empIdBig = BigInt(it.employeeId); // 문자열 → BIGINT
      const emp = await tx.employee.findUnique({
        where: { id: empIdBig },
        select: {
          id: true, payType: true, hourlyRate: true, salary: true, payGroup: true, vacationPay: true,
        },
      });
      if (!emp) throw new Error(`Unknown employee: ${it.employeeId}`);

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
      });

      await tx.payHistory.create({
        data: {
          employeeId: emp.id,
          payDate: new Date(payDate),
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
    status: z.enum(["PENDING", "PROCESSED", "SENT"]),
  });
  
  export async function PATCH(req: NextRequest) {
    const json = await req.json();
    const parsed = statusPatchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
    }
  
    const { ids, status } = parsed.data;
  
    // BIGINT 배열로 변환
    const idList = ids.map((v) => (typeof v === "string" ? BigInt(v) : BigInt(v)));
  
    const updated = await prisma.payHistory.updateMany({
      where: { id: { in: idList } },
      data: { status },
    });
  
    return NextResponse.json({ ok: true, updated: updated.count });
  }
  
