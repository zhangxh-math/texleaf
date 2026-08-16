import assert from "node:assert/strict";
import test from "node:test";

import {
  createMathPreviewCursorMarker,
  resolveMathPreviewAppearance,
} from "../src/mathPreviewAppearance";
import {
  fitMathPreviewSvgForCursor,
  frameMathPreviewSvg,
} from "../src/mathPreviewCard";

test("dark Math Preview appearance keeps glyphs, cursor, and card readable", () => {
  assert.deepEqual(resolveMathPreviewAppearance(true), {
    foreground: "#ffffff",
    cursor: "#00e5ff",
    cardBackground: "#0b0f14",
    cardBackgroundOpacity: 1,
    cardBorder: "#ffffff",
    cardBorderOpacity: 0.32,
  });
});

test("light Math Preview appearance uses a distinct high-contrast palette", () => {
  assert.deepEqual(resolveMathPreviewAppearance(false), {
    foreground: "#202020",
    cursor: "#e0005a",
    cardBackground: "#fafafc",
    cardBackgroundOpacity: 1,
    cardBorder: "#000000",
    cardBorderOpacity: 0.28,
  });
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
    createMathPreviewCursorMarker("#e0005a"),
    "\\mathord{\\color{#E0005A}\\rule[-0.2em]{0.09em}{1.2em}}",
  );
  assert.equal(
    createMathPreviewCursorMarker("var(--unsafe)"),
    "\\mathord{\\color{#00E5FF}\\rule[-0.2em]{0.09em}{1.2em}}",
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
