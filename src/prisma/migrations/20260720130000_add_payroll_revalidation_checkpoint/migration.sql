CREATE TABLE "PayrollReconciliationCheckpoint" (
    "jobName" TEXT NOT NULL,
    "cursorPayrollRunId" BIGINT,
    "completedSweeps" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastStartedAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollReconciliationCheckpoint_pkey" PRIMARY KEY ("jobName")
);
