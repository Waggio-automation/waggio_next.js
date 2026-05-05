"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import {
  generateT4Package,
  getMissingT4FilingSettings,
  recordRemittancePayment,
  syncRemittancesForCompany,
  updateCompanyPayrollSettings,
} from "@/lib/cra";
import { craSettingsInputSchema } from "./validators";

function asString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

function requireProPlan(company: { currentPlan: string | null }) {
  if (!company.currentPlan) {
    redirect("/company-settings?setup=plan_required");
  }
  if (company.currentPlan !== "PRO") {
    redirect("/company-settings?setup=upgrade_required");
  }
}

export async function saveCraSettingsAction(formData: FormData) {
  const company = await requireCompanyAdminOrRedirect();
  requireProPlan(company);

  const parsed = craSettingsInputSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    redirect("/cra/settings?error=invalid-settings");
  }

  await updateCompanyPayrollSettings(company.id, {
    legalName: parsed.data.legalName,
    businessNumber: parsed.data.businessNumber,
    payrollProgramAccount: parsed.data.payrollProgramAccount,
    addressLine1: parsed.data.addressLine1,
    addressLine2: parsed.data.addressLine2,
    city: parsed.data.city,
    provinceCode: parsed.data.provinceCode,
    postalCode: parsed.data.postalCode,
    countryCode: parsed.data.countryCode,
    remitterType: parsed.data.remitterType,
    contactName: parsed.data.contactName,
    contactPhone: parsed.data.contactPhone,
    contactPhoneExtension: parsed.data.contactPhoneExtension,
    contactEmail: parsed.data.contactEmail,
    transmitterAccountNumber: parsed.data.transmitterAccountNumber,
    transmitterRepId: parsed.data.transmitterRepId,
    submissionLanguageCode: parsed.data.submissionLanguageCode,
    preDueReminderDays: parsed.data.preDueReminderDays,
    postDueReminderFrequencyDays: parsed.data.postDueReminderFrequencyDays,
  });

  await syncRemittancesForCompany(company.id);

  revalidatePath("/");
  revalidatePath("/cra");
  revalidatePath("/cra/settings");
  redirect("/cra/settings?success=saved");
}

export async function syncRemittancesAction() {
  const company = await requireCompanyAdminOrRedirect();
  requireProPlan(company);
  await syncRemittancesForCompany(company.id);
  revalidatePath("/");
  revalidatePath("/cra");
}

export async function markRemittancePaidAction(formData: FormData) {
  const company = await requireCompanyAdminOrRedirect();
  requireProPlan(company);

  await recordRemittancePayment({
    companyId: company.id,
    remittanceId: BigInt(asString(formData.get("remittanceId"))),
    paymentDate: new Date(asString(formData.get("paymentDate"))),
    amountPaid: Number(asString(formData.get("amountPaid")) || 0),
    paymentMethod: asString(formData.get("paymentMethod")) || null,
    referenceNumber: asString(formData.get("referenceNumber")) || null,
    notes: asString(formData.get("notes")) || null,
  });

  revalidatePath("/");
  revalidatePath("/cra");
  revalidatePath(`/cra/remittances/${asString(formData.get("remittanceId"))}`);
}

export async function generateT4Action(formData: FormData) {
  const company = await requireCompanyAdminOrRedirect();
  requireProPlan(company);
  const taxYear = Number(asString(formData.get("taxYear")) || new Date().getFullYear());
  const missingSettings = await getMissingT4FilingSettings(company.id);

  if (missingSettings.length > 0) {
    redirect("/cra/settings?error=t4-settings-incomplete");
  }

  await generateT4Package(company.id, taxYear);
  revalidatePath("/");
  revalidatePath("/cra");
  revalidatePath("/cra/t4");
}
