import { NextRequest, NextResponse } from "next/server";
import { TrolleyApiError } from "@/lib/trolley";
import {
  configureEmployeePayout,
  employeePayoutPayloadSchema,
} from "@/lib/payments/employee-payout";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";

function parseEmployeeId(id: string) {
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const company = await requireCompanyAdminOrRedirect();
  if (!company.currentPlan) {
    return NextResponse.json(
      { error: "Choose a plan before saving payout methods." },
      { status: 402 }
    );
  }
  const { id } = await params;
  const employeeId = parseEmployeeId(id);

  if (!employeeId) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  let payload;
  try {
    payload = employeePayoutPayloadSchema.parse(await req.json());
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid payout setup payload",
      },
      { status: 400 }
    );
  }

  try {
    const updated = await configureEmployeePayout({
      companyId: company.id,
      employeeId,
      payload,
    });

    return NextResponse.json({
      ok: true,
      employeeId: updated.id.toString(),
      trolleyRecipientId: updated.trolleyRecipientId,
      trolleyRecipientAccountId: updated.trolleyRecipientAccountId,
      trolleyRecipientAccountType: updated.trolleyRecipientAccountType,
      payoutEnabled: updated.payoutEnabled,
      payoutSetupStatus: updated.payoutSetupStatus,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Employee not found") {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    if (error instanceof TrolleyApiError) {
      return NextResponse.json(
        {
          error: error.message,
          status: error.status,
          details: error.details,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to configure Trolley payout" },
      { status: 500 }
    );
  }
}
