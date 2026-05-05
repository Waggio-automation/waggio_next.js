export type EmployeePayoutSetupStatus = "required" | "pending" | "ready" | "issue";
export type PayrollRunLifecycleStatus =
  | "scheduled"
  | "funding"
  | "funds_confirmed"
  | "paying"
  | "paid"
  | "failed";
export type PayrollFailureType = "funding" | "employee";

export type ExternalPaymentEvent = {
  type: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

type MappingRule = {
  scope: "employee" | "payroll";
  employeeStatus?: EmployeePayoutSetupStatus;
  payrollStatus?: PayrollRunLifecycleStatus;
  failureType?: PayrollFailureType;
};

export const TROLLEY_EVENT_STATUS_MAP: Record<string, MappingRule> = {
  "recipient.created": { scope: "employee", employeeStatus: "pending" },
  "recipient.account.created": { scope: "employee", employeeStatus: "ready" },
  "recipient.account.failed": { scope: "employee", employeeStatus: "issue" },
  "batch.created": { scope: "payroll", payrollStatus: "funding" },
  "batch.processing": { scope: "payroll", payrollStatus: "paying" },
  "payment.pending": { scope: "payroll", payrollStatus: "paying" },
  "payment.paid": { scope: "payroll", payrollStatus: "paid" },
  "payment.failed": { scope: "payroll", payrollStatus: "failed", failureType: "employee" },
  "batch.failed": { scope: "payroll", payrollStatus: "failed", failureType: "funding" },
};

export function deriveEmployeeStatusFromTrolleyRecipient(params: {
  recipientId?: string | null;
  recipientAccountId?: string | null;
  accountMarkedProblem?: boolean;
}): { payoutSetupStatus: EmployeePayoutSetupStatus; payoutEnabled: boolean } {
  if (params.accountMarkedProblem) {
    return { payoutSetupStatus: "issue", payoutEnabled: false };
  }

  if (!params.recipientId) {
    return { payoutSetupStatus: "required", payoutEnabled: false };
  }

  if (!params.recipientAccountId) {
    return { payoutSetupStatus: "pending", payoutEnabled: false };
  }

  return { payoutSetupStatus: "ready", payoutEnabled: true };
}

export function deriveCompanyStatusFromConfiguration(params: {
  environmentConfigured: boolean;
  defaultPayoutCurrency?: string | null;
  defaultPayoutCountry?: string | null;
}): { payoutSetupStatus: EmployeePayoutSetupStatus; payoutEnabled: boolean } {
  if (!params.environmentConfigured) {
    return { payoutSetupStatus: "required", payoutEnabled: false };
  }

  if (!params.defaultPayoutCurrency || !params.defaultPayoutCountry) {
    return { payoutSetupStatus: "pending", payoutEnabled: false };
  }

  return { payoutSetupStatus: "ready", payoutEnabled: true };
}

export function mapExternalPaymentEventToInternal(
  event: ExternalPaymentEvent
): {
  employee?: {
    payoutSetupStatus: EmployeePayoutSetupStatus;
    payoutEnabled: boolean;
  };
  payrollRun?: {
    status: PayrollRunLifecycleStatus;
    failureType?: PayrollFailureType;
    failureReason?: string;
  };
} {
  const rule = TROLLEY_EVENT_STATUS_MAP[event.type];
  if (!rule) return {};

  if (rule.scope === "employee") {
    return {
      employee: {
        payoutSetupStatus: rule.employeeStatus ?? "required",
        payoutEnabled: rule.employeeStatus === "ready",
      },
    };
  }

  return {
    payrollRun: {
      status: rule.payrollStatus ?? "scheduled",
      failureType: rule.failureType,
      failureReason:
        typeof event.data?.object?.["message"] === "string"
          ? (event.data.object.message as string)
          : typeof event.data?.object?.["failureReason"] === "string"
            ? (event.data.object.failureReason as string)
            : undefined,
    },
  };
}

export function toPrismaEmployeePayoutStatus(status: EmployeePayoutSetupStatus) {
  switch (status) {
    case "required":
      return "REQUIRED" as const;
    case "pending":
      return "PENDING" as const;
    case "ready":
      return "READY" as const;
    case "issue":
      return "ISSUE" as const;
  }
}

export function toPrismaPayrollRunStatus(status: PayrollRunLifecycleStatus) {
  switch (status) {
    case "scheduled":
      return "SCHEDULED" as const;
    case "funding":
      return "FUNDING" as const;
    case "funds_confirmed":
      return "FUNDS_CONFIRMED" as const;
    case "paying":
      return "PAYING" as const;
    case "paid":
      return "PAID" as const;
    case "failed":
      return "FAILED" as const;
  }
}

export function toPrismaPayrollFailureType(failureType?: PayrollFailureType) {
  if (failureType === "funding") return "FUNDING" as const;
  if (failureType === "employee") return "EMPLOYEE" as const;
  return undefined;
}
