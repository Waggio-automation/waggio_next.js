// app/(...)/components/HoursTable.tsx
"use client";

import { useMemo, useState, useRef, useEffect, Fragment  } from "react";
import PeriodRangePicker from "./components/PeriodRangePicker";
import { getOntarioHolidaysInRange } from "@/lib/ontarioHolidays";

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
  vacationPay: number;
  createdAt: string;
};

type RowState = {
  include: boolean;
  hours: number;
  overtime: number;
  includeVacation: boolean;
  holidayHours: number; // Hours worked during public holidays
};

const HOLIDAY_MULTIPLIER = 1.5; // Hourly rate multiplier for public holiday hours

// === 2025 Ontario (preview) deduction rates ===
// NOTE: This is an estimate/preview. Final paystub should be calculated/verified server-side.
const CPP_RATE = 0.0595; // 5.95%
const EI_RATE = 0.0166; // 1.66%
const FEDERAL_TAX_RATE = 0.15; // First bracket (simplified)
const PROV_TAX_RATE = 0.0505; // Ontario first bracket (simplified)
const TOTAL_TAX_RATE = FEDERAL_TAX_RATE + PROV_TAX_RATE; // ~20.05%

// Round to 2 decimals
const r2 = (n: number) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

function fmtDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function parseYmd(s: string) {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function DateField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      />
      {hint ? <span className="text-[11px] text-gray-400">{hint}</span> : null}
    </label>
  );
}

export default function HoursTable({ employees }: { employees: EmployeeRow[] }) {
  const [rowsState, setRowsState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      employees.map((e) => [
        e.id,
        {
          include: true,
          hours: 0,
          overtime: 0,
          includeVacation: true,
          holidayHours: 0,
        },
      ])
    )
  );

  const [period, setPeriod] = useState({ start: "", end: "" });
  const [payDate, setPayDate] = useState("");
  const [sendOn, setSendOn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  // Expand details per-row (dropdown)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ✅ Calculate Ontario public holidays within the selected pay period
  const periodHolidays = useMemo(() => {
    if (!period.start || !period.end) return [];
    const start = parseYmd(period.start);
    const end = parseYmd(period.end);
    if (!start || !end) return [];
    return getOntarioHolidaysInRange(start, end);
  }, [period.start, period.end]);

  // Automatically set "Send paystub on" date when payDate is selected
  useEffect(() => {
    if (payDate && !sendOn) {
      const d = new Date(payDate);
      d.setDate(d.getDate() - 2);
      setSendOn(fmtDate(d));
    }
  }, [payDate, sendOn]);

  const allSelected = employees.every((e) => rowsState[e.id]?.include);
  const anySelected = employees.some((e) => rowsState[e.id]?.include);
  const allRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!allRef.current) return;
    allRef.current.indeterminate = !allSelected && anySelected;
  }, [allSelected, anySelected]);

  const formatCad = useMemo(
    () => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }),
    []
  );

  const rows = employees.map((e) => {
    const st = rowsState[e.id];
    const rate = e.hourlyRate ?? 0;

    let base = 0;

    if (e.payType === "HOURLY") {
      const totalHours = Number(st?.hours || 0);
      const holidayHoursInput = Number(st?.holidayHours || 0);

      // Keep holiday hours within [0, totalHours]
      const holidayHours = Math.min(Math.max(holidayHoursInput, 0), Math.max(totalHours, 0));
      const normalHours = Math.max(totalHours - holidayHours, 0);

      const regularPay = rate * normalHours;
      const holidayPay = rate * HOLIDAY_MULTIPLIER * holidayHours;
      const overtimePay = rate * 1.5 * Number(st?.overtime || 0);

      base = regularPay + holidayPay + overtimePay;
    } else {
      const sal = e.salary ?? 0;
      base = e.payGroup === "BI_WEEKLY" ? sal / 26 : sal / 12;
    }

    const vacation = st?.includeVacation ? base * (e.vacationPay / 100) : 0;
    const gross = base + vacation;

    // Preview deductions (simplified)
    const ded_cpp = r2(gross * CPP_RATE);
    const ded_ei = r2(gross * EI_RATE);
    const ded_tax = r2(gross * TOTAL_TAX_RATE);
    const totalDeductions = r2(ded_cpp + ded_ei + ded_tax);
    const netPay = r2(gross - totalDeductions);

    return {
      ...e,
      state: st,
      base: r2(base),
      vacation: r2(vacation),
      gross: r2(gross),
      ded_cpp,
      ded_ei,
      ded_tax,
      totalDeductions,
      netPay,
    };
  });

  // Totals for selected employees only (matches label)
  const totals = rows
    .filter((r) => r.state?.include)
    .reduce(
      (acc, r) => ({
        base: r2(acc.base + r.base),
        vacation: r2(acc.vacation + r.vacation),
        gross: r2(acc.gross + r.gross),
        deductions: r2(acc.deductions + r.totalDeductions),
        net: r2(acc.net + r.netPay),
      }),
      { base: 0, vacation: 0, gross: 0, deductions: 0, net: 0 }
    );

  async function saveSelectedToPayHistory() {
    setMsg({});

    try {
      setSubmitting(true);

      if (!period.start || !period.end)
        throw new Error("Please select the start and end of the pay period.");
      if (!payDate) throw new Error("Please select a pay date.");
      if (!sendOn) throw new Error("Please select the date to send the paystub.");

      const payDateObj = parseYmd(payDate);
      const endObj = parseYmd(period.end);
      if (payDateObj && endObj && payDateObj < endObj) {
        setMsg({
          err: "Pay date cannot be before the end of the pay period.",
        });
        return;
      }

      const items = rows
        .filter((r) => r.state.include)
        .map((r) => ({
          employeeId: r.id,
          hoursWorked: r.payType === "HOURLY" ? r.state.hours : null,
          overtime: r.payType === "HOURLY" ? r.state.overtime : 0,
          includeVacation: r.state.includeVacation,
          holidayHours: r.payType === "HOURLY" ? r.state.holidayHours : 0,
        }));

      if (!items.length) throw new Error("No employees selected to run payroll.");

      const res = await fetch("/api/payroll/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          items,
          payDate,
          periodStart: period.start,
          periodEnd: period.end,
          sendAt: sendOn,
          timezone: "America/Toronto",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed");

      setMsg({ ok: `Successfully triggered Payroll Workflow! (n8n)` });
    } catch (e: unknown) {
      setMsg({ err: e instanceof Error ? e.message : "Failed to run payroll." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-gray-900">Payroll Run</h2>
        <p className="mt-1 text-sm text-gray-600">
          Review inputs, confirm payroll dates, and create paystubs without changing the current
          calculation flow.
        </p>
      </div>

      <div className="bg-white overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="p-3 text-center">
                <input
                  ref={allRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) =>
                    setRowsState((prev) =>
                      Object.fromEntries(
                        employees.map((emp) => [
                          emp.id,
                          { ...prev[emp.id], include: e.target.checked },
                        ])
                      )
                    )
                  }
                  aria-label="Select all employees"
                />
              </th>
              <th className="p-3 text-left">Employee</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-right">Rate / Period</th>
              <th className="p-3 text-right">Hours (total, excl. OT)</th>
              <th className="p-3 text-right">Overtime Hours (OT)</th>
              <th className="p-3 text-right">Holiday hours (within total)</th>
              <th className="p-3 text-right">Base Pay</th>
              <th className="p-3 text-right">Vacation Pay</th>
              <th className="p-3 text-center">Include Vacation</th>

              {/* ✅ Gross -> Net Pay */}
              <th className="p-3 text-right">Net Pay</th>
              <th className="p-3 text-center">Details</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => {
              const isExpanded = !!expanded[r.id];

              return (
                <Fragment key={r.id}>
                  <tr key={r.id} className={`border-t border-gray-100 ${!r.state.include ? "opacity-50" : ""}`}>
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={r.state.include}
                        onChange={(e) =>
                          setRowsState((prev) => ({
                            ...prev,
                            [r.id]: { ...prev[r.id], include: e.target.checked },
                          }))
                        }
                      />
                    </td>

                    <td className="p-3 font-medium text-gray-900">
                      {r.firstName} {r.lastName}
                    </td>

                    <td className="p-3 text-gray-700">{r.payType}</td>

                    <td className="p-3 text-right text-gray-700">
                      {r.payType === "HOURLY"
                        ? r.hourlyRate != null
                          ? formatCad.format(r.hourlyRate) + " / hr"
                          : "-"
                        : r.payGroup === "BI_WEEKLY"
                        ? formatCad.format((r.salary ?? 0) / 26) + " / biweekly"
                        : formatCad.format((r.salary ?? 0) / 12) + " / monthly"}
                    </td>

                    <td className="p-3 text-right">
                      {r.payType === "HOURLY" ? (
                        <input
                          type="number"
                          min={0}
                          step="0.25"
                          value={r.state.hours}
                          onChange={(e) =>
                            setRowsState((prev) => ({
                              ...prev,
                              [r.id]: {
                                ...prev[r.id],
                                hours: Number(e.target.value) || 0,
                              },
                            }))
                          }
                          className="w-24 rounded-xl border border-gray-300 px-3 py-2 text-right text-sm"
                          disabled={!r.state.include}
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
                          value={r.state.overtime}
                          onChange={(e) =>
                            setRowsState((prev) => ({
                              ...prev,
                              [r.id]: {
                                ...prev[r.id],
                                overtime: Number(e.target.value) || 0,
                              },
                            }))
                          }
                          className="w-24 rounded-xl border border-gray-300 px-3 py-2 text-right text-sm"
                          disabled={!r.state.include}
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
                          value={r.state.holidayHours}
                          onChange={(e) =>
                            setRowsState((prev) => ({
                              ...prev,
                              [r.id]: {
                                ...prev[r.id],
                                holidayHours: Number(e.target.value) || 0,
                              },
                            }))
                          }
                          className="w-24 rounded-xl border border-gray-300 px-3 py-2 text-right text-sm"
                          disabled={!r.state.include}
                        />
                      ) : (
                        <span className="text-gray-400">n/a</span>
                      )}
                    </td>

                    <td className="p-3 text-right">{formatCad.format(r.base)}</td>

                    <td className="p-3 text-right">
                      {r.vacation ? formatCad.format(r.vacation) : "-"}
                    </td>

                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={r.state.includeVacation}
                        onChange={(e) =>
                          setRowsState((prev) => ({
                            ...prev,
                            [r.id]: { ...prev[r.id], includeVacation: e.target.checked },
                          }))
                        }
                        disabled={!r.state.include}
                      />
                    </td>

                    {/* ✅ Net Pay cell with hover tooltip */}
                    <td className="p-3 text-right font-semibold text-gray-900">
                      <span className="relative inline-block">
                        <span className="cursor-default">
                          {formatCad.format(r.netPay)}
                        </span>

                        {/* Hover tooltip (desktop-friendly). Click details for mobile. */}
                        <span className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-72 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs text-gray-700 shadow-lg group-hover:block">
                          {/* kept hidden by default; enabled below via wrapper */}
                        </span>
                      </span>

                      {/* Tooltip wrapper using group */}
                      <span className="group relative inline-block">
                        <span className="sr-only">Net pay breakdown</span>
                        <span className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-72 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs text-gray-700 shadow-lg group-hover:block">
                          <div className="mb-2 font-medium text-gray-900">
                            Estimated deductions (preview)
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span>Gross</span>
                              <span className="font-medium">{formatCad.format(r.gross)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>CPP</span>
                              <span>{formatCad.format(r.ded_cpp)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>EI</span>
                              <span>{formatCad.format(r.ded_ei)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Federal + ON tax</span>
                              <span>{formatCad.format(r.ded_tax)}</span>
                            </div>
                            <div className="my-1 border-t pt-1 flex justify-between">
                              <span className="font-medium">Total deductions</span>
                              <span className="font-medium">
                                {formatCad.format(r.totalDeductions)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="font-medium text-gray-900">Net Pay</span>
                              <span className="font-semibold text-gray-900">
                                {formatCad.format(r.netPay)}
                              </span>
                            </div>
                          </div>

                          <div className="mt-2 text-[11px] text-gray-500">
                            Preview only. Final paystub may differ.
                          </div>
                        </span>
                      </span>
                    </td>

                    {/* Details dropdown toggle */}
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => ({
                            ...prev,
                            [r.id]: !prev[r.id],
                          }))
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        disabled={!r.state.include}
                        aria-expanded={isExpanded}
                        aria-controls={`row-details-${r.id}`}
                      >
                        <span>Details</span>
                        <span className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                          ▾
                        </span>
                      </button>
                    </td>
                  </tr>

                  {/* Expanded details row */}
                  {isExpanded && (
                    <tr className="border-t border-gray-100 bg-gray-50/60">
                      <td colSpan={12} className="p-4">
                        <div
                          id={`row-details-${r.id}`}
                          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs"
                        >
                          <div className="rounded-2xl border border-gray-200 bg-white p-4">
                            <div className="mb-2 font-medium text-gray-900">Pay summary</div>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span>Base</span>
                                <span className="font-medium">
                                  {formatCad.format(r.base)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Vacation</span>
                                <span className="font-medium">
                                  {formatCad.format(r.vacation)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Gross</span>
                                <span className="font-medium">
                                  {formatCad.format(r.gross)}
                                </span>
                              </div>
                              <div className="flex justify-between border-t pt-1">
                                <span className="font-medium">Net Pay</span>
                                <span className="font-semibold">
                                  {formatCad.format(r.netPay)}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-gray-200 bg-white p-4">
                            <div className="mb-2 font-medium text-gray-900">
                              Estimated deductions (preview)
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span>CPP</span>
                                <span>{formatCad.format(r.ded_cpp)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>EI</span>
                                <span>{formatCad.format(r.ded_ei)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Federal + ON tax</span>
                                <span>{formatCad.format(r.ded_tax)}</span>
                              </div>
                              <div className="flex justify-between border-t pt-1">
                                <span className="font-medium">Total deductions</span>
                                <span className="font-medium">
                                  {formatCad.format(r.totalDeductions)}
                                </span>
                              </div>
                            </div>
                            <div className="mt-2 text-[11px] text-gray-500">
                              Preview only. Final paystub may differ.
                            </div>
                          </div>

                          <div className="rounded-2xl border border-gray-200 bg-white p-4">
                            <div className="mb-2 font-medium text-gray-900">Inputs</div>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span>Total hours</span>
                                <span>{r.payType === "HOURLY" ? r.state.hours : "n/a"}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>OT hours</span>
                                <span>{r.payType === "HOURLY" ? r.state.overtime : "n/a"}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Holiday hours</span>
                                <span>
                                  {r.payType === "HOURLY" ? r.state.holidayHours : "n/a"}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Include vacation</span>
                                <span>{r.state.includeVacation ? "Yes" : "No"}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>

          <tfoot className="bg-gray-50">
            <tr className="font-semibold border-t border-gray-200">
              <td className="p-3" colSpan={7}>
                Totals (selected employees only)
              </td>
              <td className="p-3 text-right">{formatCad.format(totals.base)}</td>
              <td className="p-3 text-right">{formatCad.format(totals.vacation)}</td>
              <td className="p-3 text-right">
                {/* spacer for Include Vacation column */}
              </td>

              {/* Net Pay totals + details column */}
              <td className="p-3 text-right">{formatCad.format(totals.net)}</td>
              <td className="p-3 text-center">
                <span className="text-[11px] text-gray-500">
                  Deductions: {formatCad.format(totals.deductions)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Schedule & dates */}
      <div className="border-t border-gray-200 bg-gray-50/60">
        <div className="flex flex-col gap-4 p-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Schedule</h3>
            <p className="mt-1 text-xs text-gray-500">
              Select the pay period, pay date, and paystub delivery date for your employees.
            </p>
          </div>

          {/* ✅ Holiday notice inside selected range */}
          {periodHolidays.length > 0 && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-[11px] text-amber-900">
              <p className="font-medium">This range includes Ontario public holidays:</p>
              <ul className="mt-1 list-disc pl-4">
                {periodHolidays.map((h) => (
                  <li key={`${h.id}-${h.date.toISOString()}`}>
                    {h.name} (
                    {h.date.toLocaleDateString("en-CA", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                    )
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-2">
              <PeriodRangePicker
                value={period}
                onChange={setPeriod}
                hint="Select start and end date at once"
              />
            </div>

            <DateField
              label="Pay date"
              value={payDate}
              onChange={setPayDate}
              hint="Actual payroll disbursement date"
            />
            <DateField
              label="Send paystub on"
              value={sendOn}
              onChange={setSendOn}
              hint="When employees will receive their paystub"
            />
          </div>

          <div className="mt-1 flex items-center justify-between">
            <p className="text-[11px] text-gray-500">
              Tip: &quot;Send paystub on&quot; can auto-set to 2 days before the pay date if left
              blank.
            </p>

            <button
              onClick={saveSelectedToPayHistory}
              disabled={submitting}
              className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Create Paystub & Save"}
            </button>
          </div>

          {msg.err && <span className="text-sm text-red-600">{msg.err}</span>}
          {msg.ok && <span className="text-sm text-green-700">{msg.ok}</span>}
        </div>
      </div>
    </section>
  );
}
