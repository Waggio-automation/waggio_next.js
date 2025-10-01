"use client";

import { useMemo, useState, useRef, useEffect } from "react";

type EmployeeRow = {
  id: string; // stringified BIGINT
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

type RowState = { include: boolean; hours: number; overtime: number; includeVacation: boolean };

export default function HoursTable({ employees }: { employees: EmployeeRow[] }) {
  const [rowsState, setRowsState] = useState<Record<string, RowState>>(
    () =>
      Object.fromEntries(
        employees.map((e) => [e.id, { include: true, hours: 0, overtime: 0, includeVacation: true }])
      )
  );

  const [period, setPeriod] = useState({ start: "", end: "" });
  const [payDate, setPayDate] = useState(""); // 실제 payDate
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  // 전체 선택 체크박스 상태
  const allSelected = employees.every((e) => rowsState[e.id]?.include);
  const anySelected = employees.some((e) => rowsState[e.id]?.include);
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!allRef.current) return;
    allRef.current.indeterminate = !allSelected && anySelected;
  }, [allSelected, anySelected]);

  const cad = useMemo(() => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }), []);

  const rows = employees.map((e) => {
    const st = rowsState[e.id] ?? { include: true, hours: 0, overtime: 0, includeVacation: true };
    let base = 0;

    if (e.payType === "HOURLY") {
      const rate = e.hourlyRate ?? 0;
      base = rate * (st.hours || 0) + rate * 1.5 * (st.overtime || 0);
    } else {
      const sal = e.salary ?? 0;
      base = e.payGroup === "BI_WEEKLY" ? sal / 26 : sal / 12;
    }

    const vacation = st.includeVacation ? base * (e.vacationPay / 100) : 0;
    const gross = base + vacation;

    return {
      ...e,
      state: st,
      base: st.include ? base : 0,
      vacation: st.include ? vacation : 0,
      gross: st.include ? gross : 0,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({ base: acc.base + r.base, vacation: acc.vacation + r.vacation, gross: acc.gross + r.gross }),
    { base: 0, vacation: 0, gross: 0 }
  );

  function toggleAll(checked: boolean) {
    setRowsState((prev) =>
      Object.fromEntries(employees.map((e) => [e.id, { ...prev[e.id], include: checked }]))
    );
  }

  async function saveSelectedToPayHistory() {
    try {
      setSubmitting(true);
      setMsg({});
      if (!period.start || !period.end) throw new Error("Select period start/end.");
      if (!payDate) throw new Error("Select pay date.");

      const items = rows
        .filter((r) => r.state.include)
        .map((r) => ({
          employeeId: r.id,                     // stringified → 서버에서 bigint 변환
          hoursWorked: r.payType === "HOURLY" ? r.state.hours : null,
          overtime: r.payType === "HOURLY" ? r.state.overtime : 0,
          includeVacation: r.state.includeVacation,
          // 서버가 최종 금액 계산함. 여기선 참고용
        }));

      if (!items.length) throw new Error("No rows selected.");

      const idemKey = crypto.randomUUID();
      const res = await fetch("/api/payhistory", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idemKey },
        body: JSON.stringify({
          periodStart: period.start,
          periodEnd: period.end,
          payDate,         // 이 날짜로 PayHistory.payDate 저장
          items,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");

      setMsg({ ok: `Saved ${data.count} pay history rows (status: PENDING)` });
    } catch (e: any) {
      setMsg({ err: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="border rounded overflow-auto">
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="text-lg font-medium">Payroll Run</h2>
      </div>

      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-3 text-center">
              <input
                ref={allRef}
                type="checkbox"
                checked={allSelected}
                onChange={(e) => toggleAll(e.target.checked)}
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
                    value={rowsState[r.id].hours}
                    onChange={(e) =>
                      setRowsState((prev) => ({
                        ...prev,
                        [r.id]: { ...prev[r.id], hours: Number(e.target.value) || 0 },
                      }))
                    }
                    className="border rounded p-1 w-20 text-right"
                    disabled={!r.state.include}
                  />
                ) : <span className="text-gray-400">n/a</span>}
              </td>
              <td className="p-3 text-right">
                {r.payType === "HOURLY" ? (
                  <input
                    type="number"
                    min={0}
                    step="0.25"
                    value={rowsState[r.id].overtime}
                    onChange={(e) =>
                      setRowsState((prev) => ({
                        ...prev,
                        [r.id]: { ...prev[r.id], overtime: Number(e.target.value) || 0 },
                      }))
                    }
                    className="border rounded p-1 w-20 text-right"
                    disabled={!r.state.include}
                  />
                ) : <span className="text-gray-400">n/a</span>}
              </td>
              <td className="p-3 text-right">{cad.format(r.base)}</td>
              <td className="p-3 text-right">
                {r.vacation ? cad.format(r.vacation) : "-"}
              </td>
              <td className="p-3 text-center">
                <input
                  type="checkbox"
                  checked={rowsState[r.id].includeVacation}
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

      <div className="p-4 border-t flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Period start</span>
          <input type="date" value={period.start} onChange={(e)=>setPeriod(p=>({...p,start:e.target.value}))} className="border rounded p-1"/>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Period end</span>
          <input type="date" value={period.end} onChange={(e)=>setPeriod(p=>({...p,end:e.target.value}))} className="border rounded p-1"/>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Pay date</span>
          <input type="date" value={payDate} onChange={(e)=>setPayDate(e.target.value)} className="border rounded p-1"/>
        </label>

        <button onClick={saveSelectedToPayHistory} disabled={submitting} className="border rounded px-3 py-2 hover:bg-gray-50">
          {submitting ? "Saving..." : "Save to Pay History (PENDING)"}
        </button>

        {msg.err && <span className="text-red-600 text-sm">{msg.err}</span>}
        {msg.ok && <span className="text-green-700 text-sm">{msg.ok}</span>}
      </div>
    </section>
  );
}
