"use client";

import { useMemo, useState, useRef, useEffect } from "react";
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
  holidayHours: number; // 공휴일 근무 시간
};

const HOLIDAY_MULTIPLIER = 1.5; // 공휴일 시급 배수

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
  const [rowsState, setRowsState] = useState<Record<string, RowState>>(
    () =>
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

  // ✅ 선택된 기간 안의 온타리오 공휴일 계산 (컴포넌트 안!)
  const periodHolidays = useMemo(() => {
    if (!period.start || !period.end) return [];
    const start = parseYmd(period.start);
    const end = parseYmd(period.end);
    if (!start || !end) return [];
    return getOntarioHolidaysInRange(start, end);
  }, [period.start, period.end]);

  // payDate 고르면 sendOn 자동 설정
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

  const cad = useMemo(
    () => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }),
    []
  );

  const rows = employees.map((e) => {
    const st = rowsState[e.id];
    const rate = e.hourlyRate ?? 0;
    let base = 0;

    if (e.payType === "HOURLY") {
      const totalHours = st.hours || 0;                  // 사용자가 보는 "총 Hours"
    const holidayHours = st.holidayHours || 0;         // 그 중 공휴일
    const normalHours = Math.max(totalHours - holidayHours, 0);

    const regularPay = rate * normalHours;             // 공휴일이 아닌 시간
    const holidayPay = rate * HOLIDAY_MULTIPLIER * holidayHours; // 공휴일 시간
    const overtimePay = rate * 1.5 * (st.overtime || 0);

    base = regularPay + holidayPay + overtimePay;
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
    const idemKey =
      typeof window !== "undefined" && crypto?.randomUUID
        ? crypto.randomUUID()
        : "";

    try {
      setSubmitting(true);

      if (!period.start || !period.end)
        throw new Error("Select period start/end.");
      if (!payDate) throw new Error("Select pay date.");
      if (!sendOn) throw new Error("Select 'Send paystub on' date.");

      const payDateObj = parseYmd(payDate);
      const endObj = parseYmd(period.end);
      if (payDateObj && endObj && payDateObj < endObj) {
        setMsg({
          err: "Pay date cannot be before the end of the pay period.",
        });
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
          holidayHours: r.payType === "HOURLY" ? r.state.holidayHours : 0,
        }));

      if (!items.length) throw new Error("No rows selected.");

      // 🔥 여기가 핵심 변경 사항입니다! 🔥
      // 기존: /api/payhistory (단순 저장)
      // 변경: /api/payroll/update-status (n8n 연동 API)
      const res = await fetch("/api/payroll/update-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey,
        },
        body: JSON.stringify({
          // n8n 호출을 위한 스케줄 데이터 구조
          schedule: {
            employeeIds: items.map((i) => i.employeeId),
            payDate,
            periodStart: period.start,
            periodEnd: period.end,
            sendAt: sendOn, // 여기를 sendAt으로 맞춰줍니다
            timezone: "America/Toronto" 
          },
          // 백엔드에서 필요할 수 있으니 추가 정보도 같이 전송
          status: "PENDING"
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");

      // 메시지 부분은 n8n 응답 구조에 따라 조금 다를 수 있지만, 일단 성공으로 처리
      setMsg({ ok: `Successfully triggered Payroll Workflow! (n8n)` });

    } catch (e: any) {
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

      {/* Employee 테이블 */}
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
              <th className="p-3 text-right">Hours (total, excl. OT)</th>
              <th className="p-3 text-right">OT Hours</th>
              <th className="p-3 text-right">Holiday hrs (inside hours)</th>
              <th className="p-3 text-right">Base</th>
              <th className="p-3 text-right">Vacation</th>
              <th className="p-3 text-center">Incl. Vac</th>
              <th className="p-3 text-right">Gross</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={`border-t ${!r.state.include ? "opacity-50" : ""}`}
              >
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
                <td className="p-3">
                  {r.firstName} {r.lastName}
                </td>
                <td className="p-3">{r.payType}</td>
                <td className="p-3 text-right">
                  {r.payType === "HOURLY"
                    ? r.hourlyRate != null
                      ? cad.format(r.hourlyRate) + "/hr"
                      : "-"
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
                          [r.id]: {
                            ...prev[r.id],
                            hours: Number(e.target.value) || 0,
                          },
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
                          [r.id]: {
                            ...prev[r.id],
                            overtime: Number(e.target.value) || 0,
                          },
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
                      className="w-20 rounded border p-1 text-right"
                      disabled={!r.state.include}
                    />
                  ) : (
                    <span className="text-gray-400">n/a</span>
                  )}
                </td>
                <td className="p-3 text-right">{cad.format(r.base)}</td>
                <td className="p-3 text-right">
                  {r.vacation ? cad.format(r.vacation) : "-"}
                </td>
                <td className="p-3 text-center">
                  <input
                    type="checkbox"
                    checked={r.state.includeVacation}
                    onChange={(e) =>
                      setRowsState((prev) => ({
                        ...prev,
                        [r.id]: {
                          ...prev[r.id],
                          includeVacation: e.target.checked,
                        },
                      }))
                    }
                    disabled={!r.state.include}
                  />
                </td>
                <td className="p-3 text-right font-medium">
                  {cad.format(r.gross)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr className="font-semibold border-t">
              <td className="p-3" colSpan={7}>
                Totals (selected)
              </td>
              <td className="p-3 text-right">{cad.format(totals.base)}</td>
              <td className="p-3 text-right">{cad.format(totals.vacation)}</td>
              <td />
              <td className="p-3 text-right">{cad.format(totals.gross)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Schedule */}
      <div className="border-t bg-gray-50/60">
        <div className="flex flex-col gap-4 p-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Schedule</h3>
            <p className="mt-1 text-xs text-gray-500">
              Pay period과 실제 지급일, 그리고 paystub 발송 날짜를 지정하세요.
            </p>
          </div>

          {/* ✅ 이 기간에 포함된 공휴일 안내 */}
          {periodHolidays.length > 0 && (
            <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <p className="font-medium">
                This period includes Ontario public holidays:
              </p>
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
                hint="한 번에 시작/종료 범위를 선택하세요"
              />
            </div>
            <DateField
              label="Pay date"
              value={payDate}
              onChange={setPayDate}
              hint="실제 지급일"
            />
            <DateField
              label="Send paystub on"
              value={sendOn}
              onChange={setSendOn}
              hint="직원에게 paystub을 보낼 날짜"
            />
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
              {submitting ? "Saving..." : "Create Paystub & Save"} {/*Save to Pay History (PENDING)*/}
            </button>
          </div>

          {msg.err && <span className="text-sm text-red-600">{msg.err}</span>}
          {msg.ok && <span className="text-sm text-green-700">{msg.ok}</span>}
        </div>
      </div>
    </section>
  );
}