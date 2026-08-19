import { describe, expect, it } from "vitest";
import { CALENDAR_PALETTE, assignCalendarColors } from "./calendar-colors";

const member = (id: string, avatarColor: string) => ({ id, avatarColor });

describe("assignCalendarColors", () => {
  it("keeps each member's own avatar colour when it is free", () => {
    const colors = assignCalendarColors([
      member("usr_a", "indigo"),
      member("usr_b", "teal"),
    ]);
    expect(colors.get("usr_a")).toBe("indigo");
    expect(colors.get("usr_b")).toBe("teal");
  });

  it("never gives two people the same colour", () => {
    // The property the overlay depends on: two people sharing a colour makes
    // the calendar unreadable exactly when it matters, with both diaries shown.
    const clashing = [
      member("usr_a", "indigo"),
      member("usr_b", "indigo"),
      member("usr_c", "indigo"),
    ];
    const colors = assignCalendarColors(clashing);
    const used = clashing.map((m) => colors.get(m.id));
    expect(new Set(used).size).toBe(3);
  });

  it("moves a clashing member to the next colour along, not a random one", () => {
    const colors = assignCalendarColors([
      member("usr_a", "indigo"),
      member("usr_b", "indigo"),
    ]);
    const next =
      CALENDAR_PALETTE[
        (CALENDAR_PALETTE.indexOf("indigo") + 1) % CALENDAR_PALETTE.length
      ];
    expect(colors.get("usr_a")).toBe("indigo");
    expect(colors.get("usr_b")).toBe(next);
  });

  it("gives the same answer whatever order the members arrive in", () => {
    // Rows come back ordered by name, which changes when somebody is renamed.
    // The colours must not shuffle underneath people when that happens.
    const a = member("usr_a", "indigo");
    const b = member("usr_b", "indigo");
    const forwards = assignCalendarColors([a, b]);
    const backwards = assignCalendarColors([b, a]);
    expect(forwards.get("usr_a")).toBe(backwards.get("usr_a"));
    expect(forwards.get("usr_b")).toBe(backwards.get("usr_b"));
  });

  it("assigns something to everyone even past the size of the palette", () => {
    const many = Array.from({ length: CALENDAR_PALETTE.length + 3 }, (_, i) =>
      member(`usr_${i}`, "indigo"),
    );
    const colors = assignCalendarColors(many);
    expect(colors.size).toBe(many.length);
    for (const m of many) {
      expect(CALENDAR_PALETTE).toContain(colors.get(m.id));
    }
  });

  it("falls back to a real colour when the stored one is nonsense", () => {
    const colors = assignCalendarColors([member("usr_a", "chartreuse")]);
    expect(CALENDAR_PALETTE).toContain(colors.get("usr_a"));
  });

  it("handles an empty workspace", () => {
    expect(assignCalendarColors([]).size).toBe(0);
  });
});

describe("the palette itself", () => {
  it("leaves out the neutral, which reads as no colour on a dark grid", () => {
    expect(CALENDAR_PALETTE).not.toContain("slate");
  });

  it("never assigns the neutral, even to somebody whose avatar is slate", () => {
    const colors = assignCalendarColors([{ id: "usr_a", avatarColor: "slate" }]);
    expect(colors.get("usr_a")).not.toBe("slate");
  });
});
