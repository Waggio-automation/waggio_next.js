"use client";

import { FormEvent, useState } from "react";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!res.ok) {
        throw new Error(data?.error || "Failed to create the password reset link.");
      }

      setSuccess("A password reset email has been sent if the mailbox is configured and reachable.");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to create the password reset link."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <label className="block text-sm font-medium text-gray-700">
        Login email
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-2 w-full rounded border px-3 py-2 text-sm"
          placeholder="owner@company.com"
        />
      </label>

      <button
        type="submit"
        disabled={loading}
        className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
      >
        {loading ? "Sending..." : "Send reset email"}
      </button>

      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
