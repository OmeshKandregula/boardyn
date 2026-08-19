"use client";

import { useState } from "react";
import { updateView } from "@/app/actions/boards";
import { fromDateOnly, toDateOnly } from "@/lib/dates";
import { Avatar } from "@/components/Avatar";
import type { View } from "@/db/schema";
import type { BoardBundle, CardData } from "@/lib/queries";
import type { CardMutations } from "./BoardApp";
import { PropertyEditor } from "./PropertyEditor";

/**
 * The spreadsheet reading of the same cards. Sorting is a view setting rather
 * than a per-session toggle, so "sorted by due date" is something you set once
 * and both of you see.
 */
export function TableView({
  cards,
  view,
  bundle,
  mutations,
}: {
  cards: CardData[];
  view: View;
  bundle: BoardBundle;
  mutations: CardMutations;
}) {
  const [title, setTitle] = useState("");
  const shown = bundle.properties.filter((property) =>
    view.visibleProperties.includes(property.id),
  );

  const toggleSort = (propertyId: string) => {
    const current = view.sort;
    const direction =
      current?.propertyId === propertyId && current.direction === "asc"
        ? "desc"
        : "asc";
    void updateView(view.id, { sort: { propertyId, direction } });
  };

  const sortMark = (propertyId: string) =>
    view.sort?.propertyId === propertyId
      ? view.sort.direction === "asc"
        ? " ↑"
        : " ↓"
      : "";

  return (
    <div className="thin-scroll h-full overflow-auto px-4 py-4">
      <table className="w-full min-w-3xl border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="text-left text-xs text-[color:var(--color-ink-muted)]">
            <Th onClick={() => toggleSort("title")}>Title{sortMark("title")}</Th>
            {shown.map((property) => (
              <Th key={property.id} onClick={() => toggleSort(property.id)}>
                {property.name}
                {sortMark(property.id)}
              </Th>
            ))}
            <Th onClick={() => toggleSort("dueAt")}>Due{sortMark("dueAt")}</Th>
            <Th>Assignees</Th>
          </tr>
        </thead>

        <tbody>
          {cards.map((card) => (
            <tr
              key={card.id}
              className="group hover:bg-white/[0.03]"
            >
              <Td>
                <button
                  className="text-left hover:underline"
                  onClick={() => mutations.open(card.id)}
                >
                  {card.title}
                </button>
              </Td>

              {shown.map((property) => (
                <Td key={property.id}>
                  <PropertyEditor
                    compact
                    property={property}
                    value={card.values[property.id]}
                    members={bundle.members}
                    onChange={(next) =>
                      mutations.setValue(card.id, property.id, next)
                    }
                  />
                </Td>
              ))}

              <Td>
                <input
                  type="date"
                  className="field py-1 text-xs"
                  value={card.dueAt ? toDateOnly(card.dueAt) : ""}
                  onChange={(event) =>
                    mutations.patch(card.id, {
                      dueAt: event.target.value
                        ? fromDateOnly(event.target.value).toISOString()
                        : null,
                    })
                  }
                />
              </Td>

              <Td>
                <div className="flex flex-wrap gap-1">
                  {bundle.members.map((member) => {
                    const on = card.assignees.includes(member.id);
                    return (
                      <button
                        key={member.id}
                        onClick={() => mutations.toggleAssignee(card.id, member.id)}
                        className={on ? "" : "opacity-30 hover:opacity-70"}
                        title={
                          on ? `Unassign ${member.name}` : `Assign ${member.name}`
                        }
                      >
                        <Avatar
                          name={member.name}
                          color={member.avatarColor}
                          size="xs"
                        />
                      </button>
                    );
                  })}
                </div>
              </Td>
            </tr>
          ))}

          <tr>
            <Td colSpan={shown.length + 3}>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const clean = title.trim();
                  if (!clean) return;
                  mutations.create({ title: clean });
                  setTitle("");
                }}
              >
                <input
                  className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-[color:var(--color-ink-faint)]"
                  placeholder="+ New card"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </form>
            </Td>
          </tr>
        </tbody>
      </table>

      {cards.length === 0 ? (
        <p className="mt-6 text-center text-sm text-[color:var(--color-ink-faint)]">
          Nothing here yet.
        </p>
      ) : null}
    </div>
  );
}

function Th({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <th className="border-b border-[color:var(--color-line)] bg-[color:var(--color-canvas)] px-3 py-2 font-medium">
      {onClick ? (
        <button onClick={onClick} className="hover:text-[color:var(--color-ink)]">
          {children}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function Td({
  children,
  colSpan,
}: {
  children: React.ReactNode;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className="border-b border-[color:var(--color-line)]/60 px-3 py-2 align-middle"
    >
      {children}
    </td>
  );
}
