# Manual workflow retirement checklist

This Day 3 DevOps checklist covers only operational cleanup after the application removal is deployed and verified. Never paste environment values, webhook URLs, credentials, request headers, or payloads into this file, logs, or tickets.

## Deployment locations to inspect

- [ ] Developer environment files: remove the six names listed in `../audit/n8n-usage-audit.md` without recording their values.
- [ ] Vercel Development environment variables.
- [ ] Vercel Preview environment variables.
- [ ] Vercel Production environment variables.
- [ ] CI/CD organization, repository, and environment secret/variable stores.
- [ ] Any separate worker, cron, Railway, container, or hosting configuration discovered during deployment inventory.

No checked-in workflow service, workflow definition, CI reference, or Vercel configuration reference remained after the application change. Dashboard-only variables cannot be confirmed from the repository.

## External workflow inventory and disablement

- [ ] Identify owner, schedule, retained data, execution history, and consumers for the historical employee-created workflow.
- [ ] Identify the same for payroll-processed and schedule-only workflows.
- [ ] Identify any workflow calling PayHistory read/patch or PayrollRun read endpoints.
- [ ] Confirm the approved observation window and record zero required callers/executions.
- [ ] Disable schedules first, then workflow endpoints/definitions, with timestamp and owner approval.
- [ ] Export only approved audit evidence to controlled storage; do not export secrets into the repository.
- [ ] Apply the approved retention/deletion policy to hosted execution data.
- [ ] Rotate/revoke associated credentials using the security runbook after application verification.

## Verification

- [ ] Employee creation succeeds and performs no workflow request.
- [ ] Payroll creation commits without workflow configuration and performs no workflow request.
- [ ] The legacy header alone receives 401 from retained APIs.
- [ ] Cross-tenant run and PayHistory access is denied/hidden.
- [ ] Response samples contain no restricted employee or banking fields.
- [ ] No unexpected statement/email gap, stranded schedule-only run, or payment anomaly is observed.
- [ ] AUTO-01, AUTO-02, and AUTO-03 have owners and target phases.

## Rollback boundary

Do not re-enable global-secret access or outbound workflows as a routine rollback. Secret revocation, hosted data deletion, external execution, email delivery, and money movement are not reversible through an application rollback. Pause affected automation and use an approved authenticated in-application recovery path.
