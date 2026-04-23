// app/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireTrolleyReadyCompanyOrRedirect } from "@/lib/company-onboarding";
import { getCompanyPlans } from "@/lib/company-plans";
import { getCraDashboard } from "@/lib/cra";

export default async function HomePage() {
  const onboarding = await requireTrolleyReadyCompanyOrRedirect();
  const plans = getCompanyPlans();

  // DB summary
  const [employeeCount, recentEmployees, craDashboard] = await Promise.all([
    prisma.employee.count(),
    prisma.employee.findMany({
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
    getCraDashboard(onboarding.company.id),
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
          <nav className="flex flex-wrap items-center gap-2 text-sm md:flex-nowrap md:justify-end">
            <Link
              href="/employees"
              className="rounded-full border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50 md:px-3.5"
            >
              Employees
            </Link>
            <Link
              href="/payroll"
              className="whitespace-nowrap rounded-full border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50 md:px-3.5"
            >
              Create Paystub
            </Link>
            <Link
              href="/cra"
              className="rounded-full border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50 md:px-3.5"
            >
              CRA
            </Link>
            <Link
              href="/company-settings"
              className="whitespace-nowrap rounded-full border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50 md:px-3.5"
            >
              Company Settings
            </Link>
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="rounded-full border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50 md:px-3.5"
              >
                Log out
              </button>
            </form>
          </nav>
        </div>
      </header>

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
              href="/employees"
              className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              New Employee
            </Link>
            <Link
              href="/payroll"
              className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Create Paystub
            </Link>
            <Link
              href="/cra"
              className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Open CRA
            </Link>
          </div>
        </div>

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
              href="/cra"
              className="inline-flex rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              View CRA workspace
            </Link>
          </div>
        </div>
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
                </tr>
              ))}
              {recentEmployees.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-gray-500" colSpan={5}>
                    No employees yet.{" "}
                    <Link className="font-medium text-gray-900 underline" href="/employees">
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

      <section className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.2em] text-gray-500">Pricing</p>
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900">
              Plans for payroll and CRA workflows
            </h2>
            <p className="max-w-3xl text-sm text-gray-600">
              Compare the included payroll runs, automation coverage, and extra-run pricing for
              each plan.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {plans.map((plan) => (
            <article
              key={plan.code}
              className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="space-y-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-gray-500">{plan.name}</p>
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
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
