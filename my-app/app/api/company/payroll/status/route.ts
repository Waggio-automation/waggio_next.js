import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function toUiStatus(status: string | null | undefined) {
  switch (status) {
    case "REQUIRED":
      return "required" as const;
    case "PENDING":
      return "pending" as const;
    case "READY":
      return "ready" as const;
    case "ISSUE":
      return "issue" as const;
    default:
      return "required" as const;
  }
}

async function getOrCreateCompanySettings() {
  const existing = await prisma.companySettings.findFirst({
    orderBy: { id: "asc" },
  });

  if (existing) return existing;

  return prisma.companySettings.create({ data: {} });
}

export async function GET() {
  const settings = await getOrCreateCompanySettings();

  return NextResponse.json({
    payoutSetupStatus: toUiStatus(settings.payoutSetupStatus),
    payoutEnabled: settings.payoutEnabled,
  });
}
