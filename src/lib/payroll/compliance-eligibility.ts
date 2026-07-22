import { PayHistoryStatus, PayrollRunStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  getProviderEvidenceExclusionReason,
  trustedProviderPayrollWhere,
  type ProviderEvidenceExclusionReason,
  type ProviderEvidencePayrollRow,
} from "./provider-evidence-policy.ts";

export const COMPLIANCE_PAYROLL_RUN_STATUSES = [PayrollRunStatus.PAID] as const;
export const COMPLIANCE_PAY_HISTORY_STATUSES = [
  PayHistoryStatus.SENT,
  PayHistoryStatus.EMAIL_SENT,
] as const;

export function compliancePayrollWhere(companyId: bigint, verificationCutoff: Date) {
  return trustedProviderPayrollWhere(companyId, verificationCutoff);
}

export type PayrollExclusionReason =
  | "AMBIGUOUS_PAYROLL_STATUS"
  | "LEGACY_STATUS_MISSING"
  | "PAYROLL_RUN_COMPANY_MISMATCH"
  | "PAID_PARENT_CHILD_STATUS_CONFLICT"
  | "PAID_PARENT_CHILD_PAYMENT_EVIDENCE_MISSING"
  | ProviderEvidenceExclusionReason;

export type CompliancePayrollRow = ProviderEvidencePayrollRow & {
  payrollRunId: bigint | null;
};

export function createComplianceSourceMembershipFingerprint(
  rows: Array<{ id: bigint; payrollRunId: bigint | null }>
) {
  return createHash("sha256").update(JSON.stringify(
    [...rows]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((row) => ({
        payHistoryId: row.id.toString(),
        payrollRunId: row.payrollRunId?.toString() ?? null,
      }))
  )).digest("hex");
}

export function getPayrollExclusionReason(
  row: CompliancePayrollRow,
  companyId: bigint,
  verificationCutoff: Date
): PayrollExclusionReason | null {
  if (!row.payrollRunId || !row.payrollRun) {
    return "LEGACY_STATUS_MISSING";
  }

  if (row.payrollRun.companyId !== companyId) {
    return "PAYROLL_RUN_COMPANY_MISMATCH";
  }

  if (!COMPLIANCE_PAYROLL_RUN_STATUSES.some((status) => status === row.payrollRun?.status)) {
    return "AMBIGUOUS_PAYROLL_STATUS";
  }

  const providerEvidenceReason = getProviderEvidenceExclusionReason(
    row,
    verificationCutoff
  );
  if (providerEvidenceReason && providerEvidenceReason !== "PROVIDER_PAYMENT_LINK_MISSING") {
    return providerEvidenceReason;
  }

  if (!COMPLIANCE_PAY_HISTORY_STATUSES.some((status) => status === row.status)) {
    return "PAID_PARENT_CHILD_STATUS_CONFLICT";
  }

  if (!row.paidAt) return "PAID_PARENT_CHILD_PAYMENT_EVIDENCE_MISSING";
  return providerEvidenceReason;
}

export function partitionCompliancePayrollRows<T extends CompliancePayrollRow>(
  rows: T[],
  companyId: bigint,
  verificationCutoff: Date
) {
  const included: T[] = [];
  const reasonCounts: Record<PayrollExclusionReason, number> = {
    AMBIGUOUS_PAYROLL_STATUS: 0,
    LEGACY_STATUS_MISSING: 0,
    PAYROLL_RUN_COMPANY_MISMATCH: 0,
    PAID_PARENT_CHILD_STATUS_CONFLICT: 0,
    PAID_PARENT_CHILD_PAYMENT_EVIDENCE_MISSING: 0,
    PROVIDER_REFERENCE_MISSING: 0,
    PROVIDER_EVIDENCE_UNVERIFIED: 0,
    PROVIDER_EVIDENCE_STALE: 0,
    PROVIDER_EVIDENCE_VERSION_MISMATCH: 0,
    PROVIDER_PAYMENT_LINK_MISSING: 0,
  };

  for (const row of rows) {
    const reason = getPayrollExclusionReason(row, companyId, verificationCutoff);
    if (reason) {
      reasonCounts[reason] += 1;
    } else {
      included.push(row);
    }
  }

  return {
    included,
    excludedCount: rows.length - included.length,
    reasonCounts,
  };
}
