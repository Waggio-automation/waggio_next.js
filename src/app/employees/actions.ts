"use server";

import { DentalBenefitsCoverage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { employeeInputSchema } from "./validators";
import { encryptSin } from "@/lib/crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { syncCompanyEmployeeSeatQuantity } from "@/lib/stripe";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";

export type CreateEmployeeState = { errors: Record<string, string> } | { success: true } | null;
const dentalCoverageValues = new Set<DentalBenefitsCoverage>([
  "NONE",
  "EMPLOYEE_ONLY",
  "EMPLOYEE_AND_SPOUSE",
  "EMPLOYEE_AND_CHILDREN",
  "EMPLOYEE_AND_FAMILY",
]);

function asString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

export async function createEmployee(prevState: CreateEmployeeState, formData: FormData): Promise<CreateEmployeeState> {
  // 1) 폼 → 객체
  const obj = Object.fromEntries(formData.entries());

  // 2) 검증/정규화
  const parsed = employeeInputSchema.safeParse(obj);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      if (!errors[field]) errors[field] = issue.message;
    }
    return { errors };
  }

  // 3) 저장
  const company = await requireCompanyAdminOrRedirect();
  if (!company.currentPlan) {
    redirect("/company-settings?setup=plan_required");
  }
  const created = await prisma.employee.create({
    data: {
      companyId: company.id,
      firstName: parsed.data.firstName,
      lastName : parsed.data.lastName,
      email    : parsed.data.email,
      sin      : encryptSin(parsed.data.sin),
      dentalBenefitsCoverage: parsed.data.dentalBenefitsCoverage,

      paymentMethod: "DIRECT_DEPOSIT",

      addrLine1: parsed.data.addrLine1,
      addrLine2: parsed.data.addrLine2 || null,
      addrCity : parsed.data.addrCity,
      addrProvince: parsed.data.addrProvince,
      addrPostal  : parsed.data.addrPostal,
      addrCountry : parsed.data.addrCountry,

      birthDate: parsed.data.birthDate,
      employmentType: parsed.data.employmentType,
      hireDate: parsed.data.hireDate,
      payGroup: parsed.data.payGroup,
      payType : parsed.data.payType,
      hourlyRate: parsed.data.hourlyRate ?? null,
      salary    : parsed.data.salary ?? null,
      rppDpspRegistrationNumber: parsed.data.rppDpspRegistrationNumber?.trim() || null,
      pensionAdjustmentOverride: parsed.data.pensionAdjustmentOverride ?? null,
      vacationPay: parsed.data.vacationPay,
      bonus      : parsed.data.bonus,
      federalTD1 : parsed.data.federalTD1,
      provincialTD1: parsed.data.provincialTD1,
      payoutSetupStatus: "REQUIRED",
      payoutEnabled: false,
    },
  });

  // 4) (선택) n8n Webhook 트리거 – 서버에서만 호출 (민감정보는 보내지 않기!)
  if (process.env.N8N_WEBHOOK_URL) {
    await fetch(process.env.N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-n8n-secret": process.env.N8N_WEBHOOK_SECRET ?? "",
      },
      body: JSON.stringify({
        event: "employee.created",
        employeeId: created.id.toString(), // BigInt → string
        email: created.email,
        payType: created.payType,
        payGroup: created.payGroup,
      }),
    }).catch(() => {});
  }

  await syncCompanyEmployeeSeatQuantity(company.id).catch(() => null);

  revalidatePath("/employees"); // 목록 즉시 갱신
  return { success: true };
}

export async function updateEmployeeCraProfileAction(formData: FormData) {
  const company = await requireCompanyAdminOrRedirect();
  if (!company.currentPlan) {
    redirect("/company-settings?setup=plan_required");
  }
  if (company.currentPlan !== "PRO") {
    redirect("/company-settings?setup=upgrade_required");
  }
  const employeeId = BigInt(asString(formData.get("employeeId")));
  const dentalBenefitsCoverage = asString(formData.get("dentalBenefitsCoverage"));
  const rppDpspRegistrationNumber = asString(formData.get("rppDpspRegistrationNumber"));
  const pensionAdjustmentValue = asString(formData.get("pensionAdjustmentOverride"));
  const normalizedDentalCoverage = dentalCoverageValues.has(
    dentalBenefitsCoverage as DentalBenefitsCoverage
  )
    ? (dentalBenefitsCoverage as DentalBenefitsCoverage)
    : "NONE";

  await prisma.employee.update({
    where: { id: employeeId, companyId: company.id },
    data: {
      dentalBenefitsCoverage: normalizedDentalCoverage,
      rppDpspRegistrationNumber: rppDpspRegistrationNumber.trim() || null,
      pensionAdjustmentOverride: pensionAdjustmentValue.trim()
        ? Number(pensionAdjustmentValue)
        : null,
    },
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${employeeId.toString()}`);
  revalidatePath("/cra");
  revalidatePath("/cra/t4");
}
