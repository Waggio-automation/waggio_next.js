import { NextResponse } from "next/server";
import puppeteer from "puppeteer";
import type { Browser } from "puppeteer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type PdfRequestBody = {
  html?: unknown;
  payHistoryId?: unknown;
};

export async function POST(req: Request) {
  let browser: Browser | null = null;

  try {
    const body = (await req.json()) as PdfRequestBody;
    const html = typeof body?.html === "string" ? body.html : "";
    const payHistoryId =
      typeof body?.payHistoryId === "number" && Number.isFinite(body.payHistoryId)
        ? Math.trunc(body.payHistoryId)
        : null;

    if (!html.trim()) {
      return NextResponse.json({ error: "Missing or invalid html" }, { status: 400 });
    }

    if (payHistoryId == null) {
      return NextResponse.json({ error: "Missing or invalid payHistoryId" }, { status: 400 });
    }

    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
    });

    const fileName = `payslip_${payHistoryId}.pdf`;
    const payslipsDir = path.join(process.cwd(), "public", "payslips");
    const filePath = path.join(payslipsDir, fileName);

    await mkdir(payslipsDir, { recursive: true });
    await writeFile(filePath, pdfBuffer);

    return NextResponse.json({ pdfUrl: `/payslips/${fileName}` });
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
