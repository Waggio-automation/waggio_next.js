import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateEmployeeCraProfileAction, updateEmployeeProfileAction } from "../actions";
import PaymentStatusCard from "./payment-status-card";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import PlanRequiredButton from "@/app/components/PlanRequiredButton";
import AddressAutocompleteFields from "@/app/components/AddressAutocompleteFields";

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

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ updated?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await (searchParams ??
    Promise.resolve({} as { updated?: string }));
  const company = await requireCompanyAdminOrRedirect();
  const hasProPlan = company.currentPlan === "PRO";

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
      employeeNumber: true,
      department: true,
      jobTitle: true,
      institutionNumber: true,
      transitBranchNumber: true,
      accountNumber: true,
      addrLine1: true,
      addrLine2: true,
      addrCity: true,
      addrProvince: true,
      addrPostal: true,
      addrCountry: true,
      birthDate: true,
      employmentType: true,
      hireDate: true,
      payType: true,
      payGroup: true,
      hourlyRate: true,
      salary: true,
      vacationPay: true,
      bonus: true,
      federalTD1: true,
      provincialTD1: true,
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
  const successMessage =
    resolvedSearchParams.updated === "profile"
      ? "Employee information saved successfully."
      : resolvedSearchParams.updated === "cra"
        ? "CRA / T4 profile saved successfully."
        : null;

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      {successMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {successMessage}
        </div>
      ) : null}

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
          <h2 className="text-xl font-semibold text-gray-900">Employee information</h2>
          <p className="text-sm text-gray-600">
            Update profile, address, and payroll details used across payroll runs and reports.
          </p>
        </div>

        <form action={updateEmployeeProfileAction} className="space-y-5">
          <input type="hidden" name="employeeId" value={employee.id.toString()} />

          <div className="grid gap-4 md:grid-cols-2">
            <label className={labelClassName}>
              <span>First name *</span>
              <input
                name="firstName"
                required
                defaultValue={employee.firstName}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              <span>Last name *</span>
              <input
                name="lastName"
                required
                defaultValue={employee.lastName}
                className={fieldClassName}
              />
            </label>
            <label className={`${labelClassName} md:col-span-2`}>
              <span>Email *</span>
              <input
                type="email"
                name="email"
                required
                defaultValue={employee.email}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              <span>Employee number</span>
              <input
                name="employeeNumber"
                defaultValue={employee.employeeNumber ?? ""}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              <span>Department</span>
              <input
                name="department"
                defaultValue={employee.department ?? ""}
                className={fieldClassName}
              />
            </label>
            <label className={`${labelClassName} md:col-span-2`}>
              <span>Job title</span>
              <input
                name="jobTitle"
                defaultValue={employee.jobTitle ?? ""}
                className={fieldClassName}
              />
            </label>
          </div>

          <AddressAutocompleteFields
            names={{
              line1: "addrLine1",
              line2: "addrLine2",
              city: "addrCity",
              province: "addrProvince",
              postal: "addrPostal",
              country: "addrCountry",
            }}
            defaults={{
              line1: employee.addrLine1,
              line2: employee.addrLine2,
              city: employee.addrCity,
              province: employee.addrProvince,
              postal: employee.addrPostal,
              country: employee.addrCountry,
            }}
            fieldClassName={fieldClassName}
            labelClassName={labelClassName}
            required={{ line1: true, city: true, postal: true }}
          />

          <div className="grid gap-4 md:grid-cols-3">
            <label className={labelClassName}>
              <span>Birth date *</span>
              <input
                type="date"
                name="birthDate"
                required
                defaultValue={formatDateInput(employee.birthDate)}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              <span>Employment type *</span>
              <select
                name="employmentType"
                defaultValue={employee.employmentType}
                className={fieldClassName}
              >
                <option value="FULL_TIME">FULL_TIME</option>
                <option value="PART_TIME">PART_TIME</option>
                <option value="CONTRACTOR">CONTRACTOR</option>
              </select>
            </label>
            <label className={labelClassName}>
              <span>Hire date *</span>
              <input
                type="date"
                name="hireDate"
                required
                defaultValue={formatDateInput(employee.hireDate)}
                className={fieldClassName}
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className={labelClassName}>
              <span>Pay group</span>
              <select
                name="payGroup"
                defaultValue={employee.payGroup}
                className={fieldClassName}
              >
                <option value="BI_WEEKLY">BI_WEEKLY</option>
                <option value="MONTHLY">MONTHLY</option>
              </select>
            </label>
            <label className={labelClassName}>
              <span>Pay type</span>
              <select name="payType" defaultValue={employee.payType} className={fieldClassName}>
                <option value="HOURLY">HOURLY</option>
                <option value="SALARY">SALARY</option>
              </select>
            </label>
            <label className={labelClassName}>
              <span>Hourly rate</span>
              <input
                name="hourlyRate"
                type="number"
                step="0.01"
                defaultValue={employee.hourlyRate?.toString() ?? ""}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              <span>Annual salary</span>
              <input
                name="salary"
                type="number"
                step="0.01"
                defaultValue={employee.salary?.toString() ?? ""}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              <span>Vacation %</span>
              <input
                name="vacationPay"
                type="number"
                step="0.01"
                defaultValue={employee.vacationPay.toString()}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              <span>Bonus</span>
              <input
                name="bonus"
                type="number"
                step="0.01"
                defaultValue={employee.bonus.toString()}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              <span>Federal TD1</span>
              <input
                name="federalTD1"
                type="number"
                step="0.01"
                defaultValue={employee.federalTD1.toString()}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              <span>Provincial TD1</span>
              <input
                name="provincialTD1"
                type="number"
                step="0.01"
                defaultValue={employee.provincialTD1.toString()}
                className={fieldClassName}
              />
            </label>
          </div>

          <div className="flex justify-end">
            <PlanRequiredButton
              hasSelectedPlan={Boolean(company.currentPlan)}
              currentPlan={company.currentPlan}
              type="submit"
              className="rounded-full bg-gray-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              Save employee information
            </PlanRequiredButton>
          </div>
        </form>
      </section>

      {hasProPlan ? (
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
              <button
                type="submit"
                className="rounded-full bg-gray-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                Save CRA / T4 profile
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <PaymentStatusCard
        employeeId={employee.id.toString()}
        initialStatus={toUiPayoutStatus(employee.payoutSetupStatus)}
        initialMethod={
          employee.trolleyRecipientAccountType === "paypal" ? "paypal" : "bank-transfer"
        }
        initialAccountHolderName={`${employee.firstName} ${employee.lastName}`}
        initialAccountNumber={employee.accountNumber}
        initialInstitutionNumber={employee.institutionNumber}
        initialTransitBranchNumber={employee.transitBranchNumber}
        initialPaypalEmail={employee.email}
        hasSelectedPlan={Boolean(company.currentPlan)}
      />
    </main>
  );
}
