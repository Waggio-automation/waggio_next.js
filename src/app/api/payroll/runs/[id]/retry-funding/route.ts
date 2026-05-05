import { NextResponse } from "next/server";
import { sendPayrollRunToTrolley } from "@/lib/payments/trolley-payroll";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const company = await requireCompanyAdminOrRedirect();
  const { id } = await params;

  let payrollRunId: bigint;
  try {
    payrollRunId = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid payroll run id" }, { status: 400 });
  }

  try {
    const payrollRun = await prisma.payrollRun.findUnique({
      where: { id: payrollRunId, companyId: company.id },
      select: { id: true },
    });
    if (!payrollRun) {
      return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
    }

    const result = await sendPayrollRunToTrolley(payrollRunId, { enforceDue: false });
    return NextResponse.json({
      ok: true,
      payrollRunId: result.payrollRunId,
      batchId: result.batchId,
      status: "paying",
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Retry payout failed." },
      { status: 500 }
    );
  }
}
