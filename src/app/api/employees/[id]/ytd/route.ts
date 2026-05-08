import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";

function parseEmployeeId(id: string) {
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

const toNum = (v: unknown) => (v == null ? 0 : Number(v));

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const company = await requireCompanyAdminOrRedirect();
  const { id } = await params;
  const employeeId = parseEmployeeId(id);

  if (!employeeId) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  const yearParam = req.nextUrl.searchParams.get("year");
  if (!yearParam || !/^\d{4}$/.test(yearParam)) {
    return NextResponse.json(
      { error: "Invalid or missing year (expected ?year=YYYY)" },
      { status: 400 }
    );
  }
  const year = Number(yearParam);

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId, companyId: company.id },
    select: { id: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

  const result = await prisma.payHistory.aggregate({
    where: {
      employeeId,
      payDate: { gte: start, lte: end },
      status: { in: ["SENT", "EMAIL_SENT"] },
      paidAt: { not: null },
    },
    _sum: {
      grossPay: true,
      netPay: true,
      hoursWorked: true,
      ded_cpp: true,
      ded_ei: true,
      ded_income_tax: true,
    },
  });

  const sum = result._sum;

  return NextResponse.json({
    employeeId: employee.id.toString(),
    year,
    ytdGrossPay: toNum(sum.grossPay),
    ytdNetPay: toNum(sum.netPay),
    ytdHours: toNum(sum.hoursWorked),
    ytdCpp: toNum(sum.ded_cpp),
    ytdEi: toNum(sum.ded_ei),
    ytdFedTax: toNum(sum.ded_income_tax),
  });
}
