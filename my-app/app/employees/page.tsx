import { prisma } from "@/lib/prisma";
import CreateEmployeeForm from "./CreateEmployeeForm";
import EmployeesClient from "./EmployeesClient";
import Link from "next/link";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";

export default async function EmployeesPage() {
  const company = await requireCompanyAdminOrRedirect();
  const employees = await prisma.employee.findMany({
    where: { companyId: company.id },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      payType: true,
      hourlyRate: true,
      salary: true,
      payGroup: true,
      employmentType: true,
      createdAt: true,
      // 절대 SIN을 노출하지 않음
    },
  });

  const createForm = <CreateEmployeeForm hasSelectedPlan={Boolean(company.currentPlan)} />;

  const table = (
    <section className="rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-900">Employee directory</h2>
        <p className="mt-1 text-sm text-gray-600">
          View payroll setup details and open an employee profile when you need to make changes.
        </p>
      </div>
      <div className="overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="p-3 px-6 text-left">Name</th>
            <th className="p-3 text-left">Email</th>
            <th className="p-3 text-left">Employment</th>
            <th className="p-3 text-left">PayType</th>
            <th className="p-3 text-right">Hourly</th>
            <th className="p-3 text-right">Salary</th>
            <th className="p-3 text-left">PayGroup</th>
            <th className="p-3 text-left">Created</th>
            <th className="p-3 pr-6 text-left">Detail</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => (
            <tr key={e.id.toString()} className="border-t border-gray-100">
              <td className="p-3 px-6 font-medium text-gray-900">
                {e.firstName} {e.lastName}
              </td>
              <td className="p-3 text-gray-700">{e.email}</td>
              <td className="p-3 text-gray-700">{e.employmentType}</td>
              <td className="p-3 text-gray-700">{e.payType}</td>
              <td className="p-3 text-right text-gray-700">
                {e.hourlyRate ? Number(e.hourlyRate).toLocaleString() : "-"}
              </td>
              <td className="p-3 text-right text-gray-700">
                {e.salary ? Number(e.salary).toLocaleString() : "-"}
              </td>
              <td className="p-3 text-gray-700">{e.payGroup}</td>
              <td className="p-3 text-gray-700">{e.createdAt.toLocaleDateString()}</td>
              <td className="p-3 pr-6">
                <Link
                  href={`/employees/${e.id.toString()}`}
                  className="inline-flex rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
          {employees.length === 0 && (
            <tr>
              <td className="p-6 text-center text-gray-500" colSpan={9}>
                No employees yet. Create one ↑
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </section>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 space-y-6">
      <header className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-3">
        <Link
          href="/"
          className="inline-flex items-center rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <span className="mr-1 text-lg">←</span>
          Back to Home
        </Link>
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.2em] text-gray-500">Employees</p>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
            Manage your team
          </h1>
          <p className="max-w-2xl text-sm text-gray-600">
            Add employees, review payroll setup details, and open profiles without changing the
            current workflow.
          </p>
        </div>
      </header>
      <EmployeesClient createForm={createForm} table={table} />
    </div>
  );
}
