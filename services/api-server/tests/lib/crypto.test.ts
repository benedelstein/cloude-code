import { describe, expect, it } from "vitest";
import { decrypt, encrypt, sha256, readStoredCredentialJson } from "../../src/lib/utils/crypto";

const VALID_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const WRONG_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

describe("crypto helpers", () => {
  it("encrypts and decrypts roundtrip", async () => {
    const encoded = await encrypt("secret", VALID_KEY);
    await expect(decrypt(encoded, VALID_KEY)).resolves.toBe("secret");
  });

  it("rejects decrypt with wrong key", async () => {
    const encoded = await encrypt("secret", VALID_KEY);
    await expect(decrypt(encoded, WRONG_KEY)).rejects.toThrow();
  });

  it("supports empty plaintext", async () => {
    const encoded = await encrypt("", VALID_KEY);
    await expect(decrypt(encoded, VALID_KEY)).resolves.toBe("");
  });
});

describe("sha256", () => {
  it("returns correct hex digest for known input", async () => {
    // echo -n "hello" | sha256sum
    await expect(sha256("hello")).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("returns different digests for different inputs", async () => {
    const a = await sha256("foo");
    const b = await sha256("bar");
    expect(a).not.toBe(b);
  });
});

describe("readStoredCredentialJson", () => {
  it("decrypts an encrypted value", async () => {
    const json = JSON.stringify({ accessToken: "tok" });
    const encrypted = await encrypt(json, VALID_KEY);
    await expect(readStoredCredentialJson(encrypted, VALID_KEY)).resolves.toBe(json);
  });

  it("falls back to raw value when decryption fails", async () => {
    const raw = JSON.stringify({ accessToken: "tok" });
    await expect(readStoredCredentialJson(raw, VALID_KEY)).resolves.toBe(raw);
  });
});
