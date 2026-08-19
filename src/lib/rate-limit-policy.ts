/**
 * Rate limiting policy: the rules, the window arithmetic, and the decision.
 *
 * Deliberately free of any database or request imports so it can be tested
 * directly, and so the limits can be read and reasoned about in one place
 * without tracing through storage code. rate-limit.ts applies these against
 * Postgres.
 *
 * Fixed windows rather than a sliding log because the failure mode is
 * acceptable and the cost is one upserted row per attempt. The worst case is
 * someone getting up to twice the limit by straddling a boundary, which still
 * turns an unbounded guessing rate into a bounded one. A sliding window would
 * need a row per attempt and a sweep to stay honest.
 */

export type RateLimitRule = { limit: number; windowMs: number };

export const RULES = {
  /** One account, many guesses. The targeted case. */
  loginPerEmail: { limit: 10, windowMs: 15 * 60_000 },
  /** Many accounts, few guesses each. The spraying case. */
  loginPerIp: { limit: 30, windowMs: 15 * 60_000 },
  /** Signup is expensive (scrypt) and rarely done in bulk by real people. */
  signupPerIp: { limit: 5, windowMs: 60 * 60_000 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/** The start of the fixed window a moment falls in. */
export function windowStartFor(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

export function decide(
  count: number,
  rule: RateLimitRule,
  windowStart: Date,
  now: number,
): RateLimitResult {
  const allowed = count <= rule.limit;
  const resetsAt = windowStart.getTime() + rule.windowMs;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetsAt - now) / 1000)),
  };
}

/** "in 4 minutes" / "in 30 seconds", for a message someone can act on. */
export function describeRetry(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** The two keys a sign-in attempt is counted under. */
export function loginKeys(email: string, address: string) {
  return {
    email: `login:email:${email}`,
    ip: `login:ip:${address}`,
  };
}

export function signupKey(address: string): string {
  return `signup:ip:${address}`;
}
