import { NextRequest, NextResponse } from "next/server";
import { getCompanyFromCookie } from "@/lib/company-auth";
import { getOrCreateCompanySettings } from "@/lib/company-settings";
import {
  createCompanyConnectedAccount,
  createOnboardingLink,
} from "@/lib/payments/stripe";
import { prisma } from "@/lib/prisma";

async function startCompanyOnboarding(req: NextRequest) {
  const company = await getCompanyFromCookie();
  if (!company) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getOrCreateCompanySettings(company.id);

  try {
    let stripeAccountId = settings.stripeAccountId;

    if (!stripeAccountId) {
      const account = await createCompanyConnectedAccount({
        email: company.adminEmail,
        country: "CA",
        companyName: company.name ?? undefined,
        companyId: company.id.toString(),
      });
      stripeAccountId = account.id;

      await prisma.companySettings.update({
        where: { id: settings.id },
        data: {
          stripeAccountId,
          companyId: company.id,
          payoutEnabled: false,
          payoutSetupStatus: "PENDING",
        },
      });
    }

    const origin = req.nextUrl.origin;
    const returnUrl = `${origin}/company-settings/payroll/return`;
    const refreshUrl = `${origin}/api/company/payroll/setup?retry=1`;

    const link = await createOnboardingLink({
      accountId: stripeAccountId,
      returnUrl,
      refreshUrl,
    });

    return NextResponse.redirect(link.url);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start payment setup" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return startCompanyOnboarding(req);
}

export async function POST(req: NextRequest) {
  return startCompanyOnboarding(req);
}
