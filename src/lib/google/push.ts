import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  boards,
  calendarLinks,
  cardAssignees,
  cards,
  googleAccounts,
  type Card,
  type GoogleAccount,
} from "@/db/schema";
import {
  GoogleApiError,
  calendarFetch,
  googleConfigured,
  type GoogleEvent,
} from "./client";

/** Stamped on every event we create so the pull side can ignore its own work. */
export const CARD_MARKER = "boardynCardId";

type EventPayload = {
  summary: string;
  description?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  extendedProperties: { private: Record<string, string> };
  source?: { title: string; url: string };
};

function appUrl(): string {
  return process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildPayload(card: Card, boardTitle: string): EventPayload {
  const link = `${appUrl()}/b/${card.boardId}?card=${card.id}`;
  const description = [card.description?.trim(), `Board: ${boardTitle}`, link]
    .filter(Boolean)
    .join("\n\n");

  if (card.allDay) {
    const day = card.startAt ?? card.dueAt!;
    // Google treats an all-day end date as exclusive, so a one-day block ends
    // on the following morning. Getting this wrong shows the task a day short.
    const endSource = card.dueAt ?? card.startAt!;
    const end = new Date(endSource);
    end.setUTCDate(end.getUTCDate() + 1);
    return {
      summary: card.title,
      description,
      start: { date: isoDate(day) },
      end: { date: isoDate(end) },
      extendedProperties: { private: { [CARD_MARKER]: card.id } },
      source: { title: "Boardyn", url: link },
    };
  }

  const start = card.startAt ?? card.dueAt!;
  const end = card.dueAt && card.startAt ? card.dueAt : new Date(start.getTime() + 30 * 60 * 1000);
  return {
    summary: card.title,
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: { private: { [CARD_MARKER]: card.id } },
    source: { title: "Boardyn", url: link },
  };
}

const hashOf = (payload: EventPayload) =>
  createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);

/**
 * Mirrors a card onto the calendar of everyone assigned to it, and removes it
 * from anyone who is no longer assigned. Dateless cards are not calendar
 * entries at all, so they get cleaned up the same way.
 *
 * Called from mutations as fire-and-forget: a Google outage must never be able
 * to fail a drag.
 */
export async function pushCardToCalendars(cardId: string): Promise<void> {
  if (!googleConfigured()) return;

  const [row] = await db
    .select({ card: cards, boardTitle: boards.title })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .where(eq(cards.id, cardId))
    .limit(1);
  if (!row) return;

  const { card, boardTitle } = row;
  const existingLinks = await db
    .select()
    .from(calendarLinks)
    .where(eq(calendarLinks.cardId, cardId));

  const undated = !card.dueAt && !card.startAt;
  if (undated || card.archivedAt) {
    await removeCardFromCalendars(cardId);
    return;
  }

  const assigneeIds = (
    await db
      .select({ userId: cardAssignees.userId })
      .from(cardAssignees)
      .where(eq(cardAssignees.cardId, cardId))
  ).map((a) => a.userId);

  const targets: GoogleAccount[] = assigneeIds.length
    ? await db
        .select()
        .from(googleAccounts)
        .where(
          and(
            inArray(googleAccounts.userId, assigneeIds),
            eq(googleAccounts.syncEnabled, true),
            eq(googleAccounts.pushCards, true),
          ),
        )
    : [];

  const payload = buildPayload(card, boardTitle);
  const hash = hashOf(payload);
  const targetIds = new Set(targets.map((t) => t.id));

  // Unassigned people should not keep a stale block on their calendar.
  for (const link of existingLinks) {
    if (!targetIds.has(link.googleAccountId)) {
      await deleteLinkedEvent(link.googleAccountId, link.eventId, cardId);
    }
  }

  for (const account of targets) {
    const link = existingLinks.find((l) => l.googleAccountId === account.id);
    try {
      if (link) {
        if (link.pushedHash === hash) continue;
        await calendarFetch(
          account,
          `/calendars/${encodeURIComponent(account.calendarId)}/events/${link.eventId}`,
          { method: "PATCH", body: JSON.stringify(payload) },
        );
        await db
          .update(calendarLinks)
          .set({ pushedHash: hash, updatedAt: new Date() })
          .where(
            and(
              eq(calendarLinks.cardId, cardId),
              eq(calendarLinks.googleAccountId, account.id),
            ),
          );
      } else {
        const created = await calendarFetch<GoogleEvent>(
          account,
          `/calendars/${encodeURIComponent(account.calendarId)}/events`,
          { method: "POST", body: JSON.stringify(payload) },
        );
        await db
          .insert(calendarLinks)
          .values({
            cardId,
            googleAccountId: account.id,
            eventId: created.id,
            pushedHash: hash,
          })
          .onConflictDoUpdate({
            target: [calendarLinks.cardId, calendarLinks.googleAccountId],
            set: { eventId: created.id, pushedHash: hash, updatedAt: new Date() },
          });
      }
    } catch (error) {
      // A single member's broken grant should not stop the other member's push.
      if (error instanceof GoogleApiError && error.status === 404 && link) {
        // The event was deleted in Google; forget it and recreate next time.
        await db
          .delete(calendarLinks)
          .where(
            and(
              eq(calendarLinks.cardId, cardId),
              eq(calendarLinks.googleAccountId, account.id),
            ),
          );
      }
      await db
        .update(googleAccounts)
        .set({ lastSyncError: String(error).slice(0, 500) })
        .where(eq(googleAccounts.id, account.id));
    }
  }
}

export async function removeCardFromCalendars(cardId: string): Promise<void> {
  const links = await db
    .select()
    .from(calendarLinks)
    .where(eq(calendarLinks.cardId, cardId));

  for (const link of links) {
    await deleteLinkedEvent(link.googleAccountId, link.eventId, cardId);
  }
}

async function deleteLinkedEvent(
  googleAccountId: string,
  eventId: string,
  cardId: string,
): Promise<void> {
  const [account] = await db
    .select()
    .from(googleAccounts)
    .where(eq(googleAccounts.id, googleAccountId))
    .limit(1);

  if (account) {
    try {
      await calendarFetch(
        account,
        `/calendars/${encodeURIComponent(account.calendarId)}/events/${eventId}`,
        { method: "DELETE" },
      );
    } catch (error) {
      // 404/410 mean it is already gone, which is the state we wanted.
      if (!(error instanceof GoogleApiError) || ![404, 410].includes(error.status)) {
        console.error("[google] delete failed", error);
      }
    }
  }

  await db
    .delete(calendarLinks)
    .where(
      and(
        eq(calendarLinks.cardId, cardId),
        eq(calendarLinks.googleAccountId, googleAccountId),
      ),
    );
}
