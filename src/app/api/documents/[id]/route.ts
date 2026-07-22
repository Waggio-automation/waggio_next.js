import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { getDownloadableDocument } from "@/lib/document-access";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const company = await requireCompanyAdminOrRedirect();
  const { id } = await params;
  const disposition = new URL(req.url).searchParams.get("disposition");

  let documentId: bigint;
  try {
    documentId = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
  }

  const document = await getDownloadableDocument(company.id, documentId);

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const filePath = path.resolve(process.cwd(), document.storagePath);
  if (!filePath.startsWith(`${process.cwd()}${path.sep}`)) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(filePath);
  } catch {
    return NextResponse.json({ error: "Stored file not found" }, { status: 404 });
  }

  const canInline = disposition === "inline" && document.mimeType === "application/pdf";

  return new NextResponse(new Uint8Array(fileBuffer), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `${canInline ? "inline" : "attachment"}; filename="${document.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
