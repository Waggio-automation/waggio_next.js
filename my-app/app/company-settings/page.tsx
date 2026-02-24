import Link from "next/link";
import CompanyBankAccountCard from "./payroll/CompanyBankAccountCard";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { getOrCreateCompanySettings } from "@/lib/company-settings";

function toUiPayoutStatus(status: string) {
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

function getSetupMessage(setup: string | undefined) {
  if (setup === "done") {
    return { tone: "ok", text: "Stripe onboarding completed. Your company can now access the dashboard." };
  }
  if (setup === "sync_error") {
    return { tone: "error", text: "Connected to Stripe, but we could not refresh account status. Please try again." };
  }
  if (setup === "missing_account") {
    return { tone: "error", text: "No Stripe account was found for this company. Please reconnect." };
  }
  return null;
}

export default async function CompanySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const company = await requireCompanyAdminOrRedirect();
  const settings = await getOrCreateCompanySettings(company.id);
  const params = await searchParams;

  const initialStatus = toUiPayoutStatus(settings?.payoutSetupStatus ?? "REQUIRED");
  const isReady = settings.stripeAccountId && settings.payoutSetupStatus === "READY" && settings.payoutEnabled;
  const setupMessage = getSetupMessage(params.setup);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        {isReady ? (
          <Link href="/" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
            <span className="mr-1 text-lg">←</span>
            Back to Dashboard
          </Link>
        ) : null}
        <div>
          <p className="text-sm text-gray-500">Company Settings</p>
          <h1 className="text-2xl font-semibold">
            {isReady ? "Stripe management" : "Complete company onboarding"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {isReady
              ? "Manage your Stripe connection, reconnect your bank account, and review status."
              : "Connect your company bank account with Stripe before accessing payroll and dashboard pages."}
          </p>
        </div>
      </header>

      {setupMessage ? (
        <section
          className={`rounded border px-4 py-3 text-sm ${
            setupMessage.tone === "ok"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {setupMessage.text}
        </section>
      ) : null}

      <CompanyBankAccountCard initialStatus={initialStatus} />
    </main>
  );
}
