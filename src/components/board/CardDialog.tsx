"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { fetchCardDetail, type CardDetail } from "@/app/actions/card-detail";
import { addComment } from "@/app/actions/cards";
import { Avatar } from "@/components/Avatar";
import type { BoardBundle, CardData } from "@/lib/queries";
import type { CardMutations } from "./BoardApp";
import { PropertyEditor } from "./PropertyEditor";

export function CardDialog({
  card,
  bundle,
  currentUserId,
  mutations,
  onClose,
}: {
  card: CardData;
  bundle: BoardBundle;
  currentUserId: string;
  mutations: CardMutations;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [comment, setComment] = useState("");
  const [, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetchCardDetail(card.id).then((result) => {
      if (live) setDetail(result);
    });
    return () => {
      live = false;
    };
  }, [card.id, card.commentCount]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dueValue = card.dueAt ? card.dueAt.slice(0, 10) : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-10"
      onMouseDown={(event) => {
        if (!dialogRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="panel w-full max-w-2xl overflow-hidden shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-[color:var(--color-line)] p-4">
          <textarea
            rows={1}
            defaultValue={card.title}
            className="flex-1 resize-none bg-transparent text-lg font-semibold outline-none"
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next && next !== card.title) mutations.patch(card.id, { title: next });
            }}
          />
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          <section className="mb-5 grid gap-3 sm:grid-cols-2">
            <Row label="Due">
              <input
                type="date"
                className="field text-sm"
                value={dueValue}
                onChange={(event) =>
                  mutations.patch(card.id, {
                    dueAt: event.target.value
                      ? new Date(`${event.target.value}T09:00:00`).toISOString()
                      : null,
                  })
                }
              />
            </Row>

            <Row label="Assignees">
              <div className="flex flex-wrap gap-1.5">
                {bundle.members.map((member) => {
                  const on = card.assignees.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      onClick={() => mutations.toggleAssignee(card.id, member.id)}
                      className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs ring-1 ring-inset transition-colors ${
                        on
                          ? "bg-indigo-500/15 text-indigo-200 ring-indigo-400/25"
                          : "text-[color:var(--color-ink-faint)] ring-white/10 hover:bg-white/5"
                      }`}
                    >
                      <Avatar
                        name={member.name}
                        color={member.avatarColor}
                        size="xs"
                      />
                      {member.name.split(" ")[0]}
                    </button>
                  );
                })}
              </div>
            </Row>

            {bundle.properties.map((property) => (
              <Row key={property.id} label={property.name}>
                <PropertyEditor
                  property={property}
                  value={card.values[property.id]}
                  members={bundle.members}
                  onChange={(next) =>
                    mutations.setValue(card.id, property.id, next)
                  }
                />
              </Row>
            ))}
          </section>

          <section className="mb-6">
            <h3 className="mb-1.5 text-xs font-medium text-[color:var(--color-ink-muted)]">
              Notes
            </h3>
            <textarea
              rows={5}
              defaultValue={card.description ?? ""}
              placeholder="Context, links, what done looks like."
              className="field resize-y text-sm"
              onBlur={(event) =>
                mutations.patch(card.id, {
                  description: event.target.value.trim() || null,
                })
              }
            />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium text-[color:var(--color-ink-muted)]">
              Comments
            </h3>

            <ul className="mb-3 space-y-3">
              {detail?.comments.map((entry) => (
                <li key={entry.id} className="flex gap-2.5">
                  <Avatar
                    name={entry.authorName}
                    color={entry.authorColor}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-[color:var(--color-ink-faint)]">
                      {entry.authorName} ·{" "}
                      {formatDistanceToNow(new Date(entry.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{entry.body}</p>
                  </div>
                </li>
              ))}
              {detail && detail.comments.length === 0 ? (
                <li className="text-xs text-[color:var(--color-ink-faint)]">
                  No comments yet.
                </li>
              ) : null}
            </ul>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const body = comment.trim();
                if (!body) return;
                setComment("");
                // Show it immediately; the refetch below replaces it with the
                // stored row once the action lands.
                setDetail((current) =>
                  current
                    ? {
                        ...current,
                        comments: [
                          ...current.comments,
                          {
                            id: `pending-${Date.now()}`,
                            body,
                            createdAt: new Date().toISOString(),
                            authorId: currentUserId,
                            authorName:
                              bundle.members.find((m) => m.id === currentUserId)
                                ?.name ?? "You",
                            authorColor:
                              bundle.members.find((m) => m.id === currentUserId)
                                ?.avatarColor ?? "indigo",
                          },
                        ],
                      }
                    : current,
                );
                startTransition(async () => {
                  await addComment(card.id, body);
                  setDetail(await fetchCardDetail(card.id));
                });
              }}
            >
              <textarea
                rows={2}
                className="field resize-none text-sm"
                placeholder="Leave a note for your co-founder"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-[color:var(--color-ink-faint)]">
                  Ctrl + Enter to post
                </span>
                <button className="btn-primary py-1.5 text-xs" type="submit">
                  Comment
                </button>
              </div>
            </form>
          </section>
        </div>

        <footer className="flex items-center justify-between border-t border-[color:var(--color-line)] px-4 py-2.5">
          <span className="text-[11px] text-[color:var(--color-ink-faint)]">
            Created{" "}
            {formatDistanceToNow(new Date(card.createdAt), { addSuffix: true })}
          </span>
          <button
            className="btn-ghost text-xs text-rose-300 hover:bg-rose-500/10"
            onClick={() => mutations.archive(card.id)}
          >
            Archive card
          </button>
        </footer>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-[color:var(--color-ink-muted)]">
        {label}
      </p>
      {children}
    </div>
  );
}
