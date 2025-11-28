// app/(...)/payroll/page.tsx
import { prisma } from "@/lib/prisma";
import HoursTable from "./hours-table";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const rows = await prisma.employee.findMany({
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
  });

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

  return (
    <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
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
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
            Payroll Paystub Generator
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Run payroll, calculate hours (including holidays), and save paystubs for your team.
          </p>
        </div>
      </header>

      <HoursTable employees={employees} />
    </main>
  );
}
