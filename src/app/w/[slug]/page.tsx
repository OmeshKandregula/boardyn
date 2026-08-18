import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { formatDistanceToNow } from "date-fns";
import { createBoard } from "@/app/actions/boards";
import { AppShell } from "@/components/AppShell";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { requireWorkspaceMember } from "@/lib/access";
import {
  getBoardsForWorkspace,
  getUpcomingForUser,
  getWorkspaceMembers,
  getWorkspacesForUser,
} from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({
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

  try {
    await requireWorkspaceMember(workspace.id);
  } catch {
    notFound();
  }

  const [boards, members, allWorkspaces, upcoming] = await Promise.all([
    getBoardsForWorkspace(workspace.id),
    getWorkspaceMembers(workspace.id),
    getWorkspacesForUser(user.id),
    getUpcomingForUser(user.id),
  ]);

  return (
    <AppShell
      user={user}
      workspaces={allWorkspaces}
      activeWorkspaceSlug={slug}
      members={members}
    >
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {workspace.name}
            </h1>
            <p className="mt-1 text-sm text-[color:var(--color-ink-muted)]">
              {boards.length} board{boards.length === 1 ? "" : "s"} ·{" "}
              {members.length} member{members.length === 1 ? "" : "s"}
            </p>
          </div>

          <form action={createBoard} className="flex items-center gap-2">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <input
              name="title"
              placeholder="New board name"
              className="field w-56"
              required
            />
            <button type="submit" className="btn-primary">
              Create
            </button>
          </form>
        </header>

        {boards.length === 0 ? (
          <div className="panel p-10 text-center">
            <p className="text-sm text-[color:var(--color-ink-muted)]">
              No boards yet. Name one above and it arrives with a Status column,
              a Priority column, and board, table, calendar and gallery views.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((board) => (
              <li key={board.id}>
                <Link
                  href={`/b/${board.id}`}
                  className="panel block h-full p-4 transition-colors hover:border-indigo-500/40 hover:bg-[color:var(--color-surface-raised)]"
                >
                  <h2 className="font-medium">{board.title}</h2>
                  <p className="mt-2 text-xs text-[color:var(--color-ink-faint)]">
                    Updated{" "}
                    {formatDistanceToNow(board.updatedAt, { addSuffix: true })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {upcoming.length > 0 ? (
          <section className="mt-10">
            <h2 className="mb-3 text-sm font-semibold text-[color:var(--color-ink-muted)]">
              Assigned to you
            </h2>
            <ul className="panel divide-y divide-[color:var(--color-line)]">
              {upcoming.map((card) => (
                <li key={card.id}>
                  <Link
                    href={`/b/${card.boardId}?card=${card.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-white/5"
                  >
                    <span className="truncate">{card.title}</span>
                    <span className="shrink-0 text-xs text-[color:var(--color-ink-faint)]">
                      {card.boardTitle}
                      {card.dueAt
                        ? ` · due ${formatDistanceToNow(card.dueAt, {
                            addSuffix: true,
                          })}`
                        : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
