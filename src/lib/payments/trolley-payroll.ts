import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createBatch,
  createPayment,
  listPayments,
  startBatchProcessing,
  TrolleyApiError,
  type CreatePaymentInput,
  type Payment,
} from "@/lib/trolley";
import { billExtraPayrollRunIfNeeded } from "@/lib/stripe";
import {
  buildTrolleyPayHistoryExternalId,
  buildTrolleyPayrollRunExternalId,
  buildTrolleyTags,
  getOrCreateTrolleyTenantContext,
} from "@/lib/payments/trolley-tenancy";

type SerializablePayHistory = {
  id: bigint;
  netPay: Prisma.Decimal;
  employeeId: bigint;
  employee: {
    id: bigint;
    firstName: string;
    lastName: string;
    email: string;
    payoutEnabled: boolean;
    trolleyRecipientId: string | null;
    trolleyRecipientAccountId: string | null;
  };
};

type SerializablePayrollRun = {
  id: bigint;
  companyId: bigint | null;
  payDate: Date;
  sendAt: Date | null;
  status: string;
  failureType: string | null;
  providerRef: string | null;
  meta: unknown;
  company: {
    settings: {
      defaultPayoutCurrency: string;
      trolleyBatchPrefix: string | null;
    } | null;
  } | null;
  payHistory: SerializablePayHistory[];
};

export class PayrollSendError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PayrollSendError";
    this.code = code;
  }
}

function formatAmount(value: Prisma.Decimal) {
  return value.toFixed(2);
}

function formatPayDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function loadPayrollRun(payrollRunId: bigint) {
  return prisma.payrollRun.findUnique({
    where: { id: payrollRunId },
    select: {
      id: true,
      companyId: true,
      payDate: true,
      sendAt: true,
      status: true,
      failureType: true,
      providerRef: true,
      meta: true,
      company: {
        select: {
          settings: {
            select: {
              defaultPayoutCurrency: true,
              trolleyBatchPrefix: true,
            },
          },
        },
      },
      payHistory: {
        select: {
          id: true,
          netPay: true,
          employeeId: true,
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              payoutEnabled: true,
              trolleyRecipientId: true,
              trolleyRecipientAccountId: true,
            },
          },
        },
      },
    },
  });
}

function assertRunnable(run: SerializablePayrollRun, options: { enforceDue: boolean }) {
  if (run.status !== "PROCESSED" && !(run.status === "FAILED" && run.failureType)) {
    throw new PayrollSendError(
      "invalid_status",
      `Payroll run ${run.id.toString()} cannot be sent from status ${run.status}.`
    );
  }

  if (run.providerRef) {
    throw new PayrollSendError(
      "already_sent",
      `Payroll run ${run.id.toString()} already has a provider batch reference.`
    );
  }

  if (options.enforceDue && run.sendAt && run.sendAt.getTime() > Date.now()) {
    throw new PayrollSendError(
      "not_due",
      `Payroll run ${run.id.toString()} is not due until ${run.sendAt.toISOString()}.`
    );
  }

  if (run.payHistory.length === 0) {
    throw new PayrollSendError(
      "empty_run",
      `Payroll run ${run.id.toString()} has no pay history rows to send.`
    );
  }

  if (!run.companyId) {
    throw new PayrollSendError(
      "missing_company",
      `Payroll run ${run.id.toString()} is not assigned to a company.`
    );
  }

  for (const row of run.payHistory) {
    if (row.netPay.lte(0)) {
      throw new PayrollSendError(
        "invalid_amount",
        `Pay history ${row.id.toString()} has a non-positive net pay amount.`
      );
    }

    if (
      !row.employee.payoutEnabled ||
      !row.employee.trolleyRecipientId ||
      !row.employee.trolleyRecipientAccountId
    ) {
      throw new PayrollSendError(
        "employee_not_ready",
        `Employee ${row.employee.id.toString()} is missing a ready payout method.`
      );
    }
  }
}

function isNonSufficientFundsError(error: unknown): error is TrolleyApiError {
  return (
    error instanceof TrolleyApiError &&
    error.status === 400 &&
    error.code === "non_sufficient_funds"
  );
}

function formatNonSufficientFundsMessage(rawMessage: string): string {
  const balance = rawMessage.match(/balance=([\d.]+)/)?.[1];
  const need = rawMessage.match(/need=([\d.]+)/)?.[1];
  const currency = rawMessage.match(/currency=([A-Za-z]+)/)?.[1];

  if (!balance || !need || !currency) {
    return "Insufficient funds in your Trolley account. Please add funds to your Trolley account.";
  }

  return `Insufficient funds in your Trolley account. Current balance: ${balance}, Required: ${need} ${currency}. Please add funds to your Trolley account.`;
}

function isDuplicateExternalIdError(error: unknown): error is TrolleyApiError {
  if (!(error instanceof TrolleyApiError) || error.status !== 400) {
    return false;
  }

  const haystack = [
    error.message,
    error.code,
    typeof error.details === "string"
      ? error.details
      : error.details
        ? JSON.stringify(error.details)
        : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    haystack.includes("duplicate") &&
    (haystack.includes("externalid") || haystack.includes("external_id") || haystack.includes("external id"))
  );
}

async function findPaymentByExternalId(
  externalId: string
): Promise<Payment | null> {
  const result = await listPayments({ search: externalId, pageSize: 50 });
  const match = result.items.find((p) => p.externalId === externalId);
  return match ?? null;
}

async function createOrReusePayment(
  batchId: string,
  input: CreatePaymentInput
): Promise<Payment> {
  try {
    return await createPayment(batchId, input);
  } catch (error: unknown) {
    if (!isDuplicateExternalIdError(error) || !input.externalId) {
      throw error;
    }

    const existing = await findPaymentByExternalId(input.externalId);
    if (!existing) {
      throw error;
    }

    return existing;
  }
}

export async function sendPayrollRunToTrolley(
  payrollRunId: bigint,
  options: { enforceDue: boolean } = { enforceDue: true }
) {
  const run = (await loadPayrollRun(payrollRunId)) as SerializablePayrollRun | null;
  if (!run) {
    throw new PayrollSendError("not_found", `Payroll run ${payrollRunId.toString()} was not found.`);
  }

  assertRunnable(run, options);
  const companyId = run.companyId;
  if (!companyId) {
    throw new PayrollSendError(
      "missing_company",
      `Payroll run ${run.id.toString()} is not assigned to a company.`
    );
  }

  const tenantContext = await getOrCreateTrolleyTenantContext(companyId);
  const payoutCurrency = run.company?.settings?.defaultPayoutCurrency ?? "CAD";
  const batchPrefix = run.company?.settings?.trolleyBatchPrefix ?? "payroll";
  const batchExternalId = buildTrolleyPayrollRunExternalId({
    companyId,
    payrollRunId: run.id,
  });

  const batch = await createBatch({
    name: `${batchPrefix} ${formatPayDate(run.payDate)} ${tenantContext.tenantKey}`,
    sourceCurrency: payoutCurrency,
    description: `Payroll run ${run.id.toString()} for company ${companyId.toString()}`,
    externalId: batchExternalId,
    metadata: {
      companyId: companyId.toString(),
      tenantKey: tenantContext.tenantKey,
      payrollRunId: run.id.toString(),
      payDate: formatPayDate(run.payDate),
    },
    tags: buildTrolleyTags(tenantContext, "batch", ["payroll"]),
  });

  const paymentResults: Array<{ payHistoryId: bigint; paymentId: string }> = [];

  for (const row of run.payHistory) {
    const payment = await createOrReusePayment(batch.id, {
      recipient: {
        id: row.employee.trolleyRecipientId!,
      },
      amount: formatAmount(row.netPay),
      currency: payoutCurrency,
      description: `Net payroll for ${row.employee.firstName} ${row.employee.lastName}`,
      externalId: buildTrolleyPayHistoryExternalId({
        companyId,
        payHistoryId: row.id,
      }),
      metadata: {
        companyId: companyId.toString(),
        tenantKey: tenantContext.tenantKey,
        payrollRunId: run.id.toString(),
        payHistoryId: row.id.toString(),
        employeeId: row.employee.id.toString(),
      },
      tags: buildTrolleyTags(tenantContext, "payment", ["payroll"]),
    });

    paymentResults.push({
      payHistoryId: row.id,
      paymentId: payment.id,
    });
  }

  let processing;
  try {
    processing = await startBatchProcessing(batch.id);
  } catch (error: unknown) {
    if (isNonSufficientFundsError(error)) {
      throw new PayrollSendError(
        "non_sufficient_funds",
        formatNonSufficientFundsMessage(error.message)
      );
    }
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: "PAYING",
        providerRef: batch.id,
        failureReason: null,
        failureType: null,
        meta: {
          ...(run.meta && typeof run.meta === "object"
            ? (run.meta as Record<string, unknown>)
            : {}),
          trolleyBatchId: batch.id,
          trolleyProcessingStatus: processing.status ?? "processing",
          payDate: formatPayDate(run.payDate),
        } as Prisma.InputJsonValue,
      },
    });

    for (const result of paymentResults) {
      await tx.payHistory.update({
        where: { id: result.payHistoryId },
        data: {
          status: "SENDING",
          paymentProvider: "trolley",
          paymentRef: result.paymentId,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          failureReason: null,
        },
      });
    }
  });

  await billExtraPayrollRunIfNeeded(run.id);

  return {
    payrollRunId: run.id.toString(),
    batchId: batch.id,
    paymentCount: paymentResults.length,
    processingStatus: processing.status ?? "processing",
  };
}

export async function sendAllDuePayrollRunsToTrolley() {
  const dueRuns = await prisma.payrollRun.findMany({
    where: {
      status: "PROCESSED",
      providerRef: null,
      sendAt: { lte: new Date() },
    },
    select: { id: true },
    orderBy: { sendAt: "asc" },
  });

  const processed: Array<{ payrollRunId: string; batchId?: string; error?: string }> = [];

  for (const run of dueRuns) {
    try {
      const result = await sendPayrollRunToTrolley(run.id, { enforceDue: true });
      processed.push({ payrollRunId: result.payrollRunId, batchId: result.batchId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unexpected error while sending payroll run.";
      await prisma.payrollRun.update({
        where: { id: run.id },
        data: { status: "FAILED", failureType: "FUNDING", failureReason: message },
      });
      processed.push({ payrollRunId: run.id.toString(), error: message });
    }
  }

  return { count: processed.length, processed };
}

export async function sendDuePayrollRunsToTrolley(companyId: bigint) {
  const dueRuns = await prisma.payrollRun.findMany({
    where: {
      companyId,
      status: "PROCESSED",
      providerRef: null,
      sendAt: {
        lte: new Date(),
      },
    },
    select: {
      id: true,
    },
    orderBy: { sendAt: "asc" },
  });

  const processed: Array<{ payrollRunId: string; batchId?: string; error?: string }> = [];

  for (const run of dueRuns) {
    try {
      const result = await sendPayrollRunToTrolley(run.id, { enforceDue: true });
      processed.push({
        payrollRunId: result.payrollRunId,
        batchId: result.batchId,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unexpected error while sending payroll run.";

      await prisma.payrollRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          failureType: "FUNDING",
          failureReason: message,
        },
      });

      processed.push({
        payrollRunId: run.id.toString(),
        error: message,
      });
    }
  }

  return {
    count: processed.length,
    processed,
  };
}
