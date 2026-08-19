import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  boardProperties,
  boards,
  cardAssignees,
  cardValues,
  cards,
  comments,
  externalEvents,
  googleAccounts,
  users,
  views,
  workspaceMembers,
  workspaces,
  type BoardProperty,
  type View,
} from "@/db/schema";

export type Member = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  role: string;
  /** Whether this person has connected a Google Calendar to this instance. */
  hasCalendar: boolean;
};

export type CardData = {
  id: string;
  boardId: string;
  title: string;
  description: string | null;
  position: number;
  startAt: string | null;
  dueAt: string | null;
  allDay: boolean;
  createdAt: string;
  assignees: string[];
  values: Record<string, unknown>;
  commentCount: number;
};

export type ExternalEventData = {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerColor: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  htmlLink: string | null;
};

export type BoardBundle = {
  board: typeof boards.$inferSelect;
  properties: BoardProperty[];
  views: View[];
  cards: CardData[];
  members: Member[];
  externalEvents: ExternalEventData[];
};

export async function getWorkspacesForUser(userId: string) {
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .orderBy(asc(workspaces.createdAt));
}

export async function getBoardsForWorkspace(workspaceId: string) {
  return db
    .select()
    .from(boards)
    .where(and(eq(boards.workspaceId, workspaceId), isNull(boards.archivedAt)))
    .orderBy(asc(boards.position), asc(boards.createdAt));
}

export async function getWorkspaceMembers(
  workspaceId: string,
): Promise<Member[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarColor: users.avatarColor,
      role: workspaceMembers.role,
      googleAccountId: googleAccounts.id,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    // Left join: a member without a connected calendar is still a member, and
    // the calendar legend needs to say so rather than omitting them.
    .leftJoin(googleAccounts, eq(googleAccounts.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(users.name));

  return rows.map(({ googleAccountId, ...member }) => ({
    ...member,
    hasCalendar: googleAccountId != null,
  }));
}

/**
 * Everything one board page needs, in five queries rather than one per card.
 * The page is a server component, so this runs once per navigation and again
 * whenever a realtime event triggers a refresh.
 */
export async function getBoardBundle(
  boardId: string,
  options: { calendarFrom?: Date; calendarTo?: Date } = {},
): Promise<BoardBundle | null> {
  const [board] = await db
    .select()
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1);
  if (!board) return null;

  const [props, boardViews, cardRows, members] = await Promise.all([
    db
      .select()
      .from(boardProperties)
      .where(eq(boardProperties.boardId, boardId))
      .orderBy(asc(boardProperties.position)),
    db
      .select()
      .from(views)
      .where(eq(views.boardId, boardId))
      .orderBy(asc(views.position)),
    db
      .select()
      .from(cards)
      .where(and(eq(cards.boardId, boardId), isNull(cards.archivedAt)))
      .orderBy(asc(cards.position)),
    getWorkspaceMembers(board.workspaceId),
  ]);

  const cardIds = cardRows.map((c) => c.id);

  const [valueRows, assigneeRows, commentRows] = cardIds.length
    ? await Promise.all([
        db.select().from(cardValues).where(inArray(cardValues.cardId, cardIds)),
        db
          .select()
          .from(cardAssignees)
          .where(inArray(cardAssignees.cardId, cardIds)),
        db
          .select({ cardId: comments.cardId })
          .from(comments)
          .where(inArray(comments.cardId, cardIds)),
      ])
    : [[], [], []];

  const valuesByCard = new Map<string, Record<string, unknown>>();
  for (const row of valueRows) {
    const bag = valuesByCard.get(row.cardId) ?? {};
    bag[row.propertyId] = row.value;
    valuesByCard.set(row.cardId, bag);
  }

  const assigneesByCard = new Map<string, string[]>();
  for (const row of assigneeRows) {
    const list = assigneesByCard.get(row.cardId) ?? [];
    list.push(row.userId);
    assigneesByCard.set(row.cardId, list);
  }

  const commentCounts = new Map<string, number>();
  for (const row of commentRows) {
    commentCounts.set(row.cardId, (commentCounts.get(row.cardId) ?? 0) + 1);
  }

  const cardData: CardData[] = cardRows.map((card) => ({
    id: card.id,
    boardId: card.boardId,
    title: card.title,
    description: card.description,
    position: card.position,
    startAt: card.startAt?.toISOString() ?? null,
    dueAt: card.dueAt?.toISOString() ?? null,
    allDay: card.allDay,
    createdAt: card.createdAt.toISOString(),
    assignees: assigneesByCard.get(card.id) ?? [],
    values: valuesByCard.get(card.id) ?? {},
    commentCount: commentCounts.get(card.id) ?? 0,
  }));

  return {
    board,
    properties: props,
    views: boardViews,
    cards: cardData,
    members,
    externalEvents: await getExternalEvents(
      board.workspaceId,
      options.calendarFrom,
      options.calendarTo,
    ),
  };
}

/**
 * Connected calendars belonging to anyone in the workspace, windowed to what
 * the calendar view can actually show. Without the window this grows without
 * bound the longer the instance runs.
 */
export async function getExternalEvents(
  workspaceId: string,
  from?: Date,
  to?: Date,
): Promise<ExternalEventData[]> {
  if (!from || !to) return [];

  const rows = await db
    .select({
      id: externalEvents.id,
      title: externalEvents.title,
      startAt: externalEvents.startAt,
      endAt: externalEvents.endAt,
      allDay: externalEvents.allDay,
      htmlLink: externalEvents.htmlLink,
      ownerId: users.id,
      ownerName: users.name,
      ownerColor: users.avatarColor,
    })
    .from(externalEvents)
    .innerJoin(
      googleAccounts,
      eq(googleAccounts.id, externalEvents.googleAccountId),
    )
    .innerJoin(users, eq(users.id, googleAccounts.userId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.userId, users.id),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .where(
      and(
        eq(externalEvents.status, "confirmed"),
        lte(externalEvents.startAt, to),
        gte(externalEvents.endAt, from),
      ),
    )
    .orderBy(asc(externalEvents.startAt));

  return rows.map((row) => ({
    id: row.id,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    ownerColor: row.ownerColor,
    title: row.title,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    allDay: row.allDay,
    htmlLink: row.htmlLink,
  }));
}

/**
 * Archived cards, newest first. Archiving is the destructive path in this app,
 * so there has to be somewhere to see what went into it and pull it back out.
 */
export async function getArchivedCards(boardId: string) {
  const rows = await db
    .select({
      id: cards.id,
      title: cards.title,
      archivedAt: cards.archivedAt,
      dueAt: cards.dueAt,
    })
    .from(cards)
    .where(and(eq(cards.boardId, boardId), isNotNull(cards.archivedAt)))
    .orderBy(desc(cards.archivedAt))
    .limit(100);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    archivedAt: row.archivedAt!.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
  }));
}

export async function getCardDetail(cardId: string) {
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) return null;

  const [commentRows, assigneeRows, valueRows, activityRows] = await Promise.all([
    db
      .select({
        id: comments.id,
        body: comments.body,
        createdAt: comments.createdAt,
        authorId: users.id,
        authorName: users.name,
        authorColor: users.avatarColor,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(eq(comments.cardId, cardId))
      .orderBy(asc(comments.createdAt)),
    db.select().from(cardAssignees).where(eq(cardAssignees.cardId, cardId)),
    db.select().from(cardValues).where(eq(cardValues.cardId, cardId)),
    db
      .select()
      .from(activity)
      .where(eq(activity.cardId, cardId))
      .orderBy(desc(activity.createdAt))
      .limit(20),
  ]);

  return {
    card,
    comments: commentRows.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
    assignees: assigneeRows.map((a) => a.userId),
    values: Object.fromEntries(valueRows.map((v) => [v.propertyId, v.value])),
    activity: activityRows.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

/**
 * Your dated cards around now: a week ahead, and a week back so something you
 * missed does not silently drop off the list. Undated cards are deliberately
 * absent; this rail answers "what is coming up", not "what do I own".
 */
export async function getUpcomingForUser(userId: string, days = 7) {
  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  return db
    .select({
      id: cards.id,
      title: cards.title,
      dueAt: cards.dueAt,
      boardId: cards.boardId,
      boardTitle: boards.title,
    })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(cardAssignees, eq(cardAssignees.cardId, cards.id))
    .where(
      and(
        eq(cardAssignees.userId, userId),
        isNull(cards.archivedAt),
        lte(cards.dueAt, until),
        gte(cards.dueAt, since),
      ),
    )
    .orderBy(asc(cards.dueAt))
    .limit(50);
}
