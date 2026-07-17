# Waggio Improvement Roadmap

> Payroll management SaaS for Canada (Ontario)
> Core value: **one click on "Create Paystub" → paystub PDF auto-generated + auto-delivered to the employee + payment auto-sent**
>
> Premise: **n8n fully removed; everything automated in code.**

This document consolidates the full system audit, schema review, n8n usage investigation, and target architecture into one finalized roadmap. It is written against the actual codebase; items marked ✅ were verified directly in code.

---

## Current State

**Implemented foundation**: sign-up/login / company & employee management / partial Ontario payroll calculation / Trolley payouts / Stripe billing / CRA remittance summary / partial T4 file generation.

**Not yet complete end-to-end**: structured company onboarding, payroll review/approve/finalize, safe auto-payout & reconciliation, paystub generation/delivery/history, off-cycle/void/reversal, the full CRA remittance flow, accurate & safe T4/year-end, roles & permissions, employee self-service, ops & customer support, and complete UI/UX state handling.

**Actual structure of the core automation** (verified in code): `Create Paystub` (hours-table.tsx) → `/api/payroll/run` performs ① record creation ② n8n webhook dispatch ③ Trolley payout. **PDF generation and email delivery do not exist in Waggio's code — they are handled by an external n8n workflow.** Removing n8n breaks these two, so they must be re-implemented in code.

**Biggest structural gap**: the current flow has no **Review → Approve → Finalize** stage. Creating a run goes straight to payout/delivery. For a service that moves money, the absence of this approval gate is the core difference from industry standard.

---

## Stage 1 — Critical Security (immediate)

### Authentication & access control
1. ✅ **Remove admin magic-link API** — `api/company/admin-link/route.ts`: returns a magic link without auth, and creates a company from an arbitrary email if none exists. Legacy single-tenant code; delete it.
2. ✅ **Add auth to the PDF generation endpoint** — `api/payslip/pdf/route.ts`: no auth + renders arbitrary HTML (SSRF) + no `payHistoryId` ownership check.
3. ✅ **Block public Blob paystubs** — `payslip_<id>.pdf` + `access: "public"` lets anyone enumerate IDs and read others' paystubs. Move to private storage + authenticated proxy/signed URL.
4. ✅ **Remove n8n bypass endpoints immediately** — the `x-n8n-secret` bypass in `api/payhistory/route.ts` GET/PATCH (exposes all companies' employees + bank accounts), the same bypass in `payroll/runs` and `runs/[id]`, the webhook dispatch in `api/payroll/run/route.ts` (including the N8N_TEST_WEBHOOK_URL prod bug), the employee-creation webhook at `employees/actions.ts:153`, plus all `N8N_*` env vars and secret revocation. ⚠️ Fill the PDF/email gap with re-implementation, then deploy together.
5. ✅ **Stop leaking error messages** — several routes return `error.message` verbatim. In production return a generic message and log server-side.

### Personal data
6. ✅ **Fix the T4 SIN ciphertext bug** — SIN is stored via `encryptSin()` but `decryptSin()` is never called anywhere, so `t4-filing.ts:156` emits ciphertext where the SIN should be in the T4 XML/PDF (current T4 output is invalid). Clean up plaintext/ciphertext mix; prevent SIN exposure in APIs/logs/errors.
7. ✅ **Eliminate plaintext bank details** — `institutionNumber`/`transitBranchNumber`/`accountNumber` stored in plaintext. Short term: encrypt. Long term: provider token + masked value only.
8. ✅ **Harden encryption** — `crypto.ts`: AES-256-CBC → AES-256-GCM (integrity check). `ENCRYPTION_KEY!` crashes at module load → lazy-load + explicit error.

### Payout & tax safeguards
9. ✅ **Payroll run idempotency** — `api/payroll/run/route.ts` double-click/retry causes double record creation & double payout. Start with a company+period unique constraint.
10. **Exclude non-finalized payroll from remittance/T4** — "paid" is currently treated as "finalized." Quarantine ambiguous legacy records rather than auto-classifying.

### Small fixes
11. ✅ **Misuse of `redirect()` in API routes** — a fetch API gets a 307. Split out a `requireCompanyAdminOrThrow` helper returning 401 JSON.

---

## Stage 2 — Code Automation Foundation (moving the old n8n role into code)

12. **PostgreSQL Job table + authenticated worker** — enqueue post-finalization work (PDF, email, payout) as jobs and consume them. Includes retries, backoff, failure state.
13. **Outbox pattern** — record events inside the transaction; a separate process publishes them. Eliminates "saved to DB but post-processing never ran."
14. **Inbox / ProviderEvent (append-only)** — store Trolley/Stripe webhooks as immutable events, then process. Safe against duplicates, reordering, replays.
15. **Idempotency records** — an idempotency key per external call (payout, email) prevents duplicate execution.
16. **Redefine cron's role** — dispatch jobs + reconciliation only, not direct execution. ✅ Current once-daily (13:00 UTC) single-shot with no failure alerting → absorbed into the job model.
17. **Clean up direct Trolley/Stripe/Email integrations** — route them through the infrastructure above (job/outbox/idempotency).
18. **Railway = HTML→PDF conversion only** — auth required, payload/timeout/resource limits. All other automation lives in Next.js + worker + cron.

---

## Stage 3 — Auth, Permissions, Tenancy, Personal Data

19. ✅ Rate limiting / account lockout on login & password reset.
20. ✅ Stronger password policy (currently only "≥ 8 chars").
21. ✅ Make sessions revocable — stateless HMAC cookie stays valid for 7 days even after change/leak. Server-side session/token version + rotate on login.
22. 2FA — for admin accounts that move money.
23. Tidy up the email verification flow.
24. Role model — Owner / Admin / Payroll Admin / Accountant + team invites + accountant access.
25. Enforce tenant isolation on every query/mutation — unify via a shared data-access helper that injects companyId.
26. Audit logging for admin/support access — review and expand the actual coverage of `AuditLog`.
27. Structured company onboarding — company info → CRA payroll account → frequency/schedule → Trolley KYB/KYC → funding, with progress + resume.
28. Personal-data operations — consistent SIN encryption (migration), masking, deactivate/terminate instead of deleting employees, retention policy, a data-request intake.

---

## Stage 4 — New Schema (additive migration)

### Known problems with the existing schema
29. ✅ `Employee.companyId` nullable + `onDelete: SetNull` — deleting a company orphans records containing SIN & bank info. Make it NOT NULL + Restrict.
30. Fix relations where cascade delete could lose past payroll/tax records — finalized records must be non-deletable.
31. PayHistory mixes calculation/payout/PDF/email state → separate them.
32. No immutable snapshot at payroll time (employee address, TD1, tax rates).
33. EHT/WSIB modeled as employee deductions → move to employer contributions.
34. ✅ TD1 defaults hardcoded in schema (16452/12989) → move to year-versioned constants.

### Models to add
35. `PayrollRun`: Draft → Calculated → Review → Approved → Finalized.
36. immutable `PayrollResult` + Earning/Deduction/EmployerContribution lines.
37. Payout: `PaymentRun` / `PaymentInstruction` / `PaymentAttempt` + append-only `ProviderEvent`.
38. Statements: `PayStatement` / `StatementArtifact` / `StatementGenerationAttempt` / `StatementDelivery`.
39. Infrastructure: Job / Outbox / Inbox / Idempotency / AuditEvent (formalizing the Stage 2 infra).
40. remittance allocation, year-end source package, effective-dated employee profile, explicit companyId on every table.

### Data migration
41. inventory → verify backup/restore → classify legacy (quarantine records with unclear finalized/paid state) → backfill → reconcile counts/totals → verify tenant ownership → switch reads/writes → drop old models.

---

## Stage 5 — Payroll Calculation, Review, Approve, Finalize

### Calculation engine (✅ verified in calculatePayroll.ts)
42. CPP2 — mandatory since 2024, not implemented.
43. YTD accumulation — prevent over-deduction after annual maximums, prorate mid-year hires, handle boundaries.
44. Bonus tax method (TB) — `bonus` field exists but everything is treated as periodic pay.
45. Real EHT/WSIB calculation (currently hardcoded 0) — as employer contributions.
46. Ontario ESA — auto-check weekly overtime over 44h, auto 6% vacation for 5+ years of service (via `hireDate`), correct stat holiday pay formula (prior 4-week average + 1.5× premium when worked).
47. ✅ float → decimal — DB uses Decimal but calculation uses JS Number. Include a consistent rounding standard.
48. ✅ Tax-year versioning — single `cra-constants-2026.ts` → select year-versioned constants by payDate.
49. Establish contractor rules — resolve the conflict between applying payroll deductions and excluding from T4.
50. Partial pay period, explicit warnings for unsupported cases, move date validation to the server.
51. ✅ Calculation-engine tests — currently zero. Golden tests against CRA PDOC first, plus idempotency & tenant-isolation tests.

### Workflow
52. ✅ `run/route.ts` transaction improvement — per-employee N+1 loop risks the 5s timeout → batch fetch + `createMany`.
53. Review→Approve→Finalize: block edits after finalize, prevent double finalize, compare to prior payroll, CSV import, errors/warnings, correction/reversal basics, audit trail. Post-finalization work is published via the Stage 2 job/outbox.
54. Ship UI alongside: input → errors/warnings → breakdown → review → approval confirmation → finalized.

---

## Stage 6 — Auto-payout & Reconciliation

55. Check funding readiness → create `PaymentRun` → per-employee `PaymentInstruction` → atomic claim + idempotency.
56. Trolley webhook signature verification + Inbox processing (safe against duplicates/delay/reordering).
57. Distinguish PAID / FAILED / RETURNED + per-state actions (retry conditions, manual recovery).
58. Partial-success handling (a run where only some employees paid out).
59. Waggio ↔ Trolley reconciliation (cron-dispatched reconcile job), expected deposit dates, status UI & notifications.

---

## Stage 7 — Paystub Generation & Delivery

60. Fetch data & build HTML in Next.js → authenticated Railway PDF conversion → private storage.
61. Access only for authorized users (authenticated proxy/signed URL).
62. Separate jobs, records, and retries for PDF generation vs email delivery.
63. Per-employee paystub history, mobile download, accessibility.

---

## Stage 8 — Payroll History, Corrections, Voids

64. Company/employee history, search/filter, payroll register.
65. Display calculation/payout/paystub state separately.
66. adjustment / reversal / off-cycle payroll, link original↔correction, CSV/PDF export.

---

## Stage 9 — CRA Remittance

67. Define scope first: calculation only / due-date tracking / payment-package generation / actual remittance integration.
68. Use only finalized PayrollResult; separate employee deductions from employer contributions.
69. Due dates by remitter type (check accelerated-remitter monthly misapplication), liabilities, per-payroll allocation, payment status, corrections, history, guidance UI.

---

## Stage 10 — T4 & Year-End

70. ✅ Safe SIN decryption + masking (the completion of Stage 1 #6).
71. Use finalized snapshots only, consistent contractor-exclusion rules, T4 box mapping, T4 Summary, amended/cancelled slips.
72. CRA files in private storage (no lingering temp-filesystem copies), historical document access.
73. Separate "report generation" from "actual CRA e-filing" — filing only after approval & confirmed technical spec.

---

## Stage 11 — Billing & Operations

74. Wire Stripe subscription ↔ actual feature entitlements, payment failure/retry, plan change/cancel, invoices.
75. Internal ops dashboard — inspect failed jobs & manual recovery, support-access logging, data requests, audit-log viewing.
76. Monitoring/alerting/incident-investigation.

---

## Stage 12 — Full UI/UX & Deployment

77. Connect the whole journey: signup→onboarding→employee setup→payroll input→calculation→review/finalize→funding→payout→paystub→history→remittance→T4.
78. Design system, consistent terminology, all empty/loading/error/recovery/success states, mobile, keyboard, screen reader, color contrast, financial-action confirmation steps.
79. Public pages: product, pricing, security, trust.
80. Deployment: env cleanup (confirm `N8N_*` fully removed), private storage, worker, cron, provider webhooks, migration verification, backup/restore/rollback, production build.
81. ✅ Replace the README template + write `CLAUDE.md`.

---

## AI Track — Agent Layer (from 7/24, after Stage 1 security is done)

Add an AI agent layer on top of Waggio to build the experience of "owning, through to production, LLM agents that plan and act over tools/APIs on sensitive enterprise data, with reliability, observability, safety, and auditability."

- **AI-0** Split out a Python FastAPI agent service — production-grade Python, custom FastAPI tool foundation.
- **AI-1** Payroll Copilot (flagship) — plan-and-act multi-tool agent, Plan-and-Execute/ReAct, human-in-the-loop approval.
- **AI-2** CRA/ESA compliance RAG — pgvector, enforced citations, naive→improved debugging narrative.
- **AI-3** Payroll anomaly review agent — statistical rules + LLM explanation, assists the approval gate.
- **AI-4** Evaluation framework ⭐ — golden dataset, accuracy/safety/latency, CI regression.
- **AI-5** Observability & audit trace — execution traces, retries, error alerts.
- **AI-6** Guardrails & PII/PIPEDA — masking, blocking unapproved actions, prompt-injection defense.
- **AI-7** Case-study writeup — end-to-end narrative, architecture diagram, metric summary.

---

## Execution Order (summary)

1. Commit the design doc (this document — Stage 0)
2. Critical security (Stage 1)
3. Code automation foundation (Stage 2)
4. Auth, permissions, tenancy, personal data (Stage 3)
5. New schema + data migration (Stage 4)
6. Payroll calculation, review, approve, finalize (Stage 5)
7. Auto-payout & reconciliation (Stage 6)
8. Paystub · Railway · email (Stage 7)
9. Payroll history, corrections, voids (Stage 8)
10. CRA remittance (Stage 9)
11. T4 & year-end (Stage 10)
12. Billing & operations (Stage 11)
13. Full UI/UX & deployment prep (Stage 12)

The AI Track runs in parallel with Stage 2 onward, after Stage 1 completes.
