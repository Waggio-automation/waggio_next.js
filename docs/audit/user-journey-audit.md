# User journey audit

## Roles found versus intended

| Role | Current capability | Intended journey gap |
| --- | --- | --- |
| Employer/owner | Signup, all workspace actions, billing, payroll, CRA | No verification, onboarding, approval policy, team management, funding/KYB, closure/export |
| Company administrator | Same authority as owner | Role is not enforced; should not automatically control billing, owners, or destructive actions |
| Payroll administrator | No distinct role | Needs payroll/employee operations without owner billing/security authority |
| Employee | None | Needs secure self-onboarding, bank/tax data, paystubs, profile updates, notifications |
| Accountant/bookkeeper | None | Needs invite-based, scoped reporting/remittance/year-end access, usually without bank/SIN access |
| Waggio support/admin | None | Needs audited, least-privilege operations without unsafe impersonation |

## Current owner journey

```text
Signup (immediate session)
 -> dashboard
 -> company settings / Stripe plan
 -> manually create employee (+ optional Trolley payout)
 -> payroll table input
 -> save (immediately calculated/PROCESSED)
 -> cron/direct Trolley submission
 -> status remains PAYING without reconciliation
 -> CRA dashboard derives liabilities from all PayHistory
 -> manual CRA payment record
 -> generate local T4 artifacts
```

Breaks in the journey:

- no email/company verification, terms/privacy consent, or security setup;
- plan selection is used as “onboarding,” but legal company, schedule, funding, and compliance readiness are not sequenced;
- no pay schedule/default periods or resume-later setup state;
- no employer funding/KYB model despite readiness language;
- no review/approval/finalize step before liability/payment;
- no genuine paystub generation/delivery confirmation;
- no payment reconciliation or returned-payment workflow;
- no payroll history/register suitable for investigation;
- CRA screens can include unfinalized data and imply filing support beyond actual integration;
- no account closure, export, retention choice, or support path.

## Intended end-to-end journeys

### Owner

Public explanation -> verified account -> organization creation -> terms/privacy -> legal company and CRA identity -> payroll schedule/tax-year settings -> funding/KYB -> invite team -> readiness review -> employee onboarding -> approve payroll -> monitor funding/transfers/paystubs -> review history/remittance/year-end -> manage subscription/security/retention.

### Payroll administrator

Accept invite -> MFA -> scoped dashboard -> onboard/maintain employees -> import/enter inputs -> resolve validations -> compare/review -> submit for owner/authorized approval (or approve if policy permits) -> monitor individual results -> recover failed jobs -> generate corrected statements -> reports/remittance preparation. They should not access billing or reveal SIN/bank fields unless explicitly permitted.

### Employee

Secure invitation -> identity verification/consent -> personal/tax/bank onboarding -> status confirmation -> read-only paystub history -> payment-status support without exposing provider internals -> profile/bank-change workflow with step-up auth -> notification preferences -> data/privacy requests. None is implemented.

### Accountant/bookkeeper

Time-bounded invitation -> company/reporting scope -> payroll register/remittance/T4 review -> export/download -> comments/issue requests. Default access excludes bank account, full SIN, funding controls, team/billing, and payroll approval unless separately granted.

### Waggio support/admin

SSO/MFA -> ticket-linked customer lookup -> metadata-first diagnostics -> explicit just-in-time elevation -> customer-visible reason/consent where appropriate -> immutable access log -> repair through controlled commands, never direct silent data edits. None is implemented.

## Lifecycle audit

| Lifecycle | Implemented now | Missing/planned | External/legal boundary |
| --- | --- | --- | --- |
| Public/trust | None | Landing, pricing truth, security/privacy, support, status | Legal review of claims/policies |
| Account | Basic password flows | Verification, MFA, consent, sessions/devices, deactivation | Email/identity provider |
| Company onboarding | Company + plan + scattered settings | Progress/checklist, schedule, KYB, signing officer, docs, completion rules | Trolley capabilities/agreements, legal review |
| Team | Single user record | Invitations, memberships, granular roles, revoke | Email provider |
| Employee | Manual employer entry | Import, employee self-service, lifecycle, change approvals | Privacy/employment requirements |
| Payroll setup | Employee rate/pay group | schedules, earnings/deductions, opening YTD, effective dating | CRA/Ontario/professional verification |
| Execution | Entry + immediate calculate/save | draft, validate, compare, review, approve, lock, correct/reverse | Legal/payroll verification |
| Funding/transfer | Direct Trolley batch creation | funding intent, claim, webhook, reconciliation, partial/return/retry | Trolley authorization/features |
| Paystub | Unsafe proxy + external hints | template, private artifact, delivery, portal, correction | Pay statement requirements verification |
| History/reporting | Recent status list | register, search/filter/export/audit/reconcile | Retention requirements |
| CRA/tax | Liability estimate/manual payment/T4 artifacts | frozen liability versions, corrections, accepted filing status | Waggio does **not** remit/file; CRA integration/legal verification required |
| Billing | Stripe subscription basics | entitlement, trial/refund/invoice UX, usage ledger | Stripe |
| Support/ops | None | job console, event replay, incident/data-repair controls | Internal policy/compliance |

## Highest-priority journey corrections

1. Put an explicit validation -> review -> approval -> finalize boundary before any transfer or statutory inclusion.
2. Separate payroll calculation, funding/payment, paystub, and CRA statuses in both UI and data.
3. Introduce a real onboarding readiness model instead of inferring readiness from plan/environment fields.
4. Provide recoverable processing pages with stable run/reference IDs and individual outcomes.
5. Build employee and support journeys only after permission, PII, audit, and retention foundations exist.
