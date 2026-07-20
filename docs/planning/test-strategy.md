# Test strategy

## Test layers

| Layer | Purpose | Required tooling/fixtures (tool choice pending) |
| --- | --- | --- |
| Domain unit | Decimal calculation, invariants, transitions | Versioned official golden vectors and deterministic clock/timezone |
| Schema/property | Validators, generators, serialization | Boundary/property tests for money/dates/statuses |
| PostgreSQL integration | transactions, locks, constraints, tenant queries, outbox/idempotency | Disposable real PostgreSQL; two+ tenant fixture factory |
| API/action integration | auth, CSRF, DTO, errors, command effects | Cookie/service identities and role matrix |
| Provider contract | Trolley/Stripe/SMTP/Railway requests/webhooks | Signed fixtures, sandbox where safe, fault/timeout simulators |
| Component/a11y | forms, error summaries, dialogs, responsive tables/cards | DOM accessibility runner and keyboard tests |
| E2E | complete role journeys | Isolated environment, fake/sandbox side effects, private objects |
| Migration | fresh install and production-clone upgrade | Masked snapshot, counts/sums/hashes, rollback/restore |
| Operational | build, health, backup restore, alerting, deploy/rollback | Staging/canary runbooks |

Historical n8n retirement additionally requires negative tests proving the removed header grants no access, tenant/DTO tests for retained routes, employee/payroll regression tests proving no workflow request occurs, AUTO-01 through AUTO-03 contract tests when direct replacements are built, zero-caller/execution observation evidence, and post-revocation monitoring.

## Financial command matrix

For every create/calculate/approve/finalize/submit/retry/generate/deliver/remittance-payment/billing-usage command test:

- happy path and exact resulting totals/status/audit;
- invalid/unsupported input and cent/date/tax-year boundaries;
- unauthenticated, wrong role, stale auth level, cross-tenant IDs/relationships;
- duplicate same key/same hash and same key/different hash;
- concurrent identical/different command and stale optimistic version;
- failure before provider call, timeout during call, provider success then DB failure, webhook before/after response, duplicate/out-of-order/replayed webhook;
- partial batch result, eligible retry, unsafe retry blocked, reconciliation repair;
- audit correlation and absence of PII/secrets in response/logs.

## Payroll correctness

Rule-set approval requires documented primary sources and qualified payroll review. Golden vectors cover each supported schedule/province/year, all bracket/credit thresholds, CPP/EI/CPP2 annual maximum crossings with YTD/opening balance, TD1/high-income behavior, overtime/holiday/vacation, additional earnings, partial periods, rounding order, and corrections. Unsupported cases assert a blocking code. Run the prior tax-year regression suite whenever a new year is added; finalized old runs reference and reproduce their old rule set.

## Security/privacy

Automate authorization matrix and object-ID fuzzing, session revocation/MFA, rate limiting, CSRF/origin, secure headers, XSS payloads, export formula escaping, encrypted-field access/masking, provider error redaction, PDF SSRF/network/file denial, private object authorization/expiry, webhook signature/timestamp/replay, audit append-only controls, retention/hold/de-identification jobs.

## Release gates

- PR: lint/typecheck/unit/schema/property; changed financial paths require invariant tests.
- Merge/staging: PostgreSQL/API/component/provider-fixture/migration fresh install.
- Candidate: full E2E/a11y, production build/config check, masked upgrade rehearsal, backup restore, provider sandbox smoke, vulnerability/license/secret scans.
- Production: approved change record, canary, live health/metrics, no reconciliation differences, rollback decision window.

No snapshot update or “expected value” change in payroll tests is accepted without rule-source and reviewer evidence.
