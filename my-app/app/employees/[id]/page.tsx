import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateEmployeeCraProfileAction } from "../actions";
import PaymentStatusCard from "./payment-status-card";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import PlanRequiredButton from "@/app/components/PlanRequiredButton";

function toUiPayoutStatus(status: string) {
  switch (status) {
    case "REQUIRED":
      return "required" as const;
    case "PENDING":
      return "pending" as const;
    case "READY":
      return "ready" as const;
    case "ISSUE":
      return "issue" as const;
    default:
      return "required" as const;
  }
}

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const company = await requireCompanyAdminOrRedirect();

  let employeeId: bigint;
  try {
    employeeId = BigInt(id);
  } catch {
    notFound();
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId, companyId: company.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      employmentType: true,
      payType: true,
      payGroup: true,
      dentalBenefitsCoverage: true,
      rppDpspRegistrationNumber: true,
      pensionAdjustmentOverride: true,
      payoutSetupStatus: true,
      payoutEnabled: true,
      trolleyRecipientAccountType: true,
      createdAt: true,
    },
  });

  if (!employee) {
    notFound();
  }

  const fieldClassName =
    "w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-500";
  const labelClassName = "flex flex-col gap-2 text-sm text-gray-700";

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <Link
        href="/employees"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <span className="mr-1 text-lg">←</span>
        Back to Employees
      </Link>

      <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-gray-900">
            {employee.firstName} {employee.lastName}
          </h1>
          <p className="text-sm text-gray-600">{employee.email}</p>
        </div>
        <div className="rounded-2xl bg-gray-50 px-4 py-3">
          <div className="grid grid-cols-2 gap-3 text-sm text-gray-600">
            <p>Employment: {employee.employmentType}</p>
            <p>Pay type: {employee.payType}</p>
            <p>Pay group: {employee.payGroup}</p>
            <p>Created: {employee.createdAt.toLocaleDateString()}</p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm space-y-5">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-gray-900">CRA / T4 profile</h2>
          <p className="text-sm text-gray-600">
            Manage year-end filing details here instead of entering CRA box codes directly.
          </p>
        </div>

        <form action={updateEmployeeCraProfileAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="employeeId" value={employee.id.toString()} />

          <label className={`${labelClassName} md:col-span-2`}>
            <span>Dental benefits coverage</span>
            <select
              name="dentalBenefitsCoverage"
              defaultValue={employee.dentalBenefitsCoverage}
              className={fieldClassName}
            >
              <option value="NONE">No employer-offered dental benefits</option>
              <option value="EMPLOYEE_ONLY">Employee only</option>
              <option value="EMPLOYEE_AND_SPOUSE">Employee and spouse</option>
              <option value="EMPLOYEE_AND_CHILDREN">Employee and dependent children</option>
              <option value="EMPLOYEE_AND_FAMILY">Employee, spouse, and dependent children</option>
            </select>
          </label>

          <label className={labelClassName}>
            <span>RPP or DPSP registration number</span>
            <input
              type="text"
              name="rppDpspRegistrationNumber"
              defaultValue={employee.rppDpspRegistrationNumber ?? ""}
              className={fieldClassName}
            />
          </label>

          <label className={labelClassName}>
            <span>Pension adjustment override</span>
            <input
              type="number"
              name="pensionAdjustmentOverride"
              step="0.01"
              min="0"
              defaultValue={employee.pensionAdjustmentOverride?.toString() ?? ""}
              className={fieldClassName}
            />
          </label>

          <div className="md:col-span-2 flex justify-end">
            <PlanRequiredButton
              hasSelectedPlan={Boolean(company.currentPlan)}
              currentPlan={company.currentPlan}
              requiredPlan="PRO"
              type="submit"
              className="rounded-full bg-gray-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              Save CRA / T4 profile
            </PlanRequiredButton>
          </div>
        </form>
      </section>

      <PaymentStatusCard
        employeeId={employee.id.toString()}
        initialStatus={toUiPayoutStatus(employee.payoutSetupStatus)}
        initialMethod={
          employee.trolleyRecipientAccountType === "paypal" ? "paypal" : "bank-transfer"
        }
        hasSelectedPlan={Boolean(company.currentPlan)}
      />
    </main>
  );
}
