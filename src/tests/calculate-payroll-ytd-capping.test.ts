// Regression tests for the CPP/EI year-to-date capping fix in calculatePayrollAmounts
// (src/lib/payroll/calculatePayroll.ts, fixed 2026-07-22).
//
// Unlike calculate-payroll-golden.test.ts, these are NOT sourced from PDOC — PDOC only
// exposes YTD as an input for a single calculation, it doesn't let you script "run 20
// periods in a row and check period 16". These tests instead verify the capping formula
// directly: given a ytdPensionableEarnings / ytdInsurableEarnings figure, does the
// function cap CPP/EI on the *remaining room* to the annual maximum, rather than on a
// fixed per-period average (the bug that was fixed)?

import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatePayrollAmounts } from "../lib/payroll/calculatePayroll.ts";
import { CPP, EI, FEDERAL_TAX, ONTARIO_TAX } from "../lib/payroll/cra-constants-2026.ts";

const claimCode1 = {
  federalTD1: FEDERAL_TAX.defaultBPAF,
  provincialTD1: ONTARIO_TAX.defaultBPAP,
};

const baseInput = {
  payType: "SALARY" as const,
  payGroup: "BI_WEEKLY" as const,
  hourlyRate: null,
  salary: 130000,
  vacationPay: 4,
  hoursWorked: null,
  overtime: 0,
  holidayHours: 0,
  includeVacation: false,
  ...claimCode1,
};

const maxAnnualPensionable = CPP.YMPE - CPP.basicExemption; // 71,100

test("calculatePayrollAmounts — CPP is 0 once YTD pensionable earnings already reached YMPE", () => {
  const result = calculatePayrollAmounts({
    ...baseInput,
    ytdPensionableEarnings: maxAnnualPensionable,
  });

  assert.equal(result.ded_cpp, 0);
});

test("calculatePayrollAmounts — CPP is capped at the remaining room to YMPE, not a per-period average", () => {
  // Only $1,000 of pensionable-earnings room left for the year. This period's raw
  // pensionable earnings ($5,000 - periodExemption ≈ $4,865.38) would normally produce
  // ~$289.49 of CPP (per Case 3 in the golden tests) — but only $1,000 of room remains.
  const remainingRoom = 1000;
  const result = calculatePayrollAmounts({
    ...baseInput,
    ytdPensionableEarnings: maxAnnualPensionable - remainingRoom,
  });

  assert.equal(result.ded_cpp, Math.round(remainingRoom * CPP.rate * 100) / 100);
});

test("calculatePayrollAmounts — EI is 0 once YTD insurable earnings already reached the annual maximum", () => {
  const result = calculatePayrollAmounts({
    ...baseInput,
    ytdInsurableEarnings: EI.maxInsurableEarnings,
  });

  assert.equal(result.ded_ei, 0);
});

test("calculatePayrollAmounts — EI is capped at the remaining room to the annual maximum, not a per-period average", () => {
  const remainingRoom = 500;
  const result = calculatePayrollAmounts({
    ...baseInput,
    ytdInsurableEarnings: EI.maxInsurableEarnings - remainingRoom,
  });

  assert.equal(result.ded_ei, Math.round(remainingRoom * EI.rate * 100) / 100);
});

test("calculatePayrollAmounts — defaults ytdPensionableEarnings/ytdInsurableEarnings to 0 when omitted", () => {
  const withYtd = calculatePayrollAmounts({
    ...baseInput,
    ytdPensionableEarnings: 0,
    ytdInsurableEarnings: 0,
  });
  const withoutYtd = calculatePayrollAmounts(baseInput);

  assert.deepEqual(withoutYtd, withYtd);
});
