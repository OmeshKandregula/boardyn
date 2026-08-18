import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Short, URL-safe, sortable-enough ids. The prefix makes a stray id in a log
 * line self-describing ("crd_x1f9..." is obviously a card).
 */
export function newId(prefix: string, length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

export const ids = {
  user: () => newId("usr"),
  workspace: () => newId("wsp"),
  invite: () => newId("inv"),
  board: () => newId("brd"),
  property: () => newId("prp"),
  option: () => newId("opt"),
  view: () => newId("viw"),
  card: () => newId("crd"),
  comment: () => newId("cmt"),
  activity: () => newId("act"),
  google: () => newId("gac"),
  event: () => newId("evt"),
};

/** A random token for links that are handed out (invites, session cookies). */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}
