import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePayrollApiAuth } from "@/lib/payroll-api-auth";
import { generateAndStorePaystubPdf } from "@/lib/paystub-pdf";

export const runtime = "nodejs";

type PdfRequestBody = {
  payHistoryId?: unknown;
};

export async function POST(req: Request) {
  try {
    const auth = await requirePayrollApiAuth();
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as PdfRequestBody | null;
    const rawId = body?.payHistoryId;
    const payHistoryId =
      typeof rawId === "number" && Number.isFinite(rawId)
        ? BigInt(Math.trunc(rawId))
        : typeof rawId === "string" && /^\d+$/.test(rawId)
          ? BigInt(rawId)
          : null;

    if (payHistoryId == null) {
      return NextResponse.json({ error: "Missing or invalid payHistoryId" }, { status: 400 });
    }

    // Ownership: 404 if the paystub doesn't exist, 403 if it belongs to another company.
    const owner = await prisma.payHistory.findUnique({
      where: { id: payHistoryId },
      select: { employee: { select: { companyId: true } } },
    });
    if (!owner) {
      return NextResponse.json({ error: "Paystub not found" }, { status: 404 });
    }
    if (owner.employee.companyId !== auth.company.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await generateAndStorePaystubPdf({
      payHistoryId,
      companyId: auth.company.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      downloadUrl: `/api/payslip/${payHistoryId.toString()}/download`,
    });
  } catch (error: unknown) {
    console.error("Failed to generate paystub PDF", error);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
