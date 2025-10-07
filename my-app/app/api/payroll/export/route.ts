// app/api/payroll/export/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const data = await prisma.payHistory.findMany({
      where: { status: 'PENDING' },
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
