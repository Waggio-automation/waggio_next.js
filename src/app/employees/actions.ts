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
const employmentTypeValues = new Set(["FULL_TIME", "PART_TIME", "CONTRACTOR"]);
const payGroupValues = new Set(["BI_WEEKLY", "MONTHLY"]);
const payTypeValues = new Set(["HOURLY", "SALARY"]);
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

function parseOptionalNumber(value: FormDataEntryValue | null) {
  const text = asString(value).trim();
  return text ? Number(text) : null;
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
      employeeNumber: parsed.data.employeeNumber?.trim() || null,
      department: parsed.data.department?.trim() || null,
      jobTitle: parsed.data.jobTitle?.trim() || null,
      bankTransit: parsed.data.bankTransit?.trim() || null,
      bankAccount: parsed.data.bankAccount?.trim() || null,
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

export async function updateEmployeeProfileAction(formData: FormData) {
  const company = await requireCompanyAdminOrRedirect();
  if (!company.currentPlan) {
    redirect("/company-settings?setup=plan_required");
  }

  const employeeId = BigInt(asString(formData.get("employeeId")));
  const firstName = asString(formData.get("firstName")).trim();
  const lastName = asString(formData.get("lastName")).trim();
  const email = asString(formData.get("email")).trim();
  const employmentType = asString(formData.get("employmentType"));
  const payGroup = asString(formData.get("payGroup"));
  const payType = asString(formData.get("payType"));
  const hireDate = asString(formData.get("hireDate"));
  const birthDate = asString(formData.get("birthDate"));
  const hourlyRate = parseOptionalNumber(formData.get("hourlyRate"));
  const salary = parseOptionalNumber(formData.get("salary"));

  if (!firstName || !lastName || !email || !hireDate || !birthDate) {
    throw new Error("Missing required employee fields.");
  }
  if (!employmentTypeValues.has(employmentType)) {
    throw new Error("Invalid employment type.");
  }
  if (!payGroupValues.has(payGroup)) {
    throw new Error("Invalid pay group.");
  }
  if (!payTypeValues.has(payType)) {
    throw new Error("Invalid pay type.");
  }
  if (payType === "HOURLY" && hourlyRate == null) {
    throw new Error("Hourly rate is required for hourly employees.");
  }
  if (payType === "SALARY" && salary == null) {
    throw new Error("Annual salary is required for salaried employees.");
  }

  await prisma.employee.update({
    where: { id: employeeId, companyId: company.id },
    data: {
      firstName,
      lastName,
      email,
      employeeNumber: asString(formData.get("employeeNumber")).trim() || null,
      department: asString(formData.get("department")).trim() || null,
      jobTitle: asString(formData.get("jobTitle")).trim() || null,
      addrLine1: asString(formData.get("addrLine1")).trim(),
      addrLine2: asString(formData.get("addrLine2")).trim() || null,
      addrCity: asString(formData.get("addrCity")).trim(),
      addrProvince: asString(formData.get("addrProvince")).trim() || "ON",
      addrPostal: asString(formData.get("addrPostal")).trim(),
      addrCountry: asString(formData.get("addrCountry")).trim() || "CA",
      birthDate: new Date(birthDate),
      employmentType: employmentType as "FULL_TIME" | "PART_TIME" | "CONTRACTOR",
      hireDate: new Date(hireDate),
      payGroup: payGroup as "BI_WEEKLY" | "MONTHLY",
      payType: payType as "HOURLY" | "SALARY",
      hourlyRate: payType === "HOURLY" ? hourlyRate : null,
      salary: payType === "SALARY" ? salary : null,
      vacationPay: parseOptionalNumber(formData.get("vacationPay")) ?? 4,
      bonus: parseOptionalNumber(formData.get("bonus")) ?? 0,
      federalTD1: parseOptionalNumber(formData.get("federalTD1")) ?? 16452,
      provincialTD1: parseOptionalNumber(formData.get("provincialTD1")) ?? 12989,
    },
  });

  revalidatePath("/");
  revalidatePath("/employees");
  revalidatePath(`/employees/${employeeId.toString()}`);
  redirect(`/employees/${employeeId.toString()}?updated=profile`);
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
  redirect(`/employees/${employeeId.toString()}?updated=cra`);
}
