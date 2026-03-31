import { RemitterType } from "@prisma/client";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { getOrCreateCompanyPayrollSettings } from "@/lib/cra";
import { saveCraSettingsAction } from "../actions";

const remitterTypeOptions: Array<{ value: RemitterType; label: string; help: string }> = [
  {
    value: "MONTHLY",
    label: "Monthly",
    help: "Best default for most small employers.",
  },
  {
    value: "QUARTERLY",
    label: "Quarterly",
    help: "For eligible small remitters.",
  },
  {
    value: "ACCELERATED_THRESHOLD_1",
    label: "Accelerated 1",
    help: "Structure-ready only in this MVP.",
  },
  {
    value: "ACCELERATED_THRESHOLD_2",
    label: "Accelerated 2",
    help: "Structure-ready only in this MVP.",
  },
];

export default async function CraSettingsPage() {
  const company = await requireCompanyAdminOrRedirect();
  const settings = await getOrCreateCompanyPayrollSettings(company.id);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-gray-900">CRA payroll account settings</h2>
          <p className="text-sm text-gray-600">
            These settings drive due dates, reminders, remittance grouping, and year-end documents.
          </p>
        </div>

        <form action={saveCraSettingsAction} className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Legal business name</span>
            <input
              type="text"
              name="legalName"
              defaultValue={settings.legalName ?? ""}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Business number</span>
            <input
              type="text"
              name="businessNumber"
              defaultValue={settings.businessNumber ?? ""}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">CRA payroll account number</span>
            <input
              type="text"
              name="payrollProgramAccount"
              defaultValue={settings.payrollProgramAccount ?? ""}
              placeholder="Example: 123456789RP0001"
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Reminder email</span>
            <input
              type="email"
              name="contactEmail"
              defaultValue={settings.contactEmail ?? ""}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm text-gray-600">Remitter type</span>
            <select
              name="remitterType"
              defaultValue={settings.remitterType}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            >
              {remitterTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} - {option.help}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Pre-due reminder days</span>
            <input
              type="number"
              min="1"
              name="preDueReminderDays"
              defaultValue={settings.preDueReminderDays}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Overdue reminder cadence</span>
            <input
              type="number"
              min="1"
              name="postDueReminderFrequencyDays"
              defaultValue={settings.postDueReminderFrequencyDays}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
            >
              Save CRA settings
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
