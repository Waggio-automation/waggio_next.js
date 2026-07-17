# Repository overview

## Audit baseline

This audit covers commit `75ec1e96e809d3274c55f3ba5a0993590043300e` and the working-tree design documents through 2026-07-16. No deployed environment, provider dashboard, production database, or secret value was intentionally inspected. No applicable `AGENTS.md`, seed file, CI workflow, environment example, or Railway project was found. The later-supplied draft `docs/proposals/payroll-schema-redesign.md` has now been reconciled in `docs/planning/schema-reconciliation.md`; `docs/planning/final-design.md` is canonical.

## What the application currently is

Waggio is one Next.js 15 App Router application with React 18, Prisma/PostgreSQL, server actions, route handlers, and Tailwind 4. It provides employer workspace authentication, company/plan settings, employee records, a limited Ontario payroll calculator, scheduled Trolley payout submission, Stripe subscriptions, CRA remittance summaries, T4 package generation, and document downloads. “Paystub generation and delivery” is not end-to-end in this tree: an open proxy calls an external PDF service and legacy n8n endpoints can patch PDF/email status, but the primary payroll path does not invoke either.

## Repository map

| Area | Location | Responsibility |
| --- | --- | --- |
| Pages/layouts | `src/app/**/page.tsx`, `layout.tsx` | Employer UI and route protection |
| API | `src/app/api/**/route.ts` | Auth, employees, payroll, PDF, Stripe, cron, documents |
| Server actions | `src/app/**/actions.ts` | Employee, company billing, CRA mutations |
| Domain/integrations | `src/lib` | Auth, calculation, Trolley, Stripe, CRA/T4, SMTP, encryption |
| Database | `src/prisma/schema.prisma` | 15 models and 17 enums |
| Migrations | `src/prisma/migrations` | 36 migration directories from 2025-09 to 2026-05 |
| Tests | `src/tests` | 10 assertions across two files |
| Deployment | `vercel.json` | One daily payroll-send cron |

There is no workspace/monorepo configuration. `README.md` and root metadata are create-next-app defaults. The package is still named `my-app`; page metadata says “Create Next App.”

## Runtime and data flow

```text
Employer browser
  -> Next.js pages/server actions/API (Vercel)
     -> PostgreSQL via Prisma
     -> Trolley REST API
     -> Stripe API/webhooks
     -> SMTP (auth email only)
     -> legacy n8n webhooks/shared-secret APIs (approved for replacement/retirement)
     -> Railway-like PDF endpoint -> public Vercel Blob
     -> local Chromium + local filesystem for CRA/T4 artifacts

Vercel cron -> Next.js cron route -> Trolley submission
```

The browser and server share `calculatePayrollAmounts`, but persistence uses a JavaScript-number result. Long-running PDF/T4 work and external calls run synchronously in web requests. No queue, worker, outbox, provider-event store, or reconciliation process exists.

## Database summary

- Identity/tenant: `Company`, `CompanyUser`, `CompanySettings`, `CompanyPayrollSettings`.
- Workforce: `Employee`.
- Payroll/payment: `PayrollRun`, `PayHistory`.
- CRA: `Remittance`, `RemittancePayHistory`, `RemittancePayment`, `T4Slip`, `T4Summary`, `ReminderEvent`, `Document`, `AuditLog`.
- Billing metadata is embedded in `Company` and `PayrollRun`; Trolley metadata is embedded in `Company`, `CompanySettings`, `Employee`, `PayrollRun`, and `PayHistory`.

Several historical relationships are destructive: employee deletion cascades payroll and T4 data; company deletion cascades compliance artifacts and audit logs. Tenant IDs on Employee/PayrollRun are nullable, and PayHistory has only indirect tenant ownership.

## Current verification result

- `npm test`: 10/10 passing; only CRA settings validation and unused status mapping are covered.
- `npm run lint`: passing.
- `npx prisma validate --schema src/prisma/schema.prisma`: blocked because `DIRECT_URL` is required but unavailable in the inspected environment. Prisma also warns that the `package.json#prisma` configuration is deprecated for Prisma 7.
- No build, browser, integration, migration-rehearsal, accessibility, performance, provider sandbox, backup-restore, or disaster-recovery evidence exists.

Passing lint and these tests do not substantiate payroll correctness, tenant isolation, transfer safety, paystub delivery, CRA accuracy, or production readiness.
