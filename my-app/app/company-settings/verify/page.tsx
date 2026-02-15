"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function CompanyVerifyPage() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("Missing token.");
      return;
    }

    let active = true;

    async function verify() {
      try {
        const res = await fetch(`/api/company/verify?token=${encodeURIComponent(token)}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error || "Invalid magic link.");
        }

        window.location.replace("/company-settings/payroll");
      } catch (e: unknown) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Invalid magic link.");
      }
    }

    verify();

    return () => {
      active = false;
    };
  }, [searchParams]);

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-10 space-y-4">
      <h1 className="text-xl font-semibold">Verifying access</h1>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <p className="text-sm text-gray-600">Redirecting you to Payroll Settings...</p>
      )}
    </main>
  );
}
