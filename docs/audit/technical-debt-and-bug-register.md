# Technical debt and bug register

Severity: Critical can cause account compromise, PII disclosure, money/tax error, duplicate transfer, or historical loss; High materially undermines correctness/security/recovery; Medium impairs reliability/UX/maintainability.

| ID | Sev | Defect/debt | Evidence | Recommended disposition |
| --- | --- | --- | --- | --- |
| BUG-001 | Critical | Unauthenticated admin magic link returned to caller | company admin-link/verify APIs | Contain first; telemetry and controlled retirement |
| BUG-002 | Critical | Open arbitrary-HTML PDF service and public predictable blob | payslip PDF API | Disable/guard; replace with private structured-data job |
| BUG-003 | Critical | SIN plaintext/ciphertext split; T4 renders stored value | employee action/API, crypto, CRA | Stop unsafe path; inventory/migrate with key-versioned AEAD |
| BUG-004 | Critical | Employee/company cascades destroy payroll/compliance/audit | Prisma schema | Add preservation constraints before lifecycle delete |
| BUG-005 | Critical | Trolley submit has no atomic claim; provider-before-DB gap | trolley-payroll service | Durable intent/lease/idempotency/reconciliation |
| BUG-006 | Critical | Remittance/T4 include every PayHistory state | CRA service | Source only finalized non-voided result revisions |
| BUG-007 | High | Browser idempotency key ignored | hours table/run API | Persist/validate request key and hash |
| BUG-008 | High | Status enums conflate calculation/payment/PDF/email; unrestricted jumps | schema/APIs | Separate state machines and commands |
| BUG-009 | High | No complete immutable payroll snapshot/finalization | schema/run route | Payroll aggregate/result revisions with DB immutability |
| BUG-010 | High | No Trolley webhook/event/reconciliation; runs stuck PAYING | repository absence | Verified event inbox + polling reconcile |
| BUG-011 | High | Global n8n secret exposes all tenants and bank data | payroll runs/payhistory APIs | Contain, replace with tenant commands/direct worker reads, then retire n8n after zero callers |
| BUG-012 | High | Plaintext full bank values stored and redisplayed | Employee/UI/schema | Tokenize/minimize/mask/step-up/audit |
| BUG-013 | High | Calculation lacks YTD max, CPP2, bonus, high-income case | calculation comments | Block unsupported; verified versioned engine |
| BUG-014 | High | Contractors receive employee deductions but T4 says exempt | calculation/T4 | Explicit worker classification policy/legal validation |
| BUG-015 | High | EHT/WSIB modeled as employee net deductions | calculation/schema | Separate employer liability; legal verification |
| BUG-016 | High | JS binary number calculation and unconstrained decimals | calculation/schema | Decimal-only, explicit scales/rounding |
| BUG-017 | High | Invalid/negative/date inputs accepted server-side | run API | Strict schemas and domain validations |
| BUG-018 | High | Accelerated remittance rules are monthly placeholder | CRA | Mark unsupported until authoritative implementation |
| BUG-019 | High | CRA/T4 artifacts use ephemeral FS and are overwritten | CRA/Document | Private durable versioned artifact store |
| BUG-020 | High | Stripe success session not bound to company; webhook no ledger | billing code | Verify customer/metadata; event inbox/dedup |
| BUG-021 | High | Auth no throttling/MFA/revocation/RBAC; enumeration | auth | Identity hardening phase |
| BUG-022 | High | Plan gating ignores active billing state in many flows | actions/routes | Central entitlement service and policy |
| BUG-023 | High | Duplicate payroll creation paths and schedule-only run | payhistory/update-status/run APIs | Deprecate behind one command service |
| BUG-024 | High | YTD query depends on statuses/paidAt never set by new flow | YTD API/Trolley | Derive from finalized ledger, not delivery status |
| BUG-025 | Medium | Dashboard reads trigger remittance sync/PDF generation | home/CRA service | Read model + background job |
| BUG-026 | Medium | Reminder rows have no sender | CRA | Mark planned/unused or implement delivery jobs |
| BUG-027 | Medium | Remittance same-day equal payments collapse | CRA payment function | Idempotency key/reference ledger |
| BUG-028 | Medium | Company settings may adopt arbitrary orphan record | company-settings service | Explicit migration/quarantine, no runtime adoption |
| BUG-029 | Medium | Billing extra-run sequence race and swallowed sync failures | Stripe/employee action | Usage ledger, worker/retry/alert |
| BUG-030 | Medium | No provider/API fetch timeouts | Trolley/PDF/legacy n8n | Abort budgets, circuit breaker, ambiguous outcome handling; n8n calls are temporary until retired |
| BUG-031 | Medium | README/metadata/package/docs are boilerplate | root files | Document runtime/config/runbooks after design approval |
| BUG-032 | Medium | No route error/loading states and inconsistent accessibility | app UI | Shared accessible primitives/error boundaries |
| BUG-033 | Medium | Dark theme tokens conflict with hardcoded light components; Geist overridden | globals/layout | Tokenized single supported theme first |
| BUG-034 | Medium | Tracked sample payslips may be mistaken for fixtures | `src/public/payslips` | Verify synthetic, move to explicit safe fixtures or remove later |
| BUG-035 | Medium | DIRECT_URL absent; standalone Prisma validate blocked | schema/environment | Define validated environment contract; do not commit secrets |

The register is design input, not authorization to fix, delete, migrate, or deploy anything.
