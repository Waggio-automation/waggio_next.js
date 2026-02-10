import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveEmployeeStatusFromAccount,
  mapExternalPaymentEventToInternal,
} from "../lib/payments/status-mapping.ts";

test("deriveEmployeeStatusFromAccount returns ready when account is fully enabled", () => {
  const result = deriveEmployeeStatusFromAccount({
    charges_enabled: true,
    payouts_enabled: true,
    requirements: { currently_due: [] },
  });

  assert.equal(result.payoutSetupStatus, "ready");
  assert.equal(result.payoutEnabled, true);
});

test("deriveEmployeeStatusFromAccount returns issue when requirements are due", () => {
  const result = deriveEmployeeStatusFromAccount({
    charges_enabled: false,
    payouts_enabled: false,
    requirements: { currently_due: ["external_account"] },
  });

  assert.equal(result.payoutSetupStatus, "issue");
  assert.equal(result.payoutEnabled, false);
});

test("mapExternalPaymentEventToInternal maps funding failures", () => {
  const mapped = mapExternalPaymentEventToInternal({
    type: "payment_intent.payment_failed",
    data: {
      object: {
        failure_message: "insufficient_funds",
      },
    },
  });

  assert.equal(mapped.payrollRun?.status, "failed");
  assert.equal(mapped.payrollRun?.failureType, "funding");
  assert.equal(mapped.payrollRun?.failureReason, "insufficient_funds");
});

test("mapExternalPaymentEventToInternal maps payout paid to paid status", () => {
  const mapped = mapExternalPaymentEventToInternal({
    type: "payout.paid",
  });

  assert.equal(mapped.payrollRun?.status, "paid");
});
