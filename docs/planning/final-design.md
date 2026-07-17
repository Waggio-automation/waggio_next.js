# Canonical payroll and workflow design

Status: recommended target design, 2026-07-16. This is the single source of truth for model responsibility, status ownership, tenant/retention invariants, and the n8n-free runtime. It is not implementation or migration authorization. Where another planning document conflicts, this document controls until an approved decision record replaces it.

## Architecture decision

Waggio begins as a modular Next.js application plus authenticated durable worker processes. PostgreSQL is the system of record for domain truth, job leases, inbox/outbox events, idempotency, and audit. Provider calls occur only from workers after durable intent exists. Verified webhooks are stored before processing; scheduled reconciliation repairs ambiguity. Private object storage holds documents.

```text
Browser / provider webhook / approved cron
  -> authenticated Next.js command, webhook receiver, or dispatcher
  -> PostgreSQL transaction
       domain records + IdempotencyRecord + AuditEvent + OutboxEvent/Job
  -> authenticated durable worker claims job with lease
       -> Trolley / Stripe / email provider directly
       -> Railway: stateless authenticated HTML-to-PDF conversion only
  -> ProviderEvent inbox / attempt / reconciliation -> domain projection
  -> private object storage owned by Waggio
```

n8n has no target role. The exhaustive replacement and retirement gates are in `../audit/n8n-usage-audit.md`.

Railway has no database or object-storage credentials. It cannot retrieve employee/payroll data, receive or infer tenant identity, send email, call Trolley, calculate payroll or tax, or retain payroll documents. Waggio sends bounded server-rendered HTML under short-lived service authentication; Railway returns bytes; Waggio validates MIME/magic/size/hash and stores privately.

## Final recommended model list and responsibilities

Names are logical until Prisma naming is separately approved.

| Domain | Model | Sole responsibility / key invariant |
| --- | --- | --- |
| Identity | `User` | Global human identity; contains no company role. |
| Identity | `CompanyMembership` | User-to-company role/status/invite acceptance; unique company+user. |
| Identity | `AuthSession`, `Invitation` | Revocable authenticated session and hashed expiring invitation. |
| Tenant | `Company` | Stable tenant and archive/legal-hold lifecycle; not a deletion cascade root. |
| Tenant | `CompanyPayrollProfileVersion` | Effective-dated legal, CRA, schedule, timezone, remitter and approved configuration. |
| Tenant | `CompanyOnboardingStep` | Versioned readiness evidence/owner/blocker; overall readiness is derived. |
| Integration | `ProviderConnection` | Company/provider account identifiers, scoped secret references and verified readiness; no raw secret value. |
| Employee | `Employee` | Stable company-owned subject ID and lifecycle; no mutable financial history. |
| Employee | `EmploymentVersion` | Non-overlapping effective classification, compensation, job, schedule and vacation terms. |
| Employee | `EmployeeTaxProfileVersion` | Effective tax elections/opening YTD source, encrypted/minimized as appropriate. |
| Employee | `EmployeeBenefitsProfileVersion` | Effective taxable/non-taxable benefits configuration where separately governed. |
| PII/payment | `SensitiveIdentifier` | Envelope-encrypted/key-versioned SIN and last four; isolated access/audit. |
| PII/payment | `PayoutMethod` | Provider token/reference, mask, status and effective interval; no raw bank history by default. |
| Payroll | `TaxRuleSet` | Versioned jurisdiction/year/source/checksum/approval and supported-case definition. |
| Payroll | `PayrollRun` | Period business aggregate: draft/review/approval/finalization, totals, rule/profile references, version and lineage. |
| Payroll | `PayrollInput` | Per-employee typed input revision, effective source IDs, import/manual provenance. |
| Payroll | `PayrollResult` | Immutable employee result revision selected at finalization; explicit company ownership and snapshot/completeness. |
| Payroll | `PayrollEarningLine` | Typed units/rate/multiplier/taxability/amount. |
| Payroll | `PayrollDeductionLine` | Employee statutory/voluntary deduction; only these reduce net pay. |
| Payroll | `EmployerContributionLine` | Employer CPP/EI/EHT/WSIB/benefit liability; never reduces employee net. |
| Payroll | `PayrollAdjustmentLink` | Original-to-delta/reversal run/result lineage; original remains immutable. |
| Payment | `PaymentRun` | Operational group created only from finalized results; status is derived from instructions. |
| Payment | `FundingRequirement` | Immutable required amount/currency/deadline/source plus provider funding projection; does not imply Waggio custody. |
| Payment | `PaymentInstruction` | One intended employee amount/currency/payout snapshot; immutable identity/amount after dispatch. |
| Payment | `PaymentAttempt` | Append-only provider-call attempt, deterministic external ID, outcome/ambiguity/timing. |
| Provider | `ProviderEvent` | Unique received webhook/poll event, verification, restricted payload/hash, processing and tenant resolution. |
| Provider | `ReconciliationRun`, `ReconciliationItem` | Evidence comparing local/provider state and controlled resolution. |
| Statement | `PayStatement` | Versioned employee statement for one result; separate from payment. |
| Statement | `PayStatementGenerationRun` | Optional operational grouping of generation jobs only; no payroll/payment truth. |
| Document | `DocumentArtifact`, `GenerationAttempt` | Private immutable object metadata/checksum/supersession and append-only render attempts. |
| Delivery | `Delivery`, `DeliveryAttempt` | Recipient/channel snapshot and append-only provider delivery attempts. |
| Jobs | `Job`, `JobAttempt` | Due time, lease/claim, retries/dead-letter for asynchronous work. |
| Reliability | `OutboxEvent`, `IdempotencyRecord` | Transactional event publication and same-key/same-request replay contract. |
| Audit | `AuditEvent` | Append-only actor/service, tenant, action, transition/reason/correlation and hashes. |
| Compliance | `RemittanceLiability`, `RemittanceAllocation` | Frozen liability version and exact finalized result/component allocation. |
| Compliance | `RemittancePayment` | Append-only record of external/manual CRA payment, correction/void/evidence. |
| Year-end | `TaxDocumentPackage`, `TaxDocument`, `TaxSubmissionRecord` | Frozen tax-year source set/hash/spec version and artifacts; separate evidence-backed external submission/acceptance history. |
| Billing | `BillingUsageEvent`, `BillingChargeAttempt` | Unique domain usage fact and append-only provider billing attempt. |
| Billing | `Subscription` | Verified Stripe subscription/customer projection and entitlement inputs; provider events remain in `ProviderEvent`. |
| Privacy/ops | `RetentionAction`, `LegalHold` | Policy-driven archive/de-identification/deletion evidence and holds. |
| Privacy/ops | `SupportAccessGrant` | Ticket/reason/approver/auth-level/time-bounded JIT support access; read-only by default. |

`PayHistory` is a legacy source, not a target aggregate. `PaytransferRun` is replaced by `PaymentRun`. `PaystubRun` is accepted only in the narrowed form `PayStatementGenerationRun`.

## Final status enums and allowed transitions

APIs accept named commands, not arbitrary target states. Every transition requires tenant/permission/version validation and an audit record; external side effects additionally require durable intent/idempotency.

### PayrollRunStatus

`DRAFT`, `CALCULATING`, `CALCULATION_FAILED`, `REVIEW_REQUIRED`, `APPROVED`, `FINALIZING`, `FINALIZED`, `VOIDED`.

| From | Allowed command -> to |
| --- | --- |
| DRAFT | `calculate` -> CALCULATING; `discard` -> VOIDED |
| CALCULATING | `calculationSucceeded` -> REVIEW_REQUIRED; `calculationFailed` -> CALCULATION_FAILED |
| CALCULATION_FAILED | `revise` -> DRAFT; `retryCalculation` -> CALCULATING; `discard` -> VOIDED |
| REVIEW_REQUIRED | `revise` -> DRAFT; `approve` -> APPROVED; `discard` -> VOIDED |
| APPROVED | `withdrawApproval` -> REVIEW_REQUIRED; `finalize` -> FINALIZING |
| FINALIZING | atomic commit -> FINALIZED; transaction rollback with no durable finalization -> APPROVED |
| FINALIZED | terminal for this run; correction/reversal creates a linked run |
| VOIDED | terminal; only non-finalized runs may be voided in place |

`ADJUSTED` is not a run state: it is derived from finalized `PayrollAdjustmentLink` rows. This keeps the original finalized fact unchanged.

### PaymentRunStatus and PaymentInstructionStatus

`PaymentRunStatus`: `CREATED`, `QUEUED`, `SUBMITTING`, `SUBMITTED`, `PROCESSING`, `PARTIALLY_SUCCEEDED`, `SUCCEEDED`, `FAILED`, `RECONCILIATION_REQUIRED`, `CANCELED`.

Run status is a projection of its instructions. `SUCCEEDED` means every required instruction is `PAID`; `PARTIALLY_SUCCEEDED` means terminal outcomes differ; `FAILED` is allowed only when no provider acceptance is possible and all instructions are terminal failed/canceled. Any uncertainty yields `RECONCILIATION_REQUIRED`.

| Payment run projection | Allowed next projection / cause |
| --- | --- |
| CREATED | QUEUED when instructions are complete; CANCELED before dispatch |
| QUEUED | SUBMITTING when a worker claims dispatch; CANCELED before provider acceptance |
| SUBMITTING | SUBMITTED or PROCESSING from accepted attempts; FAILED only from definitive rejection of all applicable instructions; RECONCILIATION_REQUIRED on any ambiguity |
| SUBMITTED | PROCESSING, PARTIALLY_SUCCEEDED, SUCCEEDED, FAILED, or RECONCILIATION_REQUIRED as instructions reconcile |
| PROCESSING | PARTIALLY_SUCCEEDED, SUCCEEDED, FAILED, or RECONCILIATION_REQUIRED as instructions reconcile |
| PARTIALLY_SUCCEEDED | PROCESSING while approved recovery is active; SUCCEEDED when all required instructions become paid; RECONCILIATION_REQUIRED on inconsistency |
| FAILED | QUEUED only when an authorized retry creates eligible new attempts; otherwise terminal |
| RECONCILIATION_REQUIRED | any evidence-supported projection after a stored reconciliation decision |
| SUCCEEDED | terminal as payment-run execution truth; later returns are visible on instructions and a linked recovery run |
| CANCELED | terminal |

`PaymentInstructionStatus`: `PENDING`, `SUBMITTING`, `SUBMITTED`, `PROCESSING`, `PAID`, `FAILED`, `RETURNED`, `RECONCILIATION_REQUIRED`, `CANCELED`.

| From | Allowed next / evidence |
| --- | --- |
| PENDING | SUBMITTING by claimed worker; CANCELED before provider acceptance |
| SUBMITTING | SUBMITTED on accepted response; FAILED on definitive rejection; RECONCILIATION_REQUIRED on timeout/ambiguous result |
| SUBMITTED | PROCESSING, PAID, FAILED, CANCELED, or RECONCILIATION_REQUIRED from verified provider evidence |
| PROCESSING | PAID, FAILED, or RECONCILIATION_REQUIRED from provider evidence |
| PAID | RETURNED only from a provider-confirmed post-payment return |
| FAILED | SUBMITTING only through an authorized retry that creates a new attempt and proves the prior failure is safe to retry; changed intent creates a new linked instruction |
| RECONCILIATION_REQUIRED | any supported resolved state only with stored reconciliation evidence |
| RETURNED | terminal; recovery uses a new linked instruction |
| CANCELED | terminal |

`FAILED` means the intended transfer definitively did not settle. `RETURNED` means a transfer previously accepted/paid was subsequently returned. A provider-specific mapper must document exact event semantics; Waggio never infers either from elapsed time.

`PaymentAttemptStatus`: `PENDING`, `IN_FLIGHT`, `SUCCEEDED`, `FAILED`, `AMBIGUOUS`; attempts are immutable after terminal classification and retries create new rows.

### Statement, artifact, delivery, event, and job statuses

| Aggregate | Enum and transitions |
| --- | --- |
| `PayStatementStatus` | `PENDING -> GENERATING -> READY`; `GENERATING -> FAILED`; `FAILED -> GENERATING` only through a new attempt; `READY -> SUPERSEDED` on a replacement statement. |
| `PayStatementGenerationRunStatus` | QUEUED -> PROCESSING -> one of COMPLETED, PARTIALLY_FAILED, FAILED; derived from statement jobs. |
| `GenerationAttemptStatus` | QUEUED -> CLAIMED -> one of SUCCEEDED, FAILED, TIMED_OUT; retry is a new attempt. |
| `DeliveryStatus` | QUEUED -> SENDING -> SENT -> DELIVERED when supported; SENDING or SENT -> FAILED or BOUNCED; retry creates a new attempt and returns the aggregate to QUEUED. |
| `ProviderEventProcessingStatus` | RECEIVED -> PROCESSING -> PROCESSED or FAILED; bounded retry may return FAILED to PROCESSING; exhausted -> DEAD_LETTER. Signature validity and tenant-resolution state are separate facts. |
| `JobStatus` | `QUEUED -> CLAIMED -> SUCCEEDED`; `CLAIMED -> QUEUED` on expired safe lease; `CLAIMED -> FAILED`; bounded retry -> QUEUED; exhausted -> DEAD_LETTER; pre-claim -> CANCELED. |

### Compliance and year-end statuses

| Aggregate | Final enum | Allowed transitions |
| --- | --- | --- |
| `RemittanceLiabilityStatus` | `DRAFT`, `REVIEWED`, `FINALIZED` | DRAFT -> REVIEWED; REVIEWED -> DRAFT or FINALIZED; FINALIZED is immutable and adjustment creates a linked version. `UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERPAID`, due and overdue are derived facts. |
| `RemittancePaymentStatus` | `RECORDED`, `CONFIRMED`, `VOIDED` | RECORDED -> CONFIRMED or VOIDED; CONFIRMED -> VOIDED only with authorized evidence; correction is a new linked record. |
| `TaxDocumentPackageStatus` | `DRAFT`, `VALIDATING`, `VALIDATION_FAILED`, `REVIEW_REQUIRED`, `FINALIZED` | DRAFT -> VALIDATING; VALIDATING -> REVIEW_REQUIRED or VALIDATION_FAILED; VALIDATION_FAILED -> DRAFT; REVIEW_REQUIRED -> DRAFT or FINALIZED; FINALIZED is immutable. Amendment/cancellation creates a linked package/version. Delivery uses `Delivery`; it is not package status. |
| `TaxSubmissionStatus` | `SUBMITTED`, `ACCEPTED`, `REJECTED`, `CANCELED` | A submission record begins SUBMITTED only with supported external evidence; SUBMITTED -> ACCEPTED, REJECTED, or CANCELED. Resubmission/amendment creates a linked record/package. Waggio exposes no filing status when this capability is not approved. |

### Funding, onboarding, and subscription statuses

| Aggregate | Final enum | Allowed transitions |
| --- | --- | --- |
| `FundingRequirementStatus` | `CALCULATED`, `ACTION_REQUIRED`, `PENDING_PROVIDER`, `CONFIRMED`, `FAILED`, `RECONCILIATION_REQUIRED`, `CANCELED` | CALCULATED -> ACTION_REQUIRED or PENDING_PROVIDER; ACTION_REQUIRED -> PENDING_PROVIDER or CANCELED; PENDING_PROVIDER -> CONFIRMED, FAILED, or RECONCILIATION_REQUIRED; FAILED -> PENDING_PROVIDER only through a new verified action; RECONCILIATION_REQUIRED -> an evidence-supported state; CONFIRMED/CANCELED terminal for that version. |
| `CompanyOnboardingStepStatus` | `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `PENDING_EXTERNAL`, `VERIFIED`, `COMPLETE` | NOT_STARTED -> IN_PROGRESS; IN_PROGRESS -> BLOCKED, PENDING_EXTERNAL, VERIFIED, or COMPLETE; BLOCKED -> IN_PROGRESS; PENDING_EXTERNAL -> VERIFIED, BLOCKED, or IN_PROGRESS; VERIFIED -> COMPLETE or IN_PROGRESS when evidence expires; COMPLETE -> IN_PROGRESS only through a new version. Overall readiness is derived. |
| `SubscriptionStatus` | `PENDING`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELED` | Only verified Stripe events/reconciliation update the projection: PENDING -> ACTIVE or CANCELED; ACTIVE -> PAST_DUE, SUSPENDED, or CANCELED; PAST_DUE -> ACTIVE, SUSPENDED, or CANCELED; SUSPENDED -> ACTIVE or CANCELED; CANCELED terminal for that provider subscription. Entitlement grace is a policy, not a status mutation. |

## Tenant ownership rules

1. Every tenant-owned top-level and child row has a non-null `companyId`, including payroll lines, instructions/attempts, statements/artifacts/deliveries, jobs/outbox/idempotency/audit, provider events after resolution, compliance, tax, billing, and retention rows.
2. Parent/child relations use same-company composite keys or equivalent database constraints; application filters are not sufficient.
3. `User` is global. Membership grants company context. No credential implies all-company access.
4. A `ProviderEvent` may enter a restricted unresolved inbox with nullable `companyId`; it cannot mutate a domain record until provider account/external ID resolves exactly one tenant. Unresolved events are quarantined/alerted.
5. Service identities have one purpose and scoped tenant/resource claims. Workers claim database jobs; they do not use public/global data APIs.
6. Object keys and audit rows include opaque tenant ownership internally, but external render/provider payloads receive only the minimum non-tenant correlation token.

## Immutable snapshot requirements

Finalization freezes, at minimum:

- company legal name/address/account display snapshot and payroll profile/rule-set IDs/checksums;
- period start/end, pay date, schedule/timezone, tax year, run type and adjustment lineage;
- employee ID/number/display name/address/classification/province/employment status needed for the payroll statement and statutory explanation;
- selected effective employment, tax, benefits, payout-mask references and their source versions;
- rates, salary basis, hours/units, overtime/holiday/vacation/additional earning inputs, taxable/insurable/pensionable flags, YTD/opening balances and provenance;
- every earning, employee deduction, employer contribution, benefit and adjustment line; calculation order/rounding rule/intermediate values needed for reproduction;
- gross, employee deductions, net pay, employer contributions, employer cost, and relevant remittance/year-end component totals;
- preparer/approver identity, auth level, timestamps, request hash, calculation version, warnings and supported-case assertions.

`netPay = grossEarnings - employeeDeductions`. Employer CPP/EI/EHT/WSIB and other employer-only liabilities never reduce net pay. `employerCost = grossEarnings + employerContributions + approved employer taxes/benefits`; it is not automatically equal to cash funding or CRA remittance.

Payment instructions separately freeze amount/currency, payroll result revision, recipient/provider-token reference, masked destination, deterministic external ID and schedule. Artifacts freeze source result IDs/hash, template/version, checksum, MIME/size, storage version and supersession. No mutable employee/company row is needed to explain a historical finalized result.

## Deletion, retention, and historical sourcing

- Default relational behavior for financial, payment, provider, document, compliance, billing, and audit history is `RESTRICT`/archive, never cascade from company or employee.
- Employee deletion is lifecycle deactivation/termination. After an approved retention period, direct profile PII may be de-identified while immutable payroll/statutory snapshots required for lawful retention remain, protected and access-limited.
- Company closure revokes access/credentials, stops jobs and exports data, then archives the tenant. Purge/de-identification follows an approved retention schedule, legal holds, provider obligations, and a recorded `RetentionAction`.
- Finalized results/events/attempts/allocations/packages/audit are append-only. Corrections create linked delta/reversal/version rows. Artifacts are superseded, not overwritten.
- Raw bank coordinates are not retained after tokenization by default. SIN access is through the isolated encrypted service. Public legacy paystub URLs are inventoried, privately remediated, then revoked according to policy without losing evidence.
- Exact retention periods, legal-hold authorities, de-identification fields, and customer export/closure deadlines require legal/privacy approval before implementation.

Remittance uses exact finalized, non-voided result/component revisions plus adjustment lineage. T4/year-end uses the same immutable payroll sources, freezes the source-set hash and applicable specification/rules, and never depends on payment, PDF, or email status. Historical legacy rows remain `LEGACY_UNVERIFIED` unless their tenant, completeness, approval, and provider/statutory evidence are affirmatively reconciled.

## Idempotency and uniqueness requirements

- `IdempotencyRecord`: unique `(companyId, operation, key)` and canonical request hash; same key/different hash is conflict.
- One run identity per `(companyId, scheduleId, periodStart, periodEnd, runType, activeRevision)` according to approved off-cycle policy; never rely only on a UI check.
- Payroll input/result unique by run, employee and revision; exactly one selected finalized result revision per included employee.
- Payment run unique by source payroll run/purpose/version; instruction unique by run/result/purpose; attempt number and deterministic provider external ID unique.
- Provider event unique by `(provider, providerAccount, externalEventId)`; webhook replay keys/timestamps recorded.
- Statement version unique by result/type/version; artifact object key and content hash/version constrained; attempts/delivery attempts unique by parent+attempt number and provider message ID where available.
- Job/outbox dedup key unique for aggregate/event/purpose; claims use row lock or lease and attempt uniqueness.
- Remittance liability unique by company/period/type/version; allocation unique by liability/result/component; tax package unique by company/tax year/type/version/source hash.
- Billing usage unique by company/source type/source ID/purpose. Audit events have immutable IDs/correlation but are never deduplicated away when they represent distinct actions.

## Migration and backfill policy

Migration is additive, rehearsed, tenant-batched and reversible at the read/write-routing layer. Never edit applied migrations, drop/rename first, infer legal truth, or compensate provider side effects with database rollback.

1. Contain critical endpoints and rotate exposed credentials; inventory backups, production shapes, public blobs, n8n callers/workflows and provider records.
2. Implement n8n replacements and retire only after shadow comparison and zero-caller gates; legacy data remains untouched.
3. Add identity/tenant/retention/PII foundations and non-null-capable ownership columns/tables. Backfill verified company relations; quarantine ambiguity.
4. Add target payroll/payment/statement/reliability models and indexes without removing legacy columns/tables. Backfill deterministic source mappings and completeness flags by tenant/key range.
5. Dual-write through one command service, shadow-read and reconcile counts, sums, hashes, statuses, external IDs and artifacts. Provider reconciliation is required before terminal payment mapping.
6. Canary approved tenants, preserve read fallback, then cut over domain by domain. Freeze legacy writes only after every caller is zero.
7. Archive legacy tables/objects for the approved retention/rollback window. A later separately reviewed destructive change may remove them only with backup/restore, legal/privacy and reconciliation sign-off.

Detailed checkpoints and rollback are in `migration-and-backfill-plan.md`; sequencing is controlled by `phased-implementation-roadmap.md`.

## Remaining blocking decisions

Architecture recommends defaults but cannot approve payroll/legal/provider facts. Required decisions are maintained in `open-decisions.md`. The immediate blockers to schema DDL are production data inventory/backup rehearsal, supported payroll scope and qualified rule sources, retention/PII policy, Trolley operating/event semantics, approval policy, and infrastructure selections for worker/private object/KMS. None prevents Critical containment from beginning.
