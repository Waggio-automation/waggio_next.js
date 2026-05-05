import { redirect } from "next/navigation";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { syncCompanySubscriptionFromCheckoutSession } from "@/lib/stripe";

export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const company = await requireCompanyAdminOrRedirect();
  const params = await searchParams;
  const sessionId = params.session_id;

  if (!sessionId) {
    redirect("/company-settings?setup=billing_unavailable");
  }

  await syncCompanySubscriptionFromCheckoutSession(sessionId, company.id);
  redirect("/company-settings?setup=billing_connected");
}
