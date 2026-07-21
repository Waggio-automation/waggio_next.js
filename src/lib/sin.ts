import { decryptSin, hasLegacySinCiphertextFormat } from "./crypto.ts";

export type StoredSinClassification =
  | "EMPTY"
  | "MASKED"
  | "PLAINTEXT_VALID"
  | "PLAINTEXT_INVALID"
  | "CIPHERTEXT"
  | "UNKNOWN";

export type T4SinFailureReason =
  | "SIN_ENCRYPTION_STATE_UNKNOWN"
  | "SIN_DECRYPTION_FAILED"
  | "INVALID_DECRYPTED_SIN";

const MASKED_SIN_PATTERN = /^\*{3}-\*{3}-(?:\*{3}|\d{3})$/;

export function normalizeSin(value: string) {
  return value.trim().replace(/[\s-]/g, "");
}

export function isValidSin(value: string) {
  const normalized = normalizeSin(value);
  if (!/^\d{9}$/.test(normalized) || /^(\d)\1{8}$/.test(normalized)) {
    return false;
  }

  const sum = normalized.split("").reduce((total, character, index) => {
    const digit = Number(character);
    if (index % 2 === 0) return total + digit;
    const doubled = digit * 2;
    return total + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);

  return sum % 10 === 0;
}

export function classifyStoredSin(value: string | null | undefined): StoredSinClassification {
  const stored = value?.trim() ?? "";
  if (!stored) return "EMPTY";
  if (MASKED_SIN_PATTERN.test(stored)) return "MASKED";
  if (hasLegacySinCiphertextFormat(stored)) return "CIPHERTEXT";
  if (/^[\d\s-]+$/.test(stored)) {
    return isValidSin(stored) ? "PLAINTEXT_VALID" : "PLAINTEXT_INVALID";
  }
  return "UNKNOWN";
}

export type ResolvedT4Sin =
  | { ok: true; sin: string }
  | { ok: false; reason: T4SinFailureReason };

export function resolveSinForT4(stored: string): ResolvedT4Sin {
  if (classifyStoredSin(stored) !== "CIPHERTEXT") {
    return { ok: false, reason: "SIN_ENCRYPTION_STATE_UNKNOWN" };
  }

  let decrypted: string;
  try {
    decrypted = decryptSin(stored);
  } catch {
    return { ok: false, reason: "SIN_DECRYPTION_FAILED" };
  }

  const normalized = normalizeSin(decrypted);
  if (!/^\d{9}$/.test(normalized) || !isValidSin(normalized)) {
    return { ok: false, reason: "INVALID_DECRYPTED_SIN" };
  }

  return { ok: true, sin: normalized };
}

export function maskStoredSinForDisplay(
  stored: string | null | undefined,
  options: { revealLastThree: boolean }
) {
  if (!options.revealLastThree) return "***-***-***";
  if (!stored) return "***-***-***";

  const classification = classifyStoredSin(stored);
  let normalized: string | null = null;

  if (classification === "CIPHERTEXT") {
    const resolved = resolveSinForT4(stored);
    normalized = resolved.ok ? resolved.sin : null;
  } else if (classification === "PLAINTEXT_VALID") {
    normalized = normalizeSin(stored);
  }

  return normalized ? `***-***-${normalized.slice(-3)}` : "***-***-***";
}
