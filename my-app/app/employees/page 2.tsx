import { prisma } from "@/lib/prisma";
import EmployeesClient from "./EmployeesClient";
import CreateEmployeeForm from "./CreateEmployeeForm";
import Link from "next/link";

export default async function EmployeesPage() {
  const employees = await prisma.employee.findMany({
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

  const createForm = (
    <CreateEmployeeForm />
  );

  const table = (
    <section className="border rounded overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-3 text-left">Name</th>
            <th className="p-3 text-left">Email</th>
            <th className="p-3 text-left">Employment</th>
            <th className="p-3 text-left">PayType</th>
            <th className="p-3 text-right">Hourly</th>
            <th className="p-3 text-right">Salary</th>
            <th className="p-3 text-left">PayGroup</th>
            <th className="p-3 text-left">Created</th>
            <th className="p-3 text-left">Detail</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => (
            <tr key={e.id.toString()} className="border-t">
              <td className="p-3">
                {e.firstName} {e.lastName}
              </td>
              <td className="p-3">{e.email}</td>
              <td className="p-3">{e.employmentType}</td>
              <td className="p-3">{e.payType}</td>
              <td className="p-3 text-right">
                {e.hourlyRate ? Number(e.hourlyRate).toLocaleString() : "-"}
              </td>
              <td className="p-3 text-right">
                {e.salary ? Number(e.salary).toLocaleString() : "-"}
              </td>
              <td className="p-3">{e.payGroup}</td>
              <td className="p-3">{e.createdAt.toLocaleDateString()}</td>
              <td className="p-3">
                <Link
                  href={`/employees/${e.id.toString()}`}
                  className="text-sm text-indigo-700 hover:text-indigo-500"
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
    </section>
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <span className="mr-1 text-lg">←</span>
        Back to Home
      </Link>
      <h1 className="text-2xl font-semibold">Employees</h1>
      <EmployeesClient createForm={createForm} table={table} />
    </div>
  );
}
