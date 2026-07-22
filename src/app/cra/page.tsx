import Link from "next/link";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { getCraDashboard, getMissingT4FilingSettings, getReminderState } from "@/lib/cra";
import { generateT4Action, syncRemittancesAction } from "./actions";
import PlanRequiredButton from "@/app/components/PlanRequiredButton";
import {
  formatUtcDateOnly,
  CRA_OPERATIONAL_TIME_ZONE,
  getDateOnlyCalendarYear,
  getTodayUtcDateOnly,
  parseUtcDateOnly,
} from "@/lib/date-only";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

function formatDate(value: Date) {
  return formatUtcDateOnly(value, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatInstantDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: CRA_OPERATIONAL_TIME_ZONE,
  }).format(value);
}

function formatMonthYear(value: string) {
  return formatUtcDateOnly(parseUtcDateOnly(`${value}-01`), {
    month: "long",
    year: "numeric",
  });
}

function formatDashboardDocumentLabel(document: {
  documentType: string;
  fileName: string;
  taxYear: number | null;
  mimeType: string;
}) {
  if (document.documentType === "T4_SUMMARY") {
    return document.taxYear ? `${document.taxYear} T4 summary` : "T4 summary";
  }

  if (document.documentType === "REMITTANCE_REPORT") {
    const match = document.fileName.match(/remittance-(\d{4}-\d{2})-\d{2}-\d{4}-\d{2}-\d{2}\.(pdf|json)$/);
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

function canPreviewDocument(document: {
  mimeType: string;
  fileName: string;
}) {
  return document.mimeType === "application/pdf" || document.fileName.toLowerCase().endsWith(".pdf");
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

function getAuditLogHref(entry: {
  action: string;
  targetType: string;
  targetId: string;
}) {
  if (entry.action === "REMITTANCE_MARKED_PAID" && entry.targetType === "Remittance") {
    return `/cra/remittances/${entry.targetId}`;
  }

  if (entry.action === "T4_PACKAGE_GENERATED" && entry.targetType === "T4Summary") {
    return "/cra/t4";
  }

  return null;
}

const COMPLIANCE_REASON_CODES = [
  "AMBIGUOUS_PAYROLL_STATUS",
  "LEGACY_STATUS_MISSING",
  "PAYROLL_RUN_COMPANY_MISMATCH",
  "PAID_PARENT_CHILD_STATUS_CONFLICT",
  "PAID_PARENT_CHILD_PAYMENT_EVIDENCE_MISSING",
  "SIN_ENCRYPTION_STATE_UNKNOWN",
  "SIN_DECRYPTION_FAILED",
  "INVALID_DECRYPTED_SIN",
] as const;

function formatComplianceAuditSummary(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = metadata as Record<string, unknown>;
  const included = typeof value.includedCount === "number" ? value.includedCount : null;
  const excluded = typeof value.excludedCount === "number" ? value.excludedCount : null;
  const reasons =
    value.reasonCounts && typeof value.reasonCounts === "object" && !Array.isArray(value.reasonCounts)
      ? (value.reasonCounts as Record<string, unknown>)
      : {};
  const reasonText = COMPLIANCE_REASON_CODES.flatMap((code) => {
    const count = reasons[code];
    return typeof count === "number" && count > 0 ? [`${code}: ${count}`] : [];
  });

  if (included === null && excluded === null && reasonText.length === 0) return null;
  return [
    included === null ? null : `included ${included}`,
    excluded === null ? null : `excluded ${excluded}`,
    ...reasonText,
  ].filter(Boolean).join(" · ");
}

export default async function CraDashboardPage() {
  const company = await requireCompanyAdminOrRedirect();
  const [dashboard, missingT4Settings] = await Promise.all([
    getCraDashboard(company.id),
    getMissingT4FilingSettings(company.id),
  ]);
  const currentYear = getDateOnlyCalendarYear(getTodayUtcDateOnly());
  const hasSelectedPlan = Boolean(company.currentPlan);
  const t4Ready = missingT4Settings.length === 0;

  return (
    <div className="space-y-6">
      {dashboard.providerVerification.reviewRequired ? (
        <section className="rounded-3xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
          <p className="font-semibold">REVIEW REQUIRED — provider evidence freshness SLA is not met</p>
          <p className="mt-1">
            Unverified status: {dashboard.providerVerification.unverifiedStatusCount}. Never verified: {dashboard.providerVerification.neverSuccessfullyVerifiedCount}. Missing provider reference: {dashboard.providerVerification.providerReferenceMissingCount}. Stale: {dashboard.providerVerification.staleVerificationCount}. Outdated contract: {dashboard.providerVerification.evidenceVersionMismatchCount}. Legacy: {dashboard.providerVerification.legacyUnverifiedCount}. Unresolved failures: {dashboard.providerVerification.unresolvedFailureCount}. Blocked documents: {dashboard.providerVerification.blockedDocumentCount}.
          </p>
        </section>
      ) : null}
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
              <PlanRequiredButton
                hasSelectedPlan={hasSelectedPlan}
                currentPlan={company.currentPlan}
                requiredPlan="PRO"
                type="submit"
                className="rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Refresh remittances
              </PlanRequiredButton>
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
            {!t4Ready ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                T4 generation is blocked until these settings are resolved: {missingT4Settings.join(", ")}.
              </div>
            ) : null}
            <form action={generateT4Action} className="mt-4 space-y-3">
              <input
                type="number"
                name="taxYear"
                defaultValue={currentYear}
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
              />
              <PlanRequiredButton
                hasSelectedPlan={hasSelectedPlan}
                currentPlan={company.currentPlan}
                requiredPlan="PRO"
                type="submit"
                disabled={!t4Ready}
                className="w-full rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                Generate T4 package
              </PlanRequiredButton>
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
              <div
                key={document.id.toString()}
                className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{formatDashboardDocumentLabel(document)}</p>
                  <p className="text-xs text-gray-500">{formatDashboardDocumentMeta(document)}</p>
                </div>
                <div className="text-right">
                  <span className="block text-xs text-gray-500">{formatInstantDate(document.uploadedAt)}</span>
                  <div className="mt-2 flex items-center justify-end gap-2">
                    {canPreviewDocument(document) ? (
                      <a
                        href={`/api/documents/${document.id.toString()}?disposition=inline`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-900 hover:bg-gray-50"
                      >
                        View
                      </a>
                    ) : null}
                    <a
                      href={`/api/documents/${document.id.toString()}`}
                      className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-900 hover:bg-gray-50"
                    >
                      Download
                    </a>
                  </div>
                </div>
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
            {dashboard.auditLogs.map((entry) => {
              const href = getAuditLogHref(entry);
              const complianceSummary = formatComplianceAuditSummary(entry.metadataJson);

              if (!href) {
                return (
                  <div key={entry.id.toString()} className="rounded-2xl bg-gray-50 px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{entry.action.replaceAll("_", " ")}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {entry.targetType} #{entry.targetId} on {formatInstantDate(entry.createdAt)}
                    </p>
                    {complianceSummary ? (
                      <p className="mt-1 text-xs text-gray-600">{complianceSummary}</p>
                    ) : null}
                  </div>
                );
              }

              return (
                <Link
                  key={entry.id.toString()}
                  href={href}
                  className="block rounded-2xl bg-gray-50 px-4 py-3 transition hover:bg-gray-100"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{entry.action.replaceAll("_", " ")}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {entry.targetType} #{entry.targetId} on {formatInstantDate(entry.createdAt)}
                      </p>
                      {complianceSummary ? (
                        <p className="mt-1 text-xs text-gray-600">{complianceSummary}</p>
                      ) : null}
                    </div>
                    <span className="text-xs font-medium text-gray-900">Open</span>
                  </div>
                </Link>
              );
            })}
            {dashboard.auditLogs.length === 0 ? (
              <p className="text-sm text-gray-500">Payment and generation actions will be tracked here.</p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
