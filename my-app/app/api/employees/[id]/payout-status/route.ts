import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { retrieveConnectedAccount } from "@/lib/payments/stripe";
import {
  deriveEmployeeStatusFromAccount,
  toPrismaEmployeePayoutStatus,
} from "@/lib/payments/status-mapping";

function parseEmployeeId(id: string) {
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

function toUiStatus(status: string) {
  switch (status) {
    case "REQUIRED":
      return "required";
    case "PENDING":
      return "pending";
    case "READY":
      return "ready";
    case "ISSUE":
      return "issue";
    default:
      return "required";
  }
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const employeeId = parseEmployeeId(id);

  if (!employeeId) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      stripeAccountId: true,
      payoutEnabled: true,
      payoutSetupStatus: true,
    },
  });

  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  if (!employee.stripeAccountId) {
    return NextResponse.json({
      employeeId: employee.id.toString(),
      payoutSetupStatus: "required",
      payoutEnabled: false,
    });
  }

  try {
    const account = await retrieveConnectedAccount(employee.stripeAccountId);
    const derived = deriveEmployeeStatusFromAccount(account as unknown as Record<string, unknown>);

    const updated = await prisma.employee.update({
      where: { id: employee.id },
      data: {
        payoutSetupStatus: toPrismaEmployeePayoutStatus(derived.payoutSetupStatus),
        payoutEnabled: derived.payoutEnabled,
      },
      select: {
        id: true,
        payoutSetupStatus: true,
        payoutEnabled: true,
      },
    });

    return NextResponse.json({
      employeeId: updated.id.toString(),
      payoutSetupStatus: toUiStatus(updated.payoutSetupStatus),
      payoutEnabled: updated.payoutEnabled,
    });
  } catch {
    return NextResponse.json({
      employeeId: employee.id.toString(),
      payoutSetupStatus: toUiStatus(employee.payoutSetupStatus),
      payoutEnabled: employee.payoutEnabled,
    });
  }
}
