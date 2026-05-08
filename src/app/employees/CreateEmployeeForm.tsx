"use client";

import { useActionState, useState } from "react";
import { createEmployee } from "./actions";
import PayTypeFields from "./pay-type-fields";
import PlanRequiredButton from "@/app/components/PlanRequiredButton";

export default function CreateEmployeeForm({ hasSelectedPlan }: { hasSelectedPlan: boolean }) {
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
  const fieldClassName =
    "w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-500";
  const labelClassName = "flex flex-col gap-2 text-sm text-gray-700";

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-gray-900">Create Employee</h2>
        <p className="text-sm text-gray-600">
          Enter employee and payroll details below. Trolley payout setup is completed from the
          employee profile after creation.
        </p>
      </div>
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
              defaultValue={15492}
              className={fieldClassName}
            />
          </label>
          <label className={labelClassName}>
            <span>Provincial TD1</span>
            <input
              name="provincialTD1"
              type="number"
              step="0.01"
              defaultValue={12298}
              className={fieldClassName}
            />
          </label>
        </div>
        <div className="space-y-3 border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-900">Direct Deposit</h3>
          <div className="grid grid-cols-2 gap-4">
            <label className={labelClassName}>
              <span>Bank Transit #</span>
              <input name="bankTransit" className={fieldClassName} />
            </label>
            <label className={labelClassName}>
              <span>Account #</span>
              <input name="bankAccount" className={fieldClassName} />
            </label>
          </div>
        </div>
        <PlanRequiredButton
          hasSelectedPlan={hasSelectedPlan}
          type="submit"
          className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Create
        </PlanRequiredButton>
      </form>
    </section>
  );
}
