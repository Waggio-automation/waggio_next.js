import { NextResponse } from "next/server";
import { sendDuePayrollRunsToTrolley } from "@/lib/payments/trolley-payroll";

export async function POST() {
  try {
    const result = await sendDuePayrollRunsToTrolley();
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send due payroll runs." },
      { status: 500 }
    );
  }
}
