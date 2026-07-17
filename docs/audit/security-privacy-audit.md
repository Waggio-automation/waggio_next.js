# Security and privacy audit

## Priority findings

- Critical: unauthenticated admin-link issuance; unauthenticated arbitrary-HTML PDF/public blob.
- Critical: mixed plaintext/ciphertext SIN and invalid T4 handling.
- Critical: destructive payroll/compliance cascades and unsafe Trolley submission/recovery.
- High: plaintext/re-displayed bank coordinates, global n8n tenant scope, no RBAC, no auth throttling/MFA/session revocation, no private paystub access, incomplete audit, and missing provider webhook/replay controls.

## Sensitive-data trace

| Data | Collection/validation | Storage/encryption | Retrieval/display/transmission | Retention/log risk |
| --- | --- | --- | --- | --- |
| SIN | Employee form/API; Luhn on creation | Server action AES-256-CBC; API plaintext in same column; no format/version tag | Read without decryption into T4 PDF/XML | Mixed format, unauthenticated cipher, local artifact, cascade deletion; Critical |
| Bank numbers | Employer employee forms; digit format checks | Plaintext Employee columns plus Trolley | Full values repopulated in browser and included in payroll-run integration responses; sent to Trolley | Excess replication/access; provider errors/logs may disclose details |
| DOB/address/email | Employer forms | Plaintext Employee | Employer UI, Trolley recipient, T4, legacy n8n employee event | No field-level access/retention/audit; n8n event is approved for retirement |
| Compensation/TD1/payroll | Employer forms/calculation | Plaintext decimals; incomplete snapshots | Dashboard/payroll APIs, CRA/T4 aggregation | Destructive cascades, global integration scope |
| Paystub | Caller-provided HTML | Public Vercel Blob URL on PayHistory | Anyone with URL; predictable names | No expiration/private authorization/version retention |
| CRA account/transmitter/contact | CRA form | Plaintext settings | T4/XML/local docs | No step-up permission or access audit |
| Password/reset token | Auth forms | scrypt salted hash; SHA-256 reset token | Server only; reset token in URL/email | No session revocation/rate limit; URL history/referrer exposure |
| Provider IDs/events | Provider calls | IDs/flat status only | Employer status UI | Raw events missing; errors can be overexposed |

## Control review

| Control | Current result | Required direction |
| --- | --- | --- |
| Authentication | Basic signed cookie/password | Verification, rate limit, MFA/step-up, server sessions/revocation, secure recovery |
| Authorization | Most routes authenticate and filter tenant | Enforced role/permission policy; tenant-scoped data layer; deny-by-default integration claims |
| CSRF | SameSite=Lax cookie; no explicit API CSRF tokens | Origin/CSRF checks on cookie-auth mutations, server-action policy validation |
| XSS | React escaping generally; emails interpolate values; PDF accepts raw HTML | Escape email values/URLs, eliminate caller HTML, CSP/security headers |
| Injection | Prisma/Zod reduce SQL input risk | Strict schemas for every route/date/number; no generic linked IDs; CSV hardening when added |
| SSRF | PDF renderer accepts arbitrary HTML/external resources | Network-denied renderer and server-owned template/data |
| Secrets | Env-based; n8n credentials/URLs were found in a local environment file | Treat discovered n8n credentials as exposed, rotate during containment, separate by env/service, and retire all n8n names only after zero-caller gates; never document values |
| Logging/errors | Some redaction in Trolley summary | Central structured redaction; never return provider details; correlation IDs |
| Webhooks | Stripe signature only | Event dedup/archive/replay; implement Trolley verification per official contract |
| Files | Authenticated local CRA download; public paystub | Private object storage, tenant authorization proxy/signed short TTL, malware/type/size controls |
| Audit | A few SYSTEM CRA events | Immutable user/provider/system audit for all privileged/financial actions |
| Deletion/retention | Cascades and no policy | Legal/privacy-approved schedule, legal hold, subject de-identification without ledger loss |
| Backups/recovery | Not documented | Encrypted backups, PITR, restore tests, RPO/RTO, incident runbooks |

## Privacy requirements before employee/self-service expansion

Data minimization, purpose/consent notices, processor/provider disclosure, residency/transfer review, access/correction/export workflow, breach response, retention schedule, role-based field masking, step-up auth for bank/SIN changes, employee-visible change notifications, and audited support access require legal/privacy review. This document does not assert statutory compliance.

CSV import, when introduced, must treat files as untrusted: size/type limits, quarantine, row validation, duplicate preview, no formula execution, formula-prefix escaping on exports, safe error files, and automatic raw-upload expiry.
