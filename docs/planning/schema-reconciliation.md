# Payroll schema reconciliation decision

Decision date: 2026-07-16. Input draft: `docs/proposals/payroll-schema-redesign.md`. This is a design decision record, not authorization to edit Prisma or migrate data. `final-design.md` is the canonical target; the original proposal remains a review artifact.

## Decision summary

The draft correctly identifies status coupling, missing effective dating, unsafe PDF ownership, and the need to separate statement generation from payment execution. It is not safe as proposed because it removes the only plausible payroll business aggregate, places too many lifecycle/status/provider concerns on `PayHistory`, omits direct tenant ownership there, and retains raw bank details as history.

### Accepted

| Proposal idea | Accepted interpretation |
| --- | --- |
| Split stable employee identity from changing configuration | Use effective-dated employment/compensation, tax, and benefits/profile versions. |
| Separate paystub processing from money movement | Keep payroll, payment, statement generation, and delivery as independent bounded lifecycles. |
| Distinguish payment `FAILED` and `RETURNED` | `FAILED` is pre-settlement/provider execution failure; `RETURNED` is a provider-confirmed post-acceptance/post-payment return. |
| Railway for PDF conversion | Accept only as the stateless authenticated converter constrained in `final-design.md`; Waggio owns data/template/storage. |
| Trolley event history | Replace JSON arrays with unique immutable `ProviderEvent` inbox rows and processing metadata. |
| Effective dates on changing employee settings | Preserve exact effective intervals and selected version IDs in payroll snapshots. |
| Replace overloaded generic status | Use independent named state machines with command-validated transitions. |

### Modified

| Proposal idea | Final decision |
| --- | --- |
| `PaystubRun` | An optional `PayStatementGenerationRun` may group operational work. Per-employee `PayStatement`, `GenerationAttempt`, artifact, delivery, and delivery attempt own the truth. It never stores payroll totals or approval. |
| `PaytransferRun` | Name it `PaymentRun`; add one immutable `PaymentInstruction` per employee/result and append-only `PaymentAttempt` rows. |
| `PayHistory` | Replace prospectively with immutable `PayrollResult` plus typed earning/deduction/employer-contribution lines. Legacy rows retain source/completeness/mapping evidence during backfill. Payment/statement statuses are not columns on it. |
| Employee pay/tax/benefits split | Keep separate effective-dated versions where rules/access differ; do not force a one-to-one current config or silently overlap effective periods. |
| Employee payout configuration | Keep provider-tokenized `PayoutMethod` history with masked descriptors. Snapshot the selected provider token reference/mask on instructions, not raw bank coordinates. |
| Company administration | Use global `User` plus tenant `CompanyMembership`; initial signup can create OWNER, but role checks, invitation lifecycle, and owner-transfer rules are foundational, not deferred indefinitely. |
| Parallel downstream processing | Finalization emits independent durable jobs. Payment and statements may run concurrently only after immutable finalization and their prerequisites; failure in one never rewrites another domain. |
| Scheduled `sendAt` | Store business date/timezone intent and UTC `scheduledAt`; approved cron wakes workers that atomically claim due jobs. Cron never performs provider work itself. |

### Rejected

| Proposal idea | Reason |
| --- | --- |
| Delete `PayrollRun` | A run is the business aggregate for period identity, preparation, review, approval, finalization, totals, rule source, and adjustment lineage. Neither a document batch nor payment batch can own that responsibility. |
| Put calculation, PDF, email, payment, provider events, attempts, and failure fields on `PayHistory` | This recreates the coupling the redesign is meant to remove and permits contradictory employee states. |
| Store `trolleyEvents` as mutable JSON | It has no event uniqueness, signature/replay/processing state, independent retention, or efficient reconciliation. |
| Store raw bank coordinates in an effective-dated `EmployeeBankAccount` history | This expands breach and support scope. Provider token/reference plus mask is the default; any exceptional raw retention needs separate legal/security approval. |
| Omit `companyId` from employee payroll results because ownership is reachable by joins | Tenant authorization and backfill safety require explicit non-null ownership and same-tenant constraints. |
| Treat EHT/WSIB as employee deductions | They are modeled as employer contribution/liability components pending authoritative applicability/rate approval and never reduce employee net pay. |
| Use statement/payment status to determine remittance or T4 inclusion | Compliance derives from finalized, non-voided payroll result revisions and linked adjustments, independent of delivery or transfer outcome. |
| Ambiguous run states such as `TRANSFER_SENT` or a single run-level `FAILED` | Run state is derived from instructions; ambiguous provider outcomes require reconciliation rather than a retryable failure label. |

## Current-schema and migration reconciliation

| Current assumption | Final treatment |
| --- | --- |
| `PayrollRun` exists and `PayHistory.runId` is optional | Preserve every record and mapping. Do not infer a missing run, approval, or finalization. Orphan/standalone rows are quarantined as legacy incomplete. |
| `PayHistory` combines amounts and multiple operational statuses | Dual-write/shadow into `PayrollResult` and independent statement/payment models. Retain legacy raw values and status provenance until reconciliation and retention approval. |
| Company/employee deletion cascades history | Additive restrict/archive design must be in place before enabling lifecycle deletion. Never edit applied migration SQL. |
| Tenant IDs are nullable/indirect | Backfill explicit tenant ownership by verified joins; quarantine null, orphan, or cross-tenant rows. Add constraints only after reconciliation. |
| Provider references and flat statuses may describe real transfers | Reconcile against Trolley before mapping a terminal state. A string/status alone is insufficient evidence for PAID, FAILED, or RETURNED. |
| `pdfUrl` may point to public legacy blobs | Map as a legacy external pointer, inventory ownership/reachability, copy privately with checksum where permitted, and revoke public access without deleting evidence. |
| Amounts use broad Decimal columns and calculation used JS numbers | Preserve exact legacy values; target uses declared money/rate scale and Decimal-only calculation. Never recompute history and overwrite it. |
| T4/remittance rows were generated from all `PayHistory` | Mark imported artifacts/liabilities `LEGACY_UNVERIFIED`; retain them, but do not use them as proof of correct finalized source inclusion. |

## Domain conclusions

- `PayrollRun` remains the authoritative run-level aggregate. `PayrollResult` has no mutable workflow status; its revision/source/void-adjustment relationships determine eligibility.
- Calculation can repeat while a run is draft/reviewable. Finalization atomically freezes selected inputs, results, lines, totals, rule set, approval, audit, and downstream outbox records.
- Payment run status summarizes but never overwrites employee instruction state. Attempts are append-only. `FAILED` never means “may have succeeded”; ambiguous outcomes are `RECONCILIATION_REQUIRED`.
- Net pay equals gross earnings minus employee deductions only. Employer cost equals gross earnings plus employer contributions/taxes/benefits defined by the approved rule set; it is distinct from cash funding and remittance due.
- Remittance allocations name exact finalized result revisions and component lines. T4/year-end packages freeze exact source IDs/hash and rule/spec version, including adjustment chains and excluding voided/superseded facts as defined by approved rules.
- No current historical row is automatically upgraded to approved/finalized/paid truth. Completeness flags, source mapping, provider reconciliation, and reviewer decisions are mandatory.
