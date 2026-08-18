export const PROPERTY_TYPES = [
  "text",
  "number",
  "select",
  "multiSelect",
  "date",
  "person",
  "checkbox",
  "url",
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multiSelect: "Multi-select",
  date: "Date",
  person: "Person",
  checkbox: "Checkbox",
  url: "Link",
};

export const VIEW_TYPES = ["board", "table", "calendar", "gallery"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

/** Option and avatar tints. Kept to eight so a board stays readable. */
export const COLORS = [
  "slate",
  "indigo",
  "sky",
  "emerald",
  "amber",
  "rose",
  "violet",
  "teal",
] as const;

export type ColorName = (typeof COLORS)[number];

export function colorFor(seed: string): ColorName {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

/**
 * Tailwind cannot see dynamically built class names, so every tint a card or
 * chip can take is written out here where the compiler will find it.
 */
export const COLOR_CLASSES: Record<ColorName, { chip: string; dot: string }> = {
  slate: { chip: "bg-slate-500/15 text-slate-300 ring-slate-400/25", dot: "bg-slate-400" },
  indigo: { chip: "bg-indigo-500/15 text-indigo-300 ring-indigo-400/25", dot: "bg-indigo-400" },
  sky: { chip: "bg-sky-500/15 text-sky-300 ring-sky-400/25", dot: "bg-sky-400" },
  emerald: { chip: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/25", dot: "bg-emerald-400" },
  amber: { chip: "bg-amber-500/15 text-amber-300 ring-amber-400/25", dot: "bg-amber-400" },
  rose: { chip: "bg-rose-500/15 text-rose-300 ring-rose-400/25", dot: "bg-rose-400" },
  violet: { chip: "bg-violet-500/15 text-violet-300 ring-violet-400/25", dot: "bg-violet-400" },
  teal: { chip: "bg-teal-500/15 text-teal-300 ring-teal-400/25", dot: "bg-teal-400" },
};

export const AVATAR_CLASSES: Record<ColorName, string> = {
  slate: "bg-slate-600 text-slate-50",
  indigo: "bg-indigo-600 text-indigo-50",
  sky: "bg-sky-600 text-sky-50",
  emerald: "bg-emerald-600 text-emerald-50",
  amber: "bg-amber-600 text-amber-50",
  rose: "bg-rose-600 text-rose-50",
  violet: "bg-violet-600 text-violet-50",
  teal: "bg-teal-600 text-teal-50",
};
