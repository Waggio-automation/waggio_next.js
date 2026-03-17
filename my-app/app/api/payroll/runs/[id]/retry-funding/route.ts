import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type ScheduleMeta = {
  employeeIds: string[];
  payDate?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  sendAt?: string | null;
  timezone?: string | null;
  meta?: Record<string, unknown>;
};

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

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let payrollRunId: bigint;
  try {
    payrollRunId = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid payroll run id" }, { status: 400 });
  }

  const run = await prisma.payrollRun.findUnique({
    where: { id: payrollRunId },
    select: {
      id: true,
      meta: true,
      payDate: true,
      sendAt: true,
    },
  });

  if (!run) {
    return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
  }

  const schedule = run.meta as ScheduleMeta | null;
  if (!schedule || !Array.isArray(schedule.employeeIds)) {
    return NextResponse.json(
      { error: "Payroll run cannot be retried because schedule metadata is missing." },
      { status: 400 }
    );
  }

  const url = process.env.N8N_PAYROLL_WEBHOOK_URL ?? process.env.N8N_WEBHOOK_URL;
  if (!url) {
    return NextResponse.json({ error: "N8N webhook URL is not configured" }, { status: 500 });
  }

  const tz = schedule.timezone ?? "America/Toronto";
  const payDateYmd = run.payDate.toISOString().slice(0, 10);
  const sendAtSource = run.sendAt?.toISOString() ?? schedule.sendAt ?? null;
  const sendAtIso = !sendAtSource
    ? toIsoAtLocalTime(payDateYmd, "09:00", tz)
    : /^\d{4}-\d{2}-\d{2}$/.test(String(sendAtSource))
      ? toIsoAtLocalTime(String(sendAtSource), "09:00", tz)
      : new Date(String(sendAtSource)).toISOString();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.N8N_API_KEY) {
    headers["X-API-Key"] = process.env.N8N_API_KEY;
  }

  await prisma.payrollRun.update({
    where: { id: run.id },
    data: {
      status: "FUNDING",
      failureReason: null,
      failureType: null,
    },
  });

  const payload = {
    ...schedule,
    payrollRunId: run.id.toString(),
    sendAtIso,
    source: "waggio-next/payroll",
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        failureType: "FUNDING",
        failureReason: text || `Funding retry failed (${res.status})`,
      },
    });

    return NextResponse.json({ error: "Retry funding failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, payrollRunId: run.id.toString(), status: "funding" });
}
