import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { requirePayrollApiAuth } from "@/lib/payroll-api-auth";
import { buildPaystubHtml, getPaystubData } from "@/lib/paystub";

export const runtime = "nodejs";

type PdfRequestBody = {
  payHistoryId?: unknown;
};

// HTML → PDF. Production uses the Railway PDF service; local development
// without PDF_SERVER_URL falls back to on-machine puppeteer.
async function renderPdf(html: string, payHistoryId: string): Promise<Buffer | null> {
  if (process.env.PDF_SERVER_URL && process.env.PDF_SERVER_SECRET) {
    const pdfResponse = await fetch(`${process.env.PDF_SERVER_URL}/generate-pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.PDF_SERVER_SECRET,
      },
      body: JSON.stringify({ html, payHistoryId }),
    });
    if (!pdfResponse.ok) {
      console.error("PDF server returned non-OK", { status: pdfResponse.status });
      return null;
    }
    return Buffer.from(await pdfResponse.arrayBuffer());
  }

  if (process.env.NODE_ENV !== "development") {
    console.error("PDF_SERVER_URL/PDF_SERVER_SECRET are not configured");
    return null;
  }

  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
  } finally {
    await browser.close();
  }
}

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

    const pdfBuffer = await renderPdf(html, payHistoryId.toString());
    if (!pdfBuffer) {
      return NextResponse.json({ error: "Failed to generate PDF" }, { status: 502 });
    }

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
