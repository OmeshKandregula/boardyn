import "dotenv/config";
import { asc, eq } from "drizzle-orm";
import { db, sql } from "./index";
import {
  boardProperties,
  boards,
  cardValues,
  cards,
  users,
  views,
  workspaceMembers,
  workspaces,
  type PropertyOption,
} from "./schema";
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
      visibleProperties: [statusId, areaId],
      position: POSITION_STEP * (index + 1),
    })),
  );

  const samples: [string, number, number, number | null][] = [
    ["Decide the pricing model", 0, 2, 3],
    ["Ship invite flow", 1, 0, 1],
    ["Wire Google Calendar sync", 1, 1, 2],
    ["Draft the launch post", 0, 2, 9],
    ["Move Postgres to a managed host", 2, 1, 5],
    ["Weekly founder sync notes", 3, 0, -2],
  ];

  for (const [index, [title, statusIndex, areaIndex, dueInDays]] of samples.entries()) {
    const cardId = ids.card();
    await db.insert(cards).values({
      id: cardId,
      boardId,
      title,
      position: POSITION_STEP * (index + 1),
      dueAt:
        dueInDays === null
          ? null
          : new Date(Date.now() + dueInDays * 86_400_000),
      createdBy: user.id,
    });
    await db.insert(cardValues).values([
      { cardId, propertyId: statusId, value: status[statusIndex].id },
      { cardId, propertyId: areaId, value: area[areaIndex].id },
    ]);
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
