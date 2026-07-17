# n8n usage audit and approved disposition

Audit date: 2026-07-16. The target architecture decision is final: Waggio will not use n8n. This document inventories repository evidence; it does not assert whether an externally hosted workflow is currently enabled. No n8n code, configuration, or workflow was changed during this design phase.

## Classification rules

- **Active**: executable production-path code when its environment variable is configured.
- **Legacy but reachable**: a callable compatibility path that is not part of the preferred product journey.
- **Dead code**: cannot be reached from any route, action, schedule, or import found in this repository.
- **Documentation only**: comment, migration annotation, or design text with no executable effect.
- **Unknown external caller**: caller ownership and deployed use cannot be established from this repository. This is a caller qualification layered onto the executable classification, not evidence of safety.

## Executable inventory and replacement map

| ID | Location / occurrence | Classification | Current data/action | Caller knowledge | Required replacement |
| --- | --- | --- | --- | --- | --- |
| N8N-01 | `src/app/employees/actions.ts` employee-created outbound webhook using `N8N_TEST_WEBHOOK_URL` or `N8N_WEBHOOK_URL` and optional `N8N_WEBHOOK_SECRET` | Active when configured | Sends employee ID/email/pay type/group after create | Unknown external recipient; configured URL is evidence of possible use, not ownership | The employee command remains synchronous in a Next.js server action. Its transaction writes `AuditEvent` and any required `OutboxEvent` such as billing-seat reconciliation or payout-setup work. Authenticated workers call Stripe/Trolley directly. No generic employee event leaves Waggio. |
| N8N-02 | `src/app/api/payroll/run/route.ts` payroll-processed outbound webhook | Active when configured | Sends run ID, dates, employee line IDs and scheduled time after creation | Unknown external recipient | Payroll finalization writes `payroll.finalized` to the PostgreSQL outbox. Separate jobs create payment instructions, statement-generation intents, compliance projections, and billing usage. Workers consume those jobs directly. Draft creation emits no external side effect. |
| N8N-03 | `src/app/api/payroll/update-status/route.ts` schedule-only run creation and outbound webhook, with optional `N8N_API_KEY` | Legacy but reachable | Creates a run without authoritative calculation rows, then asks n8n to process it | Unknown external caller and recipient | Replace with named draft/calculate/approve/finalize commands. Scheduled downstream work is a PostgreSQL job with `scheduledAt`; approved cron only wakes authenticated workers to claim due jobs. Retire the route after caller telemetry reaches zero. |
| N8N-04 | `GET /api/payhistory` shared-secret bypass | Legacy but reachable | A valid global secret removes tenant scoping and returns payroll/employee data | Unknown external caller | Employer queries use authenticated, tenant-scoped Next.js handlers with allowlisted DTOs. Workers query tenant-owned records directly through the domain/data boundary; they do not call a global HTTP read API. |
| N8N-05 | `PATCH /api/payhistory` shared-secret bypass | Legacy but reachable | Globally patches generic status, PDF/email fields, provider reference, payment date, and failure text | Unknown external caller | Remove arbitrary status mutation. Statement generation, artifact completion, delivery attempts, provider events, and payment reconciliation each use authenticated worker commands and their own transition table, idempotency key, attempts, and audit record. |
| N8N-06 | `GET /api/payroll/runs` shared-secret bypass | Legacy but reachable | Removes company filter and returns runs, employee rows, and payout/bank-related data | Unknown external caller | Authenticated employer query with tenant scope and minimal DTO. Payment/statement workers read claimed records directly from PostgreSQL; no bank coordinates appear in payroll DTOs. |
| N8N-07 | `GET /api/payroll/runs/[id]` shared-secret bypass | Legacy but reachable | Removes company filter for a specific run and exposes the same integration payload | Unknown external caller | Same replacement as N8N-06; stable internal job/resource IDs are resolved only inside a tenant-scoped worker transaction. |

No executable occurrence qualifies as proven dead code. Treating a configured or public route as dead without deployed telemetry would be unsafe.

## Environment and documentation inventory

| Occurrence | Classification | Disposition |
| --- | --- | --- |
| `.env` contains active/test n8n URL and credential entries | Active configuration dependency; deployed use unknown | The credential material must be treated as exposed to the local repository workspace and rotated during Critical containment. Do not remove names until replacements are live and callers are zero. Remove `N8N_SECRET`, `N8N_API_KEY`, `N8N_WEBHOOK_URL`, `N8N_TEST_WEBHOOK_URL`, `N8N_PAYROLL_WEBHOOK_URL`, and `N8N_WEBHOOK_SECRET` from every approved environment/configuration surface during retirement. Never copy values into documentation or logs. |
| `src/app/api/employees/route.ts` comment describing n8n as an example external caller | Documentation only | Remove with route documentation cleanup after the replacement contract exists. |
| `src/prisma/migrations/20250924194456_init/migration.sql` n8n-flow annotation | Documentation only, immutable migration history | Do not edit an applied migration. Record the historical context here. |
| `docs/proposals/payroll-schema-redesign.md` n8n-to-Railway diagram | Documentation only, draft input | Superseded by the direct worker design. Preserve the proposal as review evidence. |
| Existing audit/planning references | Documentation only | Updated to describe the approved removal and link to this inventory. |

## Negative findings by requested area

| Area | Repository finding |
| --- | --- |
| UI | No direct n8n URL, SDK, or browser request. Employee and payroll UI invoke server paths that can indirectly emit N8N-01/N8N-02. |
| Scheduled workflows | `vercel.json` calls the authenticated payroll due-send cron directly; no n8n scheduler reference. The cron is still concurrency-unsafe and must become a job dispatcher. |
| Payroll processing | N8N-02/N8N-03 are the only direct references. Authoritative calculation currently remains in Waggio. |
| Paystub generation | No in-repo end-to-end caller. N8N-04/N8N-05 make an external paystub workflow plausible but unverified. |
| Email delivery | No paystub mailer and no direct n8n call in SMTP code. `emailSentAt` and email statuses can be patched through N8N-05, so the external caller remains unknown. |
| Trolley | No n8n reference in Trolley services. Legacy n8n payloads expose fields used around payout setup, but Trolley calls are direct. |
| CRA/remittance | No n8n reference. Target scheduled reminder/compliance work uses PostgreSQL jobs and direct providers. |
| Deployment configuration | No checked-in n8n service, image, workflow, or cron. Environment entries are the only discovered configuration dependency. |

## Approved target replacements

```text
Browser
  -> authenticated Next.js route handler/server action
  -> transaction: domain state + idempotency + audit + outbox/job
  -> authenticated durable worker claims PostgreSQL job with lease
     -> Trolley / Stripe / email provider directly
     -> Railway renderer only for bounded HTML-to-PDF conversion
  <- provider webhook -> verified ProviderEvent inbox -> idempotent processor
Approved cron -> authenticated dispatcher/reconciler -> claims due PostgreSQL jobs
```

Railway is a stateless authenticated HTML-to-PDF converter. It must not access PostgreSQL; retrieve employee or payroll data; receive or infer `companyId`/tenant identity; send email; call Trolley; calculate payroll/tax; upload to or own document storage; or retain input/output. Waggio renders server-owned HTML, validates the returned PDF, and stores it privately.

## Retirement gates

1. Contain global reads/writes immediately without deleting them: rotate credentials, add redacted caller/correlation telemetry, narrow allowlists where emergency compatibility is required, and stop new caller onboarding.
2. Inventory deployed n8n workflows, executions, credentials, schedules, webhook URLs, owners, and data retention outside this repository. Export definitions and logs for controlled audit storage without importing secrets into git.
3. Implement and verify N8N-01 through N8N-07 replacements, including durable retries, idempotency, tenant checks, attempts, provider inbox/outbox, audit, and reconciliation.
4. Shadow each replacement and compare counts, tenant ownership, totals, artifacts, delivery outcomes, and provider external IDs. Never duplicate a real external side effect during shadowing.
5. Stop outbound calls one workflow at a time behind reversible flags. Keep legacy inbound routes read-only or deny-by-default during a measured observation window.
6. Require zero successful legacy calls and zero n8n executions for an approved observation period, plus owner sign-off and recovery evidence.
7. Disable n8n schedules/workflows and revoke n8n credentials. Continue monitoring compatibility endpoints before code removal.
8. Remove the routes/branches and environment names only in a separately approved implementation change. Preserve applied migration comments and audit evidence. Delete hosted workflows/account data according to the approved retention policy.

Removal is not complete merely because code is deleted. It is complete when all active outcomes are owned by Waggio, external callers are zero, credentials are revoked, hosted schedules are disabled, retained data is handled, and operational evidence is signed off.
