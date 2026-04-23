import { NextRequest, NextResponse } from "next/server";
import {
  consumeAdminToken,
  createAdminSessionCookieValue,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/company-auth";
import { prisma } from "@/lib/prisma";

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

  const user = await prisma.companyUser.findFirst({
    where: { companyId: company.id },
    orderBy: { createdAt: "asc" },
  });
  if (!user) {
    return NextResponse.json(
      { error: "No company user is linked to this workspace. Sign up first." },
      { status: 409 }
    );
  }

  const redirectUrl = new URL("/company-settings?setup=verified", req.nextUrl.origin);
  const res = NextResponse.redirect(redirectUrl);
  res.cookies.set(
    getSessionCookieName(),
    createAdminSessionCookieValue({ companyId: company.id, userId: user.id }),
    getSessionCookieOptions()
  );

  return res;
}
