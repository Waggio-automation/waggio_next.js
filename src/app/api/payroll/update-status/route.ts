import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PayHistoryStatus, Prisma } from "@prisma/client";
import { requirePayrollApiAuth } from "@/lib/payroll-api-auth";

type ScheduleBody = {
  employeeIds: (string | number)[];
  payDate: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  sendAt?: string | null;
  timezone?: string | null;
  meta?: Record<string, unknown>;
};

type UpdateBody = {
  ids?: (string | number)[];
  status?: string;
  schedule?: ScheduleBody;
  employeeIds?: (string | number)[];
  payDate?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  sendAt?: string | null;
  timezone?: string | null;
  meta?: Record<string, unknown>;
};

async function safeJson<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePayrollApiAuth();
    if (!auth.ok) return auth.response;
    if (!auth.company.currentPlan) {
      return NextResponse.json(
        { error: "Choose a plan before updating payroll." },
        { status: 402 }
      );
    }
    const body = await safeJson<UpdateBody>(req);

    const schedule: ScheduleBody | undefined =
      body.schedule ??
      (body.schedule == null && body.ids == null && body.employeeIds && body.payDate
        ? {
            employeeIds: body.employeeIds,
            payDate: body.payDate,
            periodStart: body.periodStart ?? null,
            periodEnd: body.periodEnd ?? null,
            sendAt: body.sendAt ?? null,
            timezone: body.timezone ?? "America/Toronto",
            meta: body.meta ?? {},
          }
        : undefined);

    if (schedule) {
      const { sendAt, ...scheduleMeta } = schedule;
      const payrollRun = await prisma.payrollRun.create({
        data: {
          companyId: auth.company.id,
          payDate: new Date(schedule.payDate),
          sendAt: sendAt ? new Date(sendAt) : null,
          status: "SCHEDULED",
          meta: scheduleMeta as Prisma.InputJsonValue,
        },
      });

      return NextResponse.json({
        ok: true,
        stage: "scheduled",
        payrollRunId: payrollRun.id.toString(),
      });
    }

    const ids = Array.isArray(body.ids) ? body.ids : [];
    const status = typeof body.status === "string" ? body.status : null;
    if (!ids.length || !status) {
      return NextResponse.json({ error: "Missing ids or status" }, { status: 400 });
    }

    if (!["PENDING", "PROCESSED", "SENT"].includes(status)) {
      return NextResponse.json({ error: "Unsupported pay history status" }, { status: 400 });
    }

    const nextStatus = status as PayHistoryStatus;

    const validIds = ids.map((x) => BigInt(x));
    await prisma.payHistory.updateMany({
      where: {
        id: { in: validIds },
        employee: { companyId: auth.company.id },
      },
      data: { status: nextStatus },
    });

    return NextResponse.json({ ok: true, message: "Pay history updated" });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
