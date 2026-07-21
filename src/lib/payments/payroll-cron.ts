type PayingSummary = {
  processed: number;
  reviewRequired: number;
  failed: number;
  maxProviderRequestsPerInvocation?: number;
  attemptedProviderRequests?: number;
  successfulProviderRequests?: number;
  timedOutRequests?: number;
  rateLimitedRequests?: number;
  pagesFetched?: number;
};
type DuePayrollResult = {
  count: number;
  processed: Array<{ payrollRunId: string; batchId?: string; error?: string }>;
};

export async function runPayrollSendDueJob(options: {
  reconcilePaying?: () => Promise<PayingSummary>;
  sendDue?: () => Promise<DuePayrollResult>;
} = {}) {
  const reconcilePaying = options.reconcilePaying ?? (
    await import("./payroll-payment-reconciliation.ts")
  ).reconcilePayingPayrollRunsFromTrolley;
  const sendDue = options.sendDue ?? (
    await import("./trolley-payroll.ts")
  ).sendAllDuePayrollRunsToTrolley;

  // PAYING evidence is always reconciled before new due payroll is submitted.
  // Historical PAID revalidation is intentionally a separate cron job.
  const payingResult = await reconcilePaying();
  const dueResult: DuePayrollResult = await sendDue();
  const failed = dueResult.processed.filter((result) => Boolean(result.error)).length;

  return {
    paying: {
      processed: payingResult.processed,
      reviewRequired: payingResult.reviewRequired,
      failed: payingResult.failed,
      maxProviderRequestsPerInvocation:
        payingResult.maxProviderRequestsPerInvocation ?? 0,
      attemptedProviderRequests: payingResult.attemptedProviderRequests ?? 0,
      successfulProviderRequests: payingResult.successfulProviderRequests ?? 0,
      timedOutRequests: payingResult.timedOutRequests ?? 0,
      rateLimitedRequests: payingResult.rateLimitedRequests ?? 0,
      pagesFetched: payingResult.pagesFetched ?? 0,
    },
    due: {
      processed: dueResult.count,
      succeeded: dueResult.count - failed,
      failed,
    },
  };
}
