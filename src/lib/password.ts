import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// promisify() resolves to the three-argument overload, which drops the cost
// parameters; wrapping by hand keeps them.
const scryptAsync = (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });

const KEY_LENGTH = 64;
// Cost parameters roughly match the OWASP scrypt guidance (N=2^16, r=8, p=1).
const PARAMS = { N: 1 << 16, r: 8, p: 1, maxmem: 128 * (1 << 16) * 8 * 2 };

/**
 * scrypt from the Node standard library rather than argon2 or bcrypt: no native
 * build step, which matters for a project people are expected to clone and run.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(
    password.normalize("NFKC"),
    salt,
    KEY_LENGTH,
    PARAMS,
  );
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString(
    "base64url",
  )}$${derived.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, n, r, p, salt, digest] = stored.split("$");
  if (scheme !== "scrypt") return false;

  const expected = Buffer.from(digest, "base64url");
  const derived = await scryptAsync(
    password.normalize("NFKC"),
    Buffer.from(salt, "base64url"),
    expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 },
  );

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
