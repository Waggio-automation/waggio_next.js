import { NextResponse } from "next/server";
import puppeteer from "puppeteer";

export const runtime = "nodejs";

type PdfRequestBody = {
  html?: unknown;
};

export async function POST(req: Request) {
  let browser: puppeteer.Browser | null = null;

  try {
    const body = (await req.json()) as PdfRequestBody;
    const html = typeof body?.html === "string" ? body.html : "";

    if (!html.trim()) {
      return NextResponse.json({ error: "Missing or invalid html" }, { status: 400 });
    }

    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
    });

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="payslip.pdf"',
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate PDF" },
      { status: 500 }
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
