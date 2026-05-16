"use client";

import { useActionState, useState } from "react";
import { createEmployee } from "./actions";
import PayTypeFields from "./pay-type-fields";
import PlanRequiredButton from "@/app/components/PlanRequiredButton";

export default function CreateEmployeeForm({ hasSelectedPlan }: { hasSelectedPlan: boolean }) {
  const [state, action] = useActionState(createEmployee, null);
  const errors = state && "errors" in state ? state.errors : {};
  const didCreate = state && "success" in state ? state.success : false;

  const [sinValue, setSinValue] = useState("");
  const [setupPayoutNow, setSetupPayoutNow] = useState(false);
  const [payoutMethod, setPayoutMethod] = useState<"bank-transfer" | "paypal">("bank-transfer");
  const [payoutCountry, setPayoutCountry] = useState("CA");
  const [institutionNumber, setInstitutionNumber] = useState("");
  const [transitBranchNumber, setTransitBranchNumber] = useState("");
  const sinIsNineDigits = /^\d{9}$/.test(sinValue);
  const sinLuhnValid = sinIsNineDigits && (() => {
    const digits = sinValue.split("").map(Number);
    const sum = digits.reduce((acc, digit, i) => {
      if (i % 2 === 1) {
        const doubled = digit * 2;
        return acc + (doubled > 9 ? doubled - 9 : doubled);
      }
      return acc + digit;
    }, 0);
    return sum % 10 === 0;
  })();
  const fieldClassName =
    "w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-500";
  const labelClassName = "flex flex-col gap-2 text-sm text-gray-700";
  const isCanadianBankTransfer = payoutMethod === "bank-transfer" && payoutCountry.toUpperCase() === "CA";

  function normalizeDigits(value: string, maxLength: number) {
    return value.replace(/\D/g, "").slice(0, maxLength);
  }

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-gray-900">Create Employee</h2>
        <p className="text-sm text-gray-600">
          Enter employee and payroll details below. You can add bank account details now or finish
          them later from the employee profile.
        </p>
      </div>
      {didCreate ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Employee created successfully.
        </div>
      ) : null}
      <form action={action} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <label className={labelClassName}>
            <span>First name *</span>
            <input name="firstName" required className={fieldClassName} />
          </label>
          <label className={labelClassName}>
            <span>Last name *</span>
            <input name="lastName" required className={fieldClassName} />
          </label>
          <label className={`${labelClassName} col-span-2`}>
            <span>Email *</span>
            <input
              type="email"
              name="email"
              required
              className={fieldClassName}
            />
          </label>
          <label className={labelClassName}>
            <span>Employee Number</span>
            <input name="employeeNumber" className={fieldClassName} />
          </label>
          <label className={labelClassName}>
            <span>Department</span>
            <input name="department" className={fieldClassName} />
          </label>
          <label className={`${labelClassName} col-span-2`}>
            <span>Job Title</span>
            <input name="jobTitle" className={fieldClassName} />
          </label>
          <label className={`${labelClassName} col-span-2`}>
            <span>SIN (9 digits) *</span>
            <input
              name="sin"
              inputMode="numeric"
              pattern="\d{9}"
              required
              value={sinValue}
              onChange={(e) => setSinValue(e.target.value)}
              className={fieldClassName}
            />
            {sinValue.length > 0 && (
              sinLuhnValid
                ? <span className="text-green-600 text-sm">Valid SIN ✓</span>
                : <span className="text-red-500 text-sm">Invalid SIN ✗</span>
            )}
            {!sinLuhnValid && errors?.sin && (
              <span className="text-red-500 text-sm">{errors.sin}</span>
            )}
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <input
            type="hidden"
            name="dentalBenefitsCoverage"
            value="NONE"
          />
          <label className={labelClassName}>
            <span>Address line 1 *</span>
            <input name="addrLine1" required className={fieldClassName} />
          </label>
          <label className={labelClassName}>
            <span>Address line 2</span>
            <input name="addrLine2" className={fieldClassName} />
          </label>
          <label className={labelClassName}>
            <span>City *</span>
            <input name="addrCity" required className={fieldClassName} />
          </label>
          <label className={labelClassName}>
            <span>Province</span>
            <input
              name="addrProvince"
              defaultValue="ON"
              className={fieldClassName}
            />
          </label>
          <label className={labelClassName}>
            <span>Postal Code *</span>
            <input name="addrPostal" required className={fieldClassName} />
          </label>
          <label className={labelClassName}>
            <span>Country</span>
            <input
              name="addrCountry"
              defaultValue="CA"
              className={fieldClassName}
            />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <label className={labelClassName}>
            <span>Birth date *</span>
            <input
              type="date"
              name="birthDate"
              required
              className={fieldClassName}
            />
          </label>
          <label className={labelClassName}>
            <span>Employment type *</span>
            <select name="employmentType" className={fieldClassName}>
              <option>FULL_TIME</option>
              <option>PART_TIME</option>
              <option>CONTRACTOR</option>
            </select>
          </label>
          <label className={labelClassName}>
            <span>Hire date *</span>
            <input
              type="date"
              name="hireDate"
              required
              className={fieldClassName}
            />
          </label>
        </div>
        <label className={labelClassName}>
          <span>Pay group</span>
          <select
            name="payGroup"
            className={fieldClassName}
            defaultValue="BI_WEEKLY"
          >
            <option>BI_WEEKLY</option>
            <option>MONTHLY</option>
          </select>
        </label>
        <PayTypeFields />
        <div className="grid grid-cols-3 gap-4">
          <label className={labelClassName}>
            <span>Vacation %</span>
            <input
              name="vacationPay"
              type="number"
              step="0.01"
              defaultValue={4}
              className={fieldClassName}
            />
          </label>
          <label className={labelClassName}>
            <span>Bonus</span>
            <input
              name="bonus"
              type="number"
              step="0.01"
              defaultValue={0}
              className={fieldClassName}
            />
          </label>
          <div />
          <label className={labelClassName}>
            <span>Federal TD1</span>
            <input
              name="federalTD1"
              type="number"
              step="0.01"
              defaultValue={16452}
              className={fieldClassName}
            />
          </label>
          <label className={labelClassName}>
            <span>Provincial TD1</span>
            <input
              name="provincialTD1"
              type="number"
              step="0.01"
              defaultValue={12989}
              className={fieldClassName}
            />
          </label>
        </div>
        <div className="space-y-4 border-t border-gray-200 pt-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-gray-900">Employee bank account details</h3>
                <p className="max-w-2xl text-sm text-gray-600">
                  Add the employee&apos;s payout account now, or complete it later from the employee profile.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  name="setupPayoutNow"
                  value="yes"
                  checked={setupPayoutNow}
                  onChange={(event) => setSetupPayoutNow(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Enter now
              </label>
            </div>

            {setupPayoutNow ? (
              <div className="mt-5 space-y-4 border-t border-gray-200 pt-5">
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-3 py-2">
                    <input
                      type="radio"
                      name="payoutType"
                      value="bank-transfer"
                      checked={payoutMethod === "bank-transfer"}
                      onChange={() => setPayoutMethod("bank-transfer")}
                    />
                    Bank transfer
                  </label>
                  <label className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-3 py-2">
                    <input
                      type="radio"
                      name="payoutType"
                      value="paypal"
                      checked={payoutMethod === "paypal"}
                      onChange={() => setPayoutMethod("paypal")}
                    />
                    PayPal
                  </label>
                </div>

                {payoutMethod === "bank-transfer" ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className={labelClassName}>
                      <span>Currency *</span>
                      <input
                        name="payoutCurrency"
                        required={setupPayoutNow}
                        defaultValue="CAD"
                        maxLength={3}
                        className={`${fieldClassName} uppercase`}
                      />
                    </label>
                    <label className={labelClassName}>
                      <span>Country *</span>
                      <input
                        name="payoutCountry"
                        required={setupPayoutNow}
                        value={payoutCountry}
                        onChange={(event) => setPayoutCountry(event.target.value.toUpperCase())}
                        maxLength={2}
                        className={`${fieldClassName} uppercase`}
                      />
                    </label>
                    <label className={`${labelClassName} md:col-span-2`}>
                      <span>Account holder name *</span>
                      <input name="accountHolderName" required={setupPayoutNow} className={fieldClassName} />
                    </label>
                    <label className={labelClassName}>
                      <span>Account Number *</span>
                      <input
                        name="accountNumber"
                        required={setupPayoutNow}
                        inputMode="numeric"
                        pattern={isCanadianBankTransfer ? "\\d{7,12}" : undefined}
                        maxLength={isCanadianBankTransfer ? 12 : undefined}
                        className={fieldClassName}
                      />
                    </label>
                    <label className={labelClassName}>
                      <span>
                        Institution Number {isCanadianBankTransfer ? "*" : <span className="text-gray-400">(Optional)</span>}
                      </span>
                      <input
                        name="institutionNumber"
                        required={setupPayoutNow && isCanadianBankTransfer}
                        value={institutionNumber}
                        onChange={(event) => setInstitutionNumber(normalizeDigits(event.target.value, 3))}
                        inputMode="numeric"
                        pattern="\d{3}"
                        maxLength={3}
                        className={fieldClassName}
                      />
                    </label>
                    <label className={labelClassName}>
                      <span>
                        Transit / Branch Number {isCanadianBankTransfer ? "*" : <span className="text-gray-400">(Optional)</span>}
                      </span>
                      <input
                        name="transitBranchNumber"
                        required={setupPayoutNow && isCanadianBankTransfer}
                        value={transitBranchNumber}
                        onChange={(event) => setTransitBranchNumber(normalizeDigits(event.target.value, 5))}
                        inputMode="numeric"
                        pattern="\d{5}"
                        maxLength={5}
                        className={fieldClassName}
                      />
                    </label>
                    <label className={labelClassName}>
                      <span>IBAN <span className="text-gray-400">(Optional)</span></span>
                      <input name="iban" className={fieldClassName} />
                    </label>
                    <label className={`${labelClassName} md:col-span-2`}>
                      <span>SWIFT / BIC <span className="text-gray-400">(Optional)</span></span>
                      <input name="swiftBic" className={fieldClassName} />
                    </label>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className={labelClassName}>
                      <span>Currency *</span>
                      <input
                        name="payoutCurrency"
                        required={setupPayoutNow}
                        defaultValue="CAD"
                        maxLength={3}
                        className={`${fieldClassName} uppercase`}
                      />
                    </label>
                    <label className={labelClassName}>
                      <span>PayPal email *</span>
                      <input
                        type="email"
                        name="paypalEmail"
                        required={setupPayoutNow}
                        className={fieldClassName}
                      />
                    </label>
                  </div>
                )}

                <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  For Canada bank transfers, Institution Number must be 3 digits, Transit / Branch Number must be 5 digits, and Account Number must be 7 to 12 digits.
                </div>
              </div>
            ) : null}
          </div>

          {errors?.payoutSetup ? (
            <p className="text-sm text-red-600">{errors.payoutSetup}</p>
          ) : null}
        </div>
        <div className="flex justify-end border-t border-gray-200 pt-5">
          <PlanRequiredButton
            hasSelectedPlan={hasSelectedPlan}
            type="submit"
            className="rounded-full bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-800"
          >
            Create
          </PlanRequiredButton>
        </div>
      </form>
    </section>
  );
}
