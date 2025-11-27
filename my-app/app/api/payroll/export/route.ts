import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// req: NextRequest 파라미터 추가!
export async function GET(req: NextRequest) {
  try {
    // 1. URL에서 ids 가져오기 (예: ?ids=1,2,3)
    const { searchParams } = new URL(req.url);
    const idsParam = searchParams.get('ids');

    // 2. 검색 조건 만들기
    const whereClause: any = { status: 'PENDING' };

    // 만약 ids가 있으면, 그 ID를 가진 직원만 필터링!
    if (idsParam) {
      const ids = idsParam.split(',').map((id) => BigInt(id));
      whereClause.employeeId = { in: ids };
    }

    // 3. 조건(whereClause)을 넣어서 조회
    const data = await prisma.payHistory.findMany({
      where: whereClause,
      include: { employee: true },
    });

    // 🔹 BigInt → String 변환
    const serialized = JSON.parse(
      JSON.stringify(data, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    );

    return NextResponse.json(serialized);
  } catch (error) {
    console.error('Error fetching payroll data:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}