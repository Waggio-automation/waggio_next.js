import { NextRequest, NextResponse } from "next/server";
import {
  consumeAdminToken,
  createAdminSessionCookieValue,
  getTokenCookieName,
  getTokenTtlMs,
} from "@/lib/company-auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const companyIdRaw = req.nextUrl.searchParams.get("companyId");
  if (!token || !companyIdRaw) {
    return NextResponse.json({ error: "Missing token or companyId." }, { status: 400 });
  }

  let companyId: bigint;
  try {
    companyId = BigInt(companyIdRaw);
  } catch {
    return NextResponse.json({ error: "Invalid companyId." }, { status: 400 });
  }

  const company = await consumeAdminToken({ token, companyId });
  if (!company) {
    return NextResponse.json({ error: "Invalid, used, or expired token." }, { status: 401 });
  }

  // Verification is completed server-side before redirecting into Stripe onboarding.
  const redirectUrl = new URL("/api/company/payroll/setup", req.nextUrl.origin);
  const res = NextResponse.redirect(redirectUrl);
  res.cookies.set(getTokenCookieName(), createAdminSessionCookieValue(company.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(getTokenTtlMs() / 1000),
    path: "/",
  });

  return res;
}
