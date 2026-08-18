"use client";

import { useState, useTransition } from "react";
import { addPropertyOption } from "@/app/actions/boards";
import { COLOR_CLASSES, type ColorName } from "@/lib/constants";
import type { BoardProperty } from "@/db/schema";
import type { Member } from "@/lib/queries";

/**
 * One editor per property type, sized to sit inside a table cell or a card
 * dialog row without a modal. Values are written through on change: there is no
 * save button anywhere in this app, which is the behaviour people expect from a
 * board and the reason the undo path is archive-not-delete.
 */
export function PropertyEditor({
  property,
  value,
  members,
  onChange,
  compact = false,
}: {
  property: BoardProperty;
  value: unknown;
  members: Member[];
  onChange: (next: unknown) => void;
  compact?: boolean;
}) {
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const base = compact ? "text-xs py-1" : "text-sm";

  switch (property.type) {
    case "select":
      return (
        <div className="flex items-center gap-1">
          <select
            className={`field ${base}`}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value || null)}
          >
            <option value="">Empty</option>
            {property.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          {creating ? (
            <input
              autoFocus
              className={`field ${base} w-28`}
              placeholder="New option"
              onBlur={() => setCreating(false)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                const name = event.currentTarget.value.trim();
                if (!name) return setCreating(false);
                setCreating(false);
                startTransition(async () => {
                  const optionId = await addPropertyOption(property.id, name);
                  if (optionId) onChange(optionId);
                });
              }}
            />
          ) : (
            <button
              type="button"
              className="btn-ghost px-1.5 py-0.5 text-xs"
              onClick={() => setCreating(true)}
              title="Add an option"
            >
              +
            </button>
          )}
        </div>
      );

    case "multiSelect": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1">
          {property.options.map((option) => {
            const on = selected.includes(option.id);
            const classes =
              COLOR_CLASSES[option.color as ColorName] ?? COLOR_CLASSES.slate;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() =>
                  onChange(
                    on
                      ? selected.filter((id) => id !== option.id)
                      : [...selected, option.id],
                  )
                }
                className={`rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-inset transition-opacity ${
                  on ? classes.chip : "text-[color:var(--color-ink-faint)] ring-white/10 opacity-60"
                }`}
              >
                {option.name}
              </button>
            );
          })}
        </div>
      );
    }

    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded"
        />
      );

    case "number":
      return (
        <input
          type="number"
          className={`field ${base}`}
          defaultValue={typeof value === "number" ? value : ""}
          onBlur={(event) =>
            onChange(event.target.value === "" ? null : Number(event.target.value))
          }
        />
      );

    case "date":
      return (
        <input
          type="date"
          className={`field ${base}`}
          value={typeof value === "string" ? value.slice(0, 10) : ""}
          onChange={(event) => onChange(event.target.value || null)}
        />
      );

    case "person": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1">
          {members.map((member) => {
            const on = selected.includes(member.id);
            return (
              <button
                key={member.id}
                type="button"
                onClick={() =>
                  onChange(
                    on
                      ? selected.filter((id) => id !== member.id)
                      : [...selected, member.id],
                  )
                }
                className={`rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${
                  on
                    ? "bg-indigo-500/15 text-indigo-300 ring-indigo-400/25"
                    : "text-[color:var(--color-ink-faint)] ring-white/10"
                }`}
              >
                {member.name}
              </button>
            );
          })}
        </div>
      );
    }

    case "url":
      return (
        <input
          type="url"
          className={`field ${base}`}
          placeholder="https://"
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={(event) => onChange(event.target.value.trim() || null)}
        />
      );

    default:
      return (
        <input
          className={`field ${base}`}
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={(event) => onChange(event.target.value.trim() || null)}
        />
      );
  }
}
