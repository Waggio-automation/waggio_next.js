"use client";

import Link from "next/link";
import { useState } from "react";
import { PAYROLL_STATUS_LABELS } from "@/lib/payments/payroll-status";

type RunRow = {
  id: string;
  payday: string;
  status: "scheduled" | "funding" | "funds_confirmed" | "paying" | "paid" | "failed";
  failureType: "funding" | "employee" | null;
  failureReason: string | null;
  employeeIssueId?: string | null;
};

export default function PayrollStatusBlock({ runs }: { runs: RunRow[] }) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    <section className="rounded-xl border bg-white">
      <div className="border-b p-4">
        <h2 className="text-lg font-semibold">Payroll status</h2>
        <p className="mt-1 text-sm text-gray-600">
          Scheduled -&gt; Funding payroll -&gt; Paying employees -&gt; Paid ✅
        </p>
      </div>

      <div className="p-4 space-y-3">
        {runs.length === 0 ? (
          <p className="text-sm text-gray-500">No pay runs yet.</p>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-gray-700">
                  Payday: <span className="font-medium">{run.payday}</span>
                </div>
                <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                  {PAYROLL_STATUS_LABELS[run.status]}
                </span>
              </div>

              {run.status === "failed" && run.failureType === "funding" ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-red-700">Payroll funding failed</p>
                  <button
                    type="button"
                    onClick={() => retryFunding(run.id)}
                    disabled={retrying === run.id}
                    className="rounded border px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    {retrying === run.id ? "Retrying..." : "Retry funding"}
                  </button>
                </div>
              ) : null}

              {run.status === "failed" && run.failureType === "employee" ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-red-700">Employee payout failed</p>
                  {run.employeeIssueId ? (
                    <Link
                      href={`/employees/${run.employeeIssueId}`}
                      className="rounded border px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Fix employee payment setup
                    </Link>
                  ) : null}
                </div>
              ) : null}

              {run.failureReason ? (
                <p className="text-xs text-gray-500">Reason: {run.failureReason}</p>
              ) : null}
            </div>
          ))
        )}

        {message ? <p className="text-sm text-gray-600">{message}</p> : null}
      </div>
    </section>
  );
}
