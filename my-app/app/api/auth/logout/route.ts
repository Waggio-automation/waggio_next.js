import { NextRequest, NextResponse } from "next/server";
import { getSessionCookieName } from "@/lib/company-auth";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/company-settings/access", req.nextUrl.origin));
  res.cookies.set(getSessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  return res;
}
