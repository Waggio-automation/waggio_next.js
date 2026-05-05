import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type Company, type CompanyUser } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = "company_admin_session";
const ADMIN_ROLE = "company_admin";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60; // 1 hour
const PASSWORD_KEY_LENGTH = 64;

type AuthenticatedCompanyUser = {
  company: Company;
  user: CompanyUser;
};

type AdminSessionPayload = {
  companyId: string;
  userId: string;
  role: typeof ADMIN_ROLE;
  exp: number;
};

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isExpired(createdAt: Date | null) {
  if (!createdAt) return true;
  return Date.now() - createdAt.getTime() > TOKEN_TTL_MS;
}

function getSessionSecret() {
  const secret = process.env.COMPANY_ADMIN_SESSION_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("COMPANY_ADMIN_SESSION_SECRET (or NEXTAUTH_SECRET) is not configured");
  }
  return secret;
}

function toBase64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string) {
  return crypto.createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseAdminSessionCookie(cookieValue: string): AdminSessionPayload | null {
  const [encodedPayload, signature] = cookieValue.split(".");
  if (!encodedPayload || !signature) return null;

  let expectedSignature: string;
  try {
    expectedSignature = sign(encodedPayload);
  } catch {
    return null;
  }
  if (!safeEqual(expectedSignature, signature)) return null;

  try {
    const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const payload = JSON.parse(decoded) as Partial<AdminSessionPayload>;
    if (payload.role !== ADMIN_ROLE) return null;
    if (typeof payload.companyId !== "string" || !payload.companyId) return null;
    if (typeof payload.userId !== "string" || !payload.userId) return null;
    if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
    return payload as AdminSessionPayload;
  } catch {
    return null;
  }
}

function getPasswordSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function derivePasswordHash(password: string, salt: string) {
  return crypto.scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString("hex");
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function generateAdminToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function generatePasswordResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashPassword(password: string) {
  const salt = getPasswordSalt();
  const derived = derivePasswordHash(password, salt);
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, passwordHash: string) {
  const [salt, storedHash] = passwordHash.split(":");
  if (!salt || !storedHash) return false;

  const candidate = derivePasswordHash(password, salt);
  return safeEqual(candidate, storedHash);
}

export function validatePassword(password: string) {
  return password.trim().length >= 8;
}

export function createAdminSessionCookieValue(params: { companyId: bigint; userId: bigint }) {
  const payload: AdminSessionPayload = {
    companyId: params.companyId.toString(),
    userId: params.userId.toString(),
    role: ADMIN_ROLE,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(TOKEN_TTL_MS / 1000),
    path: "/",
  };
}

export async function getAuthenticatedCompanyUser(): Promise<AuthenticatedCompanyUser | null> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SESSION_COOKIE)?.value;
  if (!cookieValue) return null;

  const session = parseAdminSessionCookie(cookieValue);
  if (!session) return null;

  let companyId: bigint;
  let userId: bigint;
  try {
    companyId = BigInt(session.companyId);
    userId = BigInt(session.userId);
  } catch {
    return null;
  }

  const user = await prisma.companyUser.findUnique({
    where: { id: userId },
    include: { company: true },
  });
  if (!user) return null;
  if (user.companyId !== companyId) return null;

  const { company, ...rest } = user;
  return {
    company,
    user: rest as CompanyUser,
  };
}

export async function getCompanyFromCookie() {
  const session = await getAuthenticatedCompanyUser();
  return session?.company ?? null;
}

export async function requireCompanyAdminOrRedirect() {
  const session = await getAuthenticatedCompanyUser();
  if (!session) {
    redirect("/company-settings/access");
  }
  return session.company;
}

export async function requireAuthenticatedCompanyUserOrRedirect() {
  const session = await getAuthenticatedCompanyUser();
  if (!session) {
    redirect("/company-settings/access");
  }
  return session;
}

export async function getCompanyByAdminToken(params: { token: string; companyId: bigint }) {
  const tokenHash = hashToken(params.token);
  const company = await prisma.company.findUnique({
    where: { id: params.companyId },
  });

  if (!company || company.adminTokenHash !== tokenHash || isExpired(company.adminTokenCreatedAt)) {
    return null;
  }

  return company;
}

export async function consumeAdminToken(params: { token: string; companyId: bigint }) {
  const tokenHash = hashToken(params.token);
  const minCreatedAt = new Date(Date.now() - TOKEN_TTL_MS);
  const updated = await prisma.company.updateMany({
    where: {
      id: params.companyId,
      adminTokenHash: tokenHash,
      adminTokenCreatedAt: {
        gte: minCreatedAt,
      },
    },
    data: {
      adminTokenHash: null,
      adminTokenCreatedAt: null,
    },
  });
  if (updated.count !== 1) {
    return null;
  }

  const company = await prisma.company.findUnique({
    where: { id: params.companyId },
  });
  if (!company) return null;
  return company;
}

export function getTokenCookieName() {
  return SESSION_COOKIE;
}

export function getTokenTtlMs() {
  return TOKEN_TTL_MS;
}

export function hashAdminToken(token: string) {
  return hashToken(token);
}

export function hashPasswordResetToken(token: string) {
  return hashToken(token);
}

export function getPasswordResetTtlMs() {
  return PASSWORD_RESET_TTL_MS;
}

export function isPasswordResetExpired(requestedAt: Date | null) {
  if (!requestedAt) return true;
  return Date.now() - requestedAt.getTime() > PASSWORD_RESET_TTL_MS;
}
