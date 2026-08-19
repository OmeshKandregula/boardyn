"use client";

import { useState, useTransition } from "react";
import { createProperty, createView, updateView } from "@/app/actions/boards";
import { ArchivePanel } from "./ArchivePanel";
import { FilterBar } from "./FilterBar";
import { PROPERTY_TYPES, PROPERTY_TYPE_LABELS, VIEW_TYPES } from "@/lib/constants";
import type { View } from "@/db/schema";
import type { BoardBundle } from "@/lib/queries";

const VIEW_ICONS: Record<string, string> = {
  board: "▦",
  table: "☰",
  calendar: "▤",
  gallery: "▢",
};

export function ViewBar({
  bundle,
  view,
  cardCount,
  hiddenCount,
  onSelectView,
  onArchiveChanged,
}: {
  bundle: BoardBundle;
  view: View;
  cardCount: number;
  hiddenCount: number;
  onSelectView: (viewId: string) => void;
  onArchiveChanged: () => void;
}) {
  const [, startTransition] = useTransition();
  const [menu, setMenu] = useState<"none" | "view" | "property" | "options">(
    "none",
  );
  const [archiveOpen, setArchiveOpen] = useState(false);

  const selectProperties = bundle.properties.filter(
    (property) => property.type === "select",
  );

  const close = () => setMenu("none");

  return (
    <div className="sticky top-14 z-20 border-b border-[color:var(--color-line)] bg-[color:var(--color-canvas)]/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <h1 className="mr-2 truncate text-sm font-semibold">
          {bundle.board.title}
        </h1>

        <div className="flex items-center gap-1">
          {bundle.views.map((candidate) => (
            <button
              key={candidate.id}
              onClick={() => onSelectView(candidate.id)}
              className={`rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                candidate.id === view.id
                  ? "bg-white/10 text-[color:var(--color-ink)]"
                  : "text-[color:var(--color-ink-muted)] hover:bg-white/5"
              }`}
            >
              <span aria-hidden className="mr-1.5 opacity-70">
                {VIEW_ICONS[candidate.type]}
              </span>
              {candidate.name}
            </button>
          ))}

          <div className="relative">
            <button
              onClick={() => setMenu(menu === "view" ? "none" : "view")}
              className="btn-ghost px-2 py-1.5 text-sm"
              aria-label="Add a view"
            >
              +
            </button>
            {menu === "view" ? (
              <Menu onClose={close}>
                {VIEW_TYPES.map((type) => (
                  <button
                    key={type}
                    className="menu-item"
                    onClick={() => {
                      close();
                      startTransition(() => createView(bundle.board.id, type));
                    }}
                  >
                    <span aria-hidden className="mr-2 opacity-70">
                      {VIEW_ICONS[type]}
                    </span>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </Menu>
            ) : null}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-[color:var(--color-ink-faint)]">
            {cardCount} card{cardCount === 1 ? "" : "s"}
          </span>

          {view.type === "board" || view.type === "gallery" ? (
            <label className="flex items-center gap-1.5 text-xs text-[color:var(--color-ink-muted)]">
              Group by
              <select
                className="field w-auto px-2 py-1 text-xs"
                value={view.groupByPropertyId ?? ""}
                onChange={(event) =>
                  startTransition(() =>
                    updateView(view.id, {
                      groupByPropertyId: event.target.value || null,
                    }),
                  )
                }
              >
                <option value="">Nothing</option>
                {selectProperties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {view.type === "calendar" && bundle.externalEvents.length > 0 ? (
            <label className="flex items-center gap-1.5 text-xs text-[color:var(--color-ink-muted)]">
              <input
                type="checkbox"
                checked={view.showExternalEvents}
                onChange={(event) =>
                  startTransition(() =>
                    updateView(view.id, {
                      showExternalEvents: event.target.checked,
                    }),
                  )
                }
              />
              Google Calendar
            </label>
          ) : null}

          <button
            onClick={() => setArchiveOpen(true)}
            className="btn-ghost px-2 py-1 text-xs"
            title="Archived cards"
          >
            Archive
          </button>

          <div className="relative">
            <button
              onClick={() => setMenu(menu === "property" ? "none" : "property")}
              className="btn-outline px-2 py-1 text-xs"
            >
              Add property
            </button>
            {menu === "property" ? (
              <Menu onClose={close} align="right">
                <NewPropertyForm
                  boardId={bundle.board.id}
                  onDone={close}
                />
              </Menu>
            ) : null}
          </div>
        </div>
      </div>

      <FilterBar bundle={bundle} view={view} hiddenCount={hiddenCount} />

      {archiveOpen ? (
        <ArchivePanel
          boardId={bundle.board.id}
          onClose={() => setArchiveOpen(false)}
          onRestored={onArchiveChanged}
        />
      ) : null}

      <style jsx global>{`
        .menu-item {
          display: block;
          width: 100%;
          padding: 0.4rem 0.6rem;
          text-align: left;
          font-size: 0.8125rem;
          border-radius: 0.5rem;
          color: var(--color-ink-muted);
        }
        .menu-item:hover {
          background: rgba(255, 255, 255, 0.06);
          color: var(--color-ink);
        }
      `}</style>
    </div>
  );
}

function Menu({
  children,
  onClose,
  align = "left",
}: {
  children: React.ReactNode;
  onClose: () => void;
  align?: "left" | "right";
}) {
  return (
    <>
      {/* Click-away layer. Cheaper and more predictable than a document
          listener that has to guess whether the click was inside. */}
      <button
        className="fixed inset-0 z-30 cursor-default"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        className={`panel absolute z-40 mt-1 min-w-44 p-1.5 shadow-xl ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        {children}
      </div>
    </>
  );
}

function NewPropertyForm({
  boardId,
  onDone,
}: {
  boardId: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("select");
  const [, startTransition] = useTransition();

  return (
    <form
      className="w-56 space-y-2 p-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onDone();
        startTransition(() => createProperty(boardId, { name, type }));
      }}
    >
      <input
        autoFocus
        className="field text-xs"
        placeholder="Property name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select
        className="field text-xs"
        value={type}
        onChange={(event) => setType(event.target.value)}
      >
        {PROPERTY_TYPES.map((option) => (
          <option key={option} value={option}>
            {PROPERTY_TYPE_LABELS[option]}
          </option>
        ))}
      </select>
      <button className="btn-primary w-full py-1.5 text-xs" type="submit">
        Add
      </button>
    </form>
  );
}
