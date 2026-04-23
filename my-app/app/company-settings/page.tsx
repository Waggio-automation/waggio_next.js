import Link from "next/link";
import CompanyBankAccountCard from "./payroll/CompanyBankAccountCard";
import {
  openStripeBillingPortalAction,
  refreshStripeBillingAction,
  startStripeCheckoutAction,
} from "./actions";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { getCompanyPlans } from "@/lib/company-plans";
import {
  getOrCreateCompanySettings,
  isTrolleyEnvironmentConfigured,
  syncCompanySettingsFromConfiguration,
} from "@/lib/company-settings";
import { prisma } from "@/lib/prisma";
import { isStripeConfigured, syncCompanySubscriptionState } from "@/lib/stripe";

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
  if (setup === "account_created") {
    return {
      tone: "ok",
      text: "Account created. Choose a plan below to activate the workspace.",
    };
  }
  if (setup === "login_success") {
    return { tone: "ok", text: "Logged in successfully." };
  }
  if (setup === "plan_required") {
    return {
      tone: "error",
      text: "Choose a plan before using payroll, employees, or CRA workflows.",
    };
  }
  if (setup === "plan_saved") {
    return {
      tone: "ok",
      text: "Plan updated. You can change between Basic and Pro anytime from this page.",
    };
  }
  if (setup === "billing_connected") {
    return {
      tone: "ok",
      text: "Stripe subscription connected. Your selected plan is now active.",
    };
  }
  if (setup === "billing_updated") {
    return {
      tone: "ok",
      text: "Stripe subscription updated. Plan changes were prorated immediately by Stripe.",
    };
  }
  if (setup === "billing_refreshed") {
    return {
      tone: "ok",
      text: "Billing status refreshed from Stripe.",
    };
  }
  if (setup === "billing_cancelled") {
    return {
      tone: "error",
      text: "Stripe checkout was cancelled before the subscription was completed.",
    };
  }
  if (setup === "billing_unavailable") {
    return {
      tone: "error",
      text: "No Stripe customer or subscription is attached to this company yet.",
    };
  }
  if (setup === "stripe_missing") {
    return {
      tone: "error",
      text: "Stripe secret key is missing on the server, so billing actions are unavailable.",
    };
  }
  if (setup === "plan_invalid") {
    return { tone: "error", text: "Select a valid plan before saving." };
  }
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
  if (company.stripeSubscriptionId && isStripeConfigured()) {
    await syncCompanySubscriptionState(company.id);
  }
  const [settings, latestCompany, employees] = await Promise.all([
    getOrCreateCompanySettings(company.id),
    prisma.company.findUniqueOrThrow({
      where: { id: company.id },
    }),
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
  const plans = getCompanyPlans();
  const employeeCount = employees.length;
  const readyEmployeeCount = employees.filter((employee) => employee.payoutEnabled).length;
  const employeesNeedingPayoutSetup = employees.filter((employee) => !employee.payoutEnabled);
  const hasStripeSubscription = Boolean(latestCompany.stripeSubscriptionId);
  const stripeStatus = latestCompany.stripeSubscriptionStatus ?? "not_started";

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8 space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
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
                Choose the active plan for your company, then review whether payroll can run safely.
                You can switch between Basic and Pro anytime from this page.
              </p>
            </div>
          </div>

          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Log out
            </button>
          </form>
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

      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-gray-900">Plan selection</h2>
          <p className="text-sm text-gray-600">
            The current plan controls pricing and included payroll runs. New subscriptions start in
            Stripe Checkout, and existing subscriptions can be updated anytime.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <span className="font-medium text-gray-900">
            Billing status: {hasStripeSubscription ? stripeStatus : "not started"}
          </span>
          <span>Employees billed right now: {employeeCount}</span>
          {latestCompany.stripeCurrentPeriodEnd ? (
            <span>
              Current period ends{" "}
              {new Date(latestCompany.stripeCurrentPeriodEnd).toLocaleDateString()}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {plans.map((plan) => {
            const isCurrent = latestCompany.currentPlan === plan.code && hasStripeSubscription;

            return (
              <article
                key={plan.code}
                className={`rounded-3xl border p-6 ${
                  isCurrent ? "border-gray-900 bg-gray-50" : "border-gray-200 bg-white"
                }`}
              >
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm uppercase tracking-[0.2em] text-gray-500">{plan.name}</p>
                      {isCurrent ? (
                        <span className="rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white">
                          Current plan
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-2 text-3xl font-semibold text-gray-900">{plan.price}</h3>
                    <p className="mt-1 text-sm text-gray-600">{plan.perEmployee}</p>
                  </div>

                  <p className="text-sm leading-6 text-gray-700">{plan.description}</p>

                  <ul className="space-y-2 text-sm text-gray-700">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-gray-900" aria-hidden="true" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-700">
                    <p className="font-medium text-gray-900">Payroll runs</p>
                    <p className="mt-2 leading-6">{plan.includedRuns}</p>
                    <p className="mt-2 leading-6 text-gray-600">{plan.overage}</p>
                  </div>

                  <form action={startStripeCheckoutAction}>
                    <input type="hidden" name="plan" value={plan.code} />
                    <button
                      type="submit"
                      className={`rounded-full px-4 py-2 text-sm font-medium ${
                        isCurrent
                          ? "border border-gray-300 text-gray-500"
                          : "bg-gray-900 text-white hover:bg-gray-800"
                      }`}
                      disabled={isCurrent}
                    >
                      {isCurrent
                        ? "Selected"
                        : hasStripeSubscription
                          ? `Switch to ${plan.name}`
                          : `Start ${plan.name} subscription`}
                    </button>
                  </form>
                </div>
              </article>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3">
          <form action={refreshStripeBillingAction}>
            <button
              type="submit"
              disabled={!hasStripeSubscription}
              className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Refresh billing state
            </button>
          </form>
          <form action={openStripeBillingPortalAction}>
            <button
              type="submit"
              disabled={!latestCompany.stripeCustomerId}
              className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Open billing portal
            </button>
          </form>
        </div>

        <p className="text-xs text-gray-500">
          The current billing flow charges the monthly base fee and per-employee monthly fee through
          Stripe. Additional payroll run overages are not yet metered automatically.
        </p>
      </section>

      <CompanyBankAccountCard
        initialStatus={initialStatus}
        hasEnvironmentConfig={isTrolleyEnvironmentConfigured()}
        employeeCount={employeeCount}
        readyEmployeeCount={readyEmployeeCount}
      />

      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-gray-900">CRA payroll settings</h2>
          <p className="text-sm text-gray-600">
            Configure your payroll account number, remitter type, and reminder timing.
          </p>
        </div>
        <Link
          href="/cra/settings"
          className="shrink-0 rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Open CRA settings
        </Link>
      </section>

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
