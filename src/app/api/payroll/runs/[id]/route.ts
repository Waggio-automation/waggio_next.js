import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";

function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, currentValue) =>
      typeof currentValue === "bigint" ? currentValue.toString() : currentValue
    )
  ) as T;
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const company = await requireCompanyAdminOrRedirect();
  const { id } = await params;

  let payrollRunId: bigint;
  try {
    payrollRunId = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid payroll run id" }, { status: 400 });
  }

  const payrollRun = await prisma.payrollRun.findUnique({
    where: { id: payrollRunId, companyId: company.id },
    include: {
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
  });

  if (!payrollRun) {
    return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
  }

  return NextResponse.json(serializeBigInt(payrollRun));
}
