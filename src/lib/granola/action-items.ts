import { createHash } from "node:crypto";

/**
 * Pulls candidate action items out of a Granola summary.
 *
 * Granola's API returns the AI summary as markdown and does not expose action
 * items as a structured field, so they have to be read out of the prose. This
 * is deliberately a parser rather than an LLM call: requiring an Anthropic or
 * Bedrock key would put a second paywall on top of Granola's own, and most
 * people self-hosting this would get an empty list.
 *
 * The trade is that it is heuristic. It is tuned to be conservative, because
 * the failure modes are not equal: a missed item is a line somebody re-reads
 * in the note, while a false one is a card on the board that nobody agreed to.
 * Everything here is a suggestion a human accepts, never a card on its own.
 */

/** Headings under which a list is understood to be actions rather than notes. */
const ACTION_HEADINGS = [
  "action items",
  "actions",
  "next steps",
  "follow ups",
  "follow-ups",
  "todos",
  "to do",
  "to-dos",
  "tasks",
  "owners",
  "commitments",
];

/**
 * Phrasing that marks a bullet as a commitment even outside an action heading.
 * Kept narrow on purpose: "we discussed pricing" is not a task, and a looser
 * pattern turns every meeting into a dozen fake cards.
 */
const ACTION_PHRASES = [
  /\bwill\s+\w+/i,
  /\bto\s+(?:send|write|draft|review|ship|fix|follow up|schedule|book|share|check|confirm|prepare|update)\b/i,
  /\b(?:needs?|going)\s+to\b/i,
  /^\s*(?:todo|action)\b/i,
];

export type ExtractedActionItem = {
  text: string;
  fingerprint: string;
  /** Where it came from, so the UI can say why it is being suggested. */
  source: "heading" | "checkbox" | "phrase";
};

const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const CHECKBOX = /^\s*(?:[-*+]\s+)?\[( |x|X)\]\s*(.*)$/;

/** Strips markdown emphasis, links and stray punctuation from a line. */
export function cleanItemText(raw: string): string {
  return raw
    .replace(/^\[( |x|X)\]\s*/, "")
    // [text](url) keeps the text; a bare URL is left alone.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:–—-]+/, "")
    .replace(/[\s]+$/, "")
    .trim();
}

function fingerprintOf(text: string): string {
  // Case and trailing punctuation vary between re-summarisations of the same
  // meeting; the fingerprint should not.
  const normalised = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalised).digest("hex").slice(0, 24);
}

function isActionHeading(text: string): boolean {
  const clean = cleanItemText(text).toLowerCase().replace(/[:.]+$/, "").trim();
  return ACTION_HEADINGS.some(
    (heading) => clean === heading || clean.startsWith(`${heading} `),
  );
}

function looksLikeAction(text: string): boolean {
  return ACTION_PHRASES.some((pattern) => pattern.test(text));
}

export function extractActionItems(summary: string | null): ExtractedActionItem[] {
  if (!summary) return [];

  const found: ExtractedActionItem[] = [];
  const seen = new Set<string>();
  let underActionHeading = false;
  let actionHeadingDepth = 0;

  const push = (raw: string, source: ExtractedActionItem["source"]) => {
    const text = cleanItemText(raw);
    // One word is a fragment, not a task. The upper bound stops a wall of
    // pasted prose becoming a card title nobody can read.
    if (text.length < 4 || text.length > 300) return;
    if (!/[a-z]/i.test(text)) return;

    const fingerprint = fingerprintOf(text);
    if (!fingerprint || seen.has(fingerprint)) return;
    seen.add(fingerprint);
    found.push({ text, fingerprint, source });
  };

  for (const line of summary.split(/\r?\n/)) {
    const heading = line.match(HEADING);
    if (heading) {
      const depth = heading[1].length;
      if (isActionHeading(heading[2])) {
        underActionHeading = true;
        actionHeadingDepth = depth;
      } else if (underActionHeading && depth <= actionHeadingDepth) {
        // A heading at the same level or higher ends the action section. A
        // deeper one (per-person subheadings, say) does not.
        underActionHeading = false;
      }
      continue;
    }

    const checkbox = line.match(CHECKBOX);
    if (checkbox) {
      // An unchecked box is an outstanding commitment however it is filed.
      if (checkbox[1] === " ") push(checkbox[2], "checkbox");
      continue;
    }

    const bullet = line.match(BULLET);
    if (!bullet) continue;

    if (underActionHeading) {
      push(bullet[1], "heading");
    } else if (looksLikeAction(bullet[1])) {
      push(bullet[1], "phrase");
    }
  }

  return found;
}
