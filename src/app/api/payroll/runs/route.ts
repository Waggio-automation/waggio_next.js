import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";

const VALID_PAYROLL_RUN_STATUSES = [
  "SCHEDULED",
  "PROCESSED",
  "FUNDING",
  "FUNDS_CONFIRMED",
  "PAYING",
  "PAID",
  "FAILED",
] as const;

function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, currentValue) =>
      typeof currentValue === "bigint" ? currentValue.toString() : currentValue
    )
  ) as T;
}

export async function GET(req: NextRequest) {
  const n8nSecret = process.env.N8N_SECRET;
  const providedSecret = req.headers.get("x-n8n-secret");
  const isN8nRequest = Boolean(n8nSecret) && providedSecret === n8nSecret;

  const companyId = isN8nRequest
    ? null
    : (await requireCompanyAdminOrRedirect()).id;

  const status = req.nextUrl.searchParams.get("status");

  if (status && !VALID_PAYROLL_RUN_STATUSES.includes(status as (typeof VALID_PAYROLL_RUN_STATUSES)[number])) {
    return NextResponse.json({ error: "Invalid payroll run status" }, { status: 400 });
  }

  const data = await prisma.payrollRun.findMany({
    where: {
      ...(companyId === null ? {} : { companyId }),
      ...(status ? { status: status as (typeof VALID_PAYROLL_RUN_STATUSES)[number] } : {}),
    },
    include: {
      company: {
        select: {
          adminEmail: true,
        },
      },
      payHistory: {
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(serializeBigInt(data));
}
