import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/app/actions/auth";
import { AuthForm } from "@/components/AuthForm";
import { Wordmark } from "@/components/Wordmark";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");
  const { invite } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <Wordmark />
      <div className="panel p-6">
        <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
        <p className="mb-6 text-sm text-[color:var(--color-ink-muted)]">
          Welcome back.
        </p>
        <AuthForm mode="signin" action={signIn} inviteToken={invite} />
      </div>
      <p className="text-center text-sm text-[color:var(--color-ink-muted)]">
        No account yet?{" "}
        <Link
          href={invite ? `/signup?invite=${invite}` : "/signup"}
          className="text-[color:var(--color-ink)] underline underline-offset-4"
        >
          Create one
        </Link>
      </p>
    </main>
  );
}
