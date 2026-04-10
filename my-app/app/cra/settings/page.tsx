import { RemitterType } from "@prisma/client";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { getMissingT4FilingSettings, getOrCreateCompanyPayrollSettings } from "@/lib/cra";
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

export default async function CraSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const company = await requireCompanyAdminOrRedirect();
  const [settings, missingT4Settings, resolvedSearchParams] = await Promise.all([
    getOrCreateCompanyPayrollSettings(company.id),
    getMissingT4FilingSettings(company.id),
    searchParams ?? Promise.resolve({}),
  ]);
  const showT4Error = resolvedSearchParams.error === "t4-settings-incomplete";
  const showSuccessMessage = resolvedSearchParams.success === "saved";

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-gray-900">CRA payroll account settings</h2>
          <p className="text-sm text-gray-600">
            These settings drive due dates, reminders, remittance grouping, and year-end documents.
          </p>
        </div>
        {showT4Error ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            T4 generation is blocked until these fields are filled: {missingT4Settings.join(", ")}.
          </div>
        ) : null}
        {showSuccessMessage ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            CRA settings saved successfully.
          </div>
        ) : null}

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
            <span className="mb-1 block text-sm text-gray-600">Submission language</span>
            <select
              name="submissionLanguageCode"
              defaultValue={settings.submissionLanguageCode ?? "E"}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            >
              <option value="E">English</option>
              <option value="F">French</option>
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm text-gray-600">Employer address line 1</span>
            <input
              type="text"
              name="addressLine1"
              defaultValue={settings.addressLine1 ?? ""}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm text-gray-600">Employer address line 2</span>
            <input
              type="text"
              name="addressLine2"
              defaultValue={settings.addressLine2 ?? ""}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">City</span>
            <input
              type="text"
              name="city"
              defaultValue={settings.city ?? ""}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Province code</span>
            <input
              type="text"
              name="provinceCode"
              defaultValue={settings.provinceCode ?? "ON"}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Postal code</span>
            <input
              type="text"
              name="postalCode"
              defaultValue={settings.postalCode ?? ""}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Country code</span>
            <input
              type="text"
              name="countryCode"
              defaultValue={settings.countryCode ?? "CAN"}
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
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">CRA contact name</span>
            <input
              type="text"
              name="contactName"
              defaultValue={settings.contactName ?? ""}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">CRA contact phone</span>
            <input
              type="text"
              name="contactPhone"
              defaultValue={settings.contactPhone ?? ""}
              placeholder="4165551234"
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Phone extension</span>
            <input
              type="text"
              name="contactPhoneExtension"
              defaultValue={settings.contactPhoneExtension ?? ""}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Transmitter account number</span>
            <input
              type="text"
              name="transmitterAccountNumber"
              defaultValue={settings.transmitterAccountNumber ?? ""}
              placeholder="123456789RP0001"
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Transmitter RepID</span>
            <input
              type="text"
              name="transmitterRepId"
              defaultValue={settings.transmitterRepId ?? ""}
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
