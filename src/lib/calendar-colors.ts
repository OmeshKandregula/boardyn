import { COLORS, type ColorName } from "./constants";

/**
 * Slate is the neutral in this palette: it is what an ungrouped lane and a
 * plain chip already use. On a dark calendar it reads as "no colour", so
 * whoever drew it looked unassigned rather than distinct. Calendars get the
 * seven colours that actually say something.
 */
export const CALENDAR_PALETTE = COLORS.filter(
  (color) => color !== "slate",
) as readonly ColorName[];

/**
 * Which colour each member's calendar is drawn in.
 *
 * Deliberately deterministic rather than random. A colour picked at random
 * would be a different colour next session, or on the other person's screen,
 * which defeats the point: the whole value of the legend is that after a day
 * of use you stop reading it and just know that teal is your co-founder.
 *
 * Each member's avatar colour is the first preference, so the calendar agrees
 * with the avatars everywhere else in the app. Collisions are the reason this
 * is not a one-liner: two people sharing a colour makes an overlay useless, so
 * anyone whose preference is taken is moved to the next free one. Ordering by
 * member id keeps that resolution stable no matter what order the rows arrive
 * in.
 */
export function assignCalendarColors<T extends { id: string; avatarColor: string }>(
  members: T[],
): Map<string, ColorName> {
  const assigned = new Map<string, ColorName>();
  const taken = new Set<ColorName>();

  // Stable order in, stable colours out: sorting by id means the same set of
  // people always resolve collisions the same way.
  const ordered = [...members].sort((a, b) => a.id.localeCompare(b.id));

  for (const member of ordered) {
    const preferred = CALENDAR_PALETTE.includes(member.avatarColor as ColorName)
      ? (member.avatarColor as ColorName)
      : CALENDAR_PALETTE[0];

    if (!taken.has(preferred)) {
      assigned.set(member.id, preferred);
      taken.add(preferred);
      continue;
    }

    // Walk the palette from the preferred colour so the substitute is a
    // predictable neighbour rather than an arbitrary jump.
    const start = CALENDAR_PALETTE.indexOf(preferred);
    let chosen: ColorName | null = null;
    for (let step = 1; step <= CALENDAR_PALETTE.length; step++) {
      const candidate = CALENDAR_PALETTE[(start + step) % CALENDAR_PALETTE.length];
      if (!taken.has(candidate)) {
        chosen = candidate;
        break;
      }
    }

    // More members than colours: reuse rather than leave anyone undrawn. Past
    // seven people on one calendar the legend is doing the disambiguating.
    const final = chosen ?? preferred;
    assigned.set(member.id, final);
    taken.add(final);
  }

  return assigned;
}
