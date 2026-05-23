import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type PdfRequestBody = {
  html?: unknown;
  payHistoryId?: unknown;
};

export async function POST(req: Request) {
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

    const isVercel = !!process.env.VERCEL;
    let browser;

    if (isVercel) {
      const chromium = (await import("@sparticuz/chromium")).default;
      const puppeteer = (await import("puppeteer-core")).default;
      browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    } else {
      const puppeteer = (await import("puppeteer")).default;
      browser = await puppeteer.launch({ headless: true });
    }

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const pdfBuffer = Buffer.from(await page.pdf({
      format: "A4",
      printBackground: true,
    }));

    await browser.close();

    const fileName = `payslip_${payHistoryId}.pdf`;

    if (isVercel) {
      const blob = await put(fileName, pdfBuffer, {
        access: "public",
        contentType: "application/pdf",
      });
      return NextResponse.json({ pdfUrl: blob.url });
    } else {
      const payslipsDir = path.join(process.cwd(), "public", "payslips");
      const filePath = path.join(payslipsDir, fileName);
      await mkdir(payslipsDir, { recursive: true });
      await writeFile(filePath, pdfBuffer);
      const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
      return NextResponse.json({ pdfUrl: `${baseUrl}/payslips/${fileName}` });
    }
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate PDF" },
      { status: 500 }
    );
  }
}