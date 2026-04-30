"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RemitterType } from "@prisma/client";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import {
  generateT4Package,
  getMissingT4FilingSettings,
  recordRemittancePayment,
  syncRemittancesForCompany,
  updateCompanyPayrollSettings,
} from "@/lib/cra";

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

  const remitterType = asString(formData.get("remitterType")) as RemitterType;

  await updateCompanyPayrollSettings(company.id, {
    legalName: asString(formData.get("legalName")),
    businessNumber: asString(formData.get("businessNumber")),
    payrollProgramAccount: asString(formData.get("payrollProgramAccount")),
    addressLine1: asString(formData.get("addressLine1")),
    addressLine2: asString(formData.get("addressLine2")),
    city: asString(formData.get("city")),
    provinceCode: asString(formData.get("provinceCode")),
    postalCode: asString(formData.get("postalCode")),
    countryCode: asString(formData.get("countryCode")),
    remitterType,
    contactName: asString(formData.get("contactName")),
    contactPhone: asString(formData.get("contactPhone")),
    contactPhoneExtension: asString(formData.get("contactPhoneExtension")),
    contactEmail: asString(formData.get("contactEmail")),
    transmitterAccountNumber: asString(formData.get("transmitterAccountNumber")),
    transmitterRepId: asString(formData.get("transmitterRepId")),
    submissionLanguageCode: asString(formData.get("submissionLanguageCode")),
    preDueReminderDays: Number(asString(formData.get("preDueReminderDays")) || 7),
    postDueReminderFrequencyDays: Number(
      asString(formData.get("postDueReminderFrequencyDays")) || 7
    ),
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
