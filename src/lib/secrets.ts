import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Encryption for third-party credentials at rest.
 *
 * A Google refresh token or a Granola API key is not our secret to lose: it
 * grants read access to somebody's calendar or every meeting note they have
 * ever taken. Stored in plain text, a database backup, a stray pg_dump or a
 * read-only SQL injection hands all of that over. Encrypting at the
 * application layer means the database alone is not enough.
 *
 * This is not a substitute for a real key management service. The key is
 * derived from AUTH_SECRET, so an attacker with both the database *and* the
 * environment can still decrypt. It defends against the far more common case:
 * the two being separated, which is exactly what a backup, a log or a snapshot
 * does.
 *
 * Format: v1.<iv>.<authTag>.<ciphertext>, base64url throughout. The version
 * prefix is there so the scheme can change later without guessing at what old
 * rows contain.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const KEY_BYTES = 32;

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set, so secrets cannot be encrypted.");
  }
  // HKDF with a fixed info string so this key is not the same bytes as
  // anything else derived from AUTH_SECRET elsewhere.
  return Buffer.from(
    hkdfSync("sha256", secret, "boardyn-secrets", "third-party-credentials", KEY_BYTES),
  );
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Decrypts a stored value. Anything not in the versioned format is returned
 * unchanged, which is what lets an existing install upgrade without a
 * migration step: rows written before this existed are plain text, and they
 * re-encrypt the next time they are written.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;

  const [, ivPart, tagPart, dataPart] = stored.split(".");
  const decipher = createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncrypted(stored: string): boolean {
  const parts = stored.split(".");
  return parts.length === 4 && parts[0] === VERSION;
}

/**
 * The last four characters, for showing which key is configured without
 * showing the key. A Granola key is `grn_` plus a long random tail; the tail
 * is what distinguishes one from another when somebody has several.
 */
export function secretHint(plaintext: string): string {
  return plaintext.length <= 4 ? "****" : `…${plaintext.slice(-4)}`;
}
