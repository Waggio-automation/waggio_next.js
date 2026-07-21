import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { employeeInputSchema } from "@/app/employees/validators";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { encryptSin } from "@/lib/crypto";

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

// POST: authenticated company employee creation
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
    const result = employeeInputSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Invalid employee payload" }, { status: 400 });
    }
    const parsed = result.data;

    const created = await prisma.employee.create({
      data: {
        ...parsed,
        sin: encryptSin(parsed.sin),
        paymentMethod: "DIRECT_DEPOSIT",
        dentalBenefitsCoverage: parsed.dentalBenefitsCoverage,
        addrLine2: parsed.addrLine2 || null,
        employeeNumber: parsed.employeeNumber?.trim() || null,
        department: parsed.department?.trim() || null,
        jobTitle: parsed.jobTitle?.trim() || null,
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
  } catch {
    return NextResponse.json({ error: "Unable to create employee" }, { status: 400 });
  }
}
