import { z } from "zod";
import { instantStringSchema, utcDateOnlySchema } from "../validation/date-only.ts";

const payrollRunItemSchema = z.object({
  employeeId: z.string().regex(/^\d+$/),
  hoursWorked: z.number().nullable(),
  overtime: z.number(),
  holidayHours: z.number(),
  includeVacation: z.boolean(),
});

export const payrollRunInputSchema = z.object({
  items: z.array(payrollRunItemSchema).min(1),
  payDate: utcDateOnlySchema,
  periodStart: utcDateOnlySchema,
  periodEnd: utcDateOnlySchema,
  sendAt: instantStringSchema,
  timezone: z.string().min(1),
}).superRefine((data, ctx) => {
  if (data.periodStart > data.periodEnd) {
    ctx.addIssue({
      code: "custom",
      path: ["periodEnd"],
      message: "Period end must not be before period start",
    });
  }
  if (new Set(data.items.map((item) => item.employeeId)).size !== data.items.length) {
    ctx.addIssue({ code: "custom", path: ["items"], message: "Employee IDs must be unique" });
  }
});
