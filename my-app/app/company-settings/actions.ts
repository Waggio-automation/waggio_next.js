"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isCompanyPlanCode } from "@/lib/company-plans";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import {
  changeCompanySubscriptionPlan,
  createBillingPortalSession,
  createPlanCheckoutSession,
  isStripeConfigured,
  syncCompanySubscriptionState,
} from "@/lib/stripe";

function asString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

export async function startStripeCheckoutAction(formData: FormData) {
  const company = await requireCompanyAdminOrRedirect();
  const plan = asString(formData.get("plan"));

  if (!isCompanyPlanCode(plan)) {
    redirect("/company-settings?setup=plan_invalid");
  }
  if (!isStripeConfigured()) {
    redirect("/company-settings?setup=stripe_missing");
  }

  const employeeCount = await prisma.employee.count({
    where: { companyId: company.id },
  });

  if (company.stripeSubscriptionId) {
    await changeCompanySubscriptionPlan({
      company,
      plan,
      employeeCount,
    });
    revalidatePath("/");
    revalidatePath("/company-settings");
    redirect("/company-settings?setup=billing_updated");
  }

  const session = await createPlanCheckoutSession({
    company,
    plan,
    employeeCount,
  });

  if (!session.url) {
    throw new Error("Stripe checkout session did not return a URL.");
  }

  redirect(session.url);
}

export async function openStripeBillingPortalAction() {
  const company = await requireCompanyAdminOrRedirect();
  if (!company.stripeCustomerId) {
    redirect("/company-settings?setup=billing_unavailable");
  }

  const session = await createBillingPortalSession(company);
  redirect(session.url);
}

export async function refreshStripeBillingAction() {
  const company = await requireCompanyAdminOrRedirect();
  if (!company.stripeSubscriptionId) {
    redirect("/company-settings?setup=billing_unavailable");
  }

  await syncCompanySubscriptionState(company.id);
  revalidatePath("/");
  revalidatePath("/company-settings");
  redirect("/company-settings?setup=billing_refreshed");
}
