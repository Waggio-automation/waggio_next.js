import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { buildPaystubHtml, getPaystubData, type PaystubData } from "@/lib/paystub";

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

export type GeneratePaystubPdfResult =
  | { ok: true; pdfBuffer: Buffer; blobUrl: string; data: PaystubData }
  | { ok: false; status: number; error: string };

// Builds the paystub HTML from stored data, renders it to PDF, stores it in
// private Blob storage, and records the URL on the PayHistory row. The caller
// is responsible for auth + tenant ownership before calling this.
export async function generateAndStorePaystubPdf(params: {
  payHistoryId: bigint;
  companyId: bigint;
}): Promise<GeneratePaystubPdfResult> {
  const data = await getPaystubData(params.payHistoryId, params.companyId);
  if (!data) {
    return { ok: false, status: 404, error: "Paystub not found" };
  }

  const html = buildPaystubHtml(data);
  const pdfBuffer = await renderPdf(html, params.payHistoryId.toString());
  if (!pdfBuffer) {
    return { ok: false, status: 502, error: "Failed to generate PDF" };
  }

  // Private storage under an unguessable path — never publicly readable.
  const blob = await put(
    `paystubs/${params.companyId.toString()}/paystub-${params.payHistoryId.toString()}.pdf`,
    pdfBuffer,
    {
      access: "private",
      addRandomSuffix: true,
      contentType: "application/pdf",
    }
  );

  await prisma.payHistory.update({
    where: { id: params.payHistoryId },
    data: { pdfUrl: blob.url },
  });

  return { ok: true, pdfBuffer, blobUrl: blob.url, data };
}
