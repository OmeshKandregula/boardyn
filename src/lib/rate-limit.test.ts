import { describe, expect, it } from "vitest";
import { RULES, decide, describeRetry, loginKeys, windowStartFor } from "./rate-limit-policy";

const RULE = { limit: 3, windowMs: 60_000 };

describe("windowStartFor", () => {
  it("snaps to the start of the window", () => {
    const now = new Date("2026-08-25T12:34:56.789Z").getTime();
    expect(windowStartFor(now, 60_000).toISOString()).toBe(
      "2026-08-25T12:34:00.000Z",
    );
  });

  it("gives the same window for two moments inside it", () => {
    const a = new Date("2026-08-25T12:00:01Z").getTime();
    const b = new Date("2026-08-25T12:14:59Z").getTime();
    expect(windowStartFor(a, 15 * 60_000).getTime()).toBe(
      windowStartFor(b, 15 * 60_000).getTime(),
    );
  });

  it("rolls over to a new window at the boundary", () => {
    const before = new Date("2026-08-25T12:14:59.999Z").getTime();
    const after = new Date("2026-08-25T12:15:00.000Z").getTime();
    expect(windowStartFor(before, 15 * 60_000).getTime()).not.toBe(
      windowStartFor(after, 15 * 60_000).getTime(),
    );
  });
});

describe("decide", () => {
  const now = new Date("2026-08-25T12:00:30Z").getTime();
  const windowStart = windowStartFor(now, RULE.windowMs);

  it("allows attempts up to and including the limit", () => {
    for (let count = 1; count <= RULE.limit; count++) {
      expect(decide(count, RULE, windowStart, now).allowed).toBe(true);
    }
  });

  it("rejects the attempt after the limit", () => {
    expect(decide(RULE.limit + 1, RULE, windowStart, now).allowed).toBe(false);
  });

  it("counts down what is left", () => {
    expect(decide(1, RULE, windowStart, now).remaining).toBe(2);
    expect(decide(3, RULE, windowStart, now).remaining).toBe(0);
    // Never negative: the number is shown to people, not just compared.
    expect(decide(99, RULE, windowStart, now).remaining).toBe(0);
  });

  it("reports the wait until the window resets", () => {
    // 30 seconds into a 60 second window leaves 30 to wait.
    expect(decide(99, RULE, windowStart, now).retryAfterSeconds).toBe(30);
  });

  it("never reports a zero wait on a rejection", () => {
    // A "try again in 0 seconds" message would be nonsense, and the boundary
    // is reachable when the rejection lands in the last millisecond.
    const lastMoment = windowStart.getTime() + RULE.windowMs - 1;
    expect(decide(99, RULE, windowStart, lastMoment).retryAfterSeconds).toBe(1);
  });

  it("reports no wait when allowed", () => {
    expect(decide(1, RULE, windowStart, now).retryAfterSeconds).toBe(0);
  });
});

describe("configured rules", () => {
  it("limits one account more tightly than one address", () => {
    // Spraying many accounts from one address should get more headroom than
    // hammering a single account, or a shared office IP locks everyone out.
    expect(RULES.loginPerEmail.limit).toBeLessThan(RULES.loginPerIp.limit);
  });

  it("gives signup a longer window than login", () => {
    expect(RULES.signupPerIp.windowMs).toBeGreaterThan(
      RULES.loginPerIp.windowMs,
    );
  });
});

describe("loginKeys", () => {
  it("separates the email and address namespaces", () => {
    const keys = loginKeys("someone@example.test", "203.0.113.5");
    expect(keys.email).toBe("login:email:someone@example.test");
    expect(keys.ip).toBe("login:ip:203.0.113.5");
    expect(keys.email).not.toBe(keys.ip);
  });
});

describe("describeRetry", () => {
  it("uses seconds under a minute", () => {
    expect(describeRetry(1)).toBe("1 second");
    expect(describeRetry(45)).toBe("45 seconds");
  });

  it("rounds up to whole minutes above that", () => {
    expect(describeRetry(60)).toBe("1 minute");
    expect(describeRetry(61)).toBe("2 minutes");
    expect(describeRetry(900)).toBe("15 minutes");
  });
});
