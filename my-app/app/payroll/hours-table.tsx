"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import PeriodRangePicker from "./components/PeriodRangePicker";

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

type RowState = { include: boolean; hours: number; overtime: number; includeVacation: boolean };

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
  // ✅ employees 그대로 유지
  const [rowsState, setRowsState] = useState<Record<string, RowState>>(
    () =>
      Object.fromEntries(
        employees.map((e) => [e.id, { include: true, hours: 0, overtime: 0, includeVacation: true }])
      )
  );

  const [period, setPeriod] = useState({ start: "", end: "" });
  const [payDate, setPayDate] = useState("");
  const [sendOn, setSendOn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  // ✅ payDate 고르면 자동 전송일 설정
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

  const cad = useMemo(() => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }), []);

  const rows = employees.map((e) => {
    const st = rowsState[e.id];
    const rate = e.hourlyRate ?? 0;
    let base = 0;

    if (e.payType === "HOURLY") {
      base = rate * (st.hours || 0) + rate * 1.5 * (st.overtime || 0);
    } else {
      const sal = e.salary ?? 0;
      base = e.payGroup === "BI_WEEKLY" ? sal / 26 : sal / 12;
    }

    const vacation = st.includeVacation ? base * (e.vacationPay / 100) : 0;
    const gross = base + vacation;

    return { ...e, state: st, base, vacation, gross };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      base: acc.base + r.base,
      vacation: acc.vacation + r.vacation,
      gross: acc.gross + r.gross,
    }),
    { base: 0, vacation: 0, gross: 0 }
  );

  async function saveSelectedToPayHistory() {
    setMsg({});
    // ❗ try 바깥에서 crypto/randomUUID 호출로 인한 렌더깨짐 방지
    const idemKey = typeof window !== "undefined" && crypto?.randomUUID ? crypto.randomUUID() : "";

    try {
      setSubmitting(true);

      if (!period.start || !period.end) throw new Error("Select period start/end.");
      if (!payDate) throw new Error("Select pay date.");
      if (!sendOn) throw new Error("Select 'Send paystub on' date.");

      // ✅ payDate가 period.end보다 빠르면 에러
      const payDateObj = parseYmd(payDate);
      const endObj = parseYmd(period.end);
      if (payDateObj && endObj && payDateObj < endObj) {
        setMsg({ err: "Pay date cannot be before the end of the pay period." });
        setSubmitting(false);
        return;
      }

      const items = rows
        .filter((r) => r.state.include)
        .map((r) => ({
          employeeId: r.id,
          hoursWorked: r.payType === "HOURLY" ? r.state.hours : null,
          overtime: r.payType === "HOURLY" ? r.state.overtime : 0,
          includeVacation: r.state.includeVacation,
        }));

      if (!items.length) throw new Error("No rows selected.");

      const res = await fetch("/api/payhistory", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idemKey },
        body: JSON.stringify({
          periodStart: period.start,
          periodEnd: period.end,
          payDate,
          sendOn,
          items,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");

      setMsg({ ok: `Saved ${data.count} pay history rows (status: PENDING)` });
    } catch (e: any) {
      // ✅ 에러 메시지만 갱신, 나머지 state 유지
      setMsg({ err: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border">
      <div className="p-4 border-b bg-white">
        <h2 className="text-lg font-semibold">Payroll Run</h2>
      </div>

      {/* ✅ Employee 테이블은 항상 렌더됨 */}
      <div className="bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
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
                  aria-label="Select all"
                />
              </th>
              <th className="p-3 text-left">Employee</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-right">Rate/Period</th>
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
              <tr key={r.id} className={`border-t ${!r.state.include ? "opacity-50" : ""}`}>
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
                      value={r.state.hours}
                      onChange={(e) =>
                        setRowsState((prev) => ({
                          ...prev,
                          [r.id]: { ...prev[r.id], hours: Number(e.target.value) || 0 },
                        }))
                      }
                      className="w-20 rounded border p-1 text-right"
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
                          [r.id]: { ...prev[r.id], overtime: Number(e.target.value) || 0 },
                        }))
                      }
                      className="w-20 rounded border p-1 text-right"
                      disabled={!r.state.include}
                    />
                  ) : (
                    <span className="text-gray-400">n/a</span>
                  )}
                </td>
                <td className="p-3 text-right">{cad.format(r.base)}</td>
                <td className="p-3 text-right">{r.vacation ? cad.format(r.vacation) : "-"}</td>
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
                <td className="p-3 text-right font-medium">{cad.format(r.gross)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr className="font-semibold border-t">
              <td className="p-3" colSpan={6}>Totals (selected)</td>
              <td className="p-3 text-right">{cad.format(totals.base)}</td>
              <td className="p-3 text-right">{cad.format(totals.vacation)}</td>
              <td />
              <td className="p-3 text-right">{cad.format(totals.gross)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ✅ Schedule */}
      <div className="border-t bg-gray-50/60">
        <div className="flex flex-col gap-4 p-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Schedule</h3>
            <p className="mt-1 text-xs text-gray-500">
              Pay period과 실제 지급일, 그리고 paystub 발송 날짜를 지정하세요.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-2">
              <PeriodRangePicker
                value={period}
                onChange={setPeriod}
                hint="한 번에 시작/종료 범위를 선택하세요"
              />
            </div>
            <DateField label="Pay date" value={payDate} onChange={setPayDate} hint="실제 지급일" />
            <DateField label="Send paystub on" value={sendOn} onChange={setSendOn} hint="직원에게 paystub을 보낼 날짜" />
          </div>

          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-[11px] text-gray-500">
              Tip: Pay date를 고르면 기본으로 전송일은 이틀 전으로 설정됩니다.
            </p>
            <button
              onClick={saveSelectedToPayHistory}
              disabled={submitting}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Save to Pay History (PENDING)"}
            </button>
          </div>

          {msg.err && <span className="text-sm text-red-600">{msg.err}</span>}
          {msg.ok && <span className="text-sm text-green-700">{msg.ok}</span>}
        </div>
      </div>
    </section>
  );
}
