"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaceInvites, workspaceMembers, workspaces } from "@/db/schema";
import { requireWorkspaceMember } from "@/lib/access";
import { ids, newToken, slugify } from "@/lib/ids";
import { requireUser } from "@/lib/session";

const INVITE_TTL_DAYS = 14;

export async function createWorkspace(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim() || "New workspace";

  const workspaceId = ids.workspace();
  const slug = await uniqueSlug(slugify(name));

  await db.transaction(async (tx) => {
    await tx
      .insert(workspaces)
      .values({ id: workspaceId, name, slug, createdBy: user.id });
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId, userId: user.id, role: "owner" });
  });

  redirect(`/w/${slug}`);
}

/**
 * Returns a link rather than sending mail. A self-hosted instance has no SMTP
 * credentials on first run, and a two-person team can paste a URL into a chat
 * faster than either of us can configure a mail provider.
 */
export async function inviteMember(
  workspaceId: string,
  email: string,
): Promise<{ url?: string; error?: string }> {
  const { user, role } = await requireWorkspaceMember(workspaceId);
  if (role !== "owner") return { error: "Only owners can invite" };

  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return { error: "Enter a valid email address" };
  }

  const token = newToken();
  await db.insert(workspaceInvites).values({
    id: ids.invite(),
    workspaceId,
    email: clean,
    role: "member",
    token,
    invitedBy: user.id,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
  });

  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  revalidatePath("/settings");
  return { url: `${base}/invite/${token}` };
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const [invite] = await db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.id, inviteId))
    .limit(1);
  if (!invite) return;

  const { role } = await requireWorkspaceMember(invite.workspaceId);
  if (role !== "owner") return;

  await db.delete(workspaceInvites).where(eq(workspaceInvites.id, inviteId));
  revalidatePath("/settings");
}

export async function removeMember(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { user, role } = await requireWorkspaceMember(workspaceId);
  if (role !== "owner" || user.id === userId) return;

  await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    );
  revalidatePath("/settings");
}

async function uniqueSlug(base: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
}
