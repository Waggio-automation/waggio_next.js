import { z } from "zod";

export const EmploymentType = z.enum(["FULL_TIME","PART_TIME","CONTRACTOR"]);
export const PayGroup = z.enum(["BI_WEEKLY","MONTHLY"]);
export const PayType = z.enum(["HOURLY","SALARY"]);
export const PaymentMethod = z.enum(["CHEQUE","DIRECT_DEPOSIT"]);
export const DentalBenefitsCoverage = z.enum([
  "NONE",
  "EMPLOYEE_ONLY",
  "EMPLOYEE_AND_SPOUSE",
  "EMPLOYEE_AND_CHILDREN",
  "EMPLOYEE_AND_FAMILY",
]);

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
  sin      : z.string()
    .regex(/^\d{9}$/, "SIN must be 9 digits")
    .refine((sin) => {
      const digits = sin.split("").map(Number);
      const sum = digits.reduce((acc, digit, i) => {
        if (i % 2 === 1) {
          const doubled = digit * 2;
          return acc + (doubled > 9 ? doubled - 9 : doubled);
        }
        return acc + digit;
      }, 0);
      return sum % 10 === 0;
    }, "SIN is invalid (fails Luhn check)"),

  employeeNumber: z.string().optional(),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  bankTransit: z.string().optional(),
  bankAccount: z.string().optional(),

  dentalBenefitsCoverage: DentalBenefitsCoverage.default("NONE"),
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
  rppDpspRegistrationNumber: z.string().optional(),
  pensionAdjustmentOverride: decimalLike.optional(),

  vacationPay: decimalLike.default(4),
  bonus: decimalLike.default(0),
  federalTD1: decimalLike.default(16452),
  provincialTD1: decimalLike.default(12989),

  paymentMethod: PaymentMethod.default("DIRECT_DEPOSIT"),
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
});
