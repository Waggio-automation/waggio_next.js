# Current feature inventory

Status vocabulary: **Existing and verified** is limited to tested narrow behavior; **Existing but requires correction** means code exists but is unsafe/defective; **Partial** lacks required lifecycle pieces; **Missing** has no implementation; **Future/verification** needs external/legal work.

| Capability | Status | Current evidence / boundary |
| --- | --- | --- |
| Employer signup/login/logout | Partial | Password auth and signed cookie; no MFA, throttling, revocation, verification, consent, or auth tests. |
| Password reset | Partial | Hashed expiring token and SMTP; enumeration and no throttling/session revocation. |
| Legacy magic-link login | Existing but requires correction | Unauthenticated endpoint returns a valid admin link for the first company; Critical. |
| Public landing/pricing/trust/support | Missing | Root is an authenticated dashboard; no public product site, policies, contact, or support. |
| Company creation | Partial | Signup creates one company/owner; no join/invite or business onboarding workflow. |
| Company payroll/CRA setup | Partial | Settings forms exist; no progress model, KYB/signing officer/documents, schedule, or completion state. |
| Team roles/invitations | Missing | OWNER/ADMIN enum exists but is not enforced; no invite/revoke/deactivate. |
| Employee manual create/edit | Partial | Core fields and payout setup exist; no deactivate/terminate/rehire, correction history, or deletion protection. |
| CSV import/self-onboarding | Missing | No import or employee-facing product. |
| SIN protection | Existing but requires correction | Mixed plaintext/AES-CBC storage and no T4 decryption. |
| Employee bank setup | Existing but requires correction | Trolley recipient/account creation works conceptually; bank fields are retained/displayed in plaintext. |
| Ontario payroll calculation | Existing but requires correction; legal verification | Limited 2026 periodic formula; major explicit exclusions and no payroll tests. |
| Payroll input and preview | Partial | Manual table for hours/OT/holiday/vacation; no import, comparison, previous payroll, or robust server validation. |
| Review/approval/finalize | Missing | Saving immediately marks run PROCESSED; no approver, confirmation, lock, or immutable final state. |
| Off-cycle/adjustment/reversal | Missing | No domain model or UI. |
| Duplicate prevention | Missing | Client idempotency header is ignored. |
| Employer funding | Missing/unclear | Status labels exist, but no explicit funding intent/confirmation flow or employer bank/KYB model. |
| Automatic employee transfers | Partial; unsafe | Trolley batch/payment submission exists; no claim lock, webhook, reconciliation, return/reversal handling. |
| Paystub HTML/PDF | Partial; unsafe | External PDF proxy exists but is open, arbitrary HTML, public blob; primary payroll does not call it. |
| Paystub email/employee access | Missing in repo | No paystub mailer or employee portal; legacy interfaces imply an unknown external caller. n8n removal is approved and a direct durable-worker replacement is required. |
| Payroll/transfer/paystub history | Partial | Recent run statuses only; no register, filters, reconciliation, document history, or correction chain. |
| Exports | Partial | Legacy PENDING-row JSON endpoint; no governed CSV/register exports. |
| CRA remittance calculation | Existing but requires correction; legal verification | All pay-history rows included; accelerated rules are explicit fallback; mutable regeneration. |
| CRA payment | Partial/manual | Users record an external payment; Waggio does not remit to CRA. |
| Remittance reminders | Present but unused | Reminder rows exist; no notification sender. |
| T4/T4 Summary/XML | Existing but requires correction; legal verification | Generates local artifacts but mishandles SIN/status inclusion/versioning and does not file. |
| Stripe subscription | Partial | Checkout/portal/webhook/extra run code; callback binding, dedup, entitlements, trials/refunds/invoices UX incomplete. |
| Internal admin/support | Missing | No operational console, safe impersonation, job recovery, incident tools, or customer communication. |
| Audit logs | Partial | A few CRA actions only, with SYSTEM actor; payroll/payment/auth/billing changes unlogged. |
| Automated tests | Existing and verified only for 10 assertions | No financial, integration, tenant, concurrency, provider, UI, E2E, accessibility, or migration coverage. |

The detailed defect classification from the earlier brief remains in `docs/planning/feature-inventory.md`; this document uses the new product-status vocabulary.
