# Open decisions

Resolved on 2026-07-16: the schema draft is available and reconciled; n8n has no target role. Keeping `PayrollRun`, using `PaymentRun`, and separating statement/payment/compliance lifecycles are architecture recommendations in `final-design.md`, not remaining choices.

## Blocking implementation approvals

1. **Production exposure and caller inventory:** identify owners/use for the admin-link, PDF, n8n compatibility routes/workflows, Trolley dispatch, public blobs and local environment credentials. Approve the containment observation window and credential rotation/revocation process.
2. **Production data and recovery:** approve environment inventory access, encrypted backup/object snapshot, masked restore rehearsal, RPO/RTO, reconciliation owners and quarantine handling before DDL/backfill.
3. **Payroll product boundary:** approve launch province(s), tax years, schedules, worker classifications, earnings/deductions/benefits, partial periods, YTD/opening balances and explicit unsupported blockers.
4. **Authoritative sources/reviewers:** name payroll, legal, privacy and security approvers and source/version process for CRA, Ontario, CPP2, EHT, WSIB, pay statements, retention and year-end claims.
5. **Approval policy:** decide who may prepare/approve/finalize; self-approval/threshold/separation-of-duty rules; step-up/MFA; correction/reversal authority.
6. **Trolley operating model:** confirm merchant/funding/KYB/signing-officer responsibilities, recipient/account lifecycle, exact webhook verification/event mappings, accepted/processing/paid/failed/returned/canceled semantics, deterministic ID support and reconciliation API/SLA.
7. **Sensitive data policy:** approve KMS/HSM/residency/key rotation/support access for SIN and whether any exceptional raw bank retention is legally required. Recommended default is provider token plus mask only.
8. **Retention/deletion:** approve periods by payroll/payment/provider/document/compliance/audit/billing class; legal holds; employee de-identification fields; company closure/export deadlines; public-blob remediation and provider deletion duties.
9. **Infrastructure:** select/approve authenticated durable worker runtime, PostgreSQL job strategy, private object storage, email provider, KMS/secrets platform, monitoring/alerting, regions/residency and CI/CD. Railway ownership/security limits are fixed by architecture.
10. **Pay statement product:** approve required fields/legal review, availability timing, employee portal versus attachment/authenticated link, correction/supersession semantics and delivery evidence interpretation.
11. **CRA scope:** approve liability/manual record only, filing-support exports, or a later authorized integration. Waggio must not claim it remits/files without supported evidence.
12. **Legacy truth:** define which historical records may be labeled approved/finalized and require provider/legal evidence. Default is `LEGACY_UNVERIFIED`; no status inference is safe.

## Important non-blocking product decisions

- Initial membership roles, invitation/owner-transfer policy, and timing of employee/accountant portals.
- Supported schedule expansion and pay-date/timezone rules after launch scope.
- Draft autosave/import/duplicate preview behavior.
- Overpayment collection and returned-payment customer support policy.
- Billing plans, included-run truth, grace/past-due/refund/cancellation policy.
- Support JIT access, customer visibility and dual-control repair policy.
- Observation period length required for zero n8n callers/executions before credential/workflow/code removal.

## Recommended defaults pending approval

Ontario-only explicitly supported cases; unsupported cases block. Use private authenticated document access, Decimal arithmetic, append-only finalized/payment/compliance/audit records, deny-by-default roles, provider-tokenized payout methods, correction by linked delta, direct providers from durable workers, no automatic CRA filing/remittance claim, and `LEGACY_UNVERIFIED` for ambiguous history.

Critical containment can begin before these product/domain decisions because it reduces existing exposure without choosing a payroll formula or migrating schema. Destructive deletion, target DDL/backfill, money movement changes and statutory output remain gated.
