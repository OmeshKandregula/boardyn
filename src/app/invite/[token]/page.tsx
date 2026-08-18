import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaceInvites, workspaceMembers, workspaces } from "@/db/schema";
import { Wordmark } from "@/components/Wordmark";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The landing point for an invite link. A signed-out visitor is sent to signup
 * with the token attached; a signed-in one joins on the spot, provided the
 * invite was addressed to the account they are actually using.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [invite] = await db
    .select({
      id: workspaceInvites.id,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      acceptedAt: workspaceInvites.acceptedAt,
      expiresAt: workspaceInvites.expiresAt,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .where(eq(workspaceInvites.token, token))
    .limit(1);

  const user = await getCurrentUser();

  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return (
      <Notice
        title="This invite is no longer valid"
        body="It was already used, revoked, or has expired. Ask for a fresh link."
      />
    );
  }

  if (!user) redirect(`/signup?invite=${token}`);

  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Notice
        title="This invite is for a different account"
        body={`It was sent to ${invite.email}, but you are signed in as ${user.email}. Sign out and try again.`}
      />
    );
  }

  await db
    .insert(workspaceMembers)
    .values({
      workspaceId: invite.workspaceId,
      userId: user.id,
      role: invite.role,
    })
    .onConflictDoNothing();

  await db
    .update(workspaceInvites)
    .set({ acceptedAt: new Date() })
    .where(eq(workspaceInvites.id, invite.id));

  redirect(`/w/${invite.workspaceSlug}`);
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 text-center">
      <div className="flex justify-center">
        <Wordmark />
      </div>
      <div className="panel p-6">
        <h1 className="mb-2 text-lg font-semibold">{title}</h1>
        <p className="text-sm text-[color:var(--color-ink-muted)]">{body}</p>
      </div>
    </main>
  );
}
