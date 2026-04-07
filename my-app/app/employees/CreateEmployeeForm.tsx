"use client";

import { useActionState, useState } from "react";
import { createEmployee } from "./actions";
import PayTypeFields from "./pay-type-fields";
import PaymentMethodFields from "./payment-method-fields";

export default function CreateEmployeeForm() {
  const [state, action] = useActionState(createEmployee, null);
  const errors = state && "errors" in state ? state.errors : {};

  const [sinValue, setSinValue] = useState("");
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

  return (
    <section className="border rounded p-4 space-y-4">
      <h2 className="text-lg font-medium">Create Employee</h2>
      <form action={action} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span>First name *</span>
            <input name="firstName" required className="border rounded p-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Last name *</span>
            <input name="lastName" required className="border rounded p-2" />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span>Email *</span>
            <input
              type="email"
              name="email"
              required
              className="border rounded p-2"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span>SIN (9 digits) *</span>
            <input
              name="sin"
              inputMode="numeric"
              pattern="\d{9}"
              required
              value={sinValue}
              onChange={(e) => setSinValue(e.target.value)}
              className="border rounded p-2"
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
          <label className="flex flex-col gap-1">
            <span>Address line 1 *</span>
            <input name="addrLine1" required className="border rounded p-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Address line 2</span>
            <input name="addrLine2" className="border rounded p-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span>City *</span>
            <input name="addrCity" required className="border rounded p-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Province</span>
            <input
              name="addrProvince"
              defaultValue="ON"
              className="border rounded p-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Postal Code *</span>
            <input name="addrPostal" required className="border rounded p-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Country</span>
            <input
              name="addrCountry"
              defaultValue="CA"
              className="border rounded p-2"
            />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <label className="flex flex-col gap-1">
            <span>Birth date *</span>
            <input
              type="date"
              name="birthDate"
              required
              className="border rounded p-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Employment type *</span>
            <select name="employmentType" className="border rounded p-2">
              <option>FULL_TIME</option>
              <option>PART_TIME</option>
              <option>CONTRACTOR</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>Hire date *</span>
            <input
              type="date"
              name="hireDate"
              required
              className="border rounded p-2"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span>Pay group</span>
          <select
            name="payGroup"
            className="border rounded p-2"
            defaultValue="BI_WEEKLY"
          >
            <option>BI_WEEKLY</option>
            <option>MONTHLY</option>
          </select>
        </label>
        <PayTypeFields />
        <PaymentMethodFields />
        <div className="grid grid-cols-3 gap-4">
          <label className="flex flex-col gap-1">
            <span>Vacation %</span>
            <input
              name="vacationPay"
              type="number"
              step="0.01"
              defaultValue={4}
              className="border rounded p-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Bonus</span>
            <input
              name="bonus"
              type="number"
              step="0.01"
              defaultValue={0}
              className="border rounded p-2"
            />
          </label>
          <div />
          <label className="flex flex-col gap-1">
            <span>Federal TD1</span>
            <input
              name="federalTD1"
              type="number"
              step="0.01"
              defaultValue={15492}
              className="border rounded p-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Provincial TD1</span>
            <input
              name="provincialTD1"
              type="number"
              step="0.01"
              defaultValue={12298}
              className="border rounded p-2"
            />
          </label>
        </div>
        <button
          type="submit"
          className="border rounded px-4 py-2 hover:bg-gray-50"
        >
          Create
        </button>
      </form>
    </section>
  );
}
