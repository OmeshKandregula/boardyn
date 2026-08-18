"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  boardProperties,
  cardAssignees,
  cardValues,
  cards,
  comments,
} from "@/db/schema";
import { requireBoardAccess, requireCardAccess } from "@/lib/access";
import { ids } from "@/lib/ids";
import { POSITION_STEP, between } from "@/lib/positions";
import { publish } from "@/lib/realtime";
import { pushCardToCalendars, removeCardFromCalendars } from "@/lib/google/push";

/**
 * Cards created from a kanban column arrive with the column's option already
 * set, which is why `groupPropertyId` and `optionId` are part of creation
 * rather than a follow-up write. Dropping a card into "In review" and having it
 * appear in "Backlog" for a frame is the kind of flicker that reads as a bug.
 */
export async function createCard(input: {
  boardId: string;
  title: string;
  groupPropertyId?: string | null;
  optionId?: string | null;
  dueAt?: string | null;
  assignToMe?: boolean;
}): Promise<string | null> {
  const { user } = await requireBoardAccess(input.boardId);
  const title = input.title.trim();
  if (!title) return null;

  const cardId = ids.card();
  const siblings = await db
    .select({ position: cards.position })
    .from(cards)
    .where(and(eq(cards.boardId, input.boardId), isNull(cards.archivedAt)))
    .orderBy(asc(cards.position));
  const position =
    (siblings.at(-1)?.position ?? 0) + POSITION_STEP;

  await db.transaction(async (tx) => {
    await tx.insert(cards).values({
      id: cardId,
      boardId: input.boardId,
      title,
      position,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      allDay: true,
      createdBy: user.id,
    });

    if (input.groupPropertyId && input.optionId) {
      await tx.insert(cardValues).values({
        cardId,
        propertyId: input.groupPropertyId,
        value: input.optionId,
      });
    }

    if (input.assignToMe) {
      await tx.insert(cardAssignees).values({ cardId, userId: user.id });
    }

    await tx.insert(activity).values({
      id: ids.activity(),
      boardId: input.boardId,
      cardId,
      userId: user.id,
      type: "card.created",
      data: { title },
    });
  });

  await publish({
    boardId: input.boardId,
    kind: "card.created",
    cardId,
    actorId: user.id,
  });
  revalidatePath(`/b/${input.boardId}`);
  return cardId;
}

export async function updateCard(
  cardId: string,
  patch: {
    title?: string;
    description?: string | null;
    startAt?: string | null;
    dueAt?: string | null;
    allDay?: boolean;
  },
): Promise<void> {
  const { user, board } = await requireCardAccess(cardId);
  const [existing] = await db.select().from(cards).where(eq(cards.id, cardId));
  if (!existing) return;

  const next = {
    title: patch.title?.trim() || existing.title,
    description:
      patch.description === undefined ? existing.description : patch.description,
    startAt:
      patch.startAt === undefined
        ? existing.startAt
        : patch.startAt
          ? new Date(patch.startAt)
          : null,
    dueAt:
      patch.dueAt === undefined
        ? existing.dueAt
        : patch.dueAt
          ? new Date(patch.dueAt)
          : null,
    allDay: patch.allDay ?? existing.allDay,
    updatedAt: new Date(),
  };

  await db.update(cards).set(next).where(eq(cards.id, cardId));

  await db.insert(activity).values({
    id: ids.activity(),
    boardId: board.id,
    cardId,
    userId: user.id,
    type: "card.updated",
    data: { fields: Object.keys(patch) },
  });

  // Only date or title changes are visible on a calendar, so only those are
  // worth an API round trip.
  const touchedCalendar =
    patch.title !== undefined ||
    patch.startAt !== undefined ||
    patch.dueAt !== undefined ||
    patch.allDay !== undefined ||
    patch.description !== undefined;
  if (touchedCalendar) {
    void pushCardToCalendars(cardId).catch((error) =>
      console.error("[google] push failed", error),
    );
  }

  await publish({
    boardId: board.id,
    kind: "card.updated",
    cardId,
    actorId: user.id,
  });
  revalidatePath(`/b/${board.id}`);
}

/**
 * A drag reports where the card landed: which group, and which card it now sits
 * after. The position is the midpoint of its new neighbours, so no other row
 * is touched.
 */
export async function moveCard(input: {
  cardId: string;
  groupPropertyId?: string | null;
  optionId?: string | null;
  beforeCardId?: string | null;
  afterCardId?: string | null;
}): Promise<void> {
  const { user, board } = await requireCardAccess(input.cardId);

  const neighbours = await db
    .select({ id: cards.id, position: cards.position })
    .from(cards)
    .where(and(eq(cards.boardId, board.id), isNull(cards.archivedAt)));

  const positionOf = (id?: string | null) =>
    id ? (neighbours.find((c) => c.id === id)?.position ?? null) : null;

  const position = between(
    positionOf(input.afterCardId),
    positionOf(input.beforeCardId),
  );

  await db.transaction(async (tx) => {
    await tx
      .update(cards)
      .set({ position, updatedAt: new Date() })
      .where(eq(cards.id, input.cardId));

    if (input.groupPropertyId) {
      if (input.optionId) {
        await tx
          .insert(cardValues)
          .values({
            cardId: input.cardId,
            propertyId: input.groupPropertyId,
            value: input.optionId,
          })
          .onConflictDoUpdate({
            target: [cardValues.cardId, cardValues.propertyId],
            set: { value: input.optionId },
          });
      } else {
        // Dropped into the ungrouped lane: clear rather than store null.
        await tx
          .delete(cardValues)
          .where(
            and(
              eq(cardValues.cardId, input.cardId),
              eq(cardValues.propertyId, input.groupPropertyId),
            ),
          );
      }
    }
  });

  await publish({
    boardId: board.id,
    kind: "card.moved",
    cardId: input.cardId,
    actorId: user.id,
  });
  revalidatePath(`/b/${board.id}`);
}

export async function setCardValue(
  cardId: string,
  propertyId: string,
  value: unknown,
): Promise<void> {
  const { user, board } = await requireCardAccess(cardId);

  const [property] = await db
    .select()
    .from(boardProperties)
    .where(eq(boardProperties.id, propertyId))
    .limit(1);
  if (!property || property.boardId !== board.id) return;

  const empty =
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);

  if (empty) {
    await db
      .delete(cardValues)
      .where(
        and(eq(cardValues.cardId, cardId), eq(cardValues.propertyId, propertyId)),
      );
  } else {
    await db
      .insert(cardValues)
      .values({ cardId, propertyId, value })
      .onConflictDoUpdate({
        target: [cardValues.cardId, cardValues.propertyId],
        set: { value },
      });
  }

  await db.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, cardId));

  await publish({
    boardId: board.id,
    kind: "card.updated",
    cardId,
    actorId: user.id,
  });
  revalidatePath(`/b/${board.id}`);
}

export async function toggleAssignee(
  cardId: string,
  userId: string,
): Promise<void> {
  const { user, board } = await requireCardAccess(cardId);

  const [existing] = await db
    .select()
    .from(cardAssignees)
    .where(and(eq(cardAssignees.cardId, cardId), eq(cardAssignees.userId, userId)))
    .limit(1);

  if (existing) {
    await db
      .delete(cardAssignees)
      .where(
        and(eq(cardAssignees.cardId, cardId), eq(cardAssignees.userId, userId)),
      );
  } else {
    await db.insert(cardAssignees).values({ cardId, userId });
  }

  // Assignment decides whose calendar the card belongs on, so re-push.
  void pushCardToCalendars(cardId).catch((error) =>
    console.error("[google] push failed", error),
  );

  await publish({
    boardId: board.id,
    kind: "card.updated",
    cardId,
    actorId: user.id,
  });
  revalidatePath(`/b/${board.id}`);
}

export async function addComment(cardId: string, body: string): Promise<void> {
  const { user, board } = await requireCardAccess(cardId);
  const clean = body.trim();
  if (!clean) return;

  await db.insert(comments).values({
    id: ids.comment(),
    cardId,
    userId: user.id,
    body: clean,
  });

  await publish({
    boardId: board.id,
    kind: "comment.created",
    cardId,
    actorId: user.id,
  });
  revalidatePath(`/b/${board.id}`);
}

/**
 * Archive rather than delete. A card is usually the only record of why a
 * decision was made, and two-person teams have no admin to restore from backup.
 */
export async function archiveCard(cardId: string): Promise<void> {
  const { user, board } = await requireCardAccess(cardId);

  await db
    .update(cards)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(cards.id, cardId));

  void removeCardFromCalendars(cardId).catch((error) =>
    console.error("[google] cleanup failed", error),
  );

  await publish({
    boardId: board.id,
    kind: "card.deleted",
    cardId,
    actorId: user.id,
  });
  revalidatePath(`/b/${board.id}`);
}

export async function restoreCard(cardId: string): Promise<void> {
  const { user, board } = await requireCardAccess(cardId);
  await db
    .update(cards)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(cards.id, cardId));

  await publish({
    boardId: board.id,
    kind: "card.updated",
    cardId,
    actorId: user.id,
  });
  revalidatePath(`/b/${board.id}`);
}
