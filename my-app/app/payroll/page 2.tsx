// app/(...)/payroll/page.tsx
import { prisma } from "@/lib/prisma";
import HoursTable from "./hours-table";
import Link from "next/link";
import PayrollStatusBlock from "./payroll-status-block";
import { toPayrollStatusUi } from "@/lib/payments/payroll-status";

type PayrollRunMeta = {
  employeeIds?: string[];
};

function getFirstEmployeeId(meta: unknown) {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as PayrollRunMeta;
  if (!Array.isArray(m.employeeIds)) return null;
  return typeof m.employeeIds[0] === "string" ? m.employeeIds[0] : null;
}

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const [rows, payrollRuns] = await Promise.all([
    prisma.employee.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        employmentType: true,
        payType: true,
        hourlyRate: true,
        salary: true,
        payGroup: true,
        vacationPay: true,
        createdAt: true,
      },
    }),
    prisma.payrollRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        payDate: true,
        status: true,
        failureType: true,
        failureReason: true,
        meta: true,
      },
    }),
  ]);

  const employees = rows.map((e) => ({
    id: e.id.toString(),
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    employmentType: e.employmentType,
    payType: e.payType,
    hourlyRate: e.hourlyRate ? Number(e.hourlyRate) : null,
    salary: e.salary ? Number(e.salary) : null,
    payGroup: e.payGroup ?? "BI_WEEKLY",
    vacationPay: e.vacationPay != null ? Number(e.vacationPay) : 0,
    createdAt: e.createdAt.toISOString(),
  }));

  const payrollStatusRows = payrollRuns.map((run) => {
    const employeeFromMeta = getFirstEmployeeId(run.meta);

    return {
      id: run.id.toString(),
      payday: run.payDate.toLocaleDateString(),
      status: toPayrollStatusUi(run.status),
      failureType:
        run.failureType === "FUNDING"
          ? ("funding" as const)
          : run.failureType === "EMPLOYEE"
            ? ("employee" as const)
            : null,
      failureReason: run.failureReason,
      employeeIssueId: run.failureType === "EMPLOYEE" ? employeeFromMeta : null,
    };
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 space-y-6">
      {/* 🔹 상단 헤더 */}
      <header className="space-y-3">
        {/* 작고 심플한 백 링크 */}
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <span className="mr-1 text-lg">←</span>
          Back to Home
        </Link>

        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">
            Payroll Paystub Generator
          </h1>
          <p className="mt-1 text-sm sm:text-base text-gray-500">
            Run payroll, calculate hours (including holidays), and save paystubs for your team.
          </p>
        </div>
      </header>

      <div className="-mx-4 sm:mx-0">
        <PayrollStatusBlock runs={payrollStatusRows} />
      </div>

      <div className="-mx-4 sm:mx-0">
        <HoursTable employees={employees} />
      </div>
    </main>
  );
}
