import type { T4GenerationStatus } from "@prisma/client";

export function getT4SummaryDisplayStatus(
  status: T4GenerationStatus,
  activeDocumentCount: number
) {
  if (activeDocumentCount > 0) return status;
  if (status === "FINALIZED") return "FINALIZED — REVIEW REQUIRED";
  return status === "GENERATED" ? "REVIEW REQUIRED" : status;
}

export function getT4SlipDocumentLabel(
  status: T4GenerationStatus,
  hasActiveDocument: boolean
) {
  if (hasActiveDocument) return "Download PDF";
  return status === "FINALIZED" || status === "GENERATED"
    ? "Review required — no validated file"
    : "No file";
}
