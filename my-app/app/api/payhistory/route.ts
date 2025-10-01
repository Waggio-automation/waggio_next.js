import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const itemSchema = z.object({
  employeeId: z.string().min(1),       // stringified BIGINT
  hoursWorked: z.number().nullable(),  // null for SALARY
  overtime: z.number().default(0),
  includeVacation: z.boolean().default(true),
});

const payloadSchema = z.object({
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  payDate: z.string().min(1),
  items: z.array(itemSchema).min(1),
});

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

      // 금액 계산(서버 확정)
      let base = 0;
      if (emp.payType === "HOURLY") {
        const rate = Number(emp.hourlyRate ?? 0);
        const h = Number(it.hoursWorked ?? 0);
        const ot = Number(it.overtime ?? 0);
        base = rate * h + rate * 1.5 * ot;
      } else {
        const sal = Number(emp.salary ?? 0);
        base = sal / (emp.payGroup === "BI_WEEKLY" ? 26 : 12);
      }

      const vacPct = Number(emp.vacationPay ?? 0) / 100;
      const vacationAmt = it.includeVacation ? base * vacPct : 0;
      const gross = base + vacationAmt;

      // 공제는 이후 실제 규칙으로 확장. 지금은 0으로 저장
      const ded_cpp = 0;
      const ded_ei = 0;
      const ded_tax = 0;
      const ded_eht = 0;
      const ded_wsib = 0;

      const net = gross - ded_cpp - ded_ei - ded_tax - ded_eht - ded_wsib;

      await tx.payHistory.create({
        data: {
          employeeId: emp.id,
          payDate: new Date(payDate),
          hoursWorked: emp.payType === "HOURLY" ? Number(it.hoursWorked ?? 0) : null,
          grossPay: gross,
          ded_cpp: ded_cpp,
          ded_ei: ded_ei,
          ded_income_tax: ded_tax,
          ded_eht: ded_eht,
          ded_wsib: ded_wsib,
          netPay: net,
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
    status: z.enum(["PENDING", "PROCESSED", "PAID"]),
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
  