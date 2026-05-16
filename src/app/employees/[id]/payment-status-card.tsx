"use client";

import { useState } from "react";
import PlanRequiredButton from "@/app/components/PlanRequiredButton";

type PayoutStatus = "required" | "pending" | "ready" | "issue";
type PayoutMethod = "bank-transfer" | "paypal";

export default function PaymentStatusCard({
  employeeId,
  initialStatus,
  initialMethod,
  initialAccountHolderName,
  initialAccountNumber,
  initialInstitutionNumber,
  initialTransitBranchNumber,
  initialPaypalEmail,
  hasSelectedPlan,
}: {
  employeeId: string;
  initialStatus: PayoutStatus;
  initialMethod: PayoutMethod;
  initialAccountHolderName: string;
  initialAccountNumber?: string | null;
  initialInstitutionNumber?: string | null;
  initialTransitBranchNumber?: string | null;
  initialPaypalEmail: string;
  hasSelectedPlan: boolean;
}) {
  const [status, setStatus] = useState<PayoutStatus>(initialStatus);
  const [method, setMethod] = useState<PayoutMethod>(initialMethod);
  const [currency, setCurrency] = useState("CAD");
  const [country, setCountry] = useState("CA");
  const [accountHolderName, setAccountHolderName] = useState(initialAccountHolderName);
  const [accountNumber, setAccountNumber] = useState(initialAccountNumber ?? "");
  const [institutionNumber, setInstitutionNumber] = useState(
    initialInstitutionNumber ?? ""
  );
  const [transitBranchNumber, setTransitBranchNumber] = useState(initialTransitBranchNumber ?? "");
  const [iban, setIban] = useState("");
  const [swiftBic, setSwiftBic] = useState("");
  const [paypalEmail, setPaypalEmail] = useState(initialPaypalEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isCanadianBankTransfer = method === "bank-transfer" && country.toUpperCase() === "CA";

  function normalizeDigits(value: string, maxLength: number) {
    return value.replace(/\D/g, "").slice(0, maxLength);
  }

  async function refreshStatus() {
    setError(null);
    setMessage(null);

    const res = await fetch(`/api/employees/${employeeId}/payout-status`, {
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      setError(data?.error || "Failed to refresh payout status.");
      return;
    }

    if (typeof data?.payoutSetupStatus === "string") {
      setStatus(data.payoutSetupStatus as PayoutStatus);
    }
    if (data?.payoutMethod === "paypal" || data?.payoutMethod === "bank-transfer") {
      setMethod(data.payoutMethod);
    }
  }

  async function savePayoutMethod() {
    setLoading(true);
    setError(null);
    setMessage(null);

    if (isCanadianBankTransfer) {
      if (!/^\d{3}$/.test(institutionNumber)) {
        setLoading(false);
        setError("For Canadian bank transfers, Institution Number must be exactly 3 digits.");
        return;
      }

      if (!/^\d{5}$/.test(transitBranchNumber)) {
        setLoading(false);
        setError("For Canadian bank transfers, Transit / Branch Number must be exactly 5 digits.");
        return;
      }

      if (!/^\d{7,12}$/.test(accountNumber)) {
        setLoading(false);
        setError("For Canadian bank transfers, Account Number must be 7 to 12 digits.");
        return;
      }
    }

    if (method === "bank-transfer" && !/[A-Za-z]/.test(accountHolderName.trim())) {
      setLoading(false);
      setError("Account holder name must include letters.");
      return;
    }

    const payload =
      method === "bank-transfer"
        ? {
            type: "bank-transfer",
            primary: true,
            country,
            currency,
            accountHolderName,
            accountNumber,
            institutionNumber: institutionNumber || undefined,
            transitBranchNumber: transitBranchNumber || undefined,
            iban: iban || undefined,
            swiftBic: swiftBic || undefined,
          }
        : {
            type: "paypal",
            primary: true,
            currency,
            emailAddress: paypalEmail,
          };

    try {
      const res = await fetch(`/api/employees/${employeeId}/payout-setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save employee bank account details.");
      }

      setStatus("ready");
      setMessage("Employee bank account details saved.");
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save employee bank account details.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-gray-900">Employee bank account details</h2>
        <p className="text-sm text-gray-600">
          Add or update the account this employee uses for payroll payouts.
        </p>
      </div>

      <div className="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700">
        {status === "ready"
          ? "Status: ready for payroll payouts."
          : status === "pending"
            ? "Status: recipient created, but a payout account still needs to be attached."
            : status === "issue"
              ? "Status: payout setup needs attention."
              : "Status: payout setup required."}
      </div>

      <div className="flex gap-3 text-sm">
        <label className="inline-flex items-center gap-2 rounded-full border px-3 py-2">
          <input
            type="radio"
            name="payout-method"
            checked={method === "bank-transfer"}
            onChange={() => setMethod("bank-transfer")}
          />
          Bank transfer
        </label>
        <label className="inline-flex items-center gap-2 rounded-full border px-3 py-2">
          <input
            type="radio"
            name="payout-method"
            checked={method === "paypal"}
            onChange={() => setMethod("paypal")}
          />
          PayPal
        </label>
      </div>

      {method === "bank-transfer" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700">Currency *</span>
            <input
              required
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              maxLength={3}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 uppercase"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700">Country *</span>
            <input
              required
              value={country}
              onChange={(event) => setCountry(event.target.value.toUpperCase())}
              maxLength={2}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 uppercase"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium text-gray-700">Account holder name *</span>
            <input
              required
              value={accountHolderName}
              onChange={(event) => setAccountHolderName(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700">Account Number *</span>
            <input
              required
              value={accountNumber}
              onChange={(event) =>
                setAccountNumber(
                  isCanadianBankTransfer
                    ? normalizeDigits(event.target.value, 12)
                    : event.target.value
                )
              }
              inputMode={isCanadianBankTransfer ? "numeric" : undefined}
              pattern={isCanadianBankTransfer ? "\\d{7,12}" : undefined}
              maxLength={isCanadianBankTransfer ? 12 : undefined}
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700">
              Institution Number {isCanadianBankTransfer ? "*" : <span className="text-gray-400">(Optional)</span>}
            </span>
            <input
              required={isCanadianBankTransfer}
              value={institutionNumber}
              onChange={(event) => setInstitutionNumber(normalizeDigits(event.target.value, 3))}
              inputMode="numeric"
              pattern="\d{3}"
              maxLength={3}
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700">
              Transit / Branch Number {isCanadianBankTransfer ? "*" : <span className="text-gray-400">(Optional)</span>}
            </span>
            <input
              required={isCanadianBankTransfer}
              value={transitBranchNumber}
              onChange={(event) => setTransitBranchNumber(normalizeDigits(event.target.value, 5))}
              inputMode="numeric"
              pattern="\d{5}"
              maxLength={5}
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700">
              IBAN <span className="text-gray-400">(Optional)</span>
            </span>
            <input
              value={iban}
              onChange={(event) => setIban(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium text-gray-700">
              SWIFT / BIC <span className="text-gray-400">(Optional)</span>
            </span>
            <input
              value={swiftBic}
              onChange={(event) => setSwiftBic(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700">Currency *</span>
            <input
              required
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              maxLength={3}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 uppercase"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700">PayPal email *</span>
            <input
              type="email"
              required
              value={paypalEmail}
              onChange={(event) => setPaypalEmail(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <PlanRequiredButton
          hasSelectedPlan={hasSelectedPlan}
          type="button"
          onClick={savePayoutMethod}
          disabled={loading}
          className="rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {loading ? "Saving..." : "Save bank account details"}
        </PlanRequiredButton>
        <button
          type="button"
          onClick={refreshStatus}
          className="rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Refresh status
        </button>
      </div>

      <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600">
        For Ontario / Canada bank transfers, Institution Number, Transit / Branch Number, and Account Number are required. `IBAN` and
        `SWIFT / BIC` are usually not required for domestic CAD EFT payouts.
      </div>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
