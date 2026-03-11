import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { calculatePayrollAmounts } from "@/lib/payroll/calculatePayroll";

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
      const createdRun = await tx.payrollRun.create({
        data: {
          payDate: new Date(payDate),
          status: "SCHEDULED" ,
          meta: {
            periodStart,
            periodEnd,
            sendAt,
            timezone,
          } as Prisma.InputJsonValue,
        },
      });

      for (const it of items) {
        const empIdBig = BigInt(it.employeeId);
        const emp = await tx.employee.findUnique({
          where: { id: empIdBig },
          select: {
            id: true,
            payType: true,
            hourlyRate: true,
            salary: true,
            payGroup: true,
            vacationPay: true,
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
        });

        await tx.payHistory.create({
          data: {
            employeeId: emp.id,
            payrollRunId: createdRun.id,
            payDate: new Date(payDate),
            hoursWorked: emp.payType === "HOURLY" ? Number(it.hoursWorked ?? 0) : null,
            grossPay: amounts.grossPay,
            ded_cpp: amounts.ded_cpp,
            ded_ei: amounts.ded_ei,
            ded_income_tax: amounts.ded_tax,
            ded_eht: amounts.ded_eht,
            ded_wsib: amounts.ded_wsib,
            netPay: amounts.netPay,
            status: "PENDING",
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

    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const webhookRes = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payrollRunId: payrollRun.id.toString(),
            event: "PAYROLL_PROCESSED",
          }),
          cache: "no-store",
        });

        if (!webhookRes.ok) {
          const webhookBody = await webhookRes.text().catch(() => "");
          console.error("n8n payroll webhook returned non-OK", {
            status: webhookRes.status,
            body: webhookBody,
          });
        }
      } catch (webhookError) {
        console.error("Failed to trigger n8n payroll webhook", webhookError);
      }
    }

    return NextResponse.json({
      ok: true,
      payrollRunId: payrollRun.id.toString(),
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
