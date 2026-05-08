// CRA Payroll Deductions Formulas (T4127), 122nd Edition, effective January 1, 2026.
// Source: https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html
//
// Refresh this file each January from CRA's T4127. The formulas in calculatePayroll.ts
// are stable across years — only the constants below change.

export const TAX_YEAR = 2026 as const;

export const PAY_PERIODS = {
  BI_WEEKLY: 26,
  MONTHLY: 12,
} as const;

// Table 8.3 / 8.4 — CPP (Canada except QC)
export const CPP = {
  YMPE: 74600,
  basicExemption: 3500,
  rate: 0.0595,
  baseRate: 0.0495,
  maxBaseContribution: 3519.45,
  maxTotalContribution: 4230.45,
} as const;

// Table 8.7 — EI (Canada except QC)
export const EI = {
  maxInsurableEarnings: 68900,
  rate: 0.0163,
  maxAnnualPremium: 1123.07,
} as const;

// Table 8.1 — Federal income tax brackets, rates (R), and constants (K).
// Brackets are right-open: A in [from, next.from). The last bracket has no upper bound.
export const FEDERAL_TAX = {
  brackets: [
    { from: 0,      rate: 0.14,  K: 0 },
    { from: 58523,  rate: 0.205, K: 3804 },
    { from: 117045, rate: 0.26,  K: 10241 },
    { from: 181440, rate: 0.29,  K: 15685 },
    { from: 258482, rate: 0.33,  K: 26024 },
  ],
  lowestRate: 0.14,
  // Table 8.2 — Canada Employment Amount (federal K4 cap).
  CEA: 1501,
  // Default federal BPAF for 2026 (full amount; phases out for high earners — not modeled here).
  defaultBPAF: 16452,
} as const;

// Table 8.1 — Ontario provincial tax brackets, rates (V), and constants (KP).
export const ONTARIO_TAX = {
  brackets: [
    { from: 0,      rate: 0.0505, KP: 0 },
    { from: 53891,  rate: 0.0915, KP: 2210 },
    { from: 107785, rate: 0.1116, KP: 4376 },
    { from: 150000, rate: 0.1216, KP: 5876 },
    { from: 220000, rate: 0.1316, KP: 8076 },
  ],
  lowestRate: 0.0505,
  // Table 8.2 — Ontario BPAP.
  defaultBPAP: 12989,
  // V1 — Ontario surtax on T4.
  surtax: {
    threshold1: 5818,
    threshold2: 7446,
    rate1: 0.20,
    rate2: 0.36,
  },
  // V2 — Ontario Health Premium. Each tier: V2 = min(cap, flat + rate × (A − fromA)).
  ohp: [
    { fromA: 0,      toA: 20000,             flat: 0,   rate: 0,    cap: 0 },
    { fromA: 20000,  toA: 36000,             flat: 0,   rate: 0.06, cap: 300 },
    { fromA: 36000,  toA: 48000,             flat: 300, rate: 0.06, cap: 450 },
    { fromA: 48000,  toA: 72000,             flat: 450, rate: 0.25, cap: 600 },
    { fromA: 72000,  toA: 200000,            flat: 600, rate: 0.25, cap: 750 },
    { fromA: 200000, toA: Number.POSITIVE_INFINITY, flat: 750, rate: 0.25, cap: 900 },
  ],
} as const;
