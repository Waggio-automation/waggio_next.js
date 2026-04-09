import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireCompanyAdminOrRedirect } from "@/lib/company-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const company = await requireCompanyAdminOrRedirect();
  const { id } = await params;

  let documentId: bigint;
  try {
    documentId = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
  }

  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      companyId: company.id,
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), document.storagePath);
  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(filePath);
  } catch {
    return NextResponse.json({ error: "Stored file not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(fileBuffer), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `attachment; filename="${document.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
