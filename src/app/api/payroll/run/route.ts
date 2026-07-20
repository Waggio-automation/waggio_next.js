import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { calculatePayrollAmounts } from "@/lib/payroll/calculatePayroll";
import { requirePayrollApiAuth } from "@/lib/payroll-api-auth";
import { sendPayrollRunToTrolley } from "@/lib/payments/trolley-payroll";

const itemSchema = z.object({
  employeeId: z.string().min(1),
  hoursWorked: z.number().nullable(),
  overtime: z.number(),
  holidayHours: z.number(),
  includeVacation: z.boolean(),
});

const runSchema = z.object({
  items: z.array(itemSchema).min(1),
  payDate: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  sendAt: z.string().min(1),
  timezone: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const auth = await requirePayrollApiAuth();
    if (!auth.ok) return auth.response;
    if (!auth.company.currentPlan) {
      return NextResponse.json(
        { error: "Choose a plan before creating paystubs." },
        { status: 402 }
      );
    }
    const json = await req.json().catch(() => null);
    if (!json) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = runSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { items, payDate, periodStart, periodEnd, sendAt, timezone } = parsed.data;

    const payrollRun = await prisma.$transaction(async (tx) => {
      const employeeIds = items.map((item) => BigInt(item.employeeId));
      const employeeCount = await tx.employee.count({
        where: {
          id: { in: employeeIds },
          companyId: auth.company.id,
        },
      });
      if (employeeCount !== employeeIds.length) {
        throw new Error("One or more selected employees do not belong to this company.");
      }

      const createdRun = await tx.payrollRun.create({
        data: {
          companyId: auth.company.id,
          payDate: new Date(payDate),
          sendAt: new Date(sendAt),
          status: "SCHEDULED" ,
          meta: {
            employeeIds: items.map((item) => item.employeeId),
            periodStart,
            periodEnd,
            timezone,
            sendAt,
          } as Prisma.InputJsonValue,
        },
      });

      for (const it of items) {
        const empIdBig = BigInt(it.employeeId);
        const emp = await tx.employee.findUnique({
          where: { id: empIdBig, companyId: auth.company.id },
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

        if (!emp) {
          throw new Error(`Unknown employee: ${it.employeeId}`);
        }

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
        });

        await tx.payHistory.create({
          data: {
            employeeId: emp.id,
            payrollRunId: createdRun.id,
            payDate: new Date(payDate),
            periodStart: new Date(periodStart),
            periodEnd: new Date(periodEnd),
            hoursWorked: emp.payType === "HOURLY" ? Number(it.hoursWorked ?? 0) : null,
            grossPay: amounts.grossPay,
            ded_cpp: amounts.ded_cpp,
            ded_ei: amounts.ded_ei,
            ded_income_tax: amounts.ded_tax,
            ded_eht: amounts.ded_eht,
            ded_wsib: amounts.ded_wsib,
            netPay: amounts.netPay,
            status: amounts.netPay > 0 ? "READY" : "PENDING",
            review_valid: true,
            review_errors: [],
            review_warnings: [],
          },
        });
      }

      await tx.payrollRun.update({
        where: { id: createdRun.id },
        data: { status: "PROCESSED" },
      });

      return createdRun;
    });

    let trolleyResult: { sent: boolean; batchId?: string; error?: string } = { sent: false };
    const sendAtDate = new Date(sendAt);
    if (sendAtDate <= new Date()) {
      try {
        const result = await sendPayrollRunToTrolley(payrollRun.id, { enforceDue: true });
        trolleyResult = { sent: true, batchId: result.batchId };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        console.error("Failed to send payroll run to Trolley immediately", JSON.stringify(error, Object.getOwnPropertyNames(error)));
        trolleyResult = { sent: false, error: msg };
      }
    }

    return NextResponse.json({
      ok: true,
      payrollRunId: payrollRun.id.toString(),
      trolley: trolleyResult,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
