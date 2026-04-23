"use client";

import { FormEvent, KeyboardEvent, useState } from "react";

type AccessFormProps = {
  hasExistingAccount: boolean;
};

type SubmitMode = "signup" | "login";

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

export default function AccessForm({ hasExistingAccount }: AccessFormProps) {
  const initialMode: SubmitMode = hasExistingAccount ? "login" : "signup";
  const [mode, setMode] = useState<SubmitMode>(initialMode);
  const [companyName, setCompanyName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordStrength = getPasswordStrength(password);

  function handlePasswordKeyState(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLockOn(event.getModifierState("CapsLock"));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const payload =
        mode === "signup"
          ? { companyName, firstName, lastName, email, password }
          : { email, password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => null)) as { error?: string; redirectTo?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error || "Authentication failed.");
      }

      window.location.assign(data?.redirectTo || "/company-settings");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-full border border-gray-200 bg-white p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode("signup")}
          disabled={hasExistingAccount}
          className={`rounded-full px-4 py-2 ${
            mode === "signup" ? "bg-gray-900 text-white" : "text-gray-600"
          } ${hasExistingAccount ? "cursor-not-allowed opacity-50" : ""}`}
        >
          Sign up
        </button>
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`rounded-full px-4 py-2 ${
            mode === "login" ? "bg-gray-900 text-white" : "text-gray-600"
          }`}
        >
          Log in
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        {mode === "signup" ? (
          <>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-gray-700">
                First name
                <input
                  type="text"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  className="mt-2 w-full rounded border px-3 py-2 text-sm"
                  placeholder="Jane"
                />
              </label>

              <label className="block text-sm font-medium text-gray-700">
                Last name
                <input
                  type="text"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  className="mt-2 w-full rounded border px-3 py-2 text-sm"
                  placeholder="Owner"
                />
              </label>
            </div>
          </>
        ) : null}

        <label className="block text-sm font-medium text-gray-700">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded border px-3 py-2 text-sm"
            placeholder="owner@company.com"
          />
        </label>

        <label className="block text-sm font-medium text-gray-700">
          Password
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

        {mode === "signup" ? (
          <label className="block text-sm font-medium text-gray-700">
            Confirm password
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              onKeyUp={handlePasswordKeyState}
              onKeyDown={handlePasswordKeyState}
              className="mt-2 w-full rounded border px-3 py-2 text-sm"
              placeholder="Re-enter your password"
            />
          </label>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {loading ? "Saving..." : mode === "signup" ? "Create account" : "Log in"}
        </button>

        <div className="flex flex-wrap gap-4 text-sm">
          <a href="/company-settings/access/forgot-email" className="text-gray-600 underline hover:text-gray-900">
            Find login email
          </a>
          <a
            href="/company-settings/access/forgot-password"
            className="text-gray-600 underline hover:text-gray-900"
          >
            Reset password
          </a>
        </div>

        {mode === "signup" ? (
          <p className="text-xs text-gray-500">
            After sign-up, you will be redirected to Company Settings to choose Basic or Pro.
          </p>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
    </div>
  );
}
