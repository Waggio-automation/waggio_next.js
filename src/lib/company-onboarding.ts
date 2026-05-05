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

export type PlanRequiredFeature = "employees" | "paystub" | "cra" | "t4";

function getPlanRequiredRedirect(feature?: PlanRequiredFeature) {
  const params = new URLSearchParams({ setup: "plan_required" });
  if (feature) {
    params.set("feature", feature);
  }
  return `/company-settings?${params.toString()}`;
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

export async function requirePlanSelectedCompanyOrRedirect(feature?: PlanRequiredFeature) {
  const result = await getCompanyOnboardingState();
  if (!result) {
    redirect("/company-settings/access");
  }

  if (!result.state.hasSelectedPlan) {
    redirect(getPlanRequiredRedirect(feature));
  }

  return result;
}

export async function requireTrolleyReadyCompanyOrRedirect(feature?: PlanRequiredFeature) {
  const result = await getCompanyOnboardingState();
  if (!result) {
    redirect("/company-settings/access");
  }

  if (!result.state.hasSelectedPlan) {
    redirect(getPlanRequiredRedirect(feature));
  }

  if (!result.state.isTrolleyReady) {
    redirect("/company-settings");
  }

  return result;
}
