// lib/ontarioHolidays.ts
export type OntarioHolidayId =
  | "new_year"
  | "family_day"
  | "good_friday"
  | "victoria_day"
  | "canada_day"
  | "labour_day"
  | "thanksgiving"
  | "christmas"
  | "boxing_day";

export type OntarioHoliday = {
  id: OntarioHolidayId;
  name: string;
  date: Date;
};

// 부활절 계산 (Good Friday용)
function calcEasterSunday(year: number): Date {
  // Anonymous Gregorian algorithm
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// 특정 월의 n번째 요일 (예: 9월 첫 번째 월요일 = Labour Day)
function nthWeekdayOfMonth(
  year: number,
  month: number, // 0-based (0=Jan)
  weekday: number, // 0=Sun ... 6=Sat
  nth: number
): Date {
  const first = new Date(year, month, 1);
  const firstDay = first.getDay();
  const offset = (7 + weekday - firstDay) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return new Date(year, month, day);
}

// Victoria Day: May 25 이전의 월요일
function victoriaDay(year: number): Date {
  const d = new Date(year, 4, 25); // May 25
  const day = d.getDay();
  const offset = (7 + day - 1) % 7; // 1=Mon
  d.setDate(d.getDate() - offset - 1);
  return d;
}

export function getOntarioHolidays(year: number): OntarioHoliday[] {
  const easterSunday = calcEasterSunday(year);
  const goodFriday = new Date(easterSunday);
  goodFriday.setDate(goodFriday.getDate() - 2);

  return [
    { id: "new_year", name: "New Year's Day", date: new Date(year, 0, 1) },
    { id: "family_day", name: "Family Day", date: nthWeekdayOfMonth(year, 1, 1, 3) }, // Feb 3rd Mon
    { id: "good_friday", name: "Good Friday", date: goodFriday },
    { id: "victoria_day", name: "Victoria Day", date: victoriaDay(year) },
    { id: "canada_day", name: "Canada Day", date: new Date(year, 6, 1) }, // 간단 버전 (July 1)
    { id: "labour_day", name: "Labour Day", date: nthWeekdayOfMonth(year, 8, 1, 1) }, // Sep 1st Mon
    { id: "thanksgiving", name: "Thanksgiving", date: nthWeekdayOfMonth(year, 9, 1, 2) }, // Oct 2nd Mon
    { id: "christmas", name: "Christmas Day", date: new Date(year, 11, 25) },
    { id: "boxing_day", name: "Boxing Day", date: new Date(year, 11, 26) },
  ];
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function getOntarioHolidaysInRange(
  start: Date,
  end: Date
): OntarioHoliday[] {
  const sYear = start.getFullYear();
  const eYear = end.getFullYear();
  const result: OntarioHoliday[] = [];

  for (let y = sYear; y <= eYear; y++) {
    for (const h of getOntarioHolidays(y)) {
      if (h.date >= start && h.date <= end) {
        result.push(h);
      }
    }
  }
  return result;
}

// "YYYY-MM-DD" → 이 날이 공휴일인지
export function getOntarioHolidayForYmd(
  s: string
): OntarioHoliday | null {
  const d = parseYmd(s);
  if (!d) return null;
  const holidays = getOntarioHolidays(d.getFullYear());
  const target = ymd(d);
  return holidays.find((h) => ymd(h.date) === target) ?? null;
}

function parseYmd(s: string | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
