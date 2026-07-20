# Integration audit

## Integration map

| Integration | Current request/persistence | Response/event/retry/reconciliation | Assessment |
| --- | --- | --- | --- |
| PostgreSQL/Prisma | Direct calls from pages/routes/services | No tenant repository; no migration rehearsal | Core but weak invariants |
| Trolley | Signed REST recipient/account/batch/payment calls | No webhook route/event store/polling; limited duplicate payment reuse | Money-moving path unsafe |
| Stripe | SDK checkout/portal/subscription/invoice items | Signature verified webhook; no event ledger/dedup; callback binding defect | Partial |
| SMTP | Nodemailer for reset/login reminder | No delivery event/attempt; no paystub email | Partial auth only |
| n8n (historical) | Removed 2026-07-17: outbound requests and global shared-secret reads/patches | External workflow definitions remain outside repository and require manual retirement | No executable application integration remains; temporary gaps and operations are inventoried in `n8n-usage-audit.md` |
| Railway PDF | POST caller HTML + API key | No service code/config/health/timeout/retry; result public blob | Critical exposure |
| Vercel Blob | `put` public payslip URL | No ownership proxy, lifecycle, version/hash | Unsafe for pay statements |
| Local Chromium/filesystem | CRA/T4 synchronous PDF and local path | No durable store; delete/recreate | Not serverless-safe |
| Vercel cron | Daily authenticated GET | No lease/claim/queue/backoff | Concurrency unsafe |
| CRA | No direct integration | Manual payment record and generated download only | Waggio does not remit or file |

## Railway PDF boundary requirements

The current endpoint must not be treated as a renderer security boundary. Target contract:

1. Next authenticates the employer, loads a finalized tenant-owned statement, and renders from server-owned structured data/template—not caller HTML.
2. Persist a generation intent with artifact ID, version, idempotency key, template/calculation version, and content hash.
3. Worker calls Railway over TLS with short-lived service authentication and an opaque request/correlation ID that does not disclose tenant identity.
4. Enforce compressed/uncompressed payload and output limits, strict content type, connect/total timeout, concurrency quota, tenant rate limit, and circuit breaker.
5. Railway uses an isolated Chromium context, fixed fonts/assets, no file access, JavaScript disabled unless essential, and deny-by-default network egress. If assets are allowed, use an internal allowlist; block loopback, link-local, RFC1918, metadata, redirects, `file:`, `data:` abuse, and DNS rebinding.
6. Sanitize templates despite server ownership; apply CSP; reject external CSS/fonts/images. Recycle browser processes and bound pages/memory/time.
7. Railway returns the bounded PDF bytes to Waggio and does not upload or retain them. Waggio stores the result in a private blob key containing tenant/artifact/version random IDs; validates PDF magic/type/size; and computes a checksum.
8. Commit artifact READY and generation attempt in a transaction; delivery is a separate job. Retries reuse intent/key and never overwrite a prior artifact.
9. Provide authenticated `/health/live` and dependency-aware `/health/ready`, structured redacted logs, metrics for latency/failure/timeouts/memory, and trace correlation.

Railway cannot access Waggio's database or object storage, retrieve employee/payroll data, know `companyId` or tenant identity, send email, call Trolley, calculate payroll/tax, or retain documents. n8n is not an intermediary.

## External action reliability contract

Every provider mutation should follow:

```text
authorized command
 -> transaction: validate immutable source + persist intent/outbox/idempotency
 -> worker claims intent with lease
 -> provider call with deterministic external ID
 -> transaction: persist response/attempt/state
 -> verified webhook persisted before processing
 -> idempotent state transition
 -> periodic reconciliation against provider
 -> manual recovery command with reason and audit
```

Provider timeouts are ambiguous outcomes, not automatic failures. A retry must first look up/reconcile the deterministic external ID. Raw provider bodies are encrypted/restricted where needed, redacted from logs, and retained according to an approved schedule.

## Deployment gaps

Only a Vercel cron file is checked in. There is no CI/CD policy, preview/prod environment contract, Railway definition, worker process, database backup/restore runbook, private blob lifecycle, secret rotation policy, health monitoring, alerting, release gate, or rollback procedure. `DIRECT_URL` is required by schema but absent in the inspected environment. These are blocking operational design tasks, not proof that deployed services are absent.
