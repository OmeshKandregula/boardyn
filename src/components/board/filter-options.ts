import type { BoardProperty, ViewFilter } from "@/db/schema";
import type { Member } from "@/lib/queries";

/**
 * What a filter can say about each kind of property, and what control the value
 * needs. Kept next to the filter evaluator in view-model.ts rather than inside
 * the component, so the set of operators a user can build and the set the
 * evaluator understands cannot drift apart.
 */

export type FilterOp = ViewFilter["op"];

export const OP_LABELS: Record<FilterOp, string> = {
  is: "is",
  isNot: "is not",
  contains: "contains",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  before: "is before",
  after: "is after",
};

/** Operators that need no value: showing an input for them would be a lie. */
export const VALUELESS_OPS: FilterOp[] = ["isEmpty", "isNotEmpty"];

export type FilterTarget = {
  id: string;
  name: string;
  /** Drives both the operator list and the value control. */
  kind: "text" | "select" | "multiSelect" | "date" | "person" | "checkbox" | "number" | "url";
  options?: { id: string; name: string }[];
};

/**
 * Everything filterable on a board: the built-in card fields first, since
 * "title contains" and "due before" are what people reach for, then whatever
 * properties this board has grown.
 */
export function filterTargets(
  properties: BoardProperty[],
  members: Member[],
): FilterTarget[] {
  return [
    { id: "title", name: "Title", kind: "text" },
    { id: "dueAt", name: "Due date", kind: "date" },
    {
      id: "assignee",
      name: "Assignee",
      kind: "person",
      options: members.map((member) => ({ id: member.id, name: member.name })),
    },
    ...properties.map((property) => ({
      id: property.id,
      name: property.name,
      kind: property.type as FilterTarget["kind"],
      options: property.options.map((option) => ({
        id: option.id,
        name: option.name,
      })),
    })),
  ];
}

export function opsFor(kind: FilterTarget["kind"]): FilterOp[] {
  switch (kind) {
    case "text":
    case "url":
      return ["contains", "is", "isEmpty", "isNotEmpty"];
    case "date":
      return ["before", "after", "isEmpty", "isNotEmpty"];
    case "select":
    case "multiSelect":
    case "person":
      return ["is", "isNot", "isEmpty", "isNotEmpty"];
    case "checkbox":
      return ["is"];
    case "number":
      return ["is", "isNot", "isEmpty", "isNotEmpty"];
    default:
      return ["is", "isEmpty", "isNotEmpty"];
  }
}

/** A readable rendering of a saved filter, for the chip in the toolbar. */
export function describeFilter(
  filter: ViewFilter,
  targets: FilterTarget[],
): string {
  const target = targets.find((candidate) => candidate.id === filter.propertyId);
  const name = target?.name ?? "Unknown";
  const op = OP_LABELS[filter.op];

  if (VALUELESS_OPS.includes(filter.op)) return `${name} ${op}`;

  const label =
    target?.options?.find((option) => option.id === filter.value)?.name ??
    (target?.kind === "checkbox"
      ? filter.value === "true"
        ? "checked"
        : "unchecked"
      : filter.value) ??
    "";

  return `${name} ${op} ${label}`;
}

/** A sensible starting filter when a property is picked from the menu. */
export function defaultFilterFor(target: FilterTarget): ViewFilter {
  const op = opsFor(target.kind)[0];
  if (VALUELESS_OPS.includes(op)) return { propertyId: target.id, op };

  const value =
    target.kind === "checkbox"
      ? "true"
      : target.options?.[0]?.id ?? "";

  return { propertyId: target.id, op, value };
}
