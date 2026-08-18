import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { syncAllAccounts } from "@/lib/google/pull";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Poll every connected calendar. Point a cron at this every five minutes:
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

  const results = await syncAllAccounts();
  return NextResponse.json({ ok: true, results });
}

export const POST = GET;
