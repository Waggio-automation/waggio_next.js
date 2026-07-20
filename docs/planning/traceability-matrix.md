# Target traceability matrix

Canonical model/status rules are in `final-design.md`; implementation order is in `phased-implementation-roadmap.md`. Test shorthand: `U` domain/golden; `DB` PostgreSQL; `A` auth/tenant; `I` idempotency/concurrency; `C` provider contract; `E2E`; `AX` accessibility/security; `M` migration; `OPS` restore/observability.

| Requirement / evidence ID | Stage | UI/API or trigger | Domain / canonical models | Integration | Required tests | Current disposition |
| --- | ---: | --- | --- | --- | --- | --- |
| Contain unauth admin link (C-01) | 1 | legacy admin-link/verify routes | Identity, AuditEvent | SMTP/session | A,AX,E2E,OPS | Critical correction; caller inventory needed |
| Contain arbitrary/public PDF (C-02) | 1 | `/api/payslip/pdf`, public blob | PayStatement, artifact intent | Railway/blob | A,C,AX,E2E,OPS | Critical correction; do not delete before caller evidence |
| Contain unsafe SIN paths (C-03) | 1/3 | employee create/edit, T4 read | SensitiveIdentifier | KMS | U,DB,A,AX,M | Critical correction |
| Preserve history/delete restrictions (C-04) | 1/3/4 | employee/company lifecycle | Company, Employee, RetentionAction/Hold | object/provider retention | DB,A,M,OPS | Critical correction |
| Prevent ambiguous/duplicate Trolley action (C-05) | 1/6 | cron/manual submit/retry | instruction/attempt/event/reconcile | Trolley | C,DB,A,I,OPS | Critical correction |
| Finalized-only compliance source (C-06) | 5/9/10 | remittance/T4 commands | PayrollResult, allocations, tax package | CRA specifications | U,DB,A,I,M | Critical correction/legal validation |
| N8N-01 employee event replacement | 2 | employee server action | AuditEvent, OutboxEvent, Job | direct Stripe/Trolley if needed | DB,A,I,C,OPS | Historical call removed 2026-07-17; AUTO-01 outcome verification pending |
| N8N-02 payroll event replacement | 2/5 | payroll finalize command | PayrollRun/Result, OutboxEvent, Job | direct downstream workers | DB,A,I,E2E,OPS | Historical call removed 2026-07-17; AUTO-02 statement/delivery gap explicit |
| N8N-03 schedule flow replacement | 2/5 | named commands + approved cron | PayrollRun, Job/Attempt | direct workers | U,DB,A,I,OPS | Historical call removed 2026-07-17; local schedule-only route remains, AUTO-03 pending |
| N8N-04/06/07 global reads replacement | 1/2 | tenant queries; worker DB claim | tenant-owned result/run/job | none | DB,A,AX,E2E | Global access removed 2026-07-17; authenticated tenant DTO routes retained |
| N8N-05 arbitrary patch replacement | 1/2/6/7 | worker domain commands | attempts/events/statements/deliveries | Trolley/Railway/email | C,DB,A,I,E2E | Global access removed 2026-07-17; authenticated tenant mutation retained temporarily |
| n8n workflow/credential retirement | 2 | deployment/workflow operations | audit/retirement evidence | hosted n8n/environment | A,C,OPS | Application removal complete; hosted workflow/configuration retirement pending OPS-01/OPS-02 |
| Verified account/session/membership | 3 | target auth/team APIs | User, Membership, Session, Invitation | SMTP/IdP | A,DB,I,E2E,AX | Partial/correction |
| Explicit tenant ownership | 3/4 | all commands/queries | companyId + same-company constraints | PostgreSQL | DB,A,I,M | Missing/inconsistent |
| Company/payroll profile readiness | 3/5 | onboarding/profile commands | CompanyPayrollProfileVersion | optional verification | DB,A,E2E,AX | Partial/legal validation |
| Employee lifecycle/effective profiles | 3/4 | employee commands | Employee, Employment/Tax/Benefits versions | none | U,DB,A,I,E2E,M | Partial/correction |
| Tokenized payout method | 3/6 | payout setup/status | PayoutMethod, ProviderEvent | Trolley | C,DB,A,I,E2E | Partial/correction; raw-bank retention rejected by default |
| Additive mapping/backfill | 4 | offline tenant batches/shadow reads | all target + source mapping/completeness | providers/object storage | DB,A,I,M,OPS | Missing; production inventory required |
| Payroll draft and typed input | 5 | `/payroll-runs`, inputs | PayrollRun, PayrollInput | import optional | U,DB,A,I,E2E,AX | Partial/correction |
| Versioned calculation/net/employer cost | 5 | calculate job | TaxRuleSet, result/earning/deduction/contribution lines | authoritative rules | U,DB,I,E2E,M | Partial/unsafe/legal validation |
| Review/approve/finalize snapshot | 5 | review/approve/finalize commands | PayrollRun/Result, Audit, Outbox | none | U,DB,A,I,E2E | Missing |
| Payment submission | 6 | payment-run command/worker | PaymentRun, Instruction, Attempt, Job | Trolley | C,DB,A,I,E2E | Partial/unsafe |
| Provider webhook/reconciliation | 6 | webhook/reconcile/cron | ProviderEvent, Reconciliation | Trolley | C,DB,I,AX,OPS | Missing |
| Failed versus returned recovery | 6/8 | retry/reissue command | Instruction, Attempt, AdjustmentLink, Audit | Trolley | C,U,DB,A,I,E2E | Missing/provider semantics required |
| Private statement generation | 7 | generation worker | PayStatement, GenerationRun/Attempt, Artifact | Railway/private blob | C,DB,A,I,E2E,AX | Partial/unsafe |
| Statement delivery/access | 7 | delivery/access commands | Delivery/Attempt, Artifact | email/private blob | C,A,I,E2E,AX | Missing |
| History/register/export | 8 | history/report APIs | payroll/payment/statement projections | private export | U,DB,A,E2E,AX | Partial |
| Adjustment/reversal/off-cycle | 8 | linked correction command | PayrollAdjustmentLink, delta results | payment/compliance downstream | U,DB,A,I,E2E | Missing/legal validation |
| Remittance liability/payment/reminder | 9 | compliance commands/jobs | Liability, Allocation, Payment, Job | email; CRA rules | U,DB,A,I,C,E2E | Partial/correction/legal validation |
| T4/year-end package/amendment | 10 | tax package commands | TaxDocumentPackage/Document/Artifact | CRA specs, email/blob | U,DB,A,I,C,E2E,M | Partial/correction/legal validation |
| Billing entitlement/usage | 11 | billing actions/webhook/worker | BillingUsageEvent/ChargeAttempt, ProviderEvent | Stripe | C,DB,A,I,E2E | Partial/correction |
| Support/job/reconciliation operations | 11 | target ops console/commands | Job, Event, Audit, JIT access records | logs/traces/providers | DB,A,I,AX,E2E,OPS | Missing |
| Privacy export/de-identification/hold | 3/11 | privacy workflow | RetentionAction, LegalHold, Artifact | KMS/private export | DB,A,I,E2E,M,OPS | Missing/legal validation |
| Complete accessible truthful journeys | 12 | all target surfaces | all domain projections | all supported providers | E2E,AX,OPS | Missing final release gate |

No row becomes verified merely because code exists. It must satisfy its stage acceptance, automated evidence, migration/recovery requirements, and any named provider/legal approval.
