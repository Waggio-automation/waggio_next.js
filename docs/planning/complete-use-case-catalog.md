# Complete use-case catalog

Status reflects the current repository: EV existing/verified, EC existing/correction required, P partial, M missing, F future, 3P third-party required, LV legal/payroll verification required.

| ID | Use case | Primary role | Current | Target outcome |
| --- | --- | --- | --- | --- |
| PUB-01 | Understand product/pricing/security/support | Prospect | M | Accurate public site and contact/policies |
| AUTH-01 | Create and verify account/accept terms | Owner | P | Verified identity, consent version, MFA prompt |
| AUTH-02 | Login/logout/manage sessions/recover | Member | P/EC | Neutral recovery, revocation, devices, throttling |
| ONB-01 | Create/join company | Owner/member | P | Membership + invitation model |
| ONB-02 | Enter legal/CRA/company details | Owner/admin | P/LV | Effective-dated validated profile |
| ONB-03 | Configure schedule/tax year/opening YTD | Payroll admin | M/LV | Supported schedule and verified opening balances |
| ONB-04 | Complete funding/KYB/signing officer/docs | Owner | M/3P | Provider-backed readiness, clear external state |
| TEAM-01 | Invite/revoke/change team access | Owner/admin | M | Least-privilege memberships and audit |
| EMP-01 | Manually onboard employee | Payroll admin | P/EC | Guided identity/employment/tax/compensation workflow |
| EMP-02 | Import employees and correct errors | Payroll admin | M | Preview, duplicate resolution, safe CSV |
| EMP-03 | Employee self-onboards/changes bank | Employee | M/3P | Secure step-up self-service and notifications |
| EMP-04 | Update/deactivate/terminate/rehire | Payroll admin | M | Effective-dated lifecycle preserving history |
| PAY-01 | Create/save payroll draft | Payroll admin | P/EC | Idempotent draft scoped to schedule/period |
| PAY-02 | Enter/import hours and earnings | Payroll admin | P | Validated inputs and source provenance |
| PAY-03 | Calculate versioned payroll | System | P/EC/LV | Decimal engine, official rule set, full snapshots |
| PAY-04 | Resolve errors/warnings/unsupported cases | Payroll admin | M | Blocking/warning catalog and escalation |
| PAY-05 | Compare/review payroll register | Preparer/approver | M | Variance and previous-run review |
| PAY-06 | Approve and finalize/lock | Authorized approver | M | Immutable final transaction + audit/outbox |
| PAY-07 | Correct/reverse/off-cycle payroll | Authorized admin | M/LV | Linked adjustment/reversal workflow |
| FUND-01 | Determine/show funding requirement | Owner/payroll admin | M/3P | Amount, deadline, source, provider state |
| XFER-01 | Submit transfer batch idempotently | System/authorized user | P/EC/3P | Durable payment run/instructions/attempts |
| XFER-02 | Process webhook/reconcile | System | M/3P | Verified inbox, per-payment truth, polling |
| XFER-03 | Recover partial/failed/returned payment | Payroll admin/support | M/3P | Safe retry/reissue/manual resolution |
| STMT-01 | Generate private pay statements | System | P/EC | Server-owned template, versioned private artifact |
| STMT-02 | Deliver/retry email | System/payroll admin | M/3P | Separate attempt/delivery status |
| STMT-03 | Employee accesses history | Employee | M | Authenticated own-document portal |
| HIST-01 | Search payroll/register/transfers/statements | Employer roles | P | Filtered reconciled history and exports |
| REM-01 | Calculate/freeze remittance liability | Payroll/accountant | P/EC/LV | Finalized result allocation and versions |
| REM-02 | Record/void/correct CRA payment/proof | Owner/accountant | P | Idempotent payment ledger/evidence |
| REM-03 | Remittance reminders | Employer | P-unused | Job-driven preferences and delivery |
| TAX-01 | Preflight/generate/finalize T4 package | Payroll/accountant | P/EC/LV | Versioned reviewed artifacts |
| TAX-02 | Amend/cancel/support filing status | Payroll/accountant | M/3P/LV | Correction chain; no filing claim without integration |
| BILL-01 | Select/change/cancel plan and view invoice | Owner | P/EC/3P | Secure tenant binding and entitlement ledger |
| BILL-02 | Meter employees/runs and recover failure | System/owner | P/EC/3P | Idempotent usage and visible billing outcome |
| OPS-01 | Diagnose/retry/reconcile failed jobs | Support | M | Audited operations console/commands |
| PRIV-01 | Export/correct/delete/deactivate data | Owner/employee | M/LV | Policy-driven request and retention workflow |
| AUD-01 | Investigate actor/transition/provider history | Owner/support | P | Immutable correlated audit timeline |

Each financial use case inherits the test matrix in `test-strategy.md` and must be traceable through `traceability-matrix.md`.
