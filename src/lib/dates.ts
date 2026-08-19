/**
 * Dates on a board come in two kinds, and conflating them is where calendar
 * apps go wrong.
 *
 * A *date-only* value ("due Tuesday") is a calendar date. It means the same
 * day to everyone looking at the board, whatever timezone they are in. It is
 * stored as UTC midnight of that day, which gives it one unambiguous
 * representation that survives the trip to Google and back.
 *
 * An *instant* ("the standup at 09:00") is a moment in time. It is stored as
 * the real timestamp and rendered in the viewer's local zone, because that is
 * what someone means when they put a time on something.
 *
 * The rule that keeps the two straight: never build a date-only value with
 * `new Date("2026-08-25T09:00:00")`. That is parsed as local time, so east of
 * UTC it lands on the previous day once converted, and the card shows up on
 * the wrong day in Google Calendar. Use `fromDateOnly` instead.
 */

/** "2026-08-25" to the instant that represents that calendar day. */
export function fromDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** The calendar day a stored date-only value represents. */
export function toDateOnly(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

/**
 * A Date positioned at local midnight of the same calendar day, purely so
 * date-fns can format it without shifting it. Formatting a UTC-midnight value
 * directly would render the day before for anyone west of UTC.
 */
export function dateOnlyForDisplay(value: Date | string): Date {
  const [year, month, day] = toDateOnly(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Today, as the viewer's calendar reckons it. */
export function todayDateOnly(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Local calendar day of a Date, for comparing against a date-only value. */
export function localDateOnly(date: Date): string {
  return todayDateOnly(date);
}

/**
 * Past due if the day has already gone by where the viewer is. Comparing the
 * strings avoids every hour-offset trap: they are fixed-width and sort
 * lexicographically in calendar order.
 */
export function isOverdue(dueAt: Date | string, now: Date = new Date()): boolean {
  return toDateOnly(dueAt) < todayDateOnly(now);
}

export function isDueToday(dueAt: Date | string, now: Date = new Date()): boolean {
  return toDateOnly(dueAt) === todayDateOnly(now);
}

/**
 * Moves a card to a different calendar day, keeping its time of day when it
 * has a real one. Dragging a card across a calendar should not silently turn
 * a 14:00 review into a midnight one.
 */
export function moveToDay(
  target: Date,
  existing: Date | string | null,
  allDay: boolean,
): Date {
  const day = localDateOnly(target);
  if (allDay || !existing) return fromDateOnly(day);

  const previous = typeof existing === "string" ? new Date(existing) : existing;
  const moved = new Date(`${day}T00:00:00.000Z`);
  moved.setUTCHours(
    previous.getUTCHours(),
    previous.getUTCMinutes(),
    previous.getUTCSeconds(),
    0,
  );
  return moved;
}
