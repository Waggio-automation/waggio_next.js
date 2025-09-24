"use server";

import { prisma } from "@/lib/prisma";
import { employeeInputSchema } from "./validators";
import { revalidatePath } from "next/cache";

export async function createEmployee(formData: FormData) {
  // 1) 폼 → 객체
  const obj = Object.fromEntries(formData.entries());

  // 2) 검증/정규화
  const parsed = employeeInputSchema.parse(obj);

  // 3) 저장
  const created = await prisma.employee.create({
    data: {
      firstName: parsed.firstName,
      lastName : parsed.lastName,
      email    : parsed.email,
      sin      : parsed.sin,

      paymentMethod: parsed.paymentMethod,

      addrLine1: parsed.addrLine1,
      addrLine2: parsed.addrLine2 || null,
      addrCity : parsed.addrCity,
      addrProvince: parsed.addrProvince,
      addrPostal  : parsed.addrPostal,
      addrCountry : parsed.addrCountry,

      birthDate: parsed.birthDate,
      employmentType: parsed.employmentType,
      hireDate: parsed.hireDate,
      payGroup: parsed.payGroup,
      payType : parsed.payType,
      hourlyRate: parsed.hourlyRate ?? null,
      salary    : parsed.salary ?? null,
      vacationPay: parsed.vacationPay,
      bonus      : parsed.bonus,
      federalTD1 : parsed.federalTD1,
      provincialTD1: parsed.provincialTD1,

      bankName: parsed.bankName || null,
      bankAccount: parsed.bankAccount || null,
      transitNumber: parsed.transitNumber || null,
      institutionNumber: parsed.institutionNumber || null,
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
  return { ok: true };
}
