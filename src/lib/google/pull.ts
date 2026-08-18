import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  calendarLinks,
  cards,
  externalEvents,
  googleAccounts,
  type GoogleAccount,
} from "@/db/schema";
import { ids } from "@/lib/ids";
import { publish } from "@/lib/realtime";
import {
  GoogleApiError,
  calendarFetch,
  googleConfigured,
  type GoogleEvent,
} from "./client";
import { CARD_MARKER } from "./push";

/** How much of the calendar is worth mirroring for a planning board. */
const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 180;

type ListResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export type SyncResult = {
  imported: number;
  removed: number;
  cardsUpdated: number;
  fullResync: boolean;
};

/**
 * Pulls one account's calendar in. The first run walks a fixed window; every
 * run after that sends the stored syncToken and Google returns only what has
 * changed since, which keeps a five-minute poll cheap enough to leave on.
 *
 * Events we created from cards come back with our marker. Those are not
 * imported as external events. They are treated as the co-founder moving a task
 * in Google Calendar, and the card's dates follow.
 */
export async function syncAccount(account: GoogleAccount): Promise<SyncResult> {
  const result: SyncResult = {
    imported: 0,
    removed: 0,
    cardsUpdated: 0,
    fullResync: false,
  };
  if (!googleConfigured() || !account.syncEnabled) return result;

  const now = Date.now();
  const baseQuery = {
    singleEvents: "true",
    showDeleted: "true",
    maxResults: "250",
  } as Record<string, string | undefined>;

  let syncToken = account.syncToken;
  let pageToken: string | undefined;
  const touchedBoards = new Set<string>();

  for (let page = 0; page < 40; page++) {
    let response: ListResponse;
    try {
      response = await calendarFetch<ListResponse>(
        account,
        `/calendars/${encodeURIComponent(account.calendarId)}/events`,
        {
          query: syncToken
            ? { ...baseQuery, syncToken, pageToken }
            : {
                ...baseQuery,
                pageToken,
                timeMin: new Date(
                  now - WINDOW_PAST_DAYS * 86_400_000,
                ).toISOString(),
                timeMax: new Date(
                  now + WINDOW_FUTURE_DAYS * 86_400_000,
                ).toISOString(),
              },
        },
      );
    } catch (error) {
      // 410 GONE means the cursor aged out. Drop it and walk the window again.
      if (error instanceof GoogleApiError && error.status === 410 && syncToken) {
        syncToken = null;
        pageToken = undefined;
        result.fullResync = true;
        await db
          .update(googleAccounts)
          .set({ syncToken: null })
          .where(eq(googleAccounts.id, account.id));
        continue;
      }
      await db
        .update(googleAccounts)
        .set({ lastSyncError: String(error).slice(0, 500) })
        .where(eq(googleAccounts.id, account.id));
      throw error;
    }

    for (const event of response.items ?? []) {
      const cardId = event.extendedProperties?.private?.[CARD_MARKER];

      if (cardId) {
        const boardId = await applyEventToCard(cardId, event, account);
        if (boardId) {
          touchedBoards.add(boardId);
          result.cardsUpdated++;
        }
        continue;
      }

      if (event.status === "cancelled") {
        await db
          .delete(externalEvents)
          .where(
            and(
              eq(externalEvents.googleAccountId, account.id),
              eq(externalEvents.eventId, event.id),
            ),
          );
        result.removed++;
        continue;
      }

      const parsed = parseWindow(event);
      if (!parsed) continue;

      await db
        .insert(externalEvents)
        .values({
          id: ids.event(),
          googleAccountId: account.id,
          eventId: event.id,
          title: event.summary?.trim() || "(busy)",
          startAt: parsed.start,
          endAt: parsed.end,
          allDay: parsed.allDay,
          htmlLink: event.htmlLink ?? null,
          status: event.status ?? "confirmed",
        })
        .onConflictDoUpdate({
          target: [externalEvents.googleAccountId, externalEvents.eventId],
          set: {
            title: event.summary?.trim() || "(busy)",
            startAt: parsed.start,
            endAt: parsed.end,
            allDay: parsed.allDay,
            htmlLink: event.htmlLink ?? null,
            status: event.status ?? "confirmed",
            updatedAt: new Date(),
          },
        });
      result.imported++;
    }

    if (response.nextPageToken) {
      pageToken = response.nextPageToken;
      continue;
    }

    await db
      .update(googleAccounts)
      .set({
        syncToken: response.nextSyncToken ?? null,
        lastSyncedAt: new Date(),
        lastSyncError: null,
      })
      .where(eq(googleAccounts.id, account.id));
    break;
  }

  for (const boardId of touchedBoards) {
    await publish({ boardId, kind: "calendar.synced" });
  }

  return result;
}

/**
 * A card-backed event changed in Google. Move the card to match. If the event
 * was deleted there, the card keeps its dates and simply loses the link: a
 * deleted calendar block is a scheduling decision, not a decision to drop work.
 */
async function applyEventToCard(
  cardId: string,
  event: GoogleEvent,
  account: GoogleAccount,
): Promise<string | null> {
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) return null;

  if (event.status === "cancelled") {
    await db
      .delete(calendarLinks)
      .where(
        and(
          eq(calendarLinks.cardId, cardId),
          eq(calendarLinks.googleAccountId, account.id),
        ),
      );
    return null;
  }

  const parsed = parseWindow(event);
  if (!parsed) return null;

  const sameStart = card.startAt?.getTime() === parsed.start.getTime();
  const sameDue = card.dueAt?.getTime() === parsed.end.getTime();
  if (sameStart && sameDue && card.allDay === parsed.allDay) return null;

  await db
    .update(cards)
    .set({
      startAt: parsed.start,
      // The all-day end date Google returns is exclusive; store the last day
      // the work is actually due so the board and the calendar agree.
      dueAt: parsed.allDay
        ? new Date(parsed.end.getTime() - 86_400_000)
        : parsed.end,
      allDay: parsed.allDay,
      updatedAt: new Date(),
    })
    .where(eq(cards.id, cardId));

  // The hash no longer matches what is on the calendar; clearing it means the
  // next card edit pushes rather than deciding it is already in sync.
  await db
    .update(calendarLinks)
    .set({ pushedHash: null, updatedAt: new Date() })
    .where(
      and(
        eq(calendarLinks.cardId, cardId),
        eq(calendarLinks.googleAccountId, account.id),
      ),
    );

  return card.boardId;
}

function parseWindow(
  event: GoogleEvent,
): { start: Date; end: Date; allDay: boolean } | null {
  const startRaw = event.start?.dateTime ?? event.start?.date;
  const endRaw = event.end?.dateTime ?? event.end?.date;
  if (!startRaw || !endRaw) return null;

  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const start = new Date(allDay ? `${startRaw}T00:00:00Z` : startRaw);
  const end = new Date(allDay ? `${endRaw}T00:00:00Z` : endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  return { start, end, allDay };
}

/** Every connected account. Used by the poll endpoint. */
export async function syncAllAccounts(): Promise<Record<string, SyncResult>> {
  const accounts = await db
    .select()
    .from(googleAccounts)
    .where(eq(googleAccounts.syncEnabled, true));

  const out: Record<string, SyncResult> = {};
  for (const account of accounts) {
    try {
      out[account.email] = await syncAccount(account);
    } catch (error) {
      console.error(`[google] sync failed for ${account.email}`, error);
    }
  }
  return out;
}
