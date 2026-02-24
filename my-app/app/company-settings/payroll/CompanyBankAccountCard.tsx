"use client";

import { useState } from "react";

export type PayoutStatus = "required" | "pending" | "ready" | "issue";

export default function CompanyBankAccountCard({
  initialStatus,
}: {
  initialStatus: PayoutStatus;
}) {
  const [status, setStatus] = useState<PayoutStatus>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReady = status === "ready";

  async function refreshStatus() {
    const res = await fetch("/api/company/payroll/status", {
      cache: "no-store",
    });

    if (!res.ok) return;
    const data = await res.json();
    if (typeof data?.payoutSetupStatus === "string") {
      setStatus(data.payoutSetupStatus as PayoutStatus);
    }
  }

  async function startSetup() {
    setError(null);
    setLoading(true);
    window.location.assign("/api/company/payroll/setup");
  }

  return (
    <section className="rounded-xl border bg-white p-5 space-y-3">
      <h2 className="text-lg font-semibold">Company bank account</h2>

      {!isReady ? (
        <>
          {status === "issue" ? (
            <p className="text-sm text-red-700">⚠️ Bank account needs attention</p>
          ) : status === "pending" ? (
            <p className="text-sm text-amber-700">⏳ Bank account pending verification</p>
          ) : (
            <p className="text-sm text-amber-700">⚠️ Bank account required</p>
          )}
          <button
            type="button"
            onClick={startSetup}
            disabled={loading}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {loading ? "Starting..." : "Connect your bank account with Stripe"}
          </button>
          <p className="text-xs text-gray-500">
            Connect the business owner&apos;s bank account once to fund payroll runs.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-green-700">✅ Ready to fund payroll</p>
          <button
            type="button"
            onClick={startSetup}
            disabled={loading}
            className="rounded border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {loading ? "Opening..." : "Update bank account"}
          </button>
        </>
      )}

      <button
        type="button"
        onClick={refreshStatus}
        className="text-xs text-gray-500 underline hover:text-gray-700"
      >
        Refresh status
      </button>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
