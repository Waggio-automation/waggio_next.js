// app/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireTrolleyReadyCompanyOrRedirect } from "@/lib/company-onboarding";
import { getCraDashboard } from "@/lib/cra";

export default async function HomePage() {
  const onboarding = await requireTrolleyReadyCompanyOrRedirect();

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
    <main className="max-w-6xl mx-auto p-6 space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Waggio Payroll</h1>
        <nav className="flex gap-3">
          <Link href="/employees" className="underline">Employees</Link>
          <Link href="/payroll" className="underline">Create Paystub</Link>
          <Link href="/cra" className="underline">CRA</Link>
          <Link href="/company-settings" className="underline">Company Settings</Link>
        </nav>
      </header>

      {/* KPI cards */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="border rounded-lg p-4">
          <div className="text-sm text-gray-500">Employees</div>
          <div className="text-3xl font-semibold mt-1">{employeeCount}</div>
          <div className="mt-3">
            <Link href="/employees?view=all" className="text-sm underline">
              View all →
            </Link>
          </div>
        </div>

        {/* 필요 시 다른 KPI 박스 추가 가능 */}
        <div className="border rounded-lg p-4">
          <div className="text-sm text-gray-500">Quick actions</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/employees" className="border rounded px-3 py-1 hover:bg-gray-50">New Employee</Link>
            <Link href="/payroll" className="border rounded px-3 py-1 hover:bg-gray-50">Create Paystub</Link>
            <Link href="/cra" className="border rounded px-3 py-1 hover:bg-gray-50">Open CRA</Link>
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <div className="text-sm text-gray-500">CRA summary</div>
          <div className="mt-2 space-y-2 text-sm">
            <p className="text-2xl font-semibold text-gray-900">
              {formatMoney.format(craDashboard.outstandingTotal.toNumber())}
            </p>
            <p className="text-gray-600">
              {craDashboard.nextDue
                ? `Next CRA payment due ${new Date(craDashboard.nextDue.dueDate).toLocaleDateString()}`
                : "No open remittance yet"}
            </p>
            <Link href="/cra" className="inline-flex rounded border px-3 py-1 hover:bg-gray-50">
              View CRA workspace
            </Link>
          </div>
        </div>


      </section>

      {/* Recent employees */}
      <section className="border rounded-lg overflow-auto">
        <div className="p-4 border-b">
          <h2 className="text-lg font-medium">Recent employees</h2>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Employment</th>
              <th className="text-left p-3">Pay Type</th>
              <th className="text-left p-3">Hire Date</th>
            </tr>
          </thead>
          <tbody>
            {recentEmployees.map(e => (
              <tr key={e.id.toString()} className="border-t">
                <td className="p-3">{e.firstName} {e.lastName}</td>
                <td className="p-3">{e.email}</td>
                <td className="p-3">{e.employmentType}</td>
                <td className="p-3">{e.payType}</td>
                <td className="p-3">{new Date(e.hireDate).toLocaleDateString()}</td>
              </tr>
            ))}
            {recentEmployees.length === 0 && (
              <tr>
                <td className="p-6 text-center text-gray-500" colSpan={5}>
                  No employees yet. <Link className="underline" href="/employees">Create one</Link>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
