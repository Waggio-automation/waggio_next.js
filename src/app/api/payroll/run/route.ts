import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculatePayrollAmounts } from "@/lib/payroll/calculatePayroll";
import { requirePayrollApiAuth } from "@/lib/payroll-api-auth";
import { sendPayrollRunToTrolley } from "@/lib/payments/trolley-payroll";
import { serializeUtcDateOnly } from "@/lib/date-only";
import { payrollRunInputSchema } from "@/lib/payroll/payroll-run-input";

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

    const parsed = payrollRunInputSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed" },
        { status: 400 }
      );
    }

    const { items, payDate, periodStart, periodEnd, sendAt, timezone } = parsed.data;
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

    const payrollRun = await prisma.$transaction(async (tx) => {
      const employeeCount = await tx.employee.count({
        where: {
          id: { in: employeeIds },
          companyId: auth.company.id,
        },
      });
      if (employeeCount !== employeeIds.length) {
        throw new Error("PAYROLL_INPUT_CHANGED_BEFORE_COMMIT");
      }

      const createdRun = await tx.payrollRun.create({
        data: {
          companyId: auth.company.id,
          payDate,
          sendAt,
          status: "SCHEDULED" ,
          meta: {
            employeeIds: items.map((item) => item.employeeId),
            periodStart: serializeUtcDateOnly(periodStart),
            periodEnd: serializeUtcDateOnly(periodEnd),
            timezone,
            sendAt: sendAt.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      for (const it of items) {
        const emp = employeesById.get(it.employeeId);

        if (!emp) {
          throw new Error("PAYROLL_INPUT_CHANGED_BEFORE_COMMIT");
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
    if (sendAt <= new Date()) {
      try {
        const result = await sendPayrollRunToTrolley(payrollRun.id, { enforceDue: true });
        trolleyResult = { sent: true, batchId: result.batchId };
      } catch {
        console.error("Immediate payroll provider dispatch failed");
        trolleyResult = { sent: false, error: "Provider dispatch failed" };
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
