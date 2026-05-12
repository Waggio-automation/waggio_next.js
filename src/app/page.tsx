// app/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { getCraDashboard } from "@/lib/cra";

function getSetupMessage(setup: string | undefined) {
  if (setup === "account_created") {
    return "Account created. Choose a plan when you open a payroll or CRA workflow.";
  }
  if (setup === "login_success") {
    return "Logged in successfully.";
  }
  return null;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const company = await requireCompanyAdminOrRedirect();
  const params = await searchParams;
  const setupMessage = getSetupMessage(params.setup);
  const hasSelectedPlan = Boolean(company.currentPlan);
  const hasProPlan = company.currentPlan === "PRO";
  const choosePlanHref = "/company-settings?setup=plan_required";
  const upgradeHref = "/company-settings?setup=upgrade_required";
  const employeesHref = "/employees";
  const paystubHref = "/payroll";
  const craHref = "/cra";
  const t4Href = "/cra/t4";

  // DB summary
  const [employeeCount, recentEmployees, craDashboard] = await Promise.all([
    prisma.employee.count({
      where: { companyId: company.id },
    }),
    prisma.employee.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        employmentType: true,
        payType: true,
        hireDate: true,
      },
    }),
    getCraDashboard(company.id),
  ]);

  const formatMoney = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 space-y-6">
      <header className="py-2">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-[0.2em] text-gray-500">Dashboard</p>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
                Waggio Payroll
              </h1>
              <p className="max-w-2xl text-sm text-gray-600">
                Review your payroll workspace, jump into the next pay run, and keep CRA tasks in
                sync from one place.
              </p>
            </div>
          </div>
          <nav className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1 text-sm lg:w-auto lg:justify-end lg:overflow-visible lg:pb-0">
            <Link
              href={employeesHref}
              className="inline-flex whitespace-nowrap rounded-full border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50 md:px-3.5"
            >
              Employees
            </Link>
            <Link
              href={paystubHref}
              className="inline-flex whitespace-nowrap rounded-full border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50 md:px-3.5"
            >
              Create Paystub
            </Link>
            <Link
              href={craHref}
              className="inline-flex whitespace-nowrap rounded-full border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50 md:px-3.5"
            >
              CRA
            </Link>
            <Link
              href="/company-settings"
              className="inline-flex whitespace-nowrap rounded-full border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50 md:px-3.5"
            >
              Company Settings
            </Link>
            <form action="/api/auth/logout" method="post" className="shrink-0">
              <button
                type="submit"
                className="inline-flex whitespace-nowrap rounded-full border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 md:px-3.5"
              >
                Log out
              </button>
            </form>
          </nav>
        </div>
      </header>

      {setupMessage ? (
        <section className="inline-flex max-w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800">
          {setupMessage}
        </section>
      ) : null}

      {!hasSelectedPlan ? (
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <p className="text-sm uppercase tracking-[0.2em] text-gray-500">Plan not selected</p>
              <h2 className="text-2xl font-semibold text-gray-900">Pick a plan when you start a workflow</h2>
              <p className="max-w-2xl text-sm text-gray-600">
                Your account is ready. Choose Basic or Pro to activate payroll and CRA workflows.
              </p>
            </div>
            <Link
              href={choosePlanHref}
              className="inline-flex w-fit whitespace-nowrap rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Choose a plan
            </Link>
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="text-sm text-gray-500">Employees</div>
          <div className="mt-2 text-3xl font-semibold text-gray-900">{employeeCount}</div>
          <div className="mt-4">
            <Link
              href="/employees?view=all"
              className="inline-flex rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              View all
            </Link>
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="text-sm text-gray-500">Quick actions</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={employeesHref}
              className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              New Employee
            </Link>
            <Link
              href={paystubHref}
              className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Create Paystub
            </Link>
            <Link
              href={craHref}
              className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Open CRA
            </Link>
            <Link
              href={t4Href}
              className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              T4
            </Link>
          </div>
        </div>

        {hasProPlan ? (
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="text-sm text-gray-500">CRA summary</div>
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-3xl font-semibold text-gray-900">
                {formatMoney.format(craDashboard.outstandingTotal.toNumber())}
              </p>
              <p className="text-gray-600">
                {craDashboard.nextDue
                  ? `Next CRA payment due ${new Date(craDashboard.nextDue.dueDate).toLocaleDateString()}`
                  : "No open remittance yet"}
              </p>
              <Link
                href={craHref}
                className="inline-flex rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                View CRA workspace
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-gray-500">CRA summary</div>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                Pro
              </span>
            </div>
            <div className="mt-3 space-y-3 text-sm">
              <p className="text-2xl font-semibold text-gray-900">Available on Pro</p>
              <p className="text-gray-600">
                Upgrade to track CRA remittances, payment deadlines, and T4 filing from your dashboard.
              </p>
              <Link
                href={hasSelectedPlan ? upgradeHref : choosePlanHref}
                className="inline-flex rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                {hasSelectedPlan ? "Upgrade to Pro" : "Choose Pro"}
              </Link>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent employees</h2>
          <p className="mt-1 text-sm text-gray-600">
            The latest employee profiles added to your payroll workspace.
          </p>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left p-3 px-6">Name</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Employment</th>
                <th className="text-left p-3">Pay Type</th>
                <th className="text-left p-3 pr-6">Hire Date</th>
                <th className="text-left p-3 pr-6">Edit</th>
              </tr>
            </thead>
            <tbody>
              {recentEmployees.map((e) => (
                <tr key={e.id.toString()} className="border-t border-gray-100">
                  <td className="p-3 px-6 font-medium text-gray-900">
                    {e.firstName} {e.lastName}
                  </td>
                  <td className="p-3 text-gray-700">{e.email}</td>
                  <td className="p-3 text-gray-700">{e.employmentType}</td>
                  <td className="p-3 text-gray-700">{e.payType}</td>
                  <td className="p-3 pr-6 text-gray-700">
                    {new Date(e.hireDate).toLocaleDateString()}
                  </td>
                  <td className="p-3 pr-6">
                    <Link
                      href={`/employees/${e.id.toString()}`}
                      className="inline-flex rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
              {recentEmployees.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-gray-500" colSpan={6}>
                    No employees yet.{" "}
                    <Link className="font-medium text-gray-900 underline" href={employeesHref}>
                      Create one
                    </Link>
                    .
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
