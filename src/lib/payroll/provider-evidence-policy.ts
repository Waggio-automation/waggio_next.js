import {
  PayHistoryStatus,
  PayrollRunStatus,
  ProviderVerificationStatus,
  type Prisma,
} from "@prisma/client";

export const TRUSTED_PAYROLL_PAYMENT_PROVIDER = "trolley";
export const CURRENT_PROVIDER_EVIDENCE_VERSION = "trolley-processed-exact-set-v1";
export const PROVIDER_VERIFICATION_SLA_MS = 24 * 60 * 60 * 1000;

export type ProviderEvidenceExclusionReason =
  | "PROVIDER_REFERENCE_MISSING"
  | "PROVIDER_EVIDENCE_UNVERIFIED"
  | "PROVIDER_EVIDENCE_STALE"
  | "PROVIDER_EVIDENCE_VERSION_MISMATCH"
  | "PROVIDER_PAYMENT_LINK_MISSING";

export type ProviderEvidencePayrollRow = {
  status: PayHistoryStatus;
  paidAt: Date | null;
  paymentProvider: string | null;
  paymentRef: string | null;
  payrollRun: {
    status: PayrollRunStatus;
    companyId: bigint | null;
    providerRef: string | null;
    providerVerificationStatus: ProviderVerificationStatus;
    providerVerificationLastSucceededAt: Date | null;
    providerEvidenceVersion: string | null;
  } | null;
};

export function getProviderVerificationCutoff(now: Date) {
  return new Date(now.getTime() - PROVIDER_VERIFICATION_SLA_MS);
}

export function trustedProviderPayrollWhere(
  companyId: bigint,
  verificationCutoff: Date
) {
  return {
    status: { in: [PayHistoryStatus.SENT, PayHistoryStatus.EMAIL_SENT] },
    paidAt: { not: null },
    paymentProvider: TRUSTED_PAYROLL_PAYMENT_PROVIDER,
    paymentRef: { not: null, notIn: [""] },
    payrollRun: {
      is: {
        companyId,
        status: PayrollRunStatus.PAID,
        providerRef: { not: null, notIn: [""] },
        providerVerificationStatus: ProviderVerificationStatus.VERIFIED,
        providerVerificationLastSucceededAt: { gte: verificationCutoff },
        providerEvidenceVersion: CURRENT_PROVIDER_EVIDENCE_VERSION,
      },
    },
  } satisfies Prisma.PayHistoryWhereInput;
}

export function getProviderEvidenceExclusionReason(
  row: ProviderEvidencePayrollRow,
  verificationCutoff: Date
): ProviderEvidenceExclusionReason | null {
  const run = row.payrollRun;
  if (!run) return "PROVIDER_EVIDENCE_UNVERIFIED";
  if (!run.providerRef?.trim()) return "PROVIDER_REFERENCE_MISSING";
  if (
    run.providerVerificationStatus !== ProviderVerificationStatus.VERIFIED ||
    !run.providerVerificationLastSucceededAt
  ) {
    return "PROVIDER_EVIDENCE_UNVERIFIED";
  }
  if (run.providerEvidenceVersion !== CURRENT_PROVIDER_EVIDENCE_VERSION) {
    return "PROVIDER_EVIDENCE_VERSION_MISMATCH";
  }
  if (run.providerVerificationLastSucceededAt < verificationCutoff) {
    return "PROVIDER_EVIDENCE_STALE";
  }
  if (
    row.paymentProvider !== TRUSTED_PAYROLL_PAYMENT_PROVIDER ||
    !row.paymentRef?.trim()
  ) {
    return "PROVIDER_PAYMENT_LINK_MISSING";
  }
  return null;
}
