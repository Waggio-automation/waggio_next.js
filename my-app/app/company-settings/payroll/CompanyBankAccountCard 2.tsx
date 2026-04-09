"use client";

import { useState } from "react";

export type PayoutStatus = "required" | "pending" | "ready" | "issue";

type ReadinessItem = {
  label: string;
  done: boolean;
};

function StatusBadge({ status }: { status: PayoutStatus }) {
  if (status === "ready") {
    return <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">Ready</span>;
  }
  if (status === "pending") {
    return <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">Pending</span>;
  }
  if (status === "issue") {
    return <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-800">Needs attention</span>;
  }
  return <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">Setup required</span>;
}

export default function CompanyBankAccountCard({
  initialStatus,
  hasEnvironmentConfig,
  employeeCount,
  readyEmployeeCount,
}: {
  initialStatus: PayoutStatus;
  hasEnvironmentConfig: boolean;
  employeeCount: number;
  readyEmployeeCount: number;
}) {
  const [status, setStatus] = useState<PayoutStatus>(initialStatus);
  const [error, setError] = useState<string | null>(null);

  const readinessItems: ReadinessItem[] = [
    {
      label: "Payroll provider is configured on the server",
      done: hasEnvironmentConfig,
    },
    {
      label: "Your company is set to pay employees in CAD within Canada",
      done: true,
    },
    {
      label: "At least one employee has a payout method configured",
      done: readyEmployeeCount > 0,
    },
  ];

  async function refreshStatus() {
    setError(null);
    const res = await fetch("/api/company/payroll/status", {
      cache: "no-store",
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "Failed to refresh payroll readiness.");
      return;
    }

    if (typeof data?.payoutSetupStatus === "string") {
      setStatus(data.payoutSetupStatus as PayoutStatus);
    }
  }

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-gray-900">Payroll readiness</h2>
          <p className="max-w-2xl text-sm text-gray-600">
            This page is not for managing the payout provider. It shows whether your company is ready
            to run payroll and what still needs to be completed.
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-gray-50 px-4 py-4">
          <p className="text-sm text-gray-500">Company payout region</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">Canada / CAD</p>
        </div>
        <div className="rounded-2xl bg-gray-50 px-4 py-4">
          <p className="text-sm text-gray-500">Employees</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{employeeCount}</p>
        </div>
        <div className="rounded-2xl bg-gray-50 px-4 py-4">
          <p className="text-sm text-gray-500">Employees ready for payout</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{readyEmployeeCount}</p>
        </div>
      </div>

      <div className="space-y-3">
        {readinessItems.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between rounded-2xl border border-gray-200 px-4 py-3 text-sm"
          >
            <span className="text-gray-700">{item.label}</span>
            <span className={item.done ? "text-emerald-700" : "text-amber-700"}>
              {item.done ? "Done" : "Action needed"}
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600">
        Next step: open each employee profile and add a bank transfer or PayPal payout method before
        running payroll.
      </div>

      <button
        type="button"
        onClick={refreshStatus}
        className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
      >
        Refresh status
      </button>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
