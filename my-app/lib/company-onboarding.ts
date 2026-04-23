import { redirect } from "next/navigation";
import { getOrCreateCompanySettings } from "@/lib/company-settings";
import { getCompanyFromCookie } from "@/lib/company-auth";

export type CompanyOnboardingState = {
  hasSelectedPlan: boolean;
  currentPlan: string | null;
  hasTrolleyConfiguration: boolean;
  isTrolleyReady: boolean;
  payoutSetupStatus: string | null;
};

function getOnboardingState(params: {
  currentPlan: string | null;
  payoutSetupStatus: string | null;
  payoutEnabled: boolean;
}): CompanyOnboardingState {
  const hasSelectedPlan = Boolean(params.currentPlan);
  const hasTrolleyConfiguration = params.payoutSetupStatus !== "REQUIRED";
  const isTrolleyReady =
    hasSelectedPlan && params.payoutEnabled && params.payoutSetupStatus === "READY";

  return {
    hasSelectedPlan,
    currentPlan: params.currentPlan,
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
    currentPlan: company.currentPlan ?? null,
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

  if (!result.state.hasSelectedPlan) {
    redirect("/company-settings?setup=plan_required");
  }

  if (!result.state.isTrolleyReady) {
    redirect("/company-settings");
  }

  return result;
}
