import { describe, expect, it } from "vitest";
import type { BoardProperty, View } from "@/db/schema";
import type { CardData, Member } from "@/lib/queries";
import {
  OP_LABELS,
  VALUELESS_OPS,
  defaultFilterFor,
  describeFilter,
  filterTargets,
  opsFor,
} from "./filter-options";
import { matchesFilters } from "./view-model";

const STATUS: BoardProperty = {
  id: "prp_status",
  boardId: "brd_1",
  name: "Status",
  type: "select",
  options: [{ id: "opt_todo", name: "Backlog", color: "slate" }],
  doneOptionId: null,
  position: 1000,
  createdAt: new Date(),
};

const MEMBERS: Member[] = [
  {
    id: "usr_1",
    name: "Omesh",
    email: "o@example.test",
    avatarColor: "indigo",
    role: "owner",
  },
];

describe("filterTargets", () => {
  it("offers the built-in card fields as well as board properties", () => {
    const targets = filterTargets([STATUS], MEMBERS);
    expect(targets.map((t) => t.id)).toEqual([
      "title",
      "dueAt",
      "assignee",
      "prp_status",
    ]);
  });

  it("carries a select's options through so the value can be picked", () => {
    const targets = filterTargets([STATUS], MEMBERS);
    expect(targets.at(-1)?.options).toEqual([
      { id: "opt_todo", name: "Backlog" },
    ]);
  });

  it("offers members as the assignee values", () => {
    const assignee = filterTargets([], MEMBERS).find((t) => t.id === "assignee");
    expect(assignee?.options).toEqual([{ id: "usr_1", name: "Omesh" }]);
  });
});

describe("opsFor", () => {
  it("offers contains for text but not for a select", () => {
    expect(opsFor("text")).toContain("contains");
    expect(opsFor("select")).not.toContain("contains");
  });

  it("offers date comparisons only for dates", () => {
    expect(opsFor("date")).toEqual(["before", "after", "isEmpty", "isNotEmpty"]);
    expect(opsFor("text")).not.toContain("before");
  });

  it("never offers an empty operator list", () => {
    for (const kind of [
      "text",
      "select",
      "multiSelect",
      "date",
      "person",
      "checkbox",
      "number",
      "url",
    ] as const) {
      expect(opsFor(kind).length).toBeGreaterThan(0);
    }
  });
});

describe("defaultFilterFor", () => {
  it("preselects the first option of a select, so the filter means something", () => {
    const target = filterTargets([STATUS], MEMBERS).at(-1)!;
    expect(defaultFilterFor(target)).toEqual({
      propertyId: "prp_status",
      op: "is",
      value: "opt_todo",
    });
  });

  it("defaults a checkbox to checked", () => {
    expect(defaultFilterFor({ id: "p", name: "Done", kind: "checkbox" })).toEqual({
      propertyId: "p",
      op: "is",
      value: "true",
    });
  });
});

describe("describeFilter", () => {
  const targets = filterTargets([STATUS], MEMBERS);

  it("names the option rather than showing its id", () => {
    expect(
      describeFilter(
        { propertyId: "prp_status", op: "is", value: "opt_todo" },
        targets,
      ),
    ).toBe("Status is Backlog");
  });

  it("omits the value for operators that do not take one", () => {
    expect(
      describeFilter({ propertyId: "title", op: "isEmpty" }, targets),
    ).toBe("Title is empty");
  });
});

describe("the builder and the evaluator agree", () => {
  /**
   * The reason these live in one module. If someone adds an operator to the
   * picker without teaching matchesFilters about it, every card silently passes
   * the filter and the board looks unfiltered for no visible reason.
   */
  const card = (overrides: Partial<CardData> = {}): CardData => ({
    id: "crd_1",
    boardId: "brd_1",
    title: "Ship the invite flow",
    description: null,
    position: 1000,
    startAt: null,
    dueAt: "2026-08-25T00:00:00.000Z",
    allDay: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    assignees: ["usr_1"],
    values: { prp_status: "opt_todo" },
    commentCount: 0,
    ...overrides,
  });

  const view = (filters: View["filters"]): View => ({
    id: "viw_1",
    boardId: "brd_1",
    name: "Board",
    type: "board",
    groupByPropertyId: null,
    filters,
    sort: null,
    visibleProperties: [],
    showExternalEvents: true,
    position: 1000,
    createdAt: new Date(),
  });

  it("has a label for every operator the picker can produce", () => {
    for (const target of filterTargets([STATUS], MEMBERS)) {
      for (const op of opsFor(target.kind)) {
        expect(OP_LABELS[op]).toBeTruthy();
      }
    }
  });

  it("evaluates every operator the picker can produce", () => {
    for (const target of filterTargets([STATUS], MEMBERS)) {
      for (const op of opsFor(target.kind)) {
        const filter = {
          ...defaultFilterFor(target),
          op,
          ...(VALUELESS_OPS.includes(op) ? { value: null } : {}),
        };
        // The contract is a definite answer, not a particular one: an operator
        // the evaluator does not know falls through to `true` for everything,
        // which is the silent failure this guards against.
        expect(typeof matchesFilters(card(), view([filter]))).toBe("boolean");
      }
    }
  });

  it("actually discriminates, rather than passing everything", () => {
    const matching = view([
      { propertyId: "prp_status", op: "is", value: "opt_todo" },
    ]);
    const notMatching = view([
      { propertyId: "prp_status", op: "is", value: "opt_other" },
    ]);
    expect(matchesFilters(card(), matching)).toBe(true);
    expect(matchesFilters(card(), notMatching)).toBe(false);
  });
});
