import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createCompanyConnectedAccount,
  createOnboardingLink,
  retrieveConnectedAccount,
} from "@/lib/payments/stripe";
import {
  deriveEmployeeStatusFromAccount,
  toPrismaEmployeePayoutStatus,
} from "@/lib/payments/status-mapping";

async function getOrCreateCompanySettings() {
  const existing = await prisma.companySettings.findFirst({
    orderBy: { id: "asc" },
  });

  if (existing) return existing;

  return prisma.companySettings.create({ data: {} });
}

function getCompanyEmail() {
  return (
    process.env.COMPANY_OWNER_EMAIL ||
    process.env.COMPANY_EMAIL ||
    process.env.STRIPE_COMPANY_EMAIL ||
    ""
  );
}

export async function POST(req: NextRequest) {
  const settings = await getOrCreateCompanySettings();
  const companyEmail = getCompanyEmail();

  if (!companyEmail) {
    return NextResponse.json(
      { error: "Company email is not configured. Set COMPANY_OWNER_EMAIL." },
      { status: 500 }
    );
  }

  try {
    let stripeAccountId = settings.stripeAccountId;

    if (!stripeAccountId) {
      const account = await createCompanyConnectedAccount({
        email: companyEmail,
        country: process.env.COMPANY_COUNTRY ?? "CA",
        companyName: process.env.COMPANY_NAME ?? undefined,
      });
      stripeAccountId = account.id;

      await prisma.companySettings.update({
        where: { id: settings.id },
        data: {
          stripeAccountId,
          payoutEnabled: false,
          payoutSetupStatus: "PENDING",
        },
      });
    } else {
      const account = await retrieveConnectedAccount(stripeAccountId);
      const derived = deriveEmployeeStatusFromAccount(account as unknown as Record<string, unknown>);
      await prisma.companySettings.update({
        where: { id: settings.id },
        data: {
          payoutEnabled: derived.payoutEnabled,
          payoutSetupStatus: toPrismaEmployeePayoutStatus(derived.payoutSetupStatus),
        },
      });
    }

    const origin = req.nextUrl.origin;
    const returnUrl = `${origin}/company-settings/payroll?setup=done`;
    const refreshUrl = `${origin}/company-settings/payroll?setup=retry`;

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
