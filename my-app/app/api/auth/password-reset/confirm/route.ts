import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  hashPasswordResetToken,
  isPasswordResetExpired,
  validatePassword,
} from "@/lib/company-auth";

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: NextRequest) {
  let payload: { userId?: string; token?: string; password?: string };
  try {
    payload = (await req.json()) as { userId?: string; token?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const userIdRaw = asString(payload.userId);
  const token = asString(payload.token);
  const password = asString(payload.password);

  if (!userIdRaw || !token || !password) {
    return NextResponse.json(
      { error: "User, token, and new password are required." },
      { status: 400 }
    );
  }
  if (!validatePassword(password)) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters long." },
      { status: 400 }
    );
  }

  let userId: bigint;
  try {
    userId = BigInt(userIdRaw);
  } catch {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  const user = await prisma.companyUser.findUnique({
    where: { id: userId },
  });

  if (
    !user ||
    !user.passwordResetTokenHash ||
    user.passwordResetTokenHash !== hashPasswordResetToken(token) ||
    isPasswordResetExpired(user.passwordResetRequestedAt)
  ) {
    return NextResponse.json(
      { error: "The password reset link is invalid or has expired." },
      { status: 401 }
    );
  }

  await prisma.companyUser.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(password),
      passwordResetTokenHash: null,
      passwordResetRequestedAt: null,
    },
  });

  return NextResponse.json({
    ok: true,
    redirectTo: "/company-settings/access",
  });
}
