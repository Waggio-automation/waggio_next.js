import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateAdminToken, hashAdminToken } from "@/lib/company-auth";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  let payload: { email?: string };
  try {
    payload = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const rawEmail = typeof payload.email === "string" ? payload.email : "";
  const email = normalizeEmail(rawEmail);
  if (!email) {
    return NextResponse.json({ error: "Admin email is required." }, { status: 400 });
  }

  let company = await prisma.company.findFirst({ orderBy: { id: "asc" } });

  if (!company) {
    company = await prisma.company.create({
      data: {
        adminEmail: email,
      },
    });
  } else if (company.adminEmail.toLowerCase() !== email) {
    return NextResponse.json(
      { error: "Email does not match the configured admin email." },
      { status: 403 }
    );
  }

  const token = generateAdminToken();
  const tokenHash = hashAdminToken(token);

  await prisma.company.update({
    where: { id: company.id },
    data: {
      adminTokenHash: tokenHash,
      adminTokenCreatedAt: new Date(),
    },
  });

  const origin = req.nextUrl.origin;
  const magicLink = `${origin}/api/company/verify?token=${encodeURIComponent(token)}&companyId=${company.id.toString()}`;

  return NextResponse.json({ ok: true, magicLink });
}
