export type PayrollStatusUi =
  | "scheduled"
  | "funding"
  | "funds_confirmed"
  | "paying"
  | "paid"
  | "failed";

export const PAYROLL_STATUS_LABELS: Record<PayrollStatusUi, string> = {
  scheduled: "Scheduled",
  funding: "Funding payroll",
  funds_confirmed: "Funding confirmed",
  paying: "Paying employees",
  paid: "Paid",
  failed: "Failed",
};

export function toPayrollStatusUi(status: string): PayrollStatusUi {
  switch (status) {
    case "SCHEDULED":
      return "scheduled";
    case "FUNDING":
      return "funding";
    case "FUNDS_CONFIRMED":
      return "funds_confirmed";
    case "PAYING":
      return "paying";
    case "PAID":
      return "paid";
    case "FAILED":
      return "failed";
    default:
      return "scheduled";
  }
}
