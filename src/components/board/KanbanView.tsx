"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { COLOR_CLASSES, type ColorName } from "@/lib/constants";
import type { View } from "@/db/schema";
import type { BoardBundle, CardData } from "@/lib/queries";
import type { CardMutations } from "./BoardApp";
import { CardTile } from "./CardTile";
import { UNGROUPED, groupCards } from "./view-model";

export function KanbanView({
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
  const groupProperty = bundle.properties.find(
    (property) => property.id === view.groupByPropertyId,
  );
  const groups = useMemo(
    () => groupCards(cards, groupProperty),
    [cards, groupProperty],
  );

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragging = cards.find((card) => card.id === draggingId) ?? null;

  // A few pixels of travel before a drag starts, so a click to open a card is
  // not swallowed by the drag sensor.
  //
  // The keyboard sensor is not a nicety: moving a card between columns is the
  // central act of this app, and without it that act requires a mouse. Space
  // picks a card up, the arrow keys move it, Space drops it, Escape cancels.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // dnd-kit treats Enter as a drag activator as well as Space. On a board
      // that steals the key people expect to open a card with, so dragging is
      // Space only and Enter is left to do the obvious thing.
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space"],
      },
    }),
  );

  /**
   * Spoken to screen readers as a drag proceeds. dnd-kit ships defaults, but
   * they talk about positions in a list; on a kanban board the column is the
   * thing that matters, so these say which one you are over.
   */
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const card = cards.find((candidate) => candidate.id === active.id);
      return `Picked up ${card?.title ?? "card"}. Use the arrow keys to move it, space to drop, escape to cancel.`;
    },
    onDragOver: ({ active, over }) => {
      const card = cards.find((candidate) => candidate.id === active.id);
      const groupId = (over?.data.current as { groupId?: string } | undefined)?.groupId;
      const group = groups.find((candidate) => candidate.id === groupId);
      if (!group) return undefined;
      return `${card?.title ?? "Card"} is over ${group.name}.`;
    },
    onDragEnd: ({ active, over }) => {
      const card = cards.find((candidate) => candidate.id === active.id);
      const groupId = (over?.data.current as { groupId?: string } | undefined)?.groupId;
      const group = groups.find((candidate) => candidate.id === groupId);
      return group
        ? `Dropped ${card?.title ?? "card"} in ${group.name}.`
        : `Dropped ${card?.title ?? "card"}.`;
    },
    onDragCancel: ({ active }) => {
      const card = cards.find((candidate) => candidate.id === active.id);
      return `Cancelled. ${card?.title ?? "The card"} was returned to where it started.`;
    },
  };

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over) return;

    const cardId = String(active.id);
    const overData = over.data.current as
      | { groupId?: string; cardId?: string }
      | undefined;
    const targetGroupId = overData?.groupId;
    if (!targetGroupId) return;

    const target = groups.find((group) => group.id === targetGroupId);
    if (!target) return;

    const withoutMoved = target.cards.filter((card) => card.id !== cardId);
    const overCardId = overData?.cardId;
    const index = overCardId
      ? withoutMoved.findIndex((card) => card.id === overCardId)
      : withoutMoved.length;
    const insertAt = index === -1 ? withoutMoved.length : index;

    mutations.move({
      cardId,
      optionId: targetGroupId === UNGROUPED ? null : targetGroupId,
      afterCardId: withoutMoved[insertAt - 1]?.id ?? null,
      beforeCardId: withoutMoved[insertAt]?.id ?? null,
    });
  }

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements }}
      collisionDetection={closestCorners}
      onDragStart={(event: DragStartEvent) => setDraggingId(String(event.active.id))}
      onDragCancel={() => setDraggingId(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="thin-scroll flex h-full items-start gap-3 overflow-x-auto px-4 py-4">
        {groups.map((group) => (
          <Column
            key={group.id}
            groupId={group.id}
            name={group.name}
            color={group.color}
            cards={group.cards}
            view={view}
            bundle={bundle}
            mutations={mutations}
            draggingId={draggingId}
          />
        ))}
      </div>

      {/* The overlay is what the cursor carries; without it the card would
          jump between columns as the layout reflows mid-drag. */}
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="w-72 rotate-1">
            <CardTile
              card={dragging}
              properties={bundle.properties}
              visibleProperties={view.visibleProperties}
              members={bundle.members}
              onOpen={() => {}}
              dragging
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  groupId,
  name,
  color,
  cards,
  view,
  bundle,
  mutations,
  draggingId,
}: {
  groupId: string;
  name: string;
  color: string;
  cards: CardData[];
  view: View;
  bundle: BoardBundle;
  mutations: CardMutations;
  draggingId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${groupId}`,
    data: { groupId },
  });
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");

  const dot = (COLOR_CLASSES[color as ColorName] ?? COLOR_CLASSES.slate).dot;

  return (
    <section
      ref={setNodeRef}
      className={`flex max-h-full w-72 shrink-0 flex-col rounded-xl border bg-[color:var(--color-surface)] transition-colors ${
        isOver
          ? "border-indigo-500/50 bg-indigo-500/5"
          : "border-[color:var(--color-line)]"
      }`}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
        <h2 className="text-sm font-medium">{name}</h2>
        <span className="text-xs text-[color:var(--color-ink-faint)]">
          {cards.length}
        </span>
        <button
          className="btn-ghost ml-auto px-1.5 py-0.5 text-sm"
          onClick={() => setComposing(true)}
          aria-label={`Add a card to ${name}`}
        >
          +
        </button>
      </header>

      <div className="thin-scroll flex min-h-2 flex-col gap-2 overflow-y-auto px-2 pb-2">
        <SortableContext
          items={cards.map((card) => card.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              groupId={groupId}
              view={view}
              bundle={bundle}
              mutations={mutations}
              hidden={draggingId === card.id}
            />
          ))}
        </SortableContext>

        {composing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const clean = title.trim();
              if (clean) mutations.create({ title: clean, optionId: groupId });
              setTitle("");
              // Stay open: adding cards to a column is rarely a single act.
            }}
          >
            <textarea
              autoFocus
              rows={2}
              className="field resize-none text-sm"
              placeholder="What needs doing?"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setComposing(false);
                  setTitle("");
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              onBlur={() => {
                if (!title.trim()) setComposing(false);
              }}
            />
          </form>
        ) : null}
      </div>
    </section>
  );
}

function SortableCard({
  card,
  groupId,
  view,
  bundle,
  mutations,
  hidden,
}: {
  card: CardData;
  groupId: string;
  view: View;
  bundle: BoardBundle;
  mutations: CardMutations;
  hidden: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: card.id, data: { groupId, cardId: card.id } });

  return (
    // A button, not a div: dnd-kit's keyboard sensor needs the handle to be
    // focusable and to announce itself, and Enter should open the card the way
    // clicking it does. The tile inside carries the visuals only.
    <button
      type="button"
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 ${
        hidden ? "dragging-source" : ""
      }`}
      {...attributes}
      {...listeners}
      // Spread last, and calling through, because the listeners object carries
      // its own onKeyDown: putting this above the spread meant it was silently
      // replaced and Enter did nothing at all.
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          mutations.open(card.id);
          return;
        }
        listeners?.onKeyDown?.(event);
      }}
    >
      <CardTile
        card={card}
        properties={bundle.properties}
        visibleProperties={view.visibleProperties}
        members={bundle.members}
        onOpen={() => mutations.open(card.id)}
      />
    </button>
  );
}
