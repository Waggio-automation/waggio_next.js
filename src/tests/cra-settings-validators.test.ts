import assert from "node:assert/strict";
import { test } from "node:test";
import { craSettingsInputSchema } from "../app/cra/validators.ts";

const validInput = {
  legalName: "Waggio Inc.",
  businessNumber: "123456789",
  payrollProgramAccount: "123456789RP0001",
  addressLine1: "1 Main St",
  addressLine2: "",
  city: "Toronto",
  provinceCode: "ON",
  postalCode: "M5V 1A1",
  countryCode: "CAN",
  remitterType: "MONTHLY",
  contactName: "Payroll Admin",
  contactPhone: "416-555-1234",
  contactPhoneExtension: "123",
  contactEmail: "payroll@example.com",
  transmitterAccountNumber: "",
  transmitterRepId: "R123456",
  submissionLanguageCode: "E",
  preDueReminderDays: "7",
  postDueReminderFrequencyDays: "14",
};

test("craSettingsInputSchema normalizes and accepts valid CRA settings", () => {
  const parsed = craSettingsInputSchema.safeParse(validInput);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;

  assert.equal(parsed.data.payrollProgramAccount, "123456789RP0001");
  assert.equal(parsed.data.addressLine2, null);
  assert.equal(parsed.data.preDueReminderDays, 7);
});

test("craSettingsInputSchema rejects malformed account numbers", () => {
  const parsed = craSettingsInputSchema.safeParse({
    ...validInput,
    payrollProgramAccount: "123456789RT0001",
  });

  assert.equal(parsed.success, false);
});

test("craSettingsInputSchema rejects payroll accounts that do not match the business number", () => {
  const parsed = craSettingsInputSchema.safeParse({
    ...validInput,
    businessNumber: "987654321",
    payrollProgramAccount: "123456789RP0001",
  });

  assert.equal(parsed.success, false);
});

test("craSettingsInputSchema rejects invalid reminder ranges", () => {
  const parsed = craSettingsInputSchema.safeParse({
    ...validInput,
    preDueReminderDays: "0",
  });

  assert.equal(parsed.success, false);
});

test("craSettingsInputSchema rejects invalid Canadian postal codes", () => {
  const parsed = craSettingsInputSchema.safeParse({
    ...validInput,
    postalCode: "123 ABC",
  });

  assert.equal(parsed.success, false);
});
