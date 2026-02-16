import { prisma } from "@/lib/prisma";
import { deriveCompanyStatusFromAccount, toPrismaEmployeePayoutStatus } from "@/lib/payments/status-mapping";

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

export async function syncCompanySettingsFromAccount(params: {
  companyId: bigint;
  stripeAccountId: string;
  account: Record<string, unknown>;
}) {
  const settings = await getOrCreateCompanySettings(params.companyId);
  const derived = deriveCompanyStatusFromAccount(params.account);

  return prisma.companySettings.update({
    where: { id: settings.id },
    data: {
      companyId: params.companyId,
      stripeAccountId: params.stripeAccountId,
      payoutEnabled: derived.payoutEnabled,
      payoutSetupStatus: toPrismaEmployeePayoutStatus(derived.payoutSetupStatus),
    },
  });
}
