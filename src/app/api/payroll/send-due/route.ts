import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  sendDuePayrollRunsToTrolley,
  sendPayrollRunToTrolley,
} from "@/lib/payments/trolley-payroll";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";

export async function POST(req: Request) {
  try {
    const company = await requireCompanyAdminOrRedirect();
    const body = await req.json().catch(() => ({}));
    let payrollRunId: bigint | null = null;
    if (body && typeof body.payrollRunId === "string") {
      try {
        payrollRunId = BigInt(body.payrollRunId);
      } catch {
        return NextResponse.json({ error: "Invalid payroll run id." }, { status: 400 });
      }
    }

    if (payrollRunId) {
      const run = await prisma.payrollRun.findFirst({
        where: { id: payrollRunId, companyId: company.id },
        select: { id: true },
      });

      if (!run) {
        return NextResponse.json({ error: "Payroll run not found." }, { status: 404 });
      }

      const result = await sendPayrollRunToTrolley(payrollRunId, { enforceDue: true });
      return NextResponse.json({ ok: true, count: 1, processed: [result] });
    }

    const result = await sendDuePayrollRunsToTrolley(company.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send due payroll runs." },
      { status: 500 }
    );
  }
}
