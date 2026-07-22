/**
 * Payroll payDate values are persisted from YYYY-MM-DD input as UTC midnight.
 * Treat them as calendar-only values; never derive their year/month/day through
 * the server's local timezone.
 */
export function getDateOnlyParts(value: Date) {
  return {
    year: value.getUTCFullYear(),
    monthIndex: value.getUTCMonth(),
    day: value.getUTCDate(),
  };
}

export const CRA_OPERATIONAL_TIME_ZONE = "America/Toronto";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseUtcDateOnly(value: string) {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error("Date-only value must use YYYY-MM-DD format");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = createUtcDateOnly(year, monthIndex, day);
  const parts = getDateOnlyParts(parsed);
  if (parts.year !== year || parts.monthIndex !== monthIndex || parts.day !== day) {
    throw new Error("Date-only value is not a valid calendar date");
  }
  return parsed;
}

export function normalizeUtcDateOnly(value: Date | string) {
  if (typeof value === "string") return parseUtcDateOnly(value);
  const { year, monthIndex, day } = getDateOnlyParts(value);
  return createUtcDateOnly(year, monthIndex, day);
}

export function compareUtcDateOnly(left: Date, right: Date) {
  return normalizeUtcDateOnly(left).getTime() - normalizeUtcDateOnly(right).getTime();
}

export function formatUtcDateOnly(
  value: Date,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
  locale = "en-CA"
) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
    normalizeUtcDateOnly(value)
  );
}

export function serializeUtcDateOnly(value: Date) {
  const { year, monthIndex, day } = getDateOnlyParts(value);
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getTodayUtcDateOnly(
  now = new Date(),
  timeZone = CRA_OPERATIONAL_TIME_ZONE
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return createUtcDateOnly(Number(part("year")), Number(part("month")) - 1, Number(part("day")));
}

export function getDateOnlyCalendarYear(value: Date) {
  return getDateOnlyParts(value).year;
}

export function createUtcDateOnly(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

export function addUtcDateOnlyDays(value: Date, days: number) {
  const { year, monthIndex, day } = getDateOnlyParts(value);
  return createUtcDateOnly(year, monthIndex, day + days);
}

export function getUtcDateOnlyYearRange(year: number) {
  return {
    start: createUtcDateOnly(year, 0, 1),
    endExclusive: createUtcDateOnly(year + 1, 0, 1),
  };
}

export function getUtcDateOnlyMonthRange(value: Date) {
  const { year, monthIndex } = getDateOnlyParts(value);
  return {
    start: createUtcDateOnly(year, monthIndex, 1),
    endExclusive: createUtcDateOnly(year, monthIndex + 1, 1),
  };
}
