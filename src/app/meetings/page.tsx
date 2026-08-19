import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { MeetingsApp } from "@/components/meetings/MeetingsApp";
import { db } from "@/db";
import { granolaAccounts } from "@/db/schema";
import {
  getBoardsForWorkspace,
  getMeetingDetail,
  getMeetingsForUser,
  getWorkspaceMembers,
  getWorkspacesForUser,
} from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; meeting?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const query = await searchParams;
  const workspaces = await getWorkspacesForUser(user.id);
  if (workspaces.length === 0) redirect("/settings");

  const workspace =
    workspaces.find((candidate) => candidate.slug === query.workspace) ??
    workspaces[0];

  const [meetings, boards, members, account] = await Promise.all([
    getMeetingsForUser(workspace.id, user.id),
    getBoardsForWorkspace(workspace.id),
    getWorkspaceMembers(workspace.id),
    db
      .select({ id: granolaAccounts.id })
      .from(granolaAccounts)
      .where(eq(granolaAccounts.userId, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  // Selecting a meeting is a URL, not client state, so a link to one opens the
  // same thing for whoever it is sent to.
  const selectedId = query.meeting ?? meetings[0]?.id ?? null;
  const detail = selectedId ? await getMeetingDetail(selectedId, user.id) : null;

  return (
    <AppShell
      user={user}
      workspaces={workspaces}
      activeWorkspaceSlug={workspace.slug}
      members={members}
    >
      <MeetingsApp
        meetings={meetings}
        detail={detail}
        boards={boards.map((board) => ({ id: board.id, title: board.title }))}
        currentUserId={user.id}
        workspaceSlug={workspace.slug}
        connected={account !== null}
        // On a phone the list and the note cannot share a screen, so one or
        // the other is shown. Whether a meeting was actually asked for, rather
        // than defaulted to, is what decides which.
        explicitSelection={Boolean(query.meeting)}
      />
    </AppShell>
  );
}
