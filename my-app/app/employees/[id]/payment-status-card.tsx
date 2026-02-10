"use client";

import { useState } from "react";

type PayoutStatus = "required" | "pending" | "ready" | "issue";

export default function PaymentStatusCard({
  employeeId,
  initialStatus,
}: {
  employeeId: string;
  initialStatus: PayoutStatus;
}) {
  const [status, setStatus] = useState<PayoutStatus>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReady = status === "ready";

  async function refreshStatus() {
    const res = await fetch(`/api/employees/${employeeId}/payout-status`, {
      cache: "no-store",
    });

    if (!res.ok) return;
    const data = await res.json();
    if (typeof data?.payoutSetupStatus === "string") {
      setStatus(data.payoutSetupStatus as PayoutStatus);
    }
  }

  async function startSetup() {
    try {
      setError(null);
      setLoading(true);

      const res = await fetch(`/api/employees/${employeeId}/payout-setup`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to start payment setup.");
      }

      if (typeof data?.onboardingUrl === "string") {
        window.location.assign(data.onboardingUrl);
        return;
      }

      await refreshStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start payment setup.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded border p-4 space-y-3">
      <h2 className="text-lg font-medium">Payment status</h2>

      {!isReady ? (
        <>
          <p className="text-sm text-amber-700">⚠️ Bank account required</p>
          <button
            type="button"
            onClick={startSetup}
            disabled={loading}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {loading ? "Starting..." : "Complete payment setup"}
          </button>
          <p className="text-xs text-gray-500">
            You only need to do this once. Payments will be sent automatically on each payday.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-green-700">✅ Ready for automatic payments</p>
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
