import "dotenv/config";
import { asc, eq } from "drizzle-orm";
import { db, sql } from "./index";
import {
  boardProperties,
  boards,
  cardAssignees,
  cardValues,
  cards,
  users,
  views,
  workspaceMembers,
  workspaces,
  type PropertyOption,
} from "./schema";
import { fromDateOnly, toDateOnly } from "../lib/dates";
import { ids } from "../lib/ids";
import { POSITION_STEP } from "../lib/positions";

/**
 * Fills the oldest account's first workspace with a board that has something on
 * it. Useful for looking at the views with real content before there is any.
 * Safe to skip entirely; nothing else depends on it.
 */
async function main() {
  const [user] = await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);
  if (!user) {
    console.log("No users yet. Sign up first, then run this again.");
    await sql.end();
    return;
  }

  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, user.id))
    .limit(1);
  if (!membership) {
    console.log("That user has no workspace yet.");
    await sql.end();
    return;
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, membership.workspaceId))
    .limit(1);

  const boardId = ids.board();
  const statusId = ids.property();
  const areaId = ids.property();

  const status: PropertyOption[] = [
    { id: ids.option(), name: "Backlog", color: "slate" },
    { id: ids.option(), name: "In progress", color: "sky" },
    { id: ids.option(), name: "In review", color: "amber" },
    { id: ids.option(), name: "Done", color: "emerald" },
  ];
  const area: PropertyOption[] = [
    { id: ids.option(), name: "Product", color: "violet" },
    { id: ids.option(), name: "Infra", color: "teal" },
    { id: ids.option(), name: "Go to market", color: "rose" },
  ];

  await db.insert(boards).values({
    id: boardId,
    workspaceId: membership.workspaceId,
    title: "Roadmap",
    createdBy: user.id,
    position: POSITION_STEP,
  });

  await db.insert(boardProperties).values([
    {
      id: statusId,
      boardId,
      name: "Status",
      type: "select",
      options: status,
      position: POSITION_STEP,
    },
    {
      id: areaId,
      boardId,
      name: "Area",
      type: "select",
      options: area,
      position: POSITION_STEP * 2,
    },
  ]);

  await db.insert(views).values(
    (["board", "table", "calendar", "gallery"] as const).map((type, index) => ({
      id: ids.view(),
      boardId,
      name: type.charAt(0).toUpperCase() + type.slice(1),
      type,
      groupByPropertyId: statusId,
      // The board groups by Status already, so repeating it on every card is
      // noise. The other views have no columns to carry it.
      visibleProperties: type === "board" ? [areaId] : [statusId, areaId],
      position: POSITION_STEP * (index + 1),
    })),
  );

  /**
   * Content shaped like a real board rather than "Task 1, Task 2": enough
   * spread across statuses, dates and owners that the calendar and gallery
   * views have something to show. The screenshots in the README are this seed.
   */
  type Sample = {
    title: string;
    status: number;
    area: number;
    /** Days from today, or null for an undated card. */
    due: number | null;
    notes?: string;
    assign?: "first" | "second" | "both";
  };

  const samples: Sample[] = [
    {
      title: "Decide the pricing model",
      status: 0,
      area: 2,
      due: 6,
      notes:
        "Per-seat pricing is what pushed us off every hosted option. Whatever we land on should not do the same thing to someone else.",
      assign: "both",
    },
    {
      title: "Ship the invite flow",
      status: 3,
      area: 0,
      due: -2,
      assign: "first",
    },
    {
      title: "Wire up Google Calendar sync",
      status: 1,
      area: 0,
      due: 1,
      notes: "Two-way. Moving the event in Google should move the card.",
      assign: "first",
    },
    {
      title: "Draft the launch post",
      status: 0,
      area: 2,
      due: 12,
      notes: "Lead with the calendar view; that is the part nobody else has.",
      assign: "second",
    },
    {
      title: "Move Postgres to a managed host",
      status: 1,
      area: 1,
      due: 4,
      assign: "second",
    },
    {
      title: "Rate limit the auth endpoints",
      status: 3,
      area: 1,
      due: -1,
      assign: "first",
    },
    {
      title: "Weekly founder sync",
      status: 2,
      area: 2,
      due: 2,
      notes: "Standing item: what is blocked on the other person.",
      assign: "both",
    },
    {
      title: "Keyboard support for drag and drop",
      status: 0,
      area: 0,
      due: null,
      notes: "The core interaction should not require a mouse.",
    },
    {
      title: "Write the contributing guide",
      status: 0,
      area: 0,
      due: 9,
      assign: "second",
    },
    {
      title: "Pick the stack",
      status: 3,
      area: 1,
      due: -12,
      assign: "both",
    },
    {
      title: "Schema for boards, cards and properties",
      status: 3,
      area: 0,
      due: -9,
      assign: "second",
    },
    {
      title: "Realtime updates over SSE",
      status: 3,
      area: 0,
      due: -6,
      notes: "Postgres LISTEN/NOTIFY, so two server processes stay in step.",
      assign: "first",
    },
    {
      title: "Screenshots for the README",
      status: 1,
      area: 2,
      due: 0,
      notes: "Four views is the whole pitch and it is currently ASCII art.",
      assign: "first",
    },
  ];

  const members = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, membership.workspaceId));

  const first = user.id;
  const second = members.find((m) => m.userId !== user.id)?.userId ?? user.id;

  for (const [index, sample] of samples.entries()) {
    const cardId = ids.card();
    await db.insert(cards).values({
      id: cardId,
      boardId,
      title: sample.title,
      description: sample.notes ?? null,
      position: POSITION_STEP * (index + 1),
      // Date-only values live at UTC midnight; see lib/dates.ts.
      dueAt:
        sample.due === null
          ? null
          : fromDateOnly(
              toDateOnly(new Date(Date.now() + sample.due * 86_400_000)),
            ),
      createdBy: user.id,
    });
    await db.insert(cardValues).values([
      { cardId, propertyId: statusId, value: status[sample.status].id },
      { cardId, propertyId: areaId, value: area[sample.area].id },
    ]);

    const assignees =
      sample.assign === "both"
        ? [first, second]
        : sample.assign === "second"
          ? [second]
          : sample.assign === "first"
            ? [first]
            : [];
    const unique = [...new Set(assignees)];
    if (unique.length > 0) {
      await db
        .insert(cardAssignees)
        .values(unique.map((userId) => ({ cardId, userId })))
        .onConflictDoNothing();
    }
  }

  console.log(
    `Seeded a "Roadmap" board in ${workspace?.name ?? "your workspace"}.`,
  );
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
