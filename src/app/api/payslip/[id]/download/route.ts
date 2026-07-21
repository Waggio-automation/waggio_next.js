import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { requirePayrollApiAuth } from "@/lib/payroll-api-auth";

export const runtime = "nodejs";

// Authenticated download for paystub PDFs stored in private Blob storage.
// The raw blob URL is never exposed to clients; this route is the only way in.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePayrollApiAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Invalid paystub id" }, { status: 400 });
    }
    const payHistoryId = BigInt(id);

    const payHistory = await prisma.payHistory.findUnique({
      where: { id: payHistoryId },
      select: {
        pdfUrl: true,
        employee: { select: { companyId: true } },
      },
    });
    if (!payHistory) {
      return NextResponse.json({ error: "Paystub not found" }, { status: 404 });
    }
    if (payHistory.employee.companyId !== auth.company.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!payHistory.pdfUrl) {
      return NextResponse.json({ error: "PDF has not been generated yet" }, { status: 404 });
    }

    const result = await get(payHistory.pdfUrl, { access: "private" });
    if (!result || result.statusCode !== 200) {
      return NextResponse.json({ error: "Paystub file not found" }, { status: 404 });
    }

    return new Response(result.stream, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="paystub-${id}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: unknown) {
    console.error("Failed to download paystub PDF", error);
    return NextResponse.json({ error: "Failed to download PDF" }, { status: 500 });
  }
}
