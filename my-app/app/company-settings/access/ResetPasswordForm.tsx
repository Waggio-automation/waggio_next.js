"use client";

import { FormEvent, KeyboardEvent, useState } from "react";

function getPasswordStrength(password: string) {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;

  if (password.length === 0) {
    return { label: "Not entered", tone: "text-gray-500" };
  }
  if (score <= 2) {
    return { label: "Weak", tone: "text-red-600" };
  }
  if (score <= 4) {
    return { label: "Medium", tone: "text-amber-600" };
  }
  return { label: "Strong", tone: "text-emerald-600" };
}

export default function ResetPasswordForm({
  userId,
  token,
}: {
  userId: string;
  token: string;
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const passwordStrength = getPasswordStrength(password);

  function handlePasswordKeyState(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLockOn(event.getModifierState("CapsLock"));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, token, password }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; redirectTo?: string }
        | null;

      if (!res.ok) {
        throw new Error(data?.error || "Failed to reset password.");
      }

      setSuccess("Password updated. Redirecting to login...");
      window.setTimeout(() => {
        window.location.assign(data?.redirectTo || "/company-settings/access");
      }, 900);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <label className="block text-sm font-medium text-gray-700">
        New password
        <div className="mt-2 flex gap-2">
          <input
            type={showPassword ? "text" : "password"}
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyUp={handlePasswordKeyState}
            onKeyDown={handlePasswordKeyState}
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="At least 8 characters"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="shrink-0 rounded border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <span className={passwordStrength.tone}>Password strength: {passwordStrength.label}</span>
          {capsLockOn ? <span className="text-amber-600">Caps Lock is on</span> : null}
        </div>
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Confirm new password
        <input
          type={showPassword ? "text" : "password"}
          required
          minLength={8}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          onKeyUp={handlePasswordKeyState}
          onKeyDown={handlePasswordKeyState}
          className="mt-2 w-full rounded border px-3 py-2 text-sm"
          placeholder="Re-enter your new password"
        />
      </label>

      <button
        type="submit"
        disabled={loading}
        className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
      >
        {loading ? "Saving..." : "Set new password"}
      </button>

      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
