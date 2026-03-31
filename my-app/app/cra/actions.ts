"use server";

import { revalidatePath } from "next/cache";
import { RemitterType } from "@prisma/client";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import {
  generateT4Package,
  recordRemittancePayment,
  syncRemittancesForCompany,
  updateCompanyPayrollSettings,
} from "@/lib/cra";

function asString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

export async function saveCraSettingsAction(formData: FormData) {
  const company = await requireCompanyAdminOrRedirect();

  const remitterType = asString(formData.get("remitterType")) as RemitterType;

  await updateCompanyPayrollSettings(company.id, {
    legalName: asString(formData.get("legalName")),
    businessNumber: asString(formData.get("businessNumber")),
    payrollProgramAccount: asString(formData.get("payrollProgramAccount")),
    remitterType,
    contactEmail: asString(formData.get("contactEmail")),
    preDueReminderDays: Number(asString(formData.get("preDueReminderDays")) || 7),
    postDueReminderFrequencyDays: Number(
      asString(formData.get("postDueReminderFrequencyDays")) || 7
    ),
  });

  await syncRemittancesForCompany(company.id);

  revalidatePath("/");
  revalidatePath("/cra");
  revalidatePath("/cra/settings");
}

export async function syncRemittancesAction() {
  const company = await requireCompanyAdminOrRedirect();
  await syncRemittancesForCompany(company.id);
  revalidatePath("/");
  revalidatePath("/cra");
}

export async function markRemittancePaidAction(formData: FormData) {
  const company = await requireCompanyAdminOrRedirect();

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
  const taxYear = Number(asString(formData.get("taxYear")) || new Date().getFullYear());
  await generateT4Package(company.id, taxYear);
  revalidatePath("/");
  revalidatePath("/cra");
  revalidatePath("/cra/t4");
}
