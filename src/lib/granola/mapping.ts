import type {
  GranolaNote,
  GranolaTranscriptLine,
  GranolaUser,
} from "./client";
import type { MeetingAttendee } from "@/db/schema";

/**
 * Turning a Granola note into a meeting row.
 *
 * Pure, so the decisions that matter here can be tested without a network or a
 * database. The one that matters most is `shouldShareWithWorkspace`.
 */

export function normaliseAttendees(note: GranolaNote): MeetingAttendee[] {
  const raw: GranolaUser[] = [
    ...(note.attendees ?? []),
    ...(note.calendar_event?.invitees ?? []),
    note.calendar_event?.organiser ?? note.calendar_event?.organizer ?? null,
    note.owner ?? null,
  ].filter(Boolean) as GranolaUser[];

  const byEmail = new Map<string, MeetingAttendee>();
  for (const person of raw) {
    const email = person.email?.trim().toLowerCase() ?? null;
    const name = person.name?.trim() || null;
    // Keyed by email where there is one, by name otherwise: the same person
    // arrives from the attendee list and the calendar event, and should be one
    // row rather than two.
    const key = email ?? (name ? `name:${name.toLowerCase()}` : null);
    if (!key) continue;

    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, { name, email });
    } else if (!existing.name && name) {
      existing.name = name;
    }
  }

  return [...byEmail.values()];
}

/**
 * Whether a note becomes visible to the rest of the workspace.
 *
 * Granola records everything its owner attends: one-to-ones, interviews,
 * therapy-adjacent conversations, calls with other companies. Syncing somebody's
 * notes into a shared list and showing the lot would publish all of that to
 * their colleagues, which is not a thing to do by default and not a thing
 * anybody would think to check for.
 *
 * The rule is therefore the narrowest one that still does something useful:
 * two or more people from this workspace were in the room. That is as close as
 * an automatic rule gets to "a meeting the team had". Everything else stays
 * private to the person whose key fetched it, and they can share it by hand.
 */
export function shouldShareWithWorkspace(
  attendees: MeetingAttendee[],
  workspaceEmails: string[],
): boolean {
  const known = new Set(workspaceEmails.map((email) => email.toLowerCase()));
  const matched = new Set<string>();

  for (const attendee of attendees) {
    const email = attendee.email?.toLowerCase();
    if (email && known.has(email)) matched.add(email);
  }

  return matched.size >= 2;
}

export function meetingTimes(note: GranolaNote): {
  startedAt: Date | null;
  endedAt: Date | null;
} {
  const parse = (value?: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  // The calendar event is the real meeting time. created_at is when the note
  // was made, which is close enough to be a decent fallback and wrong enough
  // to prefer the event when there is one.
  return {
    startedAt:
      parse(note.calendar_event?.start_time) ?? parse(note.created_at) ?? null,
    endedAt: parse(note.calendar_event?.end_time) ?? null,
  };
}

export function meetingTitle(note: GranolaNote): string {
  return (
    note.title?.trim() ||
    note.calendar_event?.event_title?.trim() ||
    "Untitled meeting"
  );
}

/** Flattens the transcript into readable text, or null when there is none. */
export function flattenTranscript(
  lines: GranolaTranscriptLine[] | null | undefined,
): string | null {
  if (!lines?.length) return null;

  const text = lines
    .map((line) => {
      const said = line.text?.trim();
      if (!said) return null;
      const speaker = line.speaker?.name?.trim();
      return speaker ? `${speaker}: ${said}` : said;
    })
    .filter(Boolean)
    .join("\n");

  return text || null;
}

/** The summary as markdown, falling back to the plain text version. */
export function meetingSummary(note: GranolaNote): string | null {
  return note.summary_markdown?.trim() || note.summary_text?.trim() || null;
}
