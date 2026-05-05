export const COMPANY_PLAN_ORDER = ["BASIC", "PRO"] as const;

export type CompanyPlanCode = (typeof COMPANY_PLAN_ORDER)[number];

export type CompanyPlanDefinition = {
  code: CompanyPlanCode;
  name: string;
  price: string;
  perEmployee: string;
  description: string;
  features: string[];
  includedRuns: string;
  overage: string;
};

export const COMPANY_PLAN_DEFINITIONS: Record<CompanyPlanCode, CompanyPlanDefinition> = {
  BASIC: {
    code: "BASIC",
    name: "Basic",
    price: "$19/month",
    perEmployee: "$4 per employee",
    description:
      "Designed for businesses that want a simple way to run payroll and complete employee payouts in one place.",
    features: [
      "Payroll calculation including CPP, EI, and tax deductions",
      "Paystub generation",
      "Employee management",
      "Automatic payouts",
    ],
    includedRuns:
      "Includes up to 2 payroll runs per month, which covers most semi-monthly and bi-weekly payroll schedules.",
    overage:
      "If a bi-weekly schedule needs 3 pay runs in a month, the third run is included at no extra cost. Additional runs beyond that are billed at $10 per run.",
  },
  PRO: {
    code: "PRO",
    name: "Pro",
    price: "$39/month",
    perEmployee: "$6 per employee",
    description:
      "Designed for businesses that want to manage payroll, tax remittances, and year-end reporting in one system.",
    features: [
      "Everything in Basic",
      "Automatic CRA remittance calculations",
      "T4 and T4 Summary generation",
      "Payment deadline reminders",
      "Data validation to prevent missing information and errors",
      "Payroll audit features",
    ],
    includedRuns:
      "Includes up to 4 payroll runs per month, covering most semi-monthly, bi-weekly, and weekly payroll schedules.",
    overage: "Additional runs beyond the included amount are billed at $8 per run.",
  },
};

export function getCompanyPlans() {
  return COMPANY_PLAN_ORDER.map((code) => COMPANY_PLAN_DEFINITIONS[code]);
}

export function isCompanyPlanCode(value: string): value is CompanyPlanCode {
  return COMPANY_PLAN_ORDER.includes(value as CompanyPlanCode);
}
