/**
 * AES-GCM encryption/decryption for storing GitHub tokens at rest in D1.
 * Key is a base64-encoded 256-bit symmetric key from TOKEN_ENCRYPTION_KEY env var.
 */

const ALG = "AES-GCM";
const IV_BYTES = 12;

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Key.trim()), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, ALG, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypt plaintext → base64 string (iv + ciphertext). */
export async function encrypt(
  plaintext: string,
  base64Key: string,
): Promise<string> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: ALG, iv }, key, encoded),
  );

  // Prepend IV to ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);

  return btoa(String.fromCharCode(...combined));
}

/** Decrypt base64 string (iv + ciphertext) → plaintext. */
export async function decrypt(
  encoded: string,
  base64Key: string,
): Promise<string> {
  const key = await importKey(base64Key);
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, IV_BYTES);
  const ciphertext = combined.slice(IV_BYTES);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALG, iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}

/** SHA-256 hash of a string, returned as a lowercase hex string. */
export async function sha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Decrypt a stored credential value, falling back to the raw value if decryption fails. */
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
