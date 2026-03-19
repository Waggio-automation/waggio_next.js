import { NextRequest, NextResponse } from "next/server";
import { getCompanyFromCookie } from "@/lib/company-auth";
import {
  INTERNAL_BATCH_PREFIX,
  INTERNAL_PAYOUT_COUNTRY,
  INTERNAL_PAYOUT_CURRENCY,
  isTrolleyEnvironmentConfigured,
  syncCompanySettingsFromConfiguration,
  updateCompanyPayoutConfiguration,
} from "@/lib/company-settings";

async function requireCompany() {
  const company = await getCompanyFromCookie();
  if (!company) {
    return null;
  }

  return company;
}

export async function GET() {
  const company = await requireCompany();
  if (!company) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await syncCompanySettingsFromConfiguration(company.id);

  return NextResponse.json({
    ok: true,
    payoutSetupStatus: settings.payoutSetupStatus,
    payoutEnabled: settings.payoutEnabled,
    defaultPayoutCurrency: INTERNAL_PAYOUT_CURRENCY,
    defaultPayoutCountry: INTERNAL_PAYOUT_COUNTRY,
    trolleyBatchPrefix: INTERNAL_BATCH_PREFIX,
    hasEnvironmentConfig: isTrolleyEnvironmentConfigured(),
  });
}

export async function POST(req: NextRequest) {
  const company = await requireCompany();
  if (!company) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await req.json();
  } catch {
    // Ignore request body. Company-level payout defaults are controlled internally.
  }

  const settings = await updateCompanyPayoutConfiguration(company.id, {
    defaultPayoutCurrency: INTERNAL_PAYOUT_CURRENCY,
    defaultPayoutCountry: INTERNAL_PAYOUT_COUNTRY,
    trolleyBatchPrefix: INTERNAL_BATCH_PREFIX,
  });

  return NextResponse.json({
    ok: true,
    payoutSetupStatus: settings.payoutSetupStatus,
    payoutEnabled: settings.payoutEnabled,
    defaultPayoutCurrency: INTERNAL_PAYOUT_CURRENCY,
    defaultPayoutCountry: INTERNAL_PAYOUT_COUNTRY,
    trolleyBatchPrefix: INTERNAL_BATCH_PREFIX,
    hasEnvironmentConfig: isTrolleyEnvironmentConfigured(),
  });
}
