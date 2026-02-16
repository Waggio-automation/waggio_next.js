import { NextRequest, NextResponse } from "next/server";
import {
  getCompanyByAdminToken,
  getTokenCookieName,
  getTokenTtlMs,
} from "@/lib/company-auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  const company = await getCompanyByAdminToken(token);
  if (!company) {
    return NextResponse.json({ error: "Invalid or expired token." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, companyId: company.id.toString() });
  res.cookies.set(getTokenCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(getTokenTtlMs() / 1000),
    path: "/",
  });

  return res;
}
