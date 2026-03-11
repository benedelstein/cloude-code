import { type NextRequest, type NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "session_token";
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const ALGORITHM = "AES-GCM";
const IV_BYTES = 12;

function getSessionCookieSecret(): string {
  const secret = process.env.SESSION_COOKIE_SECRET;

  if (!secret) {
    throw new Error("SESSION_COOKIE_SECRET is not set");
  }

  return secret;
}

async function importKey(): Promise<CryptoKey> {
  const rawKey = Buffer.from(getSessionCookieSecret().trim(), "base64");

  return crypto.subtle.importKey("raw", rawKey, ALGORITHM, false, [
    "encrypt",
    "decrypt",
  ]);
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

export async function encryptSessionToken(sessionToken: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(sessionToken);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, plaintext),
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);

  combined.set(iv);
  combined.set(ciphertext, iv.length);

  return encodeBase64(combined);
}

export async function decryptSessionToken(
  encryptedToken: string | undefined,
): Promise<string | null> {
  if (!encryptedToken) {
    return null;
  }

  try {
    const key = await importKey();
    const combined = decodeBase64(encryptedToken);

    if (combined.length <= IV_BYTES) {
      return null;
    }

    const iv = combined.slice(0, IV_BYTES);
    const ciphertext = combined.slice(IV_BYTES);
    const plaintext = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext,
    );

    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

export async function getSessionTokenFromRequest(
  request: NextRequest,
): Promise<string | null> {
  return decryptSessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

export async function setSessionCookie(
  response: NextResponse,
  sessionToken: string,
): Promise<void> {
  const encryptedToken = await encryptSessionToken(sessionToken);

  response.cookies.set(SESSION_COOKIE_NAME, encryptedToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}
