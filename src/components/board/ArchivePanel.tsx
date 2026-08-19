"use client";

import { useEffect, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { fetchArchivedCards, type ArchivedCard } from "@/app/actions/card-detail";
import { restoreCard } from "@/app/actions/cards";

/**
 * The other half of archive-not-delete. Without a way back, archiving is just
 * deleting with a softer word on the button.
 */
export function ArchivePanel({
  boardId,
  onClose,
  onRestored,
}: {
  boardId: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [cards, setCards] = useState<ArchivedCard[] | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    fetchArchivedCards(boardId).then((result) => {
      if (live) setCards(result);
    });
    return () => {
      live = false;
    };
  }, [boardId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const restore = (cardId: string) => {
    setCards((current) => current?.filter((card) => card.id !== cardId) ?? null);
    startTransition(async () => {
      await restoreCard(cardId);
      onRestored();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 backdrop-blur-sm sm:p-16"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Archived cards"
        className="panel w-full max-w-lg overflow-hidden shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-[color:var(--color-line)] px-4 py-3">
          <h2 className="text-sm font-semibold">Archived cards</h2>
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto">
          {cards === null ? (
            <p className="px-4 py-6 text-sm text-[color:var(--color-ink-faint)]">
              Loading...
            </p>
          ) : cards.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[color:var(--color-ink-faint)]">
              Nothing archived yet. Cards you archive land here, and nothing on
              this board is ever deleted outright.
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--color-line)]">
              {cards.map((card) => (
                <li
                  key={card.id}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{card.title}</span>
                  <span className="shrink-0 text-xs text-[color:var(--color-ink-faint)]">
                    {formatDistanceToNow(new Date(card.archivedAt), {
                      addSuffix: true,
                    })}
                  </span>
                  <button
                    className="btn-outline shrink-0 px-2 py-1 text-xs"
                    onClick={() => restore(card.id)}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {cards && cards.length > 0 ? (
          <footer className="border-t border-[color:var(--color-line)] px-4 py-2">
            <p className="text-[11px] text-[color:var(--color-ink-faint)]">
              Restored cards return to the board with their properties, dates
              and comments intact.
            </p>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
