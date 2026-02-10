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
  account?: string;
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

export const STRIPE_EVENT_STATUS_MAP: Record<string, MappingRule> = {
  "account.created": { scope: "employee", employeeStatus: "required" },
  "account.updated": { scope: "employee" },
  "account.external_account.created": { scope: "employee", employeeStatus: "pending" },
  "account.external_account.deleted": { scope: "employee", employeeStatus: "issue" },

  "payment_intent.processing": { scope: "payroll", payrollStatus: "funding" },
  "payment_intent.succeeded": { scope: "payroll", payrollStatus: "funds_confirmed" },
  "payment_intent.payment_failed": {
    scope: "payroll",
    payrollStatus: "failed",
    failureType: "funding",
  },

  "transfer.created": { scope: "payroll", payrollStatus: "paying" },
  "transfer.failed": {
    scope: "payroll",
    payrollStatus: "failed",
    failureType: "employee",
  },

  "payout.paid": { scope: "payroll", payrollStatus: "paid" },
  "payout.failed": {
    scope: "payroll",
    payrollStatus: "failed",
    failureType: "employee",
  },
};

export function deriveEmployeeStatusFromAccount(
  account: Record<string, unknown> | undefined
): { payoutSetupStatus: EmployeePayoutSetupStatus; payoutEnabled: boolean } {
  if (!account) {
    return { payoutSetupStatus: "required", payoutEnabled: false };
  }

  const chargesEnabled = account.charges_enabled === true;
  const payoutsEnabled = account.payouts_enabled === true;
  const disabledReason =
    typeof account.disabled_reason === "string" ? account.disabled_reason : null;

  const requirements =
    account.requirements && typeof account.requirements === "object"
      ? (account.requirements as Record<string, unknown>)
      : undefined;

  const currentlyDue = Array.isArray(requirements?.currently_due)
    ? requirements?.currently_due
    : [];

  if (disabledReason || currentlyDue.length > 0) {
    return { payoutSetupStatus: "issue", payoutEnabled: false };
  }

  if (chargesEnabled && payoutsEnabled) {
    return { payoutSetupStatus: "ready", payoutEnabled: true };
  }

  return { payoutSetupStatus: "pending", payoutEnabled: false };
}

export function mapExternalPaymentEventToInternal(
  event: ExternalPaymentEvent
): {
  employee?: {
    stripeAccountId?: string;
    payoutSetupStatus: EmployeePayoutSetupStatus;
    payoutEnabled: boolean;
  };
  payrollRun?: {
    status: PayrollRunLifecycleStatus;
    failureType?: PayrollFailureType;
    failureReason?: string;
  };
} {
  const rule = STRIPE_EVENT_STATUS_MAP[event.type];
  if (!rule) return {};

  if (rule.scope === "employee") {
    if (event.type === "account.updated") {
      const derived = deriveEmployeeStatusFromAccount(event.data?.object);
      return {
        employee: {
          stripeAccountId:
            typeof event.data?.object?.id === "string"
              ? (event.data?.object?.id as string)
              : event.account,
          payoutSetupStatus: derived.payoutSetupStatus,
          payoutEnabled: derived.payoutEnabled,
        },
      };
    }

    return {
      employee: {
        stripeAccountId:
          typeof event.data?.object?.id === "string"
            ? (event.data?.object?.id as string)
            : event.account,
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
        typeof event.data?.object?.["failure_message"] === "string"
          ? (event.data?.object?.["failure_message"] as string)
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
