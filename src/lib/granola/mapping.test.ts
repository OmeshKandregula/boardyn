import { describe, expect, it } from "vitest";
import type { GranolaNote } from "./client";
import {
  flattenTranscript,
  meetingSummary,
  meetingTimes,
  meetingTitle,
  normaliseAttendees,
  shouldShareWithWorkspace,
} from "./mapping";

const note = (overrides: Partial<GranolaNote> = {}): GranolaNote => ({
  id: "not_abcdefghijklmn",
  title: "Weekly founder sync",
  owner: { name: "Alex", email: "alex@example.test" },
  created_at: "2026-08-19T09:05:00.000Z",
  ...overrides,
});

describe("shouldShareWithWorkspace", () => {
  const team = ["alex@example.test", "sam@example.test"];

  it("shares a meeting two workspace members attended", () => {
    const attendees = [
      { name: "Alex", email: "alex@example.test" },
      { name: "Sam", email: "sam@example.test" },
    ];
    expect(shouldShareWithWorkspace(attendees, team)).toBe(true);
  });

  it("keeps a solo note private", () => {
    expect(
      shouldShareWithWorkspace([{ name: "Alex", email: "alex@example.test" }], team),
    ).toBe(false);
  });

  it("keeps a one-to-one with an outsider private", () => {
    // The case this rule exists for: an interview, an investor call, a
    // conversation with another company. One member plus a stranger is not a
    // meeting the team had.
    const attendees = [
      { name: "Alex", email: "alex@example.test" },
      { name: "A candidate", email: "candidate@elsewhere.test" },
    ];
    expect(shouldShareWithWorkspace(attendees, team)).toBe(false);
  });

  it("shares when the team plus outsiders were present", () => {
    const attendees = [
      { name: "Alex", email: "alex@example.test" },
      { name: "Sam", email: "sam@example.test" },
      { name: "An investor", email: "investor@elsewhere.test" },
    ];
    expect(shouldShareWithWorkspace(attendees, team)).toBe(true);
  });

  it("ignores case in email addresses", () => {
    const attendees = [
      { name: "Alex", email: "Alex@Example.Test" },
      { name: "Sam", email: "SAM@example.test" },
    ];
    expect(shouldShareWithWorkspace(attendees, team)).toBe(true);
  });

  it("does not count the same person twice", () => {
    // Duplicated across the attendee list and the calendar invitees, one
    // person must not look like two and share a private note.
    const attendees = [
      { name: "Alex", email: "alex@example.test" },
      { name: "Alex K", email: "alex@example.test" },
    ];
    expect(shouldShareWithWorkspace(attendees, team)).toBe(false);
  });

  it("does not match on names, only addresses", () => {
    // A name is not an identity. Two people called Alex must not be able to
    // open each other's notes.
    const attendees = [
      { name: "Alex", email: null },
      { name: "Sam", email: null },
    ];
    expect(shouldShareWithWorkspace(attendees, team)).toBe(false);
  });

  it("keeps everything private in a workspace of one", () => {
    const attendees = [
      { name: "Alex", email: "alex@example.test" },
      { name: "Someone", email: "someone@elsewhere.test" },
    ];
    expect(shouldShareWithWorkspace(attendees, ["alex@example.test"])).toBe(false);
  });
});

describe("normaliseAttendees", () => {
  it("merges the attendee list, the calendar invitees and the owner", () => {
    const people = normaliseAttendees(
      note({
        attendees: [{ name: "Sam", email: "sam@example.test" }],
        calendar_event: {
          invitees: [{ name: "Investor", email: "investor@elsewhere.test" }],
          organiser: { name: "Alex", email: "alex@example.test" },
        },
      }),
    );
    expect(people.map((p) => p.email).sort()).toEqual([
      "alex@example.test",
      "investor@elsewhere.test",
      "sam@example.test",
    ]);
  });

  it("dedupes one person appearing in several places", () => {
    const people = normaliseAttendees(
      note({
        attendees: [{ name: null, email: "alex@example.test" }],
        calendar_event: {
          organiser: { name: "Alex Rivera", email: "alex@example.test" },
        },
      }),
    );
    expect(people).toHaveLength(1);
    // The better name wins over the empty one.
    expect(people[0].name).toBe("Alex Rivera");
  });

  it("accepts the American spelling of organiser", () => {
    const people = normaliseAttendees(
      note({
        owner: null,
        calendar_event: { organizer: { name: "Sam", email: "sam@example.test" } },
      }),
    );
    expect(people.map((p) => p.email)).toContain("sam@example.test");
  });

  it("keeps someone who has a name but no address", () => {
    const people = normaliseAttendees(
      note({ owner: null, attendees: [{ name: "Dial-in guest", email: null }] }),
    );
    expect(people).toEqual([{ name: "Dial-in guest", email: null }]);
  });

  it("drops entries with neither name nor address", () => {
    const people = normaliseAttendees(
      note({ owner: null, attendees: [{ name: null, email: null }] }),
    );
    expect(people).toEqual([]);
  });
});

describe("meetingTimes", () => {
  it("prefers the calendar event over when the note was created", () => {
    const times = meetingTimes(
      note({
        created_at: "2026-08-19T09:05:00.000Z",
        calendar_event: {
          start_time: "2026-08-19T09:00:00.000Z",
          end_time: "2026-08-19T09:30:00.000Z",
        },
      }),
    );
    expect(times.startedAt?.toISOString()).toBe("2026-08-19T09:00:00.000Z");
    expect(times.endedAt?.toISOString()).toBe("2026-08-19T09:30:00.000Z");
  });

  it("falls back to the note timestamp for an ad-hoc conversation", () => {
    const times = meetingTimes(note({ calendar_event: null }));
    expect(times.startedAt?.toISOString()).toBe("2026-08-19T09:05:00.000Z");
    expect(times.endedAt).toBeNull();
  });

  it("survives a malformed timestamp", () => {
    const times = meetingTimes(note({ created_at: "not a date", calendar_event: null }));
    expect(times.startedAt).toBeNull();
  });
});

describe("meetingTitle", () => {
  it("uses the note title", () => {
    expect(meetingTitle(note())).toBe("Weekly founder sync");
  });

  it("falls back to the calendar event title", () => {
    expect(
      meetingTitle(note({ title: null, calendar_event: { event_title: "Standup" } })),
    ).toBe("Standup");
  });

  it("never returns an empty string", () => {
    expect(meetingTitle(note({ title: "   ", calendar_event: null }))).toBe(
      "Untitled meeting",
    );
  });
});

describe("flattenTranscript", () => {
  it("labels lines with the speaker", () => {
    expect(
      flattenTranscript([
        { speaker: { name: "Alex" }, text: "Shall we ship it" },
        { speaker: { name: "Sam" }, text: "After the tests" },
      ]),
    ).toBe("Alex: Shall we ship it\nSam: After the tests");
  });

  it("keeps unattributed lines", () => {
    expect(flattenTranscript([{ text: "Someone coughed" }])).toBe("Someone coughed");
  });

  it("returns null rather than an empty string", () => {
    expect(flattenTranscript(null)).toBeNull();
    expect(flattenTranscript([])).toBeNull();
    expect(flattenTranscript([{ text: "  " }])).toBeNull();
  });
});

describe("meetingSummary", () => {
  it("prefers markdown", () => {
    expect(
      meetingSummary(note({ summary_markdown: "## Notes", summary_text: "Notes" })),
    ).toBe("## Notes");
  });

  it("falls back to plain text", () => {
    expect(meetingSummary(note({ summary_markdown: null, summary_text: "Notes" }))).toBe(
      "Notes",
    );
  });

  it("is null when the note has neither", () => {
    expect(meetingSummary(note())).toBeNull();
  });
});
