import { headers } from "next/headers";
import { eq, lt, sql as raw } from "drizzle-orm";
import { db } from "@/db";
import { rateLimitHits } from "@/db/schema";
import {
  decide,
  windowStartFor,
  type RateLimitResult,
  type RateLimitRule,
} from "./rate-limit-policy";

/**
 * Applies the policy in rate-limit-policy.ts against Postgres. Counters live
 * in the database rather than memory: a restart must not hand an attacker a
 * fresh budget, and several app containers should share one limit rather than
 * one each.
 */

export * from "./rate-limit-policy";

/**
 * Counts one attempt against `key` and says whether it may proceed. Counting
 * happens before the work it guards, so a rejected attempt costs one upsert
 * rather than a password hash.
 */
export async function consume(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const windowStart = windowStartFor(now, rule.windowMs);

  const [row] = await db
    .insert(rateLimitHits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitHits.key, rateLimitHits.windowStart],
      // Incremented in the statement rather than read-then-written, so two
      // concurrent attempts cannot both see the same count and pass.
      set: { count: raw`${rateLimitHits.count} + 1` },
    })
    .returning({ count: rateLimitHits.count });

  return decide(row?.count ?? 1, rule, windowStart, now);
}

/**
 * Forgets the counter for a key. Called after a successful sign-in so someone
 * who mistyped their password a few times is not locked out of their own
 * account for the rest of the window.
 */
export async function reset(key: string): Promise<void> {
  await db.delete(rateLimitHits).where(eq(rateLimitHits.key, key));
}

/** Drops windows that can no longer matter. */
export async function sweepExpired(olderThanMs = 24 * 60 * 60_000): Promise<void> {
  await db
    .delete(rateLimitHits)
    .where(lt(rateLimitHits.windowStart, new Date(Date.now() - olderThanMs)));
}

export async function maybeSweep(): Promise<void> {
  // One in fifty attempts pays for cleanup. Cheap enough to be invisible, and
  // frequent enough that the table cannot grow without bound, without needing a
  // scheduled job for a housekeeping task.
  if (Math.random() < 0.02) {
    await sweepExpired().catch(() => {});
  }
}

/**
 * Best-effort client address.
 *
 * Behind a proxy this is the only way to see the real client. Without one, the
 * header is attacker-controlled and the per-address limit can be sidestepped by
 * varying it. That is why the per-email limit exists and does not depend on
 * this: address-based limiting is a speed bump for spraying, not the guarantee.
 */
export async function clientAddress(): Promise<string> {
  const store = await headers();
  const forwarded = store.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return store.get("x-real-ip")?.trim() || "unknown";
}
