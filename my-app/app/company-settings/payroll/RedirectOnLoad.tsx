"use client";

import { useEffect, useState } from "react";

export default function RedirectOnLoad() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        const res = await fetch("/api/company/payroll/setup", {
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
      } catch (e: unknown) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to start payment setup.");
      }
    }

    start();

    return () => {
      active = false;
    };
  }, []);

  if (!error) {
    return (
      <div className="rounded border border-dashed p-4 text-sm text-gray-600">
        Redirecting to Stripe onboarding...
      </div>
    );
  }

  return (
    <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {error}
    </div>
  );
}
