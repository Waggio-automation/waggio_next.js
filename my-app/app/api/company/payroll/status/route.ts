import { NextResponse } from "next/server";
import { getCompanyFromCookie } from "@/lib/company-auth";
import { getOrCreateCompanySettings } from "@/lib/company-settings";

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

export async function GET() {
  const company = await getCompanyFromCookie();
  if (!company) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getOrCreateCompanySettings(company.id);

  return NextResponse.json({
    payoutSetupStatus: toUiStatus(settings.payoutSetupStatus),
    payoutEnabled: settings.payoutEnabled,
  });
}
