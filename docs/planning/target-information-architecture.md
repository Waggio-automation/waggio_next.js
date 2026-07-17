# Target information architecture

## Public

- Product
- How payroll works
- Pricing
- Security & privacy
- Support/contact/status
- Legal (terms, privacy, subprocessors)
- Login / create account

## Authenticated employer application

- **Home**: readiness, next payroll task, exceptions, deadlines.
- **Onboarding**: resumable checklist until complete.
- **People**: employees; team/access.
- **Payroll**: drafts; approvals; processing; history/register; adjustments.
- **Payments**: funding; transfer batches; individual transfers; reconciliation/issues.
- **Pay statements**: generation/delivery/history (may be linked from payroll but status remains separate).
- **Compliance**: CRA liabilities/payments/reminders; year-end/T4; company tax settings.
- **Reports**: registers, deductions/contributions, exports, audit.
- **Settings**: company, schedules, earning/deduction policies, notifications, integrations, billing, security, data/privacy.
- **Help**: support case/status/reference guidance.

## Employee application

- Home/current pay
- Pay statements
- Payment status/support
- Profile/tax/bank (step-up)
- Notifications/security/privacy

## Internal operations

- Tenant metadata/search
- Job/event/reconciliation queues
- Provider incidents
- Support case-linked access
- Controlled repair/replay commands
- Audit/security events

Navigation should reflect the payroll lifecycle. Provider names should appear only in technical detail/help, not substitute for understandable states such as “Employer funding needed,” “Transfer processing,” or “Statement email failed.”
