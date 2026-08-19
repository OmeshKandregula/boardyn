import type { GoogleEvent } from "./client";

/**
 * The translation layer between a card and a Google event, kept free of any
 * database or network access so it can be tested directly. Both sides of the
 * sync go through here, which is the only reason the two directions agree
 * about what a due date means.
 */

/** Stamped on every event we create so the pull side can ignore its own work. */
export const CARD_MARKER = "boardynCardId";

export type EventPayload = {
  summary: string;
  description?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  extendedProperties: { private: Record<string, string> };
  source?: { title: string; url: string };
};

export type CardForCalendar = {
  id: string;
  boardId: string;
  title: string;
  description: string | null;
  startAt: Date | null;
  dueAt: Date | null;
  allDay: boolean;
};

/** Default length of a timed block when a card has a due time but no start. */
export const DEFAULT_DURATION_MS = 30 * 60 * 1000;

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export function buildEventPayload(
  card: CardForCalendar,
  boardTitle: string,
  appUrl: string,
): EventPayload {
  const link = `${appUrl.replace(/\/$/, "")}/b/${card.boardId}?card=${card.id}`;
  const description = [card.description?.trim(), `Board: ${boardTitle}`, link]
    .filter(Boolean)
    .join("\n\n");

  const common = {
    summary: card.title,
    description,
    extendedProperties: { private: { [CARD_MARKER]: card.id } },
    source: { title: "Boardyn", url: link },
  };

  if (card.allDay) {
    const first = card.startAt ?? card.dueAt!;
    const last = card.dueAt ?? card.startAt!;
    // Google treats an all-day end date as exclusive, so a block that should
    // read as "due Tuesday" has to end on Wednesday. Getting this wrong shows
    // the task a day short, or drops single-day tasks off the calendar.
    const end = new Date(last);
    end.setUTCDate(end.getUTCDate() + 1);
    return { ...common, start: { date: isoDate(first) }, end: { date: isoDate(end) } };
  }

  const start = card.startAt ?? card.dueAt!;
  const end =
    card.dueAt && card.startAt
      ? card.dueAt
      : new Date(start.getTime() + DEFAULT_DURATION_MS);

  return {
    ...common,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

export type EventWindow = { start: Date; end: Date; allDay: boolean };

/** Reads a Google event's start and end, whichever shape it arrived in. */
export function parseEventWindow(event: GoogleEvent): EventWindow | null {
  const startRaw = event.start?.dateTime ?? event.start?.date;
  const endRaw = event.end?.dateTime ?? event.end?.date;
  if (!startRaw || !endRaw) return null;

  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const start = new Date(allDay ? `${startRaw}T00:00:00Z` : startRaw);
  const end = new Date(allDay ? `${endRaw}T00:00:00Z` : endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  return { start, end, allDay };
}

/**
 * The inverse of the exclusive end date above: what a card's dates should
 * become after its event moved in Google.
 */
export function cardDatesFromWindow(window: EventWindow): {
  startAt: Date;
  dueAt: Date;
  allDay: boolean;
} {
  return {
    startAt: window.start,
    dueAt: window.allDay
      ? new Date(window.end.getTime() - 86_400_000)
      : window.end,
    allDay: window.allDay,
  };
}
