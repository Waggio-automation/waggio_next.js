import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isCronRequestAuthorized } from "../lib/cron-auth.ts";

test("cron authorization fails closed and requires the exact bearer secret", () => {
  const previous = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal(isCronRequestAuthorized(new Request("https://example.invalid/cron")), false);

    process.env.CRON_SECRET = "integration-cron-secret";
    assert.equal(isCronRequestAuthorized(new Request("https://example.invalid/cron")), false);
    assert.equal(isCronRequestAuthorized(new Request("https://example.invalid/cron", {
      headers: { authorization: "Bearer wrong" },
    })), false);
    assert.equal(isCronRequestAuthorized(new Request("https://example.invalid/cron", {
      headers: { authorization: "Bearer integration-cron-secret" },
    })), true);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("deployment scheduler registers separate due-dispatch and historical revalidation jobs", () => {
  const manifest = JSON.parse(readFileSync(
    path.resolve(process.cwd(), "vercel.json"),
    "utf8"
  )) as { crons?: Array<{ path: string; schedule: string }> };
  assert.deepEqual(manifest.crons, [
    { path: "/api/cron/payroll-send-due", schedule: "0 13 * * *" },
    { path: "/api/cron/payroll-revalidate-paid", schedule: "0 14 * * *" },
  ]);
  assert.notEqual(manifest.crons?.[0]?.path, manifest.crons?.[1]?.path);
});

test("both cron routes fail closed and responses are count-only without sensitive provider fields", () => {
  const routePaths = [
    "src/app/api/cron/payroll-send-due/route.ts",
    "src/app/api/cron/payroll-revalidate-paid/route.ts",
  ];
  for (const routePath of routePaths) {
    const source = readFileSync(path.resolve(process.cwd(), routePath), "utf8");
    assert.match(source, /isCronRequestAuthorized\(req\)/, routePath);
    assert.match(source, /status:\s*401/, routePath);
    assert.doesNotMatch(source, /batchId|paymentId|ciphertext|processedAt|providerStatus/, routePath);
  }
});
