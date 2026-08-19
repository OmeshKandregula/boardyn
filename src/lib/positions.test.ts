import { describe, expect, it } from "vitest";
import {
  POSITION_STEP,
  between,
  needsRebalance,
  positionForIndex,
  rebalance,
} from "./positions";

describe("between", () => {
  it("puts the first card at the step", () => {
    expect(between(null, null)).toBe(POSITION_STEP);
  });

  it("appends after the last card", () => {
    expect(between(1024, null)).toBe(2048);
  });

  it("prepends before the first card", () => {
    expect(between(null, 1024)).toBe(0);
  });

  it("lands halfway between two neighbours", () => {
    expect(between(1024, 2048)).toBe(1536);
  });

  it("stays strictly between its neighbours", () => {
    // The ordering guarantee the whole drag feature rests on: a card must not
    // land exactly on a neighbour, or the two swap unpredictably on reload.
    let low = 0;
    let high = 1;
    for (let i = 0; i < 20; i++) {
      const mid = between(low, high);
      expect(mid).toBeGreaterThan(low);
      expect(mid).toBeLessThan(high);
      high = mid;
    }
  });

  it("handles negative positions, which prepending produces", () => {
    expect(between(null, 0)).toBe(-POSITION_STEP);
    expect(between(-2048, -1024)).toBe(-1536);
  });
});

describe("positionForIndex", () => {
  const ordered = [{ position: 1000 }, { position: 2000 }, { position: 3000 }];

  it("computes a position for the top of the list", () => {
    expect(positionForIndex(ordered, 0)).toBeLessThan(1000);
  });

  it("computes a position for the middle of the list", () => {
    const position = positionForIndex(ordered, 1);
    expect(position).toBeGreaterThan(1000);
    expect(position).toBeLessThan(2000);
  });

  it("computes a position past the end of the list", () => {
    expect(positionForIndex(ordered, 3)).toBeGreaterThan(3000);
  });

  it("handles an empty list", () => {
    expect(positionForIndex([], 0)).toBe(POSITION_STEP);
  });
});

describe("rebalance", () => {
  it("flags a list whose neighbours have collapsed together", () => {
    // Fifty-odd splits at the same spot exhaust the precision of a double and
    // two cards end up sharing a position. This is the detector for that.
    let low = 0;
    const high = 1024;
    const positions = [low, high];
    for (let i = 0; i < 60; i++) {
      const mid = between(low, high);
      low = mid;
      positions.splice(1, 0, mid);
    }
    const collapsed = positions
      .sort((a, b) => a - b)
      .map((position) => ({ position }));

    expect(needsRebalance(collapsed)).toBe(true);
  });

  it("leaves a healthy list alone", () => {
    expect(
      needsRebalance([{ position: 1000 }, { position: 2000 }]),
    ).toBe(false);
  });

  it("spreads positions back out while preserving order", () => {
    const input = [
      { id: "a", position: 1 },
      { id: "b", position: 1.0000001 },
      { id: "c", position: 5 },
    ];
    const output = rebalance(input);

    expect(output.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(output.map((item) => item.position)).toEqual([1024, 2048, 3072]);
    expect(needsRebalance(output)).toBe(false);
  });
});
