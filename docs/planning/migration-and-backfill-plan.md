# Migration and backfill plan

No migration is authorized by this document. The draft proposal has been reviewed, but production data shape, backups, legal retention and authoritative payroll/provider evidence must be approved before DDL or backfill. `final-design.md` defines the target; applied migration SQL is immutable history.

## Non-negotiable safeguards

1. Freeze approved logical names/invariants before DDL. Never edit an applied migration or begin with a drop/rename.
2. Inventory every environment: Prisma migration state; row counts; null/orphan/cross-tenant relations; enum/status distributions; duplicate periods; provider refs/events; artifact reachability; SIN formats; money/component totals; dates/timezones; n8n callers/workflows.
3. Take encrypted database/object backups and restore into an isolated masked rehearsal. Record restore checksum, time, RPO/RTO and responsible approvers.
4. Add new tables, nullable ownership/mapping columns and indexes first. Use measured low-lock/concurrent PostgreSQL techniques; validate constraints after cleanup.
5. Backfill by tenant and stable primary-key ranges with deterministic IDs and resumable checkpoints. Quarantine ambiguity; never guess tenant, approval, paid/final status, SIN format or provider outcome.
6. Reconcile per-tenant counts, sums by run/year/component, source-to-target mappings, row/source hashes, artifacts and provider IDs. Require two-person sign-off for financial/statutory mappings.
7. Dual-write only through one domain service. Shadow-read and compare without changing user-visible truth or duplicating provider/email side effects.
8. Canary explicitly approved tenants behind reversible routing flags. Rollback routes reads/writes to the prior implementation; it never drops new evidence or reverses a provider payment in the database.
9. Freeze legacy writes only after every UI/API/job/external caller is migrated and zero-use telemetry passes. Retain legacy data read-only for the approved rollback/retention period.

## Source-to-target backfill

| Legacy source | Target | Required rule / ambiguity handling |
| --- | --- | --- |
| `CompanyUser` | `User`, `CompanyMembership`, `AuthSession` migration | Normalize/verify email; preserve role/status; quarantine identity conflicts; do not broaden authority. |
| `Company`, settings | `Company`, `CompanyPayrollProfileVersion` | Preserve tenant ID and exact values/effective assumptions; mark missing provenance/completeness. |
| `Employee` | `Employee`, `EmploymentVersion`, tax/benefits versions, `SensitiveIdentifier`, `PayoutMethod` | Null tenant is quarantined. Detect SIN format with explicit validator/key evidence. Never copy raw bank history into target; reconcile provider token and retain mask only by default. |
| `PayrollRun` | `PayrollRun` legacy mapping and possibly `PaymentRun`/billing mapping | Preserve ID/status/meta/raw values. Never infer preparation, approval, finalization, funding, paid, or return state. |
| `PayHistory` | `PayrollResult` legacy revision plus typed lines only where exact | Add explicit company ownership and source ID. Preserve every amount/status/ref. Record snapshot completeness and eligibility; do not fabricate rates, TD1, input lines, formula version or employer classification. |
| `pdfUrl` | `PayStatement`, `DocumentArtifact` legacy pointer | Inventory tenant ownership/reachability privately, copy where permitted, hash bytes, mark source/public-remediation state; never log URLs containing PII. |
| Trolley flat refs/statuses | `PaymentRun`, instruction/attempt/provider/reconciliation records | Provider reconciliation is required before terminal mapping. Ambiguous/unknown becomes `RECONCILIATION_REQUIRED`, never guessed `FAILED`/`PAID`/`RETURNED`. |
| Remittance/allocation/payment | Versioned liability/allocation/payment ledger | Preserve external payment evidence and exact allocation mapping. Current totals are `LEGACY_UNVERIFIED` until finalized-source/rule review. |
| T4 slip/summary/document | Tax package/document/artifact | Preserve generated/finalized labels as legacy claims, source IDs and artifact hash. Do not overwrite; qualified review decides eligibility. |
| `AuditLog` | `AuditEvent` | Preserve raw actor/action/time and label missing actor/company/correlation evidence. |
| Stripe/company/run billing fields | Subscription projection, `BillingUsageEvent`, `BillingChargeAttempt` | Reconcile provider customer/metadata/event before active/billed projection; unique source usage prevents double charge. |

## Dependency-ordered migration stages

### Stage 0 — Critical containment and evidence

Contain admin-link, arbitrary/public PDF, global shared-secret reads/writes, unsafe SIN writes, destructive lifecycle actions and blind Trolley retry. Rotate exposed credentials as required. Add redacted caller/correlation evidence only through separately approved containment changes. Prove backup/restore. No schema redesign.

### Stage 1 — n8n replacement and safe retirement

Implement the direct command/job/worker/provider replacements in `../audit/n8n-usage-audit.md`. Shadow outcomes without duplicate side effects, stop outbound workflows one at a time, prove zero legacy calls/executions, revoke credentials, disable hosted workflows, then separately remove code/config. Do not wait for the full schema redesign where a minimal durable compatibility foundation safely unblocks retirement; any temporary table is additive and aligned to final job/outbox/idempotency/audit semantics.

### Stage 2 — Identity, tenant, retention and PII foundation

Add user/membership/session, explicit tenant ownership, audit/idempotency/outbox/job/inbox, legal-hold/retention, sensitive identifier and tokenized payout foundations. Backfill verified company keys and report all exceptions. Add delete restrictions before enabling company/employee lifecycle actions.

### Stage 3 — Additive target schema and legacy backfill

Create target payroll, payment, statement/artifact/delivery, compliance/year-end and billing models/indexes. Backfill deterministic mappings/completeness flags. No legacy source is automatically declared approved or correct. Shadow totals and relational invariants.

### Stage 4 — Domain-by-domain dual write and cutover

Cut over in roadmap order: payroll finalization; payment/reconciliation; statements/delivery; history/adjustments; remittance; year-end; billing/ops. Each domain needs two-tenant tests, source/target reconciliation, canary acceptance, observability and read fallback. External effects run once from the designated authority only.

### Stage 5 — Archive and later destructive retirement

Legacy tables/fields/objects become read-only. A later separately authorized destructive migration requires zero callers, expired rollback window, verified backup/restore, final count/sum/hash/provider/artifact reconciliation, and legal/privacy/data-owner sign-off. Public legacy artifacts are privately replaced/revoked according to provider capability and policy; evidence is retained.

## Data quality and uniqueness gates

- No target domain row lacks a verified company; same-company parent/child constraints validate with zero violations.
- Every source row has exactly one deterministic mapping or a documented quarantine reason.
- Per company/run/year, gross, employee deductions, net, employer contributions and relevant compliance components reconcile exactly to preserved legacy decimals; differences are explained, never normalized silently.
- Idempotency, result revision, provider event/external ID, instruction attempt, statement/artifact version, remittance allocation, tax source hash and billing usage uniqueness constraints pass duplicate reports before enforcement.
- Historical calculation errors remain historically evidenced. Corrections are linked adjustments, not retroactive mutation.

## Rollback

Stop new job claims/dispatch, continue verified event ingestion and reconciliation, and route reads/writes to the last approved path. Expired leases are reclaimed only when the operation is safe; ambiguous provider calls reconcile before retry. Failed backfills resume from deterministic checkpoints after correction. Database rollback never pretends to reverse Trolley, email, Stripe, CRA, or document-delivery side effects.
