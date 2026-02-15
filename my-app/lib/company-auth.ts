import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const TOKEN_COOKIE = "company_admin_token";
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

export async function getCompanyByAdminToken(token: string) {
  const tokenHash = hashToken(token);
  const company = await prisma.company.findFirst({
    where: { adminTokenHash: tokenHash },
  });

  if (!company || isExpired(company.adminTokenCreatedAt)) {
    return null;
  }

  return company;
}

export async function getCompanyFromCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE)?.value;
  if (!token) return null;
  return getCompanyByAdminToken(token);
}

export async function requireCompanyAdminOrRedirect() {
  const company = await getCompanyFromCookie();
  if (!company) {
    redirect("/company-settings/access");
  }
  return company;
}

export function getTokenCookieName() {
  return TOKEN_COOKIE;
}

export function getTokenTtlMs() {
  return TOKEN_TTL_MS;
}

export function hashAdminToken(token: string) {
  return hashToken(token);
}
