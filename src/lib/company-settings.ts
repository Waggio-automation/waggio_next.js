import { prisma } from "@/lib/prisma";
import {
  deriveCompanyStatusFromConfiguration,
  toPrismaEmployeePayoutStatus,
} from "@/lib/payments/status-mapping";
import { type CompanyPlanCode } from "@/lib/company-plans";

export type CompanyPayoutConfigurationInput = {
  defaultPayoutCurrency?: string;
  defaultPayoutCountry?: string;
  trolleyBatchPrefix?: string | null;
};

export const INTERNAL_PAYOUT_CURRENCY = "CAD";
export const INTERNAL_PAYOUT_COUNTRY = "CA";
export const INTERNAL_BATCH_PREFIX = "payroll";

function normalizeCurrency(value?: string | null) {
  return value?.trim().toUpperCase() || "CAD";
}

function normalizeCountry(value?: string | null) {
  return value?.trim().toUpperCase() || "CA";
}

function normalizeBatchPrefix(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 64) : null;
}

export function isTrolleyEnvironmentConfigured() {
  return Boolean(process.env.TROLLEY_ACCESS_KEY && process.env.TROLLEY_SECRET_KEY);
}

export async function getOrCreateCompanySettings(companyId: bigint) {
  const existing = await prisma.companySettings.findFirst({
    where: { companyId },
  });

  if (existing) return existing;

  const orphan = await prisma.companySettings.findFirst({
    where: { companyId: null },
    orderBy: { id: "asc" },
  });

  if (orphan) {
    return prisma.companySettings.update({
      where: { id: orphan.id },
      data: { companyId },
    });
  }

  return prisma.companySettings.create({
    data: {
      companyId,
    },
  });
}

export async function syncCompanySettingsFromConfiguration(companyId: bigint) {
  const settings = await getOrCreateCompanySettings(companyId);
  const derived = deriveCompanyStatusFromConfiguration({
    environmentConfigured: isTrolleyEnvironmentConfigured(),
    defaultPayoutCurrency: INTERNAL_PAYOUT_CURRENCY,
    defaultPayoutCountry: INTERNAL_PAYOUT_COUNTRY,
  });

  return prisma.companySettings.update({
    where: { id: settings.id },
    data: {
      defaultPayoutCurrency: INTERNAL_PAYOUT_CURRENCY,
      defaultPayoutCountry: INTERNAL_PAYOUT_COUNTRY,
      trolleyBatchPrefix: INTERNAL_BATCH_PREFIX,
      payoutEnabled: derived.payoutEnabled,
      payoutSetupStatus: toPrismaEmployeePayoutStatus(derived.payoutSetupStatus),
    },
  });
}

export async function updateCompanyPayoutConfiguration(
  companyId: bigint,
  input: CompanyPayoutConfigurationInput
) {
  const settings = await getOrCreateCompanySettings(companyId);
  const defaultPayoutCurrency = normalizeCurrency(
    input.defaultPayoutCurrency ?? INTERNAL_PAYOUT_CURRENCY
  );
  const defaultPayoutCountry = normalizeCountry(
    input.defaultPayoutCountry ?? INTERNAL_PAYOUT_COUNTRY
  );
  const trolleyBatchPrefix = normalizeBatchPrefix(
    input.trolleyBatchPrefix ?? INTERNAL_BATCH_PREFIX
  );

  const derived = deriveCompanyStatusFromConfiguration({
    environmentConfigured: isTrolleyEnvironmentConfigured(),
    defaultPayoutCurrency,
    defaultPayoutCountry,
  });

  return prisma.companySettings.update({
    where: { id: settings.id },
    data: {
      companyId,
      defaultPayoutCurrency,
      defaultPayoutCountry,
      trolleyBatchPrefix,
      payoutEnabled: derived.payoutEnabled,
      payoutSetupStatus: toPrismaEmployeePayoutStatus(derived.payoutSetupStatus),
    },
  });
}

export async function updateCompanyPlan(companyId: bigint, planCode: CompanyPlanCode) {
  return prisma.company.update({
    where: { id: companyId },
    data: {
      currentPlan: planCode,
      planSelectedAt: new Date(),
    },
  });
}
