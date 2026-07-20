# Historical n8n usage audit and removal record

Audit date: 2026-07-16. Removal implementation: 2026-07-17.

The architecture decision is final: Waggio does not use n8n. This document is retained as historical evidence of the removed integration and as the operational checklist for retiring configuration and externally hosted workflows. It does not prove whether a deployed workflow is enabled; that requires environment and provider-console access.

## Removed executable paths

| ID | Removed path | Result after removal |
| --- | --- | --- |
| N8N-01 | Employee-created outbound request in `src/app/employees/actions.ts` | Employee creation, validation, SIN encryption, tenant ownership, Stripe seat sync, optional direct Trolley payout setup, revalidation, and UI success remain. No generic employee-created event leaves Waggio. |
| N8N-02 | Payroll-processed outbound request in `src/app/api/payroll/run/route.ts` | The payroll database transaction and existing direct due-now Trolley call remain. Payroll creation no longer makes a workflow request or depends on workflow configuration. |
| N8N-03 | Schedule-only outbound request in `src/app/api/payroll/update-status/route.ts` | Authenticated schedule-only creation still returns a `SCHEDULED` run. It no longer contacts an external workflow or advances the run to `FUNDING`. |
| N8N-04 | Shared-secret bypass in `GET /api/payhistory` | OWNER/ADMIN session required; the run and rows must belong to the authenticated company. The response is an allowlisted payroll DTO. |
| N8N-05 | Shared-secret bypass in `PATCH /api/payhistory` | OWNER/ADMIN session and plan required. Every requested row must resolve inside the authenticated company or the request returns 404 without mutation. |
| N8N-06 | Shared-secret bypass in `GET /api/payroll/runs` | OWNER/ADMIN session required; query is company-scoped and returns an allowlisted DTO. |
| N8N-07 | Shared-secret bypass in `GET /api/payroll/runs/[id]` | OWNER/ADMIN session required; another tenant's identifier returns 404 and sensitive employee/banking fields are not selected. |

The former header by itself grants no access. The affected API routes return JSON 401/403/404 responses and do not invoke page redirects for authentication.

## Caller inventory

| Surface | In-repository caller | Preserved behavior / gap |
| --- | --- | --- |
| Employee server action | `src/app/employees/CreateEmployeeForm.tsx` | Creation remains operational; only the unknown external employee event is gone. |
| Primary payroll creation | `src/app/payroll/hours-table.tsx` | Database creation and direct due-now Trolley behavior remain; any unknown external paystub/delivery orchestration is no longer triggered. |
| PayHistory GET/PATCH | None found | Authenticated route retained for legitimate Waggio users; unknown external shared-secret callers now receive 401. |
| PayrollRun collection/detail | No direct caller found | Authenticated route retained; unknown external shared-secret callers now receive 401. |
| Schedule-only update route | None found | It creates only local `SCHEDULED` state; no downstream processing is triggered. |

There was no direct browser workflow URL or SDK, no checked-in workflow definition/service/image, and no workflow scheduler in `vercel.json`. The checked-in cron invokes Waggio's payroll due-send route directly.

## Sensitive-data reduction

The retained PayHistory and PayrollRun read routes use explicit Prisma `select` allowlists. They do not return SIN, institution number, transit/branch number, account number, employee email, compensation rate/salary, provider reference, tokens, encrypted values, company admin email, or the unrestricted employee model. The detail route filters by both resource ID and authenticated company ID, returning 404 for missing or cross-tenant runs.

## Temporary feature gaps and follow-up cards

These gaps are explicit and are not silently replaced in this change:

- **AUTO-01 — employee post-create outcomes:** determine whether the removed external employee event performed any required action. Implement only required outcomes later through an audited transaction plus Job/Outbox and authenticated direct provider workers.
- **AUTO-02 — payroll statement/delivery outcomes:** primary payroll creation no longer triggers an unknown external workflow. Paystub generation and delivery remain missing in this repository. Implement them in the future Job/Outbox statement and delivery phase.
- **AUTO-03 — schedule-only route disposition:** identify deployed callers. Either retire the incomplete route or replace it with approved payroll commands and PostgreSQL-backed scheduled jobs; do not restore an external workflow.
- **OPS-01 — hosted workflow retirement:** inventory, disable, retain/delete according to policy, and obtain owner evidence for employee-created, payroll-processed, schedule-only, and any PayHistory read/patch workflow.
- **OPS-02 — configuration retirement:** remove the sanitized variable names below from every deployed environment after code deployment and verification.

## Configuration inventory

No environment example is checked in, so this document is the authoritative sanitized inventory. The repository search found no checked-in application, CI/CD, or `vercel.json` dependency after removal. A developer-local ignored environment file may still contain some names; its values were not changed and must not be copied into tickets or logs.

Sanitized name-only inspection found these names in an ignored developer-local environment file; no values were changed:

- `N8N_SECRET`
- `N8N_API_KEY`
- `N8N_WEBHOOK_URL`
- `N8N_PAYROLL_WEBHOOK_URL`

These additional removed code dependencies were not present in the inspected developer-local name inventory, but may exist only in Vercel or another deployment and must be checked manually:

- `N8N_TEST_WEBHOOK_URL`
- `N8N_WEBHOOK_SECRET`

All six names require manual retirement wherever present: Vercel Development/Preview/Production, CI/CD secret stores, other hosting, and developer environments. The repository cannot establish which names exist only in a deployment dashboard. Verify names without displaying values.

## Historical references intentionally retained

- `src/prisma/migrations/20250924194456_init/migration.sql` contains a comment describing the historical flow. Applied migration history is immutable and the comment has no executable effect.
- `docs/proposals/payroll-schema-redesign.md` is a superseded proposal retained as review evidence. Its diagram is historical, not the target or current runtime.
- Planning and audit documents may use the product name only to record the rejected architecture, completed removal, follow-up gap, or external retirement task. They must not describe it as current executable behavior.

## Verification and deployment order

1. Run the focused authorization/DTO regression test, repository search, type check, lint, and production build without calling providers.
2. Deploy application code before deleting any environment names. Confirm employee and payroll database creation in a safe environment and confirm no outbound workflow request appears.
3. Confirm the legacy header alone receives 401 and authenticated cross-tenant identifiers receive 404. Confirm read DTOs contain no restricted fields.
4. Observe application and hosted workflow logs for callers/executions for the approved period. Do not log headers, URLs, or secret values.
5. Disable external schedules/workflows for employee creation, payroll processing, schedule-only processing, and PayHistory read/patch. Preserve required audit evidence according to retention policy.
6. Remove the six variable names from Vercel Development, Preview, and Production; CI/CD; other hosting; and developer environments. Rotate/revoke credentials under the separate approved security procedure.
7. Re-deploy/restart if the platform requires it, repeat smoke checks, and monitor for 401s, missing statements/delivery, schedule-only runs, and provider/payment anomalies.

## Rollback limitation

Do not restore a global shared-secret bypass or outbound workflow call. A rollback can restore the preceding application artifact only if security owners explicitly accept that exposure, so the preferred recovery is to fix the authenticated application path or pause the affected automation. External workflow disablement, secret revocation, data deletion, and real provider side effects are not database-roll-backable; record each operation and preserve recovery evidence.

Code removal is complete. Operational retirement is complete only after external workflows are disabled, environment names are removed, credentials are handled under the approved security procedure, and owners sign off on the temporary automation gaps.
