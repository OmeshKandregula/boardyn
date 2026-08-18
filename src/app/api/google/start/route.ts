import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authorizeUrl, googleConfigured } from "@/lib/google/client";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Kicks off the OAuth dance. The state is a random nonce signed with
 * AUTH_SECRET and echoed in a short-lived cookie, so a callback that did not
 * originate here is rejected before any token is exchanged.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  if (!googleConfigured()) {
    return NextResponse.redirect(
      new URL("/settings?error=google_not_configured", request.url),
    );
  }

  const nonce = randomBytes(16).toString("base64url");
  const signature = createHmac("sha256", process.env.AUTH_SECRET ?? "")
    .update(`${user.id}:${nonce}`)
    .digest("base64url");
  const state = `${nonce}.${signature}`;

  const jar = await cookies();
  jar.set("boardyn_oauth_state", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authorizeUrl(state));
}
