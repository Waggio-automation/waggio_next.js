// Golden tests for calculatePayrollAmounts (src/lib/payroll/calculatePayroll.ts).
//
// Methodology: these 5 cases were entered directly into CRA's live Payroll Deductions
// Online Calculator (PDOC) — https://apps.cra-arc.gc.ca/ebci/rhpd/beta/ — on 2026-07-22
// (PDOC's "July 1st, 2026 edition"), using calculation type "Salary", province Ontario,
// TD1 claim amounts left at their default Basic Personal Amounts (federal 16,452.00 /
// provincial 12,989.00 — matching FEDERAL_TAX.defaultBPAF / ONTARIO_TAX.defaultBPAP in
// cra-constants-2026.ts), all YTD/CPP-exempt/EI-exempt fields left blank, "Number of
// pensionable months" left at its default of 12, QPP = No, Member of the clergy = No.
// Expected values below are PDOC's reported "CPP deductions", "EI deductions", "Total tax
// deductions", "Total deductions", and "Net amount" for each case, verbatim.
//
// Bug found + fixed via this verification pass (2026-07-22): calculatePayrollAmounts used
// to cap CPP/EI per period by dividing the annual maximum by the number of pay periods
// (e.g. periodMaxPensionable = (YMPE - exemption) / P). PDOC does not do this — it only
// caps once cumulative YTD pensionable/insurable earnings reach the annual maximum. For
// low earners the two approaches happened to agree (the per-period-average cap was never
// actually reached), which is why Cases 1, 4 originally passed even with the bug — but
// Cases 2 and 3 (mid/high income) diverged from PDOC by real, non-trivial amounts (e.g.
// Case 3's net pay was off by $155.84/period). See the CPP/EI capping note in
// calculatePayroll.ts's file header for the fix and the ytdPensionableEarnings /
// ytdInsurableEarnings inputs it added. All 5 cases below now match PDOC exactly, to the
// cent, using the default ytd*=0 (i.e., a fresh year / first pay period).
//
// All cases assume: Ontario, claim code 1 (basic personal amount only), no other TD1
// credits, a single pay period with no YTD earnings yet this calendar year.
//
// KNOWN LIMITATIONS OF calculatePayrollAmounts (see file header there too):
//   TODO(cpp2): CPP2 (second additional CPP contribution on pensionable earnings between
//     YMPE $74,600 and YAMPE $85,000, at 4.00%, capped at $416/year for 2026 —
//     https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html)
//     is NOT implemented. PDOC reports "CPP2 deductions 0.00" for every case below because
//     each is a standalone, YTD=0 calculation — an employee's cumulative pensionable
//     earnings only cross YMPE (and start owing CPP2) partway through the year. Once
//     ytdPensionableEarnings is wired up for real payroll runs (see TODO(ytd) below),
//     CPP2 will start to matter and will need to be implemented for those employees.
//   TODO(ytd): ytdPensionableEarnings / ytdInsurableEarnings default to 0 in this
//     function. Production callers (e.g. src/app/api/payroll/run/route.ts) must pass the
//     real cumulative YTD figures from prior pay periods this calendar year, or CPP/EI
//     will never stop being deducted once an employee crosses YMPE / the EI maximum —
//     see calculate-payroll-ytd-capping.test.ts for a regression test of the capping
//     logic itself (not PDOC-sourced, just verifying the formula).

import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatePayrollAmounts } from "../lib/payroll/calculatePayroll.ts";
import { FEDERAL_TAX, ONTARIO_TAX } from "../lib/payroll/cra-constants-2026.ts";

const claimCode1 = {
  federalTD1: FEDERAL_TAX.defaultBPAF,
  provincialTD1: ONTARIO_TAX.defaultBPAP,
};

// Case 1 — hourly pay, bi-weekly pay period, ordinary income.
// $32.00/hr x 80 hrs (2 x 40 hr weeks), no overtime/holiday/vacation.
// PDOC: Federal tax 254.20, Provincial tax 136.70, CPP 144.31, CPP2 0.00, EI 41.73,
// Total deductions 576.94, Net amount 1,983.06.
test("calculatePayrollAmounts — hourly, bi-weekly, ordinary income", () => {
  const result = calculatePayrollAmounts({
    payType: "HOURLY",
    payGroup: "BI_WEEKLY",
    hourlyRate: 32,
    salary: null,
    vacationPay: 4,
    hoursWorked: 80,
    overtime: 0,
    holidayHours: 0,
    includeVacation: false,
    ...claimCode1,
  });

  assert.equal(result.basePay, 2560);
  assert.equal(result.vacationAmount, 0);
  assert.equal(result.grossPay, 2560);
  assert.equal(result.ded_cpp, 144.31);
  assert.equal(result.ded_ei, 41.73);
  assert.equal(result.ded_tax, 390.9);
  assert.equal(result.totalDeductions, 576.94);
  assert.equal(result.netPay, 1983.06);
});

// Case 2 — salary pay, monthly pay period, ordinary income.
// $72,000/year salary, no vacation.
// PDOC: Federal tax 639.19, Provincial tax 335.95, CPP 339.65, CPP2 0.00, EI 97.80,
// Total deductions 1,412.59, Net amount 4,587.41.
// (Pre-fix, this function reported ded_ei = 93.59 — a per-period-average EI cap that
// PDOC does not apply for a standalone/YTD=0 calculation. See file header note above.)
test("calculatePayrollAmounts — salary, monthly, ordinary income", () => {
  const result = calculatePayrollAmounts({
    payType: "SALARY",
    payGroup: "MONTHLY",
    hourlyRate: null,
    salary: 72000,
    vacationPay: 4,
    hoursWorked: null,
    overtime: 0,
    holidayHours: 0,
    includeVacation: false,
    ...claimCode1,
  });

  assert.equal(result.basePay, 6000);
  assert.equal(result.vacationAmount, 0);
  assert.equal(result.grossPay, 6000);
  assert.equal(result.ded_cpp, 339.65);
  assert.equal(result.ded_ei, 97.8);
  assert.equal(result.ded_tax, 975.14);
  assert.equal(result.totalDeductions, 1412.59);
  assert.equal(result.netPay, 4587.41);
});

// Case 3 — high income, salary, bi-weekly: exercises the Ontario surtax (V1).
// $130,000/year ($5,000/period) puts annualized taxable income (A ≈ $129,289) well past
// both surtax thresholds ($5,818 / $7,446 on Ontario basic tax T4), so both the 20% and
// 36% surtax rates apply.
// PDOC: Federal tax 771.80, Provincial tax 427.02, CPP 289.49, CPP2 0.00, EI 81.50,
// Total deductions 1,569.81, Net amount 3,430.19.
// (Pre-fix, this function reported ded_cpp = 162.71 and ded_ei = 43.19 — both wrongly
// capped by the per-period-average bug, understating net deductions by $155.84/period.
// CPP2 is still 0.00 here too, same reasoning as Case 2's note — see TODO(cpp2) above.)
test("calculatePayrollAmounts — high income, bi-weekly, Ontario surtax bracket", () => {
  const result = calculatePayrollAmounts({
    payType: "SALARY",
    payGroup: "BI_WEEKLY",
    hourlyRate: null,
    salary: 130000,
    vacationPay: 4,
    hoursWorked: null,
    overtime: 0,
    holidayHours: 0,
    includeVacation: false,
    ...claimCode1,
  });

  assert.equal(result.basePay, 5000);
  assert.equal(result.grossPay, 5000);
  assert.equal(result.ded_cpp, 289.49);
  assert.equal(result.ded_ei, 81.5);
  assert.equal(result.ded_tax, 1198.82);
  assert.equal(result.totalDeductions, 1569.81);
  assert.equal(result.netPay, 3430.19);
});

// Case 4 — low income, hourly, bi-weekly: exercises the Ontario tax reduction (S).
// $20.50/hr x 40 hrs = $820/period ($21,141.80 annualized) lands just past the point
// where Ontario basic tax (T4 ≈ $349.62) exceeds the tax-reduction band (2 x $300 = $600
// for a filer with no dependents), so the reduction only partially offsets tax
// (S ≈ $250.38 of the $349.62), leaving tax payable > 0 — the partial-reduction case,
// distinct from the (more common) case of very low income where reduction wipes tax out
// entirely.
// PDOC: Federal tax 10.55, Provincial tax 6.45, CPP 40.78, CPP2 0.00, EI 13.37,
// Total deductions 71.15, Net amount 748.85.
test("calculatePayrollAmounts — low income, bi-weekly, Ontario tax reduction bracket", () => {
  const result = calculatePayrollAmounts({
    payType: "HOURLY",
    payGroup: "BI_WEEKLY",
    hourlyRate: 20.5,
    salary: null,
    vacationPay: 4,
    hoursWorked: 40,
    overtime: 0,
    holidayHours: 0,
    includeVacation: false,
    ...claimCode1,
  });

  assert.equal(result.basePay, 820);
  assert.equal(result.grossPay, 820);
  assert.equal(result.ded_cpp, 40.78);
  assert.equal(result.ded_ei, 13.37);
  assert.equal(result.ded_tax, 17);
  assert.equal(result.totalDeductions, 71.15);
  assert.equal(result.netPay, 748.85);
});

// Case 5 — hourly, bi-weekly, vacation pay included in gross.
// $25.00/hr x 70 hrs = $1,750 base, + 4% vacation pay ($70) included in the
// pensionable/insurable/taxable gross (includeVacation: true).
// PDOC: Salary or wages income 1,750.00, Vacation pay 70.00, Total cash income 1,820.00,
// Federal tax 139.94, Provincial tax 77.43, CPP 100.28, CPP2 0.00, EI 29.67,
// Total deductions 347.32, Net amount 1,472.68.
test("calculatePayrollAmounts — hourly, bi-weekly, vacation pay included", () => {
  const result = calculatePayrollAmounts({
    payType: "HOURLY",
    payGroup: "BI_WEEKLY",
    hourlyRate: 25,
    salary: null,
    vacationPay: 4,
    hoursWorked: 70,
    overtime: 0,
    holidayHours: 0,
    includeVacation: true,
    ...claimCode1,
  });

  assert.equal(result.basePay, 1750);
  assert.equal(result.vacationAmount, 70);
  assert.equal(result.grossPay, 1820);
  assert.equal(result.ded_cpp, 100.28);
  assert.equal(result.ded_ei, 29.67);
  assert.equal(result.ded_tax, 217.37);
  assert.equal(result.totalDeductions, 347.32);
  assert.equal(result.netPay, 1472.68);
});
