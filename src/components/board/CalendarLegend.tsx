"use client";

import Link from "next/link";
import { useTransition } from "react";
import { updateView } from "@/app/actions/boards";
import { COLOR_CLASSES, type ColorName } from "@/lib/constants";
import type { View } from "@/db/schema";
import type { ExternalEventData, Member } from "@/lib/queries";

/**
 * Whose calendars are drawn behind the cards.
 *
 * The question a two-person team asks a calendar is not "when is this due" but
 * "when are we both free", and that only works if you can see both people at
 * once and tell them apart. Hence one colour each and a switch each: turn the
 * other person on to find a gap, turn them off when their day is noise.
 *
 * Like filters, the choice lives on the view rather than the session, so both
 * people are looking at the same thing while they pick a time.
 */
export function CalendarLegend({
  view,
  members,
  colors,
  events,
  currentUserId,
}: {
  view: View;
  members: Member[];
  colors: Map<string, ColorName>;
  events: ExternalEventData[];
  currentUserId: string;
}) {
  const [, startTransition] = useTransition();
  const hidden = new Set(view.hiddenCalendars);

  const toggle = (userId: string) => {
    const next = new Set(hidden);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    startTransition(() =>
      updateView(view.id, { hiddenCalendars: [...next] }),
    );
  };

  const setAll = (visible: boolean) => {
    startTransition(() =>
      updateView(view.id, {
        hiddenCalendars: visible ? [] : members.map((member) => member.id),
      }),
    );
  };

  const connected = members.filter((member) => member.hasCalendar);
  const shownCount = connected.filter((member) => !hidden.has(member.id)).length;

  return (
    <aside className="hidden w-52 shrink-0 border-r border-[color:var(--color-line)] p-3 lg:block">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold text-[color:var(--color-ink-muted)]">
          Calendars
        </h2>
        {connected.length > 1 ? (
          <button
            className="text-[11px] text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)]"
            onClick={() => setAll(shownCount !== connected.length)}
          >
            {shownCount === connected.length ? "None" : "All"}
          </button>
        ) : null}
      </div>

      <ul className="space-y-0.5">
        {members.map((member) => {
          const color = colors.get(member.id) ?? "slate";
          const classes = COLOR_CLASSES[color] ?? COLOR_CLASSES.slate;
          const on = member.hasCalendar && !hidden.has(member.id);
          const count = events.filter(
            (event) => event.ownerId === member.id,
          ).length;

          return (
            <li key={member.id}>
              <label
                className={`flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm ${
                  member.hasCalendar
                    ? "cursor-pointer hover:bg-white/5"
                    : "cursor-default opacity-55"
                }`}
                title={
                  member.hasCalendar
                    ? `${member.email}: ${count} event${count === 1 ? "" : "s"} in view`
                    : `${member.name} has not connected a calendar`
                }
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0"
                  checked={on}
                  disabled={!member.hasCalendar}
                  onChange={() => toggle(member.id)}
                />
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${classes.dot} ${
                    on ? "" : "opacity-40"
                  }`}
                />
                <span className="min-w-0 flex-1 truncate">
                  {member.id === currentUserId ? "You" : member.name}
                </span>
                {member.hasCalendar && count > 0 ? (
                  <span className="text-[11px] text-[color:var(--color-ink-faint)]">
                    {count}
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>

      {connected.length === 0 ? (
        <p className="mt-3 text-[11px] leading-relaxed text-[color:var(--color-ink-faint)]">
          Nobody has connected a calendar yet.{" "}
          <Link href="/settings" className="underline underline-offset-2">
            Connect yours
          </Link>{" "}
          and your events appear here, behind the cards.
        </p>
      ) : members.some((member) => !member.hasCalendar) ? (
        <p className="mt-3 text-[11px] leading-relaxed text-[color:var(--color-ink-faint)]">
          Greyed-out people have not connected a calendar. Only they can do it,
          from their own settings.
        </p>
      ) : null}
    </aside>
  );
}
