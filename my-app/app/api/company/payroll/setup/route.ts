import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanyFromCookie } from "@/lib/company-auth";
import { getOrCreateCompanySettings } from "@/lib/company-settings";
import {
  createCompanyConnectedAccount,
  createOnboardingLink,
  retrieveConnectedAccount,
} from "@/lib/payments/stripe";
import {
  deriveEmployeeStatusFromAccount,
  toPrismaEmployeePayoutStatus,
} from "@/lib/payments/status-mapping";

export async function POST(req: NextRequest) {
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
        country: process.env.COMPANY_COUNTRY ?? "CA",
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
    } else {
      const account = await retrieveConnectedAccount(stripeAccountId);
      const derived = deriveEmployeeStatusFromAccount(account as unknown as Record<string, unknown>);
      await prisma.companySettings.update({
        where: { id: settings.id },
        data: {
          companyId: company.id,
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
