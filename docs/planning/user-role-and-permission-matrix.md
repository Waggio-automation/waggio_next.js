# User role and permission matrix

Target roles are memberships, not a role string directly on a globally unique user. A person may belong to multiple companies. Deny by default; field permissions are separate from action permissions.

Legend: A = allowed, P = policy-dependent/explicit grant, R = redacted/read-only, — = denied.

| Capability | Owner | Company admin | Payroll admin | Accountant | Employee | Waggio support |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Company legal profile | A | A | R | R | — | R/JIT |
| Billing/subscription/refund | A | P | — | R | — | R/JIT |
| Invite/remove owner/admin | A | P | — | — | — | — |
| Manage payroll/accountant roles | A | A | — | — | — | — |
| Configure schedules/tax settings | A | P | A | R/P | — | R/JIT |
| Employee create/update | A | A | A | R/P | own limited | R/JIT |
| Full SIN | step-up P | step-up P | step-up P | —/last4 | own | masked/JIT exceptional |
| Full bank coordinates | never after tokenization | never | never | — | own change flow | — |
| Payroll draft/calculate | A | P | A | R/P | — | R/JIT |
| Payroll approve/finalize | A | P by policy | P by policy | — | — | — |
| Submit/cancel/retry transfer | A | P | P | — | — | controlled ops command |
| Payroll register/history | A | A | A | A | own only | R/JIT |
| Remittance/T4 prepare | A | P | A | A | own T4 | R/JIT |
| Record CRA payment | A | P | P | P | — | — |
| Export data | A | scoped | scoped | scoped | own | ticket/JIT |
| View audit | A | A | scoped | scoped | own access events | security/ops scoped |
| Close company/request deletion | A + dual confirmation | — | — | — | own privacy request | facilitate, not approve |

## Control requirements

- Owner transfer/removal, bank/SIN changes, payroll approval, and support elevation require recent authentication/MFA.
- Optional separation of duties: preparer cannot approve their own payroll above a configurable threshold; at minimum record both roles.
- Invitations are single-use, hashed, company/role scoped, expiring, revocable, and audited.
- Support access is SSO/MFA, ticket/reason bound, time-limited, read-only by default, customer-visible where appropriate, and never implemented as silent cookie impersonation.
- Permission tests must include every role plus cross-tenant and direct-object-ID attempts.
