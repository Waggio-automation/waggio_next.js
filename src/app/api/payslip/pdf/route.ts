import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

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

    // Express PDF 서버 호출 (Railway 등에 배포된 서버)
    const pdfResponse = await fetch(`${process.env.PDF_SERVER_URL}/pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.PDF_SERVER_SECRET!,
      },
      body: JSON.stringify({ html , payHistoryId }),
    });

    if (!pdfResponse.ok) {
      const errorText = await pdfResponse.json().catch(() => ({}));
      return NextResponse.json(
        { error: `PDF server error: ${errorText}` }, 
        { status: 500 }
      );
    }
    
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    const fileName = `payslip_${payHistoryId}.pdf`;

    // Vercel Blob Storage에 PDF 업로드
    const blob = await put(fileName, pdfBuffer, { 
      access: "public",
      contentType: "application/pdf",
    });
    return NextResponse.json({ pdfUrl: blob.url });
  }catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate PDF" },
      { status: 500 }
    );
  }
}