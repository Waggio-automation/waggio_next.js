# Dependency-ordered implementation roadmap

This roadmap implements `final-design.md`. No phase starts until its blocking decisions and predecessor acceptance criteria are satisfied. Every phase uses flags/canaries, preserves historical evidence, and treats legal/provider claims as unverified until approved.

## 1 — Critical containment

- **Outcome:** immediate account, PII, document and ambiguous-payment exposure is reduced without changing payroll calculations or deleting callers.
- **Scope:** contain unauthenticated admin-link and arbitrary/public PDF; deny or narrowly allowlist global n8n reads/writes; stop unsafe SIN write/display paths and destructive lifecycle actions; prohibit blind Trolley retry; rotate exposed credentials; inventory public blobs/callers; establish redacted correlation and backup/restore.
- **Dependencies:** deployed-route/log access, incident owner, backup authority and provider/environment owners.
- **Acceptance:** unauthorized route/object and cross-tenant negative tests pass; credentials are rotated without being copied to docs/logs; restore rehearsal succeeds; caller inventory exists; no production provider/email side effect is exercised by tests.
- **Rollback/risk:** use reversible gates and a time-limited, least-privilege compatibility allowlist only when a verified live caller would otherwise break. Never restore public/global access.

## 2 — n8n workflow replacement and safe retirement

- **Outcome:** every active/reachable n8n outcome is owned by Waggio and direct providers; hosted workflows and credentials can be safely retired.
- **Scope:** implement N8N-01 through N8N-07 from `../audit/n8n-usage-audit.md` using Next.js commands, PostgreSQL job/outbox/inbox/idempotency/audit records, authenticated workers, approved cron and direct provider adapters. Shadow comparisons must not duplicate side effects.
- **Dependencies:** Phase 1 containment/evidence; deployed n8n workflow/export/execution ownership; minimal durable worker/job foundation aligned to the target.
- **Acceptance:** direct workflows pass tenant/idempotency/retry/audit tests; zero successful legacy calls and zero n8n executions for the approved observation window; schedules disabled; credentials revoked; compatibility monitoring clean. Code/config deletion is a separately reviewed final step.
- **Rollback/risk:** re-enable only the narrow non-global compatibility adapter before credential revocation if an identified caller fails; keep direct job evidence and reconcile duplicate risk. n8n never regains authoritative state.

## 3 — Foundational identity, tenant, retention, and PII changes

- **Outcome:** trustworthy membership/authorization, explicit tenant ownership, preserved history and minimized sensitive data.
- **Scope:** verified identity, memberships/roles, revocable sessions/MFA/throttling/CSRF; tenant policy boundary; audit/idempotency/job/outbox/provider-inbox foundations; delete restrictions/legal holds/retention; encrypted key-versioned SIN; tokenized/masked payout methods.
- **Dependencies:** role/approval/retention/PII/KMS/infrastructure decisions and backup evidence.
- **Acceptance:** full role and cross-tenant matrix passes; same-company constraints have a backfill plan; no new plaintext SIN/raw-bank retention; employee/company lifecycle cannot cascade financial/compliance/audit evidence; support/service access is scoped and audited.
- **Rollback/risk:** canary membership/session migration with audited break-glass; quarantine ambiguous identity/PII records, never normalize destructively.

## 4 — Additive schema migration and legacy-data backfill

- **Outcome:** target structures exist alongside legacy data with deterministic mapping, completeness and reconciliation evidence.
- **Scope:** add all canonical payroll/payment/statement/compliance/billing models and indexes; tenant-batched backfill; provider/artifact inventory; dual-write/shadow-read infrastructure; no rename/drop.
- **Dependencies:** Phase 3 foundations; approved logical names/constraints; production inventory and masked restore; legacy-truth decision process.
- **Acceptance:** each source row maps once or is quarantined; tenant/count/sum/hash/component/provider/artifact reports reconcile; no history is upgraded from `LEGACY_UNVERIFIED` by inference; fresh install and masked upgrade/rollback rehearsal pass.
- **Rollback/risk:** turn off dual write/shadow read and resume from deterministic checkpoints; retain all target and source evidence.

## 5 — Payroll calculation, review, approval, and finalization

- **Outcome:** supported payroll is reproducible, reviewable, approved and immutable before side effects.
- **Scope:** typed inputs, Decimal calculation/rule sets, unsupported blockers, variance/register, approval policy, atomic finalization, exact snapshots and adjustment-ready lineage.
- **Dependencies:** Phases 3-4; approved payroll launch scope, authoritative rules/golden vectors and approver policy.
- **Acceptance:** approved vectors/boundaries/YTD/year transitions pass; duplicate/concurrent commands create one result set; finalization freezes results/lines/source hash/audit/outbox; net and employer cost invariants pass; no payment or statement starts from non-finalized data.
- **Rollback/risk:** shadow legacy calculations and explain differences; disable new target finalization rather than mutating finalized evidence.

## 6 — Payments and reconciliation

- **Outcome:** each finalized employee payment has durable intent, truthful provider state and safe recovery.
- **Scope:** funding projection, `PaymentRun`/instruction/attempt, worker lease, deterministic external ID, Trolley direct adapter, verified event inbox, polling reconciliation, failed/returned/replacement flows.
- **Dependencies:** Phase 5 finalization/outbox; Trolley operating/event semantics, funding/KYB readiness and sandbox/reconciliation capability.
- **Acceptance:** one instruction produces at most one intended provider payment; all accepted payments reconcile; duplicate/out-of-order events and crash windows pass; ambiguous outcomes disable retry; partial/failed/returned status remains employee-specific and auditable.
- **Rollback/risk:** stop new dispatch while continuing event intake/reconciliation. External money movement is never database-rolled back.

## 7 — Private paystub generation and delivery

- **Outcome:** accurate versioned private statements are generated and delivered independently of payment truth.
- **Scope:** server-owned template, statement/generation jobs, tightly constrained Railway converter, private artifacts/checksums/supersession, email provider delivery attempts, authorized employer/employee access as approved.
- **Dependencies:** Phase 5 finalized results; private object store/email provider; statement legal fields and access/delivery decision; Railway security contract.
- **Acceptance:** browser/arbitrary HTML is impossible; Railway meets every negative boundary; old versions remain; object access is tenant/private; generation/email failures do not alter payroll/payment; retry cannot duplicate a successful delivery unnoticed.
- **Rollback/risk:** disable workers, retain artifacts/attempts and retry by version; never fall back to public blobs.

## 8 — History, adjustments, and reversals

- **Outcome:** users can trace, search, export and correct payroll without overwriting original facts.
- **Scope:** history/register projections; payroll/payment/statement tabs; audit timeline; async private exports; linked delta/reversal/off-cycle workflow and replacement payments/statements.
- **Dependencies:** Phases 5-7; correction/overpayment policy and authorization/legal approval.
- **Acceptance:** every total traces to immutable lines/rules/actors/provider evidence; projection rebuild reconciles; corrections preserve originals and affect only delta; exports pass privacy/formula-injection/tenant tests.
- **Rollback/risk:** rebuild projections from immutable sources and route to canonical detail if projection drift occurs.

## 9 — Remittance

- **Outcome:** explainable frozen CRA liabilities and truthful manual/external payment records.
- **Scope:** versioned liability/allocation, approved due-date rule sets, exact finalized-result components/adjustments, payment/proof ledger and job-driven reminders.
- **Dependencies:** Phases 5 and 8; approved remitter rules including accelerated types; CRA scope and qualified review.
- **Acceptance:** only eligible finalized results contribute; component allocations sum exactly; unsupported remitter types block; adjustment versions preserve prior liability; UI states Waggio does not remit unless later authorized.
- **Rollback/risk:** show source/target reconciliation and keep legacy records; do not rewrite historical liabilities/payments.

## 10 — T4/year-end

- **Outcome:** reviewed, versioned year-end packages reproduce from frozen sources and support amendments.
- **Scope:** preflight, source-set hash, encrypted SIN access, T4/summary/XML/PDF artifacts, review/finalize/delivery, amendment/cancellation and optional recorded external submission evidence.
- **Dependencies:** Phases 7-9; CRA specification/version, payroll/legal sign-off and approved filing claim.
- **Acceptance:** finalized non-voided result plus adjustment sourcing is exact; official schemas/vectors and prior-year regressions pass; old packages/artifacts remain; `FILED/ACCEPTED` appears only with supported evidence.
- **Rollback/risk:** disable generation for an unapproved tax-year version while preserving last approved artifacts.

## 11 — Billing, support, and operational hardening

- **Outcome:** unique explainable billing and safe observable recovery at production scale.
- **Scope:** entitlements, unique usage and charge attempts, Stripe event projection, invoices/refunds/cancel; job/event/reconciliation consoles; JIT support; alerts/SLOs; backup/PITR/DR; deploy/rollback/incident runbooks.
- **Dependencies:** event/job/audit foundations and approved billing/support policies.
- **Acceptance:** every charge maps to one usage fact; Stripe replay/race/refund tests pass; support cannot silently impersonate/edit; dead letters and reconciliation alert; load/chaos, restore and rollback drills meet approved objectives.
- **Rollback/risk:** operations are read-only by default, privileged commands require reason/elevation/dual control, and kill switches stop new side effects without stopping evidence ingestion.

## 12 — Final UI/UX and release-readiness review

- **Outcome:** the complete target journey is understandable, accessible, mobile-safe and honestly represented before release.
- **Scope:** end-to-end role journeys, terminology/status ownership, design-system consistency, loading/empty/error/partial/recovery states, accessibility and mobile review, content/legal/security/privacy claims, performance, runbooks, training/support and phased-release checklist.
- **Dependencies:** Phases 1-11 feature-complete in staging; acceptance evidence and named business/legal/security owners.
- **Acceptance:** complete owner/payroll/admin/accountant/employee/support journeys approved as in-scope; WCAG 2.2 AA and E2E/mobile/keyboard tests pass; no UI conflates finalized, funded, paid, delivered or remitted; production config/secret/backup/provider/canary/rollback evidence passes; release decision is signed.
- **Rollback/risk:** release remains gated; usability/content defects return to the owning phase. Visual polish cannot waive financial, legal, security or operational gates.

## Readiness conclusion

Phase 1 is ready to begin as a scoped containment design: the critical findings, affected surfaces, required evidence and non-destructive acceptance criteria are known. Execution still requires deployed access/owners and change approval. Phases 2+ are not authorized by this planning document.
