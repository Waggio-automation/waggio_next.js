import { CompanyUserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAuthenticatedCompanyUser } from "@/lib/company-auth";

const PAYROLL_ROLES = new Set<CompanyUserRole>([
  CompanyUserRole.OWNER,
  CompanyUserRole.ADMIN,
]);

export function hasPayrollRole(role: CompanyUserRole) {
  return PAYROLL_ROLES.has(role);
}

export async function requirePayrollApiAuth() {
  const session = await getAuthenticatedCompanyUser();
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!hasPayrollRole(session.user.role)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, company: session.company, user: session.user };
}
