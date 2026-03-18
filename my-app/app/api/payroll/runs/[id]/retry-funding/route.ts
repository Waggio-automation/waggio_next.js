import { NextResponse } from "next/server";
import { sendPayrollRunToTrolley } from "@/lib/payments/trolley-payroll";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let payrollRunId: bigint;
  try {
    payrollRunId = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid payroll run id" }, { status: 400 });
  }

  try {
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
