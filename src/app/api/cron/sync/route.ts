import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { syncAllGranolaAccounts } from "@/lib/granola/pull";
import { syncAllAccounts } from "@/lib/google/pull";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Poll every connected calendar and Granola account. Point a cron at this
 * every five minutes:
 *
 *   curl -H "authorization: Bearer $CRON_SECRET" https://.../api/cron/sync
 *
 * Google can also push changes over a webhook, but that needs a publicly
 * reachable HTTPS endpoint and channels that expire weekly. Polling with a
 * sync token costs one cheap request per account and works on a laptop.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${secret}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // Both integrations poll on the same schedule and neither should be able to
  // stop the other running, so they are settled independently.
  const [calendars, granola] = await Promise.allSettled([
    syncAllAccounts(),
    syncAllGranolaAccounts(),
  ]);

  return NextResponse.json({
    ok: true,
    calendars: calendars.status === "fulfilled" ? calendars.value : String(calendars.reason),
    granola: granola.status === "fulfilled" ? granola.value : String(granola.reason),
  });
}

export const POST = GET;
