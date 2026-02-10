import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

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

function toIsoAtLocalTime(date: string, time: string, tz: string) {
  const [Y, M, D] = date.split("-").map(Number);
  const [h, m] = time.split(":").map(Number);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(Date.UTC(Y, M - 1, D, h, m)));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const assumedUtc = new Date(
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"))
  );

  return assumedUtc.toISOString();
}

export async function POST(req: Request) {
  try {
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
      const payrollRun = await prisma.payrollRun.create({
        data: {
          payDate: new Date(schedule.payDate),
          status: "SCHEDULED",
          meta: schedule as Prisma.InputJsonValue,
        },
      });

      const url = process.env.N8N_PAYROLL_WEBHOOK_URL ?? process.env.N8N_WEBHOOK_URL;
      if (!url) {
        return NextResponse.json({
          ok: true,
          stage: "scheduled",
          payrollRunId: payrollRun.id.toString(),
        });
      }

      const tz = schedule.timezone ?? "America/Toronto";
      const sendAtIso = !schedule.sendAt
        ? toIsoAtLocalTime(schedule.payDate, "09:00", tz)
        : /^\d{4}-\d{2}-\d{2}$/.test(String(schedule.sendAt))
          ? toIsoAtLocalTime(String(schedule.sendAt), "09:00", tz)
          : new Date(String(schedule.sendAt)).toISOString();

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.N8N_API_KEY) {
        headers["X-API-Key"] = process.env.N8N_API_KEY;
      }

      const payload = {
        ...schedule,
        employeeIds: schedule.employeeIds.map((id) => String(id)),
        payrollRunId: payrollRun.id.toString(),
        sendAtIso,
        source: "waggio-next/payroll",
      };

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      const text = await res.text().catch(() => "");
      let data: Record<string, unknown> = {};
      try {
        data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        await prisma.payrollRun.update({
          where: { id: payrollRun.id },
          data: {
            status: "FAILED",
            failureType: "FUNDING",
            failureReason:
              (typeof data.error === "string" ? data.error : null) ??
              `Funding request failed (${res.status})`,
          },
        });

        return NextResponse.json(
          { ok: false, stage: "schedule", status: res.status, error: data },
          { status: 502 }
        );
      }

      await prisma.payrollRun.update({
        where: { id: payrollRun.id },
        data: { status: "FUNDING" },
      });

      return NextResponse.json({
        ok: true,
        stage: "funding",
        payrollRunId: payrollRun.id.toString(),
        n8n: data,
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

    const validIds = ids.map((x) => BigInt(x));
    await prisma.payHistory.updateMany({
      where: { id: { in: validIds } },
      data: { status },
    });

    return NextResponse.json({ ok: true, message: "Pay history updated" });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
