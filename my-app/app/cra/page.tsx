import Link from "next/link";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { getCraDashboard, getReminderState } from "@/lib/cra";
import { generateT4Action, syncRemittancesAction } from "./actions";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function formatMonthYear(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatDashboardDocumentLabel(document: {
  documentType: string;
  fileName: string;
  taxYear: number | null;
}) {
  if (document.documentType === "T4_SUMMARY") {
    return document.taxYear ? `${document.taxYear} T4 summary` : "T4 summary";
  }

  if (document.documentType === "REMITTANCE_REPORT") {
    const match = document.fileName.match(/remittance-(\d{4}-\d{2})-\d{2}-\d{4}-\d{2}-\d{2}\.json$/);
    if (match) {
      return `${formatMonthYear(match[1])} remittance report`;
    }
    return "Remittance report";
  }

  return document.fileName;
}

function formatDashboardDocumentMeta(document: {
  documentType: string;
  taxYear: number | null;
}) {
  if (document.documentType === "T4_SUMMARY") {
    return document.taxYear ? `Year-end filing for ${document.taxYear}` : "Year-end filing";
  }

  if (document.documentType === "REMITTANCE_REPORT") {
    return "Payroll remittance filing";
  }

  return document.documentType.replaceAll("_", " ");
}

function badgeTone(status: string) {
  if (status === "PAID") return "bg-emerald-100 text-emerald-800";
  if (status === "PARTIALLY_PAID") return "bg-sky-100 text-sky-800";
  if (status === "OVERDUE") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

function formatStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export default async function CraDashboardPage() {
  const company = await requireCompanyAdminOrRedirect();
  const dashboard = await getCraDashboard(company.id);
  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">Outstanding CRA balance</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">
            {formatMoney(dashboard.outstandingTotal.toNumber())}
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Always shown as the amount still unpaid across open remittance periods.
          </p>
        </div>
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">Next payment due</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">
            {dashboard.nextDue ? formatDate(dashboard.nextDue.dueDate) : "No open remittance"}
          </p>
          <p className="mt-2 text-sm text-gray-600">
            {dashboard.nextDue
              ? `${formatMoney(dashboard.nextDue.totalPayable.toNumber())} is due for ${formatDate(dashboard.nextDue.periodStart)} to ${formatDate(dashboard.nextDue.periodEnd)}.`
              : "Payroll remittance periods will appear here after payroll is processed."}
          </p>
        </div>
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">Overdue items</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{dashboard.overdueCount}</p>
          <p className="mt-2 text-sm text-gray-600">
            This count turns red in the remittance list when a due date passes without payment.
          </p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Regular CRA payments</h2>
              <p className="text-sm text-gray-600">
                This is your remittance workflow. It is separate from year-end T4 filing.
              </p>
            </div>
            <form action={syncRemittancesAction}>
              <button
                type="submit"
                className="rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Refresh remittances
              </button>
            </form>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-200 text-left text-gray-500">
                <tr>
                  <th className="py-3 pr-3">Period</th>
                  <th className="py-3 pr-3">Due</th>
                  <th className="py-3 pr-3">Total</th>
                  <th className="py-3 pr-3">Employees</th>
                  <th className="py-3 pr-3">Status</th>
                  <th className="py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.remittances.map((item) => (
                  <tr key={item.id.toString()} className="border-b border-gray-100 last:border-0">
                    <td className="py-3 pr-3 text-gray-900">
                      {formatDate(item.periodStart)} to {formatDate(item.periodEnd)}
                    </td>
                    <td className="py-3 pr-3 text-gray-700">{formatDate(item.dueDate)}</td>
                    <td className="py-3 pr-3 font-medium text-gray-900">
                      {formatMoney(item.totalPayable.toNumber())}
                    </td>
                    <td className="py-3 pr-3 text-gray-700">{item.employeeCount}</td>
                    <td className="py-3 pr-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeTone(item.status)}`}>
                        {formatStatusLabel(item.status)}
                      </span>
                    </td>
                    <td className="py-3">
                      <Link
                        href={`/cra/remittances/${item.id.toString()}`}
                        className="text-sm font-medium text-gray-900 underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
                {dashboard.remittances.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-gray-500">
                      No remittances yet. Run payroll, then refresh this page.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Year-end T4s</h2>
            <p className="mt-2 text-sm text-gray-600">
              Generate T4 slips and your T4 summary after the year is complete.
            </p>
            <form action={generateT4Action} className="mt-4 space-y-3">
              <input
                type="number"
                name="taxYear"
                defaultValue={currentYear}
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
              />
              <button
                type="submit"
                className="w-full rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Generate T4 package
              </button>
            </form>
            <Link href="/cra/t4" className="mt-4 inline-block text-sm font-medium text-gray-900 underline">
              Review T4 records
            </Link>
          </section>

          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Upcoming reminders</h2>
            <div className="mt-4 space-y-3">
              {dashboard.remittances.slice(0, 4).map((item) => (
                <div key={item.id.toString()} className="rounded-2xl bg-gray-50 px-4 py-3">
                  <p className="text-sm font-medium text-gray-900">
                    {getReminderState(item).replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    Pay {formatMoney(item.totalPayable.toNumber())} by {formatDate(item.dueDate)}.
                  </p>
                </div>
              ))}
              {dashboard.remittances.length === 0 ? (
                <p className="text-sm text-gray-500">No reminder events yet.</p>
              ) : null}
            </div>
          </section>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">Document archive</h2>
          <div className="mt-4 space-y-3">
            {dashboard.documents.map((document) => (
              <div key={document.id.toString()} className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{formatDashboardDocumentLabel(document)}</p>
                  <p className="text-xs text-gray-500">{formatDashboardDocumentMeta(document)}</p>
                </div>
                <span className="text-xs text-gray-500">{formatDate(document.uploadedAt)}</span>
              </div>
            ))}
            {dashboard.documents.length === 0 ? (
              <p className="text-sm text-gray-500">Generated remittance reports and T4 files will appear here.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">Activity log</h2>
          <div className="mt-4 space-y-3">
            {dashboard.auditLogs.map((entry) => (
              <div key={entry.id.toString()} className="rounded-2xl bg-gray-50 px-4 py-3">
                <p className="text-sm font-medium text-gray-900">{entry.action.replaceAll("_", " ")}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {entry.targetType} #{entry.targetId} on {formatDate(entry.createdAt)}
                </p>
              </div>
            ))}
            {dashboard.auditLogs.length === 0 ? (
              <p className="text-sm text-gray-500">Payment and generation actions will be tracked here.</p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
