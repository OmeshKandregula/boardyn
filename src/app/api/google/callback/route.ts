import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { googleAccounts } from "@/db/schema";
import { exchangeCode, fetchUserInfo } from "@/lib/google/client";
import { syncAccount } from "@/lib/google/pull";
import { ids } from "@/lib/ids";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(error)}`, request.url),
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const jar = await cookies();
  const expectedNonce = jar.get("boardyn_oauth_state")?.value;
  jar.delete("boardyn_oauth_state");

  if (!code || !expectedNonce || !stateIsValid(state, expectedNonce, user.id)) {
    return NextResponse.redirect(new URL("/settings?error=bad_state", request.url));
  }

  try {
    const token = await exchangeCode(code);
    const profile = await fetchUserInfo(token.access_token);
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);

    const [existing] = await db
      .select()
      .from(googleAccounts)
      .where(eq(googleAccounts.userId, user.id))
      .limit(1);

    // Reconnecting without prompt=consent can return no refresh token, so the
    // stored one carries over: that is what makes a re-auth non-destructive.
    // It comes back out of the row encrypted, hence the decrypt before the
    // re-encrypt below.
    const refreshToken =
      token.refresh_token ??
      (existing ? decryptSecret(existing.refreshToken) : undefined);
    if (!refreshToken) {
      return NextResponse.redirect(
        new URL("/settings?error=no_refresh_token", request.url),
      );
    }

    const accountId = existing?.id ?? ids.google();
    await db
      .insert(googleAccounts)
      .values({
        id: accountId,
        userId: user.id,
        googleUserId: profile.sub,
        email: profile.email,
        accessToken: encryptSecret(token.access_token),
        refreshToken: encryptSecret(refreshToken),
        expiresAt,
        syncEnabled: true,
        lastSyncError: null,
      })
      .onConflictDoUpdate({
        target: googleAccounts.userId,
        set: {
          googleUserId: profile.sub,
          email: profile.email,
          accessToken: encryptSecret(token.access_token),
          refreshToken: encryptSecret(refreshToken),
          expiresAt,
          syncEnabled: true,
          lastSyncError: null,
          // A different Google account means the old cursor is meaningless.
          syncToken: existing?.googleUserId === profile.sub ? existing.syncToken : null,
        },
      });

    const [account] = await db
      .select()
      .from(googleAccounts)
      .where(eq(googleAccounts.id, accountId))
      .limit(1);
    if (account) {
      // First pull inline so the calendar view is populated on arrival.
      await syncAccount(account).catch((syncError) =>
        console.error("[google] first sync failed", syncError),
      );
    }

    return NextResponse.redirect(new URL("/settings?connected=1", request.url));
  } catch (caught) {
    console.error("[google] callback failed", caught);
    return NextResponse.redirect(
      new URL("/settings?error=exchange_failed", request.url),
    );
  }
}

function stateIsValid(state: string, nonce: string, userId: string): boolean {
  const [received, signature] = state.split(".");
  if (received !== nonce || !signature) return false;

  const expected = createHmac("sha256", process.env.AUTH_SECRET ?? "")
    .update(`${userId}:${nonce}`)
    .digest("base64url");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
