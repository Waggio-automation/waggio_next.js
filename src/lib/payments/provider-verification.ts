import { prisma } from "../prisma.ts";
import { getDateOnlyCalendarYear } from "../date-only.ts";
import {
  CURRENT_PROVIDER_EVIDENCE_VERSION,
  PROVIDER_VERIFICATION_SLA_MS,
} from "../payroll/provider-evidence-policy.ts";

export { CURRENT_PROVIDER_EVIDENCE_VERSION, PROVIDER_VERIFICATION_SLA_MS };

export async function getCompanyProviderVerificationFreshness(
  companyId: bigint,
  now = new Date()
) {
  const cutoff = new Date(now.getTime() - PROVIDER_VERIFICATION_SLA_MS);
  const paidRuns = await prisma.payrollRun.findMany({
    where: {
      companyId,
      status: "PAID",
    },
    select: {
      id: true,
      providerRef: true,
      providerVerificationStatus: true,
      providerVerificationLastAttemptAt: true,
      providerVerificationLastSucceededAt: true,
      providerVerificationFailureCode: true,
      providerVerificationConsecutiveFailures: true,
      providerEvidenceVersion: true,
    },
  });
  const runs = paidRuns;
  const providerReferenceMissing = runs.filter((run) => !run.providerRef?.trim());
  const currentEvidenceVersion = (run: typeof runs[number]) =>
    run.providerEvidenceVersion === CURRENT_PROVIDER_EVIDENCE_VERSION;
  const successfullyVerifiedWithinSla = runs.filter(
    (run) => run.providerVerificationStatus === "VERIFIED" &&
      run.providerVerificationLastSucceededAt &&
      run.providerVerificationLastSucceededAt >= cutoff &&
      currentEvidenceVersion(run)
  );
  const neverSuccessfullyVerified = runs.filter(
    (run) => run.providerVerificationLastSucceededAt === null
  );
  const staleVerification = runs.filter(
    (run) => run.providerVerificationLastSucceededAt !== null &&
      run.providerVerificationLastSucceededAt < cutoff &&
      currentEvidenceVersion(run)
  );
  const evidenceVersionMismatch = runs.filter(
    (run) => run.providerVerificationLastSucceededAt !== null &&
      !currentEvidenceVersion(run)
  );
  const unresolvedFailures = runs.filter(
    (run) => run.providerVerificationStatus === "RETRYABLE_FAILURE"
  );
  const unverifiedStatus = runs.filter(
    (run) => run.providerVerificationStatus !== "VERIFIED"
  );
  const oldestSuccessfulVerificationAt = runs.reduce<Date | null>((oldest, run) => {
    const value = run.providerVerificationLastSucceededAt;
    if (!value) return oldest;
    return !oldest || value < oldest ? value : oldest;
  }, null);

  return {
    eligiblePaidRunCount: runs.length,
    successfullyVerifiedWithinSlaCount: successfullyVerifiedWithinSla.length,
    neverSuccessfullyVerifiedCount: neverSuccessfullyVerified.length,
    staleVerificationCount: staleVerification.length,
    evidenceVersionMismatchCount: evidenceVersionMismatch.length,
    unresolvedFailureCount: unresolvedFailures.length,
    legacyUnverifiedCount: runs.filter(
      (run) => run.providerVerificationStatus === "LEGACY_UNVERIFIED"
    ).length,
    oldestSuccessfulVerificationAt,
    oldestVerificationAgeSeconds: oldestSuccessfulVerificationAt
      ? Math.max(0, Math.floor((now.getTime() - oldestSuccessfulVerificationAt.getTime()) / 1000))
      : null,
    blockedPayrollRunIds: Array.from(new Set([
      ...providerReferenceMissing.map((run) => run.id),
      ...neverSuccessfullyVerified.map((run) => run.id),
      ...staleVerification.map((run) => run.id),
      ...evidenceVersionMismatch.map((run) => run.id),
      ...unverifiedStatus.map((run) => run.id),
    ])),
    unverifiedStatusCount: unverifiedStatus.length,
    providerReferenceMissingCount: providerReferenceMissing.length,
    unverifiedReasonCounts: {
      LEGACY_UNVALIDATED_PROVIDER_EVIDENCE: runs.filter(
        (run) => run.providerVerificationStatus === "LEGACY_UNVERIFIED" && run.providerRef !== null
      ).length,
      LEGACY_PROVIDER_REFERENCE_MISSING: runs.filter(
        (run) => run.providerVerificationStatus === "LEGACY_UNVERIFIED" && run.providerRef === null
      ).length,
      PROVIDER_REFERENCE_MISSING: providerReferenceMissing.length,
      PROVIDER_VERIFICATION_NEVER_SUCCEEDED: neverSuccessfullyVerified.filter(
        (run) => run.providerVerificationStatus !== "LEGACY_UNVERIFIED"
      ).length,
      PROVIDER_VERIFICATION_STALE: staleVerification.length,
      PROVIDER_EVIDENCE_VERSION_OUTDATED: evidenceVersionMismatch.length,
      PROVIDER_EVIDENCE_UNVERIFIED: unverifiedStatus.length,
    },
  };
}

export async function getProviderVerificationBlockedScope(
  companyId: bigint,
  now = new Date()
) {
  const freshness = await getCompanyProviderVerificationFreshness(companyId, now);
  if (freshness.blockedPayrollRunIds.length === 0) {
    return { documentIds: new Set<bigint>(), remittanceIds: new Set<bigint>() };
  }

  const affectedPayHistory = await prisma.payHistory.findMany({
    where: { payrollRunId: { in: freshness.blockedPayrollRunIds } },
    select: { id: true, employeeId: true, payDate: true },
  });
  if (affectedPayHistory.length === 0) {
    return { documentIds: new Set<bigint>(), remittanceIds: new Set<bigint>() };
  }

  const payHistoryIds = affectedPayHistory.map((row) => row.id);
  const [allocatedRemittances, companyRemittances, affectedSlips] = await Promise.all([
    prisma.remittance.findMany({
      where: {
        companyId,
        allocations: { some: { payHistoryId: { in: payHistoryIds } } },
      },
      select: { id: true },
    }),
    prisma.remittance.findMany({
      where: { companyId },
      select: { id: true, periodStart: true, periodEnd: true },
    }),
    prisma.t4Slip.findMany({
      where: {
        companyId,
        OR: affectedPayHistory.map((row) => ({
          employeeId: row.employeeId,
          taxYear: getDateOnlyCalendarYear(row.payDate),
        })),
      },
      select: { id: true, summaryId: true, generationId: true },
    }),
  ]);
  const remittanceIds = new Set(allocatedRemittances.map((row) => row.id));
  for (const remittance of companyRemittances) {
    if (affectedPayHistory.some(
      (row) => row.payDate >= remittance.periodStart && row.payDate <= remittance.periodEnd
    )) {
      remittanceIds.add(remittance.id);
    }
  }
  const summaryIds = Array.from(new Set(
    affectedSlips.flatMap((slip) => slip.summaryId ? [slip.summaryId] : [])
  ));
  const generationIds = Array.from(new Set(
    affectedSlips.flatMap((slip) => slip.generationId ? [slip.generationId] : [])
  ));
  const slipIds = affectedSlips.map((slip) => slip.id);
  const documents = await prisma.document.findMany({
    where: {
      companyId,
      validationStatus: "ACTIVE",
      OR: [
        { remittanceId: { in: Array.from(remittanceIds) } },
        { generationId: { in: generationIds } },
        { t4SummaryId: { in: summaryIds } },
        { t4SlipId: { in: slipIds } },
      ],
    },
    select: { id: true },
  });
  return {
    documentIds: new Set(documents.map((document) => document.id)),
    remittanceIds,
  };
}

export async function getProviderVerificationBlockedDocumentIds(
  companyId: bigint,
  now = new Date()
) {
  return (await getProviderVerificationBlockedScope(companyId, now)).documentIds;
}
