# Target architecture

## Recommended shape

```text
Public/Employer/Employee/Internal Next.js surfaces
  -> AuthN + authorization policy + tenant command/query boundary
  -> Domain services
       Payroll calculation/finalization
       Payment orchestration/reconciliation
       Statement/document/delivery
       Remittance/year-end
       Billing/entitlement
  -> PostgreSQL (system of record, idempotency, inbox/outbox, audit)
  -> Private object storage

Outbox/PostgreSQL jobs -> authenticated durable worker
  -> Trolley / Stripe / SMTP / Railway PDF
Verified webhooks -> ProviderEvent inbox -> idempotent processors
Scheduled reconciler -> provider APIs -> local projections/alerts
```

Next.js remains the synchronous web/API surface, but long-running/provider work moves to authenticated durable workers. Approved cron only dispatches/claims scheduled PostgreSQL jobs. n8n has no target role. Railway is a stateless authenticated HTML-to-PDF converter: it receives bounded server-rendered HTML and an opaque correlation token, returns PDF bytes, and has no database/object-store credentials or tenant identity.

## Bounded responsibilities

- UI orchestrates journeys; it never calculates authoritative money or chooses arbitrary status.
- API authenticates, authorizes, validates, and calls a command/query service.
- Payroll domain owns inputs, rule version, calculation, review, approval, immutable finalization.
- Payment domain owns batches/instructions/attempts/provider projection; it cannot mutate payroll totals.
- Statement domain owns artifact/delivery versions; it cannot define paid status.
- Compliance domain derives from finalized results and creates versioned liabilities/packages.
- Billing domain derives idempotent usage independently; billing failure must not corrupt payroll truth.
- Audit/security are append-only cross-cutting controls.

## Transaction boundaries

1. Draft mutation: tenant/permission/version validate + input revision + audit in one transaction.
2. Finalize: lock run, revalidate source/version/approval, insert immutable results/lines/totals, set FINALIZED, insert audit and outbox in one transaction.
3. External intent: create PaymentRun/instructions/attempt intent/idempotency/outbox in one transaction; no network call inside.
4. Provider result/webhook: persist unique raw event first; processor locks affected record, validates transition, updates projection and audit in one transaction.
5. Artifact: create intent/outbox; worker renders/uploads; validate/hash then mark ready and audit transactionally.
6. Remittance/T4: freeze exact source result IDs/hash and new version; never update a finalized prior version.

Railway must not access the database, retrieve employee/payroll data, know tenant identity, send email, call Trolley, calculate payroll/tax, upload/store documents, or retain input/output. Waggio owns template rendering, validation, private storage and delivery.

## Idempotency and concurrency

Use tenant + operation + client key with canonical request hash. Same key/same hash returns the original resource/response; same key/different hash is 409. Worker operations use deterministic provider external IDs, row claims (`FOR UPDATE SKIP LOCKED` or leases), attempt uniqueness, and recovery of expired leases. Optimistic versions protect human edits. Provider timeout triggers lookup/reconciliation before retry.

## Failure and recovery

Network/provider/database errors are recorded on attempts, not flattened onto source records. Partial batch success remains visible per instruction. Reconciliation periodically scans submitted/stuck/ambiguous items and compares provider truth. Manual commands are narrow (reconcile, mark reviewed, retry eligible instruction, supersede artifact), require reason/permission, and emit audit. Dead-letter items alert operations and expose a safe customer-facing reference.

## Security/data retention

Central tenant context, role policy, step-up auth, private object access, envelope encryption/tokenization, redacted structured logs, service identity per integration, webhook replay protection, and secure headers are baseline. Final retention periods require legal/privacy approval; technical design supports retention classes, legal hold, de-identification, archive, and deletion jobs with evidence. Financial/audit facts are not casually cascaded.

## Alternatives considered

- Keep all synchronous in Vercel: simpler, but unsafe for retries/timeouts/Chromium/provider ambiguity; rejected for side effects.
- Retain n8n in any capacity: rejected by approved product/architecture decision. Direct providers plus PostgreSQL jobs/inbox/outbox/idempotency/audit keep state ownership in Waggio.
- Microservices per domain: isolation but excessive operational cost now; use modular monolith + worker and explicit boundaries first.
- Event sourcing everything: strong history but high complexity; use immutable financial records, inbox/outbox, transition/audit events without full event-sourced reconstruction.
