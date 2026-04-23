import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isEmailConfigured, sendLoginEmailReminder } from "@/lib/email";

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visibleLocal = local.length <= 2 ? local[0] ?? "*" : `${local[0]}${"*".repeat(Math.max(local.length - 2, 1))}${local[local.length - 1]}`;
  return `${visibleLocal}@${domain}`;
}

export async function POST(req: NextRequest) {
  let payload: { companyName?: string };
  try {
    payload = (await req.json()) as { companyName?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const companyName = asString(payload.companyName);
  if (!companyName) {
    return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  }

  const company = await prisma.company.findFirst({
    where: {
      name: {
        equals: companyName,
        mode: "insensitive",
      },
    },
    include: {
      users: {
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  if (!company || company.users.length === 0) {
    return NextResponse.json(
      { error: "No account was found for that company name." },
      { status: 404 }
    );
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "Email sending is not configured on the server yet." },
      { status: 503 }
    );
  }

  await sendLoginEmailReminder({
    to: company.users[0].email,
    companyName: company.name ?? companyName,
  });

  return NextResponse.json({
    ok: true,
    maskedEmail: maskEmail(company.users[0].email),
  });
}
