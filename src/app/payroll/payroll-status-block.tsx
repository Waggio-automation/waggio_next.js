"use client";

import Link from "next/link";
import { useState } from "react";
import { PAYROLL_STATUS_LABELS } from "@/lib/payments/payroll-status";

type RunRow = {
  id: string;
  payday: string;
  payDateIso: string;
  status: "scheduled" | "processed" | "funding" | "funds_confirmed" | "paying" | "paid" | "failed";
  failureType: "funding" | "employee" | null;
  failureReason: string | null;
  employeeIssueId?: string | null;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DEFAULT_COMPLETED_RUNS = 3;

function isHideableCompletedStatus(status: RunRow["status"]) {
  return status === "paid" || status === "processed";
}

export default function PayrollStatusBlock({ runs }: { runs: RunRow[] }) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [dispatchingDueRuns, setDispatchingDueRuns] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showCompletedRuns, setShowCompletedRuns] = useState(false);

  const now = Date.now();
  const activeRuns = runs.filter((run) => !isHideableCompletedStatus(run.status));
  const completedRuns = runs.filter((run) => isHideableCompletedStatus(run.status));
  const defaultVisibleCompletedRuns = completedRuns
    .filter((run) => {
    const payDateMs = new Date(run.payDateIso).getTime();
    if (Number.isNaN(payDateMs)) {
      return true;
    }

      return payDateMs <= now && now - payDateMs < ONE_DAY_MS;
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

  async function sendDuePayrollRuns() {
    try {
      setMessage(null);
      setDispatchingDueRuns(true);

      const res = await fetch("/api/payroll/send-due", {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to send due payroll runs.");
      }

      setMessage(
        data?.count > 0
          ? `Started payout processing for ${data.count} due payroll run${data.count === 1 ? "" : "s"}.`
          : "No due payroll runs were ready to send."
      );
    } catch (error: unknown) {
      setMessage(
        error instanceof Error ? error.message : "Failed to send due payroll runs."
      );
    } finally {
      setDispatchingDueRuns(false);
    }
  }

  return (
    <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Payroll status</h2>
            <p className="mt-1 text-sm text-gray-600">
              Processed run + sendAt reached -&gt; Trolley batch -&gt; Paying employees -&gt; Paid
            </p>
          </div>
          <button
            type="button"
            onClick={sendDuePayrollRuns}
            disabled={dispatchingDueRuns}
            className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {dispatchingDueRuns ? "Sending due runs..." : "Send due payroll"}
          </button>
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
    </section>
  );
}
