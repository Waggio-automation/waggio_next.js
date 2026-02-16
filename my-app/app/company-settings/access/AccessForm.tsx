"use client";

import { FormEvent, useState } from "react";

export default function AccessForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLink, setMagicLink] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMagicLink(null);
    setLoading(true);

    try {
      const res = await fetch("/api/company/admin-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const responseText = await res.text();
      let data: { error?: string; magicLink?: string } | null = null;
      if (responseText) {
        try {
          data = JSON.parse(responseText) as { error?: string; magicLink?: string };
        } catch {
          data = null;
        }
      }

      if (!res.ok) {
        throw new Error(data?.error || "Failed to request access link.");
      }

      if (typeof data?.magicLink === "string") {
        setMagicLink(data.magicLink);
        window.location.assign(data.magicLink);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to request access link.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block text-sm font-medium text-gray-700">
        Admin email
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
        className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {loading ? "Sending..." : "Send magic link"}
      </button>

      {magicLink ? (
        <p className="text-xs text-gray-500">
          If you were not redirected, open the link manually: {magicLink}
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
