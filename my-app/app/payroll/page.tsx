import { prisma } from "@/lib/prisma";
import HoursTable from "./hours-table";

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
    id: e.id.toString(),                               // BIGINT → string
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    employmentType: e.employmentType,
    payType: e.payType,                                // 'HOURLY' | 'SALARY'
    hourlyRate: e.hourlyRate ? Number(e.hourlyRate) : null,
    salary: e.salary ? Number(e.salary) : null,
    payGroup: e.payGroup ?? "BI_WEEKLY",               // 'BI_WEEKLY' | 'MONTHLY'
    vacationPay: e.vacationPay != null ? Number(e.vacationPay) : 0,
    createdAt: e.createdAt.toISOString(),
  }));

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Payroll Calculator</h1>
      </header>
      <HoursTable employees={employees} />
    </main>
  );
}
