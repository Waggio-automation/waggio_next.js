import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { requirePayrollApiAuth } from "@/lib/payroll-api-auth";
import { buildPaystubHtml, getPaystubData } from "@/lib/paystub";

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

    // The server is the only author of paystub HTML — clients cannot supply it.
    const data = await getPaystubData(payHistoryId, auth.company.id);
    if (!data) {
      return NextResponse.json({ error: "Paystub not found" }, { status: 404 });
    }
    const html = buildPaystubHtml(data);

    if (!process.env.PDF_SERVER_URL || !process.env.PDF_SERVER_SECRET) {
      return NextResponse.json({ error: "PDF service is not configured" }, { status: 503 });
    }

    const pdfResponse = await fetch(`${process.env.PDF_SERVER_URL}/pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.PDF_SERVER_SECRET,
      },
      body: JSON.stringify({ html, payHistoryId: payHistoryId.toString() }),
    });

    if (!pdfResponse.ok) {
      console.error("PDF server returned non-OK", { status: pdfResponse.status });
      return NextResponse.json({ error: "Failed to generate PDF" }, { status: 502 });
    }

    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

    // Private storage under an unguessable path — never publicly readable.
    const blob = await put(
      `paystubs/${auth.company.id.toString()}/paystub-${payHistoryId.toString()}.pdf`,
      pdfBuffer,
      {
        access: "private",
        addRandomSuffix: true,
        contentType: "application/pdf",
      }
    );

    await prisma.payHistory.update({
      where: { id: payHistoryId },
      data: { pdfUrl: blob.url },
    });

    return NextResponse.json({
      ok: true,
      downloadUrl: `/api/payslip/${payHistoryId.toString()}/download`,
    });
  } catch (error: unknown) {
    console.error("Failed to generate paystub PDF", error);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
