# Target user journeys

## Employer onboarding

1. Public product/pricing/security -> create account.
2. Verify email, accept versioned terms/privacy, enroll MFA.
3. Create company or accept invitation.
4. Wizard: legal identity/address -> CRA account/remitter profile -> schedule/tax year/opening YTD -> funding/KYB/signing officer -> team -> readiness review.
5. Each step supports save/resume, explains why data is needed, and shows verified/pending/blocked ownership.
6. Completion produces an auditable readiness snapshot; unsupported configuration blocks payroll.

## Employee onboarding

Directory -> “Add employee” -> identity/contact/employment -> compensation/schedule -> tax elections/opening YTD -> payout invitation/provider flow -> review -> create. Validate duplicates and effective dates before persistence. Confirmation states what remains blocked. Bank and SIN collection should move to employee self-service where feasible; employer access is masked and step-up controlled.

## Standard payroll

Payroll home -> choose schedule/period -> draft inputs/import -> calculate -> error/warning resolution -> payroll register and variance review -> approval confirmation -> atomic finalization -> funding requirement -> payment processing -> per-employee outcomes -> pay-statement generation/delivery -> reconciled completion. Refreshing or resubmitting at any step returns the same durable operation.

Required review shows employee count, gross, employee deductions, employer contributions, net funding, prior-run variance, exceptions, pay date, transfer date, statement delivery date, preparer, approver, and rule version. Mobile uses summaries and expandable employee cards rather than a wide editable table.

## Failure/recovery

- Validation failure: remain in draft; field and summary errors with fix links.
- Ambiguous provider timeout: show “reconciling,” disable blind retry, display reference/support path.
- Partial transfer: run shows exact paid/processing/failed instructions; retry creates a new attempt only for eligible failed instruction.
- PDF/email failure: payment truth remains unaffected; regenerate/retry independently.
- Returned transfer: immutable paid/return events, employee issue, recovery decision and new instruction if approved.
- Internal error: stable correlation ID, safe message, no PII/provider payload.

## Correction/reversal/off-cycle

Open finalized run/result -> choose correction type/reason/effective date -> calculate delta -> review impacts (employee payment, remittance, T4, billing, statement) -> authorized approval -> finalize linked adjustment -> execute only delta payment/collection through permitted provider flow -> replacement statement with prior version retained -> downstream remittance/year-end adjustment.

## Remittance/year-end

Liability dashboard reads frozen finalized allocations -> review period/rules/source payroll -> record external CRA payment and proof after confirmation -> reminders and outstanding balance. Year-end: preflight data completeness -> preview slips/summary/variance -> authorized finalize -> private employee delivery/export -> record external filing/acceptance manually unless a real CRA integration exists -> amendment workflow.

## Accessibility/mobile baseline

All journeys support keyboard-only completion, logical focus, labelled fields, error summary and inline association, live processing announcements, non-color status text, 44px targets, reflow at 320 CSS px, no financial confirmation hidden in horizontal overflow, reduced motion, and recovery after refresh/back navigation.
