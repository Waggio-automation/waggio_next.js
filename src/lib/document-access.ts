import { prisma } from "./prisma.ts";
import { getProviderVerificationBlockedDocumentIds } from "./payments/provider-verification.ts";

export async function getDownloadableDocument(companyId: bigint, documentId: bigint) {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      companyId,
      validationStatus: "ACTIVE",
    },
  });
  if (!document) return null;
  const blockedIds = await getProviderVerificationBlockedDocumentIds(companyId);
  return blockedIds.has(document.id) ? null : document;
}
