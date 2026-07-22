import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveCompanyStatusFromConfiguration,
  deriveEmployeeStatusFromTrolleyRecipient,
  mapExternalPaymentEventToInternal,
} from "../lib/payments/status-mapping.ts";

test("deriveEmployeeStatusFromTrolleyRecipient returns ready when recipient and account exist", () => {
  const result = deriveEmployeeStatusFromTrolleyRecipient({
    recipientId: "rp_123",
    recipientAccountId: "ra_123",
  });

  assert.equal(result.payoutSetupStatus, "ready");
  assert.equal(result.payoutEnabled, true);
});

test("deriveEmployeeStatusFromTrolleyRecipient returns pending when account is missing", () => {
  const result = deriveEmployeeStatusFromTrolleyRecipient({
    recipientId: "rp_123",
  });

  assert.equal(result.payoutSetupStatus, "pending");
  assert.equal(result.payoutEnabled, false);
});

test("deriveCompanyStatusFromConfiguration returns ready when environment and defaults exist", () => {
  const result = deriveCompanyStatusFromConfiguration({
    environmentConfigured: true,
    defaultPayoutCurrency: "CAD",
    defaultPayoutCountry: "CA",
  });

  assert.equal(result.payoutSetupStatus, "ready");
  assert.equal(result.payoutEnabled, true);
});

test("mapExternalPaymentEventToInternal maps payment failures", () => {
  const mapped = mapExternalPaymentEventToInternal({
    type: "payment.failed",
    data: {
      object: {
        message: "recipient account rejected",
      },
    },
  });

  assert.equal(mapped.payrollRun?.status, "failed");
  assert.equal(mapped.payrollRun?.failureType, "employee");
  assert.equal(mapped.payrollRun?.failureReason, "recipient account rejected");
});

test("mapExternalPaymentEventToInternal maps Trolley payment processed to paid lifecycle", () => {
  const mapped = mapExternalPaymentEventToInternal({
    type: "payment.processed",
  });

  assert.equal(mapped.payrollRun?.status, "paid");
});

test("payment paid is not confused with the Trolley payment contract", () => {
  const mapped = mapExternalPaymentEventToInternal({ type: "payment.paid" });
  assert.deepEqual(mapped, {});
});

test("returned Trolley payment maps to employee payment failure", () => {
  const mapped = mapExternalPaymentEventToInternal({ type: "payment.returned" });
  assert.equal(mapped.payrollRun?.status, "failed");
  assert.equal(mapped.payrollRun?.failureType, "employee");
});
