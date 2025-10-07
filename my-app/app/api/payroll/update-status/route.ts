import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ✅ POST /api/payroll/update-status
export async function POST(req: Request) {
  try {
    // 🔹 1. 보안 토큰 확인
    const token = req.headers.get('x-api-key');
    if (process.env.PAYROLL_UPDATE_TOKEN && token !== process.env.PAYROLL_UPDATE_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 🔹 2. 요청 바디 파싱
    const { ids, status } = await req.json();

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No IDs provided' }, { status: 400 });
    }

    if (!status) {
      return NextResponse.json({ error: 'No status provided' }, { status: 400 });
    }

    // 🔹 3. ID를 BigInt로 변환 + 유효성 검사
    const validIds = ids
      .filter((x: any) => x !== null && x !== undefined && !isNaN(Number(x)))
      .map((x: any) => BigInt(x));

    if (validIds.length === 0) {
      return NextResponse.json({ error: 'No valid IDs after parsing' }, { status: 400 });
    }

    // 🔹 4. 상태 업데이트 실행
    const updated = await prisma.payHistory.updateMany({
      where: { id: { in: validIds } },
      data: { status },
    });

    // 🔹 5. 결과 반환
    return NextResponse.json({
      ok: true,
      updatedCount: updated.count,
      message: `Updated ${updated.count} record(s) to status: ${status}`,
    });
  } catch (error: any) {
    console.error('❌ Error updating pay history:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
