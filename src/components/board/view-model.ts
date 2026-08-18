import type { BoardProperty, PropertyOption, View } from "@/db/schema";
import type { CardData, Member } from "@/lib/queries";

/**
 * Filtering, sorting and grouping run on the client. The whole board is already
 * in memory (a board with more cards than fits in a browser is a board nobody
 * can read), so changing a filter is instant and costs no round trip.
 */

export const UNGROUPED = "__ungrouped__";

export type Group = {
  id: string;
  name: string;
  color: string;
  cards: CardData[];
};

export function propertyValue(card: CardData, propertyId: string): unknown {
  if (propertyId === "title") return card.title;
  if (propertyId === "dueAt") return card.dueAt;
  if (propertyId === "createdAt") return card.createdAt;
  if (propertyId === "assignee") return card.assignees;
  return card.values[propertyId];
}

export function matchesFilters(card: CardData, view: View): boolean {
  return view.filters.every((filter) => {
    const raw = propertyValue(card, filter.propertyId);
    const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    const text = list.map((v) => String(v).toLowerCase());
    const needle = (filter.value ?? "").toLowerCase();

    switch (filter.op) {
      case "is":
        return text.includes(needle);
      case "isNot":
        return !text.includes(needle);
      case "contains":
        return text.some((v) => v.includes(needle));
      case "isEmpty":
        return list.length === 0 || text.every((v) => v === "");
      case "isNotEmpty":
        return list.length > 0 && text.some((v) => v !== "");
      case "before":
        return Boolean(raw && filter.value && new Date(String(raw)) < new Date(filter.value));
      case "after":
        return Boolean(raw && filter.value && new Date(String(raw)) > new Date(filter.value));
      default:
        return true;
    }
  });
}

export function sortCards(cards: CardData[], view: View): CardData[] {
  const sorted = [...cards];
  const sort = view.sort;

  if (!sort) {
    return sorted.sort((a, b) => a.position - b.position);
  }

  const direction = sort.direction === "desc" ? -1 : 1;
  return sorted.sort((a, b) => {
    const left = propertyValue(a, sort.propertyId);
    const right = propertyValue(b, sort.propertyId);

    // Empty values sink to the bottom in either direction: a card with no due
    // date is not "earlier than everything", it is unscheduled.
    if (left == null && right == null) return a.position - b.position;
    if (left == null) return 1;
    if (right == null) return -1;

    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * direction;
    }
    return String(left).localeCompare(String(right)) * direction;
  });
}

export function visibleCards(cards: CardData[], view: View): CardData[] {
  return sortCards(
    cards.filter((card) => matchesFilters(card, view)),
    view,
  );
}

/**
 * Kanban columns. Every option becomes a column even when empty, otherwise a
 * cleared column would vanish and there would be nowhere to drop a card back
 * into. The catch-all lane only appears when something is actually in it.
 */
export function groupCards(
  cards: CardData[],
  property: BoardProperty | undefined,
): Group[] {
  if (!property) {
    return [{ id: UNGROUPED, name: "All cards", color: "slate", cards }];
  }

  const groups: Group[] = property.options.map((option: PropertyOption) => ({
    id: option.id,
    name: option.name,
    color: option.color,
    cards: [],
  }));

  const ungrouped: Group = {
    id: UNGROUPED,
    name: `No ${property.name.toLowerCase()}`,
    color: "slate",
    cards: [],
  };

  for (const card of cards) {
    const value = card.values[property.id];
    const target =
      typeof value === "string"
        ? (groups.find((group) => group.id === value) ?? ungrouped)
        : ungrouped;
    target.cards.push(card);
  }

  return ungrouped.cards.length > 0 ? [ungrouped, ...groups] : groups;
}

export function optionById(
  property: BoardProperty | undefined,
  optionId: unknown,
): PropertyOption | undefined {
  if (!property || typeof optionId !== "string") return undefined;
  return property.options.find((option) => option.id === optionId);
}

export function memberById(
  members: Member[],
  userId: string,
): Member | undefined {
  return members.find((member) => member.id === userId);
}

/** Human-readable value for a card property, used by table and card headers. */
export function renderValue(
  property: BoardProperty,
  value: unknown,
  members: Member[],
): string {
  if (value == null || value === "") return "";

  switch (property.type) {
    case "select":
      return optionById(property, value)?.name ?? "";
    case "multiSelect":
      return Array.isArray(value)
        ? value
            .map((id) => optionById(property, id)?.name)
            .filter(Boolean)
            .join(", ")
        : "";
    case "person":
      return Array.isArray(value)
        ? value.map((id) => memberById(members, id)?.name ?? "").join(", ")
        : (memberById(members, String(value))?.name ?? "");
    case "checkbox":
      return value ? "Yes" : "No";
    case "date":
      return new Date(String(value)).toLocaleDateString();
    default:
      return String(value);
  }
}
