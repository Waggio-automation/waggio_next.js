# CRA date-only and payment reconciliation operations

## Calendar-date policy

Payroll `payDate`, payroll period boundaries, remittance period/due dates,
remittance payment dates, and reminder schedules are calendar-only values. The
application persists these values as UTC midnight and reads their parts with UTC
date APIs. It formats them with `timeZone: "UTC"`; the host or developer machine
timezone must not change the displayed calendar date.

Until a company timezone field is introduced, CRA operational "today" is
explicitly `America/Toronto`. `getTodayUtcDateOnly()` converts an instant to the
Toronto calendar date and then represents that date as UTC midnight. This policy
only applies to decisions such as due/reminder state. Real instants such as
`createdAt`, `updatedAt`, `uploadedAt`, provider `processedAt`, and audit event
timestamps remain instants and must not be normalized as date-only values.

`PeriodRangePicker` configures `react-day-picker` with `timeZone="UTC"`, parses
selected values through `parseUtcDateOnly()`, and serializes them as
`YYYY-MM-DD`. Browser timezone therefore does not alter its selected dates.

Longer term, the database should use a SQL `DATE` type or a dedicated date-only
domain type. That schema change is intentionally outside this security patch.

## Deployed jobs

`vercel.json` registers two independent production cron paths. Vercel evaluates
these expressions in UTC.

| Job | Schedule | Function budget | Purpose |
| --- | --- | ---: | --- |
| `/api/cron/payroll-send-due` | `0 13 * * *` | 60 seconds | Bounded high-priority PAYING reconciliation, then idempotent due dispatch |
| `/api/cron/payroll-revalidate-paid` | `*/15 * * * *` | 30 seconds | Cursor-based historical PAID revalidation |

Both endpoints require the exact `Authorization: Bearer $CRON_SECRET` value and
fail closed if the secret is absent. Production must use a Vercel plan that
supports the configured 15-minute frequency and must configure a random
`CRON_SECRET` before deployment.

Historical revalidation processes at most 25 payroll runs, at most 50 provider
HTTP requests, and spends at most 20 seconds per invocation. Its nominal
healthy-provider capacity estimate is:

```text
ceil(PAID runs with a providerRef / min(25, floor(50 / healthy average pages per run)))
  * 15 minutes
```

This value is named `nominalCapacityEstimateMinutes`; it is arithmetic planning
capacity, not a maximum detection lag or SLA guarantee. For example, 25 runs per
invocation every 15 minutes gives a nominal 2,400 runs/day only when provider
latency is healthy, every run fits in the request cap (normally one page), and
there are no timeouts or rate limits. Before rollout, measure the actual backlog,
latency, pages per batch, and provider request allowance. Adjust the schedule and
caps if combined PAYING, dispatch, and historical traffic approaches the
provider limit.

The actual provider-verification freshness SLA is 24 hours. Job progress is not
verification evidence: cursor movement, `lastCompletedAt`, and completed sweeps
may advance after a provider failure. A run is successfully verified only when
the provider reports `processed` and the exact payment set, batch identity,
external identity/metadata, amount, currency, and `processedAt` all validate.
`PayrollRun.providerVerificationLastSucceededAt` records that event;
`PayrollProviderVerificationAttempt` records only count-based attempt outcomes
and request metrics. A later timeout or rate limit updates attempt/failure fields
and consecutive failures but never overwrites the previous success timestamp.

## Checkpoint, concurrency, and timeout behavior

`PayrollReconciliationCheckpoint` persists a cursor per job, completed sweep
count, start/completion timestamps, and a lease token/expiry. A conditional lease
update admits one invocation. The cursor advances after every attempted run, so
one provider failure does not starve later IDs. At the end of the ID range it
wraps to `null`, increments `completedSweeps`, and retries earlier failures during
the next sweep. A handled timeout releases the lease; a process crash leaves a
five-minute lease that can be acquired after expiry.

Trolley requests use `AbortController`. The default request timeout is 5 seconds,
which is shorter than both reconciliation invocation budgets. Before each page,
the worker calculates its remaining deadline and will not start a request whose
timeout exceeds that remainder. Timeout errors become only
`TROLLEY_PROVIDER_REQUEST_TIMEOUT`; response bodies and provider identifiers are
not written to reconciliation audits or cron responses.

Every page consumes the invocation request budget. A run that cannot fetch all
pages before the 50-request historical cap is
`TROLLEY_PROVIDER_REQUEST_BUDGET_EXHAUSTED` and is not marked successful. HTTP
429 becomes only `TROLLEY_PROVIDER_RATE_LIMITED`. The worker does not sleep past
the serverless deadline: it honors `Retry-After` once only when the delay is at
most one second and both the request and time budgets can accommodate another
request. Otherwise it preserves the cursor position for retry during the next
sweep. Responses expose only attempted/successful/timed-out/rate-limited request
and page counts.

PAYING reconciliation is separately checkpointed and bounded to 10 runs/10
seconds and 20 provider requests. Per-run timeout errors are audited as
retryable, the cursor continues, and due dispatch still runs after the bounded
PAYING pass. Historical PAID work is never executed in the send-due job.

Provider evidence reconciliation and CRA publication use the same company-scoped
compliance advisory lock before sorted, de-duplicated payroll-run locks. The
company key contains only the local company ID and serializes both eligibility
loss and eligibility gain, including an excluded or newly created run that was
absent from a publisher's initial eligible set. Remittance publication locks all
non-null run IDs from its complete initial period source query, not only the
included rows, and then acquires the period lock. The fixed order is company ->
ascending payroll-run IDs -> remittance period. Provider reconciliation uses the
same company -> run prefix before reading or changing verification evidence.

After acquiring these locks, a publisher re-queries all period/year PayHistory
and compares included IDs, exclusion counts/reasons, the eligible value
fingerprint, and the all-source membership fingerprint. A five-second database
lock timeout is surfaced only as the retryable reason
`COMPLIANCE_PUBLICATION_LOCK_TIMEOUT`; no provider payload or identifier is
included. `READ COMMITTED` is intentional at this boundary: after waiting, the
next statement must see the transaction that held the lock. If publication wins,
a later eligibility gain or loss reviews/quarantines any now-incomplete artifact;
if evidence mutation wins, publication rolls back and removes unpublished files.
Prior totals, payments, files, and FINALIZED T4 state remain preserved.

## Verification status and artifact access

All existing PAID runs are migrated to `LEGACY_UNVERIFIED`; the migration does
not infer a successful verification or create a success attempt. Rows with a
Trolley reference are reported as `LEGACY_UNVALIDATED_PROVIDER_EVIDENCE` until
the complete current contract passes. Rows without a reference cannot be polled,
remain fail-closed, and are separately reported as
`LEGACY_PROVIDER_REFERENCE_MISSING` for manual review.
No provider response body, batch/payment identifier, SIN, or encrypted SIN is
stored in verification attempts, audits, health output, or cron responses.

CRA source eligibility and access are both fail closed for a required PAID run
that is not currently `VERIFIED`, has never passed the current verification
contract, has the wrong evidence version, or whose last success is more than 24
hours old. These rows are excluded from remittance calculation, and any one such
row blocks the entire tax-year T4 generation instead of publishing an uncertain
package and hiding it later. Initial selection and transaction publication use
the same operation-scoped cutoff and common predicate.

For an artifact published while evidence was fresh, later staleness immediately
omits dashboard/T4/remittance links, makes UI rows `REVIEW REQUIRED`, excludes
the remittance from outstanding/next-due/overdue aggregates, and makes
`getDownloadableDocument()` return `null`. Physical files and prior remittance
totals/payment evidence remain preserved. Explicit remittance reconciliation
persists `REVIEW_REQUIRED` and quarantines its report; a later successful provider
verification does not silently republish a separately quarantined artifact.
Returned/failed provider states continue to quarantine the full affected T4
generation package under the reversal policy.

## Production metrics and alerts

The historical cron count-only response exposes:

- required PAID, provider-reference-missing, revalidatable, verified-within-SLA,
  never-verified, stale, unresolved-failure, and legacy-unverified counts;
- oldest successful verification and its age;
- attempt/success/failure counts and observed successful throughput;
- nominal capacity estimate, configured run/request caps, attempted/successful/
  timed-out/rate-limited request counts, and pages fetched;
- `remainingAfterCursor`, checkpoint age, last start/completion, completed
  sweeps, lease state, and checkpoint-stale state;
- `slaBreached`

`slaBreached` is true when at least one required PAID run lacks a provider
reference, has never successfully verified, has a non-current verification
status/version, the latest successful verification is older than 24 hours,
observed successful throughput is below the rate needed to repair an existing
freshness deficit, or the checkpoint has not completed for 30 minutes. An unresolved
retryable failure becomes an SLA breach when it leaves the run never verified or
lets its prior success age beyond 24 hours. Thus an all-timeout invocation can
advance the cursor but returns HTTP 503 and `ok: false`.

Alert when any of the following occurs:

- `slaBreached` is true or the route returns HTTP 503;
- `checkpointAgeSeconds` exceeds 30 minutes (two missed invocations);
- nominal capacity estimate exceeds 24 hours;
- never/stale/unresolved counts persist or increase, actual successful throughput
  is below required throughput, or timeout/rate-limit counts rise;
- `completedSweeps` does not increase within the calculated sweep window;
- the lease remains active beyond its expiry or concurrent invocations repeatedly return `skippedLocked`;
- function duration approaches 20 seconds, timeout rate rises, or Trolley reports rate limiting.

Production scheduler execution, production migration/data changes, artifact
cleanup, CRA submission, and live Trolley calls are separate rollout actions and
are not performed by tests or this change.
