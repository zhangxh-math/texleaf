/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createMathPreviewCursorMarker,
  resolveMathPreviewAppearance,
} from "../src/mathPreviewAppearance";
import {
  createMathPreviewErrorCard,
  createMathPreviewCursorViewport,
  fitMathPreviewSvgForCursor,
  frameMathPreviewSvg,
  inferMathPreviewErrorLocation,
} from "../src/mathPreviewCard";

test("dark Math Preview appearance keeps glyphs, cursor, and card readable", () => {
  assert.deepEqual(resolveMathPreviewAppearance(true), {
    foreground: "#ffffff",
    cursor: "#ff2bd6",
    cardBackground: "#0b0f14",
    cardBackgroundOpacity: 1,
    cardBorder: "#ffffff",
    cardBorderOpacity: 0.32,
  });
});

test("light Math Preview appearance uses a distinct high-contrast palette", () => {
  assert.deepEqual(resolveMathPreviewAppearance(false), {
    foreground: "#202020",
    cursor: "#006dff",
    cardBackground: "#fafafc",
    cardBackgroundOpacity: 1,
    cardBorder: "#000000",
    cardBorderOpacity: 0.28,
  });
});

test("render errors become bounded red SVG cards with a highlighted source token", () => {
  const source = String.raw`\[x+\unknowncommand{y}\]`;
  const card = createMathPreviewErrorCard(
    String.raw`Undefined control sequence \unknowncommand`,
    source,
    resolveMathPreviewAppearance(true),
  );

  assert.ok(card.widthEm >= 18 && card.widthEm <= 40);
  assert.ok(card.heightEm > 6 && card.heightEm < 10);
  assert.match(card.svg, /data-texleaf-preview-error="true"/u);
  assert.match(card.svg, /stroke="#ff4d64"/u);
  assert.match(card.svg, /fill="#ff4d64" font-weight="700">\\unknowncommand/u);
  assert.doesNotMatch(card.svg, /<script|<foreignObject/iu);
});

test("render error location inference handles commands, offsets, and unmatched braces", () => {
  assert.deepEqual(
    inferMathPreviewErrorLocation(
      String.raw`Undefined control sequence \oops`,
      String.raw`x+\oops{y}`,
    ),
    { from: 2, to: 7 },
  );
  assert.deepEqual(
    inferMathPreviewErrorLocation("Parse error at position 3", "abcdef"),
    { from: 3, to: 4 },
  );
  assert.deepEqual(
    inferMathPreviewErrorLocation("Missing close brace", String.raw`\frac{1}{2`),
    { from: 8, to: 9 },
  );
});

test("preview card is painted as a padded rounded SVG layer", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" width="6ex" height="2ex" viewBox="0 -500 2652 884"><defs/><g fill="#ffffff"/></svg>';
  const framed = frameMathPreviewSvg(
    { svg: source, widthEm: 3, heightEm: 1 },
    resolveMathPreviewAppearance(true),
  );

  assert.equal(framed.widthEm, 4.1);
  assert.equal(framed.heightEm, 1.8);
  assert.match(framed.svg, /<rect data-texleaf-preview-card="true"/u);
  assert.match(framed.svg, /\brx="[1-9][0-9.]*"/u);
  assert.match(framed.svg, /\bry="[1-9][0-9.]*"/u);
  assert.match(framed.svg, /fill="#0b0f14" fill-opacity="1"/u);
  assert.match(framed.svg, /stroke="#ffffff" stroke-opacity="0\.32"/u);
  assert.ok(framed.svg.indexOf("<rect") < framed.svg.indexOf("<defs"));
  assert.notEqual(framed.svg, source);
  assert.equal(
    frameMathPreviewSvg(framed, resolveMathPreviewAppearance(true)),
    framed,
    "framing the same asset twice must be idempotent",
  );
});

test("theme palettes expose only sanitized colors accepted by their consumers", () => {
  for (const appearance of [
    resolveMathPreviewAppearance(true),
    resolveMathPreviewAppearance(false),
  ]) {
    assert.match(appearance.foreground, /^#[0-9a-f]{6}$/u);
    assert.match(appearance.cursor, /^#[0-9a-f]{6}$/u);
    assert.match(appearance.cardBackground, /^#[0-9a-f]{6}$/u);
    assert.match(appearance.cardBorder, /^#[0-9a-f]{6}$/u);
    assert.equal(appearance.cardBackgroundOpacity, 1);
    assert.ok(appearance.cardBorderOpacity > 0);
    assert.ok(appearance.cardBorderOpacity < 0.5);
    assert.notEqual(appearance.cursor, appearance.foreground);
  }
});

test("preview card framing fails open for unexpected SVG dimensions", () => {
  const asset = {
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>',
    widthEm: 2,
    heightEm: 1,
  };
  assert.equal(
    frameMathPreviewSvg(asset, resolveMathPreviewAppearance(false)),
    asset,
  );
});

test("cursor marker is a narrow sanitized rule with a theme color", () => {
  assert.equal(
    createMathPreviewCursorMarker("#006dff"),
    "\\mathord{\\color{#006DFF}\\rule[-0.2em]{0.09em}{1.2em}}",
  );
  assert.equal(
    createMathPreviewCursorMarker("var(--unsafe)"),
    "\\mathord{\\color{#FF2BD6}\\rule[-0.2em]{0.09em}{1.2em}}",
  );
});

test("narrow formulas keep the final SVG aspect ratio instead of worker clamps", () => {
  const framed = frameMathPreviewSvg(
    {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="0.158ex" height="1.2ex" viewBox="0 -500 70 530"><g/></svg>',
      widthEm: 0.5,
      heightEm: 0.6,
    },
    resolveMathPreviewAppearance(false),
  );
  assert.equal(framed.widthEm, 1.179);
  assert.equal(framed.heightEm, 1.4);
  assert.match(framed.svg, /width="2\.358ex" height="2\.8ex"/u);
  assert.match(
    framed.svg,
    /fill="#fafafc" fill-opacity="1"[^>]*stroke="#000000" stroke-opacity="0\.28"/u,
  );
});

test("cursor SVG fitting changes intrinsic dimensions instead of relying on ignored attachment CSS", () => {
  const fitted = fitMathPreviewSvgForCursor(
    {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="160ex" height="120ex" viewBox="0 0 1600 1200"><g/></svg>',
      widthEm: 80,
      heightEm: 60,
    },
    40,
    256,
  );

  assert.equal(fitted.widthEm, 40);
  assert.equal(fitted.heightEm, 30);
  assert.match(fitted.svg, /width="80ex" height="60ex"/u);
  assert.match(fitted.svg, /viewBox="0 0 1600 1200"/u);
});

test("ordinary tall formulas are not vertically compressed before placement planning", () => {
  const tall = {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40ex" height="200ex" viewBox="0 0 400 2000"><g/></svg>',
    widthEm: 20,
    heightEm: 100,
  };

  assert.equal(fitMathPreviewSvgForCursor(tall, 40, 256), tall);
});

test("pathological SVG height uses only the high paint-safety ceiling", () => {
  const fitted = fitMathPreviewSvgForCursor(
    {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40ex" height="2000ex" viewBox="0 0 400 20000"><g/></svg>',
      widthEm: 20,
      heightEm: 1_000,
    },
    40,
    256,
  );

  assert.equal(fitted.widthEm, 5.12);
  assert.equal(fitted.heightEm, 256);
  assert.match(fitted.svg, /width="10\.24ex" height="512ex"/u);
});

test("oversized native previews crop around measured caret geometry and expose scroll positions", () => {
  const viewport = createMathPreviewCursorViewport(
    {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200ex" height="80ex" viewBox="0 0 1000 400"><rect data-texleaf-preview-caret="true" x="800" y="300" width="10" height="20"/></svg>',
      widthEm: 100,
      heightEm: 40,
      cursor: { x: 800, y: 300, width: 10, height: 20 },
    },
    40,
    18,
    resolveMathPreviewAppearance(true),
  );

  assert.equal(viewport.widthEm, 40);
  assert.equal(viewport.heightEm, 18);
  assert.match(viewport.svg, /data-texleaf-preview-scroll-viewport="true"/u);
  assert.match(viewport.svg, /width="80ex" height="36ex"/u);
  assert.match(viewport.svg, /viewBox="600 220 400 180"/u);
  assert.match(viewport.svg, /data-texleaf-preview-scroll-thumb-x="true"/u);
  assert.match(viewport.svg, /data-texleaf-preview-scroll-thumb-y="true"/u);
  assert.match(viewport.svg, /data-texleaf-preview-caret="true"/u);
  assert.deepEqual(viewport.cursor, { x: 800, y: 300, width: 10, height: 20 });
});
