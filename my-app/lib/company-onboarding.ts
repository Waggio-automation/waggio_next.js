import { redirect } from "next/navigation";
import { getOrCreateCompanySettings } from "@/lib/company-settings";
import { getCompanyFromCookie } from "@/lib/company-auth";

export type CompanyOnboardingState = {
  hasStripeAccount: boolean;
  isStripeVerified: boolean;
  payoutSetupStatus: string | null;
};

function getOnboardingState(params: {
  stripeAccountId: string | null;
  payoutSetupStatus: string | null;
  payoutEnabled: boolean;
}): CompanyOnboardingState {
  const hasStripeAccount = Boolean(params.stripeAccountId);
  const isStripeVerified =
    hasStripeAccount &&
    params.payoutEnabled &&
    params.payoutSetupStatus === "READY";

  return {
    hasStripeAccount,
    isStripeVerified,
    payoutSetupStatus: params.payoutSetupStatus,
  };
}

export async function getCompanyOnboardingState() {
  const company = await getCompanyFromCookie();
  if (!company) return null;

  const settings = await getOrCreateCompanySettings(company.id);
  const state = getOnboardingState({
    stripeAccountId: settings.stripeAccountId,
    payoutSetupStatus: settings.payoutSetupStatus ?? null,
    payoutEnabled: settings.payoutEnabled,
  });

  return { company, settings, state };
}

export async function requireStripeVerifiedCompanyOrRedirect() {
  const result = await getCompanyOnboardingState();
  if (!result) {
    redirect("/company-settings/access");
  }

  if (!result.state.isStripeVerified) {
    redirect("/company-settings");
  }

  return result;
}
