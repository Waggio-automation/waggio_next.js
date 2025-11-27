// /app/api/payroll/update-status/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type ScheduleBody = {
  employeeIds: (string | number)[];
  payDate: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  sendAt?: string | null;
  timezone?: string | null;
  meta?: Record<string, unknown>;
};

async function safeJson<T = any>(req: Request): Promise<T> {
  try { return await req.json(); } catch { throw new Error('Invalid JSON body'); }
}

function toIsoAtLocalTime(date: string, time: string, tz: string) {
  const [Y, M, D] = date.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(Date.UTC(Y, M - 1, D, h, m)));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const assumedUtc = new Date(Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')));
  return assumedUtc.toISOString();
}

export async function POST(req: Request) {
  try {
    const body = await safeJson(req);
    
    // 🔍 [디버깅 로그]
    console.log("📢 [1. 요청 도착] Body 내용:", JSON.stringify(body, null, 2));

    // ── A) 스케줄(n8n 호출) 모드 판단 ──────────────────
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
      console.log("📢 [2. n8n 모드 진입] 조건 만족함!");

      // ✅ [STEP 1] URL 설정 (환경변수 대신 직접 입력)
      // 아까 복사한 n8n Test URL을 여기에 정확히 붙여넣으셨는지 확인하세요!
      const url = "https://waggio.app.n8n.cloud/webhook-test/6a3fda8a-ea60-49e2-a31f-3b422427db65"; 

      console.log("📢 [3. n8n 주소 확인]:", url);

      // ✅ [STEP 2] 헤더 설정 (비밀번호 추가!)
      // n8n Header Auth 설정과 정확히 일치해야 합니다.
      const headers: Record<string, string> = { 
        'Content-Type': 'application/json',
        // 👇 n8n의 Name(X-API-Key)과 Value(waggio123)를 똑같이 맞추세요.
        'X-API-Key': 'waggio123' 
      };

      const tz = schedule.timezone ?? 'America/Toronto';
      let sendAtIso: string | null = null;
      if (!schedule.sendAt) {
        sendAtIso = toIsoAtLocalTime(schedule.payDate, '09:00', tz);
      } else {
        const s = String(schedule.sendAt);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) sendAtIso = toIsoAtLocalTime(s, '09:00', tz);
        else sendAtIso = new Date(s).toISOString();
      }

      const n8nPayload = {
        ...schedule,
        employeeIds: schedule.employeeIds.map((x) => String(x)),
        sendAtIso,
        receivedAt: new Date().toISOString(),
        source: 'waggio-next/payroll',
      };

      console.log("📢 [4. n8n 전송 시작] Payload:", JSON.stringify(n8nPayload));

      const res = await fetch(url, {
        method: 'POST',
        headers, // 위에서 만든 비밀번호 포함된 헤더 전송
        body: JSON.stringify(n8nPayload),
        cache: 'no-store',
      });

      console.log("📢 [5. n8n 응답 상태]:", res.status);

      const text = await res.text().catch(() => '');
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

      if (!res.ok) {
        return NextResponse.json({ ok: false, stage: 'schedule', status: res.status, error: data }, { status: 502 });
      }
      return NextResponse.json({ ok: true, stage: 'schedule', n8n: data });
    } 

    // ── B) 상태 업데이트 모드 (기존 로직) ──────────────────
    // n8n 모드가 아닐 때만 실행됨
    console.log("📢 [6. DB 업데이트 모드] 진입");
    const { ids, status } = body;
    
    // DB 업데이트 로직 (필요시 주석 해제하여 사용)
    /*
    const validIds = ids.map((x: any) => BigInt(x));
    await prisma.payHistory.updateMany({
      where: { id: { in: validIds } },
      data: { status },
    });
    */

    return NextResponse.json({ ok: true, message: "DB Update Mode executed" });

  } catch (error: any) {
    console.error('❌ 에러 발생:', error);
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }
}