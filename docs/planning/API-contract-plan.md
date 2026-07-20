# API contract plan

## Conventions

- Version business APIs (`/api/v1`), JSON schema generated from shared server validators, ISO date-only `YYYY-MM-DD`, UTC instants with `Z`, money `{ amount: "123.45", currency: "CAD" }` as strings.
- Cookie user requests require CSRF/origin policy; service requests use scoped service identity and tenant/resource claims. Workers normally claim PostgreSQL jobs directly and do not use global data APIs. Never infer “all tenants” from one shared secret.
- Mutating requests require `Idempotency-Key` where replay is possible and `If-Match`/version for editable resources.
- Errors use `{ code, message, correlationId, fieldErrors?, retryable?, currentVersion? }`; no raw provider/Prisma data or PII.
- Pagination uses stable cursor; exports are async private artifacts. DTOs are allowlists and mask sensitive fields.

## Planned command/query surface

| Contract | Method | Key behavior |
| --- | --- | --- |
| `/companies/:id/onboarding` | GET | Read versioned step/readiness projection |
| `/companies/:id/onboarding/:step` | PUT | Permission/version validate, save/resume, audit |
| `/companies/:id/members/invitations` | POST/DELETE | Expiring scoped invite/revoke |
| `/employees` | GET/POST | Filtered directory; idempotent guided create |
| `/employees/:id` | GET/PATCH | Masked DTO; effective-dated updates with version |
| `/employees/:id/lifecycle` | POST | Named deactivate/terminate/rehire commands |
| `/payroll-runs` | GET/POST | List; idempotent draft creation |
| `/payroll-runs/:id/inputs` | PUT | Draft-only versioned inputs/import reference |
| `/payroll-runs/:id/calculate` | POST | Queue calculation, return operation state |
| `/payroll-runs/:id/review` | GET | Register, totals, validation, variance |
| `/payroll-runs/:id/approve` | POST | Step-up/policy, approval assertion/reason |
| `/payroll-runs/:id/finalize` | POST | Idempotent atomic finalization only |
| `/payroll-runs/:id/adjustments` | POST | Linked correction/reversal/off-cycle draft |
| `/payment-runs` | GET/POST | Create only from finalized run; explicit schedule |
| `/payment-runs/:id` | GET | Batch + instruction outcomes |
| `/payment-instructions/:id/retry` | POST | Only eligible failure; new attempt |
| `/pay-statements/:id` | GET | Metadata and authorized short-lived access action |
| `/pay-statements/:id/generate`, `/pay-statements/:id/deliver` | POST | Separate idempotent jobs/attempts |
| `/remittance-liabilities` | GET/POST | Query/freeze from finalized results |
| `/remittance-liabilities/:id/payments` | POST | Record external payment/proof idempotently |
| `/tax-packages` | POST/GET | Versioned preflight/generate/review/finalize |
| `/reports` | POST/GET | Async scoped report/export |
| `/audit-events` | GET | Permission-filtered immutable timeline |

## Provider endpoints

- `/api/webhooks/stripe` and `/api/webhooks/trolley`: read raw body, verify against current/rotating secret contract, timestamp tolerance/replay check, insert unique ProviderEvent, return quickly, process async.
- Railway `/v1/render`: short-lived service authentication, opaque request ID, idempotency/content hash, and bounded server-rendered HTML; returns only a bounded PDF. It receives no company/tenant identity, browser identity, database/object key or provider credential and cannot perform storage/delivery.
- Health endpoints reveal no secrets/provider detail and are access-controlled appropriately.

## Legacy migration

Inventory callers for `/api/payhistory`, `/api/payroll/update-status`, `/api/payroll/export`, `/api/company/admin-link`, and `/api/payslip/pdf`. Historical n8n application hooks and global-secret access were removed on 2026-07-17; do not add a compatibility bypass. Observe denied legacy callers, verify required outcomes, disable hosted workflows, and retire credentials/configuration using `../audit/n8n-usage-audit.md`. No replacement service receives global tenant access.
