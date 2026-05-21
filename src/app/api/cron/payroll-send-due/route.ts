import { NextResponse } from "next/server";
import { sendAllDuePayrollRunsToTrolley } from "@/lib/payments/trolley-payroll";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendAllDuePayrollRunsToTrolley();
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send due payroll runs." },
      { status: 500 }
    );
  }
}
