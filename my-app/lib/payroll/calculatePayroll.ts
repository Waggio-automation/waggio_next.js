const HOLIDAY_MULTIPLIER = 1.5;
const OVERTIME_MULTIPLIER = 1.5;
const CPP_RATE = 0.0595;
const EI_RATE = 0.0166;
const FEDERAL_TAX_RATE = 0.15;
const PROV_TAX_RATE = 0.0505;
const TOTAL_TAX_RATE = FEDERAL_TAX_RATE + PROV_TAX_RATE;

const r2 = (n: number) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

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

export function calculatePayrollAmounts(
  input: CalculatePayrollInput
): CalculatePayrollResult {
  let basePay = 0;

  if (input.payType === "HOURLY") {
    const rate = Number(input.hourlyRate ?? 0);
    const totalHours = Number(input.hoursWorked ?? 0);
    const overtime = Number(input.overtime ?? 0);

    // Holiday hours are a subset of total hours.
    const holidayHours = Math.min(Math.max(Number(input.holidayHours ?? 0), 0), Math.max(totalHours, 0));
    const regularHours = Math.max(totalHours - holidayHours, 0);

    const regularPay = rate * regularHours;
    const holidayPay = rate * HOLIDAY_MULTIPLIER * holidayHours;
    const overtimePay = rate * OVERTIME_MULTIPLIER * overtime;

    basePay = regularPay + holidayPay + overtimePay;
  } else {
    const salary = Number(input.salary ?? 0);
    basePay = input.payGroup === "BI_WEEKLY" ? salary / 26 : salary / 12;
  }

  const vacationPct = Number(input.vacationPay ?? 0) / 100;
  const vacationAmountRaw = input.includeVacation ? basePay * vacationPct : 0;
  const grossPayRaw = basePay + vacationAmountRaw;

  const ded_cpp = r2(grossPayRaw * CPP_RATE);
  const ded_ei = r2(grossPayRaw * EI_RATE);
  const ded_tax = r2(grossPayRaw * TOTAL_TAX_RATE);
  const totalDeductions = r2(ded_cpp + ded_ei + ded_tax);
  const ded_eht = 0;
  const ded_wsib = 0;

  const netPay = r2(grossPayRaw - totalDeductions - ded_eht - ded_wsib);

  return {
    basePay: r2(basePay),
    vacationAmount: r2(vacationAmountRaw),
    grossPay: r2(grossPayRaw),
    ded_cpp,
    ded_ei,
    ded_tax,
    totalDeductions,
    ded_eht,
    ded_wsib,
    netPay,
  };
}
