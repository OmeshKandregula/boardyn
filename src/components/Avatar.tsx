import { AVATAR_CLASSES, type ColorName } from "@/lib/constants";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function Avatar({
  name,
  color,
  size = "md",
  title,
}: {
  name: string;
  color: string;
  size?: "xs" | "sm" | "md";
  title?: string;
}) {
  const dims =
    size === "xs"
      ? "h-5 w-5 text-[9px]"
      : size === "sm"
        ? "h-6 w-6 text-[10px]"
        : "h-7 w-7 text-[11px]";

  return (
    <span
      title={title ?? name}
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${dims} ${
        AVATAR_CLASSES[color as ColorName] ?? AVATAR_CLASSES.slate
      }`}
    >
      {initials(name)}
    </span>
  );
}
