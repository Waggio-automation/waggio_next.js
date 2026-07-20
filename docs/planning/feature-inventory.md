# Feature inventory

## Classification rules

- **Complete**: repository code and tests substantiate the stated scope.
- **Partially implemented**: a meaningful path exists but required cases or operational pieces are absent.
- **Implemented but defective**: the path exists and has a reproducible design/code defect.
- **Missing**: no implementation found.
- **Present but unused**: code/data exists but no current caller/consumer was found.
- **Duplicated**: overlapping paths can create or mutate the same business concept.
- **Unsafe to use in production**: security, money, tax, preservation, or recovery risk prevents safe operation.

Multiple classifications may apply.

## Authentication and tenant management

| Feature | Classification | Evidence and qualification |
| --- | --- | --- |
| Password signup/login/logout | Partially implemented | HMAC cookie and scrypt hashes exist. No rate limiting, MFA, session revocation, lockout, or auth tests. |
| Password reset email | Partially implemented | Hashed one-hour token and SMTP email exist; requests enumerate accounts, have no throttling, and do not revoke existing sessions. |
| Company-name/login-email recovery | Implemented but defective; unsafe | Returns account existence and a masked address; no throttling. |
| Legacy admin magic link | Implemented but defective; unsafe | Returns a valid login link to the unauthenticated caller and targets the first company. |
| OWNER/ADMIN roles | Present but unused | Enum and column exist; all authenticated users receive the same effective authority. |
| Tenant-scoped UI/API queries | Partially implemented | Most interactive paths filter company; shared-secret integration paths intentionally span all companies. |
| Tenant constraints in database | Missing | Key tenant IDs are nullable and cross-model same-company constraints are absent. |
| Audit of authentication/security events | Missing | `AuditLog` is used only by limited CRA actions. |

## Company, employee, and PII

| Feature | Classification | Evidence and qualification |
| --- | --- | --- |
| Company onboarding/settings | Partially implemented | Plan, Stripe, Trolley defaults, and payroll settings exist; documentation and lifecycle invariants do not. |
| Employee create/edit/list | Partially implemented | Core forms/actions exist and are usually tenant-scoped. No termination/archive lifecycle; limited server validation on edit. |
| Employee API creation | Implemented but defective; unsafe | Stores submitted SIN plaintext, unlike the server action. |
| SIN validation | Partially implemented | Luhn validation exists only on creation schema; storage format and T4 use are broken. |
| SIN encryption | Implemented but defective; unsafe | AES-CBC lacks authentication/key versioning; mixed plaintext/ciphertext data; decryption unused. |
| Bank detail storage | Implemented but defective; unsafe | Database format checks exist, but values are plaintext and over-returned. |
| PII retention/deletion policy | Missing | Cascades can erase statutory records; no retention schedule or legal hold. |
| Multi-company user membership | Missing | `CompanyUser.email` is globally unique and each user belongs to one company. |

## Payroll calculation and lifecycle

| Feature | Classification | Evidence and qualification |
| --- | --- | --- |
| Ontario periodic gross/CPP/EI/tax calculation | Partially implemented; unsafe | A reusable 2026 function exists, but its own comments document material exclusions and it has no calculation tests. |
| Hourly and salary payroll | Partially implemented | BI_WEEKLY and MONTHLY only; inputs are not fully validated server-side. |
| Overtime/holiday/vacation pay | Partially implemented | Basic multipliers exist; statutory eligibility, stacking, and vacation treatment require authoritative verification. |
| Bonus/commission calculation | Missing | Employee `bonus` is stored but ignored; code explicitly says bonus method is not implemented. |
| CPP2 and YTD annual maximums | Missing | Explicitly documented as absent. |
| Contractor handling | Implemented but defective | Employment type is ignored by payroll calculation but later T4 code treats contractors as CPP/EI exempt. |
| Employer CPP/EI snapshot | Missing | Remittance/T4 recompute employer amounts from employee deductions. |
| EHT and WSIB | Present but unused; unsafe if enabled | Columns and net-pay subtraction exist, always zero; employee/employer classification is wrong or at least unverified. |
| Payroll-run creation | Partially implemented; duplicated | Main transactional route exists; legacy standalone pay-history and schedule-only routes bypass it. |
| Payroll idempotency | Missing | Client key is ignored; no uniqueness/ledger. |
| Review/approval/finalization | Missing | `review_*` defaults exist but no review workflow; no approval or immutable final state. |
| Immutable payroll snapshot | Missing | Amounts are stored, but important source inputs/rules and employee identity/employer snapshots are absent. |
| Adjustments/reversals/off-cycle | Missing | No explicit models or flows. |
| Failed/returned payment accounting | Missing | A string failure reason exists; no accounting or compensating record. |
| YTD endpoint | Implemented but defective | It requires statuses and `paidAt` values that the current Trolley flow never sets, so results are likely empty/incomplete. |

## Paystubs, documents, and email

| Feature | Classification | Evidence and qualification |
| --- | --- | --- |
| Paystub HTML/template in current repo | Missing | No checked-in primary-flow template was found. |
| Paystub PDF proxy | Implemented but defective; unsafe | Open arbitrary-HTML rendering, no ownership check/limits/timeout, public predictable blob. |
| Paystub generation orchestration | Missing direct implementation; explicit temporary gap | Historical n8n interfaces were removed on 2026-07-17; any former external outcome is unknown. Approved target is a direct PostgreSQL job/worker flow with stateless Railway conversion. |
| Paystub storage metadata | Partially implemented | Only `pdfUrl` exists; no hash/version/attempt/storage ownership. |
| Paystub email delivery | Missing in repo | SMTP code sends only auth emails; status columns can be patched externally. |
| PDF/email retries and attempts | Missing | Flat status/provider fields only. |
| CRA document serving | Partially implemented | Authenticated, tenant-scoped download exists, but source files use ephemeral local storage. |
| Document version preservation | Implemented but defective | Regeneration deletes/replaces document rows and files instead of superseding. |

## Trolley and money movement

| Feature | Classification | Evidence and qualification |
| --- | --- | --- |
| Recipient/account setup | Partially implemented | Provider creation/status refresh exists; local bank data is duplicated in plaintext and provider status interpretation is shallow. |
| Tenant-aware external IDs/tags | Partially implemented | Good deterministic scheme exists; database/provider ownership is not reconciled. |
| Batch/payment creation | Partially implemented; unsafe | Creates provider resources but lacks a durable pre-call attempt and atomic run claim. |
| Payment-level duplicate recovery | Partially implemented | Duplicate external ID search/reuse exists, but batch reuse and ambiguity handling do not. |
| Funding confirmation | Missing | Status enum exists; no observed implementation transitions to `FUNDS_CONFIRMED`. |
| Trolley webhook receiver/authenticity | Missing | No current route. |
| Trolley event mapping | Present but unused | Mapping and five tests exist but no consumer. |
| Provider event persistence/deduplication | Missing | No model/table. |
| Payment reconciliation/polling | Missing | No provider-to-ledger comparison or stuck-run repair. |
| Returns/reversals/cancellations | Missing | No state or workflow. |
| Cron dispatch | Partially implemented; unsafe | Secret-protected daily cron exists; no concurrency control, queue, lease, or retry policy. |

## CRA remittance and T4

| Feature | Classification | Evidence and qualification |
| --- | --- | --- |
| CRA payroll settings validation | Partially implemented | Five validator tests pass; legal sufficiency remains unverified. |
| Monthly/quarterly grouping | Partially implemented | Grouping exists, but includes all pay-history states and uses runtime-local dates. |
| Accelerated remitter due dates | Implemented but defective; unsafe | Explicit fallback uses monthly rule for both accelerated types. |
| Remittance totals | Implemented but defective; unsafe | Uses mutable/unfinalized rows and recomputed employer amounts. |
| Remittance payment recording | Partially implemented | Manual records and partial status exist; idempotency is heuristic and there is no proof upload flow or CRA reconciliation. |
| Reminder scheduling | Present but unused | Rows are regenerated; no delivery worker exists. |
| T4/T4 Summary generation | Implemented but defective; unsafe | Produces DB rows/PDF/XML, but includes all statuses, uses mixed/encrypted SIN incorrectly, lacks authoritative conformance tests, and can overwrite generated data. |
| T4 finalization/amendment/cancellation | Missing | `FINALIZED` enum exists but no workflow; no amendment report types or immutable versions. |
| CRA electronic submission | Missing | XML is generated for download only; acceptance/rejection tracking absent. |

## Billing

| Feature | Classification | Evidence and qualification |
| --- | --- | --- |
| Stripe checkout/portal | Partially implemented | Basic operations exist; success callback does not bind session to authenticated tenant. |
| Subscription webhook signature | Complete for narrow scope | Stripe SDK verifies signatures before handling. This does not make the broader billing flow complete. |
| Webhook deduplication/event archive | Missing | No Stripe event ledger. |
| Seat metering | Partially implemented | Called after employee create; failures are swallowed and edits/deletes are not comprehensively handled. |
| Extra-run billing | Partially implemented; unsafe | Invoice items are created after payout starts; sequence/idempotency is race-prone and no durable retry worker exists. |
| Billing-to-entitlement enforcement | Implemented but defective | Feature gates often check only non-null `currentPlan`, not active subscription/payment state. |

## Tests and operational readiness

| Feature | Classification | Evidence and qualification |
| --- | --- | --- |
| Validator/status mapping unit tests | Complete for stated assertions | Ten tests pass. They cover neither money calculations nor integration behavior. |
| Payroll calculation tests | Missing | No happy-path, boundary, annual-limit, rounding, or regression vectors. |
| Database/integration tests | Missing | No test database harness or transaction tests. |
| Tenant isolation/authorization tests | Missing | No cross-company negative tests. |
| Migration tests | Missing | Destructive and data-dependent migrations are not rehearsal-tested. |
| Payment/webhook/idempotency/failure tests | Missing | Provider workflow is effectively untested. |
| End-to-end tests | Missing | No browser or full payroll lifecycle tests. |
| Lint | Complete for current tree | `npm run lint` passes on audit date. |
| Prisma validation | Implemented but blocked | Command fails because required `DIRECT_URL` is unavailable in the inspected environment. |
| Deployment-as-code | Partially implemented | Vercel cron only; Railway PDF service, workers, durable document store, and lifecycle policies are absent. |
