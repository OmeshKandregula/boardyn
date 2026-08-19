"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  acceptActionItem,
  dismissActionItem,
  restoreActionItem,
  setMeetingShared,
} from "@/app/actions/granola";
import type { MeetingDetail, MeetingSummary } from "@/lib/queries";
import { NoteMarkdown } from "./NoteMarkdown";

/**
 * Meetings down the left, the note and its action items on the right.
 *
 * The point of the page is the gap between "we agreed somebody would do this"
 * and "it is on the board", which is where most small teams lose work. So the
 * action items are the loudest thing on the note, and accepting one is a
 * single click that says which board it goes to.
 */
export function MeetingsApp({
  meetings,
  detail,
  boards,
  currentUserId,
  workspaceSlug,
  connected,
}: {
  meetings: MeetingSummary[];
  detail: MeetingDetail | null;
  boards: { id: string; title: string }[];
  currentUserId: string;
  workspaceSlug: string;
  connected: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [boardId, setBoardId] = useState(boards[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const select = (meetingId: string) => {
    router.push(`/meetings?workspace=${workspaceSlug}&meeting=${meetingId}`, {
      scroll: false,
    });
  };

  if (meetings.length === 0) {
    return <EmptyState connected={connected} />;
  }

  const open = detail?.actionItems.filter((item) => item.status === "suggested") ?? [];
  const accepted = detail?.actionItems.filter((item) => item.status === "accepted") ?? [];
  const dismissed = detail?.actionItems.filter((item) => item.status === "dismissed") ?? [];

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="thin-scroll w-72 shrink-0 overflow-y-auto border-r border-[color:var(--color-line)]">
        <h1 className="px-4 py-3 text-sm font-semibold">Meetings</h1>
        <ul>
          {meetings.map((meeting) => {
            const active = meeting.id === detail?.id;
            return (
              <li key={meeting.id}>
                <button
                  onClick={() => select(meeting.id)}
                  className={`w-full border-l-2 px-4 py-2.5 text-left transition-colors ${
                    active
                      ? "border-indigo-500 bg-white/5"
                      : "border-transparent hover:bg-white/[0.03]"
                  }`}
                >
                  <p className="truncate text-sm">{meeting.title}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[color:var(--color-ink-faint)]">
                    {meeting.startedAt
                      ? format(new Date(meeting.startedAt), "d MMM")
                      : "No date"}
                    {!meeting.sharedWithWorkspace ? (
                      <span
                        className="rounded bg-white/5 px-1"
                        title="Only you can see this"
                      >
                        private
                      </span>
                    ) : null}
                    {meeting.openActionItems > 0 ? (
                      <span className="ml-auto rounded bg-indigo-500/15 px-1.5 text-indigo-300">
                        {meeting.openActionItems}
                      </span>
                    ) : null}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="thin-scroll min-w-0 flex-1 overflow-y-auto">
        {!detail ? (
          <p className="p-8 text-sm text-[color:var(--color-ink-faint)]">
            Pick a meeting.
          </p>
        ) : (
          <article className="mx-auto max-w-3xl px-6 py-6">
            <header className="mb-5">
              <h2 className="text-xl font-semibold tracking-tight">
                {detail.title}
              </h2>
              <p className="mt-1 text-sm text-[color:var(--color-ink-muted)]">
                {detail.startedAt
                  ? `${format(new Date(detail.startedAt), "EEEE d MMMM, HH:mm")} · ${formatDistanceToNow(new Date(detail.startedAt), { addSuffix: true })}`
                  : "No recorded time"}
              </p>

              {detail.attendees.length > 0 ? (
                <p className="mt-2 text-xs text-[color:var(--color-ink-faint)]">
                  {detail.attendees
                    .map((person) => person.name ?? person.email)
                    .filter(Boolean)
                    .join(", ")}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {detail.ownerId === currentUserId ? (
                  <button
                    className="btn-outline px-2 py-1 text-xs"
                    onClick={() =>
                      startTransition(() =>
                        setMeetingShared(detail.id, !detail.sharedWithWorkspace),
                      )
                    }
                    title={
                      detail.sharedWithWorkspace
                        ? "Stop everyone else seeing this note"
                        : "Let the rest of the workspace read this note"
                    }
                  >
                    {detail.sharedWithWorkspace
                      ? "Shared with workspace"
                      : "Private to you"}
                  </button>
                ) : (
                  <span className="text-xs text-[color:var(--color-ink-faint)]">
                    Shared by {detail.ownerName}
                  </span>
                )}

                {detail.webUrl ? (
                  <a
                    className="btn-ghost px-2 py-1 text-xs"
                    href={detail.webUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open in Granola
                  </a>
                ) : null}
              </div>
            </header>

            <section className="panel mb-6 p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">Action items</h3>
                {boards.length > 1 ? (
                  <label className="flex items-center gap-1.5 text-xs text-[color:var(--color-ink-muted)]">
                    Add to
                    <select
                      className="field w-auto px-2 py-1 text-xs"
                      value={boardId}
                      onChange={(event) => setBoardId(event.target.value)}
                    >
                      {boards.map((board) => (
                        <option key={board.id} value={board.id}>
                          {board.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              {open.length === 0 && accepted.length === 0 && dismissed.length === 0 ? (
                <p className="text-xs leading-relaxed text-[color:var(--color-ink-faint)]">
                  Nothing that reads like a commitment in this note. Action items
                  are read out of the summary, so a meeting with no
                  &quot;next steps&quot; section and no checkboxes will often
                  have none.
                </p>
              ) : null}

              <ul className="space-y-1.5">
                {open.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.03]"
                  >
                    <span className="min-w-0 flex-1 text-sm">{item.text}</span>
                    <button
                      className="btn-outline shrink-0 px-2 py-0.5 text-xs"
                      disabled={!boardId}
                      onClick={() => {
                        setError(null);
                        startTransition(async () => {
                          const result = await acceptActionItem(item.id, boardId);
                          if (result.error) setError(result.error);
                        });
                      }}
                    >
                      Add to board
                    </button>
                    <button
                      className="btn-ghost shrink-0 px-2 py-0.5 text-xs"
                      onClick={() =>
                        startTransition(() => dismissActionItem(item.id))
                      }
                      title="Not a task"
                    >
                      Dismiss
                    </button>
                  </li>
                ))}
              </ul>

              {accepted.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {accepted.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 px-1.5 text-sm text-[color:var(--color-ink-muted)]"
                    >
                      <span aria-hidden className="text-emerald-400">
                        ✓
                      </span>
                      <span className="min-w-0 flex-1 truncate line-through decoration-[color:var(--color-ink-faint)]">
                        {item.text}
                      </span>
                      {item.boardId && item.cardId ? (
                        <Link
                          className="shrink-0 text-xs underline underline-offset-2"
                          href={`/b/${item.boardId}?card=${item.cardId}`}
                        >
                          On the board
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {dismissed.length > 0 ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-[color:var(--color-ink-faint)]">
                    {dismissed.length} dismissed
                  </summary>
                  <ul className="mt-1.5 space-y-1">
                    {dismissed.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center gap-2 px-1.5 text-xs text-[color:var(--color-ink-faint)]"
                      >
                        <span className="min-w-0 flex-1 truncate">{item.text}</span>
                        <button
                          className="shrink-0 underline underline-offset-2"
                          onClick={() =>
                            startTransition(() => restoreActionItem(item.id))
                          }
                        >
                          Put back
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {error ? (
                <p className="mt-2 text-xs text-rose-300">{error}</p>
              ) : null}
            </section>

            {detail.summary ? (
              <section className="mb-6">
                <h3 className="mb-2 text-sm font-semibold">Notes</h3>
                <NoteMarkdown source={detail.summary} />
              </section>
            ) : null}

            {detail.transcript ? (
              <section>
                <button
                  className="btn-ghost px-2 py-1 text-xs"
                  onClick={() => setShowTranscript(!showTranscript)}
                >
                  {showTranscript ? "Hide transcript" : "Show transcript"}
                </button>
                {showTranscript ? (
                  <pre className="thin-scroll mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs leading-relaxed text-[color:var(--color-ink-muted)]">
                    {detail.transcript}
                  </pre>
                ) : null}
              </section>
            ) : null}
          </article>
        )}
      </div>
    </div>
  );
}

function EmptyState({ connected }: { connected: boolean }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="mb-2 text-lg font-semibold">No meetings yet</h1>
      {connected ? (
        <p className="text-sm leading-relaxed text-[color:var(--color-ink-muted)]">
          Your Granola key is saved. Notes appear here once Granola has finished
          summarising a meeting and the next sync has run, which is every few
          minutes. Only meetings where two or more people from this workspace
          were present are shared with the team; everything else stays private
          to you.
        </p>
      ) : (
        <p className="text-sm leading-relaxed text-[color:var(--color-ink-muted)]">
          Meeting notes come from Granola. Add your API key in{" "}
          <Link href="/settings" className="underline underline-offset-2">
            Settings
          </Link>{" "}
          and your notes, and the action items in them, show up here.
        </p>
      )}
    </div>
  );
}
