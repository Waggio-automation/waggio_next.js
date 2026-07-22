import test from "node:test";
import assert from "node:assert/strict";
import { utcDateOnlySchema } from "../lib/validation/date-only.ts";
import { payrollRunInputSchema } from "../lib/payroll/payroll-run-input.ts";

const validPayrollInput = {
  items: [{
    employeeId: "123",
    hoursWorked: 8,
    overtime: 0,
    holidayHours: 0,
    includeVacation: true,
  }],
  payDate: "2026-02-15",
  periodStart: "2026-02-01",
  periodEnd: "2026-02-14",
  sendAt: "2026-02-13T14:00:00.000Z",
  timezone: "America/Toronto",
};

test("utcDateOnlySchema reports bad format and overflow as Zod issues without throwing", () => {
  for (const value of ["02/15/2026", "2026-02-30", "2026-2-5", ""] ) {
    let result: ReturnType<typeof utcDateOnlySchema.safeParse> | undefined;
    assert.doesNotThrow(() => {
      result = utcDateOnlySchema.safeParse(value);
    });
    assert.equal(result?.success, false, value);
    if (result && !result.success) {
      assert.equal(result.error.issues[0]?.message, "Enter a valid date in YYYY-MM-DD format");
    }
  }
});

test("payroll input validates date order exact IDs and keeps sendAt as an instant", () => {
  const parsed = payrollRunInputSchema.safeParse(validPayrollInput);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.payDate.toISOString(), "2026-02-15T00:00:00.000Z");
    assert.equal(parsed.data.sendAt.toISOString(), "2026-02-13T14:00:00.000Z");
  }
  assert.equal(payrollRunInputSchema.safeParse({
    ...validPayrollInput,
    periodStart: "2026-02-20",
    periodEnd: "2026-02-14",
  }).success, false);
  assert.equal(payrollRunInputSchema.safeParse({
    ...validPayrollInput,
    payDate: "2026-02-30",
  }).success, false);
  assert.equal(payrollRunInputSchema.safeParse({
    ...validPayrollInput,
    items: [{ ...validPayrollInput.items[0], employeeId: "not-a-bigint" }],
  }).success, false);
});
