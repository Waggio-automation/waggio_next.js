import { RemitterType } from "@prisma/client";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { getMissingT4FilingSettings, getOrCreateCompanyPayrollSettings } from "@/lib/cra";
import { saveCraSettingsAction } from "../actions";
import PlanRequiredButton from "@/app/components/PlanRequiredButton";

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
    searchParams ?? Promise.resolve({} as { error?: string; success?: string }),
  ]);
  const showT4Error = resolvedSearchParams.error === "t4-settings-incomplete";
  const showInvalidSettingsError = resolvedSearchParams.error === "invalid-settings";
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
        {showInvalidSettingsError ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            CRA settings could not be saved. Check account numbers, contact details, and reminder day ranges.
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
              maxLength={120}
              required
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Business number</span>
            <input
              type="text"
              name="businessNumber"
              defaultValue={settings.businessNumber ?? ""}
              inputMode="numeric"
              pattern="\d{9}"
              maxLength={9}
              title="Enter a 9-digit CRA business number."
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
              pattern="\d{9}[Rr][Pp]\d{4}"
              maxLength={15}
              required
              title="Enter a payroll program account like 123456789RP0001."
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Submission language</span>
            <select
              name="submissionLanguageCode"
              defaultValue={settings.submissionLanguageCode ?? "E"}
              required
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
              maxLength={60}
              required
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm text-gray-600">Employer address line 2</span>
            <input
              type="text"
              name="addressLine2"
              defaultValue={settings.addressLine2 ?? ""}
              maxLength={60}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">City</span>
            <input
              type="text"
              name="city"
              defaultValue={settings.city ?? ""}
              maxLength={40}
              required
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Province code</span>
            <input
              type="text"
              name="provinceCode"
              defaultValue={settings.provinceCode ?? "ON"}
              pattern="[A-Za-z]{2}"
              maxLength={2}
              required
              title="Enter a 2-letter province or territory code."
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Postal code</span>
            <input
              type="text"
              name="postalCode"
              defaultValue={settings.postalCode ?? ""}
              pattern="[A-Za-z]\d[A-Za-z][ ]?\d[A-Za-z]\d"
              maxLength={7}
              required
              title="Enter a Canadian postal code like A1A 1A1."
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Country code</span>
            <input
              type="text"
              name="countryCode"
              defaultValue={settings.countryCode ?? "CAN"}
              pattern="[A-Za-z]{3}"
              maxLength={3}
              required
              title="Enter a 3-letter country code like CAN."
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Reminder email</span>
            <input
              type="email"
              name="contactEmail"
              defaultValue={settings.contactEmail ?? ""}
              maxLength={254}
              required
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">CRA contact name</span>
            <input
              type="text"
              name="contactName"
              defaultValue={settings.contactName ?? ""}
              maxLength={60}
              required
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
              inputMode="tel"
              maxLength={30}
              pattern="[\d\s()+.-]{10,30}"
              required
              title="Enter a phone number with 10 to 15 digits."
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Phone extension</span>
            <input
              type="text"
              name="contactPhoneExtension"
              defaultValue={settings.contactPhoneExtension ?? ""}
              inputMode="numeric"
              pattern="\d{1,10}"
              maxLength={10}
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
              pattern="\d{9}[Rr][Pp]\d{4}"
              maxLength={15}
              title="Enter a transmitter account number like 123456789RP0001."
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-600">Transmitter RepID</span>
            <input
              type="text"
              name="transmitterRepId"
              defaultValue={settings.transmitterRepId ?? ""}
              pattern="[A-Za-z0-9-]{4,15}"
              maxLength={15}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm text-gray-600">Remitter type</span>
            <select
              name="remitterType"
              defaultValue={settings.remitterType}
              required
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
              max="365"
              step="1"
              required
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
              max="365"
              step="1"
              required
              name="postDueReminderFrequencyDays"
              defaultValue={settings.postDueReminderFrequencyDays}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm"
            />
          </label>

          <div className="md:col-span-2 flex justify-end">
            <PlanRequiredButton
              hasSelectedPlan={Boolean(company.currentPlan)}
              currentPlan={company.currentPlan}
              requiredPlan="PRO"
              type="submit"
              className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
            >
              Save CRA settings
            </PlanRequiredButton>
          </div>
        </form>
      </section>
    </div>
  );
}
