import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isEncrypted,
  secretHint,
} from "./secrets";

const original = process.env.AUTH_SECRET;
beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-encryption-tests";
});
afterAll(() => {
  process.env.AUTH_SECRET = original;
});

describe("encryptSecret and decryptSecret", () => {
  it("round trips a value", () => {
    const secret = "grn_abc123def456";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("does not leave the plaintext anywhere in the stored value", () => {
    const stored = encryptSecret("grn_abc123def456");
    expect(stored).not.toContain("grn_abc123def456");
    expect(stored).not.toContain("abc123");
  });

  it("produces a different ciphertext every time", () => {
    // A fresh IV per write. Without it, identical secrets would be visibly
    // identical in the database, which leaks that two users share a key.
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("survives unicode and long values", () => {
    const secret = "ключ-🔐-" + "x".repeat(4000);
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("refuses a tampered ciphertext rather than returning rubbish", () => {
    // The authentication tag is the point of GCM: a modified value must fail
    // loudly, not decrypt to something plausible.
    const stored = encryptSecret("grn_abc123def456");
    const [version, iv, tag, data] = stored.split(".");
    const flipped = Buffer.from(data, "base64url");
    flipped[0] ^= 0xff;
    const tampered = [version, iv, tag, flipped.toString("base64url")].join(".");

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("refuses a swapped authentication tag", () => {
    const a = encryptSecret("secret-one");
    const b = encryptSecret("secret-two");
    const [version, iv, , data] = a.split(".");
    const otherTag = b.split(".")[2];
    expect(() => decryptSecret([version, iv, otherTag, data].join("."))).toThrow();
  });

  it("cannot be decrypted with a different AUTH_SECRET", () => {
    const stored = encryptSecret("grn_abc123def456");
    process.env.AUTH_SECRET = "a-completely-different-secret";
    expect(() => decryptSecret(stored)).toThrow();
    process.env.AUTH_SECRET = "test-secret-for-encryption-tests";
  });
});

describe("legacy plaintext", () => {
  it("passes through values written before encryption existed", () => {
    // The upgrade path: existing installs have plaintext tokens in the table,
    // and they must keep working until the next write re-encrypts them.
    expect(decryptSecret("1//0abcdefg-plain-refresh-token")).toBe(
      "1//0abcdefg-plain-refresh-token",
    );
  });

  it("recognises which values are encrypted", () => {
    expect(isEncrypted(encryptSecret("x"))).toBe(true);
    expect(isEncrypted("plain-token")).toBe(false);
    // A plaintext value that happens to contain dots is still plaintext.
    expect(isEncrypted("a.b.c.d")).toBe(false);
  });
});

describe("secretHint", () => {
  it("shows only the tail", () => {
    expect(secretHint("grn_abcdefgh1234")).toBe("…1234");
  });

  it("does not leak a short value", () => {
    expect(secretHint("abc")).toBe("****");
  });
});
