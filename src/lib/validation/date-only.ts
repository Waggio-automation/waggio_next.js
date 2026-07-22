import { z } from "zod";
import { parseUtcDateOnly } from "../date-only.ts";

const GENERIC_DATE_MESSAGE = "Enter a valid date in YYYY-MM-DD format";

export const utcDateOnlySchema = z.string().refine((value) => {
  try {
    parseUtcDateOnly(value);
    return true;
  } catch {
    return false;
  }
}, GENERIC_DATE_MESSAGE).transform((value) => parseUtcDateOnly(value));

export const instantStringSchema = z.string().refine(
  (value) => !Number.isNaN(new Date(value).getTime()),
  "Enter a valid date and time"
).transform((value) => new Date(value));
