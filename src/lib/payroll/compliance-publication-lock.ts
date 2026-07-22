import type { Prisma } from "@prisma/client";

export const COMPLIANCE_PUBLICATION_LOCK_TIMEOUT_CODE =
  "COMPLIANCE_PUBLICATION_LOCK_TIMEOUT";

export class CompliancePublicationLockTimeoutError extends Error {
  readonly code = COMPLIANCE_PUBLICATION_LOCK_TIMEOUT_CODE;
  readonly retryable = true;

  constructor() {
    super("Compliance publication serialization lock timed out.");
    this.name = "CompliancePublicationLockTimeoutError";
  }
}

export function sortUniquePayrollRunIds(ids: Array<bigint | null>) {
  return Array.from(new Set(
    ids.filter((id): id is bigint => id !== null).map((id) => id.toString())
  ))
    .map((id) => BigInt(id))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

async function configureBoundedLockTimeout(
  tx: Prisma.TransactionClient,
  timeoutMs: number
) {
  await tx.$queryRaw`
    SELECT set_config('lock_timeout', ${`${timeoutMs}ms`}, true) AS "lockTimeout"
  `;
}

async function withSanitizedLockTimeout<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    const details = error instanceof Error
      ? `${error.name}:${error.message}`
      : String(error);
    if (details.includes("lock timeout") || details.includes("55P03")) {
      throw new CompliancePublicationLockTimeoutError();
    }
    throw error;
  }
}

/**
 * Shared serialization boundary for CRA source membership and trusted-provider evidence.
 * Every caller acquires the company lock first, then every operation-scoped payroll-run
 * lock in ascending ID order. The company lock covers membership phantoms that are not
 * present in a publisher's initial source query. A remittance publisher acquires its
 * period lock only after this function returns.
 */
export async function lockCompanyComplianceScope(
  tx: Prisma.TransactionClient,
  companyId: bigint,
  payrollRunIds: Array<bigint | null>,
  options: { timeoutMs?: number } = {}
) {
  const orderedIds = sortUniquePayrollRunIds(payrollRunIds);
  const timeoutMs = Math.max(1, Math.min(Math.floor(options.timeoutMs ?? 5_000), 30_000));
  return withSanitizedLockTimeout(async () => {
    await configureBoundedLockTimeout(tx, timeoutMs);
    const companyKey = `cra-provider-evidence:company:${companyId.toString()}`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${companyKey}, 0))::text AS "lock"
    `;
    for (const payrollRunId of orderedIds) {
      const key = `cra-provider-evidence:payroll-run:${payrollRunId.toString()}`;
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS "lock"
      `;
    }
    return orderedIds;
  });
}
