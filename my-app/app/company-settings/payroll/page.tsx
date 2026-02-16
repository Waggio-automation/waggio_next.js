import Link from "next/link";
import CompanyBankAccountCard from "./CompanyBankAccountCard";
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

export default async function CompanyPayrollSettingsPage() {
  const company = await requireCompanyAdminOrRedirect();
  const settings = await getOrCreateCompanySettings(company.id);

  const initialStatus = toUiPayoutStatus(settings?.payoutSetupStatus ?? "REQUIRED");

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        <Link href="/" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
          <span className="mr-1 text-lg">←</span>
          Back to Home
        </Link>
        <div>
          <p className="text-sm text-gray-500">Company Settings</p>
          <h1 className="text-2xl font-semibold">Payroll Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Connect the business owner&apos;s bank account to fund payroll runs.
          </p>
        </div>
      </header>

      <CompanyBankAccountCard initialStatus={initialStatus} />
    </main>
  );
}
