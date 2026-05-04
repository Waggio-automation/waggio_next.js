import { RemitterType } from "@prisma/client";
import { z } from "zod";

const remitterTypeValues = Object.values(RemitterType) as [RemitterType, ...RemitterType[]];
const provinceCodes = new Set([
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
]);

const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => value || null);

const optionalUpperText = (maxLength: number) =>
  optionalText(maxLength).transform((value) => value?.toUpperCase() ?? null);

const requiredText = (maxLength: number, message: string) =>
  z.string().trim().min(1, message).max(maxLength);

const requiredUpperText = (maxLength: number, message: string) =>
  requiredText(maxLength, message).transform((value) => value.toUpperCase());

const reminderDays = z.coerce
  .number()
  .int()
  .min(1, "Reminder days must be at least 1")
  .max(365, "Reminder days cannot be more than 365");

export const craSettingsInputSchema = z
  .object({
    legalName: requiredText(120, "Legal business name is required"),
    businessNumber: optionalUpperText(9).refine(
      (value) => !value || /^\d{9}$/.test(value),
      "Business number must be 9 digits"
    ),
    payrollProgramAccount: requiredUpperText(15, "CRA payroll account number is required").refine(
      (value) => /^\d{9}RP\d{4}$/.test(value),
      "Payroll account number must look like 123456789RP0001"
    ),
    addressLine1: requiredText(60, "Employer address line 1 is required"),
    addressLine2: optionalText(60),
    city: requiredText(40, "City is required"),
    provinceCode: requiredUpperText(2, "Province code is required"),
    postalCode: requiredUpperText(10, "Postal code is required"),
    countryCode: requiredUpperText(3, "Country code is required"),
    remitterType: z.enum(remitterTypeValues),
    contactName: requiredText(60, "CRA contact name is required"),
    contactPhone: requiredText(30, "CRA contact phone is required").refine((value) => {
      const digits = value.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 15;
    }, "Contact phone must include 10 to 15 digits"),
    contactPhoneExtension: optionalText(10).refine(
      (value) => !value || /^\d{1,10}$/.test(value),
      "Phone extension must contain digits only"
    ),
    contactEmail: z.string().trim().min(1, "Reminder email is required").max(254).email(),
    transmitterAccountNumber: optionalUpperText(15).refine(
      (value) => !value || /^\d{9}RP\d{4}$/.test(value),
      "Transmitter account number must look like 123456789RP0001"
    ),
    transmitterRepId: optionalUpperText(15).refine(
      (value) => !value || /^[A-Z0-9-]{4,15}$/.test(value),
      "Transmitter RepID can contain letters, numbers, and hyphens"
    ),
    submissionLanguageCode: z.enum(["E", "F"]),
    preDueReminderDays: reminderDays,
    postDueReminderFrequencyDays: reminderDays,
  })
  .superRefine((data, ctx) => {
    if (data.businessNumber && data.payrollProgramAccount.slice(0, 9) !== data.businessNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["payrollProgramAccount"],
        message: "CRA payroll account number must start with the business number",
      });
    }

    if (!data.transmitterAccountNumber && !data.transmitterRepId) {
      ctx.addIssue({
        code: "custom",
        path: ["transmitterAccountNumber"],
        message: "Enter either a transmitter account number or a Transmitter RepID",
      });
    }

    if (data.countryCode === "CAN") {
      if (!provinceCodes.has(data.provinceCode)) {
        ctx.addIssue({
          code: "custom",
          path: ["provinceCode"],
          message: "Province code must be a valid Canadian province or territory",
        });
      }
      if (!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(data.postalCode.replace(/\s+/g, ""))) {
        ctx.addIssue({
          code: "custom",
          path: ["postalCode"],
          message: "Postal code must be a valid Canadian postal code",
        });
      }
    }
  });
