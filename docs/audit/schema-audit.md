# Schema audit

## Current model assessment

| Concern | Current condition | Required correction |
| --- | --- | --- |
| Tenant ownership | Employee/PayrollRun companyId nullable; PayHistory indirect; cross-company relations possible | Non-null companyId on every tenant record plus composite same-company constraints or controlled DB enforcement |
| Historical retention | Cascades delete payroll/T4/remittance/doc/audit history | Restrict operational deletion; archive/anonymize subject fields under policy; immutable historical snapshots |
| Payroll aggregate | PayrollRun exists but mixes calculation/payment/billing | Keep a business payroll aggregate; separate execution/payment/document/delivery |
| Employee result | PayHistory mixes line calculation, payment, PDF, email | Migrate to immutable `PayrollResult`/`PayrollLine`; separate status-bearing records |
| Snapshot completeness | Only totals and a few dates/hours | Identity, employment, rate, hours categories, TD1/YTD, formula/rule version, all earnings/deductions/contributions, rounding evidence |
| Money | `DECIMAL(65,30)` and JS numbers | Explicit decimal scale (for example 19,4 input/rates, 19,2 posted money), Decimal-only arithmetic, named rounding mode |
| Dates/time | Date-only business values stored as DateTime and parsed inconsistently | SQL date/date string semantics for periods/pay date; UTC instants for events; explicit IANA schedule zone |
| Tax version | Hard-coded source only | `TaxRuleSet`/calculation version and effective dates referenced by finalized result |
| Idempotency | No request table/key uniqueness | Tenant + operation + idempotency key unique, request hash and stored response |
| Status transitions | Enums only; unrestricted updates | Domain transition commands, optimistic version, DB constraints where practical, transition audit |
| Attempts/events | Flat attemptCount/string fields | Payment/document/delivery attempt rows and raw verified provider-event ledger |
| Audit | Sparse mutable metadata; cascades | Append-only actor/action/reason/before-after hash/correlation IDs; restricted deletion |
| Soft deletion | None | `archivedAt`/employment lifecycle; do not use soft delete as a substitute for immutable ledger |
| Indexes | Basic company/date indexes | Composite tenant/status/due/worker indexes; provider/event/idempotency uniqueness |

## Reconciled draft concepts

The complete draft is now available at `docs/proposals/payroll-schema-redesign.md`. The following conclusions were confirmed by the line-by-line reconciliation in `docs/planning/schema-reconciliation.md`; `docs/planning/final-design.md` is canonical:

- **Do not remove `PayrollRun` without a replacement payroll business aggregate.** A paystub is a document, and a transfer is money movement; neither represents employer review/approval/finalization of payroll liability across employees.
- **`PaystubRun` should be an operational generation batch only**, preferably `PayStatementGenerationRun`, with per-statement artifacts/attempts. It must not own earnings or deductions.
- **Rename `PaytransferRun` to `PaymentRun` or `PayrollPaymentRun`.** Use per-employee `PaymentInstruction` and append-only `PaymentAttempt`; a batch status cannot represent partial success.
- **Do not keep expanding `PayHistory`.** Backfill it into an immutable payroll-result model and retain legacy IDs. Payment, PDF, email, and remittance state belong elsewhere.
- **Remittance allocations must reference finalized payroll-result revisions**, not mutable operational payment status. Once reported/paid, recalculation creates adjustment versions instead of rewriting totals.
- **Billing needs a separate usage/charge ledger**, not mutable columns on payroll execution.
- **Provider events require raw-body hash, event ID, signature result, received/processed timestamps, tenant resolution, processing status, and error/replay count.**

## Referential integrity and uniqueness

Required invariants include:

- every tenant child has non-null `companyId` and relation joins include it;
- payroll line employee belongs to the same company as the run;
- T4 slip employee and summary belong to the same company;
- remittance allocation result belongs to the remittance company;
- document owner and linked record have the same company;
- unique `(companyId, idempotencyKey, operation)`;
- unique provider `(provider, providerEventId)`, `(provider, externalBatchId)`, `(provider, externalPaymentId)`;
- one active payroll result per `(runId, employeeId)` plus revision strategy for correction;
- one active artifact version per statement/type, while old versions remain;
- payment attempts unique by instruction and attempt number; billing usage unique by source event.

Prisma alone cannot express all composite tenant FKs cleanly; use compound unique keys plus explicit SQL constraints/triggers where justified and migration-tested.

## Migration risk evidence

Historical migrations already dropped detailed payroll snapshot fields, recreated status with a data-loss warning, removed provider/bank columns, and normalized invalid bank values to null. Never edit applied migrations. Before any target migration: obtain production inventory/row counts/orphans; create and restore a backup; rehearse the entire migration on a masked production clone; add new tables/columns only; backfill in resumable chunks; reconcile counts/sums/hashes per tenant; quarantine ambiguous rows; dual-write; tenant-by-tenant cutover; retain legacy tables read-only through the approved retention period.

Removing `PayrollRun` or destructive renames before dual-read reconciliation has unacceptable data-loss and rollback risk.
