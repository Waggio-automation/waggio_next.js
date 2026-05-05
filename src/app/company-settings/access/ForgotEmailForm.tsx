"use client";

import { FormEvent, useState } from "react";

export default function ForgotEmailForm() {
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMaskedEmail(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/auth/lookup-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; maskedEmail?: string }
        | null;

      if (!res.ok) {
        throw new Error(data?.error || "Failed to look up the login email.");
      }

      setMaskedEmail(data?.maskedEmail ?? null);
      setSuccess("A login email reminder has been sent to the registered mailbox.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to look up the login email.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <label className="block text-sm font-medium text-gray-700">
        Company name
        <input
          type="text"
          required
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          className="mt-2 w-full rounded border px-3 py-2 text-sm"
          placeholder="Acme Payroll Inc."
        />
      </label>

      <button
        type="submit"
        disabled={loading}
        className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
      >
        {loading ? "Sending..." : "Send login email reminder"}
      </button>

      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
      {maskedEmail ? (
        <p className="text-sm text-gray-600">Reminder sent to {maskedEmail}</p>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
