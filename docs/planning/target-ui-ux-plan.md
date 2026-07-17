# Target UI/UX plan

## Critical workflow pattern

Every financial workflow uses the same shell: context header -> step/progress -> scoped input -> validation summary -> review -> confirmation -> refresh-safe processing -> outcome -> recovery. Display a stable operation/reference ID and actor/time after submission.

## Planned screens

| Area | Screens/components | Key UX requirements |
| --- | --- | --- |
| Auth | login, signup, verify, MFA, recovery, sessions | Neutral errors, password manager support, rate feedback, accessible announcements |
| Onboarding | checklist + legal/CRA/schedule/funding/team/readiness steps | Save/resume, source help, external-state ownership, blockers |
| People | directory, add wizard, profile tabs, lifecycle action, import preview | Search/filter, duplicates, masked PII, effective dating, confirmation |
| Payroll | run list, draft input, validation, register/variance, approval, processing, detail, adjustment | Totals always visible; errors vs warnings; no direct save-to-pay action |
| Payments | funding card, batch detail, instruction table/cards, issue recovery | Per-employee truth, estimated timing, no unsafe retry |
| Statements | artifact/delivery detail, resend/replace | Payment-independent status, private preview, version history |
| Compliance | remittance list/detail/payment confirmation; year-end preflight/review/finalize | Explicit “recorded, not paid by Waggio”; source and rule version |
| Billing | plan/usage/invoices/payment issue/cancel | True entitlement and charge preview; secure callback state |
| Reports/audit | filters/export/audit timeline | Scoped columns, sensitive export warning, async generation |
| Ops | queues/event detail/reconcile/manual command | Read-only default, reason/ticket/elevation, redaction |

## Error prevention and recovery

- Server validates all client constraints and returns stable field/error codes.
- Destructive/irreversible actions state consequences; do not use vague “Save” or “Retry.”
- Payroll approval confirmation repeats pay date, counts, totals, funding and downstream effects.
- Processing pages poll/read durable state and survive refresh; never infer success from a timed client message.
- Partial outcomes are first-class, not a run-level red banner.
- Empty states explain prerequisites and a single next action. Loading states preserve page layout. Error boundaries provide retry and reference.

## Current-brand preservation

Retain the restrained grayscale palette, generous whitespace, rounded cards, compact status pills, and plain-language tone. Correct inconsistent indigo focus accents, hard-coded light/dark conflict, oversized rounding everywhere, and repeated ad-hoc components before visual expansion. No redesign is justified solely for novelty.
