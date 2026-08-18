import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { boards, workspaceMembers, type Board, type User } from "@/db/schema";
import { requireUser } from "./session";

export class AccessError extends Error {
  constructor(message = "NOT_FOUND") {
    super(message);
    this.name = "AccessError";
  }
}

/**
 * Membership is checked at the workspace, not the board. A two-person company
 * does not want per-board ACLs, and adding them later is additive: this is the
 * single function every read and write funnels through.
 */
export async function requireWorkspaceMember(
  workspaceId: string,
): Promise<{ user: User; role: string }> {
  const user = await requireUser();
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .limit(1);

  if (!membership) throw new AccessError();
  return { user, role: membership.role };
}

export async function requireBoardAccess(
  boardId: string,
): Promise<{ user: User; board: Board; role: string }> {
  const user = await requireUser();
  const [row] = await db
    .select({ board: boards, role: workspaceMembers.role })
    .from(boards)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, boards.workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(eq(boards.id, boardId))
    .limit(1);

  if (!row) throw new AccessError();
  return { user, board: row.board, role: row.role };
}

/** Same check, starting from a card. */
export async function requireCardAccess(cardId: string) {
  const { cards } = await import("@/db/schema");
  const [row] = await db
    .select({ boardId: cards.boardId })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);

  if (!row) throw new AccessError();
  const access = await requireBoardAccess(row.boardId);
  return { ...access, cardId };
}
