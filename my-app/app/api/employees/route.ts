import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { employeeInputSchema } from "@/app/(dashboard)/employees/validators";

// GET: 목록 (민감정보 제외)
export async function GET() {
  const list = await prisma.employee.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: {
      id:true, firstName:true, lastName:true, email:true,
      employmentType:true, payType:true, hourlyRate:true, salary:true,
      payGroup:true, createdAt:true,
    },
  });
  // BigInt 직렬화
  const safe = list.map((e) => ({ ...e, id: e.id.toString() }));
  return NextResponse.json(safe);
}

// POST: 생성 (외부 시스템—for example n8n—에서 호출)
export async function POST(req: NextRequest) {
  try {
    // (선택) API 키 검사
    // if (req.headers.get("x-api-key") !== process.env.API_KEY) return NextResponse.json({error:"unauthorized"}, {status:401});

    const body = await req.json();
    const parsed = employeeInputSchema.parse(body);

    const created = await prisma.employee.create({
      data: {
        ...parsed,
        addrLine2: parsed.addrLine2 || null,
        hourlyRate: parsed.hourlyRate ?? null,
        salary: parsed.salary ?? null,
        bankName: parsed.bankName || null,
        bankAccount: parsed.bankAccount || null,
        transitNumber: parsed.transitNumber || null,
        institutionNumber: parsed.institutionNumber || null,
      },
    });

    return NextResponse.json({ ok:true, id: created.id.toString() }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Invalid payload" }, { status: 400 });
  }
}
