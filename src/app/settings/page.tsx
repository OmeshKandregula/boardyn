import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { createWorkspace } from "@/app/actions/workspaces";
import { AppShell } from "@/components/AppShell";
import { GooglePanel } from "@/components/settings/GooglePanel";
import { MembersPanel } from "@/components/settings/MembersPanel";
import { db } from "@/db";
import { googleAccounts, workspaceInvites } from "@/db/schema";
import { googleConfigured } from "@/lib/google/client";
import { getWorkspaceMembers, getWorkspacesForUser } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

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

  const query = await searchParams;
  const workspaces = await getWorkspacesForUser(user.id);
  const active = workspaces[0];

  const [members, invites, account] = await Promise.all([
    active ? getWorkspaceMembers(active.id) : Promise.resolve([]),
    active
      ? db
          .select()
          .from(workspaceInvites)
          .where(
            and(
              eq(workspaceInvites.workspaceId, active.id),
              isNull(workspaceInvites.acceptedAt),
            ),
          )
      : Promise.resolve([]),
    db
      .select()
      .from(googleAccounts)
      .where(eq(googleAccounts.userId, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  return (
    <AppShell user={user} workspaces={workspaces} members={members}>
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

        {active ? (
          <MembersPanel
            workspaceId={active.id}
            workspaceName={active.name}
            currentUserId={user.id}
            isOwner={active.role === "owner"}
            members={members}
            invites={invites.map((invite) => ({
              id: invite.id,
              email: invite.email,
              token: invite.token,
              expiresAt: invite.expiresAt.toISOString(),
            }))}
          />
        ) : null}

        <section className="panel p-5">
          <h2 className="mb-3 text-sm font-semibold">New workspace</h2>
          <form action={createWorkspace} className="flex gap-2">
            <input
              name="name"
              placeholder="Workspace name"
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
