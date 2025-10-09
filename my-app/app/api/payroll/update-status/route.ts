// /app/api/payroll/update-status/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type ScheduleBody = {
  employeeIds: (string | number)[];
  payDate: string;               // YYYY-MM-DD
  periodStart?: string | null;   // YYYY-MM-DD
  periodEnd?: string | null;     // YYYY-MM-DD
  sendAt?: string | null;        // 'YYYY-MM-DDTHH:mm' or ISO
  timezone?: string | null;      // e.g., 'America/Toronto'
  meta?: Record<string, unknown>;
};

async function safeJson<T = any>(req: Request): Promise<T> {
  try { return await req.json(); } catch { throw new Error('Invalid JSON body'); }
}

export async function POST(req: Request) {
  try {
    // 1) 내부 보호 토큰
    const token = req.headers.get('x-api-key');
    if (process.env.PAYROLL_UPDATE_TOKEN && token !== process.env.PAYROLL_UPDATE_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2) 바디 파싱
    const body = await safeJson(req);

    // ── A) 스케줄(n8n 호출) 모드 ───────────────────────────────────────────
    const schedule: ScheduleBody | undefined =
      body?.schedule ??
      (body?.employeeIds && body?.payDate
        ? {
            employeeIds: body.employeeIds,
            payDate: body.payDate,
            periodStart: body.periodStart ?? null,
            periodEnd: body.periodEnd ?? null,
            sendAt: body.sendAt ?? null,
            timezone: body.timezone ?? 'America/Toronto',
            meta: body.meta ?? {},
          }
        : undefined);

    if (schedule) {
      if (!Array.isArray(schedule.employeeIds) || schedule.employeeIds.length === 0) {
        return NextResponse.json({ error: 'No employeeIds provided' }, { status: 400 });
      }
      if (!schedule.payDate || typeof schedule.payDate !== 'string') {
        return NextResponse.json({ error: 'No payDate provided' }, { status: 400 });
      }

      const url = process.env.N8N_WEBHOOK_URL;
      if (!url) return NextResponse.json({ error: 'N8N_WEBHOOK_URL is not set' }, { status: 500 });

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.N8N_API_KEY) headers['X-API-Key'] = process.env.N8N_API_KEY;

      const sendAtIso = schedule.sendAt ? new Date(schedule.sendAt).toISOString() : null;

      const n8nPayload = {
        ...schedule,
        employeeIds: schedule.employeeIds.map((x) => String(x)),
        sendAtIso,
        receivedAt: new Date().toISOString(),
        source: 'waggio-next/payroll',
      };

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(n8nPayload),
        cache: 'no-store',
      });

      const text = await res.text().catch(() => '');
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

      if (!res.ok) {
        return NextResponse.json(
          { ok: false, stage: 'schedule', status: res.status, error: data || text || 'n8n error' },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true, stage: 'schedule', n8n: data });
    }

    // ── B) 상태 업데이트 모드 ──────────────────────────────────────────────
    const { ids, status } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No IDs provided' }, { status: 400 });
    }
    if (!status || typeof status !== 'string') {
      return NextResponse.json({ error: 'No status provided' }, { status: 400 });
    }

    // 스키마에 맞춘 허용 상태값
    const ALLOWED = new Set(['PENDING', 'PROCESSED', 'SENT']);
    if (!ALLOWED.has(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}. Allowed: PENDING | PROCESSED | SENT` }, { status: 400 });
    }

    const validIds = ids
      .filter((x: any) => x !== null && x !== undefined && !isNaN(Number(x)))
      .map((x: any) => BigInt(x));

    if (validIds.length === 0) {
      return NextResponse.json({ error: 'No valid IDs after parsing' }, { status: 400 });
    }

    const updated = await prisma.payHistory.updateMany({
      where: { id: { in: validIds } },
      data: { status },
    });

    return NextResponse.json({
      ok: true,
      stage: 'update-status',
      updatedCount: updated.count,
      message: `Updated ${updated.count} record(s) to status: ${status}`,
    });
  } catch (error: any) {
    console.error('❌ /api/payroll/update-status error:', error);
    return NextResponse.json({ error: error?.message ?? 'Internal Error' }, { status: 500 });
  }
}
