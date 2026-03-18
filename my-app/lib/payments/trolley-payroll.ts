import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createBatch, createPayment, startBatchProcessing } from "@/lib/trolley";

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
  payDate: Date;
  sendAt: Date | null;
  status: string;
  failureType: string | null;
  providerRef: string | null;
  meta: unknown;
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
      payDate: true,
      sendAt: true,
      status: true,
      failureType: true,
      providerRef: true,
      meta: true,
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

export async function sendPayrollRunToTrolley(
  payrollRunId: bigint,
  options: { enforceDue: boolean } = { enforceDue: true }
) {
  const run = (await loadPayrollRun(payrollRunId)) as SerializablePayrollRun | null;
  if (!run) {
    throw new PayrollSendError("not_found", `Payroll run ${payrollRunId.toString()} was not found.`);
  }

  assertRunnable(run, options);

  const batch = await createBatch({
    name: `Payroll ${formatPayDate(run.payDate)}`,
    sourceCurrency: "CAD",
    description: `Payroll run ${run.id.toString()}`,
    externalId: run.id.toString(),
    metadata: {
      payrollRunId: run.id.toString(),
      payDate: formatPayDate(run.payDate),
    },
  });

  const paymentResults: Array<{ payHistoryId: bigint; paymentId: string }> = [];

  for (const row of run.payHistory) {
    const payment = await createPayment(batch.id, {
      recipientId: row.employee.trolleyRecipientId!,
      recipientAccountId: row.employee.trolleyRecipientAccountId!,
      amount: formatAmount(row.netPay),
      currency: "CAD",
      description: `Net payroll for ${row.employee.firstName} ${row.employee.lastName}`,
      externalId: row.id.toString(),
      metadata: {
        payrollRunId: run.id.toString(),
        payHistoryId: row.id.toString(),
        employeeId: row.employee.id.toString(),
      },
    });

    paymentResults.push({
      payHistoryId: row.id,
      paymentId: payment.id,
    });
  }

  const processing = await startBatchProcessing(batch.id);

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

  return {
    payrollRunId: run.id.toString(),
    batchId: batch.id,
    paymentCount: paymentResults.length,
    processingStatus: processing.status ?? "processing",
  };
}

export async function sendDuePayrollRunsToTrolley() {
  const dueRuns = await prisma.payrollRun.findMany({
    where: {
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
