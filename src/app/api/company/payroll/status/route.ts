import { NextResponse } from "next/server";
import { getCompanyFromCookie } from "@/lib/company-auth";
import {
  getOrCreateCompanySettings,
  INTERNAL_BATCH_PREFIX,
  INTERNAL_PAYOUT_COUNTRY,
  INTERNAL_PAYOUT_CURRENCY,
  isTrolleyEnvironmentConfigured,
  syncCompanySettingsFromConfiguration,
} from "@/lib/company-settings";

function toUiStatus(status: string | null | undefined) {
  switch (status) {
    case "REQUIRED":
      return "required" as const;
    case "PENDING":
      return "pending" as const;
    case "READY":
      return "ready" as const;
    case "ISSUE":
      return "issue" as const;
    default:
      return "required" as const;
  }
}

export async function GET() {
  const company = await getCompanyFromCookie();
  if (!company) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await syncCompanySettingsFromConfiguration(company.id);
  const settings = await getOrCreateCompanySettings(company.id);

  return NextResponse.json({
    payoutSetupStatus: toUiStatus(settings.payoutSetupStatus),
    payoutEnabled: settings.payoutEnabled,
    defaultPayoutCurrency: INTERNAL_PAYOUT_CURRENCY,
    defaultPayoutCountry: INTERNAL_PAYOUT_COUNTRY,
    trolleyBatchPrefix: INTERNAL_BATCH_PREFIX,
    hasEnvironmentConfig: isTrolleyEnvironmentConfigured(),
  });
}
