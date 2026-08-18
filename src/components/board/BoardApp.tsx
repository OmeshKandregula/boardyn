"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  archiveCard,
  createCard,
  moveCard,
  setCardValue,
  toggleAssignee,
  updateCard,
} from "@/app/actions/cards";
import type { BoardBundle, CardData } from "@/lib/queries";
import { CalendarView } from "./CalendarView";
import { CardDialog } from "./CardDialog";
import { GalleryView } from "./GalleryView";
import { KanbanView } from "./KanbanView";
import { TableView } from "./TableView";
import { ViewBar } from "./ViewBar";
import { UNGROUPED, visibleCards } from "./view-model";
import { useBoardStream } from "./useBoardStream";

export type CardMutations = {
  create: (input: {
    title: string;
    optionId?: string | null;
    dueAt?: string | null;
  }) => void;
  move: (input: {
    cardId: string;
    optionId?: string | null;
    beforeCardId?: string | null;
    afterCardId?: string | null;
  }) => void;
  patch: (cardId: string, patch: Partial<CardData>) => void;
  setValue: (cardId: string, propertyId: string, value: unknown) => void;
  toggleAssignee: (cardId: string, userId: string) => void;
  archive: (cardId: string) => void;
  open: (cardId: string | null) => void;
};

export function BoardApp({
  bundle,
  currentUserId,
  initialViewId,
  initialCardId,
}: {
  bundle: BoardBundle;
  currentUserId: string;
  initialViewId?: string;
  initialCardId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  useBoardStream(bundle.board.id);

  // Server data is the source of truth; this copy exists so a drag can land
  // before the round trip finishes. Every server render replaces it.
  const [cards, setCards] = useState<CardData[]>(bundle.cards);
  useEffect(() => setCards(bundle.cards), [bundle.cards]);

  const [activeViewId, setActiveViewId] = useState(
    initialViewId ?? bundle.views[0]?.id,
  );
  const view =
    bundle.views.find((candidate) => candidate.id === activeViewId) ??
    bundle.views[0];

  const [openCardId, setOpenCardId] = useState<string | null>(
    initialCardId ?? null,
  );

  const groupProperty = bundle.properties.find(
    (property) => property.id === view?.groupByPropertyId,
  );

  const filtered = useMemo(
    () => (view ? visibleCards(cards, view) : cards),
    [cards, view],
  );

  /* ------------------------------------------------------------ mutations */

  const open = useCallback(
    (cardId: string | null) => {
      setOpenCardId(cardId);
      // Keep the card in the URL so a deep link from a calendar event or a
      // pasted link opens the same card the sender was looking at.
      const params = new URLSearchParams(searchParams.toString());
      if (cardId) params.set("card", cardId);
      else params.delete("card");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const mutations: CardMutations = useMemo(
    () => ({
      create: ({ title, optionId, dueAt }) => {
        startTransition(async () => {
          await createCard({
            boardId: bundle.board.id,
            title,
            groupPropertyId: groupProperty?.id ?? null,
            optionId: optionId === UNGROUPED ? null : optionId,
            dueAt,
          });
        });
      },

      move: ({ cardId, optionId, beforeCardId, afterCardId }) => {
        setCards((current) => reorderLocally(current, cardId, {
          propertyId: groupProperty?.id,
          optionId,
          beforeCardId,
          afterCardId,
        }));
        startTransition(async () => {
          await moveCard({
            cardId,
            groupPropertyId: groupProperty?.id ?? null,
            optionId: optionId === UNGROUPED ? null : optionId,
            beforeCardId,
            afterCardId,
          });
        });
      },

      patch: (cardId, patch) => {
        setCards((current) =>
          current.map((card) =>
            card.id === cardId ? { ...card, ...patch } : card,
          ),
        );
        startTransition(async () => {
          await updateCard(cardId, {
            title: patch.title,
            description: patch.description,
            startAt: patch.startAt,
            dueAt: patch.dueAt,
            allDay: patch.allDay,
          });
        });
      },

      setValue: (cardId, propertyId, value) => {
        setCards((current) =>
          current.map((card) =>
            card.id === cardId
              ? { ...card, values: { ...card.values, [propertyId]: value } }
              : card,
          ),
        );
        startTransition(async () => {
          await setCardValue(cardId, propertyId, value);
        });
      },

      toggleAssignee: (cardId, userId) => {
        setCards((current) =>
          current.map((card) =>
            card.id === cardId
              ? {
                  ...card,
                  assignees: card.assignees.includes(userId)
                    ? card.assignees.filter((id) => id !== userId)
                    : [...card.assignees, userId],
                }
              : card,
          ),
        );
        startTransition(async () => {
          await toggleAssignee(cardId, userId);
        });
      },

      archive: (cardId) => {
        setCards((current) => current.filter((card) => card.id !== cardId));
        setOpenCardId((current) => (current === cardId ? null : current));
        startTransition(async () => {
          await archiveCard(cardId);
        });
      },

      open,
    }),
    [bundle.board.id, groupProperty?.id, open],
  );

  if (!view) {
    return (
      <div className="p-10 text-sm text-[color:var(--color-ink-muted)]">
        This board has no views.
      </div>
    );
  }

  const openCard = cards.find((card) => card.id === openCardId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewBar
        bundle={bundle}
        view={view}
        cardCount={filtered.length}
        onSelectView={setActiveViewId}
      />

      <div className="min-h-0 flex-1">
        {view.type === "board" ? (
          <KanbanView
            cards={filtered}
            view={view}
            bundle={bundle}
            mutations={mutations}
          />
        ) : null}
        {view.type === "table" ? (
          <TableView
            cards={filtered}
            view={view}
            bundle={bundle}
            mutations={mutations}
          />
        ) : null}
        {view.type === "calendar" ? (
          <CalendarView
            cards={filtered}
            view={view}
            bundle={bundle}
            mutations={mutations}
          />
        ) : null}
        {view.type === "gallery" ? (
          <GalleryView
            cards={filtered}
            view={view}
            bundle={bundle}
            mutations={mutations}
          />
        ) : null}
      </div>

      {openCard ? (
        <CardDialog
          card={openCard}
          bundle={bundle}
          currentUserId={currentUserId}
          mutations={mutations}
          onClose={() => open(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Mirrors what the server will do, so the card sits where it was dropped
 * instead of jumping back for a frame. The exact positions do not matter here:
 * the next server render overwrites them with the authoritative values.
 */
function reorderLocally(
  cards: CardData[],
  cardId: string,
  target: {
    propertyId?: string;
    optionId?: string | null;
    beforeCardId?: string | null;
    afterCardId?: string | null;
  },
): CardData[] {
  const moving = cards.find((card) => card.id === cardId);
  if (!moving) return cards;

  const before = target.beforeCardId
    ? cards.find((card) => card.id === target.beforeCardId)
    : null;
  const after = target.afterCardId
    ? cards.find((card) => card.id === target.afterCardId)
    : null;

  const position =
    before && after
      ? (before.position + after.position) / 2
      : after
        ? after.position + 1
        : before
          ? before.position - 1
          : moving.position;

  const values = { ...moving.values };
  if (target.propertyId) {
    if (target.optionId && target.optionId !== UNGROUPED) {
      values[target.propertyId] = target.optionId;
    } else {
      delete values[target.propertyId];
    }
  }

  return cards.map((card) =>
    card.id === cardId ? { ...card, position, values } : card,
  );
}
