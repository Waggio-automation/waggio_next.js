// /app/api/payroll/update-status/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type ScheduleBody = {
  employeeIds: (string | number)[];
  payDate: string;               // YYYY-MM-DD
  periodStart?: string | null;   // YYYY-MM-DD
  periodEnd?: string | null;     // YYYY-MM-DD
  sendAt?: string | null;        // 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:mm' | ISO
  timezone?: string | null;      // e.g., 'America/Toronto'
  meta?: Record<string, unknown>;
};

async function safeJson<T = any>(req: Request): Promise<T> {
  try { return await req.json(); } catch { throw new Error('Invalid JSON body'); }
}

/**
 * 주어진 'YYYY-MM-DD'와 'HH:mm'을 tz(예: America/Toronto) 로컬 시각으로 가정해
 * 정확한 UTC ISO(YYYY-MM-DDTHH:mm:ss.sssZ) 문자열을 만들어준다.
 */
function toIsoAtLocalTime(date: string, time: string, tz: string) {
  const [Y, M, D] = date.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);

  // tz 기준으로 해당 시각을 포맷 → 실제 UTC 시각을 역으로 복원
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(Date.UTC(Y, M - 1, D, h, m)));

  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const assumedUtc = new Date(Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
  ));
  return assumedUtc.toISOString();
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
            sendAt: body.sendAt ?? null,                 // 날짜 or 날짜+시간 or ISO
            timezone: body.timezone ?? 'America/Toronto', // 기본 타임존
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

      const tz = schedule.timezone ?? 'America/Toronto';

      // ✅ 오전 9시 강제 규칙:
      // - sendAt이 비어있으면: payDate의 "09:00" (tz 기준)
      // - sendAt이 'YYYY-MM-DD'만 오면: 그 날짜 "09:00" (tz 기준)
      // - sendAt이 'YYYY-MM-DDTHH:mm' 또는 ISO면: 그대로 사용(서버 해석 ISO)
      let sendAtIso: string | null = null;
      if (!schedule.sendAt) {
        // 시간 안 들어오면 기본 09:00
        sendAtIso = toIsoAtLocalTime(schedule.payDate, '09:00', tz);
      } else {
        const s = String(schedule.sendAt);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          // 날짜만 들어온 경우 → 09:00 강제
          sendAtIso = toIsoAtLocalTime(s, '09:00', tz);
        } else {
          // 시간 포함(또는 완전한 ISO) → Date 파싱
          // 프론트에서 tz 포함 ISO(예: 2025-10-31T09:00:00-04:00)를 주면 가장 정확함
          sendAtIso = new Date(s).toISOString();
        }
      }

      const n8nPayload = {
        ...schedule,
        employeeIds: schedule.employeeIds.map((x) => String(x)),
        sendAtIso, // n8n Wait Until 노드가 이 값을 그대로 사용
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
