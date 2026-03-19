import { redirect } from "next/navigation";
import { getOrCreateCompanySettings } from "@/lib/company-settings";
import { getCompanyFromCookie } from "@/lib/company-auth";

export type CompanyOnboardingState = {
  hasTrolleyConfiguration: boolean;
  isTrolleyReady: boolean;
  payoutSetupStatus: string | null;
};

function getOnboardingState(params: {
  payoutSetupStatus: string | null;
  payoutEnabled: boolean;
}): CompanyOnboardingState {
  const hasTrolleyConfiguration = params.payoutSetupStatus !== "REQUIRED";
  const isTrolleyReady = params.payoutEnabled && params.payoutSetupStatus === "READY";

  return {
    hasTrolleyConfiguration,
    isTrolleyReady,
    payoutSetupStatus: params.payoutSetupStatus,
  };
}

export async function getCompanyOnboardingState() {
  const company = await getCompanyFromCookie();
  if (!company) return null;

  const settings = await getOrCreateCompanySettings(company.id);
  const state = getOnboardingState({
    payoutSetupStatus: settings.payoutSetupStatus ?? null,
    payoutEnabled: settings.payoutEnabled,
  });

  return { company, settings, state };
}

export async function requireTrolleyReadyCompanyOrRedirect() {
  const result = await getCompanyOnboardingState();
  if (!result) {
    redirect("/company-settings/access");
  }

  if (!result.state.isTrolleyReady) {
    redirect("/company-settings");
  }

  return result;
}
