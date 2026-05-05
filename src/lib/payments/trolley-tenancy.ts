import { prisma } from "@/lib/prisma";

type TrolleyTenantContext = {
  companyId: bigint;
  tenantKey: string;
};

function cleanSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function defaultTrolleyTenantKey(companyId: bigint) {
  return `company-${companyId.toString()}`;
}

export function normalizeTrolleyTenantKey(value: string | null | undefined, companyId: bigint) {
  return cleanSegment(value ?? "") || defaultTrolleyTenantKey(companyId);
}

export async function getOrCreateTrolleyTenantContext(companyId: bigint): Promise<TrolleyTenantContext> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      trolleyTenantKey: true,
    },
  });

  if (!company) {
    throw new Error(`Company ${companyId.toString()} was not found.`);
  }

  const tenantKey = normalizeTrolleyTenantKey(company.trolleyTenantKey, company.id);

  if (company.trolleyTenantKey !== tenantKey) {
    await prisma.company.update({
      where: { id: company.id },
      data: { trolleyTenantKey: tenantKey },
    });
  }

  return {
    companyId: company.id,
    tenantKey,
  };
}

export function buildTrolleyCompanyTag(context: TrolleyTenantContext) {
  return `tenant:${context.tenantKey}`;
}

export function buildTrolleyCompanyIdTag(companyId: bigint) {
  return `company:${companyId.toString()}`;
}

export function buildTrolleyTags(
  context: TrolleyTenantContext,
  scope: "recipient" | "recipient-account" | "batch" | "payment" | "payroll",
  extra: string[] = []
) {
  return Array.from(
    new Set([
      buildTrolleyCompanyTag(context),
      buildTrolleyCompanyIdTag(context.companyId),
      scope,
      ...extra.map((tag) => cleanSegment(tag)).filter(Boolean),
    ])
  );
}

export function buildTrolleyRecipientReferenceId(params: {
  companyId: bigint;
  employeeId: bigint;
}) {
  return `company:${params.companyId.toString()}:employee:${params.employeeId.toString()}`;
}

export function buildTrolleyPayrollRunExternalId(params: {
  companyId: bigint;
  payrollRunId: bigint;
}) {
  return `company:${params.companyId.toString()}:payroll-run:${params.payrollRunId.toString()}`;
}

export function buildTrolleyPayHistoryExternalId(params: {
  companyId: bigint;
  payHistoryId: bigint;
}) {
  return `company:${params.companyId.toString()}:pay-history:${params.payHistoryId.toString()}`;
}
