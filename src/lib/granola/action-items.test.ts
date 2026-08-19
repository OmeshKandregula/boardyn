import { describe, expect, it } from "vitest";
import { cleanItemText, extractActionItems } from "./action-items";

const texts = (summary: string) =>
  extractActionItems(summary).map((item) => item.text);

describe("extractActionItems", () => {
  it("takes the bullets under an action items heading", () => {
    const summary = `
## Summary
We talked about pricing and the launch.

## Action items
- Alex to draft the pricing page
- Sam to email the design agency
`;
    expect(texts(summary)).toEqual([
      "Alex to draft the pricing page",
      "Sam to email the design agency",
    ]);
  });

  it("recognises the other names teams give that section", () => {
    for (const heading of ["Next steps", "Follow-ups", "TODOs", "Tasks"]) {
      expect(texts(`### ${heading}\n- Send the deck`)).toEqual(["Send the deck"]);
    }
  });

  it("stops at the next heading of the same level", () => {
    const summary = `
## Action items
- Send the deck

## Notes
- Pricing felt high
- The demo crashed twice
`;
    expect(texts(summary)).toEqual(["Send the deck"]);
  });

  it("keeps going through deeper subheadings", () => {
    // Granola often files actions per person underneath the section.
    const summary = `
## Action items
### Alex
- Draft the pricing page
### Sam
- Email the agency
`;
    expect(texts(summary)).toEqual([
      "Draft the pricing page",
      "Email the agency",
    ]);
  });

  it("takes unchecked boxes anywhere in the note", () => {
    const summary = `
## Notes
- [ ] Book the venue
- [x] Already sorted the catering
`;
    expect(texts(summary)).toEqual(["Book the venue"]);
  });

  it("leaves checked boxes alone", () => {
    // Something already done is not a task to put on a board.
    expect(texts("- [x] Shipped the invite flow")).toEqual([]);
  });

  it("picks up commitments phrased as such outside any heading", () => {
    const summary = `
## Discussion
- Alex will send the investor update on Friday
- Pricing felt high to both of us
`;
    expect(texts(summary)).toEqual([
      "Alex will send the investor update on Friday",
    ]);
  });

  it("does not turn ordinary discussion into tasks", () => {
    // The failure that matters. A missed item is a line you re-read; a false
    // one is a card on the board nobody agreed to.
    const summary = `
## Notes
- The demo crashed twice
- Pricing felt high
- We are happy with the current roadmap
- Revenue was up last month
`;
    expect(texts(summary)).toEqual([]);
  });

  it("strips markdown so a card title is not full of syntax", () => {
    const summary = `
## Action items
- **Alex** to review the [pricing doc](https://example.com/doc)
`;
    expect(texts(summary)).toEqual(["Alex to review the pricing doc"]);
  });

  it("does not repeat an item that appears twice", () => {
    const summary = `
## Action items
- Send the deck
## Next steps
- send the deck.
`;
    expect(texts(summary)).toEqual(["Send the deck"]);
  });

  it("gives the same fingerprint to the same item across re-summarisations", () => {
    // Granola can regenerate a summary; wording drifts in case and
    // punctuation. A changed fingerprint would resurrect dismissed items.
    const first = extractActionItems("## Action items\n- Send the deck");
    const second = extractActionItems("## Action items\n- send the deck!");
    expect(first[0].fingerprint).toBe(second[0].fingerprint);
  });

  it("gives different fingerprints to different items", () => {
    const items = extractActionItems(
      "## Action items\n- Send the deck\n- Book the venue",
    );
    expect(items[0].fingerprint).not.toBe(items[1].fingerprint);
  });

  it("ignores fragments and walls of text", () => {
    const summary = `
## Action items
- ok
- ${"a very long sentence ".repeat(40)}
- Send the deck
`;
    expect(texts(summary)).toEqual(["Send the deck"]);
  });

  it("handles numbered lists", () => {
    expect(texts("## Action items\n1. Send the deck\n2) Book the venue")).toEqual([
      "Send the deck",
      "Book the venue",
    ]);
  });

  it("handles an empty or missing summary", () => {
    expect(extractActionItems(null)).toEqual([]);
    expect(extractActionItems("")).toEqual([]);
    expect(extractActionItems("Just a sentence with no structure.")).toEqual([]);
  });

  it("records where each item came from", () => {
    const items = extractActionItems(
      "## Action items\n- Send the deck\n\n## Notes\n- [ ] Book the venue\n- Sam will call the bank",
    );
    expect(items.map((i) => i.source)).toEqual(["heading", "checkbox", "phrase"]);
  });
});

describe("cleanItemText", () => {
  it("removes emphasis, backticks and leading punctuation", () => {
    expect(cleanItemText("**bold** and `code` and _italic_")).toBe(
      "bold and code and italic",
    );
    expect(cleanItemText("  -- Send the deck  ")).toBe("Send the deck");
  });

  it("keeps a bare URL intact", () => {
    expect(cleanItemText("Read https://example.com/doc before Friday")).toBe(
      "Read https://example.com/doc before Friday",
    );
  });

  it("collapses runs of whitespace", () => {
    expect(cleanItemText("Send    the\tdeck")).toBe("Send the deck");
  });
});
