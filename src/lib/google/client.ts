import { eq } from "drizzle-orm";
import { db } from "@/db";
import { googleAccounts, type GoogleAccount } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/**
 * calendar.events rather than the full calendar scope: enough to read and write
 * events on calendars the user already has, and not enough to create, share or
 * delete a calendar. Google shows the difference on the consent screen, and a
 * co-founder handing over their work calendar deserves the narrower ask.
 */
export const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(): string {
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  return `${base}/api/google/callback`;
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    // offline + consent are what actually produce a refresh token. Without
    // prompt=consent Google silently omits it on every re-authorisation after
    // the first, and the integration dies the moment the access token expires.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
};

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await response.text()}`);
  }
  return (await response.json()) as TokenResponse;
}

export async function fetchUserInfo(accessToken: string) {
  const response = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Could not read Google profile");
  return (await response.json()) as { sub: string; email: string; name?: string };
}

/**
 * Returns a usable access token, refreshing it in place when it is within a
 * minute of expiry. Every caller goes through this rather than reading the
 * column directly.
 */
export async function accessTokenFor(account: GoogleAccount): Promise<string> {
  // Tokens are encrypted at rest; rows written before that was true decrypt to
  // themselves. See lib/secrets.ts.
  if (account.expiresAt.getTime() - Date.now() > 60_000) {
    return decryptSecret(account.accessToken);
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: decryptSecret(account.refreshToken),
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    // A revoked grant is permanent: stop retrying and surface it in settings.
    await db
      .update(googleAccounts)
      .set({ syncEnabled: false, lastSyncError: `Reconnect needed: ${detail}` })
      .where(eq(googleAccounts.id, account.id));
    throw new Error(`Token refresh failed: ${detail}`);
  }

  const token = (await response.json()) as TokenResponse;
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);

  const encrypted = encryptSecret(token.access_token);
  await db
    .update(googleAccounts)
    .set({ accessToken: encrypted, expiresAt, lastSyncError: null })
    .where(eq(googleAccounts.id, account.id));

  // Keep the in-memory copy consistent with the row, encrypted form included,
  // so a caller reusing this object does not double-decrypt or see stale data.
  account.accessToken = encrypted;
  account.expiresAt = expiresAt;
  return token.access_token;
}

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export async function calendarFetch<T>(
  account: GoogleAccount,
  path: string,
  init: RequestInit & { query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const token = await accessTokenFor(account);
  const url = new URL(`${CALENDAR_API}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    throw new GoogleApiError(response.status, await response.text());
  }
  return (await response.json()) as T;
}

export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
};
