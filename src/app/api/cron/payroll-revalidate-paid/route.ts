import { NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/cron-auth";
import {
  getPaidRevalidationOperationalHealth,
  getPaidRevalidationHttpStatus,
  revalidatePaidPayrollRunsFromTrolley,
} from "@/lib/payments/payroll-payment-reconciliation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!isCronRequestAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await revalidatePaidPayrollRunsFromTrolley();
    const health = await getPaidRevalidationOperationalHealth();
    const status = getPaidRevalidationHttpStatus(health);
    return NextResponse.json(
      { ok: !health.slaBreached, ...summary, health },
      { status }
    );
  } catch {
    return NextResponse.json(
      { error: "Historical payroll revalidation failed." },
      { status: 500 }
    );
  }
}
