import { Fragment } from "react";

/**
 * Renders the small subset of markdown a meeting summary actually uses:
 * headings, bullets, numbered lists, checkboxes and inline emphasis.
 *
 * Hand-written rather than pulling in a markdown library, for two reasons. The
 * dependency list here is deliberately short, and more importantly every
 * general renderer either allows raw HTML or needs sanitising configured
 * correctly. This one builds React elements from text and never interprets
 * markup, so a note containing a script tag renders as the words of a script
 * tag. That matters when the text arrives from a third party.
 */

const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const CHECKBOX = /^\s*(?:[-*+]\s+)?\[( |x|X)\]\s*(.*)$/;

/** Splits on emphasis and code spans, returning React nodes. */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;

    if (token.startsWith("**")) {
      parts.push(
        <strong key={key} className="font-semibold text-[color:var(--color-ink)]">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <code key={key} className="rounded bg-white/10 px-1 text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export function NoteMarkdown({ source }: { source: string }) {
  const blocks: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`list-${key++}`} className="mb-3 space-y-1 pl-4">
        {listItems}
      </ul>,
    );
    listItems = [];
  };

  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(HEADING);
    if (heading) {
      flushList();
      const level = heading[1].length;
      blocks.push(
        <p
          key={`h-${key++}`}
          className={`mb-1.5 mt-4 font-semibold text-[color:var(--color-ink)] ${
            level <= 2 ? "text-sm" : "text-xs uppercase tracking-wide"
          }`}
        >
          {inline(heading[2], `h${key}`)}
        </p>,
      );
      continue;
    }

    const checkbox = line.match(CHECKBOX);
    if (checkbox) {
      listItems.push(
        <li key={`c-${key++}`} className="flex items-start gap-2">
          <span aria-hidden className="mt-0.5 shrink-0 text-[color:var(--color-ink-faint)]">
            {checkbox[1] === " " ? "☐" : "☑"}
          </span>
          <span className={checkbox[1] === " " ? "" : "line-through opacity-70"}>
            {inline(checkbox[2], `ci${key}`)}
          </span>
        </li>,
      );
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      listItems.push(
        <li key={`b-${key++}`} className="flex items-start gap-2">
          <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--color-ink-faint)]" />
          <span>{inline(bullet[1], `bi${key}`)}</span>
        </li>,
      );
      continue;
    }

    if (line.trim() === "") {
      flushList();
      continue;
    }

    flushList();
    blocks.push(
      <p key={`p-${key++}`} className="mb-3 leading-relaxed">
        {inline(line, `p${key}`)}
      </p>,
    );
  }

  flushList();

  return (
    <div className="text-sm text-[color:var(--color-ink-muted)]">
      {blocks.map((block, index) => (
        <Fragment key={index}>{block}</Fragment>
      ))}
    </div>
  );
}
