import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createAdminSessionCookieValue,
  getSessionCookieName,
  getSessionCookieOptions,
  hashPassword,
  normalizeEmail,
  validatePassword,
} from "@/lib/company-auth";

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: NextRequest) {
  let payload: {
    companyName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    password?: string;
  };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const companyName = asString(payload.companyName);
  const firstName = asString(payload.firstName);
  const lastName = asString(payload.lastName);
  const email = normalizeEmail(asString(payload.email));
  const password = asString(payload.password);

  if (!companyName) {
    return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }
  if (!validatePassword(password)) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters long." },
      { status: 400 }
    );
  }

  const existingUser = await prisma.companyUser.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    return NextResponse.json(
      { error: "An account already exists for this email. Please log in instead." },
      { status: 409 }
    );
  }

  const passwordHash = hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: companyName,
        adminEmail: email,
      },
    });

    const user = await tx.companyUser.create({
      data: {
        companyId: company.id,
        email,
        passwordHash,
        firstName: firstName || null,
        lastName: lastName || null,
        role: "OWNER",
      },
    });

    return { company, user };
  });

  const res = NextResponse.json({
    ok: true,
    redirectTo: "/?setup=account_created",
  });
  res.cookies.set(
    getSessionCookieName(),
    createAdminSessionCookieValue({
      companyId: result.company.id,
      userId: result.user.id,
    }),
    getSessionCookieOptions()
  );

  return res;
}
