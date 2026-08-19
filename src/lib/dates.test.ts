import { afterEach, describe, expect, it } from "vitest";
import {
  dateOnlyForDisplay,
  fromDateOnly,
  isDueToday,
  isOverdue,
  localDateOnly,
  moveToDay,
  toDateOnly,
  todayDateOnly,
} from "./dates";

/**
 * These run under a few different TZ values because the whole point of the
 * module is that a due date means the same calendar day everywhere. Auckland
 * (UTC+13 in August) is the case the old code got wrong; Honolulu (UTC-10) is
 * the mirror image, where a naive UTC render shows the day before.
 */
const ZONES = ["UTC", "America/New_York", "Pacific/Auckland", "Pacific/Honolulu"];

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

describe("fromDateOnly and toDateOnly", () => {
  it("round trips a calendar date", () => {
    expect(toDateOnly(fromDateOnly("2026-08-25"))).toBe("2026-08-25");
  });

  it("anchors a date-only value at UTC midnight", () => {
    expect(fromDateOnly("2026-08-25").toISOString()).toBe(
      "2026-08-25T00:00:00.000Z",
    );
  });

  it("reads the calendar day off any time of day", () => {
    for (const hour of [0, 9, 13, 23]) {
      expect(toDateOnly(new Date(Date.UTC(2026, 7, 25, hour)))).toBe("2026-08-25");
    }
  });

  it("accepts an ISO string as readily as a Date", () => {
    expect(toDateOnly("2026-08-25T00:00:00.000Z")).toBe("2026-08-25");
  });
});

describe("dateOnlyForDisplay", () => {
  it("renders the stored day, not the day before, west of UTC", () => {
    // Formatting a UTC-midnight value directly is the classic off-by-one:
    // 2026-08-25T00:00Z is 2026-08-24 14:00 in Honolulu.
    const display = dateOnlyForDisplay("2026-08-25T00:00:00.000Z");
    expect(display.getFullYear()).toBe(2026);
    expect(display.getMonth()).toBe(7);
    expect(display.getDate()).toBe(25);
  });
});

describe("overdue", () => {
  /**
   * "Overdue" is asked from where the viewer is standing, so `now` is built as
   * local noon on the 25th rather than a fixed UTC instant. An earlier version
   * of these tests pinned 12:00Z and only passed west of UTC: at 12:00Z it is
   * already the 26th in Auckland, where a card due the 25th genuinely is
   * overdue. The function was right and the test was wrong.
   */
  const localNoon = (year: number, month: number, day: number) =>
    new Date(year, month - 1, day, 12, 0, 0);

  it("treats today as not overdue", () => {
    const now = localNoon(2026, 8, 25);
    expect(isOverdue(fromDateOnly("2026-08-25"), now)).toBe(false);
    expect(isDueToday(fromDateOnly("2026-08-25"), now)).toBe(true);
  });

  it("treats yesterday as overdue", () => {
    expect(isOverdue(fromDateOnly("2026-08-24"), localNoon(2026, 8, 25))).toBe(true);
  });

  it("treats tomorrow as not overdue", () => {
    expect(isOverdue(fromDateOnly("2026-08-26"), localNoon(2026, 8, 25))).toBe(false);
  });

  it("answers from the viewer's calendar, not UTC", () => {
    // Same instant, two zones, two correct answers. This is the behaviour the
    // old test accidentally asserted away.
    process.env.TZ = "Pacific/Auckland";
    const instant = new Date("2026-08-25T12:00:00.000Z"); // already the 26th there
    expect(isOverdue(fromDateOnly("2026-08-25"), instant)).toBe(true);
  });
});

describe("moveToDay", () => {
  it("puts an all-day card on the target calendar day", () => {
    const moved = moveToDay(new Date(2026, 7, 25, 17, 0), null, true);
    expect(toDateOnly(moved)).toBe("2026-08-25");
    expect(moved.toISOString()).toBe("2026-08-25T00:00:00.000Z");
  });

  it("keeps the time of day on a timed card", () => {
    const existing = new Date("2026-08-20T14:30:00.000Z");
    const moved = moveToDay(new Date(2026, 7, 25, 9, 0), existing, false);
    expect(toDateOnly(moved)).toBe("2026-08-25");
    expect(moved.getUTCHours()).toBe(14);
    expect(moved.getUTCMinutes()).toBe(30);
  });

  it("falls back to the calendar day when a timed card has no previous date", () => {
    const moved = moveToDay(new Date(2026, 7, 25), null, false);
    expect(moved.toISOString()).toBe("2026-08-25T00:00:00.000Z");
  });
});

describe("across timezones", () => {
  for (const zone of ZONES) {
    it(`agrees on the calendar day in ${zone}`, () => {
      process.env.TZ = zone;

      // The property that was broken: whatever zone the person setting the
      // date is in, the stored value reads back as the day they picked.
      const stored = fromDateOnly("2026-08-25");
      expect(toDateOnly(stored)).toBe("2026-08-25");

      const display = dateOnlyForDisplay(stored);
      expect(display.getDate()).toBe(25);
      expect(display.getMonth()).toBe(7);
    });
  }

  it("reads the local calendar day of a Date for day-cell matching", () => {
    const day = new Date(2026, 7, 25, 0, 0, 0);
    expect(localDateOnly(day)).toBe("2026-08-25");
  });

  it("agrees with todayDateOnly for the current moment", () => {
    const now = new Date();
    expect(localDateOnly(now)).toBe(todayDateOnly(now));
  });
});

describe("regression: the bug this module exists to prevent", () => {
  it("does not slip a day east of UTC, where local parsing did", () => {
    process.env.TZ = "Pacific/Auckland";
    const picked = "2026-08-25";

    // What the date inputs used to do. In Auckland (UTC+13) 09:00 local on the
    // 25th is 20:00Z on the 24th, so the all-day slice sent Google the 24th and
    // the card turned up a day early.
    const viaLocalParsing = new Date(`${picked}T09:00:00`);
    expect(toDateOnly(viaLocalParsing)).toBe("2026-08-24");

    // What they do now.
    expect(toDateOnly(fromDateOnly(picked))).toBe("2026-08-25");
  });

  it("does not slip a day west of UTC either", () => {
    process.env.TZ = "Pacific/Honolulu";
    const picked = "2026-08-25";
    expect(toDateOnly(fromDateOnly(picked))).toBe("2026-08-25");
    expect(dateOnlyForDisplay(fromDateOnly(picked)).getDate()).toBe(25);
  });
});
