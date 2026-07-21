# CRA artifact validation and quarantine policy

## T4 lifecycle

- `GENERATED` means every source row, employee SIN, PDF, and XML passed generation version
  `t4-secure-v2` and the database publication transaction committed.
- A validation failure on an existing non-finalized package changes the summary, mutable slips,
  and their active documents to `QUARANTINED`. Files are retained, but only `ACTIVE` documents
  are downloadable.
- `FINALIZED` summaries and slips are immutable. Automated generation, revalidation, quarantine,
  supersession, and deletion are refused. A failed regeneration request creates the
  `T4_FINALIZED_REVALIDATION_REVIEW_REQUIRED` audit event and requires an authorized human/legal
  review. This deliberately avoids silently invalidating or rewriting a finalized tax record.
- Every successful summary, slip, and document records a random generation ID and generation
  version. A serializable publication transaction re-reads status and uses conditional updates so
  `FINALIZED` cannot be changed back to `GENERATED`.
- The idempotent legacy data migration quarantines pre-versioned T4 PDF/XML documents with
  `LEGACY_UNVALIDATED_ARTIFACT`. Mutable legacy summaries/slips become `QUARANTINED`;
  `FINALIZED` state is preserved while its documents are download-blocked and a
  `T4_FINALIZED_LEGACY_ARTIFACT_REVIEW_REQUIRED` audit is created exactly once.
- Legacy T4 submission XML is recognized by its historical storage shape:
  `documentType=OTHER`, `mimeType=application/xml`, `linkedEntityType=T4_SUMMARY`, and a non-null
  `t4SummaryId`. An unrelated `OTHER` XML document is not quarantined.
- Payroll `payDate` is currently stored as a `DateTime` created from `YYYY-MM-DD`, which means UTC
  midnight. Tax year and remittance period code must use UTC date-only parts and UTC boundaries;
  local `getFullYear()`/`getMonth()` is forbidden for these values. A future migration to PostgreSQL
  `DATE` or a repository-wide date-only value object should be evaluated separately.

## Compliance source eligibility and remittance reconciliation

- A Trolley payroll row is a CRA source only when its same-company parent is `PAID`, has a
  non-empty provider reference, is `VERIFIED` within the 24-hour freshness SLA under
  `trolley-processed-exact-set-v1`, and its child is `SENT` or `EMAIL_SENT` with `paidAt`,
  `paymentProvider=trolley`, and a non-empty payment reference. `PAID`/`paidAt` alone is never
  trusted evidence. Manual or non-Trolley payment requires a separately approved evidence type;
  it does not bypass this predicate.
- Selection records count-only exclusions as `PROVIDER_REFERENCE_MISSING`,
  `PROVIDER_EVIDENCE_UNVERIFIED`, `PROVIDER_EVIDENCE_STALE`,
  `PROVIDER_EVIDENCE_VERSION_MISMATCH`, or `PROVIDER_PAYMENT_LINK_MISSING`. The operation computes
  one `now`/freshness cutoff and reuses it for initial selection and the publication transaction.
- T4 generation is fail-whole: one excluded row in the requested tax year prevents all summary,
  slip, PDF, and XML publication. An existing mutable generation is quarantined; `FINALIZED` state
  remains immutable but is review-required and download-blocked. The serializable publication
  transaction re-runs the same predicate and source-ID check before creating any DB publication.
- Remittance calculation excludes ineligible rows. A mixed period publishes only eligible totals
  and allocations with exclusion counts; a zero-eligible period publishes no successful report.
  If an already-published source becomes ineligible, its totals, payment evidence, and file are
  retained, the remittance/report becomes review-required, allocations are removed, and dashboard
  payable aggregates exclude the preserved snapshot.
- The trusted Trolley polling reconciliation accepts only Payment status `processed` with a valid
  `processedAt`; invoice status `paid` is not a Payment success state. It validates payment ID,
  batch ID, external ID, optional response metadata, source amount, and source currency before
  atomically transitioning every referenced child plus its parent. Provider payment IDs and child
  `paymentRef` values must both be non-empty and unique, and the two sets must have identical values
  and cardinality; missing, duplicate, and unexpected evidence have distinct audit reason codes.
  Partial or mismatched provider evidence leaves the entire run ineligible. This follows the official
  [Payment API](https://developers.trolley.com/api/) response contract.
- The authenticated send-due cron reconciles all high-priority `PAYING` runs before submitting new
  due payroll. Historical `PAID` revalidation runs through a separate authenticated cron route, so
  its backlog or provider failures cannot delay today's payroll submission.
- Historical revalidation has no age cutoff. It uses a database checkpoint containing the last
  processed payroll-run ID, completed sweep count, and an expiring lease token. Each invocation has
  a default maximum of 25 runs and 20 seconds per invocation, persists progress after every run,
  resumes after the cursor,
  and wraps to the beginning after reaching the end. A conditional lease prevents concurrent jobs
  from reversing the cursor or processing the same checkpoint range. Individual failures emit a
  reason-coded retryable audit and advance the sweep; the still-`PAID` run is retried next cycle.
  Trolley documents that a Payment can revert and become `returned`, but
  does not publish a maximum return window; an unimplemented webhook is therefore not a trust
  boundary. A later `returned` or `failed` Payment moves the run and children to `REVIEW_REQUIRED`,
  quarantines active remittance and the complete affected T4 generation package, removes current
  allocations, and emits reason-coded audits. Physical files, prior totals, recorded remittance
  payments, and FINALIZED T4 state are preserved. This follows Trolley's documented
  [processed/returned lifecycle](https://developers.trolley.com/blog/payment-journey-at-trolley).
- Existing periods with no eligible payroll are retained as `REVIEW_REQUIRED`; statutory totals and
  employee count remain as the prior published snapshot, allocations and pending reminders are
  removed, and prior report documents are quarantined. The preserved totals and source metadata are
  copied into reconciliation/audit metadata and excluded from dashboard payable aggregates.
- Payment recording is blocked while a remittance is `REVIEW_REQUIRED`.
- A legacy report-backed remittance without a source version is migrated to `REVIEW_REQUIRED`.
  Its totals and recorded payments remain as an audit snapshot, but it is excluded from outstanding
  and next-due dashboard calculations before any manual sync occurs.
- Dashboard reads never run remittance synchronization. An explicit sync hashes eligible source rows
  and only regenerates a changed period. The PDF is completed first, then totals, allocations,
  document publication, reminders, and audit are committed together under a period advisory lock.
  A partial unique index guarantees one `ACTIVE` report per remittance.
- CRA publication and every provider-evidence success, retryable failure, or reversal transaction
  share a PostgreSQL advisory transaction lock keyed only by company ID. This company compliance
  lock is the membership boundary: it covers currently included runs, excluded/unverified runs, and
  a run that becomes eligible after the publisher's initial query. After the company lock, every
  participant sorts and de-duplicates the payroll-run IDs known to its operation and locks them in
  ascending order. Remittance publication locks every non-null run ID from the initial period source
  query (included and excluded), then takes the period lock. The complete order is company compliance
  lock -> ascending payroll-run locks -> remittance period lock.
- Once locked, publication re-queries every PayHistory in the period or tax year and compares the
  included IDs, excluded count, reason counts, source-value fingerprint, and all-source membership
  fingerprint with its initial snapshot. These transactions use `READ COMMITTED` so a statement
  executed after a waited company lock sees the winner's commit; a fixed serializable snapshot taken
  before the wait would reintroduce the race. The lock wait is bounded to five seconds and a timeout
  becomes only `COMPLIANCE_PUBLICATION_LOCK_TIMEOUT`.
- If publication commits first, a later eligibility loss quarantines the new report/T4 package. A
  later eligibility gain compares the newly eligible source with published allocations/T4 source
  membership, preserves totals, recorded payments, database rows, physical files, and FINALIZED T4
  state, but moves the incomplete artifact to review-required/quarantine and blocks downloads. If
  the evidence mutation commits first, publication sees the changed membership or eligibility,
  rolls back, and removes its unpublished file. First-ever publication and sources created after the
  initial query are protected by the company compliance lock, not by the existence of a remittance
  row.

## File storage

- The CRA artifact directory is mode `0700`; files are created atomically with mode `0600`.
- Superseded and quarantined referenced files are retained.
- `npm run cra:artifacts:reconcile` is dry-run only and reports old temporary or unreferenced files.
  Apply mode requires `--apply --confirm=REMOVE_UNPUBLISHED_CRA_ARTIFACTS`; production additionally
  requires `--allow-production`.
