"use client";

import { useMemo } from "react";
import { COLOR_CLASSES, type ColorName } from "@/lib/constants";
import type { View } from "@/db/schema";
import type { BoardBundle, CardData } from "@/lib/queries";
import type { CardMutations } from "./BoardApp";
import { CardTile } from "./CardTile";
import { groupCards } from "./view-model";

/**
 * Cards laid out in a grid, optionally sectioned by the same property the
 * kanban groups on. Useful when descriptions matter more than order, which for
 * us is the research and writing boards rather than the shipping ones.
 */
export function GalleryView({
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

  return (
    <div className="thin-scroll h-full overflow-y-auto px-4 py-4">
      {groups.map((group) => (
        <section key={group.id} className="mb-8">
          <header className="mb-3 flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                (COLOR_CLASSES[group.color as ColorName] ?? COLOR_CLASSES.slate).dot
              }`}
              aria-hidden
            />
            <h2 className="text-sm font-medium">{group.name}</h2>
            <span className="text-xs text-[color:var(--color-ink-faint)]">
              {group.cards.length}
            </span>
          </header>

          {group.cards.length === 0 ? (
            <p className="text-xs text-[color:var(--color-ink-faint)]">Empty</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.cards.map((card) => (
                <div key={card.id} className="flex flex-col">
                  <CardTile
                    card={card}
                    properties={bundle.properties}
                    visibleProperties={view.visibleProperties}
                    members={bundle.members}
                    onOpen={() => mutations.open(card.id)}
                  />
                  {card.description ? (
                    <p className="mt-1.5 line-clamp-3 px-1 text-xs text-[color:var(--color-ink-faint)]">
                      {card.description}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
