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
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const n8nSecret = process.env.N8N_SECRET;
  const providedSecret = req.headers.get("x-n8n-secret");
  const isN8nRequest = Boolean(n8nSecret) && providedSecret === n8nSecret;

  const companyId = isN8nRequest
    ? null
    : (await requireCompanyAdminOrRedirect()).id;

  const { id } = await params;

  let payrollRunId: bigint;
  try {
    payrollRunId = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid payroll run id" }, { status: 400 });
  }

  const payrollRun = await prisma.payrollRun.findUnique({
    where: {
      id: payrollRunId,
      ...(companyId === null ? {} : { companyId }),
    },
    include: {
      payHistory: {
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              employeeNumber: true,
              department: true,
              jobTitle: true,
              bankTransit: true,
              bankAccount: true,
              hourlyRate: true,
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
