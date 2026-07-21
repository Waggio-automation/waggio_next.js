import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma.ts";
import {
  DEFAULT_TROLLEY_REQUEST_TIMEOUT_MS,
  TrolleyApiError,
  TrolleyRequestTimeoutError,
  listBatchPayments,
  type Payment,
} from "../trolley.ts";
import { buildTrolleyPayHistoryExternalId } from "./trolley-tenancy.ts";
import { getDateOnlyCalendarYear } from "../date-only.ts";
import {
  CompliancePublicationLockTimeoutError,
  lockCompanyComplianceScope,
} from "../payroll/compliance-publication-lock.ts";
import {
  CURRENT_PROVIDER_EVIDENCE_VERSION,
  PROVIDER_VERIFICATION_SLA_MS,
  getProviderVerificationCutoff,
} from "../payroll/provider-evidence-policy.ts";
import {
  createComplianceSourceMembershipFingerprint,
  partitionCompliancePayrollRows,
} from "../payroll/compliance-eligibility.ts";

const TRUSTED_PROVIDER = "trolley";
const TROLLEY_SUCCESS_STATUS = "processed";
const TROLLEY_REVERSAL_STATUSES = new Set(["returned", "failed"]);
export const TROLLEY_REVALIDATION_BATCH_SIZE = 25;
export const TROLLEY_PAID_REVALIDATION_JOB = "trolley-paid-revalidation";
export const TROLLEY_PAID_REVALIDATION_TIME_BUDGET_MS = 20_000;
export const TROLLEY_PAID_REVALIDATION_MIN_LEASE_MS = 5 * 60_000;
export const TROLLEY_PAYING_RECONCILIATION_JOB = "trolley-paying-reconciliation";
export const TROLLEY_PAYING_MAX_RUNS = 10;
export const TROLLEY_PAYING_TIME_BUDGET_MS = 10_000;
export const TROLLEY_PAID_CRON_INTERVAL_MINUTES = 15;
export const TROLLEY_PAID_REVALIDATION_SLA_MINUTES = 24 * 60;
export const TROLLEY_PROVIDER_EVIDENCE_VERSION = CURRENT_PROVIDER_EVIDENCE_VERSION;
export const TROLLEY_PAID_MAX_PROVIDER_REQUESTS = 50;
export const TROLLEY_PAYING_MAX_PROVIDER_REQUESTS = 20;
const TROLLEY_MAX_BOUNDED_RETRY_AFTER_MS = 1_000;

type LoadBatchPayments = (
  batchId: string,
  params: { page: number; pageSize: number; timeoutMs?: number }
) => Promise<{ items: Payment[]; hasMore?: boolean }>;

type ProviderRequestMetrics = {
  attemptedProviderRequests: number;
  successfulProviderRequests: number;
  timedOutRequests: number;
  rateLimitedRequests: number;
  pagesFetched: number;
};

type ProviderRequestBudget = ProviderRequestMetrics & {
  maxProviderRequestsPerInvocation: number;
};

function emptyProviderRequestMetrics(): ProviderRequestMetrics {
  return {
    attemptedProviderRequests: 0,
    successfulProviderRequests: 0,
    timedOutRequests: 0,
    rateLimitedRequests: 0,
    pagesFetched: 0,
  };
}

function metricDelta(
  budget: ProviderRequestBudget,
  before: ProviderRequestMetrics
): ProviderRequestMetrics {
  return {
    attemptedProviderRequests:
      budget.attemptedProviderRequests - before.attemptedProviderRequests,
    successfulProviderRequests:
      budget.successfulProviderRequests - before.successfulProviderRequests,
    timedOutRequests: budget.timedOutRequests - before.timedOutRequests,
    rateLimitedRequests: budget.rateLimitedRequests - before.rateLimitedRequests,
    pagesFetched: budget.pagesFetched - before.pagesFetched,
  };
}

type VerificationAttemptContext = {
  jobName: string;
  attemptedAt: Date;
  completedAt: Date;
  metrics: ProviderRequestMetrics;
};

export class PayrollPaymentReconciliationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PayrollPaymentReconciliationError";
    this.code = code;
  }
}

function reconciliationError(code: string, message: string): never {
  throw new PayrollPaymentReconciliationError(code, message);
}

function paymentStatus(payment: Payment) {
  return payment.status?.trim().toLowerCase() ?? "";
}

function parseProviderDate(value: string | null | undefined, reasonCode: string) {
  if (!value) reconciliationError(reasonCode, "Provider payment timestamp is missing.");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    reconciliationError(reasonCode, "Provider payment timestamp is invalid.");
  }
  return parsed;
}

function assertPaymentIdentity(params: {
  payment: Payment;
  providerRef: string;
  companyId: bigint;
  payrollRunId: bigint;
  payHistory: { id: bigint; netPay: Prisma.Decimal };
  expectedCurrency: string;
}) {
  const { payment, providerRef, companyId, payrollRunId, payHistory, expectedCurrency } = params;
  const responseBatchId = payment.batch?.id ?? payment.batchId;
  if (responseBatchId !== providerRef) {
    reconciliationError("PROVIDER_BATCH_ID_MISMATCH", "Payment batch identity does not match the payroll run.");
  }

  const expectedExternalId = buildTrolleyPayHistoryExternalId({
    companyId,
    payHistoryId: payHistory.id,
  });
  if (payment.externalId !== expectedExternalId) {
    reconciliationError("PROVIDER_EXTERNAL_ID_MISMATCH", "Payment external identity does not match pay history.");
  }

  if (payment.metadata) {
    const expectedMetadata = {
      companyId: companyId.toString(),
      payrollRunId: payrollRunId.toString(),
      payHistoryId: payHistory.id.toString(),
    };
    for (const [key, expected] of Object.entries(expectedMetadata)) {
      if (payment.metadata[key] !== expected) {
        reconciliationError("PROVIDER_METADATA_MISMATCH", `Payment metadata ${key} does not match payroll.`);
      }
    }
  }

  const amount = payment.sourceAmount ?? payment.amount;
  if (!amount) reconciliationError("PROVIDER_AMOUNT_MISSING", "Provider payment amount is missing.");
  let providerAmount: Prisma.Decimal;
  try {
    providerAmount = new Prisma.Decimal(amount);
  } catch {
    reconciliationError("PROVIDER_AMOUNT_INVALID", "Provider payment amount is invalid.");
  }
  if (!providerAmount.equals(payHistory.netPay)) {
    reconciliationError("PROVIDER_AMOUNT_MISMATCH", "Provider payment amount does not match net pay.");
  }

  const currency = (payment.sourceCurrency ?? payment.currency)?.toUpperCase();
  if (currency !== expectedCurrency.toUpperCase()) {
    reconciliationError("PROVIDER_CURRENCY_MISMATCH", "Provider payment currency does not match payroll currency.");
  }
}

function remittanceSnapshot(remittance: {
  employeeCount: number;
  totalIncomeTax: Prisma.Decimal;
  totalCppEmployee: Prisma.Decimal;
  totalCppEmployer: Prisma.Decimal;
  totalEiEmployee: Prisma.Decimal;
  totalEiEmployer: Prisma.Decimal;
  totalPayable: Prisma.Decimal;
  sourceFingerprint: string | null;
  sourceVersion: string | null;
  reportPublishedAt: Date | null;
}) {
  return {
    employeeCount: remittance.employeeCount,
    totalIncomeTax: remittance.totalIncomeTax.toFixed(2),
    totalCppEmployee: remittance.totalCppEmployee.toFixed(2),
    totalCppEmployer: remittance.totalCppEmployer.toFixed(2),
    totalEiEmployee: remittance.totalEiEmployee.toFixed(2),
    totalEiEmployer: remittance.totalEiEmployer.toFixed(2),
    totalPayable: remittance.totalPayable.toFixed(2),
    sourceFingerprint: remittance.sourceFingerprint,
    sourceVersion: remittance.sourceVersion,
    reportPublishedAt: remittance.reportPublishedAt?.toISOString() ?? null,
  };
}

async function quarantineAffectedT4Packages(
  tx: Prisma.TransactionClient,
  params: {
    companyId: bigint;
    payHistory: Array<{ employeeId: bigint; payDate: Date }>;
    reasonCode: string;
    providerStatus?: string;
    reviewedAt: Date;
    summaryIds?: bigint[];
  }
) {
  const explicitSummaryIds = params.summaryIds
    ? Array.from(new Set(params.summaryIds.map((id) => id.toString()))).map((id) => BigInt(id))
    : null;
  const slipKeys = params.payHistory.map((row) => ({
    employeeId: row.employeeId,
    taxYear: getDateOnlyCalendarYear(row.payDate),
  }));
  if (!explicitSummaryIds && slipKeys.length === 0) {
    return { summaryCount: 0, slipCount: 0, documentCount: 0, packageCount: 0 };
  }

  const affectedSlips = await tx.t4Slip.findMany({
    where: explicitSummaryIds
      ? { companyId: params.companyId, summaryId: { in: explicitSummaryIds } }
      : { companyId: params.companyId, OR: slipKeys },
    select: { id: true, summaryId: true, generationId: true },
  });
  const affectedSummaryIds = explicitSummaryIds ?? Array.from(new Set(
    affectedSlips.flatMap((slip) => slip.summaryId ? [slip.summaryId] : [])
  ));
  const affectedSummaries = affectedSummaryIds.length === 0 ? [] : await tx.t4Summary.findMany({
    where: { companyId: params.companyId, id: { in: affectedSummaryIds } },
    select: { id: true, generationId: true },
  });

  const packageScopes = new Map<string, { generationId: string | null; summaryId: bigint | null }>();
  for (const summary of affectedSummaries) {
    const generationId = summary.generationId ?? affectedSlips.find(
      (slip) => slip.summaryId === summary.id && slip.generationId
    )?.generationId ?? null;
    const key = generationId ? `generation:${generationId}` : `summary:${summary.id.toString()}`;
    packageScopes.set(key, { generationId, summaryId: summary.id });
  }
  for (const slip of affectedSlips.filter((row) => row.summaryId === null && row.generationId)) {
    packageScopes.set(`generation:${slip.generationId}`, {
      generationId: slip.generationId,
      summaryId: null,
    });
  }

  let summaryCount = 0;
  let slipCount = 0;
  let documentCount = 0;
  for (const scope of packageScopes.values()) {
    const summaries = await tx.t4Summary.findMany({
      where: scope.generationId
        ? { companyId: params.companyId, generationId: scope.generationId }
        : { companyId: params.companyId, id: scope.summaryId! },
      select: { id: true, status: true },
    });
    const summaryIds = summaries.map((summary) => summary.id);
    const slips = await tx.t4Slip.findMany({
      where: scope.generationId
        ? { companyId: params.companyId, generationId: scope.generationId }
        : { companyId: params.companyId, summaryId: { in: summaryIds } },
      select: { id: true, status: true },
    });
    const slipIds = slips.map((slip) => slip.id);

    const t4DocumentShape: Prisma.DocumentWhereInput = {
      OR: [
        { documentType: { in: ["T4_SLIP", "T4_SUMMARY"] } },
        {
          documentType: "OTHER",
          mimeType: "application/xml",
          linkedEntityType: "T4_SUMMARY",
          t4SummaryId: { not: null },
        },
      ],
    };
    const quarantinedDocuments = await tx.document.updateMany({
      where: {
        companyId: params.companyId,
        validationStatus: "ACTIVE",
        AND: [
          t4DocumentShape,
          scope.generationId
            ? { generationId: scope.generationId }
            : {
              OR: [
                { t4SummaryId: { in: summaryIds } },
                { t4SlipId: { in: slipIds } },
              ],
            },
        ],
      },
      data: {
        validationStatus: "QUARANTINED",
        validationReason: params.reasonCode,
        quarantinedAt: params.reviewedAt,
      },
    });
    await tx.t4Slip.updateMany({
      where: { id: { in: slipIds }, status: { not: "FINALIZED" } },
      data: { status: "QUARANTINED" },
    });
    await tx.t4Summary.updateMany({
      where: { id: { in: summaryIds }, status: { not: "FINALIZED" } },
      data: { status: "QUARANTINED" },
    });

    const auditSummaryId = scope.summaryId ?? summaryIds[0] ?? null;
    if (auditSummaryId) {
      await tx.auditLog.create({
        data: {
          companyId: params.companyId,
          actorType: "SYSTEM",
          action: "T4_PROVIDER_PAYMENT_REVIEW_REQUIRED",
          targetType: "T4Summary",
          targetId: auditSummaryId.toString(),
          metadataJson: {
            reasonCode: params.reasonCode,
            providerStatus: params.providerStatus ?? null,
            generationId: scope.generationId,
            affectedSummaryCount: summaries.length,
            affectedSlipCount: slips.length,
            affectedDocumentCount: quarantinedDocuments.count,
            finalizedSummaryCount: summaries.filter((summary) => summary.status === "FINALIZED").length,
            finalizedSlipCount: slips.filter((slip) => slip.status === "FINALIZED").length,
          },
        },
      });
    }
    summaryCount += summaries.length;
    slipCount += slips.length;
    documentCount += quarantinedDocuments.count;
  }

  return {
    summaryCount,
    slipCount,
    documentCount,
    packageCount: packageScopes.size,
  };
}

async function quarantinePreviouslyPaidRun(
  tx: Prisma.TransactionClient,
  params: {
    companyId: bigint;
    payrollRunId: bigint;
    providerRef: string;
    reasonCode: string;
    providerStatus?: string;
    payHistory: Array<{ id: bigint; employeeId: bigint; payDate: Date }>;
  }
) {
  const reviewedAt = new Date();
  const payHistoryIds = params.payHistory.map((row) => row.id);

  await tx.payHistory.updateMany({
    where: { id: { in: payHistoryIds }, payrollRunId: params.payrollRunId },
    data: {
      status: "REVIEW_REQUIRED",
      failureReason: params.reasonCode,
    },
  });
  await tx.payrollRun.update({
    where: { id: params.payrollRunId },
    data: {
      status: "REVIEW_REQUIRED",
      failureType: "EMPLOYEE",
      failureReason: params.reasonCode,
    },
  });

  const remittances = await tx.remittance.findMany({
    where: { allocations: { some: { payHistoryId: { in: payHistoryIds } } } },
  });
  for (const remittance of remittances) {
    const priorPublishedSnapshot = remittanceSnapshot(remittance);
    await tx.document.updateMany({
      where: {
        remittanceId: remittance.id,
        documentType: "REMITTANCE_REPORT",
        validationStatus: "ACTIVE",
      },
      data: {
        validationStatus: "QUARANTINED",
        validationReason: params.reasonCode,
        quarantinedAt: reviewedAt,
      },
    });
    await tx.remittancePayHistory.deleteMany({ where: { remittanceId: remittance.id } });
    await tx.reminderEvent.deleteMany({ where: { remittanceId: remittance.id, sentAt: null } });
    await tx.remittance.update({
      where: { id: remittance.id },
      data: {
        status: "REVIEW_REQUIRED",
        reviewRequiredAt: reviewedAt,
        reconciliationSummary: {
          reasonCode: params.reasonCode,
          provider: TRUSTED_PROVIDER,
          providerStatus: params.providerStatus ?? null,
          priorPublishedSnapshot,
        },
      },
    });
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        actorType: "SYSTEM",
        action: "REMITTANCE_PROVIDER_PAYMENT_REVIEW_REQUIRED",
        targetType: "Remittance",
        targetId: remittance.id.toString(),
        metadataJson: {
          reasonCode: params.reasonCode,
          providerStatus: params.providerStatus ?? null,
          priorPublishedSnapshot,
        },
      },
    });
  }

  const t4Quarantine = await quarantineAffectedT4Packages(tx, {
    companyId: params.companyId,
    payHistory: params.payHistory,
    reasonCode: params.reasonCode,
    providerStatus: params.providerStatus,
    reviewedAt,
  });

  await tx.auditLog.create({
    data: {
      companyId: params.companyId,
      actorType: "SYSTEM",
      action: "PAYROLL_PROVIDER_PAYMENT_REVIEW_REQUIRED",
      targetType: "PayrollRun",
      targetId: params.payrollRunId.toString(),
      metadataJson: {
        reasonCode: params.reasonCode,
        provider: TRUSTED_PROVIDER,
        providerStatus: params.providerStatus ?? null,
        affectedRemittanceCount: remittances.length,
        affectedT4PackageCount: t4Quarantine.packageCount,
        affectedT4SummaryCount: t4Quarantine.summaryCount,
        affectedT4SlipCount: t4Quarantine.slipCount,
        affectedT4DocumentCount: t4Quarantine.documentCount,
      },
    },
  });

  return {
    payrollRunId: params.payrollRunId,
    eligibleChildCount: 0,
    changed: true,
    reviewRequired: true,
    reasonCode: params.reasonCode,
  };
}

const ELIGIBILITY_GAIN_REASON = "PROVIDER_ELIGIBILITY_GAIN_INVALIDATED_ARTIFACT";

async function quarantineArtifactsInvalidatedByEligibilityGain(
  tx: Prisma.TransactionClient,
  params: {
    companyId: bigint;
    payrollRunId: bigint;
    payHistory: Array<{ id: bigint; employeeId: bigint; payDate: Date }>;
    verifiedAt: Date;
  }
) {
  const reviewedAt = params.verifiedAt;
  const affectedDates = Array.from(new Set(
    params.payHistory.map((row) => row.payDate.toISOString())
  )).map((value) => new Date(value));
  const remittances = affectedDates.length === 0 ? [] : await tx.remittance.findMany({
    where: {
      companyId: params.companyId,
      status: { not: "REVIEW_REQUIRED" },
      documents: {
        some: { documentType: "REMITTANCE_REPORT", validationStatus: "ACTIVE" },
      },
      OR: affectedDates.map((payDate) => ({
        periodStart: { lte: payDate },
        periodEnd: { gte: payDate },
      })),
    },
    include: {
      allocations: { select: { payHistoryId: true } },
      payments: { where: { status: "RECORDED" }, select: { id: true } },
    },
  });
  let remittanceCount = 0;
  let remittanceDocumentCount = 0;
  for (const remittance of remittances) {
    const affectedIdsInPeriod = params.payHistory
      .filter((row) => row.payDate >= remittance.periodStart && row.payDate <= remittance.periodEnd)
      .map((row) => row.id.toString());
    const allocatedIds = new Set(
      remittance.allocations.map((allocation) => allocation.payHistoryId.toString())
    );
    if (affectedIdsInPeriod.every((id) => allocatedIds.has(id))) continue;

    const priorPublishedSnapshot = remittanceSnapshot(remittance);
    const quarantinedDocuments = await tx.document.updateMany({
      where: {
        remittanceId: remittance.id,
        documentType: "REMITTANCE_REPORT",
        validationStatus: "ACTIVE",
      },
      data: {
        validationStatus: "QUARANTINED",
        validationReason: ELIGIBILITY_GAIN_REASON,
        quarantinedAt: reviewedAt,
      },
    });
    await tx.remittancePayHistory.deleteMany({ where: { remittanceId: remittance.id } });
    await tx.reminderEvent.deleteMany({ where: { remittanceId: remittance.id, sentAt: null } });
    await tx.remittance.update({
      where: { id: remittance.id },
      data: {
        status: "REVIEW_REQUIRED",
        reviewRequiredAt: reviewedAt,
        reconciliationSummary: {
          reasonCode: ELIGIBILITY_GAIN_REASON,
          recordedPaymentCount: remittance.payments.length,
          priorPublishedSnapshot,
        },
      },
    });
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        actorType: "SYSTEM",
        action: "REMITTANCE_PROVIDER_ELIGIBILITY_GAIN_REVIEW_REQUIRED",
        targetType: "Remittance",
        targetId: remittance.id.toString(),
        metadataJson: {
          reasonCode: ELIGIBILITY_GAIN_REASON,
          recordedPaymentCount: remittance.payments.length,
          priorPublishedSnapshot,
          affectedDocumentCount: quarantinedDocuments.count,
        },
      },
    });
    remittanceCount += 1;
    remittanceDocumentCount += quarantinedDocuments.count;
  }

  const affectedTaxYears = Array.from(new Set(
    params.payHistory.map((row) => getDateOnlyCalendarYear(row.payDate))
  ));
  const mismatchedSummaryIds: bigint[] = [];
  const verificationCutoff = getProviderVerificationCutoff(params.verifiedAt);
  for (const taxYear of affectedTaxYears) {
    const rangeStart = new Date(Date.UTC(taxYear, 0, 1));
    const rangeEnd = new Date(Date.UTC(taxYear + 1, 0, 1));
    const currentRows = await tx.payHistory.findMany({
      where: {
        employee: { companyId: params.companyId },
        payDate: { gte: rangeStart, lt: rangeEnd },
      },
      select: {
        id: true,
        payrollRunId: true,
        status: true,
        paidAt: true,
        paymentProvider: true,
        paymentRef: true,
        payrollRun: {
          select: {
            status: true,
            companyId: true,
            providerRef: true,
            providerVerificationStatus: true,
            providerVerificationLastSucceededAt: true,
            providerEvidenceVersion: true,
          },
        },
      },
    });
    const selection = partitionCompliancePayrollRows(
      currentRows,
      params.companyId,
      verificationCutoff
    );
    const currentMembershipFingerprint =
      createComplianceSourceMembershipFingerprint(selection.included);
    const summary = await tx.t4Summary.findUnique({
      where: { companyId_taxYear: { companyId: params.companyId, taxYear } },
      select: { id: true, validationSummary: true },
    });
    if (!summary) continue;
    const publishedMembershipFingerprint = (
      summary.validationSummary as { sourceMembershipFingerprint?: string } | null
    )?.sourceMembershipFingerprint;
    if (publishedMembershipFingerprint !== currentMembershipFingerprint) {
      mismatchedSummaryIds.push(summary.id);
    }
  }

  const t4Quarantine = mismatchedSummaryIds.length === 0
    ? { summaryCount: 0, slipCount: 0, documentCount: 0, packageCount: 0 }
    : await quarantineAffectedT4Packages(tx, {
      companyId: params.companyId,
      payHistory: params.payHistory,
      summaryIds: mismatchedSummaryIds,
      reasonCode: ELIGIBILITY_GAIN_REASON,
      providerStatus: TROLLEY_SUCCESS_STATUS,
      reviewedAt,
    });

  if (remittanceCount > 0 || t4Quarantine.packageCount > 0) {
    await tx.auditLog.create({
      data: {
        companyId: params.companyId,
        actorType: "SYSTEM",
        action: "PAYROLL_PROVIDER_ELIGIBILITY_GAIN_INVALIDATED_ARTIFACTS",
        targetType: "PayrollRun",
        targetId: params.payrollRunId.toString(),
        metadataJson: {
          reasonCode: ELIGIBILITY_GAIN_REASON,
          affectedRemittanceCount: remittanceCount,
          affectedRemittanceDocumentCount: remittanceDocumentCount,
          affectedT4PackageCount: t4Quarantine.packageCount,
          affectedT4SummaryCount: t4Quarantine.summaryCount,
          affectedT4SlipCount: t4Quarantine.slipCount,
          affectedT4DocumentCount: t4Quarantine.documentCount,
        },
      },
    });
  }

  return { remittanceCount, remittanceDocumentCount, t4Quarantine };
}

async function auditRejectedReconciliation(params: {
  companyId: bigint;
  payrollRunId: bigint;
  reasonCode: string;
}) {
  await prisma.auditLog.create({
    data: {
      companyId: params.companyId,
      actorType: "SYSTEM",
      action: "PAYROLL_PROVIDER_PAYMENT_RECONCILIATION_REJECTED",
      targetType: "PayrollRun",
      targetId: params.payrollRunId.toString(),
      metadataJson: {
        reasonCode: params.reasonCode,
        provider: TRUSTED_PROVIDER,
      },
    },
  });
}

function verificationAttemptData(params: {
  companyId: bigint;
  payrollRunId: bigint;
  context: VerificationAttemptContext;
  outcome: "SUCCEEDED" | "FAILED_RETRYABLE" | "REVIEW_REQUIRED";
  failureCode?: string | null;
}) {
  return {
    companyId: params.companyId,
    payrollRunId: params.payrollRunId,
    jobName: params.context.jobName,
    outcome: params.outcome,
    failureCode: params.failureCode ?? null,
    providerEvidenceVersion: TROLLEY_PROVIDER_EVIDENCE_VERSION,
    ...params.context.metrics,
    attemptedAt: params.context.attemptedAt,
    completedAt: params.context.completedAt,
  } as const;
}

async function persistRetryableVerificationFailure(params: {
  companyId: bigint;
  payrollRunId: bigint;
  reasonCode: string;
  context: VerificationAttemptContext;
}) {
  await prisma.$transaction(async (tx) => {
    await lockCompanyComplianceScope(tx, params.companyId, [params.payrollRunId]);
    await tx.payrollRun.update({
      where: { id: params.payrollRunId, companyId: params.companyId },
      data: {
        providerVerificationLastAttemptAt: params.context.completedAt,
        providerVerificationFailureCode: params.reasonCode,
        providerVerificationConsecutiveFailures: { increment: 1 },
        providerVerificationStatus: "RETRYABLE_FAILURE",
        providerEvidenceVersion: TROLLEY_PROVIDER_EVIDENCE_VERSION,
      },
    });
    await tx.payrollProviderVerificationAttempt.create({
      data: verificationAttemptData({
        companyId: params.companyId,
        payrollRunId: params.payrollRunId,
        context: params.context,
        outcome: "FAILED_RETRYABLE",
        failureCode: params.reasonCode,
      }),
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function applyTrustedPayrollPaymentEvidence(params: {
  companyId: bigint;
  payrollRunId: bigint;
  providerRef: string;
  payments: Payment[];
  verification: VerificationAttemptContext;
  testHooks?: {
    afterPayrollRunLocked?: () => Promise<void>;
    publicationLockTimeoutMs?: number;
  };
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockCompanyComplianceScope(tx, params.companyId, [params.payrollRunId], {
        timeoutMs: params.testHooks?.publicationLockTimeoutMs,
      });
      await params.testHooks?.afterPayrollRunLocked?.();
      const run = await tx.payrollRun.findFirst({
        where: {
          id: params.payrollRunId,
          companyId: params.companyId,
          providerRef: params.providerRef,
        },
        select: {
          id: true,
          status: true,
          company: {
            select: {
              settings: { select: { defaultPayoutCurrency: true } },
            },
          },
          payHistory: {
            orderBy: { id: "asc" },
            select: {
              id: true,
              employeeId: true,
              payDate: true,
              netPay: true,
              status: true,
              paidAt: true,
              paymentProvider: true,
              paymentRef: true,
            },
          },
        },
      });
      if (!run) reconciliationError("PROVIDER_SCOPE_MISMATCH", "Payroll run does not match provider scope.");
      if (run.payHistory.length === 0) reconciliationError("EMPTY_PAYROLL_RUN", "Payroll run has no child payments.");
      if (!["PAYING", "PAID"].includes(run.status)) {
        reconciliationError("INVALID_PARENT_STATUS", `Payroll run cannot reconcile from ${run.status}.`);
      }

      const reviewPaidRun = async (error: PayrollPaymentReconciliationError, providerStatus?: string) => {
        if (run.status !== "PAID") throw error;
        const reviewed = await quarantinePreviouslyPaidRun(tx, {
          companyId: params.companyId,
          payrollRunId: run.id,
          providerRef: params.providerRef,
          reasonCode: error.code,
          providerStatus,
          payHistory: run.payHistory,
        });
        await tx.payrollRun.update({
          where: { id: run.id },
          data: {
            providerVerificationLastAttemptAt: params.verification.completedAt,
            providerVerificationFailureCode: error.code,
            providerVerificationConsecutiveFailures: { increment: 1 },
            providerVerificationStatus: "REVIEW_REQUIRED",
            providerEvidenceVersion: TROLLEY_PROVIDER_EVIDENCE_VERSION,
          },
        });
        await tx.payrollProviderVerificationAttempt.create({
          data: verificationAttemptData({
            companyId: params.companyId,
            payrollRunId: run.id,
            context: params.verification,
            outcome: "REVIEW_REQUIRED",
            failureCode: error.code,
          }),
        });
        return reviewed;
      };

      const childReferences = run.payHistory.map((row) => row.paymentRef ?? "");
      if (childReferences.some((reference) => reference.trim().length === 0)) {
        return reviewPaidRun(new PayrollPaymentReconciliationError(
          "MISSING_CHILD_PROVIDER_REFERENCE",
          "At least one child has no trusted provider reference."
        ));
      }
      if (new Set(childReferences).size !== childReferences.length) {
        return reviewPaidRun(new PayrollPaymentReconciliationError(
          "DUPLICATE_CHILD_PROVIDER_REFERENCE",
          "Provider payment references are not unique within the payroll run."
        ));
      }
      const providerIds = params.payments.map((payment) => payment.id ?? "");
      if (providerIds.some((id) => id.trim().length === 0)) {
        return reviewPaidRun(new PayrollPaymentReconciliationError(
          "PROVIDER_PAYMENT_ID_MISSING",
          "Provider response contains a payment without an ID."
        ));
      }
      if (new Set(providerIds).size !== providerIds.length) {
        return reviewPaidRun(new PayrollPaymentReconciliationError(
          "DUPLICATE_PROVIDER_PAYMENT_ID",
          "Provider response contains duplicate payment IDs."
        ));
      }

      const childReferenceSet = new Set(childReferences);
      const providerIdSet = new Set(providerIds);
      if (childReferences.some((reference) => !providerIdSet.has(reference))) {
        return reviewPaidRun(new PayrollPaymentReconciliationError(
          "MISSING_PROVIDER_PAYMENT_EVIDENCE",
          "At least one expected child payment is absent from the provider response."
        ));
      }
      if (
        providerIds.some((id) => !childReferenceSet.has(id)) ||
        providerIdSet.size !== childReferenceSet.size
      ) {
        return reviewPaidRun(new PayrollPaymentReconciliationError(
          "UNEXPECTED_PROVIDER_PAYMENT",
          "Provider response contains a payment outside this payroll run."
        ));
      }

      const paymentById = new Map(params.payments.map((payment) => [payment.id, payment]));
      const expectedCurrency = run.company?.settings?.defaultPayoutCurrency ?? "CAD";
      const matched: Array<{ row: typeof run.payHistory[number]; payment: Payment; processedAt: Date }> = [];

      for (const row of run.payHistory) {
        if (row.paymentProvider !== TRUSTED_PROVIDER) {
          return reviewPaidRun(new PayrollPaymentReconciliationError(
            "UNTRUSTED_CHILD_PAYMENT_PROVIDER",
            `Pay history ${row.id.toString()} is not linked to Trolley.`
          ));
        }
        if (!["SENDING", "SENT", "EMAIL_SENT"].includes(row.status)) {
          return reviewPaidRun(new PayrollPaymentReconciliationError(
            "PAID_PARENT_CHILD_STATUS_CONFLICT",
            `Pay history ${row.id.toString()} has contradictory status ${row.status}.`
          ));
        }

        const payment = paymentById.get(row.paymentRef!);
        if (!payment) {
          return reviewPaidRun(new PayrollPaymentReconciliationError(
            "MISSING_PROVIDER_PAYMENT_EVIDENCE",
            `Pay history ${row.id.toString()} has no matching provider response.`
          ));
        }
        try {
          assertPaymentIdentity({
            payment,
            providerRef: params.providerRef,
            companyId: params.companyId,
            payrollRunId: run.id,
            payHistory: row,
            expectedCurrency,
          });
        } catch (error) {
          if (error instanceof PayrollPaymentReconciliationError) {
            return reviewPaidRun(error, paymentStatus(payment));
          }
          throw error;
        }

        const status = paymentStatus(payment);
        if (TROLLEY_REVERSAL_STATUSES.has(status)) {
          return reviewPaidRun(new PayrollPaymentReconciliationError(
            status === "returned" ? "TROLLEY_PAYMENT_RETURNED" : "TROLLEY_PAYMENT_FAILED",
            `Provider payment entered terminal ${status} state.`
          ), status);
        }
        if (status !== TROLLEY_SUCCESS_STATUS) {
          return reviewPaidRun(new PayrollPaymentReconciliationError(
            "PROVIDER_PAYMENT_NOT_PROCESSED",
            `Provider payment status ${status || "missing"} is not successful.`
          ), status);
        }

        let processedAt: Date;
        try {
          processedAt = parseProviderDate(payment.processedAt, "PROVIDER_PROCESSED_AT_MISSING");
        } catch (error) {
          if (error instanceof PayrollPaymentReconciliationError) {
            return reviewPaidRun(error, status);
          }
          throw error;
        }
        matched.push({ row, payment, processedAt });
      }

      let childTransitions = 0;
      for (const { row, payment, processedAt } of matched) {
        const needsUpdate =
          row.status === "SENDING" ||
          !row.paidAt ||
          row.paidAt.getTime() !== processedAt.getTime();
        if (!needsUpdate) continue;
        const updated = await tx.payHistory.updateMany({
          where: {
            id: row.id,
            payrollRunId: run.id,
            paymentProvider: TRUSTED_PROVIDER,
            paymentRef: payment.id,
            status: { in: ["SENDING", "SENT", "EMAIL_SENT"] },
          },
          data: {
            status: row.status === "EMAIL_SENT" ? "EMAIL_SENT" : "SENT",
            paidAt: processedAt,
            failureReason: null,
          },
        });
        if (updated.count !== 1) {
          reconciliationError("CONCURRENT_CHILD_UPDATE", "Child payment changed during reconciliation.");
        }
        childTransitions += 1;
      }

      const verifiedChildren = await tx.payHistory.findMany({
        where: { payrollRunId: run.id },
        select: { id: true, status: true, paidAt: true, paymentProvider: true, paymentRef: true },
      });
      const verifiedReferences = verifiedChildren.map((row) => row.paymentRef).filter(Boolean) as string[];
      const allChildrenVerified =
        verifiedChildren.length === run.payHistory.length &&
        verifiedChildren.every((row) =>
          ["SENT", "EMAIL_SENT"].includes(row.status) &&
          row.paidAt !== null &&
          row.paymentProvider === TRUSTED_PROVIDER &&
          row.paymentRef !== null
        ) &&
        verifiedReferences.length === verifiedChildren.length &&
        new Set(verifiedReferences).size === verifiedReferences.length;
      if (!allChildrenVerified) {
        reconciliationError("POST_UPDATE_CHILD_INVARIANT_FAILED", "Child payment invariant failed after update.");
      }

      const parent = await tx.payrollRun.updateMany({
        where: {
          id: run.id,
          companyId: params.companyId,
          providerRef: params.providerRef,
          status: "PAYING",
        },
        data: { status: "PAID", failureType: null, failureReason: null },
      });
      if (run.status === "PAYING" && parent.count !== 1) {
        reconciliationError("CONCURRENT_PARENT_UPDATE", "Parent payroll changed during reconciliation.");
      }

      await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          providerVerificationLastAttemptAt: params.verification.completedAt,
          providerVerificationLastSucceededAt: params.verification.completedAt,
          providerVerificationFailureCode: null,
          providerVerificationConsecutiveFailures: 0,
          providerVerificationStatus: "VERIFIED",
          providerEvidenceVersion: TROLLEY_PROVIDER_EVIDENCE_VERSION,
        },
      });
      await tx.payrollProviderVerificationAttempt.create({
        data: verificationAttemptData({
          companyId: params.companyId,
          payrollRunId: run.id,
          context: params.verification,
          outcome: "SUCCEEDED",
        }),
      });
      const eligibilityGain = await quarantineArtifactsInvalidatedByEligibilityGain(tx, {
        companyId: params.companyId,
        payrollRunId: run.id,
        payHistory: run.payHistory,
        verifiedAt: params.verification.completedAt,
      });

      if (
        parent.count > 0 ||
        childTransitions > 0 ||
        eligibilityGain.remittanceCount > 0 ||
        eligibilityGain.t4Quarantine.packageCount > 0
      ) {
        await tx.auditLog.create({
          data: {
            companyId: params.companyId,
            actorType: "SYSTEM",
            action: "PAYROLL_PROVIDER_PAYMENT_RECONCILED",
            targetType: "PayrollRun",
            targetId: run.id.toString(),
            metadataJson: {
              provider: TRUSTED_PROVIDER,
              providerStatus: TROLLEY_SUCCESS_STATUS,
              evidenceCount: matched.length,
              childTransitions,
              parentTransitioned: parent.count === 1,
              invalidatedRemittanceCount: eligibilityGain.remittanceCount,
              invalidatedT4PackageCount: eligibilityGain.t4Quarantine.packageCount,
            },
          },
        });
      }

      return {
        payrollRunId: run.id,
        eligibleChildCount: matched.length,
        changed:
          parent.count > 0 ||
          childTransitions > 0 ||
          eligibilityGain.remittanceCount > 0 ||
          eligibilityGain.t4Quarantine.packageCount > 0,
        reviewRequired: false,
      };
    }, {
      // A fresh statement snapshot after the shared advisory lock is required to see
      // CRA artifacts committed by a publisher that held the lock first.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  } catch (error) {
    const reasonCode = error instanceof PayrollPaymentReconciliationError
      ? error.code
      : error instanceof CompliancePublicationLockTimeoutError
        ? error.code
      : "PAYMENT_RECONCILIATION_TRANSACTION_FAILED";
    await auditRejectedReconciliation({
      companyId: params.companyId,
      payrollRunId: params.payrollRunId,
      reasonCode,
    }).catch(() => undefined);
    throw error;
  }
}

export async function reconcilePayrollRunFromTrolley(
  payrollRunId: bigint,
  options: {
    loadBatchPayments?: LoadBatchPayments;
    requestTimeoutMs?: number;
    deadlineMs?: number;
    clock?: () => number;
    now?: () => Date;
    jobName?: string;
    requestBudget?: ProviderRequestBudget;
    testHooks?: {
      afterPayrollRunLocked?: () => Promise<void>;
      publicationLockTimeoutMs?: number;
    };
  } = {}
) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: payrollRunId },
    select: { id: true, companyId: true, providerRef: true, status: true },
  });
  if (!run?.companyId || !run.providerRef) {
    throw new PayrollPaymentReconciliationError(
      "MISSING_PROVIDER_SCOPE",
      "Payroll run is missing company or provider batch identity."
    );
  }
  if (!["PAYING", "PAID"].includes(run.status)) {
    throw new PayrollPaymentReconciliationError(
      "INVALID_PARENT_STATUS",
      `Payroll run ${run.id.toString()} is not eligible for provider reconciliation.`
    );
  }

  const loadBatchPayments = options.loadBatchPayments ?? listBatchPayments;
  const clock = options.clock ?? Date.now;
  const now = options.now ?? (() => new Date());
  const attemptedAt = now();
  const requestBudget = options.requestBudget ?? {
    maxProviderRequestsPerInvocation: 100,
    ...emptyProviderRequestMetrics(),
  };
  const beforeMetrics = { ...requestBudget };
  const payments: Payment[] = [];
  try {
    for (let page = 1; page <= 100; page += 1) {
      let response: Awaited<ReturnType<LoadBatchPayments>>;
      let boundedRateLimitRetryAvailable = true;
      while (true) {
        const remainingMs = options.deadlineMs === undefined
          ? undefined
          : options.deadlineMs - clock();
        if (remainingMs !== undefined && remainingMs <= 1) {
          throw new PayrollPaymentReconciliationError(
            "TROLLEY_RECONCILIATION_BUDGET_EXHAUSTED",
            "Provider reconciliation invocation budget was exhausted."
          );
        }
        if (
          requestBudget.attemptedProviderRequests >=
          requestBudget.maxProviderRequestsPerInvocation
        ) {
          throw new PayrollPaymentReconciliationError(
            "TROLLEY_PROVIDER_REQUEST_BUDGET_EXHAUSTED",
            "Provider request budget was exhausted."
          );
        }
        const timeoutMs = Math.max(1, Math.min(
          options.requestTimeoutMs ?? DEFAULT_TROLLEY_REQUEST_TIMEOUT_MS,
          remainingMs ?? Number.POSITIVE_INFINITY
        ));
        requestBudget.attemptedProviderRequests += 1;
        try {
          response = await loadBatchPayments(run.providerRef, {
            page,
            pageSize: 100,
            timeoutMs,
          });
          requestBudget.successfulProviderRequests += 1;
          requestBudget.pagesFetched += 1;
          break;
        } catch (error) {
          if (error instanceof TrolleyRequestTimeoutError) {
            requestBudget.timedOutRequests += 1;
          }
          if (error instanceof TrolleyApiError && error.status === 429) {
            requestBudget.rateLimitedRequests += 1;
            const retryAfterMs = error.retryAfterMs;
            const remainingAfterFailureMs = options.deadlineMs === undefined
              ? undefined
              : options.deadlineMs - clock();
            const canRetryWithinBounds =
              boundedRateLimitRetryAvailable &&
              retryAfterMs !== undefined &&
              retryAfterMs <= TROLLEY_MAX_BOUNDED_RETRY_AFTER_MS &&
              requestBudget.attemptedProviderRequests <
                requestBudget.maxProviderRequestsPerInvocation &&
              (remainingAfterFailureMs === undefined || retryAfterMs + 1 < remainingAfterFailureMs);
            if (canRetryWithinBounds) {
              boundedRateLimitRetryAvailable = false;
              if (retryAfterMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
              }
              continue;
            }
            throw new PayrollPaymentReconciliationError(
              "TROLLEY_PROVIDER_RATE_LIMITED",
              "Provider rate limit prevented verification."
            );
          }
          throw error;
        }
      }
      payments.push(...response.items);
      if (!response.hasMore && response.items.length < 100) break;
    }

    return await applyTrustedPayrollPaymentEvidence({
      companyId: run.companyId,
      payrollRunId: run.id,
      providerRef: run.providerRef,
      payments,
      verification: {
        jobName: options.jobName ?? "direct-provider-verification",
        attemptedAt,
        completedAt: now(),
        metrics: metricDelta(requestBudget, beforeMetrics),
      },
      testHooks: options.testHooks,
    });
  } catch (error) {
    const reasonCode = error instanceof TrolleyRequestTimeoutError
      ? error.code
      : error instanceof CompliancePublicationLockTimeoutError
        ? error.code
      : error instanceof PayrollPaymentReconciliationError
        ? error.code
        : "TROLLEY_PROVIDER_REQUEST_FAILED";
    try {
      await persistRetryableVerificationFailure({
        companyId: run.companyId,
        payrollRunId: run.id,
        reasonCode,
        context: {
          jobName: options.jobName ?? "direct-provider-verification",
          attemptedAt,
          completedAt: now(),
          metrics: metricDelta(requestBudget, beforeMetrics),
        },
      });
    } catch {
      throw new PayrollPaymentReconciliationError(
        "PROVIDER_VERIFICATION_EVIDENCE_PERSIST_FAILED",
        "Provider verification failure evidence could not be persisted."
      );
    }
    throw error;
  }
}

type ReconciliationSummary = {
  processed: number;
  reviewRequired: number;
  failed: number;
} & ProviderRequestMetrics;

function emptyReconciliationSummary(): ReconciliationSummary {
  return { processed: 0, reviewRequired: 0, failed: 0, ...emptyProviderRequestMetrics() };
}

async function auditProviderPollingFailure(params: {
  payrollRunId: bigint;
  action: "TROLLEY_PAYING_RECONCILIATION_FAILED" | "TROLLEY_PAID_REVALIDATION_FAILED";
  reasonCode: string;
}) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: params.payrollRunId },
    select: { companyId: true },
  });
  if (!run?.companyId) return;
  await prisma.auditLog.create({
    data: {
      companyId: run.companyId,
      actorType: "SYSTEM",
      action: params.action,
      targetType: "PayrollRun",
      targetId: params.payrollRunId.toString(),
      metadataJson: { reasonCode: params.reasonCode, retryable: true },
    },
  });
}

type CheckpointedReconciliationOptions = {
  loadBatchPayments?: LoadBatchPayments;
  maxRuns?: number;
  timeBudgetMs?: number;
  maxProviderRequestsPerInvocation?: number;
  clock?: () => number;
  now?: () => Date;
  testHooks?: {
    afterLeaseAcquired?: () => Promise<void>;
  };
};

function pollingFailureReason(error: unknown, status: "PAYING" | "PAID") {
  if (error instanceof TrolleyRequestTimeoutError) return error.code;
  if (error instanceof PayrollPaymentReconciliationError) return error.code;
  return status === "PAID"
    ? "TROLLEY_PAID_REVALIDATION_PROVIDER_FAILURE"
    : "TROLLEY_PAYING_RECONCILIATION_PROVIDER_FAILURE";
}

async function runCheckpointedReconciliation(params: {
  jobName: string;
  status: "PAYING" | "PAID";
  auditAction: "TROLLEY_PAYING_RECONCILIATION_FAILED" | "TROLLEY_PAID_REVALIDATION_FAILED";
  defaultMaxRuns: number;
  defaultTimeBudgetMs: number;
  defaultMaxProviderRequests: number;
  options: CheckpointedReconciliationOptions;
}) {
  const { options } = params;
  const maxRuns = Math.max(1, options.maxRuns ?? params.defaultMaxRuns);
  const timeBudgetMs = Math.max(1, options.timeBudgetMs ?? params.defaultTimeBudgetMs);
  const maxProviderRequestsPerInvocation = Math.max(
    1,
    options.maxProviderRequestsPerInvocation ?? params.defaultMaxProviderRequests
  );
  const requestBudget: ProviderRequestBudget = {
    maxProviderRequestsPerInvocation,
    ...emptyProviderRequestMetrics(),
  };
  const clock = options.clock ?? Date.now;
  const now = options.now ?? (() => new Date());
  const startedAtMs = clock();
  const deadlineMs = startedAtMs + timeBudgetMs;
  const startedAt = now();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(
    startedAt.getTime() + Math.max(
      TROLLEY_PAID_REVALIDATION_MIN_LEASE_MS,
      timeBudgetMs + 60_000
    )
  );

  await prisma.payrollReconciliationCheckpoint.upsert({
    where: { jobName: params.jobName },
    create: { jobName: params.jobName },
    update: {},
  });
  const lease = await prisma.payrollReconciliationCheckpoint.updateMany({
    where: {
      jobName: params.jobName,
      OR: [
        { leaseToken: null },
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: startedAt } },
      ],
    },
    data: { leaseToken, leaseExpiresAt, lastStartedAt: startedAt },
  });
  if (lease.count !== 1) {
    const checkpoint = await prisma.payrollReconciliationCheckpoint.findUniqueOrThrow({
      where: { jobName: params.jobName },
      select: { cursorPayrollRunId: true, completedSweeps: true },
    });
    return {
      ...emptyReconciliationSummary(),
      maxProviderRequestsPerInvocation,
      nextCursor: checkpoint.cursorPayrollRunId?.toString() ?? null,
      completedSweeps: checkpoint.completedSweeps,
      wrapped: false,
      skippedLocked: true,
    };
  }

  await options.testHooks?.afterLeaseAcquired?.();
  const checkpoint = await prisma.payrollReconciliationCheckpoint.findUniqueOrThrow({
    where: { jobName: params.jobName },
    select: { cursorPayrollRunId: true, completedSweeps: true },
  });
  let cursor = checkpoint.cursorPayrollRunId;
  let wrapped = false;
  const summary = emptyReconciliationSummary();

  try {
    const runs = await prisma.payrollRun.findMany({
      where: {
        providerRef: { not: null },
        companyId: { not: null },
        status: params.status,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: maxRuns,
    });

    for (const run of runs) {
      const remainingMs = deadlineMs - clock();
      if (remainingMs <= 1) break;
      let stopAfterRun = false;
      try {
        const result = await reconcilePayrollRunFromTrolley(run.id, {
          loadBatchPayments: options.loadBatchPayments,
          requestTimeoutMs: Math.min(DEFAULT_TROLLEY_REQUEST_TIMEOUT_MS, remainingMs - 1),
          deadlineMs,
          clock,
          now,
          jobName: params.jobName,
          requestBudget,
        });
        summary.processed += 1;
        if (result.reviewRequired) summary.reviewRequired += 1;
      } catch (error) {
        summary.failed += 1;
        if (
          error instanceof PayrollPaymentReconciliationError &&
          [
            "TROLLEY_PROVIDER_REQUEST_BUDGET_EXHAUSTED",
            "TROLLEY_RECONCILIATION_BUDGET_EXHAUSTED",
          ].includes(error.code)
        ) {
          stopAfterRun = true;
        }
        await auditProviderPollingFailure({
          payrollRunId: run.id,
          action: params.auditAction,
          reasonCode: pollingFailureReason(error, params.status),
        }).catch(() => undefined);
      }

      cursor = run.id;
      const progressed = await prisma.payrollReconciliationCheckpoint.updateMany({
        where: { jobName: params.jobName, leaseToken },
        data: { cursorPayrollRunId: cursor },
      });
      if (progressed.count !== 1) break;
      if (stopAfterRun) break;
    }

    const nextRun = await prisma.payrollRun.findFirst({
      where: {
        providerRef: { not: null },
        companyId: { not: null },
        status: params.status,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (!nextRun) {
      cursor = null;
      wrapped = true;
    }

    const completedAt = now();
    Object.assign(summary, {
      attemptedProviderRequests: requestBudget.attemptedProviderRequests,
      successfulProviderRequests: requestBudget.successfulProviderRequests,
      timedOutRequests: requestBudget.timedOutRequests,
      rateLimitedRequests: requestBudget.rateLimitedRequests,
      pagesFetched: requestBudget.pagesFetched,
    });
    const released = await prisma.payrollReconciliationCheckpoint.updateMany({
      where: { jobName: params.jobName, leaseToken },
      data: {
        cursorPayrollRunId: cursor,
        completedSweeps: wrapped ? { increment: 1 } : undefined,
        leaseToken: null,
        leaseExpiresAt: null,
        lastCompletedAt: completedAt,
      },
    });
    if (released.count !== 1) {
      return {
        ...summary,
        maxProviderRequestsPerInvocation,
        nextCursor: cursor?.toString() ?? null,
        completedSweeps: checkpoint.completedSweeps,
        wrapped: false,
        skippedLocked: true,
      };
    }
    return {
      ...summary,
      maxProviderRequestsPerInvocation,
      nextCursor: cursor?.toString() ?? null,
      completedSweeps: checkpoint.completedSweeps + (wrapped ? 1 : 0),
      wrapped,
      skippedLocked: false,
    };
  } catch (error) {
    await prisma.payrollReconciliationCheckpoint.updateMany({
      where: { jobName: params.jobName, leaseToken },
      data: { leaseToken: null, leaseExpiresAt: null, lastCompletedAt: now() },
    }).catch(() => undefined);
    throw error;
  }
}

export type PaidPayrollRevalidationOptions = CheckpointedReconciliationOptions;

export function revalidatePaidPayrollRunsFromTrolley(
  options: PaidPayrollRevalidationOptions = {}
) {
  return runCheckpointedReconciliation({
    jobName: TROLLEY_PAID_REVALIDATION_JOB,
    status: "PAID",
    auditAction: "TROLLEY_PAID_REVALIDATION_FAILED",
    defaultMaxRuns: TROLLEY_REVALIDATION_BATCH_SIZE,
    defaultTimeBudgetMs: TROLLEY_PAID_REVALIDATION_TIME_BUDGET_MS,
    defaultMaxProviderRequests: TROLLEY_PAID_MAX_PROVIDER_REQUESTS,
    options,
  });
}

export type PayingPayrollReconciliationOptions = CheckpointedReconciliationOptions;

export function reconcilePayingPayrollRunsFromTrolley(
  options: PayingPayrollReconciliationOptions = {}
) {
  return runCheckpointedReconciliation({
    jobName: TROLLEY_PAYING_RECONCILIATION_JOB,
    status: "PAYING",
    auditAction: "TROLLEY_PAYING_RECONCILIATION_FAILED",
    defaultMaxRuns: TROLLEY_PAYING_MAX_RUNS,
    defaultTimeBudgetMs: TROLLEY_PAYING_TIME_BUDGET_MS,
    defaultMaxProviderRequests: TROLLEY_PAYING_MAX_PROVIDER_REQUESTS,
    options,
  });
}

export async function getPaidRevalidationOperationalHealth(now = new Date()) {
  const freshnessCutoff = new Date(now.getTime() - PROVIDER_VERIFICATION_SLA_MS);
  const [checkpoint, paidRuns, attemptGroups, requestTotals, firstAttempt] = await Promise.all([
    prisma.payrollReconciliationCheckpoint.findUnique({
      where: { jobName: TROLLEY_PAID_REVALIDATION_JOB },
      select: {
        cursorPayrollRunId: true,
        completedSweeps: true,
        lastStartedAt: true,
        lastCompletedAt: true,
        leaseExpiresAt: true,
      },
    }),
    prisma.payrollRun.findMany({
      where: { status: "PAID", companyId: { not: null } },
      select: {
        id: true,
        providerRef: true,
        providerEvidenceVersion: true,
        providerVerificationStatus: true,
        providerVerificationLastAttemptAt: true,
        providerVerificationLastSucceededAt: true,
      },
    }),
    prisma.payrollProviderVerificationAttempt.groupBy({
      by: ["outcome"],
      where: {
        jobName: TROLLEY_PAID_REVALIDATION_JOB,
        providerEvidenceVersion: TROLLEY_PROVIDER_EVIDENCE_VERSION,
        completedAt: { gte: freshnessCutoff },
      },
      _count: { _all: true },
    }),
    prisma.payrollProviderVerificationAttempt.aggregate({
      where: {
        jobName: TROLLEY_PAID_REVALIDATION_JOB,
        providerEvidenceVersion: TROLLEY_PROVIDER_EVIDENCE_VERSION,
        completedAt: { gte: freshnessCutoff },
      },
      _sum: {
        attemptedProviderRequests: true,
        successfulProviderRequests: true,
        timedOutRequests: true,
        rateLimitedRequests: true,
        pagesFetched: true,
      },
    }),
    prisma.payrollProviderVerificationAttempt.findFirst({
      where: {
        jobName: TROLLEY_PAID_REVALIDATION_JOB,
        providerEvidenceVersion: TROLLEY_PROVIDER_EVIDENCE_VERSION,
        completedAt: { gte: freshnessCutoff },
      },
      orderBy: { completedAt: "asc" },
      select: { completedAt: true },
    }),
  ]);
  const eligibleRuns = paidRuns.filter((run) => run.providerRef !== null);
  const unrevalidatableRuns = paidRuns.filter((run) => !run.providerRef?.trim());
  const unrevalidatableLegacyRuns = unrevalidatableRuns.filter(
    (run) => run.providerVerificationStatus === "LEGACY_UNVERIFIED"
  );
  const requiredRuns = paidRuns;
  const eligiblePaidRunCount = requiredRuns.length;
  const revalidatablePaidRunCount = eligibleRuns.length;
  const unrevalidatableLegacyPaidRunCount = unrevalidatableLegacyRuns.length;
  const remainingAfterCursor = checkpoint?.cursorPayrollRunId
    ? await prisma.payrollRun.count({
      where: {
        status: "PAID",
        providerRef: { not: null },
        companyId: { not: null },
        id: { gt: checkpoint.cursorPayrollRunId },
      },
    })
    : eligiblePaidRunCount;
  const successfullyVerifiedWithinSlaCount = eligibleRuns.filter(
    (run) => run.providerVerificationStatus === "VERIFIED" &&
      run.providerVerificationLastSucceededAt &&
      run.providerVerificationLastSucceededAt >= freshnessCutoff &&
      run.providerEvidenceVersion === TROLLEY_PROVIDER_EVIDENCE_VERSION
  ).length;
  const neverSuccessfullyVerifiedCount = requiredRuns.filter(
    (run) => run.providerVerificationLastSucceededAt === null
  ).length;
  const staleVerificationCount = eligibleRuns.filter(
    (run) => run.providerVerificationLastSucceededAt !== null &&
      run.providerVerificationLastSucceededAt < freshnessCutoff &&
      run.providerEvidenceVersion === TROLLEY_PROVIDER_EVIDENCE_VERSION
  ).length;
  const evidenceVersionMismatchCount = eligibleRuns.filter(
    (run) => run.providerVerificationLastSucceededAt !== null &&
      run.providerEvidenceVersion !== TROLLEY_PROVIDER_EVIDENCE_VERSION
  ).length;
  const unresolvedFailureCount = requiredRuns.filter(
    (run) => run.providerVerificationStatus === "RETRYABLE_FAILURE"
  ).length;
  const oldestSuccessfulVerificationAt = eligibleRuns.reduce<Date | null>((oldest, run) => {
    const value = run.providerVerificationLastSucceededAt;
    if (!value || run.providerEvidenceVersion !== TROLLEY_PROVIDER_EVIDENCE_VERSION) return oldest;
    return !oldest || value < oldest ? value : oldest;
  }, null);
  const countFor = (outcome: "SUCCEEDED" | "FAILED_RETRYABLE" | "REVIEW_REQUIRED") =>
    attemptGroups.find((group) => group.outcome === outcome)?._count._all ?? 0;
  const attemptedCount = attemptGroups.reduce((sum, group) => sum + group._count._all, 0);
  const succeededCount = countFor("SUCCEEDED");
  const failedCount = countFor("FAILED_RETRYABLE") + countFor("REVIEW_REQUIRED");
  const pagesFetched = requestTotals._sum.pagesFetched ?? 0;
  const observedAveragePagesPerSucceededRun = succeededCount > 0
    ? Math.max(1, pagesFetched / succeededCount)
    : 1;
  const nominalRunsPerInvocation = Math.max(1, Math.min(
    TROLLEY_REVALIDATION_BATCH_SIZE,
    Math.floor(TROLLEY_PAID_MAX_PROVIDER_REQUESTS / observedAveragePagesPerSucceededRun)
  ));
  const nominalCapacityEstimateMinutes = revalidatablePaidRunCount === 0
    ? 0
    : Math.max(
      TROLLEY_PAID_CRON_INTERVAL_MINUTES,
      Math.ceil(revalidatablePaidRunCount / nominalRunsPerInvocation) *
        TROLLEY_PAID_CRON_INTERVAL_MINUTES
    );
  const observedHours = firstAttempt
    ? Math.max((now.getTime() - firstAttempt.completedAt.getTime()) / (60 * 60 * 1000), 0.25)
    : 24;
  const actualProcessedThroughputPerHour = succeededCount / observedHours;
  const requiredSlaThroughputPerHour = revalidatablePaidRunCount / 24;
  const checkpointAgeSeconds = checkpoint?.lastCompletedAt
    ? Math.max(0, Math.floor((now.getTime() - checkpoint.lastCompletedAt.getTime()) / 1000))
    : null;
  const staleCheckpoint = requiredRuns.length > 0 &&
    (checkpointAgeSeconds === null || checkpointAgeSeconds > 30 * 60);
  const freshnessDeficitCount =
    neverSuccessfullyVerifiedCount + staleVerificationCount + evidenceVersionMismatchCount +
    unresolvedFailureCount + unrevalidatableRuns.length;
  const actualThroughputBelowRequired = freshnessDeficitCount > 0 &&
    actualProcessedThroughputPerHour < requiredSlaThroughputPerHour;
  const slaBreached =
    freshnessDeficitCount > 0 ||
    actualThroughputBelowRequired ||
    staleCheckpoint;

  return {
    eligiblePaidRunCount,
    revalidatablePaidRunCount,
    unrevalidatableLegacyPaidRunCount,
    providerReferenceMissingCount: unrevalidatableRuns.length,
    successfullyVerifiedWithinSlaCount,
    neverSuccessfullyVerifiedCount,
    staleVerificationCount,
    evidenceVersionMismatchCount,
    unresolvedFailureCount,
    legacyUnverifiedCount: requiredRuns.filter(
      (run) => run.providerVerificationStatus === "LEGACY_UNVERIFIED"
    ).length,
    oldestSuccessfulVerificationAt: oldestSuccessfulVerificationAt?.toISOString() ?? null,
    oldestVerificationAgeSeconds: oldestSuccessfulVerificationAt
      ? Math.max(0, Math.floor((now.getTime() - oldestSuccessfulVerificationAt.getTime()) / 1000))
      : null,
    attemptedCount,
    succeededCount,
    failedCount,
    actualProcessedThroughputPerHour,
    requiredSlaThroughputPerHour,
    actualThroughputBelowRequired,
    observedAveragePagesPerSucceededRun,
    nominalRunsPerInvocation,
    nominalCapacityEstimateMinutes,
    maxRunsPerInvocation: TROLLEY_REVALIDATION_BATCH_SIZE,
    maxProviderRequestsPerInvocation: TROLLEY_PAID_MAX_PROVIDER_REQUESTS,
    attemptedProviderRequests: requestTotals._sum.attemptedProviderRequests ?? 0,
    successfulProviderRequests: requestTotals._sum.successfulProviderRequests ?? 0,
    timedOutRequests: requestTotals._sum.timedOutRequests ?? 0,
    rateLimitedRequests: requestTotals._sum.rateLimitedRequests ?? 0,
    pagesFetched,
    remainingAfterCursor,
    slaMinutes: TROLLEY_PAID_REVALIDATION_SLA_MINUTES,
    checkpointAgeSeconds,
    lastStartedAt: checkpoint?.lastStartedAt?.toISOString() ?? null,
    lastCompletedAt: checkpoint?.lastCompletedAt?.toISOString() ?? null,
    completedSweeps: checkpoint?.completedSweeps ?? 0,
    leaseActive: Boolean(checkpoint?.leaseExpiresAt && checkpoint.leaseExpiresAt > now),
    checkpointStale: staleCheckpoint,
    slaBreached,
  };
}

export function getPaidRevalidationHttpStatus(health: { slaBreached: boolean }) {
  return health.slaBreached ? 503 : 200;
}
