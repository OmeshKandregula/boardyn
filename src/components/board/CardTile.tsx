"use client";

import { format } from "date-fns";
import { Avatar } from "@/components/Avatar";
import { COLOR_CLASSES, type ColorName } from "@/lib/constants";
import { dateOnlyForDisplay, isOverdue } from "@/lib/dates";
import type { BoardProperty } from "@/db/schema";
import type { CardData, Member } from "@/lib/queries";
import { isCardComplete, optionById, renderValue } from "./view-model";

/**
 * The card as it appears in a column or a gallery. Everything on it is a
 * signal someone scanning the board needs: what it is, who has it, when it is
 * due, and whichever properties this view chose to surface.
 */
export function CardTile({
  card,
  properties,
  visibleProperties,
  members,
  onOpen,
  dragging = false,
}: {
  card: CardData;
  properties: BoardProperty[];
  visibleProperties: string[];
  members: Member[];
  onOpen: () => void;
  dragging?: boolean;
}) {
  const shown = properties.filter((property) =>
    visibleProperties.includes(property.id),
  );

  // Rendered from the calendar day, not the stored instant: a due date is the
  // same day for both founders regardless of where either of them is.
  const due = card.dueAt ? dateOnlyForDisplay(card.dueAt) : null;
  const complete = isCardComplete(card, properties);
  // A finished card is not late, however long ago it was due.
  const overdue = card.dueAt ? isOverdue(card.dueAt) && !complete : false;

  return (
    <article
      onClick={onOpen}
      className={`group cursor-pointer rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface-raised)] p-3 transition-shadow hover:border-indigo-500/40 ${
        dragging ? "shadow-2xl ring-1 ring-indigo-500/40" : ""
      }`}
    >
      <p className="text-sm leading-snug">{card.title}</p>

      {shown.length > 0 || due || card.assignees.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {shown.map((property) => (
            <PropertyChip
              key={property.id}
              property={property}
              value={card.values[property.id]}
              members={members}
            />
          ))}

          {due ? (
            <span
              className={`rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${
                overdue
                  ? "bg-rose-500/15 text-rose-300 ring-rose-400/25"
                  : "bg-white/5 text-[color:var(--color-ink-muted)] ring-white/10"
              }`}
              title={complete ? "Was due" : overdue ? "Past due" : "Due"}
            >
              {format(due, "MMM d")}
            </span>
          ) : null}

          <span className="ml-auto flex -space-x-1.5">
            {card.assignees.map((userId) => {
              const member = members.find((candidate) => candidate.id === userId);
              return member ? (
                <Avatar
                  key={userId}
                  name={member.name}
                  color={member.avatarColor}
                  size="xs"
                />
              ) : null;
            })}
          </span>
        </div>
      ) : null}

      {card.commentCount > 0 ? (
        <p className="mt-2 text-[11px] text-[color:var(--color-ink-faint)]">
          {card.commentCount} comment{card.commentCount === 1 ? "" : "s"}
        </p>
      ) : null}
    </article>
  );
}

export function PropertyChip({
  property,
  value,
  members,
}: {
  property: BoardProperty;
  value: unknown;
  members: Member[];
}) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) {
    return null;
  }

  if (property.type === "select") {
    const option = optionById(property, value);
    if (!option) return null;
    const classes =
      COLOR_CLASSES[option.color as ColorName] ?? COLOR_CLASSES.slate;
    return (
      <span
        className={`rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${classes.chip}`}
      >
        {option.name}
      </span>
    );
  }

  if (property.type === "multiSelect" && Array.isArray(value)) {
    return (
      <>
        {value.map((optionId) => {
          const option = optionById(property, optionId);
          if (!option) return null;
          const classes =
            COLOR_CLASSES[option.color as ColorName] ?? COLOR_CLASSES.slate;
          return (
            <span
              key={String(optionId)}
              className={`rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${classes.chip}`}
            >
              {option.name}
            </span>
          );
        })}
      </>
    );
  }

  if (property.type === "checkbox") {
    return value ? (
      <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-300 ring-1 ring-inset ring-emerald-400/25">
        {property.name}
      </span>
    ) : null;
  }

  return (
    <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] text-[color:var(--color-ink-muted)] ring-1 ring-inset ring-white/10">
      {renderValue(property, value, members)}
    </span>
  );
}
