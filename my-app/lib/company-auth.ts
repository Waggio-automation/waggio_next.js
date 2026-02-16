import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = "company_admin_session";
const ADMIN_ROLE = "company_admin";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isExpired(createdAt: Date | null) {
  if (!createdAt) return true;
  return Date.now() - createdAt.getTime() > TOKEN_TTL_MS;
}

export function generateAdminToken() {
  return crypto.randomBytes(32).toString("hex");
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

type AdminSessionPayload = {
  companyId: string;
  role: typeof ADMIN_ROLE;
  exp: number;
};

export function createAdminSessionCookieValue(companyId: bigint) {
  const payload: AdminSessionPayload = {
    companyId: companyId.toString(),
    role: ADMIN_ROLE,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
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
    if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
    return payload as AdminSessionPayload;
  } catch {
    return null;
  }
}

export async function getCompanyByAdminToken(params: { token: string; companyId: bigint }) {
  const tokenHash = hashToken(params.token);
  const company = await prisma.company.findUnique({
    where: { id: params.companyId },
  });

  if (
    !company ||
    company.adminTokenHash !== tokenHash ||
    isExpired(company.adminTokenCreatedAt)
  ) {
    return null;
  }

  return company;
}

export async function consumeAdminToken(params: { token: string; companyId: bigint }) {
  const tokenHash = hashToken(params.token);
  const minCreatedAt = new Date(Date.now() - TOKEN_TTL_MS);
  // Atomic consume for one-time magic links: only the first matching request succeeds.
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

export async function getCompanyFromCookie() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SESSION_COOKIE)?.value;
  if (!cookieValue) return null;

  const session = parseAdminSessionCookie(cookieValue);
  if (!session) return null;

  let companyId: bigint;
  try {
    companyId = BigInt(session.companyId);
  } catch {
    return null;
  }

  return prisma.company.findUnique({
    where: { id: companyId },
  });
}

export async function requireCompanyAdminOrRedirect() {
  const company = await getCompanyFromCookie();
  if (!company) {
    redirect("/company-settings/access");
  }
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
