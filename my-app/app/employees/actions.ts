"use server";

import { prisma } from "@/lib/prisma";
import { getPrimaryCompany } from "@/lib/company";
import { employeeInputSchema } from "./validators";
import { revalidatePath } from "next/cache";

export type CreateEmployeeState = { errors: Record<string, string> } | { success: true } | null;

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
  const company = await getPrimaryCompany();
  const created = await prisma.employee.create({
    data: {
      companyId: company?.id ?? null,
      firstName: parsed.data.firstName,
      lastName : parsed.data.lastName,
      email    : parsed.data.email,
      sin      : parsed.data.sin,

      paymentMethod: parsed.data.paymentMethod,

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

  revalidatePath("/employees"); // 목록 즉시 갱신
  return { success: true };
}
