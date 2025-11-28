"use client";

import { useState, useRef, useEffect } from "react"; // 1. useRef, useEffect 추가
import { DayPicker, DateRange } from "react-day-picker";
import "react-day-picker/dist/style.css";

function fmtDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function parseYmd(s: string | undefined) {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export default function PeriodRangePicker({
  label = "Payroll Period",
  value,
  onChange,
  hint,
}: {
  label?: string;
  value: { start: string; end: string };
  onChange: (v: { start: string; end: string }) => void;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  
  // 2. 팝업 영역을 감지할 Ref 생성
  const popupRef = useRef<HTMLDivElement>(null);

  const selected: DateRange | undefined = {
    from: parseYmd(value.start),
    to: parseYmd(value.end),
  };

  // 3. 화면 바깥 클릭 감지 로직
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      // 팝업이 열려있고, 클릭한 곳이 팝업 내부(popupRef)가 아니라면 닫기
      if (open && popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const handleSelect = (range: DateRange | undefined) => {
    if (!range || !range.from) {
      onChange({ start: "", end: "" });
      return;
    }
    if (range.from && range.to) {
      onChange({ start: fmtDate(range.from), end: fmtDate(range.to) });
    } else {
      onChange({ start: fmtDate(range.from), end: "" });
    }
  };

  return (
    <div className="relative">
      <label className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-left outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
        >
          {value.start && value.end
            ? `${value.start} ~ ${value.end}`
            : "Select payroll period"}
        </button>
        {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
      </label>

      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          {/* 4. 흰색 달력 박스에 ref={popupRef} 연결 */}
          <div 
            ref={popupRef} 
            className="rounded-xl border bg-white p-4 shadow-2xl"
          >
            <h4 className="mb-2 text-sm font-semibold text-gray-700">{label}</h4>
            <DayPicker
              mode="range"
              selected={selected}
              onSelect={handleSelect}
              numberOfMonths={2}
              showOutsideDays
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="rounded-md border px-3 py-1 text-xs"
                onClick={() => onChange({ start: "", end: "" })}
              >
                Clear
              </button>
              <button
                className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}