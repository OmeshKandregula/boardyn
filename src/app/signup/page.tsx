import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { signUp } from "@/app/actions/auth";
import { AuthForm } from "@/components/AuthForm";
import { Wordmark } from "@/components/Wordmark";
import { db } from "@/db";
import { workspaceInvites, workspaces } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");
  const { invite } = await searchParams;

  const invitation = invite ? await loadInvite(invite) : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <Wordmark />
      <div className="panel p-6">
        <h1 className="mb-1 text-lg font-semibold">
          {invitation ? `Join ${invitation.workspaceName}` : "Create your account"}
        </h1>
        <p className="mb-6 text-sm text-[color:var(--color-ink-muted)]">
          {invitation
            ? `Invited as ${invitation.email}.`
            : "You will get a workspace of your own to start from."}
        </p>
        <AuthForm
          mode="signup"
          action={signUp}
          inviteToken={invitation ? invite : undefined}
          invitedEmail={invitation?.email}
        />
      </div>
      <p className="text-center text-sm text-[color:var(--color-ink-muted)]">
        Already have an account?{" "}
        <Link
          href={invite ? `/login?invite=${invite}` : "/login"}
          className="text-[color:var(--color-ink)] underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}

async function loadInvite(token: string) {
  const [row] = await db
    .select({
      email: workspaceInvites.email,
      acceptedAt: workspaceInvites.acceptedAt,
      expiresAt: workspaceInvites.expiresAt,
      workspaceName: workspaces.name,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .where(eq(workspaceInvites.token, token))
    .limit(1);

  if (!row || row.acceptedAt || row.expiresAt < new Date()) return null;
  return row;
}
