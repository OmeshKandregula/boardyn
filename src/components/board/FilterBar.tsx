"use client";

import { useState, useTransition } from "react";
import { updateView } from "@/app/actions/boards";
import type { View, ViewFilter } from "@/db/schema";
import type { BoardBundle } from "@/lib/queries";
import {
  OP_LABELS,
  VALUELESS_OPS,
  defaultFilterFor,
  describeFilter,
  filterTargets,
  opsFor,
  type FilterTarget,
} from "./filter-options";

/**
 * Filters are a property of the view, not of the session, so setting one is
 * something both founders see. That is the right default for a two-person
 * board: "the filter I set" and "the board we look at" should be the same
 * thing, and anyone who wants a private slice can add their own view.
 */
export function FilterBar({
  bundle,
  view,
  hiddenCount,
}: {
  bundle: BoardBundle;
  view: View;
  hiddenCount: number;
}) {
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const targets = filterTargets(bundle.properties, bundle.members);

  const save = (filters: ViewFilter[]) =>
    startTransition(() => updateView(view.id, { filters }));

  const addFilter = (target: FilterTarget) => {
    setAdding(false);
    const next = [...view.filters, defaultFilterFor(target)];
    save(next);
    setEditing(next.length - 1);
  };

  const updateFilter = (index: number, patch: Partial<ViewFilter>) => {
    save(
      view.filters.map((filter, i) =>
        i === index ? { ...filter, ...patch } : filter,
      ),
    );
  };

  const removeFilter = (index: number) => {
    setEditing(null);
    save(view.filters.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
      {view.filters.map((filter, index) => {
        const target = targets.find((t) => t.id === filter.propertyId);
        return (
          <div key={`${filter.propertyId}-${index}`} className="relative">
            <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-500/10 py-1 pl-2 pr-1 text-xs text-indigo-200 ring-1 ring-inset ring-indigo-400/25">
              <button
                onClick={() => setEditing(editing === index ? null : index)}
                className="hover:underline"
              >
                {describeFilter(filter, targets)}
              </button>
              <button
                onClick={() => removeFilter(index)}
                aria-label="Remove this filter"
                className="rounded px-1 text-indigo-300/70 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </span>

            {editing === index && target ? (
              <>
                <button
                  className="fixed inset-0 z-30 cursor-default"
                  aria-label="Close filter editor"
                  onClick={() => setEditing(null)}
                />
                <div className="panel absolute left-0 z-40 mt-1 w-56 space-y-2 p-2 shadow-xl">
                  <select
                    className="field text-xs"
                    value={filter.op}
                    onChange={(event) => {
                      const op = event.target.value as ViewFilter["op"];
                      updateFilter(index, {
                        op,
                        // Switching to "is empty" leaves a stale value behind
                        // that nothing reads; clear it so the saved filter says
                        // what it means.
                        value: VALUELESS_OPS.includes(op) ? null : filter.value,
                      });
                    }}
                  >
                    {opsFor(target.kind).map((op) => (
                      <option key={op} value={op}>
                        {OP_LABELS[op]}
                      </option>
                    ))}
                  </select>

                  {VALUELESS_OPS.includes(filter.op) ? null : (
                    <FilterValueInput
                      target={target}
                      value={filter.value ?? ""}
                      onChange={(value) => updateFilter(index, { value })}
                    />
                  )}
                </div>
              </>
            ) : null}
          </div>
        );
      })}

      <div className="relative">
        <button
          onClick={() => setAdding(!adding)}
          className="rounded-lg px-2 py-1 text-xs text-[color:var(--color-ink-muted)] ring-1 ring-inset ring-white/10 hover:bg-white/5 hover:text-[color:var(--color-ink)]"
        >
          + Filter
        </button>
        {adding ? (
          <>
            <button
              className="fixed inset-0 z-30 cursor-default"
              aria-label="Close filter menu"
              onClick={() => setAdding(false)}
            />
            <div className="panel absolute left-0 z-40 mt-1 max-h-64 w-44 overflow-y-auto p-1.5 shadow-xl">
              {targets.map((target) => (
                <button
                  key={target.id}
                  className="menu-item"
                  onClick={() => addFilter(target)}
                >
                  {target.name}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {hiddenCount > 0 ? (
        <span className="text-xs text-[color:var(--color-ink-faint)]">
          {hiddenCount} card{hiddenCount === 1 ? "" : "s"} hidden
        </span>
      ) : null}
    </div>
  );
}

function FilterValueInput({
  target,
  value,
  onChange,
}: {
  target: FilterTarget;
  value: string;
  onChange: (value: string) => void;
}) {
  if (target.kind === "checkbox") {
    return (
      <select
        className="field text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="true">checked</option>
        <option value="false">unchecked</option>
      </select>
    );
  }

  if (target.options && target.options.length > 0) {
    return (
      <select
        className="field text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {target.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }

  if (target.kind === "date") {
    return (
      <input
        type="date"
        className="field text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      className="field text-xs"
      placeholder="Value"
      defaultValue={value}
      onBlur={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
