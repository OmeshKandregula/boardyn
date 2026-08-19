import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { Avatar } from "@/components/Avatar";
import { Wordmark } from "@/components/Wordmark";
import type { Member } from "@/lib/queries";
import type { User } from "@/db/schema";

/**
 * A single top bar rather than a sidebar. Two people with a handful of boards
 * do not need permanent navigation chrome eating 240px of board width.
 */
export function AppShell({
  user,
  workspaces,
  activeWorkspaceSlug,
  members,
  children,
}: {
  user: User;
  workspaces: { id: string; name: string; slug: string; role: string }[];
  activeWorkspaceSlug?: string;
  members?: Member[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b border-[color:var(--color-line)] bg-[color:var(--color-canvas)]/95 px-4 backdrop-blur">
        <Link href="/" aria-label="Boardyn home">
          <Wordmark />
        </Link>

        {workspaces.length > 0 ? (
          <nav className="hidden items-center gap-1 sm:flex">
            {workspaces.map((workspace) => (
              <Link
                key={workspace.id}
                href={`/w/${workspace.slug}`}
                className={`rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                  workspace.slug === activeWorkspaceSlug
                    ? "bg-white/10 text-[color:var(--color-ink)]"
                    : "text-[color:var(--color-ink-muted)] hover:bg-white/5"
                }`}
              >
                {workspace.name}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="ml-auto flex items-center gap-3">
          {members && members.length > 1 ? (
            <div className="hidden -space-x-1.5 sm:flex">
              {members.slice(0, 5).map((member) => (
                <Avatar
                  key={member.id}
                  name={member.name}
                  color={member.avatarColor}
                  size="sm"
                  title={`${member.name} (${member.email})`}
                />
              ))}
            </div>
          ) : null}

          <Link href="/meetings" className="btn-ghost px-2 py-1.5 text-sm">
            Meetings
          </Link>

          <Link href="/settings" className="btn-ghost px-2 py-1.5 text-sm">
            Settings
          </Link>

          <form action={signOut}>
            <button className="btn-ghost px-2 py-1.5 text-sm" type="submit">
              Sign out
            </button>
          </form>

          <Avatar name={user.name} color={user.avatarColor} title={user.email} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
