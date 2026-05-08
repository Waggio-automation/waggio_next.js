import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { employeeInputSchema } from "@/app/employees/validators";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";

// GET: 목록 (민감정보 제외)
export async function GET() {
  const company = await requireCompanyAdminOrRedirect();
  const list = await prisma.employee.findMany({
    where: { companyId: company.id },
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
    const company = await requireCompanyAdminOrRedirect();
    if (!company.currentPlan) {
      return NextResponse.json(
        { error: "Choose a plan before creating employees." },
        { status: 402 }
      );
    }
    // (선택) API 키 검사
    // if (req.headers.get("x-api-key") !== process.env.API_KEY) return NextResponse.json({error:"unauthorized"}, {status:401});

    const body = await req.json();
    const parsed = employeeInputSchema.parse(body);

    const created = await prisma.employee.create({
      data: {
        ...parsed,
        paymentMethod: "DIRECT_DEPOSIT",
        dentalBenefitsCoverage: parsed.dentalBenefitsCoverage,
        addrLine2: parsed.addrLine2 || null,
        employeeNumber: parsed.employeeNumber?.trim() || null,
        department: parsed.department?.trim() || null,
        jobTitle: parsed.jobTitle?.trim() || null,
        bankTransit: parsed.bankTransit?.trim() || null,
        bankAccount: parsed.bankAccount?.trim() || null,
        hourlyRate: parsed.hourlyRate ?? null,
        salary: parsed.salary ?? null,
        rppDpspRegistrationNumber: parsed.rppDpspRegistrationNumber?.trim() || null,
        pensionAdjustmentOverride: parsed.pensionAdjustmentOverride ?? null,
        companyId: company.id,
        payoutSetupStatus: "REQUIRED",
        payoutEnabled: false,
      },
    });

    return NextResponse.json({ ok:true, id: created.id.toString() }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid payload" },
      { status: 400 }
    );
  }
}
