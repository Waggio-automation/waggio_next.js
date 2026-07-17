# Test coverage audit

## Existing coverage

| Test file | Assertions | Covered | Not covered |
| --- | ---: | --- | --- |
| `cra-settings-validators.test.ts` | 5 | Normalization and selected invalid CRA settings | Persistence, authorization, legal correctness, dates, remittance/T4 |
| `status-mapping.test.ts` | 5 | Pure status mapping/derived readiness | Mapping consumer does not exist; no webhook verification/state mutation |

On 2026-07-15 all 10 pass and lint passes. No fixtures, seeds, mocks, coverage configuration, component framework, browser framework, test database harness, provider sandbox contract tests, or CI workflow was found.

## Use-case coverage result

| Area | Unit | Integration/DB | Auth/tenant | Duplicate/concurrency | Failure/retry | E2E/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Auth/account | None | None | None | None | None | None |
| Employee/PII | Validator only indirectly | None | None | None | None | None |
| Payroll calculation | None | None | None | None | None | None |
| Payroll approval/finalize | Missing feature | None | None | None | None | None |
| Trolley transfer | Mapping only | None | None | None | None | None |
| Paystub/PDF/email | None | None | None | None | None | None |
| Remittance/T4 | Settings validator only | None | None | None | None | None |
| Stripe/billing | None | None | None | None | None | None |
| Migrations/retention | None | None | None | None | None | N/A |

## Required financial test matrix

Every financial command must test happy path, invalid input, boundary values, unauthorized role, cross-tenant ID, duplicate idempotency key, concurrent claim, partial provider/database failure, ambiguous timeout, retry/replay, and audit event. Also assert tenant totals, ledger invariants, no mutation after finalization, and redaction/no PII logs.

Payroll calculation requires official, versioned golden vectors for every supported schedule and bracket boundary; cent rounding; zero/negative rejection; high/low income; TD1; overtime/holiday/vacation; YTD max just below/at/above CPP/EI/CPP2 thresholds; tax-year transition; leap/date/DST semantics; contractor/unsupported rejection; correction/reversal. Legal/payroll sign-off must identify the authoritative source/version for each vector.

## Release gates

1. Schema validation and migration rehearsal from a masked production snapshot, including rollback/restore and per-tenant count/sum/hash reconciliation.
2. Unit/domain suite with 100% transition/invariant branch coverage for financial state machines (not a blanket repository percentage claim).
3. PostgreSQL integration tests with row locks/idempotency/outbox and two-tenant fixtures.
4. Provider contract tests plus signed webhook fixtures and reconciliation simulations.
5. PDF security tests for auth, payload/output limits, SSRF/file/network denial, timeout, private access, determinism.
6. UI component/E2E tests for onboarding, payroll review/approval, processing refresh, partial failure, correction, mobile and keyboard/screen reader behavior.
7. Production build, dependency/security scanning, secret/config validation, observability smoke test, backup restore evidence, staged canary and rollback drill.

No money movement or statutory artifact should pass a release gate merely because lint and the current 10 tests pass.
