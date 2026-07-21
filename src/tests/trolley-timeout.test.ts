import test from "node:test";
import assert from "node:assert/strict";
import {
  TrolleyApiError,
  TrolleyClient,
  TrolleyRequestTimeoutError,
} from "../lib/trolley.ts";

test("Trolley request timeout aborts the underlying fetch and exposes only a sanitized reason", async () => {
  let capturedSignal: AbortSignal | null = null;
  let abortObserved = false;
  const providerBodySentinel = "provider-body-must-not-escape";
  const hangingFetch: typeof fetch = async (_input, init) => {
    capturedSignal = init?.signal ?? null;
    return new Promise<Response>((_resolve, reject) => {
      capturedSignal?.addEventListener("abort", () => {
        abortObserved = true;
        reject(new DOMException(providerBodySentinel, "AbortError"));
      }, { once: true });
    });
  };
  const client = new TrolleyClient({
    accessKey: "test-access-key",
    secretKey: "test-secret-key",
    baseUrl: "https://provider.invalid",
    fetchImpl: hangingFetch,
    requestTimeoutMs: 20,
  });

  const startedAt = Date.now();
  await assert.rejects(
    client.listBatchPayments("batch-sensitive-id", { timeoutMs: 20 }),
    (error) => {
      assert.equal(error instanceof TrolleyRequestTimeoutError, true);
      const timeoutError = error as TrolleyRequestTimeoutError;
      assert.equal(timeoutError.code, "TROLLEY_PROVIDER_REQUEST_TIMEOUT");
      assert.equal(timeoutError.message, "Trolley provider request timed out.");
      assert.equal(JSON.stringify(timeoutError).includes(providerBodySentinel), false);
      assert.equal(JSON.stringify(timeoutError).includes("batch-sensitive-id"), false);
      return true;
    }
  );

  assert.equal(abortObserved, true);
  assert.notEqual(capturedSignal, null);
  assert.equal((capturedSignal as unknown as AbortSignal).aborted, true);
  assert.equal(Date.now() - startedAt < 500, true);
});

test("Trolley 429 exposes bounded Retry-After metadata without logging provider payload or IDs", async () => {
  const providerBodySentinel = "provider-body-must-not-be-logged";
  const batchIdSentinel = "batch-sensitive-id";
  const paymentIdSentinel = "payment-sensitive-id";
  const logs: unknown[][] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args);
  try {
    const client = new TrolleyClient({
      accessKey: "test-access-key",
      secretKey: "test-secret-key",
      baseUrl: "https://provider.invalid",
      fetchImpl: async () => new Response(JSON.stringify({
        message: providerBodySentinel,
        payment: { id: paymentIdSentinel },
      }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "0.25",
        },
      }),
    });
    await assert.rejects(
      client.listBatchPayments(batchIdSentinel),
      (error) => {
        assert.equal(error instanceof TrolleyApiError, true);
        assert.equal((error as TrolleyApiError).retryAfterMs, 250);
        return true;
      }
    );
  } finally {
    console.log = originalLog;
  }
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes(providerBodySentinel), false);
  assert.equal(serializedLogs.includes(batchIdSentinel), false);
  assert.equal(serializedLogs.includes(paymentIdSentinel), false);
});
