import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BoardApp } from "@/components/board/BoardApp";
import { requireBoardAccess } from "@/lib/access";
import { getBoardBundle, getWorkspacesForUser } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** How much of the calendar the page ships to the client in one go. */
const CALENDAR_PAST_DAYS = 45;
const CALENDAR_FUTURE_DAYS = 120;

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<{ view?: string; card?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { boardId } = await params;
  try {
    await requireBoardAccess(boardId);
  } catch {
    notFound();
  }

  const now = Date.now();
  const bundle = await getBoardBundle(boardId, {
    calendarFrom: new Date(now - CALENDAR_PAST_DAYS * 86_400_000),
    calendarTo: new Date(now + CALENDAR_FUTURE_DAYS * 86_400_000),
  });
  if (!bundle) notFound();

  const [workspaces, query] = await Promise.all([
    getWorkspacesForUser(user.id),
    searchParams,
  ]);

  return (
    <AppShell
      user={user}
      workspaces={workspaces}
      activeWorkspaceSlug={
        workspaces.find((w) => w.id === bundle.board.workspaceId)?.slug
      }
      members={bundle.members}
    >
      <BoardApp
        bundle={bundle}
        currentUserId={user.id}
        initialViewId={query.view}
        initialCardId={query.card}
      />
    </AppShell>
  );
}
