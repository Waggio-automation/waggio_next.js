import { prisma } from "@/lib/prisma";

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
