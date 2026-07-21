import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-cbc";

function getEncryptionKey() {
  const encodedKey = process.env.ENCRYPTION_KEY;
  if (!encodedKey || !/^[0-9a-fA-F]{64}$/.test(encodedKey)) {
    throw new Error("SIN encryption is not configured");
  }

  return Buffer.from(encodedKey, "hex");
}

export function hasLegacySinCiphertextFormat(value: string) {
  const [ivHex, encryptedHex, ...extra] = value.split(":");
  return (
    extra.length === 0 &&
    /^[0-9a-fA-F]{32}$/.test(ivHex ?? "") &&
    /^[0-9a-fA-F]+$/.test(encryptedHex ?? "") &&
    encryptedHex.length % 32 === 0
  );
}

export function encryptSin(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSin(stored: string): string {
  if (!hasLegacySinCiphertextFormat(stored)) {
    throw new Error("Stored SIN is not in the supported encrypted format");
  }

  const [ivHex, encryptedHex] = stored.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
