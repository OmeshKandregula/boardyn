"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  boardProperties,
  boards,
  views,
  workspaces,
  type PropertyOption,
} from "@/db/schema";
import { requireBoardAccess, requireWorkspaceMember } from "@/lib/access";
import { COLORS, PROPERTY_TYPES, VIEW_TYPES } from "@/lib/constants";
import { ids } from "@/lib/ids";
import { POSITION_STEP } from "@/lib/positions";
import { publish } from "@/lib/realtime";

/**
 * A new board arrives with a Status property, three columns and one view of
 * each type. An empty board with no schema is a dead end: there is nothing to
 * group by, so the kanban cannot render.
 */
export async function createBoard(formData: FormData): Promise<void> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const title = String(formData.get("title") ?? "").trim() || "Untitled board";
  const { user } = await requireWorkspaceMember(workspaceId);

  const boardId = ids.board();
  const statusId = ids.property();

  const statusOptions: PropertyOption[] = [
    { id: ids.option(), name: "Backlog", color: "slate" },
    { id: ids.option(), name: "In progress", color: "sky" },
    { id: ids.option(), name: "In review", color: "amber" },
    { id: ids.option(), name: "Done", color: "emerald" },
  ];

  const priorityId = ids.property();
  const priorityOptions: PropertyOption[] = [
    { id: ids.option(), name: "Now", color: "rose" },
    { id: ids.option(), name: "Next", color: "amber" },
    { id: ids.option(), name: "Later", color: "slate" },
  ];

  await db.transaction(async (tx) => {
    await tx.insert(boards).values({
      id: boardId,
      workspaceId,
      title,
      createdBy: user.id,
      position: Date.now(),
    });

    await tx.insert(boardProperties).values([
      {
        id: statusId,
        boardId,
        name: "Status",
        type: "select",
        options: statusOptions,
        // The default board has an obvious terminal column; boards that grow
        // their own workflow can point this wherever it belongs.
        doneOptionId: statusOptions.at(-1)!.id,
        position: POSITION_STEP,
      },
      {
        id: priorityId,
        boardId,
        name: "Priority",
        type: "select",
        options: priorityOptions,
        position: POSITION_STEP * 2,
      },
    ]);

    await tx.insert(views).values([
      {
        id: ids.view(),
        boardId,
        name: "Board",
        type: "board",
        groupByPropertyId: statusId,
        visibleProperties: [priorityId],
        position: POSITION_STEP,
      },
      {
        id: ids.view(),
        boardId,
        name: "Table",
        type: "table",
        groupByPropertyId: statusId,
        visibleProperties: [statusId, priorityId],
        position: POSITION_STEP * 2,
      },
      {
        id: ids.view(),
        boardId,
        name: "Calendar",
        type: "calendar",
        groupByPropertyId: statusId,
        visibleProperties: [statusId],
        position: POSITION_STEP * 3,
      },
      {
        id: ids.view(),
        boardId,
        name: "Gallery",
        type: "gallery",
        groupByPropertyId: statusId,
        visibleProperties: [statusId, priorityId],
        position: POSITION_STEP * 4,
      },
    ]);
  });

  const [workspace] = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  revalidatePath(`/w/${workspace?.slug ?? ""}`);
  redirect(`/b/${boardId}`);
}

export async function renameBoard(boardId: string, title: string): Promise<void> {
  await requireBoardAccess(boardId);
  const clean = title.trim();
  if (!clean) return;

  await db
    .update(boards)
    .set({ title: clean, updatedAt: new Date() })
    .where(eq(boards.id, boardId));

  await publish({ boardId, kind: "board.updated" });
  revalidatePath(`/b/${boardId}`);
}

export async function archiveBoard(boardId: string): Promise<void> {
  const { board } = await requireBoardAccess(boardId);
  await db
    .update(boards)
    .set({ archivedAt: new Date() })
    .where(eq(boards.id, boardId));

  const [workspace] = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, board.workspaceId))
    .limit(1);

  redirect(`/w/${workspace?.slug ?? ""}`);
}

/* -------------------------------------------------------------- properties */

const propertySchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(PROPERTY_TYPES),
});

export async function createProperty(
  boardId: string,
  input: { name: string; type: string },
): Promise<void> {
  await requireBoardAccess(boardId);
  const parsed = propertySchema.safeParse(input);
  if (!parsed.success) return;

  const existing = await db
    .select({ position: boardProperties.position })
    .from(boardProperties)
    .where(eq(boardProperties.boardId, boardId));
  const last = existing.reduce((max, p) => Math.max(max, p.position), 0);

  // A select with no options cannot be grouped by, so seed one to start from.
  const options: PropertyOption[] =
    parsed.data.type === "select" || parsed.data.type === "multiSelect"
      ? [{ id: ids.option(), name: "Option 1", color: "slate" }]
      : [];

  await db.insert(boardProperties).values({
    id: ids.property(),
    boardId,
    name: parsed.data.name,
    type: parsed.data.type,
    options,
    position: last + POSITION_STEP,
  });

  await publish({ boardId, kind: "board.updated" });
  revalidatePath(`/b/${boardId}`);
}

export async function renameProperty(
  propertyId: string,
  name: string,
): Promise<void> {
  const [property] = await db
    .select()
    .from(boardProperties)
    .where(eq(boardProperties.id, propertyId))
    .limit(1);
  if (!property) return;
  await requireBoardAccess(property.boardId);

  await db
    .update(boardProperties)
    .set({ name: name.trim() || property.name })
    .where(eq(boardProperties.id, propertyId));

  await publish({ boardId: property.boardId, kind: "board.updated" });
  revalidatePath(`/b/${property.boardId}`);
}

export async function deleteProperty(propertyId: string): Promise<void> {
  const [property] = await db
    .select()
    .from(boardProperties)
    .where(eq(boardProperties.id, propertyId))
    .limit(1);
  if (!property) return;
  await requireBoardAccess(property.boardId);

  // Any view grouped by this property would render a board with no columns.
  await db.transaction(async (tx) => {
    await tx
      .update(views)
      .set({ groupByPropertyId: null })
      .where(
        and(
          eq(views.boardId, property.boardId),
          eq(views.groupByPropertyId, propertyId),
        ),
      );
    await tx.delete(boardProperties).where(eq(boardProperties.id, propertyId));
  });

  await publish({ boardId: property.boardId, kind: "board.updated" });
  revalidatePath(`/b/${property.boardId}`);
}

export async function addPropertyOption(
  propertyId: string,
  name: string,
  color?: string,
): Promise<string | null> {
  const [property] = await db
    .select()
    .from(boardProperties)
    .where(eq(boardProperties.id, propertyId))
    .limit(1);
  if (!property) return null;
  await requireBoardAccess(property.boardId);

  const clean = name.trim();
  if (!clean) return null;

  const existing = property.options.find(
    (option) => option.name.toLowerCase() === clean.toLowerCase(),
  );
  if (existing) return existing.id;

  const option: PropertyOption = {
    id: ids.option(),
    name: clean,
    color:
      color && COLORS.includes(color as (typeof COLORS)[number])
        ? color
        : COLORS[property.options.length % COLORS.length],
  };

  await db
    .update(boardProperties)
    .set({ options: [...property.options, option] })
    .where(eq(boardProperties.id, propertyId));

  await publish({ boardId: property.boardId, kind: "board.updated" });
  revalidatePath(`/b/${property.boardId}`);
  return option.id;
}

/**
 * Marks which option of a select means the work is finished, or clears it.
 * Cards sitting in that option stop being reported as overdue.
 */
export async function setDoneOption(
  propertyId: string,
  optionId: string | null,
): Promise<void> {
  const [property] = await db
    .select()
    .from(boardProperties)
    .where(eq(boardProperties.id, propertyId))
    .limit(1);
  if (!property) return;
  await requireBoardAccess(property.boardId);

  // Only an option this property actually has, so a stale id cannot silently
  // mark every card complete or nothing at all.
  const valid =
    optionId === null || property.options.some((o) => o.id === optionId);
  if (!valid) return;

  await db
    .update(boardProperties)
    .set({ doneOptionId: optionId })
    .where(eq(boardProperties.id, propertyId));

  await publish({ boardId: property.boardId, kind: "board.updated" });
  revalidatePath(`/b/${property.boardId}`);
}

export async function updatePropertyOption(
  propertyId: string,
  optionId: string,
  patch: { name?: string; color?: string },
): Promise<void> {
  const [property] = await db
    .select()
    .from(boardProperties)
    .where(eq(boardProperties.id, propertyId))
    .limit(1);
  if (!property) return;
  await requireBoardAccess(property.boardId);

  const options = property.options.map((option) =>
    option.id === optionId
      ? {
          ...option,
          name: patch.name?.trim() || option.name,
          color: patch.color ?? option.color,
        }
      : option,
  );

  await db
    .update(boardProperties)
    .set({ options })
    .where(eq(boardProperties.id, propertyId));

  await publish({ boardId: property.boardId, kind: "board.updated" });
  revalidatePath(`/b/${property.boardId}`);
}

export async function deletePropertyOption(
  propertyId: string,
  optionId: string,
): Promise<void> {
  const [property] = await db
    .select()
    .from(boardProperties)
    .where(eq(boardProperties.id, propertyId))
    .limit(1);
  if (!property) return;
  await requireBoardAccess(property.boardId);

  await db
    .update(boardProperties)
    .set({ options: property.options.filter((o) => o.id !== optionId) })
    .where(eq(boardProperties.id, propertyId));

  // Cards still holding the removed option fall into the "No status" lane,
  // which is recoverable; deleting their values would not be.
  await publish({ boardId: property.boardId, kind: "board.updated" });
  revalidatePath(`/b/${property.boardId}`);
}

/* ------------------------------------------------------------------- views */

export async function createView(
  boardId: string,
  type: string,
  name?: string,
): Promise<void> {
  await requireBoardAccess(boardId);
  if (!VIEW_TYPES.includes(type as (typeof VIEW_TYPES)[number])) return;

  const existing = await db
    .select()
    .from(views)
    .where(eq(views.boardId, boardId));
  const last = existing.reduce((max, v) => Math.max(max, v.position), 0);

  const [firstSelect] = await db
    .select()
    .from(boardProperties)
    .where(
      and(
        eq(boardProperties.boardId, boardId),
        eq(boardProperties.type, "select"),
      ),
    )
    .limit(1);

  await db.insert(views).values({
    id: ids.view(),
    boardId,
    name: name?.trim() || defaultViewName(type, existing.length),
    type,
    groupByPropertyId: firstSelect?.id ?? null,
    visibleProperties: firstSelect ? [firstSelect.id] : [],
    position: last + POSITION_STEP,
  });

  await publish({ boardId, kind: "view.updated" });
  revalidatePath(`/b/${boardId}`);
}

export async function updateView(
  viewId: string,
  patch: {
    name?: string;
    groupByPropertyId?: string | null;
    filters?: unknown;
    sort?: unknown;
    visibleProperties?: string[];
    showExternalEvents?: boolean;
    hiddenCalendars?: string[];
  },
): Promise<void> {
  const [view] = await db.select().from(views).where(eq(views.id, viewId)).limit(1);
  if (!view) return;
  await requireBoardAccess(view.boardId);

  await db
    .update(views)
    .set({
      name: patch.name?.trim() || view.name,
      groupByPropertyId:
        patch.groupByPropertyId === undefined
          ? view.groupByPropertyId
          : patch.groupByPropertyId,
      filters: (patch.filters as typeof view.filters) ?? view.filters,
      sort: patch.sort === undefined ? view.sort : (patch.sort as typeof view.sort),
      visibleProperties: patch.visibleProperties ?? view.visibleProperties,
      showExternalEvents: patch.showExternalEvents ?? view.showExternalEvents,
      hiddenCalendars: patch.hiddenCalendars ?? view.hiddenCalendars,
    })
    .where(eq(views.id, viewId));

  await publish({ boardId: view.boardId, kind: "view.updated" });
  revalidatePath(`/b/${view.boardId}`);
}

export async function deleteView(viewId: string): Promise<void> {
  const [view] = await db.select().from(views).where(eq(views.id, viewId)).limit(1);
  if (!view) return;
  await requireBoardAccess(view.boardId);

  const remaining = await db
    .select({ id: views.id })
    .from(views)
    .where(eq(views.boardId, view.boardId));
  if (remaining.length <= 1) return; // never leave a board with nothing to render

  await db.delete(views).where(eq(views.id, viewId));
  await publish({ boardId: view.boardId, kind: "view.updated" });
  revalidatePath(`/b/${view.boardId}`);
}

function defaultViewName(type: string, count: number): string {
  const base = type.charAt(0).toUpperCase() + type.slice(1);
  return count === 0 ? base : `${base} ${count + 1}`;
}
