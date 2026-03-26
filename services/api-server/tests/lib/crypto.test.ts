import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../../src/lib/utils/crypto";

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
