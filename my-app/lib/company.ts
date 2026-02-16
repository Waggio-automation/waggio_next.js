import { prisma } from "@/lib/prisma";

export async function getPrimaryCompany() {
  return prisma.company.findFirst({
    orderBy: { id: "asc" },
  });
}
