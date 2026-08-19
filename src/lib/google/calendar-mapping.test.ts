import { describe, expect, it } from "vitest";
import type { GoogleEvent } from "./client";
import {
  CARD_MARKER,
  DEFAULT_DURATION_MS,
  buildEventPayload,
  cardDatesFromWindow,
  parseEventWindow,
  type CardForCalendar,
} from "./calendar-mapping";

const APP_URL = "https://boards.example.test";

function card(overrides: Partial<CardForCalendar> = {}): CardForCalendar {
  return {
    id: "crd_1",
    boardId: "brd_1",
    title: "Ship the invite flow",
    description: null,
    startAt: null,
    dueAt: new Date("2026-08-25T00:00:00.000Z"),
    allDay: true,
    ...overrides,
  };
}

describe("buildEventPayload, all-day cards", () => {
  it("ends a single-day task on the following day", () => {
    // Google's all-day end date is exclusive. A task due the 25th that ends on
    // the 25th renders as a zero-length event and disappears from the calendar.
    const payload = buildEventPayload(card(), "Roadmap", APP_URL);
    expect(payload.start.date).toBe("2026-08-25");
    expect(payload.end.date).toBe("2026-08-26");
  });

  it("spans a range from start to the day after the due date", () => {
    const payload = buildEventPayload(
      card({
        startAt: new Date("2026-08-24T00:00:00.000Z"),
        dueAt: new Date("2026-08-26T00:00:00.000Z"),
      }),
      "Roadmap",
      APP_URL,
    );
    expect(payload.start.date).toBe("2026-08-24");
    expect(payload.end.date).toBe("2026-08-27");
  });

  it("handles a card with only a start date", () => {
    const payload = buildEventPayload(
      card({ startAt: new Date("2026-08-24T00:00:00.000Z"), dueAt: null }),
      "Roadmap",
      APP_URL,
    );
    expect(payload.start.date).toBe("2026-08-24");
    expect(payload.end.date).toBe("2026-08-25");
  });

  it("crosses a month boundary correctly", () => {
    const payload = buildEventPayload(
      card({ dueAt: new Date("2026-08-31T00:00:00.000Z") }),
      "Roadmap",
      APP_URL,
    );
    expect(payload.end.date).toBe("2026-09-01");
  });

  it("crosses a leap day correctly", () => {
    const payload = buildEventPayload(
      card({ dueAt: new Date("2028-02-28T00:00:00.000Z") }),
      "Roadmap",
      APP_URL,
    );
    expect(payload.end.date).toBe("2028-02-29");
  });
});

describe("buildEventPayload, timed cards", () => {
  it("uses the card's own window when it has both ends", () => {
    const payload = buildEventPayload(
      card({
        allDay: false,
        startAt: new Date("2026-08-25T14:00:00.000Z"),
        dueAt: new Date("2026-08-25T15:30:00.000Z"),
      }),
      "Roadmap",
      APP_URL,
    );
    expect(payload.start.dateTime).toBe("2026-08-25T14:00:00.000Z");
    expect(payload.end.dateTime).toBe("2026-08-25T15:30:00.000Z");
  });

  it("gives a deadline with no start a default duration", () => {
    const payload = buildEventPayload(
      card({ allDay: false, dueAt: new Date("2026-08-25T14:00:00.000Z") }),
      "Roadmap",
      APP_URL,
    );
    const start = new Date(payload.start.dateTime!).getTime();
    const end = new Date(payload.end.dateTime!).getTime();
    expect(end - start).toBe(DEFAULT_DURATION_MS);
  });

  it("never emits a date field for a timed event", () => {
    const payload = buildEventPayload(
      card({ allDay: false, dueAt: new Date("2026-08-25T14:00:00.000Z") }),
      "Roadmap",
      APP_URL,
    );
    expect(payload.start.date).toBeUndefined();
    expect(payload.end.date).toBeUndefined();
  });
});

describe("buildEventPayload, metadata", () => {
  it("marks the event so the pull side skips its own work", () => {
    const payload = buildEventPayload(card(), "Roadmap", APP_URL);
    expect(payload.extendedProperties.private[CARD_MARKER]).toBe("crd_1");
  });

  it("links back to the card and names the board", () => {
    const payload = buildEventPayload(card(), "Roadmap", APP_URL);
    expect(payload.description).toContain(
      "https://boards.example.test/b/brd_1?card=crd_1",
    );
    expect(payload.description).toContain("Board: Roadmap");
  });

  it("does not double the slash when APP_URL has a trailing one", () => {
    const payload = buildEventPayload(card(), "Roadmap", "https://x.test/");
    expect(payload.description).toContain("https://x.test/b/brd_1?card=crd_1");
  });

  it("includes the card's own notes first", () => {
    const payload = buildEventPayload(
      card({ description: "Blocked on credentials." }),
      "Roadmap",
      APP_URL,
    );
    expect(payload.description?.startsWith("Blocked on credentials.")).toBe(true);
  });
});

describe("parseEventWindow", () => {
  const event = (overrides: Partial<GoogleEvent>): GoogleEvent => ({
    id: "evt_1",
    ...overrides,
  });

  it("reads an all-day event", () => {
    const window = parseEventWindow(
      event({ start: { date: "2026-08-25" }, end: { date: "2026-08-26" } }),
    );
    expect(window?.allDay).toBe(true);
    expect(window?.start.toISOString()).toBe("2026-08-25T00:00:00.000Z");
  });

  it("reads a timed event", () => {
    const window = parseEventWindow(
      event({
        start: { dateTime: "2026-08-25T14:00:00Z" },
        end: { dateTime: "2026-08-25T15:00:00Z" },
      }),
    );
    expect(window?.allDay).toBe(false);
    expect(window?.end.toISOString()).toBe("2026-08-25T15:00:00.000Z");
  });

  it("returns null for an event with no usable dates", () => {
    expect(parseEventWindow(event({}))).toBeNull();
    expect(parseEventWindow(event({ start: { date: "2026-08-25" } }))).toBeNull();
  });

  it("returns null rather than an Invalid Date", () => {
    expect(
      parseEventWindow(
        event({ start: { dateTime: "not a date" }, end: { dateTime: "also not" } }),
      ),
    ).toBeNull();
  });
});

describe("round trip", () => {
  it("returns an all-day card to the day it started on", () => {
    // The property that matters: pushing a card to Google and reading it back
    // must not walk the due date forward or backward a day each time.
    const original = card({ dueAt: new Date("2026-08-25T00:00:00.000Z") });
    const payload = buildEventPayload(original, "Roadmap", APP_URL);

    const window = parseEventWindow({
      id: "evt_1",
      start: { date: payload.start.date },
      end: { date: payload.end.date },
    });
    const dates = cardDatesFromWindow(window!);

    expect(dates.allDay).toBe(true);
    expect(dates.dueAt.toISOString()).toBe(original.dueAt!.toISOString());
  });

  it("survives repeated round trips without drifting", () => {
    let current = card({ dueAt: new Date("2026-08-25T00:00:00.000Z") });
    for (let i = 0; i < 5; i++) {
      const payload = buildEventPayload(current, "Roadmap", APP_URL);
      const window = parseEventWindow({
        id: "evt_1",
        start: { date: payload.start.date },
        end: { date: payload.end.date },
      })!;
      const dates = cardDatesFromWindow(window);
      current = { ...current, startAt: dates.startAt, dueAt: dates.dueAt, allDay: dates.allDay };
    }
    expect(current.dueAt!.toISOString()).toBe("2026-08-25T00:00:00.000Z");
  });

  it("returns a timed card to its exact window", () => {
    const original = card({
      allDay: false,
      startAt: new Date("2026-08-25T14:00:00.000Z"),
      dueAt: new Date("2026-08-25T15:30:00.000Z"),
    });
    const payload = buildEventPayload(original, "Roadmap", APP_URL);
    const window = parseEventWindow({
      id: "evt_1",
      start: { dateTime: payload.start.dateTime },
      end: { dateTime: payload.end.dateTime },
    })!;
    const dates = cardDatesFromWindow(window);

    expect(dates.allDay).toBe(false);
    expect(dates.startAt.toISOString()).toBe(original.startAt!.toISOString());
    expect(dates.dueAt.toISOString()).toBe(original.dueAt!.toISOString());
  });
});

describe("timezone boundary", () => {
  /**
   * The gap task #3 exists to close. An all-day payload is built by slicing the
   * UTC date out of the timestamp, but the UI creates due dates from local
   * time: `new Date("2026-08-25T09:00:00")`. West of UTC that still lands on
   * the 25th. In Auckland (UTC+13) it is 2026-08-24T20:00Z, and the card
   * arrives on the calendar a day early.
   *
   * Left as a todo rather than a passing assertion, because writing a test that
   * asserts the current behaviour would lock the bug in.
   */
  it.todo("keeps an all-day card on its own day regardless of the viewer's timezone");
});
