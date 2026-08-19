"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  boardProperties,
  boards,
  cardValues,
  cards,
  granolaAccounts,
  meetingActionItems,
  meetings,
} from "@/db/schema";
import { requireWorkspaceMember } from "@/lib/access";
import { verifyKey } from "@/lib/granola/client";
import { syncGranolaAccount } from "@/lib/granola/pull";
import { ids } from "@/lib/ids";
import { POSITION_STEP } from "@/lib/positions";
import { publish } from "@/lib/realtime";
import { encryptSecret, secretHint } from "@/lib/secrets";
import { requireUser } from "@/lib/session";

/**
 * Saves a Granola API key after checking it works.
 *
 * Verifying first means a typo is rejected here, where somebody is looking at
 * the screen, rather than becoming a poller that fails quietly every five
 * minutes into a log nobody reads.
 */
export async function connectGranola(
  workspaceId: string,
  apiKey: string,
): Promise<{ error?: string }> {
  const { user } = await requireWorkspaceMember(workspaceId);
  const key = apiKey.trim();
  if (!key) return { error: "Paste your Granola API key" };

  const check = await verifyKey(key);
  if (!check.ok) return { error: check.reason };

  const [existing] = await db
    .select({ id: granolaAccounts.id })
    .from(granolaAccounts)
    .where(eq(granolaAccounts.userId, user.id))
    .limit(1);

  await db
    .insert(granolaAccounts)
    .values({
      id: existing?.id ?? ids.granola(),
      userId: user.id,
      workspaceId,
      apiKey: encryptSecret(key),
      keyHint: secretHint(key),
      syncEnabled: true,
      lastSyncError: null,
    })
    .onConflictDoUpdate({
      target: granolaAccounts.userId,
      set: {
        workspaceId,
        apiKey: encryptSecret(key),
        keyHint: secretHint(key),
        syncEnabled: true,
        lastSyncError: null,
        // A different key may see a different set of notes, so the old cursor
        // would skip past things this one can see.
        cursor: null,
      },
    });

  revalidatePath("/settings");
  revalidatePath("/meetings");
  return {};
}

/**
 * Forgets the key and everything fetched with it. Meetings are deleted rather
 * than orphaned: they are a copy of data that lives in Granola, and someone
 * disconnecting an integration means to stop this app holding their notes.
 */
export async function disconnectGranola(): Promise<void> {
  const user = await requireUser();
  const [account] = await db
    .select()
    .from(granolaAccounts)
    .where(eq(granolaAccounts.userId, user.id))
    .limit(1);
  if (!account) return;

  await db.transaction(async (tx) => {
    await tx.delete(meetings).where(eq(meetings.ownerId, user.id));
    await tx.delete(granolaAccounts).where(eq(granolaAccounts.id, account.id));
  });

  revalidatePath("/settings");
  revalidatePath("/meetings");
}

export async function setGranolaSyncEnabled(enabled: boolean): Promise<void> {
  const user = await requireUser();
  await db
    .update(granolaAccounts)
    .set({ syncEnabled: enabled, lastSyncError: null })
    .where(eq(granolaAccounts.userId, user.id));
  revalidatePath("/settings");
}

export async function syncGranolaNow(): Promise<{
  error?: string;
  imported?: number;
  actionItems?: number;
}> {
  const user = await requireUser();
  const [account] = await db
    .select()
    .from(granolaAccounts)
    .where(eq(granolaAccounts.userId, user.id))
    .limit(1);
  if (!account) return { error: "No Granola key saved" };

  try {
    const result = await syncGranolaAccount(account);
    revalidatePath("/meetings");
    return { imported: result.imported, actionItems: result.actionItems };
  } catch (error) {
    return { error: String(error).slice(0, 300) };
  }
}

/**
 * Shares a meeting with the workspace, or takes it back.
 *
 * Only the person whose key fetched it can decide: a colleague must not be
 * able to publish somebody else's notes. Recording the override stops the
 * poller reapplying the automatic rule over the top of the decision.
 */
export async function setMeetingShared(
  meetingId: string,
  shared: boolean,
): Promise<void> {
  const user = await requireUser();
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  if (!meeting || meeting.ownerId !== user.id) return;

  await db
    .update(meetings)
    .set({
      sharedWithWorkspace: shared,
      shareOverriddenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, meetingId));

  revalidatePath("/meetings");
}

/**
 * Turns a suggested action item into a card.
 *
 * Nothing gets here automatically. The extractor reads candidates out of a
 * summary and a person decides which of them are real work, which is the only
 * way the board stays something people trust.
 */
export async function acceptActionItem(
  itemId: string,
  boardId: string,
): Promise<{ error?: string; cardId?: string }> {
  const user = await requireUser();

  const [row] = await db
    .select({ item: meetingActionItems, meeting: meetings })
    .from(meetingActionItems)
    .innerJoin(meetings, eq(meetings.id, meetingActionItems.meetingId))
    .where(eq(meetingActionItems.id, itemId))
    .limit(1);
  if (!row) return { error: "That action item no longer exists" };

  const { item, meeting } = row;
  if (!meeting.sharedWithWorkspace && meeting.ownerId !== user.id) {
    return { error: "That meeting is not shared with you" };
  }

  const [board] = await db
    .select()
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1);
  if (!board) return { error: "Pick a board" };
  await requireWorkspaceMember(board.workspaceId);

  if (item.cardId) return { cardId: item.cardId };

  const siblings = await db
    .select({ position: cards.position })
    .from(cards)
    .where(and(eq(cards.boardId, boardId), isNull(cards.archivedAt)))
    .orderBy(asc(cards.position));
  const position = (siblings.at(-1)?.position ?? 0) + POSITION_STEP;

  // The first column of the board's first select property, so an accepted item
  // lands somewhere visible rather than in the unsorted lane.
  const [firstSelect] = await db
    .select()
    .from(boardProperties)
    .where(
      and(eq(boardProperties.boardId, boardId), eq(boardProperties.type, "select")),
    )
    .orderBy(asc(boardProperties.position))
    .limit(1);

  const cardId = ids.card();
  const when = meeting.startedAt
    ? meeting.startedAt.toISOString().slice(0, 10)
    : null;

  await db.transaction(async (tx) => {
    await tx.insert(cards).values({
      id: cardId,
      boardId,
      title: item.text,
      // Where it came from, so a card nobody remembers agreeing to can be
      // traced back to the room it was agreed in.
      description: `From meeting: ${meeting.title}${when ? ` (${when})` : ""}`,
      position,
      createdBy: user.id,
    });

    if (firstSelect && firstSelect.options.length > 0) {
      await tx.insert(cardValues).values({
        cardId,
        propertyId: firstSelect.id,
        value: firstSelect.options[0].id,
      });
    }

    await tx
      .update(meetingActionItems)
      .set({ status: "accepted", cardId })
      .where(eq(meetingActionItems.id, itemId));
  });

  await publish({ boardId, kind: "card.created", cardId, actorId: user.id });
  revalidatePath("/meetings");
  revalidatePath(`/b/${boardId}`);
  return { cardId };
}

export async function dismissActionItem(itemId: string): Promise<void> {
  const user = await requireUser();
  const [row] = await db
    .select({ meeting: meetings })
    .from(meetingActionItems)
    .innerJoin(meetings, eq(meetings.id, meetingActionItems.meetingId))
    .where(eq(meetingActionItems.id, itemId))
    .limit(1);
  if (!row) return;
  if (!row.meeting.sharedWithWorkspace && row.meeting.ownerId !== user.id) return;

  await db
    .update(meetingActionItems)
    .set({ status: "dismissed", cardId: null })
    .where(eq(meetingActionItems.id, itemId));

  revalidatePath("/meetings");
}

export async function restoreActionItem(itemId: string): Promise<void> {
  const user = await requireUser();
  const [row] = await db
    .select({ meeting: meetings })
    .from(meetingActionItems)
    .innerJoin(meetings, eq(meetings.id, meetingActionItems.meetingId))
    .where(eq(meetingActionItems.id, itemId))
    .limit(1);
  if (!row) return;
  if (!row.meeting.sharedWithWorkspace && row.meeting.ownerId !== user.id) return;

  await db
    .update(meetingActionItems)
    .set({ status: "suggested" })
    .where(eq(meetingActionItems.id, itemId));

  revalidatePath("/meetings");
}
