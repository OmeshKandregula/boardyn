import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { MembersPanel } from "@/components/settings/MembersPanel";
import { db } from "@/db";
import { workspaceInvites, workspaces } from "@/db/schema";
import { requireWorkspaceMember } from "@/lib/access";
import { getWorkspaceMembers, getWorkspacesForUser } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Workspace-level settings, scoped by the slug in the URL. Which workspace is
 * being edited is now unambiguous to both the code and the person reading the
 * page, which is the whole point of the move.
 */
export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (!workspace) notFound();

  let role: string;
  try {
    ({ role } = await requireWorkspaceMember(workspace.id));
  } catch {
    notFound();
  }

  const [members, invites, allWorkspaces] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    db
      .select()
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspace.id),
          isNull(workspaceInvites.acceptedAt),
        ),
      ),
    getWorkspacesForUser(user.id),
  ]);

  return (
    <AppShell
      user={user}
      workspaces={allWorkspaces}
      activeWorkspaceSlug={slug}
      members={members}
    >
      <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-10">
        <div>
          <Link
            href={`/w/${slug}`}
            className="text-xs text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)]"
          >
            ← {workspace.name}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Workspace settings
          </h1>
        </div>

        <MembersPanel
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          currentUserId={user.id}
          isOwner={role === "owner"}
          members={members}
          invites={invites.map((invite) => ({
            id: invite.id,
            email: invite.email,
            token: invite.token,
            expiresAt: invite.expiresAt.toISOString(),
          }))}
        />
      </div>
    </AppShell>
  );
}
