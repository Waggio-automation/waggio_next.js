import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePayrollApiAuth } from "@/lib/payroll-api-auth";

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
  const auth = await requirePayrollApiAuth();
  if (!auth.ok) return auth.response;

  const status = req.nextUrl.searchParams.get("status");

  if (status && !VALID_PAYROLL_RUN_STATUSES.includes(status as (typeof VALID_PAYROLL_RUN_STATUSES)[number])) {
    return NextResponse.json({ error: "Invalid payroll run status" }, { status: 400 });
  }

  const data = await prisma.payrollRun.findMany({
    where: {
      companyId: auth.company.id,
      ...(status ? { status: status as (typeof VALID_PAYROLL_RUN_STATUSES)[number] } : {}),
    },
    select: {
      id: true,
      payDate: true,
      sendAt: true,
      status: true,
      failureType: true,
      createdAt: true,
      updatedAt: true,
      payHistory: {
        select: {
          id: true,
          employeeId: true,
          payDate: true,
          grossPay: true,
          netPay: true,
          status: true,
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeNumber: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(serializeBigInt(data));
}
