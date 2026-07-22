import { NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import { runPayrollSendDueJob } from "@/lib/payments/payroll-cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronRequestAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPayrollSendDueJob();
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json(
      { error: "Failed to reconcile or send due payroll runs." },
      { status: 500 }
    );
  }
}
