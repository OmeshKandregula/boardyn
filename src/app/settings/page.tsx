import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createWorkspace } from "@/app/actions/workspaces";
import { AppShell } from "@/components/AppShell";
import { GooglePanel } from "@/components/settings/GooglePanel";
import { GranolaPanel } from "@/components/settings/GranolaPanel";
import { db } from "@/db";
import {
  googleAccounts,
  granolaAccounts,
  workspaces as workspacesTable,
} from "@/db/schema";
import { googleConfigured } from "@/lib/google/client";
import { getWorkspacesForUser } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Account-level settings only: the things that belong to you rather than to a
 * workspace. Members and invites live at /w/[slug]/settings, because there is
 * no such thing as "the current workspace" on a page reached from the top bar,
 * and guessing at one silently pointed the invite and remove controls at the
 * wrong set of people.
 */

const ERRORS: Record<string, string> = {
  google_not_configured:
    "Google sync is not configured on this instance. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then restart.",
  bad_state: "That sign-in attempt expired. Try connecting again.",
  no_refresh_token:
    "Google did not return a refresh token. Remove Boardyn at myaccount.google.com/permissions and connect again.",
  exchange_failed: "Google rejected the connection. Check the client credentials.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [query, workspaces, account, granola] = await Promise.all([
    searchParams,
    getWorkspacesForUser(user.id),
    db
      .select()
      .from(googleAccounts)
      .where(eq(googleAccounts.userId, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        keyHint: granolaAccounts.keyHint,
        syncEnabled: granolaAccounts.syncEnabled,
        lastSyncedAt: granolaAccounts.lastSyncedAt,
        lastSyncError: granolaAccounts.lastSyncError,
        workspaceName: workspacesTable.name,
      })
      .from(granolaAccounts)
      .innerJoin(
        workspacesTable,
        eq(workspacesTable.id, granolaAccounts.workspaceId),
      )
      .where(eq(granolaAccounts.userId, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  return (
    <AppShell user={user} workspaces={workspaces}>
      <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

        {query.error ? (
          <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {ERRORS[query.error] ?? query.error}
          </p>
        ) : null}
        {query.connected ? (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            Google Calendar connected. Your events are syncing.
          </p>
        ) : null}

        <section className="panel p-5">
          <h2 className="mb-1 text-sm font-semibold">Account</h2>
          <p className="text-sm text-[color:var(--color-ink-muted)]">
            {user.name} · {user.email}
          </p>
        </section>

        <GooglePanel
          account={
            account
              ? {
                  email: account.email,
                  calendarId: account.calendarId,
                  syncEnabled: account.syncEnabled,
                  pushCards: account.pushCards,
                  lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
                  lastSyncError: account.lastSyncError,
                }
              : null
          }
          configured={googleConfigured()}
        />

        <GranolaPanel
          account={
            granola
              ? {
                  ...granola,
                  lastSyncedAt: granola.lastSyncedAt?.toISOString() ?? null,
                }
              : null
          }
          workspaces={workspaces.map((workspace) => ({
            id: workspace.id,
            name: workspace.name,
          }))}
        />

        <section className="panel p-5">
          <h2 className="mb-1 text-sm font-semibold">Workspaces</h2>
          <p className="mb-4 text-sm text-[color:var(--color-ink-muted)]">
            Members and invites are managed inside each workspace.
          </p>

          <ul className="mb-5 space-y-1.5">
            {workspaces.map((workspace) => (
              <li
                key={workspace.id}
                className="flex items-center gap-2 text-sm"
              >
                <Link
                  href={`/w/${workspace.slug}`}
                  className="hover:underline"
                >
                  {workspace.name}
                </Link>
                {workspace.role === "owner" ? (
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[color:var(--color-ink-faint)]">
                    owner
                  </span>
                ) : null}
                <Link
                  href={`/w/${workspace.slug}/settings`}
                  className="btn-ghost ml-auto px-2 py-0.5 text-xs"
                >
                  Members
                </Link>
              </li>
            ))}
          </ul>

          <form action={createWorkspace} className="flex gap-2">
            <input
              name="name"
              placeholder="New workspace name"
              className="field"
              required
            />
            <button className="btn-outline shrink-0" type="submit">
              Create
            </button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
