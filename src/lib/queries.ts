import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
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
  meetingActionItems,
  meetings,
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

/* ---------------------------------------------------------------- meetings */

export type MeetingSummary = {
  id: string;
  title: string;
  startedAt: string | null;
  attendees: { name: string | null; email: string | null }[];
  ownerId: string;
  ownerName: string;
  sharedWithWorkspace: boolean;
  openActionItems: number;
};

/**
 * Meetings this person may see: their own, plus whatever the workspace shares.
 * The visibility rule lives in one `or` rather than being spread across the
 * page, because getting it wrong publishes somebody's private notes.
 */
export async function getMeetingsForUser(
  workspaceId: string,
  userId: string,
): Promise<MeetingSummary[]> {
  const rows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      startedAt: meetings.startedAt,
      attendees: meetings.attendees,
      ownerId: meetings.ownerId,
      ownerName: users.name,
      sharedWithWorkspace: meetings.sharedWithWorkspace,
    })
    .from(meetings)
    .innerJoin(users, eq(users.id, meetings.ownerId))
    .where(
      and(
        eq(meetings.workspaceId, workspaceId),
        or(eq(meetings.sharedWithWorkspace, true), eq(meetings.ownerId, userId)),
      ),
    )
    .orderBy(desc(meetings.startedAt))
    .limit(200);

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      meetingId: meetingActionItems.meetingId,
      status: meetingActionItems.status,
    })
    .from(meetingActionItems)
    .where(
      inArray(
        meetingActionItems.meetingId,
        rows.map((row) => row.id),
      ),
    );

  const open = new Map<string, number>();
  for (const item of counts) {
    if (item.status !== "suggested") continue;
    open.set(item.meetingId, (open.get(item.meetingId) ?? 0) + 1);
  }

  return rows.map((row) => ({
    ...row,
    startedAt: row.startedAt?.toISOString() ?? null,
    openActionItems: open.get(row.id) ?? 0,
  }));
}

export type MeetingDetail = {
  id: string;
  title: string;
  startedAt: string | null;
  endedAt: string | null;
  attendees: { name: string | null; email: string | null }[];
  summary: string | null;
  transcript: string | null;
  webUrl: string | null;
  ownerId: string;
  ownerName: string;
  sharedWithWorkspace: boolean;
  actionItems: {
    id: string;
    text: string;
    status: string;
    cardId: string | null;
    boardId: string | null;
  }[];
};

export async function getMeetingDetail(
  meetingId: string,
  userId: string,
): Promise<MeetingDetail | null> {
  const [row] = await db
    .select({ meeting: meetings, ownerName: users.name })
    .from(meetings)
    .innerJoin(users, eq(users.id, meetings.ownerId))
    .where(eq(meetings.id, meetingId))
    .limit(1);
  if (!row) return null;

  // Same visibility rule as the list. A private note is not readable by URL
  // just because somebody guessed the id.
  const { meeting } = row;
  if (!meeting.sharedWithWorkspace && meeting.ownerId !== userId) return null;

  const membership = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, meeting.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  if (membership.length === 0) return null;

  const items = await db
    .select({
      id: meetingActionItems.id,
      text: meetingActionItems.text,
      status: meetingActionItems.status,
      cardId: meetingActionItems.cardId,
      boardId: cards.boardId,
    })
    .from(meetingActionItems)
    .leftJoin(cards, eq(cards.id, meetingActionItems.cardId))
    .where(eq(meetingActionItems.meetingId, meetingId))
    .orderBy(asc(meetingActionItems.ordinal), asc(meetingActionItems.createdAt));

  return {
    id: meeting.id,
    title: meeting.title,
    startedAt: meeting.startedAt?.toISOString() ?? null,
    endedAt: meeting.endedAt?.toISOString() ?? null,
    attendees: meeting.attendees,
    summary: meeting.summary,
    transcript: meeting.transcript,
    webUrl: meeting.webUrl,
    ownerId: meeting.ownerId,
    ownerName: row.ownerName,
    sharedWithWorkspace: meeting.sharedWithWorkspace,
    actionItems: items,
  };
}
