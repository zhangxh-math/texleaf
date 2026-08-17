import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateMathPreviewHorizontalOffsetColumns,
  createMathPreviewAttachmentTextDecoration,
  normalizeMathPreviewPlacement,
  planMathPreviewLayout,
  type MathPreviewLayoutRequest,
} from "../src/mathPreviewLayout";

const baseRequest: MathPreviewLayoutRequest = {
  mode: "inline",
  formulaStart: { line: 12, character: 8 },
  formulaEnd: { line: 12, character: 24 },
  cursorLine: 12,
  cursorLineStartCharacter: 4,
  visibleRanges: [{ startLine: 0, endLine: 30 }],
  previewHeightEm: 2.5,
  fontSizePx: 14,
  lineHeightPx: 21,
  placement: "autoBelow",
};

function plan(
  changes: Partial<MathPreviewLayoutRequest> = {},
): ReturnType<typeof planMathPreviewLayout> {
  return planMathPreviewLayout({ ...baseRequest, ...changes });
}

test("Math Preview placement normalization preserves formal values and migrates legacy auto", () => {
  for (const placement of [
    "autoBelow",
    "autoAbove",
    "above",
    "below",
  ] as const) {
    assert.equal(normalizeMathPreviewPlacement(placement), placement);
  }
  assert.equal(normalizeMathPreviewPlacement("auto"), "autoBelow");
  assert.equal(normalizeMathPreviewPlacement("unknown"), "autoBelow");
});

test("inline preview stays below and aligns with its opening delimiter on the start line", () => {
  const result = plan();

  assert.equal(result.requiredVisibleLines, 2);
  assert.equal(result.side, "below");
  assert.deepEqual(result.anchor, { line: 12, character: 8 });
  assert.equal(result.hostTextDecoration, "none");
  assert.match(result.attachmentTextDecoration, /position:\s*absolute/iu);
  assert.match(
    result.attachmentTextDecoration,
    /top:\s*calc\(100% \+ 0\.35em\)/iu,
  );
  assert.doesNotMatch(result.attachmentTextDecoration, /\bbottom\s*:/iu);
});

test("autoBelow moves an inline preview above when its preferred lower side is too small", () => {
  const result = plan({
    formulaStart: { line: 29, character: 6 },
    formulaEnd: { line: 29, character: 17 },
    cursorLine: 29,
    cursorLineStartCharacter: 2,
    visibleRanges: [{ startLine: 10, endLine: 30 }],
  });

  assert.equal(result.requiredVisibleLines, 2);
  assert.equal(result.side, "above");
  assert.deepEqual(result.anchor, { line: 29, character: 6 });
  assert.match(
    result.attachmentTextDecoration,
    /bottom:\s*calc\(100% \+ 0\.35em\)/iu,
  );
  assert.doesNotMatch(result.attachmentTextDecoration, /\btop\s*:/iu);
});

test("autoAbove prefers above while autoBelow prefers below", () => {
  assert.equal(plan({ placement: "autoBelow" }).side, "below");
  assert.equal(plan({ placement: "autoAbove" }).side, "above");
});

test("autoAbove falls below when only the lower side can fit", () => {
  const result = plan({
    formulaStart: { line: 1, character: 6 },
    formulaEnd: { line: 1, character: 17 },
    cursorLine: 1,
    visibleRanges: [{ startLine: 0, endLine: 30 }],
    placement: "autoAbove",
  });

  assert.equal(result.requiredVisibleLines, 2);
  assert.equal(result.side, "below");
  assert.deepEqual(result.anchor, { line: 1, character: 6 });
});

test("automatic placement treats exactly the required visible lines as sufficient", () => {
  const aboveExact = plan({
    formulaStart: { line: 2, character: 6 },
    formulaEnd: { line: 2, character: 17 },
    cursorLine: 2,
    visibleRanges: [{ startLine: 0, endLine: 10 }],
    placement: "autoAbove",
  });
  const belowExact = plan({
    formulaStart: { line: 8, character: 6 },
    formulaEnd: { line: 8, character: 17 },
    cursorLine: 8,
    visibleRanges: [{ startLine: 0, endLine: 10 }],
    placement: "autoBelow",
  });

  assert.equal(aboveExact.requiredVisibleLines, 2);
  assert.equal(aboveExact.side, "above");
  assert.equal(belowExact.requiredVisibleLines, 2);
  assert.equal(belowExact.side, "below");
});

test("both automatic placements force above when neither side can fit", () => {
  const common = {
    formulaStart: { line: 1, character: 6 },
    formulaEnd: { line: 1, character: 17 },
    cursorLine: 1,
    visibleRanges: [{ startLine: 0, endLine: 2 }],
    previewHeightEm: 4,
  } as const;

  const belowFirst = plan({ ...common, placement: "autoBelow" });
  const aboveFirst = plan({ ...common, placement: "autoAbove" });
  assert.ok(belowFirst.requiredVisibleLines > 1);
  assert.equal(belowFirst.side, "above");
  assert.equal(aboveFirst.side, "above");
  assert.deepEqual(aboveFirst.anchor, belowFirst.anchor);
});

test("an oversized inline preview uses the common automatic overflow side", () => {
  const result = plan({
    formulaStart: { line: 15, character: 6 },
    formulaEnd: { line: 15, character: 17 },
    cursorLine: 15,
    visibleRanges: [{ startLine: 10, endLine: 20 }],
    previewHeightEm: 30,
  });

  assert.ok(result.requiredVisibleLines > 10);
  assert.equal(result.side, "above");
  assert.deepEqual(result.anchor, { line: 15, character: 6 });
  assert.deepEqual(
    plan({
      formulaStart: { line: 15, character: 6 },
      formulaEnd: { line: 15, character: 17 },
      cursorLine: 15,
      visibleRanges: [{ startLine: 10, endLine: 20 }],
      previewHeightEm: 30,
      placement: "autoAbove",
    }),
    result,
  );
});

test("explicit above and below placements override automatic space selection", () => {
  const nearTop = {
    formulaStart: { line: 10, character: 3 },
    formulaEnd: { line: 10, character: 9 },
    cursorLine: 10,
    visibleRanges: [{ startLine: 10, endLine: 30 }],
  } as const;
  const nearBottom = {
    formulaStart: { line: 30, character: 3 },
    formulaEnd: { line: 30, character: 9 },
    cursorLine: 30,
    visibleRanges: [{ startLine: 10, endLine: 30 }],
  } as const;

  assert.equal(
    plan({ ...nearTop, placement: "above" }).side,
    "above",
  );
  assert.equal(
    plan({ ...nearBottom, placement: "below" }).side,
    "below",
  );
});

test("multiline block previews align both sides with the opening delimiter column", () => {
  const common = {
    mode: "block" as const,
    formulaStart: { line: 20, character: 4 },
    formulaEnd: { line: 26, character: 31 },
    cursorLine: 23,
    visibleRanges: [{ startLine: 15, endLine: 35 }],
  };

  assert.deepEqual(plan({ ...common, placement: "above" }).anchor, {
    line: 20,
    character: 4,
  });
  assert.deepEqual(plan({ ...common, placement: "below" }).anchor, {
    line: 26,
    character: 4,
  });
});

test("multiline block previews keep opening-delimiter alignment when a vertical boundary is off screen", () => {
  const common = {
    mode: "block" as const,
    formulaStart: { line: 5, character: 4 },
    formulaEnd: { line: 50, character: 31 },
    cursorLine: 24,
    visibleRanges: [{ startLine: 20, endLine: 30 }],
  };

  assert.deepEqual(plan({ ...common, placement: "above" }).anchor, {
    line: 24,
    character: 4,
  });
  assert.deepEqual(plan({ ...common, placement: "below" }).anchor, {
    line: 24,
    character: 4,
  });
});

test("autoBelow keeps its below preference when both sides have enough visible space", () => {
  const result = plan({
    formulaStart: { line: 15, character: 8 },
    formulaEnd: { line: 15, character: 24 },
    cursorLine: 15,
    visibleRanges: [{ startLine: 0, endLine: 30 }],
  });

  assert.equal(result.requiredVisibleLines, 2);
  assert.equal(result.side, "below");
});

test("autoAbove prefers above for a block preview when both sides fit", () => {
  const common = {
    mode: "block",
    formulaStart: { line: 12, character: 8 },
    formulaEnd: { line: 14, character: 24 },
    cursorLine: 13,
    visibleRanges: [{ startLine: 0, endLine: 30 }],
  } as const;
  const belowFirst = plan({ ...common, placement: "autoBelow" });
  const aboveFirst = plan({ ...common, placement: "autoAbove" });

  assert.equal(belowFirst.side, "below");
  assert.deepEqual(belowFirst.anchor, { line: 14, character: 8 });
  assert.equal(aboveFirst.side, "above");
  assert.deepEqual(aboveFirst.anchor, { line: 12, character: 8 });
});

test("autoAbove falls below for a block preview when its upper formula boundary lacks room", () => {
  const result = plan({
    mode: "block",
    formulaStart: { line: 1, character: 8 },
    formulaEnd: { line: 3, character: 24 },
    cursorLine: 2,
    visibleRanges: [{ startLine: 0, endLine: 30 }],
    placement: "autoAbove",
  });

  assert.equal(result.side, "below");
  assert.deepEqual(result.anchor, { line: 3, character: 8 });
});

test("an oversized multiline preview preserves its bottom and the last three source lines", () => {
  const result = plan({
    mode: "block",
    formulaStart: { line: 2, character: 4 },
    formulaEnd: { line: 40, character: 28 },
    cursorLine: 40,
    visibleRanges: [{ startLine: 30, endLine: 42 }],
    previewHeightEm: 30,
  });

  assert.ok(result.requiredVisibleLines > 12);
  assert.equal(result.side, "above");
  assert.deepEqual(result.anchor, { line: 38, character: 4 });
  assert.match(
    result.attachmentTextDecoration,
    /bottom:\s*calc\(100% \+ 0\.35em\)/iu,
  );

  const aboveFirst = plan({
    mode: "block",
    formulaStart: { line: 2, character: 4 },
    formulaEnd: { line: 40, character: 28 },
    cursorLine: 40,
    visibleRanges: [{ startLine: 30, endLine: 42 }],
    previewHeightEm: 30,
    placement: "autoAbove",
  });
  assert.deepEqual(
    aboveFirst,
    result,
    "both automatic preferences must share the complete block overflow-tail plan",
  );
});

test("a multiline inline-delimited formula follows the cursor line indentation", () => {
  const result = plan({
    mode: "inline",
    formulaStart: { line: 10, character: 9 },
    formulaEnd: { line: 40, character: 28 },
    cursorLine: 40,
    cursorLineStartCharacter: 7,
    visibleRanges: [{ startLine: 30, endLine: 42 }],
    previewHeightEm: 30,
  });

  assert.equal(result.side, "above");
  assert.deepEqual(result.anchor, { line: 40, character: 7 });
});

test("an oversized formula tail at the top edge stays in view without creating an invalid anchor", () => {
  const result = plan({
    mode: "block",
    formulaStart: { line: 2, character: 4 },
    formulaEnd: { line: 30, character: 28 },
    cursorLine: 30,
    visibleRanges: [{ startLine: 30, endLine: 42 }],
    previewHeightEm: 30,
  });

  assert.equal(result.side, "above");
  assert.deepEqual(result.anchor, { line: 30, character: 4 });
});

test("autoBelow stays above when the formula ending boundary is below the viewport", () => {
  const result = plan({
    mode: "block",
    formulaStart: { line: 4, character: 6 },
    formulaEnd: { line: 80, character: 24 },
    cursorLine: 29,
    visibleRanges: [{ startLine: 20, endLine: 40 }],
    previewHeightEm: 30,
  });

  assert.equal(result.side, "above");
  assert.deepEqual(
    result.anchor,
    { line: 27, character: 6 },
    "the current tail and its two preceding source lines stay below the card",
  );
});

test("horizontal correction preserves the opening delimiter column across short lines and tabs", () => {
  assert.equal(
    calculateMathPreviewHorizontalOffsetColumns(
      "    \\[",
      4,
      "\\]",
      2,
      4,
    ),
    2,
    "a short closing line needs a positive offset to retain four-space indentation",
  );
  assert.equal(
    calculateMathPreviewHorizontalOffsetColumns(
      "\t\\begin{align}",
      1,
      "\t  \\end{align}",
      1,
      4,
    ),
    0,
    "matching tab indentation must have the same visual column",
  );
  assert.equal(
    calculateMathPreviewHorizontalOffsetColumns(
      "  \\[",
      2,
      "\t\\]",
      1,
      4,
    ),
    -2,
    "a wider anchor prefix needs a safe negative correction",
  );
});

test("attachment CSS preserves Monaco's static anchor and translates only by a bounded correction", () => {
  const positive = createMathPreviewAttachmentTextDecoration("below", 3);
  const negative = createMathPreviewAttachmentTextDecoration("above", -2);
  const invalid = createMathPreviewAttachmentTextDecoration(
    "above",
    Number.NaN,
  );
  const clamped = createMathPreviewAttachmentTextDecoration(
    "below",
    999_999,
  );

  assert.match(
    positive,
    /transform:\s*translateX\(3ch\);[^\r\n]*top:\s*calc/iu,
  );
  assert.match(
    negative,
    /transform:\s*translateX\(-2ch\);[^\r\n]*bottom:\s*calc/iu,
  );
  assert.match(invalid, /transform:\s*translateX\(0\)/iu);
  assert.match(clamped, /transform:\s*translateX\(2048ch\)/iu);

  for (const css of [positive, negative, invalid, clamped]) {
    assert.doesNotMatch(
      css,
      /(?:^|;\s*)(?:left|right|inset(?:-inline(?:-(?:start|end))?)?)\s*:/iu,
      "a horizontal inset would re-anchor the absolute attachment to the whole Monaco view line",
    );
    assert.doesNotMatch(
      css,
      /(?:url\s*\(|expression\s*\(|javascript\s*:|@import|[<>"'\r\n\\])/iu,
    );
  }
});

test("the layout planner receives the full displayed height of a tall preview", () => {
  const result = plan({
    mode: "block",
    formulaStart: { line: 10, character: 4 },
    formulaEnd: { line: 30, character: 4 },
    cursorLine: 30,
    visibleRanges: [{ startLine: 20, endLine: 32 }],
    previewHeightEm: 30,
    fontSizePx: 14,
    lineHeightPx: 21,
  });

  assert.equal(result.requiredVisibleLines, 21);
  assert.equal(result.side, "above");
  assert.deepEqual(result.anchor, { line: 28, character: 4 });
});

test("space in a different visible range cannot override the range containing the cursor", () => {
  const result = plan({
    mode: "block",
    formulaStart: { line: 29, character: 8 },
    formulaEnd: { line: 29, character: 24 },
    cursorLine: 29,
    visibleRanges: [
      { startLine: 100, endLine: 200 },
      { startLine: 10, endLine: 30 },
    ],
  });

  assert.equal(result.requiredVisibleLines, 2);
  assert.equal(result.side, "above");
  assert.deepEqual(result.anchor, { line: 29, character: 8 });
});

test("an off-screen formula boundary does not move a forced preview outside the cursor viewport", () => {
  const result = plan({
    mode: "block",
    formulaStart: { line: 4, character: 8 },
    formulaEnd: { line: 80, character: 24 },
    cursorLine: 29,
    visibleRanges: [{ startLine: 20, endLine: 35 }],
    placement: "below",
  });

  assert.equal(result.side, "below");
  assert.deepEqual(result.anchor, { line: 29, character: 8 });
});

test("invalid preview dimensions use finite defaults", () => {
  const result = plan({
    previewHeightEm: Number.POSITIVE_INFINITY,
    fontSizePx: -1,
    lineHeightPx: Number.NaN,
  });

  assert.equal(result.requiredVisibleLines, 1);
  assert.equal(result.side, "below");
  assert.deepEqual(result.anchor, {
    line: baseRequest.cursorLine,
    character: baseRequest.formulaStart.character,
  });
});

test("layout CSS is fixed, non-interactive, and contains no executable payload syntax", () => {
  const above = plan({ placement: "above" });
  const anotherAbove = plan({
    mode: "block",
    formulaStart: { line: 999, character: 999 },
    formulaEnd: { line: 1_001, character: 999 },
    cursorLine: 1_000,
    visibleRanges: [{ startLine: 990, endLine: 1_010 }],
    previewHeightEm: 100,
    fontSizePx: 72,
    lineHeightPx: 1,
    placement: "above",
  });
  const below = plan({ placement: "below" });

  assert.equal(
    above.hostTextDecoration,
    "none",
  );
  assert.equal(anotherAbove.hostTextDecoration, above.hostTextDecoration);
  assert.equal(
    above.attachmentTextDecoration,
    "none; position: absolute; display: inline-block; " +
      "transform: translateX(0); " +
      "bottom: calc(100% + 0.35em); z-index: 10; pointer-events: none; " +
      "opacity: 1; overflow: visible; background-repeat: no-repeat; " +
      "background-size: 100% 100%;",
  );
  assert.equal(
    anotherAbove.attachmentTextDecoration,
    above.attachmentTextDecoration,
  );
  assert.equal(
    below.attachmentTextDecoration,
    "none; position: absolute; display: inline-block; " +
      "transform: translateX(0); " +
      "top: calc(100% + 0.35em); z-index: 10; pointer-events: none; " +
      "opacity: 1; overflow: visible; background-repeat: no-repeat; " +
      "background-size: 100% 100%;",
  );

  for (const css of [
    above.hostTextDecoration,
    above.attachmentTextDecoration,
    below.attachmentTextDecoration,
  ]) {
    assert.doesNotMatch(
      css,
      /(?:url\s*\(|expression\s*\(|javascript\s*:|@import|[<>"'\r\n\\])/iu,
    );
  }
});
