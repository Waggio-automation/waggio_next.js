# Current system audit

## Audit basis and limits

- Repository: Waggio Next.js application at commit `75ec1e96e809d3274c55f3ba5a0993590043300e` (`2026-07-06`).
- Audit date: 2026-07-15.
- Scope: checked-in source, Prisma schema and every migration, manifests, current branches/file listings, tests, and deployment configuration. No database data, deployed services, provider dashboards, or secrets were inspected.
- No `AGENTS.md` applies to this repository. `README.md` is unchanged create-next-app boilerplate and does not document Waggio.
- The initial audit did not include the proposal. The complete draft is now available at `docs/proposals/payroll-schema-redesign.md` and was reconciled on 2026-07-16. See `schema-reconciliation.md`; `final-design.md` controls where the draft and earlier planning differ.
- Evidence labels: **Observed** means present in current code; **Inference** means a conclusion from that code; **Unverified** requires deployed-state or authoritative payroll/legal evidence.

## Executive assessment

The application is a single Next.js 15 App Router deployment backed by PostgreSQL/Prisma. It combines UI, session authentication, payroll calculation, Trolley submission, Stripe billing, CRA reports/T4 generation, SMTP account email, scheduled dispatch, and file serving in one process. Vercel is the only checked-in deployment target. A separate Railway PDF service is called but is not present or configured in this repository.

The system is not production-safe for payroll in its current state. Tenant scoping is used in many interactive queries, but legacy unauthenticated endpoints, global integration credentials, nullable tenant keys, and missing cross-model tenant constraints undermine the boundary. Payroll records are neither complete immutable snapshots nor safely preservable: employee deletion cascades into `PayHistory`, company deletion cascades into compliance records and audit logs, and historical report artifacts are deleted and recreated. Calculation limitations documented in the code are material (no YTD CPP/EI max handling, no CPP2, no bonus method, no high-income BPA phase-out), while downstream remittance and T4 jobs include every pay-history row regardless of finalization/payment state.

## Critical findings

| ID | Finding | Evidence | Consequence |
| --- | --- | --- | --- |
| C-01 | An unauthenticated legacy endpoint generates a usable admin magic link and returns it in the response. It selects the first company and requires only its admin email. | `src/app/api/company/admin-link/route.ts`; `src/app/api/company/verify/route.ts` | Account takeover of the primary workspace if the email is known or discovered. The endpoint is unsafe to expose. |
| C-02 | `/api/payslip/pdf` is unauthenticated and accepts caller-supplied HTML and a caller-supplied numeric ID, forwards it to the PDF service, and uploads the result to a public blob under a predictable name. | `src/app/api/payslip/pdf/route.ts` | Unauthorized resource consumption, arbitrary HTML rendering, possible Railway-side SSRF/local-file access, overwrites/collisions, and public payroll document exposure. |
| C-03 | SIN handling is inconsistent. The server action encrypts SIN with AES-CBC, the employee API spreads validated plaintext directly into the database, and T4 generation reads `Employee.sin` without decrypting it. | `src/app/employees/actions.ts`; `src/app/api/employees/route.ts`; `src/lib/crypto.ts`; `src/lib/cra.ts` | Mixed plaintext/ciphertext PII, invalid T4 output, no reliable query/migration semantics, and weak unauthenticated-integrity encryption. |
| C-04 | Payroll and statutory history can be deleted by deleting operational parent records. `Employee -> PayHistory` and Company compliance relationships use cascades; employee/company tenant ownership is nullable in key places. | `src/prisma/schema.prisma`; migrations | Loss of payroll, T4, remittance, document, and audit evidence. This violates preservation and auditability expectations. |
| C-05 | Trolley payout submission has no atomic claim/lock, durable provider event store, webhook receiver, or reconciliation job. Provider calls occur before the local provider reference/status transaction. | `src/lib/payments/trolley-payroll.ts`; no Trolley webhook route exists | Concurrent cron/manual requests or a crash between provider and database operations can duplicate, orphan, or misreport money movement. Runs can remain `PAYING` indefinitely. |
| C-06 | Remittance and T4 generation include all company `PayHistory` rows, without requiring an approved/finalized/paid record, and T4 generation can overwrite previously generated values. | `src/lib/cra.ts` (`syncRemittancesForCompany`, `generateT4Package`) | Draft, duplicate, failed, or unpaid payroll can enter statutory totals and year-end slips. Regeneration can rewrite history. |

## High-risk findings

| ID | Finding | Consequence |
| --- | --- | --- |
| H-01 | The browser sends an `Idempotency-Key` when creating a payroll run, but the server ignores it and the schema has no equivalent uniqueness constraint. | Double-clicks, retries, and network replay can create duplicate runs and duplicate employee liabilities. |
| H-02 | `PayHistoryStatus` mixes calculation, PDF, email, and payment states; `PayrollRunStatus` mixes calculation and money movement. Mutating APIs validate membership, not allowed transitions. | Impossible states and overwrites are accepted; ownership of state is unclear. |
| H-03 | `PayHistory` is an incomplete snapshot. It lacks rate/pay-type/TD1/vacation/overtime/holiday/formula-version/employer-liability snapshots. | A stored amount cannot be independently explained or reproduced after employee/config/code changes. |
| H-04 | Bank coordinates are stored in plaintext and returned by payroll-run integration endpoints. One shared `N8N_SECRET` grants unscoped access across all tenants. | Excess PII exposure and a large blast radius for one credential. |
| H-05 | The calculation converts Prisma decimals to JavaScript numbers and rounds with binary floating point. Money columns are `DECIMAL(65,30)` without domain precision constraints. | Rounding drift and inconsistent reproducibility for payroll/tax values. |
| H-06 | The calculation explicitly omits YTD CPP/EI max-out, CPP2, bonus/commission rules, and high-income BPA phase-out. It does not use employment type, so contractors receive employee deductions. | Materially incorrect payroll for supported-looking cases. |
| H-07 | `ded_eht` and `ded_wsib` are subtracted from employee net pay, although current code sets both to zero. | If populated, employer levies may incorrectly reduce employee pay. Classification requires authoritative Ontario verification before implementation. |
| H-08 | CRA accelerated-remitter due dates deliberately fall back to monthly logic. Reminder records are created but no sender/job consumes them. | Incorrect deadlines for configured accelerated remitters and misleading UI readiness. |
| H-09 | CRA/T4 files are written under the application working directory. Vercel server filesystems are not a durable document store, and generated documents are deleted/recreated. | Missing documents after instance turnover and destroyed artifact history. |
| H-10 | The Stripe success page trusts a caller-provided Checkout Session ID and writes its subscription into the authenticated company without verifying session metadata/customer ownership. Stripe webhook events are not durably deduplicated. | Cross-company subscription association and replay/operational ambiguity. |
| H-11 | Authentication has no rate limiting, MFA, session revocation, or role enforcement. Password-reset and company lookup reveal whether accounts exist. `OWNER` and `ADMIN` are treated identically. | Brute force, enumeration, stale sessions, and excessive privilege. |
| H-12 | A finalized state does not exist and no database guard prevents financial fields from being updated/deleted after review. | Payroll evidence is mutable and approvals cannot be demonstrated. |

## Architecture and runtime boundaries

| Boundary | Current implementation | Assessment |
| --- | --- | --- |
| Web/UI | React 18 and Next.js App Router server/client components | Single deployable; authenticated layouts protect major screens. |
| API/actions | Next route handlers and server actions | Business logic is spread between routes, actions, and large library modules; several duplicate payroll entry points remain. |
| Database | PostgreSQL through Prisma singleton | No repository layer or enforced tenant context; callers must remember `companyId`. |
| Authentication | Seven-day HMAC-signed stateless cookie; scrypt password hashes | Basic integrity is present, but no revocation/session table/MFA/rate limiting/RBAC. |
| Payroll engine | `calculatePayrollAmounts` plus hard-coded 2026 constants | Pure function, but materially incomplete and untested. |
| Payout | Direct signed Trolley REST calls | Submission exists; funding semantics, webhook verification, reconciliation, and recovery are absent. |
| Paystub PDF | Next route -> external `${PDF_SERVER_URL}/pdf` -> Vercel Blob | Railway source/config is absent; endpoint and storage access are unsafe. |
| CRA/T4 PDF | In-process Puppeteer -> local `generated/cra` | Not durable for serverless production and performs long synchronous work in a request. |
| Email | Nodemailer SMTP | Only login reminder and password reset exist in this repository. There is no paystub email sender. |
| Billing | Stripe SDK, Checkout, portal, webhook, invoice items | Partially implemented; no event ledger/deduplication and race-prone extra-run metering. |
| Jobs | Vercel daily GET cron at 13:00 UTC | Authenticated with `CRON_SECRET`, but no distributed claim/lock or retry queue. |
| n8n | Outbound employee/payroll webhooks and shared-secret global read/update APIs | Removal is approved. Current occurrences remain unsafe and must be replaced/retired under `../audit/n8n-usage-audit.md`; external caller ownership is still unknown. |

## Current data model and preservation

`Company` owns users, settings, employees, payroll runs, remittances, CRA documents, T4s, reminders, and audit logs. `Employee` optionally belongs to a company. `PayHistory` belongs to an employee and optionally to `PayrollRun`; it has no direct `companyId`. `PayrollRun` optionally belongs to a company. This permits orphaned rows and forces tenant authorization through joins.

The name `PayHistory` hides three roles: calculated employee payroll result, pay-statement metadata, and payment/delivery status. It stores gross/net and five deduction amounts but not the inputs and rules needed to explain them. `PayrollRun.meta` stores unvalidated operational values such as employee IDs and dates, which are not referentially enforceable.

Preservation is especially weak:

- deleting an employee cascades to `PayHistory` and T4 slips;
- deleting a company cascades to users, payroll settings, remittances, T4s, documents, and audit logs;
- deleting pay history cascades remittance allocations;
- deleting a remittance cascades its payments, documents, allocations, and reminders;
- regeneration deletes prior documents rather than superseding them;
- historical migrations have intentionally dropped paystub snapshot columns and recreated a status column, with explicit data-loss warnings.

## Current payroll lifecycle

1. An authenticated owner/admin enters period dates, pay date, delivery date, hours, overtime, holiday hours, and vacation inclusion in `hours-table.tsx`.
2. Client and server both call the same calculation function, but only shallow server validation is applied; negative values and invalid date relationships are accepted by the API.
3. `/api/payroll/run` creates `PayrollRun(SCHEDULED)` and one `PayHistory` per employee in one database transaction. It then immediately sets the run to `PROCESSED`; positive-net rows become `READY`.
4. Outside the transaction, an optional n8n event is sent. If `sendAt` is already due, the request directly submits the run to Trolley.
5. Otherwise the Vercel cron or a manual/retry route finds `PROCESSED` due runs and submits them.
6. Trolley batch and payments are created, batch processing starts, and only then a database transaction records `providerRef`, run `PAYING`, and line `SENDING`.
7. No current code receives Trolley webhooks or polls/reconciles provider status. No code sets new-flow runs to `PAID`, lines to paid, or `paidAt`.

There are two additional legacy/duplicate creation flows: `POST /api/payhistory` creates standalone rows without a run, and `POST /api/payroll/update-status` can create a run without calculation rows and hand it to n8n. These can generate records that do not follow the primary lifecycle.

## Paystub generation and delivery

The UI says “Create Paystub & Save,” but the primary route only creates calculation rows and schedules Trolley payment. The repository contains no server-side template invocation from that flow and no paystub email sender. Legacy n8n-compatible endpoints can read payroll rows and patch `pdfUrl`/email fields, so actual delivery may exist through an **unknown external caller**. The target replaces it with direct statement-generation and delivery workers; n8n removal is approved but code retirement waits for the replacement and zero-caller evidence.

PDF metadata is only a URL on `PayHistory`; it has no content hash, byte size, template/calculation version, storage key, generation attempt, retention class, or supersession link. Blob access is explicitly public. Two sample paystubs are tracked under `src/public/payslips`; other local paystub files are ignored.

## Trolley funding, payment, webhook, and reconciliation

The current code creates recipients/accounts, a provider batch, and one payment per pay-history row. Tenant-specific external IDs and tags are a positive design choice. Per-payment external IDs allow a narrow duplicate recovery path. However:

- “funding” is only a local status name; no explicit funding transaction or funds-confirmation implementation exists;
- batch creation is not safely reused after a duplicate external-ID response;
- no local attempt records are written before provider calls;
- no webhook route or signature verification exists in the checked-out tree;
- `TROLLEY_EVENT_STATUS_MAP` is tested but unused;
- no raw events, event IDs, deduplication, replay, polling, returns, reversals, or reconciliation records exist;
- retry accepts any `FAILED` run with a failure type and cannot distinguish safe retry from “provider may already have accepted it”;
- all run-level failures found by due-send loops are labeled `FUNDING`, even if the failure was employee setup or an internal/database fault.

## Remittance and billing

Remittance synchronization is user/request driven. It groups every pay-history row by local-calendar pay date, computes employer CPP as employee CPP and employer EI as 1.4 times employee EI, upserts a mutable remittance, replaces allocations, generates a PDF, replaces its document row, and replaces reminder events. Actual CRA payment is out of app; users record payments manually. Duplicate prevention is an application lookup by date/amount, not a uniqueness constraint or idempotency key.

Stripe covers subscription checkout, plan changes, seat count changes, portal access, webhook status updates, and extra-run invoice items. The extra-run charge is assessed only after Trolley processing starts. Run sequence is calculated from current `PAYING/PAID` rows without a lock, and the “already evaluated” fields are not protected by a unique usage record. Billing failure does not stop payroll (appropriate), but there is no durable retry workflow.

## Authentication, roles, and tenant isolation

Positive observations:

- the session payload is HMAC-signed and expiration checked;
- the database user is loaded for every authenticated request and its company is matched to the cookie;
- most interactive employee, payroll, CRA, document, and billing queries include the authenticated company;
- Trolley external IDs include company and record IDs.

Material gaps:

- the legacy magic-link endpoint bypasses email possession;
- `CompanyUserRole` is never enforced, so `ADMIN` has owner-equivalent powers;
- global unique user email prevents a person from belonging to multiple companies and is not a membership model;
- N8N authorization is a single shared secret and deliberately removes company scoping;
- nullable `companyId`, indirect tenant keys, and lack of composite foreign keys allow inconsistent cross-tenant relationships;
- `getOrCreateCompanySettings` may assign the first orphan settings record to whichever company calls next;
- no centralized tenant-scoped data-access API makes an omitted filter difficult to detect;
- no rate limits, lockout, MFA, device/session management, or security-event audit exists.

## Deployment and operations

- `vercel.json` schedules `/api/cron/payroll-send-due` at `0 13 * * *` (13:00 UTC, 09:00 Toronto during daylight time and 08:00 during standard time).
- There is no checked-in Railway, Docker, worker, database, blob-lifecycle, SMTP, or observability configuration.
- The external PDF service boundary is represented only by `PDF_SERVER_URL` and `PDF_SERVER_SECRET`.
- `DIRECT_URL` is required by Prisma schema but absent from the inspected environment variable names. `npx prisma validate` therefore fails before schema validation.
- `npm test` passes 10 tests and `npm run lint` passes. This is not evidence that payroll, tenant isolation, PDF, payment, remittance, or billing flows work.
- `.env*`, generated CRA files, and `public/payslips` are ignored. Two sample PDFs under `src/public/payslips` are tracked; their contents were not treated as valid fixtures.

## Production readiness conclusion

No money-moving or statutory-output feature should be represented as production-ready. Before new schema implementation, Waggio should contain the exposed legacy/PDF paths, establish immutable tenant-owned payroll records, and introduce durable/idempotent payment submission plus reconciliation. The first recommended phase is detailed in `phased-implementation-roadmap.md`.
