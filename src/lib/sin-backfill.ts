import { encryptSin } from "./crypto.ts";
import {
  classifyStoredSin,
  normalizeSin,
  resolveSinForT4,
  type StoredSinClassification,
} from "./sin.ts";

export type SinBackfillClassification = StoredSinClassification | "CORRUPT_CIPHERTEXT";

export type SinBackfillReason =
  | "ALREADY_ENCRYPTED"
  | "PLAINTEXT_ENCRYPTION_CANDIDATE"
  | "CORRUPT_CIPHERTEXT"
  | "EMPTY_VALUE"
  | "MASKED_VALUE"
  | "INVALID_PLAINTEXT"
  | "UNKNOWN_FORMAT"
  | "CONCURRENTLY_CHANGED";

export type SinBackfillReportRow = {
  id: string;
  classification: SinBackfillClassification;
  reasonCode: SinBackfillReason;
  changed: boolean;
};

export type SinBackfillCounts = Record<SinBackfillClassification, number> & {
  scanned: number;
  candidates: number;
  changed: number;
  quarantined: number;
  concurrentlyChanged: number;
};

export type SinBackfillRepository = {
  readBatch(params: { afterId: bigint | null; take: number }): Promise<Array<{ id: bigint; sin: string }>>;
  updateIfUnchanged(params: { id: bigint; previous: string; encrypted: string }): Promise<boolean>;
};

function classifyForBackfill(stored: string): SinBackfillClassification {
  const classification = classifyStoredSin(stored);
  if (classification !== "CIPHERTEXT") return classification;
  return resolveSinForT4(stored).ok ? "CIPHERTEXT" : "CORRUPT_CIPHERTEXT";
}

function reasonForClassification(classification: SinBackfillClassification): SinBackfillReason {
  switch (classification) {
    case "CIPHERTEXT":
      return "ALREADY_ENCRYPTED";
    case "PLAINTEXT_VALID":
      return "PLAINTEXT_ENCRYPTION_CANDIDATE";
    case "CORRUPT_CIPHERTEXT":
      return "CORRUPT_CIPHERTEXT";
    case "EMPTY":
      return "EMPTY_VALUE";
    case "MASKED":
      return "MASKED_VALUE";
    case "PLAINTEXT_INVALID":
      return "INVALID_PLAINTEXT";
    case "UNKNOWN":
      return "UNKNOWN_FORMAT";
  }
}

export async function runSinBackfill(params: {
  repository: SinBackfillRepository;
  apply: boolean;
  batchSize?: number;
  onReport?: (row: SinBackfillReportRow) => void;
}) {
  const counts: SinBackfillCounts = {
    EMPTY: 0,
    MASKED: 0,
    PLAINTEXT_VALID: 0,
    PLAINTEXT_INVALID: 0,
    CIPHERTEXT: 0,
    CORRUPT_CIPHERTEXT: 0,
    UNKNOWN: 0,
    scanned: 0,
    candidates: 0,
    changed: 0,
    quarantined: 0,
    concurrentlyChanged: 0,
  };
  const batchSize = Math.min(Math.max(params.batchSize ?? 100, 1), 1000);
  let afterId: bigint | null = null;

  while (true) {
    const rows = await params.repository.readBatch({ afterId, take: batchSize });
    if (rows.length === 0) break;

    for (const row of rows) {
      const classification = classifyForBackfill(row.sin);
      counts.scanned += 1;
      counts[classification] += 1;
      let reasonCode = reasonForClassification(classification);
      let changed = false;

      if (classification === "PLAINTEXT_VALID") {
        counts.candidates += 1;
        if (params.apply) {
          const encrypted = encryptSin(normalizeSin(row.sin));
          changed = await params.repository.updateIfUnchanged({
            id: row.id,
            previous: row.sin,
            encrypted,
          });
          if (changed) {
            counts.changed += 1;
          } else {
            reasonCode = "CONCURRENTLY_CHANGED";
            counts.concurrentlyChanged += 1;
            counts.quarantined += 1;
          }
        }
      } else if (classification !== "CIPHERTEXT") {
        counts.quarantined += 1;
      }

      params.onReport?.({
        id: row.id.toString(),
        classification,
        reasonCode,
        changed,
      });
    }

    afterId = rows.at(-1)!.id;
  }

  return counts;
}
