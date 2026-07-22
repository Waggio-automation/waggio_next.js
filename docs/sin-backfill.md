# Employee SIN encryption backfill

This tool inventories legacy `Employee.sin` values and can encrypt only values that are
unambiguously valid nine-digit plaintext SINs. It never decrypts or prints stored values.
Record output contains only the employee ID, classification, reason code, and whether a
conditional update succeeded.

The default mode is read-only:

```sh
npm run sin:backfill
npm run sin:backfill -- --batch-size=250
```

Apply mode requires an explicit confirmation token and a valid `ENCRYPTION_KEY`:

```sh
npm run sin:backfill -- --apply --confirm=ENCRYPT_PLAINTEXT_SINS
```

When `NODE_ENV=production`, apply mode is additionally blocked unless an operator adds
`--allow-production`. That flag must only be used after a reviewed dry-run report, database
backup/restore verification, key verification, and approval of the quarantine list. Codex did
not run this tool against production.

The script reads in bounded ID-ordered batches. Each write is an atomic conditional update on
both employee ID and the previously observed value, so a concurrent change is not overwritten.
Re-running is idempotent: ciphertext is reported as `ALREADY_ENCRYPTED` only when it decrypts with
the configured key to a checksum-valid SIN, and it is never encrypted again. A legacy ciphertext
envelope that fails decryption or validation is `CORRUPT_CIPHERTEXT`. Masked, empty, invalid,
corrupt, and unknown formats are reported for quarantine and are not changed.

The existing ciphertext has no version prefix or authentication tag. This script recognizes only
the exact legacy `32 hex IV : block-aligned hex ciphertext` envelope. A future migration should
introduce an authenticated, versioned envelope such as `sin:v2:...` (or a dedicated encryption
version column) with managed key rotation; that broader cryptography migration is outside this fix.

## CRA artifact storage reconciliation

CRA artifact directories are forced to mode `0700` and generated files to `0600`. Crash leftovers
and files that have no `Document` record can be inventoried without deletion:

```sh
npm run cra:artifacts:reconcile
```

Cleanup is explicit and refuses production mode without an additional override:

```sh
npm run cra:artifacts:reconcile -- --apply --confirm=REMOVE_UNPUBLISHED_CRA_ARTIFACTS
```

Referenced artifacts, including quarantined historical artifacts, are never removed by this tool.
