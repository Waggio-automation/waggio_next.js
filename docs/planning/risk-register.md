# Risk register

| ID | Severity / likelihood | Risk | Mitigation / detection | Owner |
| --- | --- | --- | --- | --- |
| R-01 | Critical / High | Legacy magic-link account takeover | Contain route, access-log review, session/token rotation plan | Security |
| R-02 | Critical / High | Public/arbitrary PDF exposes PII or enables SSRF/resource abuse | Authenticate/disable, private storage, renderer sandbox tests | Security/platform |
| R-03 | Critical / High | Duplicate/orphan Trolley payment from concurrency/crash | Intent/outbox/claim/external ID/event inbox/reconciliation | Payments |
| R-04 | Critical / High | Incorrect payroll deductions/net/YTD | Block unsupported, versioned Decimal engine, official vectors and sign-off | Payroll domain |
| R-05 | Critical / High | Draft/failed rows enter CRA/T4 | Finalized source invariant, immutable allocations, preflight/reconciliation | Compliance |
| R-06 | Critical / Medium | Historical payroll/compliance loss through cascade/migration | Restrict delete, additive migration, backup/restore/reconciliation | Data |
| R-07 | Critical / High | Mixed plaintext/encrypted SIN and invalid tax artifacts | Stop unsafe writes, inventory/quarantine, AEAD migration, field access audit | Security/data |
| R-08 | High / Medium | Cross-tenant read/write via a missing filter | Historical global-secret bypasses were removed; continue tenant data layer, non-null keys/constraints, service claims, and negative tests | Architecture/security |
| R-09 | High / High | Bank data exposure | Provider tokenization, minimize/mask/step-up/audit/redaction | Security/product |
| R-10 | High / High | Status confusion causes unsafe user retry | Separate state machines, owner labels, ambiguous reconciliation state | Product/payments |
| R-11 | High / High | Ephemeral/overwritten CRA/T4 documents | Private durable versioned object store and checksum | Platform/compliance |
| R-12 | High / Medium | Stripe cross-tenant binding or duplicate event/charge | Customer/metadata validation, event/usage ledger/idempotency | Billing |
| R-13 | High / High | Auth abuse/stale privilege | Rate limit, MFA, revocable sessions, memberships/RBAC | Identity |
| R-14 | High / Medium | Unverified legal/product claims | Claim review, explicit manual/external boundaries, legal approval | Product/legal |
| R-15 | High / Medium | Migration misclassifies legacy data | Completeness flags, quarantine, tenant checks, sums/hashes, canary | Data |
| R-16 | High / Medium | Draft proposal is mistaken for approved target and removes the payroll aggregate | Canonical final design, decision record, architecture review before DDL | Product/architecture |
| R-17 | High / High | Removed historical workflows leave unknown statement/delivery or schedule-only outcomes unowned | AUTO-01 through AUTO-03 owners; caller/execution inventory; direct durable replacements; gap monitoring; never restore global-secret access | Platform |
| R-18 | Medium / High | Serverless request timeout/side-effect partial failure | Queue/workers, bounded requests, idempotent jobs, alerts | Platform |
| R-19 | Medium / Medium | Inaccessible/mobile financial review leads mistakes | Design-system/a11y/E2E acceptance and user testing | Design/product |
| R-20 | Medium / High | Sparse tests permit regression | Release gates and traceability; official vectors | QA/engineering |
| R-21 | High / Medium | Hosted workflows or deployment-only legacy variables remain enabled after application removal | Day 3 environment/workflow checklist, named owners, observation evidence, disablement, credential retirement, post-change monitoring | Platform/security |

Critical risks block production money movement or statutory output until the mitigation is implemented and independently verified. Acceptance of residual payroll/legal/privacy risk requires the accountable owner, not engineering alone.
