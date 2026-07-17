# Target schema proposal

This is a logical target summary, not an approved Prisma migration. The supplied draft has been reconciled in `schema-reconciliation.md`; `final-design.md` is canonical for final names, ownership, enums, transitions and invariants. Keep legacy tables during additive migration.

## Identity, tenant, and policy

| Model | Purpose / essential fields |
| --- | --- |
| `User` | global identity, normalized email, verification, auth state; no company role |
| `CompanyMembership` | companyId, userId, role/policy version, status, invited/accepted/revoked metadata; unique company+user |
| `AuthSession` | hashed session ID, user, expiry, MFA/auth level, revokedAt |
| `Company` | immutable tenant ID, lifecycle/archivedAt, legal profile relation |
| `CompanyPayrollProfileVersion` | effective-dated legal/CRA/remitter/contact/schedule configuration snapshot |
| `CompanyOnboardingStep` | versioned readiness evidence, ownership and blocker; overall readiness is derived |
| `ProviderConnection` | company-scoped provider account/secret references and verified readiness; no raw secret value |
| `IdempotencyRecord` | company, operation, key, request hash, state, response reference/expiry |
| `OutboxEvent` | tenant aggregate event persisted in the same transaction; publishing state only |
| `Job` / `JobAttempt` | scheduled/due asynchronous work with claim lease, bounded attempts and dead-letter evidence |
| `AuditEvent` | append-only actor/auth level/action/reason/target/correlation/before-after hashes |

## Employee and sensitive data

| Model | Purpose / essential fields |
| --- | --- |
| `Employee` | non-sensitive identity, companyId non-null, lifecycle status, archivedAt |
| `EmploymentVersion` | effective-dated classification, job, compensation, schedule, vacation policy |
| `EmployeeTaxProfileVersion` | encrypted/minimized elections and opening balances with effective dates |
| `SensitiveIdentifier` | envelope-encrypted/key-versioned SIN, last4, access policy; isolated from normal selects |
| `PayoutMethod` | provider token/reference, masked descriptor/status; do not retain raw bank coordinates after provider exchange unless strictly required |

## Payroll truth

| Model | Purpose / essential fields |
| --- | --- |
| `PayrollRun` | company, schedule, period date values, payDate, tax year, status/version, preparer/approver/finalizedAt, totals, calculation rule set; authoritative business aggregate |
| `PayrollInput` | run+employee, typed earnings/hours/adjustments, source/import provenance, revision |
| `PayrollResult` | immutable finalized employee result with explicit companyId, full identity/employment/rate/tax/YTD/formula snapshot and totals; one selected revision per run+employee |
| `PayrollEarningLine` | result, earning code, units/rate/multiplier/amount/taxability |
| `PayrollDeductionLine` | result, code, employee amount, statutory/voluntary, rule reference |
| `EmployerContributionLine` | result, code (CPP/EI/EHT/WSIB/etc.), amount, rule reference; never deducted from net |
| `PayrollAdjustmentLink` | correction/reversal run/result -> original, reason and delta type |
| `TaxRuleSet` | province/year/version/source/checksum/approval/effective range |

`PayHistory` should be backfilled into `PayrollResult`/legacy mapping. Do not use status delivery/payment fields as financial truth.

## Payment execution

| Model | Purpose / essential fields |
| --- | --- |
| `PaymentRun` | company, payrollRun, status, currency, total/count, scheduled/claimed/submitted/reconciled timestamps, external batch ID |
| `FundingRequirement` | payment run source amount/currency/deadline and provider funding projection; no custody claim |
| `PaymentInstruction` | paymentRun+payrollResult, recipient/payout token snapshot, amount, status, provider payment ID, expected delivery |
| `PaymentAttempt` | instruction, attempt number/type, idempotency/external ID, request/response hashes, outcome/error/ambiguous flag/timestamps |
| `ProviderEvent` | provider/event ID unique, restricted unresolved intake then exact tenant resolution, raw encrypted payload or pointer/hash, signature status, received/processed/error/replay metadata |
| `ReconciliationRun`/`ReconciliationItem` | provider query window, local/provider states, difference and resolution |

Prefer `PaymentRun` over `PaytransferRun`. A retry is an attempt, not an overwrite of an instruction.

## Pay statements and delivery

| Model | Purpose / essential fields |
| --- | --- |
| `PayStatement` | company, payrollResult, statement version/status, corrected/supersedes link |
| `DocumentArtifact` | tenant, document/version, private object key, MIME/size/hash, template/calculation versions, generatedAt/retention class |
| `GenerationAttempt` | statement/artifact intent, attempt, worker/error/timing |
| `Delivery` | statement, recipient/channel/address snapshot, status |
| `DeliveryAttempt` | delivery, provider message ID, attempt, timestamps/outcome/error |
| `PayStatementGenerationRun` | optional operational grouping only; never stores payroll totals |

## Remittance, year-end, billing

| Model | Purpose / essential fields |
| --- | --- |
| `RemittanceLiability` | company, immutable period/version/remitter snapshot/status/totals/rule set |
| `RemittanceAllocation` | liability -> finalized payroll result/revision + component amounts |
| `RemittancePayment` | immutable external-payment record/status/idempotency/proof; void creates transition/event |
| `TaxDocumentPackage`/`TaxDocument`/`TaxSubmissionRecord` | tax year/version/type/package status, source result set hash, finalized/amendment links, artifacts, and separate evidence-backed submission status |
| `BillingUsageEvent` | company, source type/id unique, quantity/amount plan snapshot, occurredAt/status |
| `BillingChargeAttempt` | usage, provider invoice item/idempotency/outcome/error |
| `SubscriptionEvent` | verified provider event projection or share common ProviderEvent |
| `Subscription` | verified provider customer/subscription projection used by entitlement policy |

## Precision, date, retention, and indexes

- Posted CAD amounts: explicit `Decimal(19,2)` after rule-defined rounding; intermediate/rates use sufficient declared scale such as `Decimal(19,8)`. Never JS `number` for calculation.
- Period start/end and pay date are business `DATE`; scheduling/event timestamps are UTC; store schedule IANA timezone and local intended time.
- Non-null companyId on every tenant row, including child lines/attempts/artifacts. Only a restricted unresolved ProviderEvent inbox may temporarily omit it; no domain mutation occurs before exact resolution. Enforce same-company relationships with composite constraints. Index worker queries `(companyId,status,scheduledAt)`, histories `(companyId,payDate,id)`, events `(provider,eventId)`, objects `(companyId,objectKey/version)`, and audit `(companyId,createdAt,id)`.
- Finalized results, payment events, audit, submitted tax artifacts, and allocations are append-only/restricted. Employee “deletion” deactivates the subject; approved policy may later de-identify operational profile fields without deleting required financial evidence.

## Alternatives and tradeoffs

- One universal ledger offers flexibility but hides payroll semantics; typed models plus append-only audit are clearer.
- Keeping all fields in PayHistory minimizes migration work but perpetuates status coupling and incomplete snapshots; rejected.
- Removing PayrollRun and using PaystubRun reduces tables but loses the approval/liability aggregate; rejected.
- Storing provider raw events aids forensics but increases PII scope; encrypt/restrict or store a durable protected payload pointer plus canonical hash.
