const STEP = 1024;

/**
 * Fractional indexing. `between(a, b)` returns a number strictly between its
 * neighbours, so reordering writes one row. Doubles run out of precision after
 * roughly fifty consecutive splits at the same spot; `needsRebalance` flags a
 * group that has been shuffled that hard, and `rebalance` spreads it back out.
 */
export function between(before: number | null, after: number | null): number {
  if (before === null && after === null) return STEP;
  if (before === null) return after! - STEP;
  if (after === null) return before + STEP;
  return (before + after) / 2;
}

export function positionForIndex(
  ordered: { position: number }[],
  index: number,
): number {
  const before = index > 0 ? ordered[index - 1]?.position ?? null : null;
  const after = ordered[index]?.position ?? null;
  return between(before, after);
}

export function needsRebalance(ordered: { position: number }[]): boolean {
  for (let i = 1; i < ordered.length; i++) {
    if (Math.abs(ordered[i].position - ordered[i - 1].position) < 1e-6) {
      return true;
    }
  }
  return false;
}

export function rebalance<T extends { position: number }>(ordered: T[]): T[] {
  return ordered.map((item, i) => ({ ...item, position: (i + 1) * STEP }));
}

export const POSITION_STEP = STEP;
