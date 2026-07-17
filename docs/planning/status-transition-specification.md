# Status transition specification

Statuses are changed only by named domain commands in a transaction with optimistic version checks and an audit/outbox event. APIs never accept an arbitrary target enum.

## Payroll run (business truth)

| State | Owner | Allowed next state / command |
| --- | --- | --- |
| DRAFT | Preparer/app | CALCULATING (`calculate`), VOIDED (`discard`) |
| CALCULATING | Calculation worker | REVIEW_REQUIRED (`calculated`), CALCULATION_FAILED (`failed`) |
| CALCULATION_FAILED | System/preparer | DRAFT (`edit/retry`), VOIDED |
| REVIEW_REQUIRED | Preparer/approver | DRAFT (`edit` creates revision), APPROVED (`approve`), VOIDED |
| APPROVED | Authorized approver | FINALIZING (`finalize`), REVIEW_REQUIRED (`withdraw before finalize`) |
| FINALIZING | App transaction | FINALIZED (`commit results/outbox`), APPROVED (`transaction failed with no side effect`) |
| FINALIZED | System fact | Terminal for this run; a correction/reversal is a new linked run and never edits this run |
| VOIDED | Authorized actor | Terminal; finalized payroll is corrected, not voided in place |

`ADJUSTED` is a derived relationship, not a `PayrollRunStatus`. This preserves the original `FINALIZED` fact while any number of linked adjustment runs are added.

## Payment run and instruction

Payment run aggregate states are `CREATED`, `QUEUED`, `SUBMITTING`, `SUBMITTED`, `PROCESSING`, `PARTIALLY_SUCCEEDED`, `SUCCEEDED`, `FAILED`, `RECONCILIATION_REQUIRED`, and `CANCELED`. A run is a projection of its instructions and never forces their state. `FAILED` requires definitive non-acceptance/no settlement for every applicable instruction; uncertainty is `RECONCILIATION_REQUIRED`; cancellation is allowed only before provider acceptance.

Instruction states and owners:

| State | Owner | Allowed next |
| --- | --- | --- |
| PENDING | App | SUBMITTING, CANCELED |
| SUBMITTING | Worker | SUBMITTED, FAILED, RECONCILIATION_REQUIRED |
| SUBMITTED | Provider projection | PROCESSING, PAID, FAILED, CANCELED, RECONCILIATION_REQUIRED |
| PROCESSING | Provider projection | PAID, FAILED, RETURNED, RECONCILIATION_REQUIRED |
| PAID | Reconciled provider fact | RETURNED |
| FAILED | Provider/system | SUBMITTING only through an authorized safe retry that creates a new attempt; changed intent creates a new linked instruction |
| RETURNED | Provider fact | terminal; optional new replacement instruction |
| RECONCILIATION_REQUIRED | Reconciler/ops | any provider-supported resolved state with evidence |
| CANCELED | App/provider | terminal |

An ambiguous timeout goes to `RECONCILIATION_REQUIRED`, not `FAILED`.

`FAILED` means the intended transfer definitively did not settle. `RETURNED` is allowed only after provider evidence that a previously accepted/paid transfer was returned. Elapsed time or a generic error cannot establish either state.

## Statement generation and delivery

- Statement: `PENDING -> GENERATING -> READY`; generating may `FAILED`; ready may `SUPERSEDED` by correction. No payment status is implied.
- Artifact attempt: `QUEUED -> CLAIMED -> SUCCEEDED|FAILED|TIMED_OUT`; retries are new rows.
- Delivery: `QUEUED -> SENDING -> SENT -> DELIVERED` where provider supports delivery; `SENDING|SENT -> FAILED|BOUNCED`; retry produces a new attempt and returns delivery to queued. Email success never means employee transfer paid.

## Remittance and tax documents

- Liability: `DRAFT -> REVIEWED -> FINALIZED`; finalized derives `UNPAID|PARTIALLY_PAID|PAID|OVERPAID` from payment ledger and may be `ADJUSTED` by a new version. Due/overdue is derived from due date, not destructive status replacement.
- Remittance payment: `RECORDED -> CONFIRMED|VOIDED`; correction is a new linked record.
- Tax package: `DRAFT -> VALIDATING -> REVIEW_REQUIRED|VALIDATION_FAILED`; failed validation returns to a revised DRAFT; review may return to DRAFT or `FINALIZED`; finalized is immutable and amendments are new linked packages. Delivery uses the independent delivery lifecycle. A separate submission record starts `SUBMITTED` only from supported evidence and may become `ACCEPTED|REJECTED|CANCELED`. Generated is not filed.

## Billing and onboarding

- Subscription entitlement is a projection of verified provider events: `PENDING, ACTIVE, PAST_DUE, SUSPENDED, CANCELED`; feature policy defines grace separately.
- Onboarding steps: `NOT_STARTED, IN_PROGRESS, BLOCKED, PENDING_EXTERNAL, VERIFIED, COMPLETE`; overall readiness is derived from required versioned steps.

## Transition invariants

Finalized payroll totals and source hashes cannot change; payments require a finalized payroll result; each instruction amount/currency matches its result/delta; provider event IDs are unique; retry increments attempt number; all transitions include actor/system owner, previous/next, reason/correlation, and timestamp; stale version updates fail with conflict.
