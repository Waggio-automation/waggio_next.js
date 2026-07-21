import { prisma } from "@/lib/prisma";

// Server-side paystub HTML generation. This replaces the HTML that the
// external n8n workflow used to send to /api/payslip/pdf: the server is now
// the only author of paystub content, so callers can no longer forge it.
//
// Privacy by design: the paystub intentionally contains no SIN and no bank
// account details.

export type PaystubData = {
  company: {
    name: string;
    addressLines: string[];
  };
  employee: {
    fullName: string;
    employeeNumber: string | null;
    payType: "HOURLY" | "SALARY";
  };
  payHistoryId: bigint;
  periodStart: Date | null;
  periodEnd: Date | null;
  payDate: Date;
  hoursWorked: number | null;
  hourlyRate: number | null;
  grossPay: number;
  deductions: { label: string; amount: number }[];
  totalDeductions: number;
  netPay: number;
};

export async function getPaystubData(
  payHistoryId: bigint,
  companyId: bigint
): Promise<PaystubData | null> {
  const ph = await prisma.payHistory.findFirst({
    where: { id: payHistoryId, employee: { companyId } },
    select: {
      id: true,
      payDate: true,
      periodStart: true,
      periodEnd: true,
      hoursWorked: true,
      grossPay: true,
      ded_cpp: true,
      ded_ei: true,
      ded_income_tax: true,
      ded_eht: true,
      ded_wsib: true,
      netPay: true,
      employee: {
        select: {
          firstName: true,
          lastName: true,
          employeeNumber: true,
          payType: true,
          hourlyRate: true,
          company: {
            select: {
              name: true,
              addrLine1: true,
              addrLine2: true,
              addrCity: true,
              addrProvince: true,
              addrPostal: true,
            },
          },
        },
      },
    },
  });
  if (!ph || !ph.employee.company) return null;

  const company = ph.employee.company;
  const cityLine = [company.addrCity, company.addrProvince, company.addrPostal]
    .filter(Boolean)
    .join(", ");
  const addressLines = [company.addrLine1, company.addrLine2, cityLine].filter(
    (line): line is string => Boolean(line && line.trim())
  );

  const deductions = [
    { label: "CPP", amount: Number(ph.ded_cpp) },
    { label: "EI", amount: Number(ph.ded_ei) },
    { label: "Income Tax", amount: Number(ph.ded_income_tax) },
    { label: "EHT", amount: Number(ph.ded_eht) },
    { label: "WSIB", amount: Number(ph.ded_wsib) },
  ].filter((d) => d.amount > 0);
  const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);

  return {
    company: {
      name: company.name ?? "Your employer",
      addressLines,
    },
    employee: {
      fullName: `${ph.employee.firstName} ${ph.employee.lastName}`.trim(),
      employeeNumber: ph.employee.employeeNumber,
      payType: ph.employee.payType,
    },
    payHistoryId: ph.id,
    periodStart: ph.periodStart,
    periodEnd: ph.periodEnd,
    payDate: ph.payDate,
    hoursWorked: ph.hoursWorked == null ? null : Number(ph.hoursWorked),
    hourlyRate: ph.employee.hourlyRate == null ? null : Number(ph.employee.hourlyRate),
    grossPay: Number(ph.grossPay),
    deductions,
    totalDeductions,
    netPay: Number(ph.netPay),
  };
}

const cad = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildPaystubHtml(data: PaystubData): string {
  const period =
    data.periodStart || data.periodEnd
      ? `${formatDate(data.periodStart)} – ${formatDate(data.periodEnd)}`
      : "—";

  const earningsRows =
    data.employee.payType === "HOURLY" && data.hoursWorked != null
      ? `<tr>
          <td>Regular earnings</td>
          <td style="text-align:right;">${data.hoursWorked.toFixed(2)} hrs${
          data.hourlyRate != null ? ` × ${cad.format(data.hourlyRate)}` : ""
        }</td>
          <td style="text-align:right;">${cad.format(data.grossPay)}</td>
        </tr>`
      : `<tr>
          <td>Salary</td>
          <td style="text-align:right;">—</td>
          <td style="text-align:right;">${cad.format(data.grossPay)}</td>
        </tr>`;

  const deductionRows = data.deductions
    .map(
      (d) => `<tr>
        <td>${escapeHtml(d.label)}</td>
        <td style="text-align:right;"></td>
        <td style="text-align:right;">−${cad.format(d.amount)}</td>
      </tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 40px; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .muted { color: #6b7280; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
  .meta { margin: 18px 0 24px; display: flex; gap: 48px; }
  .meta div p { margin: 2px 0; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; border-bottom: 1px solid #d1d5db; padding: 6px 4px; }
  th:nth-child(2), th:nth-child(3) { text-align: right; }
  td { padding: 7px 4px; border-bottom: 1px solid #f3f4f6; }
  .totals td { border-bottom: none; padding: 4px; }
  .net { font-size: 16px; font-weight: bold; border-top: 2px solid #111827; }
  .footer { margin-top: 36px; font-size: 11px; color: #9ca3af; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Pay Statement</h1>
      <p class="muted">Statement #${data.payHistoryId.toString()}</p>
    </div>
    <div style="text-align:right;">
      <strong>${escapeHtml(data.company.name)}</strong>
      ${data.company.addressLines.map((l) => `<div class="muted">${escapeHtml(l)}</div>`).join("\n")}
    </div>
  </div>

  <div class="meta">
    <div>
      <p class="label">Employee</p>
      <p><strong>${escapeHtml(data.employee.fullName)}</strong></p>
      ${data.employee.employeeNumber ? `<p class="muted">Employee #${escapeHtml(data.employee.employeeNumber)}</p>` : ""}
    </div>
    <div>
      <p class="label">Pay period</p>
      <p>${period}</p>
    </div>
    <div>
      <p class="label">Pay date</p>
      <p>${formatDate(data.payDate)}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Earnings</th><th>Details</th><th>Amount</th></tr>
    </thead>
    <tbody>
      ${earningsRows}
    </tbody>
  </table>

  <table>
    <thead>
      <tr><th>Deductions</th><th></th><th>Amount</th></tr>
    </thead>
    <tbody>
      ${deductionRows || `<tr><td class="muted" colspan="3">No deductions</td></tr>`}
    </tbody>
  </table>

  <table class="totals">
    <tbody>
      <tr><td>Gross pay</td><td style="text-align:right;">${cad.format(data.grossPay)}</td></tr>
      <tr><td>Total deductions</td><td style="text-align:right;">−${cad.format(data.totalDeductions)}</td></tr>
      <tr class="net"><td>Net pay</td><td style="text-align:right;">${cad.format(data.netPay)}</td></tr>
    </tbody>
  </table>

  <div class="footer">
    This statement was generated by Waggio. If anything looks incorrect, contact your employer.
  </div>
</body>
</html>`;
}
