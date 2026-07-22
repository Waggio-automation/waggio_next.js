import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  CRA_OPERATIONAL_TIME_ZONE,
  formatUtcDateOnly,
  getDateOnlyCalendarYear,
  getDateOnlyParts,
  getTodayUtcDateOnly,
  getUtcDateOnlyYearRange,
  parseUtcDateOnly,
  serializeUtcDateOnly,
} from "../lib/date-only.ts";

test("UTC date-only payroll year is invariant across process timezones", () => {
  const boundary = new Date("2026-01-01");
  assert.equal(getDateOnlyCalendarYear(boundary), 2026);
  assert.deepEqual(getDateOnlyParts(boundary), { year: 2026, monthIndex: 0, day: 1 });

  const expectedLocalYears: Record<string, number> = {
    "America/Toronto": 2025,
    "America/Vancouver": 2025,
    UTC: 2026,
    "Asia/Tokyo": 2026,
  };
  for (const [timezone, expectedLocalYear] of Object.entries(expectedLocalYears)) {
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        `import { getDateOnlyCalendarYear } from "./src/lib/date-only.ts";
         const value = new Date("2026-01-01");
         process.stdout.write(JSON.stringify({ local: value.getFullYear(), dateOnly: getDateOnlyCalendarYear(value) }));`,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, TZ: timezone },
        encoding: "utf8",
      }
    );
    assert.deepEqual(JSON.parse(output), { local: expectedLocalYear, dateOnly: 2026 }, timezone);
  }
});

test("UTC date-only tax year range has stable inclusive and exclusive boundaries", () => {
  const range = getUtcDateOnlyYearRange(2026);
  assert.equal(range.start.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(range.endExclusive.toISOString(), "2027-01-01T00:00:00.000Z");
});

test("stored date-only parsing and display are invariant across Toronto Vancouver UTC and Tokyo", () => {
  const timezones = ["America/Toronto", "America/Vancouver", "UTC", "Asia/Tokyo"];
  const calendarDates = [
    "2026-01-01",
    "2026-02-15",
    "2026-03-08",
    "2026-11-01",
  ];

  for (const timezone of timezones) {
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        `import { formatUtcDateOnly, parseUtcDateOnly, serializeUtcDateOnly } from "./src/lib/date-only.ts";
         const values = ${JSON.stringify(calendarDates)}.map((value) => {
           const parsed = parseUtcDateOnly(value);
           return { serialized: serializeUtcDateOnly(parsed), iso: parsed.toISOString(), formatted: formatUtcDateOnly(parsed) };
         });
         process.stdout.write(JSON.stringify(values));`,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, TZ: timezone },
        encoding: "utf8",
      }
    );
    const values = JSON.parse(output) as Array<{
      serialized: string;
      iso: string;
      formatted: string;
    }>;
    assert.deepEqual(
      values.map(({ serialized, iso }) => ({ serialized, iso })),
      calendarDates.map((value) => ({
        serialized: value,
        iso: `${value}T00:00:00.000Z`,
      })),
      timezone
    );
    assert.equal(values[1].formatted, "Feb 15, 2026", timezone);
  }
});

test("CRA today is explicitly Toronto calendar time and not the host timezone", () => {
  assert.equal(CRA_OPERATIONAL_TIME_ZONE, "America/Toronto");
  const beforeTorontoMidnight = new Date("2026-02-15T02:00:00.000Z");
  const afterTorontoMidnight = new Date("2026-02-15T06:00:00.000Z");
  assert.equal(serializeUtcDateOnly(getTodayUtcDateOnly(beforeTorontoMidnight)), "2026-02-14");
  assert.equal(serializeUtcDateOnly(getTodayUtcDateOnly(afterTorontoMidnight)), "2026-02-15");
  assert.equal(formatUtcDateOnly(parseUtcDateOnly("2026-02-15")), "Feb 15, 2026");
});

test("invalid or overflowing YYYY-MM-DD values are rejected", () => {
  assert.throws(() => parseUtcDateOnly("2026-02-29"));
  assert.throws(() => parseUtcDateOnly("02/15/2026"));
});
