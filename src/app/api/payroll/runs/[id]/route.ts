import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePayrollApiAuth } from "@/lib/payroll-api-auth";

function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, currentValue) =>
      typeof currentValue === "bigint" ? currentValue.toString() : currentValue
    )
  ) as T;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePayrollApiAuth();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let payrollRunId: bigint;
  try {
    payrollRunId = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid payroll run id" }, { status: 400 });
  }

  const payrollRun = await prisma.payrollRun.findFirst({
    where: { id: payrollRunId, companyId: auth.company.id },
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
          periodStart: true,
          periodEnd: true,
          hoursWorked: true,
          grossPay: true,
          ded_cpp: true,
          ded_ei: true,
          ded_income_tax: true,
          ded_eht: true,
          ded_wsib: true,
          netPay: true,
          status: true,
          paidAt: true,
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
  });

  if (!payrollRun) {
    return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
  }

  return NextResponse.json(serializeBigInt(payrollRun));
}
