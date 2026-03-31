import { prisma } from "@/lib/prisma";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { generateT4Action } from "../actions";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

function formatDate(value: Date | null) {
  if (!value) return "Not generated";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

export default async function T4ManagementPage() {
  const company = await requireCompanyAdminOrRedirect();
  const currentYear = new Date().getFullYear();

  const [summaries, slips] = await Promise.all([
    prisma.t4Summary.findMany({
      where: { companyId: company.id },
      orderBy: [{ taxYear: "desc" }],
    }),
    prisma.t4Slip.findMany({
      where: { companyId: company.id },
      orderBy: [{ taxYear: "desc" }, { employee: { firstName: "asc" } }],
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        documents: {
          orderBy: { uploadedAt: "desc" },
          take: 1,
        },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Generate year-end T4 package</h2>
            <p className="mt-2 text-sm text-gray-600">
              This creates one T4 slip per employee plus a company-level T4 summary.
            </p>
          </div>
          <form action={generateT4Action} className="flex items-center gap-3">
            <input
              type="number"
              name="taxYear"
              defaultValue={currentYear}
              className="rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
            <button
              type="submit"
              className="rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Generate now
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-900">T4 summaries</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-gray-500">
              <tr>
                <th className="py-3 pr-3">Tax year</th>
                <th className="py-3 pr-3">Employees</th>
                <th className="py-3 pr-3">Employment income</th>
                <th className="py-3 pr-3">Income tax</th>
                <th className="py-3 pr-3">Status</th>
                <th className="py-3">Generated</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((summary) => (
                <tr key={summary.id.toString()} className="border-b border-gray-100 last:border-0">
                  <td className="py-3 pr-3 font-medium text-gray-900">{summary.taxYear}</td>
                  <td className="py-3 pr-3 text-gray-700">{summary.employeeCount}</td>
                  <td className="py-3 pr-3 text-gray-700">
                    {formatMoney(summary.totalEmploymentIncome.toNumber())}
                  </td>
                  <td className="py-3 pr-3 text-gray-700">
                    {formatMoney(summary.totalIncomeTaxDeducted.toNumber())}
                  </td>
                  <td className="py-3 pr-3 text-gray-700">{summary.status}</td>
                  <td className="py-3 text-gray-700">{formatDate(summary.generatedAt)}</td>
                </tr>
              ))}
              {summaries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-gray-500">
                    No T4 summary has been generated yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-900">Employee T4 slips</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-gray-500">
              <tr>
                <th className="py-3 pr-3">Employee</th>
                <th className="py-3 pr-3">Tax year</th>
                <th className="py-3 pr-3">Employment income</th>
                <th className="py-3 pr-3">CPP</th>
                <th className="py-3 pr-3">EI</th>
                <th className="py-3 pr-3">Income tax</th>
                <th className="py-3">Document</th>
              </tr>
            </thead>
            <tbody>
              {slips.map((slip) => (
                <tr key={slip.id.toString()} className="border-b border-gray-100 last:border-0">
                  <td className="py-3 pr-3 text-gray-900">
                    {slip.employee.firstName} {slip.employee.lastName}
                  </td>
                  <td className="py-3 pr-3 text-gray-700">{slip.taxYear}</td>
                  <td className="py-3 pr-3 text-gray-700">
                    {formatMoney(slip.employmentIncome.toNumber())}
                  </td>
                  <td className="py-3 pr-3 text-gray-700">
                    {formatMoney(slip.cppContributionsEmployee.toNumber())}
                  </td>
                  <td className="py-3 pr-3 text-gray-700">
                    {formatMoney(slip.eiPremiumsEmployee.toNumber())}
                  </td>
                  <td className="py-3 pr-3 text-gray-700">
                    {formatMoney(slip.incomeTaxDeducted.toNumber())}
                  </td>
                  <td className="py-3 text-gray-700">
                    {slip.documents[0]?.storagePath ?? "No file"}
                  </td>
                </tr>
              ))}
              {slips.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-gray-500">
                    No employee T4 slips generated yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
