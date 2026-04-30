import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRecipient } from "@/lib/trolley";
import {
  deriveEmployeeStatusFromTrolleyRecipient,
  toPrismaEmployeePayoutStatus,
} from "@/lib/payments/status-mapping";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";

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
  const company = await requireCompanyAdminOrRedirect();
  const { id } = await params;
  const employeeId = parseEmployeeId(id);

  if (!employeeId) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId, companyId: company.id },
    select: {
      id: true,
      trolleyRecipientId: true,
      trolleyRecipientAccountId: true,
      trolleyRecipientAccountType: true,
      payoutEnabled: true,
      payoutSetupStatus: true,
    },
  });

  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  if (!employee.trolleyRecipientId) {
    return NextResponse.json({
      employeeId: employee.id.toString(),
      payoutSetupStatus: "required",
      payoutEnabled: false,
      payoutMethod: null,
    });
  }

  try {
    await getRecipient(employee.trolleyRecipientId);

    const derived = deriveEmployeeStatusFromTrolleyRecipient({
      recipientId: employee.trolleyRecipientId,
      recipientAccountId: employee.trolleyRecipientAccountId,
    });

    const updated = await prisma.employee.update({
      where: { id: employee.id, companyId: company.id },
      data: {
        payoutSetupStatus: toPrismaEmployeePayoutStatus(derived.payoutSetupStatus),
        payoutEnabled: derived.payoutEnabled,
      },
      select: {
        id: true,
        payoutSetupStatus: true,
        payoutEnabled: true,
        trolleyRecipientAccountType: true,
      },
    });

    return NextResponse.json({
      employeeId: updated.id.toString(),
      payoutSetupStatus: toUiStatus(updated.payoutSetupStatus),
      payoutEnabled: updated.payoutEnabled,
      payoutMethod: updated.trolleyRecipientAccountType,
    });
  } catch {
    await prisma.employee.update({
      where: { id: employee.id, companyId: company.id },
      data: {
        payoutSetupStatus: "ISSUE",
        payoutEnabled: false,
      },
    });

    return NextResponse.json({
      employeeId: employee.id.toString(),
      payoutSetupStatus: "issue",
      payoutEnabled: false,
      payoutMethod: employee.trolleyRecipientAccountType,
    });
  }
}
