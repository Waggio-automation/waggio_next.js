# Route and UI inventory

No `loading.tsx`, `error.tsx`, route-level `not-found.tsx`, skeleton, or error boundary exists. Most routes are employer-only; no employee, accountant, support, or internal-admin UI exists.

## Page routes

| Route | Intended user / purpose | Current state | UX issues and missing states | Backend dependency | Action |
| --- | --- | --- | --- | --- | --- |
| `/` | Employer dashboard | Auth-required summary/actions | Not public; triggers expensive CRA sync/PDF generation on view; no loading/error boundary; “Create Paystub” misstates workflow | Prisma, CRA/Puppeteer | Make dashboard read-only/fast; move sync to jobs; add task-oriented status |
| `/company-settings/access` | Anonymous signup/login | Combined form | No email verification/MFA/consent; back link points to protected settings; errors not announced | Auth APIs | Separate clear login/signup journeys and policy consent |
| `/company-settings/access/forgot-email` | Anonymous account recovery | Company-name lookup | Enables enumeration; masked email disclosure; no neutral success/rate limit | SMTP, Prisma | Replace with support-safe neutral recovery |
| `/company-settings/access/forgot-password` | Anonymous reset request | Email form | Enumerates accounts; no rate feedback | SMTP | Neutral response, throttling, abuse controls |
| `/company-settings/access/reset-password` | Anonymous reset completion | Token form | Token remains in URL; no session revocation or expired-token recovery CTA | Prisma | One-time exchange, revoke sessions, accessible status |
| `/company-settings/verify` | Legacy magic-link relay | Redirect wrapper | Unsafe legacy flow, dead-end invalid screen | Legacy verify API | Disable/remove through controlled compatibility plan |
| `/company-settings` | Owner settings/onboarding/billing/payout readiness | Large mixed page | Plan, billing, environment, employee readiness conflated; server render makes provider calls; no staged onboarding/progress | Stripe, Trolley env, Prisma | Split onboarding, billing, funding, team, company profile |
| `/company-settings/billing/success` | Checkout callback | Server redirect | No visible processing/failure; unsafe tenant/session binding | Stripe | Secure callback then status page |
| `/company-settings/payroll` | Legacy | Redirect | Dead route | None | Keep temporary redirect with telemetry, later retire |
| `/company-settings/payroll/return` | Legacy provider return | Redirect | Provider result hidden | None | Replace with explicit setup-result state if needed |
| `/employees` | Payroll admin directory/create | Table plus long create form | Create and browse compete; no search/filter/import/deactivation; raw enum wording; no confirmation for PII submission | Prisma, Trolley, Stripe | Separate directory and guided employee onboarding |
| `/employees/[id]` | Payroll admin employee profile/payout | Long editable profile | Full bank data redisplayed; no change history, terminate/deactivate, save conflict, or unsaved warning | Prisma, Trolley | Tabbed profile with masking, permissions, audit, lifecycle actions |
| `/payroll` | Payroll admin calculate/run/status | Single dense page | Create action skips review/approval; status conflates paystub and transfer; table is very wide; no prior-run comparison, confirmation, draft save, or recovery center | Calculation, Prisma, Trolley | Wizard: inputs -> validation -> review -> approval -> processing |
| `/cra` | Owner/payroll admin CRA dashboard | Remittance/T4 actions | Viewing mutates/regenerates data; implies “filing” though no filing integration; reminders not sent | CRA/Puppeteer/local FS | Read-only liability dashboard with explicit manual/external steps |
| `/cra/settings` | PRO payroll admin settings | Large settings form | Legal/compliance fields lack contextual help/verification ownership; redirect errors are coarse | Prisma, CRA | Guided validated setup with source/effective dates |
| `/cra/remittances/[id]` | PRO payroll admin liability/payment | Detail/manual payment | “Mark paid” lacks review confirmation/proof upload; duplicate heuristic; no correction/void UX | Prisma | Payment ledger with confirmation, evidence, void/correction |
| `/cra/t4` | PRO payroll admin year-end docs | Generate/list/download | Generation overwrites, no preflight preview/approval/amendment/filing status | Prisma, Puppeteer/local FS | Versioned year-end workflow and legal verification gate |

## Layout/navigation/component findings

- Root metadata and package identity are create-next-app defaults. The declared Geist fonts are overridden by `body { font-family: Arial }`.
- `AuthenticatedTopBar` and `WorkspaceNav` provide basic navigation, but information architecture is feature-centric rather than lifecycle/task-centric.
- `WorkspaceNav` calls the workflow “Create Paystub” although it also calculates and schedules money movement.
- Tailwind classes repeat card/input/button patterns rather than shared primitives. Radius (`rounded-3xl`) and gray palette are consistent enough to preserve as a visual direction.
- The root dark-mode media query changes body colors while components remain hard-coded white/gray; this can produce inconsistent contrast.
- Tables generally use horizontal scrolling, but payroll requires roughly 980px and is not task-efficient on mobile. A card/step flow is needed for critical mobile review.
- Many controls have hover/focus styles, but focus-visible is inconsistent; form errors/success messages generally lack `role=alert`, `aria-live`, field-level linkage, and summary focus.
- Status is often encoded by color plus text (better than color alone), but provider/system status ownership is not explained.
- Long-running server actions have limited progress feedback, cancellation, retry, or safe refresh behavior.

## API surface affecting UX

| API family | UX dependency | Current issue |
| --- | --- | --- |
| `/api/auth/*` | Access/recovery | Enumeration, no rate limit/MFA/verification; inconsistent error disclosure |
| `/api/company/*` | Setup/readiness | Legacy takeover route; readiness is environment presence, not verified funding/KYB |
| `/api/employees*` | Employee create/payout | API create stores plaintext SIN; provider errors exposed too directly |
| `/api/payroll/run` | Payroll creation | Ignores idempotency, no approval/finalize confirmation |
| `/api/payroll/runs*`, `/api/payhistory` | Legacy run/status integration retained for authenticated users | Historical global shared-secret access was removed on 2026-07-17. Routes now enforce OWNER/ADMIN tenant scope and allowlisted DTOs; duplicate lifecycle debt remains. |
| `/api/payroll/send-due`, cron | Transfer start/retry | No claim/lock; retry safety unknown |
| `/api/payslip/pdf` | Paystub PDF | Unauthenticated arbitrary HTML/public result |
| `/api/documents/[id]` | CRA downloads | Correct tenant check, but source file may be gone on serverless instance |
| `/api/stripe/webhook` | Billing state | Signature verified; no event ledger/dedup |

## Critical workflow UX requirements

All payroll, payout retry, remittance-payment, year-end generation, plan charge, and destructive lifecycle actions need: explicit scope and totals; blocking errors vs warnings; “who/when/what changes”; a review screen; a typed or deliberate confirmation for irreversible money/tax actions; idempotent processing state; refresh-safe outcome; accessible failure summary; support/reference ID; and mobile layouts that never hide totals or confirmation context behind horizontal scrolling.
