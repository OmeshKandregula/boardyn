import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { googleAccounts } from "@/db/schema";
import { syncAccount } from "@/lib/google/pull";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** "Sync now" from the settings page. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [account] = await db
    .select()
    .from(googleAccounts)
    .where(eq(googleAccounts.userId, user.id))
    .limit(1);

  if (!account) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  try {
    const result = await syncAccount(account);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: String(error).slice(0, 300) },
      { status: 502 },
    );
  }
}
