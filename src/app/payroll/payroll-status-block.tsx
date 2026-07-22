"use client";

import Link from "next/link";
import { useState } from "react";
import { PAYROLL_STATUS_LABELS } from "@/lib/payments/payroll-status";
import { compareUtcDateOnly, getTodayUtcDateOnly } from "@/lib/date-only";

type RunRow = {
  id: string;
  payday: string;
  payDateIso: string;
  sendAtIso: string | null;
  status: "scheduled" | "processed" | "funding" | "funds_confirmed" | "paying" | "paid" | "failed";
  failureType: "funding" | "employee" | null;
  failureReason: string | null;
  employeeIssueId?: string | null;
  employees: Array<{
    payHistoryId: string;
    employeeId: string;
    name: string;
    email: string;
    netPay: number;
    status: string;
    paymentRef: string | null;
    failureReason: string | null;
  }>;
};

const MAX_DEFAULT_COMPLETED_RUNS = 3;

function isHideableCompletedStatus(status: RunRow["status"]) {
  return status === "paid" || status === "processed";
}

function getEmployeePayoutTone(status: string, failureReason: string | null) {
  if (failureReason || status === "FAILED") {
    return {
      label: "Issue",
      className: "bg-red-50 text-red-700",
    };
  }

  if (["SENT", "EMAIL_SENT", "PROCESSED"].includes(status)) {
    return {
      label: "Completed",
      className: "bg-emerald-50 text-emerald-700",
    };
  }

  if (["SENDING", "PROCESSING", "READY"].includes(status)) {
    return {
      label: "Processing",
      className: "bg-blue-50 text-blue-700",
    };
  }

  return {
    label: "Pending",
    className: "bg-gray-100 text-gray-700",
  };
}

type MissingPayoutEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

export default function PayrollStatusBlock({ runs }: { runs: RunRow[] }) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCompletedRuns, setShowCompletedRuns] = useState(false);
  const [missingPayoutEmployees, setMissingPayoutEmployees] = useState<
    MissingPayoutEmployee[] | null
  >(null);

  const now = Date.now();
  const activeRuns = runs.filter((run) => !isHideableCompletedStatus(run.status));
  const completedRuns = runs.filter((run) => isHideableCompletedStatus(run.status));
  const defaultVisibleCompletedRuns = completedRuns
    .filter((run) => {
      if (run.status === "processed") {
        if (!run.sendAtIso) return true;
        return new Date(run.sendAtIso).getTime() > now;
      }
      const payDate = new Date(run.payDateIso);
      if (Number.isNaN(payDate.getTime())) return true;
      return compareUtcDateOnly(payDate, getTodayUtcDateOnly(new Date(now))) === 0;
    })
    .slice(0, MAX_DEFAULT_COMPLETED_RUNS);
  const visibleRuns = showCompletedRuns
    ? runs
    : [...activeRuns, ...defaultVisibleCompletedRuns];
  const hiddenCompletedRunsCount = completedRuns.length - defaultVisibleCompletedRuns.length;

  async function retryFunding(runId: string) {
    try {
      setMessage(null);
      setRetrying(runId);

      const res = await fetch(`/api/payroll/runs/${runId}/retry-funding`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Retry failed");
      }

      setMessage("Funding retry started.");
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Payroll status</h2>
          <p className="mt-1 text-sm text-gray-600">
            Paystub saved → Send date reached → Payment processing → Paid
          </p>
        </div>
      </div>

      <div className="p-6 space-y-3">
        {runs.length === 0 ? (
          <p className="text-sm text-gray-500">No pay runs yet.</p>
        ) : (
          visibleRuns.map((run) => (
            <div key={run.id} className="rounded-2xl border border-gray-200 px-4 py-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-gray-700">
                  Payday: <span className="font-medium">{run.payday}</span>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                  {PAYROLL_STATUS_LABELS[run.status]}
                </span>
              </div>

              {run.status === "failed" && run.failureType === "funding" ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-red-700">Payroll payout failed</p>
                  <button
                    type="button"
                    onClick={() => retryFunding(run.id)}
                    disabled={retrying === run.id}
                    className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    {retrying === run.id ? "Retrying..." : "Retry payout"}
                  </button>
                </div>
              ) : null}

              {run.status === "failed" && run.failureType === "employee" ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-red-700">Employee payout failed</p>
                  <Link
                    href="/company-settings"
                    className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Review company bank account
                  </Link>
                </div>
              ) : null}

              {run.failureReason ? (
                <p className="text-xs text-gray-500">Reason: {run.failureReason}</p>
              ) : null}

              <details className="rounded-2xl bg-gray-50 px-3 py-2">
                <summary className="cursor-pointer list-none text-xs font-medium text-gray-600 [&::-webkit-details-marker]:hidden">
                  Employee payout details ({run.employees.length})
                </summary>
                <div className="mt-3 space-y-2">
                  {run.employees.map((employee) => {
                    const tone = getEmployeePayoutTone(employee.status, employee.failureReason);
                    return (
                      <div
                        key={employee.payHistoryId}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-gray-900">{employee.name}</p>
                            <p className="text-gray-500">{employee.email}</p>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 font-medium ${tone.className}`}>
                            {tone.label}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-gray-600">
                          <span>Net: ${employee.netPay.toFixed(2)}</span>
                          <span>Status: {employee.status}</span>
                          {employee.paymentRef ? <span>Payment ref: {employee.paymentRef}</span> : null}
                        </div>
                        {employee.failureReason ? (
                          <p className="mt-2 text-red-700">Error: {employee.failureReason}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </details>
            </div>
          ))
        )}

        {hiddenCompletedRunsCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowCompletedRuns((current) => !current)}
            className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {showCompletedRuns
              ? "Hide completed runs"
              : `Show completed runs (${hiddenCompletedRunsCount})`}
          </button>
        ) : null}

        {message ? <p className="text-sm text-gray-600">{message}</p> : null}
      </div>

      {missingPayoutEmployees ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              Payout setup required
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              The following employees are missing Trolley payout setup. Please
              set up their accounts before sending payroll:
            </p>
            <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto rounded-2xl bg-gray-50 p-3 text-sm text-gray-800">
              {missingPayoutEmployees.map((emp) => (
                <li key={emp.id} className="flex items-center justify-between gap-2">
                  <span>
                    {emp.firstName} {emp.lastName}
                  </span>
                  <Link
                    href={`/employees/${emp.id}`}
                    className="text-xs text-gray-600 underline hover:text-gray-900"
                  >
                    Open profile
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-gray-500">
              You can set up payout in each employee&apos;s profile page.
            </p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setMissingPayoutEmployees(null)}
                className="rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
