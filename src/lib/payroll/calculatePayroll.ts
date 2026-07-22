// CRA-compliant payroll calculation for Ontario, using the T4127 annualization method
// (Option 1 — Chapter 4). See cra-constants-2026.ts for the year's constants.
//
// Limitations:
// - Ontario residents only. Other provinces require their own surtax/health-premium tables.
// - Does not model year-to-date CPP/EI maxout. Each pay period is calculated independently;
//   for a full year of stable employment the per-period caps are sufficient, but a mid-year
//   maxout is not detected.
// - Does not model CPP2 (second additional contribution above YMPE up to YAMPE).
// - Treats every pay as periodic (not bonus/commission). Bonus tax (TB) is not implemented.
// - Federal BPAF phase-out for high earners is not modeled — caller passes the TD1 amount.

import {
  CPP,
  EI,
  FEDERAL_TAX,
  ONTARIO_TAX,
  PAY_PERIODS,
} from "./cra-constants-2026.ts";

const HOLIDAY_MULTIPLIER = 1.5;
const OVERTIME_MULTIPLIER = 1.5;

const r2 = (n: number) =>
  Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

export type CalculatePayrollInput = {
  payType: "HOURLY" | "SALARY";
  payGroup: "BI_WEEKLY" | "MONTHLY";
  hourlyRate: number | null;
  salary: number | null;
  vacationPay: number | null;
  hoursWorked: number | null;
  overtime: number;
  holidayHours: number;
  includeVacation: boolean;
  federalTD1: number;
  provincialTD1: number;
};

export type CalculatePayrollResult = {
  basePay: number;
  vacationAmount: number;
  grossPay: number;
  ded_cpp: number;
  ded_ei: number;
  ded_tax: number;
  totalDeductions: number;
  ded_eht: number;
  ded_wsib: number;
  netPay: number;
};

type Bracket = { from: number };
function pickBracket<T extends Bracket>(brackets: readonly T[], A: number): T {
  let chosen = brackets[0];
  for (const b of brackets) {
    if (A >= b.from) chosen = b;
    else break;
  }
  return chosen;
}

export function calculatePayrollAmounts(
  input: CalculatePayrollInput
): CalculatePayrollResult {
  const P = PAY_PERIODS[input.payGroup];

  // 1. Base pay for this period.
  let basePay = 0;
  if (input.payType === "HOURLY") {
    const rate = Number(input.hourlyRate ?? 0);
    const totalHours = Number(input.hoursWorked ?? 0);
    const overtime = Number(input.overtime ?? 0);
    const holidayHours = Math.min(
      Math.max(Number(input.holidayHours ?? 0), 0),
      Math.max(totalHours, 0)
    );
    const regularHours = Math.max(totalHours - holidayHours, 0);

    basePay =
      rate * regularHours +
      rate * HOLIDAY_MULTIPLIER * holidayHours +
      rate * OVERTIME_MULTIPLIER * overtime;
  } else {
    basePay = Number(input.salary ?? 0) / P;
  }

  const vacationPct = Number(input.vacationPay ?? 0) / 100;
  const vacationAmount = input.includeVacation ? basePay * vacationPct : 0;
  const grossPay = basePay + vacationAmount;

  // 2. CPP — proration of the $3,500 annual exemption per pay period, capped at YMPE.
  const periodExemption = CPP.basicExemption / P;
  const periodMaxPensionable = (CPP.YMPE - CPP.basicExemption) / P;
  const pensionableEarnings = Math.min(
    Math.max(grossPay - periodExemption, 0),
    periodMaxPensionable
  );
  const cppContribution = pensionableEarnings * CPP.rate;

  // 3. EI — capped at the annual maximum insurable earnings.
  const periodMaxInsurable = EI.maxInsurableEarnings / P;
  const insurableEarnings = Math.min(grossPay, periodMaxInsurable);
  const eiPremium = insurableEarnings * EI.rate;

  // 4. F5A — first-additional CPP enhancement (1% portion). Subtracted from income before
  //    annualizing, per T4127 Step 1. F5A = C × (0.01 / 0.0595). For non-bonus pay, F5A = F5.
  const F5A = cppContribution * (0.01 / CPP.rate);

  // 5. Annualized taxable income (A). Simplified: I = grossPay; no F, F2, U1, HD, F1.
  const A = P * (grossPay - F5A);

  // 6. Annual contributions used in K2/K2P (federal lowest-rate × base CPP + EI credits).
  const annualBaseCPP = Math.min(
    P * cppContribution * (CPP.baseRate / CPP.rate),
    CPP.maxBaseContribution
  );
  const annualEI = Math.min(P * eiPremium, EI.maxAnnualPremium);

  // 7. Federal annual basic tax (T3) → annual tax (T1).
  const fedBracket = pickBracket(FEDERAL_TAX.brackets, A);
  const T3basic = fedBracket.rate * A - fedBracket.K;
  const K1 = FEDERAL_TAX.lowestRate * input.federalTD1;
  const K2 = FEDERAL_TAX.lowestRate * (annualBaseCPP + annualEI);
  // K4 = lesser of (R0 × A) or (R0 × CEA). For any employee earning above CEA, this is R0 × CEA.
  const K4 = Math.min(
    FEDERAL_TAX.lowestRate * A,
    FEDERAL_TAX.lowestRate * FEDERAL_TAX.CEA
  );
  const T3 = Math.max(T3basic - K1 - K2 - K4, 0);
  const T1 = T3; // Ontario: no abatement, no LCF assumed.

  // 8. Ontario provincial annual tax (T2).
  const provBracket = pickBracket(ONTARIO_TAX.brackets, A);
  const T4basic = provBracket.rate * A - provBracket.KP;
  const K1P = ONTARIO_TAX.lowestRate * input.provincialTD1;
  const K2P = ONTARIO_TAX.lowestRate * (annualBaseCPP + annualEI);
  const T4 = Math.max(T4basic - K1P - K2P, 0);

  // V1 — Ontario surtax.
  let V1 = 0;
  if (T4 > ONTARIO_TAX.surtax.threshold2) {
    V1 =
      ONTARIO_TAX.surtax.rate1 * (T4 - ONTARIO_TAX.surtax.threshold1) +
      ONTARIO_TAX.surtax.rate2 * (T4 - ONTARIO_TAX.surtax.threshold2);
  } else if (T4 > ONTARIO_TAX.surtax.threshold1) {
    V1 = ONTARIO_TAX.surtax.rate1 * (T4 - ONTARIO_TAX.surtax.threshold1);
  }

  // V2 — Ontario Health Premium.
  let V2 = 0;
  for (const tier of ONTARIO_TAX.ohp) {
    if (A > tier.fromA && A <= tier.toA) {
      V2 = Math.min(tier.cap, tier.flat + tier.rate * (A - tier.fromA));
      break;
    }
  }

  // S — Ontario tax reduction. Y = 0 with no dependents claimed (the only case modeled).
  const Y = 0;
  const S = Math.max(0, Math.min(T4 + V1, 2 * (300 + Y) - (T4 + V1)));

  const T2 = Math.max(T4 + V1 + V2 - S, 0);

  // 9. Per-period income tax = (T1 + T2) / P. LCF/LCP assumed 0.
  const incomeTax = (T1 + T2) / P;

  const ded_cpp = r2(cppContribution);
  const ded_ei = r2(eiPremium);
  const ded_tax = r2(incomeTax);
  const totalDeductions = r2(ded_cpp + ded_ei + ded_tax);
  const ded_eht = 0;
  const ded_wsib = 0;
  const netPay = r2(grossPay - totalDeductions - ded_eht - ded_wsib);

  return {
    basePay: r2(basePay),
    vacationAmount: r2(vacationAmount),
    grossPay: r2(grossPay),
    ded_cpp,
    ded_ei,
    ded_tax,
    totalDeductions,
    ded_eht,
    ded_wsib,
    netPay,
  };
}
