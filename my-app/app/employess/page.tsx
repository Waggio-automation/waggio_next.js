import { prisma } from "@/lib/prisma";
import { createEmployee } from "./actions";
import PayTypeFields from "./pay-type-fields";
import PaymentMethodFields from "./payment-method-fields";

export default async function EmployeesPage() {
  const employees = await prisma.employee.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true, firstName:true, lastName:true, email:true,
      payType:true, hourlyRate:true, salary:true, payGroup:true,
      employmentType:true, createdAt:true,
      // 절대 SIN을 노출하지 않음
    },
  });

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Employees</h1>

      {/* ── 생성 폼 ── */}
      <section className="border rounded p-4 space-y-4">
        <h2 className="text-lg font-medium">Create Employee</h2>
        <form action={createEmployee} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span>First name *</span>
              <input name="firstName" required className="border rounded p-2"/>
            </label>
            <label className="flex flex-col gap-1">
              <span>Last name *</span>
              <input name="lastName" required className="border rounded p-2"/>
            </label>
            <label className="col-span-2 flex flex-col gap-1">
              <span>Email *</span>
              <input type="email" name="email" required className="border rounded p-2"/>
            </label>
            <label className="col-span-2 flex flex-col gap-1">
              <span>SIN (9 digits) *</span>
              <input name="sin" inputMode="numeric" pattern="\d{9}" required className="border rounded p-2"/>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span>Address line 1 *</span>
              <input name="addrLine1" required className="border rounded p-2"/>
            </label>
            <label className="flex flex-col gap-1">
              <span>Address line 2</span>
              <input name="addrLine2" className="border rounded p-2"/>
            </label>
            <label className="flex flex-col gap-1">
              <span>City *</span>
              <input name="addrCity" required className="border rounded p-2"/>
            </label>
            <label className="flex flex-col gap-1">
              <span>Province</span>
              <input name="addrProvince" defaultValue="ON" className="border rounded p-2"/>
            </label>
            <label className="flex flex-col gap-1">
              <span>Postal Code *</span>
              <input name="addrPostal" required className="border rounded p-2"/>
            </label>
            <label className="flex flex-col gap-1">
              <span>Country</span>
              <input name="addrCountry" defaultValue="CA" className="border rounded p-2"/>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <label className="flex flex-col gap-1">
              <span>Birth date *</span>
              <input type="date" name="birthDate" required className="border rounded p-2"/>
            </label>
            <label className="flex flex-col gap-1">
              <span>Employment type *</span>
              <select name="employmentType" className="border rounded p-2">
                <option>FULL_TIME</option>
                <option>PART_TIME</option>
                <option>CONTRACTOR</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span>Hire date *</span>
              <input type="date" name="hireDate" required className="border rounded p-2"/>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span>Pay group</span>
            <select name="payGroup" className="border rounded p-2" defaultValue="BI_WEEKLY">
              <option>BI_WEEKLY</option>
              <option>MONTHLY</option>
            </select>
          </label>

          <PayTypeFields />            {/* payType + hourlyRate/salary 토글 */}
          <PaymentMethodFields />      {/* paymentMethod + 은행정보 토글 */}

          <div className="grid grid-cols-3 gap-4">
            <label className="flex flex-col gap-1">
              <span>Vacation %</span>
              <input name="vacationPay" type="number" step="0.01" defaultValue={4} className="border rounded p-2"/>
            </label>
            <label className="flex flex-col gap-1">
              <span>Bonus</span>
              <input name="bonus" type="number" step="0.01" defaultValue={0} className="border rounded p-2"/>
            </label>
            <div/>
            <label className="flex flex-col gap-1">
              <span>Federal TD1</span>
              <input name="federalTD1" type="number" step="0.01" defaultValue={15492} className="border rounded p-2"/>
            </label>
            <label className="flex flex-col gap-1">
              <span>Provincial TD1</span>
              <input name="provincialTD1" type="number" step="0.01" defaultValue={12298} className="border rounded p-2"/>
            </label>
          </div>

          <button type="submit" className="border rounded px-4 py-2 hover:bg-gray-50">
            Create
          </button>
        </form>
      </section>

      {/* ── 목록 ── */}
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
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id.toString()} className="border-t">
                <td className="p-3">{e.firstName} {e.lastName}</td>
                <td className="p-3">{e.email}</td>
                <td className="p-3">{e.employmentType}</td>
                <td className="p-3">{e.payType}</td>
                <td className="p-3 text-right">{e.hourlyRate ?? "-"}</td>
                <td className="p-3 text-right">{e.salary ?? "-"}</td>
                <td className="p-3">{e.payGroup}</td>
                <td className="p-3">{new Date(e.createdAt as any).toLocaleDateString()}</td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr><td className="p-6 text-center text-gray-500" colSpan={8}>
                No employees yet. Create one ↑
              </td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
