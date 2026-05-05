import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
  normalizeEmail,
} from "@/lib/company-auth";
import { isEmailConfigured, sendPasswordResetEmail } from "@/lib/email";

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getOrigin(req: NextRequest) {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  return (configured || req.nextUrl.origin).replace(/\/$/, "");
}

export async function POST(req: NextRequest) {
  let payload: { email?: string };
  try {
    payload = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const email = normalizeEmail(asString(payload.email));
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const user = await prisma.companyUser.findUnique({
    where: { email },
  });

  if (!user) {
    return NextResponse.json(
      { error: "No account was found for that email." },
      { status: 404 }
    );
  }

  const token = generatePasswordResetToken();
  await prisma.companyUser.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: hashPasswordResetToken(token),
      passwordResetRequestedAt: new Date(),
    },
  });

  const resetLink = `${getOrigin(req)}/company-settings/access/reset-password?userId=${encodeURIComponent(
    user.id.toString()
  )}&token=${encodeURIComponent(token)}`;

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "Email sending is not configured on the server yet." },
      { status: 503 }
    );
  }

  await sendPasswordResetEmail({
    to: user.email,
    resetLink,
  });

  return NextResponse.json({
    ok: true,
  });
}
