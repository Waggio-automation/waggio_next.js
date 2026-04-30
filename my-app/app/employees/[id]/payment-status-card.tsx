"use client";

import { useState } from "react";
import PlanRequiredButton from "@/app/components/PlanRequiredButton";

type PayoutStatus = "required" | "pending" | "ready" | "issue";
type PayoutMethod = "bank-transfer" | "paypal";

export default function PaymentStatusCard({
  employeeId,
  initialStatus,
  initialMethod,
  hasSelectedPlan,
}: {
  employeeId: string;
  initialStatus: PayoutStatus;
  initialMethod: PayoutMethod;
  hasSelectedPlan: boolean;
}) {
  const [status, setStatus] = useState<PayoutStatus>(initialStatus);
  const [method, setMethod] = useState<PayoutMethod>(initialMethod);
  const [currency, setCurrency] = useState("CAD");
  const [country, setCountry] = useState("CA");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [accountNum, setAccountNum] = useState("");
  const [bankId, setBankId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [iban, setIban] = useState("");
  const [swiftBic, setSwiftBic] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
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
      if (!/^\d{3}$/.test(bankId)) {
        setLoading(false);
        setError("For Canadian bank transfers, Bank ID must be exactly 3 digits.");
        return;
      }

      if (!/^\d{5}$/.test(branchId)) {
        setLoading(false);
        setError("For Canadian bank transfers, Branch ID must be exactly 5 digits.");
        return;
      }
    }

    const payload =
      method === "bank-transfer"
        ? {
            type: "bank-transfer",
            primary: true,
            country,
            currency,
            accountHolderName,
            accountNum,
            bankId: bankId || undefined,
            branchId: branchId || undefined,
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
        throw new Error(data?.error || "Failed to configure Trolley payout method.");
      }

      setStatus("ready");
      setMessage("Trolley payout method saved.");
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Failed to configure Trolley payout method.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-gray-900">Trolley payout method</h2>
        <p className="text-sm text-gray-600">
          Create or replace the employee&apos;s Trolley recipient account without exposing secret keys to the client.
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
            <span className="font-medium text-gray-700">Account number *</span>
            <input
              required
              value={accountNum}
              onChange={(event) => setAccountNum(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700">
              Bank ID {isCanadianBankTransfer ? "*" : <span className="text-gray-400">(Optional)</span>}
            </span>
            <input
              required={isCanadianBankTransfer}
              value={bankId}
              onChange={(event) => setBankId(normalizeDigits(event.target.value, 3))}
              inputMode="numeric"
              pattern="\d{3}"
              maxLength={3}
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700">
              Branch ID {isCanadianBankTransfer ? "*" : <span className="text-gray-400">(Optional)</span>}
            </span>
            <input
              required={isCanadianBankTransfer}
              value={branchId}
              onChange={(event) => setBranchId(normalizeDigits(event.target.value, 5))}
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
          {loading ? "Saving..." : "Save payout method"}
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
        For Ontario / Canada bank transfers, `bankId` and `branchId` are required. `IBAN` and
        `SWIFT / BIC` are usually not required for domestic CAD EFT payouts.
      </div>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
