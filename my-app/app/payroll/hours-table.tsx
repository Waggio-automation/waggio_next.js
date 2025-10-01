// app/payroll/hours-table.tsx
"use client";

import { useMemo, useState } from "react";

type EmployeeRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  employmentType: string;
  payType: "HOURLY" | "SALARY";
  hourlyRate: number | null;
  salary: number | null;
  payGroup: "BI_WEEKLY" | "MONTHLY";
  vacationPay: number; // %
  createdAt: string;
};

export default function HoursTable({ employees }: { employees: EmployeeRow[] }) {
  // 입력 상태: 직원별 시간
  const [hours, setHours] = useState<Record<string, { hours: number; overtime: number; includeVacation: boolean }>>(
    () =>
      Object.fromEntries(
        employees.map((e) => [
          e.id,
          { hours: 0, overtime: 0, includeVacation: true },
        ])
      )
  );

  const cad = useMemo(
    () => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }),
    []
  );

  const rows = employees.map((e) => {
    const h = hours[e.id] ?? { hours: 0, overtime: 0, includeVacation: true };

    let base = 0;
    if (e.payType === "HOURLY") {
      const rate = e.hourlyRate ?? 0;
      base = rate * (h.hours || 0) + rate * 1.5 * (h.overtime || 0);
    } else {
      const sal = e.salary ?? 0;
      base = e.payGroup === "BI_WEEKLY" ? sal / 26 : sal / 12;
    }

    const vacation = h.includeVacation ? base * (e.vacationPay / 100) : 0;
    const gross = base + vacation;

    return {
      ...e,
      input: h,
      base,
      vacation,
      gross,
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.base += r.base;
      acc.vacation += r.vacation;
      acc.gross += r.gross;
      return acc;
    },
    { base: 0, vacation: 0, gross: 0 }
  );

  return (
    <section className="border rounded overflow-auto">
      <div className="p-4 border-b flex items-center gap-3">
        <div className="text-lg font-medium">Current Run (Preview)</div>
        <div className="text-sm text-gray-500">No data is saved yet — for export/integration we’ll add actions later.</div>
      </div>

      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-3 text-left">Employee</th>
            <th className="p-3 text-left">Type</th>
            <th className="p-3 text-right">Rate / Period</th>
            <th className="p-3 text-right">Hours</th>
            <th className="p-3 text-right">OT</th>
            <th className="p-3 text-right">Base</th>
            <th className="p-3 text-right">Vacation</th>
            <th className="p-3 text-center">Incl. Vac</th>
            <th className="p-3 text-right">Gross</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-3">{r.firstName} {r.lastName}</td>
              <td className="p-3">{r.payType}</td>
              <td className="p-3 text-right">
                {r.payType === "HOURLY"
                  ? (r.hourlyRate != null ? cad.format(r.hourlyRate) + "/hr" : "-")
                  : r.payGroup === "BI_WEEKLY"
                    ? cad.format((r.salary ?? 0) / 26) + " / biweekly"
                    : cad.format((r.salary ?? 0) / 12) + " / monthly"}
              </td>
              <td className="p-3 text-right">
                {r.payType === "HOURLY" ? (
                  <input
                    type="number"
                    min={0}
                    step="0.25"
                    value={r.input.hours}
                    onChange={(e) =>
                      setHours((prev) => ({
                        ...prev,
                        [r.id]: { ...prev[r.id], hours: Number(e.target.value) || 0 },
                      }))
                    }
                    className="border rounded p-1 w-24 text-right"
                  />
                ) : (
                  <span className="text-gray-400">n/a</span>
                )}
              </td>
              <td className="p-3 text-right">
                {r.payType === "HOURLY" ? (
                  <input
                    type="number"
                    min={0}
                    step="0.25"
                    value={r.input.overtime}
                    onChange={(e) =>
                      setHours((prev) => ({
                        ...prev,
                        [r.id]: { ...prev[r.id], overtime: Number(e.target.value) || 0 },
                      }))
                    }
                    className="border rounded p-1 w-24 text-right"
                  />
                ) : (
                  <span className="text-gray-400">n/a</span>
                )}
              </td>
              <td className="p-3 text-right">{cad.format(r.base)}</td>
              <td className="p-3 text-right">
                {r.vacation ? cad.format(r.vacation) : "-"}{" "}
                {r.vacation ? <span className="text-gray-400">({r.vacationPay}%)</span> : null}
              </td>
              <td className="p-3 text-center">
                <input
                  type="checkbox"
                  checked={r.input.includeVacation}
                  onChange={(e) =>
                    setHours((prev) => ({
                      ...prev,
                      [r.id]: { ...prev[r.id], includeVacation: e.target.checked },
                    }))
                  }
                />
              </td>
              <td className="p-3 text-right font-medium">{cad.format(r.gross)}</td>
            </tr>
          ))}

          {rows.length === 0 && (
            <tr>
              <td className="p-6 text-center text-gray-500" colSpan={9}>
                No employees.
              </td>
            </tr>
          )}
        </tbody>

        <tfoot className="bg-gray-50">
          <tr className="border-t font-semibold">
            <td className="p-3" colSpan={5}>Totals</td>
            <td className="p-3 text-right">{cad.format(totals.base)}</td>
            <td className="p-3 text-right">{totals.vacation ? cad.format(totals.vacation) : "-"}</td>
            <td className="p-3" />
            <td className="p-3 text-right">{cad.format(totals.gross)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="p-4 border-t flex gap-2">
        <button className="border rounded px-3 py-2 hover:bg-gray-50">Export CSV (coming soon)</button>
        <button className="border rounded px-3 py-2 hover:bg-gray-50">Send to n8n (coming soon)</button>
      </div>
    </section>
  );
}
