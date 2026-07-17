# Product scope

## Product promise

Waggio should help a small Ontario employer prepare, approve, fund, execute, document, and review payroll with clear controls and evidence. It must distinguish calculated estimates, approved payroll liabilities, provider money movement, pay-statement delivery, and CRA obligations. It must never imply direct CRA remittance or filing until a verified integration and authorization support that claim.

## Capability boundaries

| Horizon | Included |
| --- | --- |
| Existing but requires correction | Password workspace access; company/employee records; limited Ontario calculation; Trolley submission; Stripe billing; remittance/T4 draft artifacts; employer UI |
| Planned next | Security containment; tenant/retention invariants; onboarding readiness; immutable draft/review/approve/finalize payroll; idempotent transfer intent/reconciliation; private paystubs; payroll history/register |
| Later product | Employee portal, team invitations/roles, accountant access, import, correction/off-cycle, mature remittance/year-end workflow, operations console |
| Future | Additional provinces/schedules/cases, automated CRA integration, richer benefits/deductions, support tooling at scale |
| Out of scope until verified | Québec, US/global payroll, tax/legal advice, automatic CRA filing/remittance claims, unsupported earnings/deduction cases, custody claims not supported by provider contracts |

## Product principles

1. Preserve finalized facts; correct with linked reversals/adjustments, never silent edits.
2. One company boundary is present and enforced on every tenant record and command.
3. A user sees who owns a status: Waggio calculation, employer approval, funding bank/provider, employee transfer, PDF, email, or CRA/manual payment.
4. Unsupported cases block with an explanation and escalation path.
5. External side effects start only from durable idempotent intent and finish through reconciliation.
6. Sensitive fields are minimized, masked, separately authorized, encrypted/tokenized, and audited.
7. Legal/payroll correctness is based on versioned authoritative sources and reviewed vectors, not code comments.

## Definition of the intended product journey

Verified account -> company and compliance onboarding -> team/permissions -> employees -> payroll schedule/YTD -> draft inputs -> calculate/validate -> review/approve/finalize -> funding/payment intent -> automatic transfers -> private pay statements/delivery -> history/register/reconciliation -> remittance liability/manual payment support -> versioned year-end documents/filing support.

Billing, audit, support, privacy, and incident recovery span every step.
