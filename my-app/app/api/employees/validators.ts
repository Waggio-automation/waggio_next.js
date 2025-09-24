import { z } from "zod";

export const EmploymentType = z.enum(["FULL_TIME","PART_TIME","CONTRACTOR"]);
export const PayGroup = z.enum(["BI_WEEKLY","MONTHLY"]);
export const PayType = z.enum(["HOURLY","SALARY"]);
export const PaymentMethod = z.enum(["CHEQUE","DIRECT_DEPOSIT"]);

const decimalLike = z.union([z.string(), z.number()]).transform((v) => {
  if (typeof v === "number") return v;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error("Invalid number");
  return n;
});

export const employeeInputSchema = z.object({
  firstName: z.string().min(1),
  lastName : z.string().min(1),
  email    : z.string().email(),
  sin      : z.string().regex(/^\d{9}$/, "SIN must be 9 digits"),

  addrLine1: z.string().min(1),
  addrLine2: z.string().optional(),
  addrCity : z.string().min(1),
  addrProvince: z.string().default("ON"),
  addrPostal: z.string().min(1),
  addrCountry: z.string().default("CA"),

  birthDate: z.string().transform((s)=> new Date(s)),
  employmentType: EmploymentType,
  hireDate: z.string().transform((s)=> new Date(s)),
  payGroup: PayGroup.default("BI_WEEKLY"),

  payType: PayType,
  hourlyRate: decimalLike.optional(),
  salary: decimalLike.optional(),

  vacationPay: decimalLike.default(4),
  bonus: decimalLike.default(0),
  federalTD1: decimalLike.default(15492),
  provincialTD1: decimalLike.default(12298),

  paymentMethod: PaymentMethod.default("CHEQUE"),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  transitNumber: z.string().optional(),
  institutionNumber: z.string().optional(),
})
.superRefine((data, ctx) => {
  if (data.payType === "HOURLY") {
    if (data.hourlyRate == null) ctx.addIssue({ code:"custom", message:"hourlyRate required for HOURLY" });
    if (data.salary != null) ctx.addIssue({ code:"custom", message:"salary must be empty for HOURLY" });
  }
  if (data.payType === "SALARY") {
    if (data.salary == null) ctx.addIssue({ code:"custom", message:"salary required for SALARY" });
    if (data.hourlyRate != null) ctx.addIssue({ code:"custom", message:"hourlyRate must be empty for SALARY" });
  }

  if (data.paymentMethod === "DIRECT_DEPOSIT") {
    for (const k of ["bankName","bankAccount","transitNumber","institutionNumber"] as const) {
      if (!data[k]) ctx.addIssue({ code:"custom", message:`${k} required for DIRECT_DEPOSIT` });
    }
  }
});
