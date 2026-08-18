"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { AVATAR_CLASSES, type ColorName } from "@/lib/constants";
import type { View } from "@/db/schema";
import type { BoardBundle, CardData, ExternalEventData } from "@/lib/queries";
import type { CardMutations } from "./BoardApp";

/**
 * A month grid over the same cards, with everyone's Google Calendar drawn
 * behind them. The point of the overlay is the question a two-person team
 * actually asks: not "when is this due" but "when is there room to do it".
 *
 * Dragging a card to another day rewrites its due date, which the sync then
 * pushes back out to Google.
 */
export function CalendarView({
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
  const [anchor, setAnchor] = useState(() => new Date());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [anchor]);

  const scheduled = cards.filter((card) => card.dueAt);
  const unscheduled = cards.filter((card) => !card.dueAt);

  const events = view.showExternalEvents ? bundle.externalEvents : [];

  function handleDragEnd(event: DragEndEvent) {
    const dayIso = event.over?.id ? String(event.over.id) : null;
    if (!dayIso?.startsWith("day:")) return;

    const cardId = String(event.active.id);
    const card = cards.find((candidate) => candidate.id === cardId);
    if (!card) return;

    // Keep the time of day if the card had one; only the date is being moved.
    const target = new Date(dayIso.slice(4));
    const existing = card.dueAt ? new Date(card.dueAt) : null;
    if (existing && !card.allDay) {
      target.setHours(existing.getHours(), existing.getMinutes(), 0, 0);
    } else {
      target.setHours(9, 0, 0, 0);
    }

    mutations.patch(cardId, { dueAt: target.toISOString() });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center gap-2 px-4 py-3">
          <button
            className="btn-outline px-2 py-1 text-xs"
            onClick={() => setAnchor((current) => subMonths(current, 1))}
          >
            ←
          </button>
          <h2 className="min-w-40 text-sm font-medium">
            {format(anchor, "MMMM yyyy")}
          </h2>
          <button
            className="btn-outline px-2 py-1 text-xs"
            onClick={() => setAnchor((current) => addMonths(current, 1))}
          >
            →
          </button>
          <button
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => setAnchor(new Date())}
          >
            Today
          </button>

          {unscheduled.length > 0 ? (
            <span className="ml-auto text-xs text-[color:var(--color-ink-faint)]">
              {unscheduled.length} undated card
              {unscheduled.length === 1 ? "" : "s"} not shown
            </span>
          ) : null}
        </header>

        <div className="grid shrink-0 grid-cols-7 border-y border-[color:var(--color-line)] px-4">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
            <div
              key={label}
              className="px-2 py-1.5 text-[11px] font-medium text-[color:var(--color-ink-faint)]"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="thin-scroll grid min-h-0 flex-1 auto-rows-fr grid-cols-7 gap-px overflow-y-auto bg-[color:var(--color-line)]/40 px-4">
          {days.map((day) => (
            <DayCell
              key={day.toISOString()}
              day={day}
              inMonth={isSameMonth(day, anchor)}
              cards={scheduled.filter((card) =>
                isSameDay(new Date(card.dueAt!), day),
              )}
              events={events.filter((event) => coversDay(event, day))}
              bundle={bundle}
              mutations={mutations}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}

function coversDay(event: ExternalEventData, day: Date): boolean {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);
  return start <= dayEnd && end >= dayStart;
}

function DayCell({
  day,
  inMonth,
  cards,
  events,
  bundle,
  mutations,
}: {
  day: Date;
  inMonth: boolean;
  cards: CardData[];
  events: ExternalEventData[];
  bundle: BoardBundle;
  mutations: CardMutations;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.toISOString()}` });
  const [composing, setComposing] = useState(false);

  return (
    <div
      ref={setNodeRef}
      className={`min-h-28 bg-[color:var(--color-canvas)] p-1.5 transition-colors ${
        inMonth ? "" : "opacity-45"
      } ${isOver ? "bg-indigo-500/10" : ""}`}
    >
      <div className="mb-1 flex items-center gap-1">
        <span
          className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${
            isToday(day)
              ? "bg-indigo-600 font-semibold text-white"
              : "text-[color:var(--color-ink-faint)]"
          }`}
        >
          {format(day, "d")}
        </span>
        <button
          className="ml-auto text-xs text-[color:var(--color-ink-faint)] opacity-0 transition-opacity hover:text-[color:var(--color-ink)] focus:opacity-100 group-hover:opacity-100 hover:opacity-100"
          onClick={() => setComposing(true)}
          aria-label={`Add a card due ${format(day, "MMMM d")}`}
        >
          +
        </button>
      </div>

      {events.map((event) => (
        <div
          key={event.id}
          title={`${event.ownerName}: ${event.title}`}
          className="mb-0.5 truncate rounded px-1 py-0.5 text-[10px] text-white/85"
          style={{ opacity: 0.85 }}
        >
          <span
            className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${
              AVATAR_CLASSES[event.ownerColor as ColorName] ?? AVATAR_CLASSES.slate
            }`}
            aria-hidden
          />
          <span className="align-middle text-[color:var(--color-ink-faint)]">
            {event.allDay ? "" : `${format(new Date(event.startAt), "HH:mm")} `}
            {event.title}
          </span>
        </div>
      ))}

      {cards.map((card) => (
        <CalendarCard key={card.id} card={card} onOpen={() => mutations.open(card.id)} />
      ))}

      {composing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem(
              "title",
            ) as HTMLInputElement;
            const clean = input.value.trim();
            if (clean) {
              const due = new Date(day);
              due.setHours(9, 0, 0, 0);
              mutations.create({ title: clean, dueAt: due.toISOString() });
            }
            setComposing(false);
          }}
        >
          <input
            autoFocus
            name="title"
            className="field px-1 py-0.5 text-[11px]"
            placeholder="Card title"
            onBlur={() => setComposing(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setComposing(false);
            }}
          />
        </form>
      ) : null}
    </div>
  );
}

function CalendarCard({ card, onOpen }: { card: CardData; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: card.id });

  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : undefined
      }
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={`mb-1 cursor-pointer truncate rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-surface-raised)] px-1.5 py-1 text-[11px] hover:border-indigo-500/40 ${
        isDragging ? "opacity-60 shadow-lg" : ""
      }`}
    >
      {card.title}
    </div>
  );
}
