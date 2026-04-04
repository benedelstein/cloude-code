import { decrypt } from "@/lib/utils/crypto";

export async function sha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function readStoredCredentialJson(
  rawStoredValue: string,
  encryptionKey: string,
): Promise<string> {
  try {
    return await decrypt(rawStoredValue, encryptionKey);
  } catch {
    return rawStoredValue;
  }
}
