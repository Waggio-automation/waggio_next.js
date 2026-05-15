import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const dueRuns = await prisma.payrollRun.findMany({
      where: {
        status: "PROCESSED",
        providerRef: null,
        sendAt: { lte: new Date() },
      },
      select: {
        id: true,
        payHistory: {
          select: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                payoutEnabled: true,
                trolleyRecipientAccountId: true,
              },
            },
          },
        },
      },
    });

    const seen = new Set<string>();
    const missing: Array<{
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    }> = [];

    for (const run of dueRuns) {
      for (const row of run.payHistory) {
        const emp = row.employee;
        const idStr = emp.id.toString();
        if (seen.has(idStr)) continue;
        if (!emp.payoutEnabled || !emp.trolleyRecipientAccountId) {
          seen.add(idStr);
          missing.push({
            id: idStr,
            firstName: emp.firstName,
            lastName: emp.lastName,
            email: emp.email,
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      dueRunCount: dueRuns.length,
      missing,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Preflight check failed.",
      },
      { status: 500 }
    );
  }
}
// Send due payroll" 버튼 누르기 전에 Trolley 계좌 설정 안 된 직원이 있는지 미리 체크해서 모달로 경고 띄워주는 기능