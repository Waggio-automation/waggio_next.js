import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createAdminSessionCookieValue,
  getSessionCookieName,
  getSessionCookieOptions,
  normalizeEmail,
  verifyPassword,
} from "@/lib/company-auth";

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function authServerError(error: unknown) {
  console.error("Login failed", error);
  return NextResponse.json(
    {
      error:
        process.env.NODE_ENV === "production"
          ? "Unable to sign in right now. Please try again later."
          : "Unable to sign in because the auth server could not reach its database or session config.",
    },
    { status: 500 }
  );
}

export async function POST(req: NextRequest) {
  let payload: { email?: string; password?: string };
  try {
    payload = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const email = normalizeEmail(asString(payload.email));
  const password = asString(payload.password);

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  try {
    const user = await prisma.companyUser.findUnique({
      where: { email },
      include: { company: true },
    });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const res = NextResponse.json({
      ok: true,
      redirectTo: "/?setup=login_success",
    });
    res.cookies.set(
      getSessionCookieName(),
      createAdminSessionCookieValue({
        companyId: user.companyId,
        userId: user.id,
      }),
      getSessionCookieOptions()
    );

    return res;
  } catch (error) {
    return authServerError(error);
  }
}
