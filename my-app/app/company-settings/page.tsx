import Link from "next/link";
import CompanyBankAccountCard from "./payroll/CompanyBankAccountCard";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import {
  getOrCreateCompanySettings,
  isTrolleyEnvironmentConfigured,
  syncCompanySettingsFromConfiguration,
} from "@/lib/company-settings";
import { prisma } from "@/lib/prisma";

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
  if (setup === "verified") {
    return { tone: "ok", text: "Admin access verified. You can now review payroll readiness." };
  }
  if (setup === "done" || setup === "saved") {
    return { tone: "ok", text: "Payroll readiness refreshed." };
  }
  if (setup === "env_missing") {
    return {
      tone: "error",
      text: "Payroll provider credentials must be configured on the server before payouts can run.",
    };
  }
  return null;
}

export default async function CompanySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const company = await requireCompanyAdminOrRedirect();
  await syncCompanySettingsFromConfiguration(company.id);
  const [settings, employees] = await Promise.all([
    getOrCreateCompanySettings(company.id),
    prisma.employee.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        payoutEnabled: true,
        payoutSetupStatus: true,
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
  ]);
  const params = await searchParams;

  const initialStatus = toUiPayoutStatus(settings.payoutSetupStatus ?? "REQUIRED");
  const isReady = settings.payoutSetupStatus === "READY" && settings.payoutEnabled;
  const setupMessage = getSetupMessage(params.setup);
  const employeeCount = employees.length;
  const readyEmployeeCount = employees.filter((employee) => employee.payoutEnabled).length;
  const employeesNeedingPayoutSetup = employees.filter((employee) => !employee.payoutEnabled);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8 space-y-6">
      <header className="space-y-3">
        {isReady ? (
          <Link href="/" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
            <span className="mr-1 text-lg">←</span>
            Back to Dashboard
          </Link>
        ) : null}
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.2em] text-gray-500">Company Settings</p>
          <h1 className="text-3xl font-semibold text-gray-900">
            {isReady ? "Payroll readiness" : "Prepare payroll"}
          </h1>
          <p className="max-w-2xl text-sm text-gray-600">
            Review whether payroll can run safely for your company. Provider configuration is handled
            internally; your team only needs to make sure employee payout methods are complete.
          </p>
        </div>
      </header>

      {setupMessage ? (
        <section
          className={`rounded-2xl border px-4 py-3 text-sm ${
            setupMessage.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {setupMessage.text}
        </section>
      ) : null}

      <CompanyBankAccountCard
        initialStatus={initialStatus}
        hasEnvironmentConfig={isTrolleyEnvironmentConfigured()}
        employeeCount={employeeCount}
        readyEmployeeCount={readyEmployeeCount}
      />

      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-gray-900">Employees needing payout setup</h2>
          <p className="text-sm text-gray-600">
            Review the employees below before running payroll. Each link opens the employee profile so
            you can finish their payout method.
          </p>
        </div>

        {employeesNeedingPayoutSetup.length === 0 ? (
          <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            All employees currently have a payout method configured.
          </div>
        ) : (
          <div className="space-y-3">
            {employeesNeedingPayoutSetup.map((employee) => (
              <div
                key={employee.id.toString()}
                className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 px-4 py-3"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-900">
                    {employee.firstName} {employee.lastName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {employee.payoutSetupStatus === "PENDING"
                      ? "Recipient created, but payout account setup is incomplete."
                      : employee.payoutSetupStatus === "ISSUE"
                        ? "Payout setup needs attention."
                        : "No payout method configured yet."}
                  </p>
                </div>
                <Link
                  href={`/employees/${employee.id.toString()}`}
                  className="shrink-0 rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Open employee
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
