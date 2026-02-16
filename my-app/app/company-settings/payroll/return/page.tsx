import { redirect } from "next/navigation";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { getOrCreateCompanySettings, syncCompanySettingsFromAccount } from "@/lib/company-settings";
import { retrieveConnectedAccount } from "@/lib/payments/stripe";

export default async function CompanyPayrollReturnPage() {
  const company = await requireCompanyAdminOrRedirect();
  const settings = await getOrCreateCompanySettings(company.id);

  if (!settings.stripeAccountId) {
    redirect("/company-settings/payroll?setup=missing_account");
  }

  try {
    // Stripe sends users here after onboarding; refresh persisted status before UI render.
    const account = await retrieveConnectedAccount(settings.stripeAccountId);
    await syncCompanySettingsFromAccount({
      companyId: company.id,
      stripeAccountId: settings.stripeAccountId,
      account: account as unknown as Record<string, unknown>,
    });
  } catch {
    redirect("/company-settings/payroll?setup=sync_error");
  }

  redirect("/company-settings/payroll?setup=done");
}
