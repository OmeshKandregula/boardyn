import { describe, expect, it } from "vitest";
import type { BoardProperty, View } from "@/db/schema";
import type { CardData, Member } from "@/lib/queries";
import {
  UNGROUPED,
  groupCards,
  matchesFilters,
  renderValue,
  sortCards,
  visibleCards,
} from "./view-model";

const STATUS: BoardProperty = {
  id: "prp_status",
  boardId: "brd_1",
  name: "Status",
  type: "select",
  options: [
    { id: "opt_todo", name: "Backlog", color: "slate" },
    { id: "opt_doing", name: "In progress", color: "sky" },
  ],
  position: 1000,
  createdAt: new Date(),
};

const MEMBERS: Member[] = [
  {
    id: "usr_1",
    name: "Omesh Kandregula",
    email: "omesh@example.test",
    avatarColor: "indigo",
    role: "owner",
  },
];

function card(overrides: Partial<CardData> = {}): CardData {
  return {
    id: "crd_1",
    boardId: "brd_1",
    title: "A card",
    description: null,
    position: 1000,
    startAt: null,
    dueAt: null,
    allDay: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    assignees: [],
    values: {},
    commentCount: 0,
    ...overrides,
  };
}

function view(overrides: Partial<View> = {}): View {
  return {
    id: "viw_1",
    boardId: "brd_1",
    name: "Board",
    type: "board",
    groupByPropertyId: STATUS.id,
    filters: [],
    sort: null,
    visibleProperties: [],
    showExternalEvents: true,
    position: 1000,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("matchesFilters", () => {
  it("keeps everything when no filter is set", () => {
    expect(matchesFilters(card(), view())).toBe(true);
  });

  it("matches a select value by option id", () => {
    const filtered = view({
      filters: [{ propertyId: STATUS.id, op: "is", value: "opt_doing" }],
    });
    expect(matchesFilters(card({ values: { [STATUS.id]: "opt_doing" } }), filtered)).toBe(true);
    expect(matchesFilters(card({ values: { [STATUS.id]: "opt_todo" } }), filtered)).toBe(false);
  });

  it("inverts with isNot", () => {
    const filtered = view({
      filters: [{ propertyId: STATUS.id, op: "isNot", value: "opt_doing" }],
    });
    expect(matchesFilters(card({ values: { [STATUS.id]: "opt_todo" } }), filtered)).toBe(true);
  });

  it("matches titles case-insensitively with contains", () => {
    const filtered = view({
      filters: [{ propertyId: "title", op: "contains", value: "INVITE" }],
    });
    expect(matchesFilters(card({ title: "Ship the invite flow" }), filtered)).toBe(true);
    expect(matchesFilters(card({ title: "Something else" }), filtered)).toBe(false);
  });

  it("treats a missing value as empty", () => {
    const empty = view({ filters: [{ propertyId: STATUS.id, op: "isEmpty" }] });
    expect(matchesFilters(card(), empty)).toBe(true);
    expect(matchesFilters(card({ values: { [STATUS.id]: "opt_todo" } }), empty)).toBe(false);
  });

  it("compares dates with before and after", () => {
    const due = card({ dueAt: "2026-08-20T09:00:00.000Z" });
    expect(
      matchesFilters(due, view({ filters: [{ propertyId: "dueAt", op: "before", value: "2026-08-25" }] })),
    ).toBe(true);
    expect(
      matchesFilters(due, view({ filters: [{ propertyId: "dueAt", op: "after", value: "2026-08-25" }] })),
    ).toBe(false);
  });

  it("requires every filter to pass, not any", () => {
    const both = view({
      filters: [
        { propertyId: "title", op: "contains", value: "ship" },
        { propertyId: STATUS.id, op: "is", value: "opt_doing" },
      ],
    });
    expect(matchesFilters(card({ title: "Ship it", values: { [STATUS.id]: "opt_doing" } }), both)).toBe(true);
    expect(matchesFilters(card({ title: "Ship it", values: { [STATUS.id]: "opt_todo" } }), both)).toBe(false);
  });

  it("matches any entry of a multi-value property", () => {
    const filtered = view({
      filters: [{ propertyId: "assignee", op: "is", value: "usr_2" }],
    });
    expect(matchesFilters(card({ assignees: ["usr_1", "usr_2"] }), filtered)).toBe(true);
    expect(matchesFilters(card({ assignees: ["usr_1"] }), filtered)).toBe(false);
  });
});

describe("sortCards", () => {
  it("falls back to manual position order", () => {
    const cards = [card({ id: "b", position: 2000 }), card({ id: "a", position: 1000 })];
    expect(sortCards(cards, view()).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("sorts by title in both directions", () => {
    const cards = [card({ id: "b", title: "Beta" }), card({ id: "a", title: "Alpha" })];
    expect(
      sortCards(cards, view({ sort: { propertyId: "title", direction: "asc" } })).map((c) => c.id),
    ).toEqual(["a", "b"]);
    expect(
      sortCards(cards, view({ sort: { propertyId: "title", direction: "desc" } })).map((c) => c.id),
    ).toEqual(["b", "a"]);
  });

  it("sinks undated cards to the bottom in both directions", () => {
    // A card with no due date is unscheduled, not "due at the beginning of
    // time". Sorting it to the top would bury the work that is actually due.
    const cards = [
      card({ id: "none", dueAt: null }),
      card({ id: "late", dueAt: "2026-09-01T00:00:00.000Z" }),
      card({ id: "soon", dueAt: "2026-08-20T00:00:00.000Z" }),
    ];

    expect(
      sortCards(cards, view({ sort: { propertyId: "dueAt", direction: "asc" } })).map((c) => c.id),
    ).toEqual(["soon", "late", "none"]);
    expect(
      sortCards(cards, view({ sort: { propertyId: "dueAt", direction: "desc" } })).map((c) => c.id),
    ).toEqual(["late", "soon", "none"]);
  });

  it("does not mutate the array it was given", () => {
    const cards = [card({ id: "b", position: 2000 }), card({ id: "a", position: 1000 })];
    sortCards(cards, view());
    expect(cards.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("groupCards", () => {
  it("keeps an option column even when it is empty", () => {
    // An emptied column has to stay on screen, or there is nowhere to drop a
    // card back into it.
    const groups = groupCards([card({ values: { [STATUS.id]: "opt_todo" } })], STATUS);
    expect(groups.map((g) => g.id)).toEqual(["opt_todo", "opt_doing"]);
    expect(groups[1].cards).toHaveLength(0);
  });

  it("collects unset cards into a catch-all lane, first", () => {
    const groups = groupCards([card({ id: "loose" })], STATUS);
    expect(groups[0].id).toBe(UNGROUPED);
    expect(groups[0].cards.map((c) => c.id)).toEqual(["loose"]);
  });

  it("hides the catch-all lane when nothing is in it", () => {
    const groups = groupCards([card({ values: { [STATUS.id]: "opt_todo" } })], STATUS);
    expect(groups.some((g) => g.id === UNGROUPED)).toBe(false);
  });

  it("sends a card holding a deleted option to the catch-all lane", () => {
    // Deleting an option leaves values behind on purpose; those cards must
    // still appear somewhere rather than vanishing from the board.
    const groups = groupCards([card({ id: "orphan", values: { [STATUS.id]: "opt_gone" } })], STATUS);
    expect(groups[0].id).toBe(UNGROUPED);
    expect(groups[0].cards.map((c) => c.id)).toEqual(["orphan"]);
  });

  it("returns a single lane when the view groups by nothing", () => {
    const groups = groupCards([card(), card({ id: "crd_2" })], undefined);
    expect(groups).toHaveLength(1);
    expect(groups[0].cards).toHaveLength(2);
  });
});

describe("visibleCards", () => {
  it("filters before sorting", () => {
    const cards = [
      card({ id: "keep", title: "Ship it", position: 3000 }),
      card({ id: "drop", title: "Nope", position: 1000 }),
    ];
    const result = visibleCards(
      cards,
      view({ filters: [{ propertyId: "title", op: "contains", value: "ship" }] }),
    );
    expect(result.map((c) => c.id)).toEqual(["keep"]);
  });
});

describe("renderValue", () => {
  it("renders a select as its option name", () => {
    expect(renderValue(STATUS, "opt_doing", MEMBERS)).toBe("In progress");
  });

  it("renders a deleted option as empty rather than the raw id", () => {
    expect(renderValue(STATUS, "opt_gone", MEMBERS)).toBe("");
  });

  it("renders a person by name", () => {
    const person: BoardProperty = { ...STATUS, id: "prp_owner", type: "person", options: [] };
    expect(renderValue(person, ["usr_1"], MEMBERS)).toBe("Omesh Kandregula");
  });

  it("renders an empty value as an empty string", () => {
    expect(renderValue(STATUS, null, MEMBERS)).toBe("");
  });
});
