import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createConnectedAccount,
  createOnboardingLink,
  retrieveConnectedAccount,
} from "@/lib/payments/stripe";
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

export async function POST(
  req: NextRequest,
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
      email: true,
      stripeAccountId: true,
      payoutSetupStatus: true,
      payoutEnabled: true,
      addrCountry: true,
    },
  });

  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  try {
    let stripeAccountId = employee.stripeAccountId;

    if (!stripeAccountId) {
      const account = await createConnectedAccount({
        employeeId: employee.id.toString(),
        email: employee.email,
        country: employee.addrCountry || "CA",
      });
      stripeAccountId = account.id;

      await prisma.employee.update({
        where: { id: employee.id },
        data: {
          stripeAccountId,
          payoutEnabled: false,
          payoutSetupStatus: "PENDING",
        },
      });
    } else {
      const account = await retrieveConnectedAccount(stripeAccountId);
      const derived = deriveEmployeeStatusFromAccount(account as unknown as Record<string, unknown>);
      await prisma.employee.update({
        where: { id: employee.id },
        data: {
          payoutEnabled: derived.payoutEnabled,
          payoutSetupStatus: toPrismaEmployeePayoutStatus(derived.payoutSetupStatus),
        },
      });
    }

    const origin = req.nextUrl.origin;
    const returnUrl = `${origin}/employees/${employee.id.toString()}?payout=done`;
    const refreshUrl = `${origin}/employees/${employee.id.toString()}?payout=retry`;

    const link = await createOnboardingLink({
      accountId: stripeAccountId,
      returnUrl,
      refreshUrl,
    });

    return NextResponse.json({
      ok: true,
      onboardingUrl: link.url,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start payment setup" },
      { status: 500 }
    );
  }
}
