"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const workerPath = path.resolve(__dirname, "..", "dist", "mathPreviewWorker.js");
const worker = new Worker(workerPath);
let nextId = 1;
const pending = new Map();

worker.on("message", (message) => {
  const waiter = pending.get(message.id);
  if (waiter === undefined) {
    return;
  }
  pending.delete(message.id);
  clearTimeout(waiter.timeout);
  waiter.resolve(message);
});
worker.on("error", (error) => {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timeout);
    waiter.reject(error);
  }
  pending.clear();
});

function render(overrides) {
  const id = nextId++;
  const request = {
    type: "render",
    id,
    tex: String.raw`\frac{1}{2}+\boldsymbol{x}`,
    display: true,
    macros: {},
    macroFingerprint: "[]",
    foreground: "#202020",
    scale: 1,
    ...overrides,
  };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Worker request ${id} timed out.`));
    }, 5_000);
    pending.set(id, { resolve, reject, timeout });
    worker.postMessage(request);
  });
}

(async () => {
  try {
    const basic = await render({});
    assert.equal(basic.type, "result", basic.message);
    assert.match(basic.svg, /^<svg\b/u);
    assert.match(basic.svg, /shape-rendering="geometricPrecision"/iu);
    assert.match(basic.svg, /text-rendering="geometricPrecision"/iu);
    assert.match(basic.svg, /color-rendering="optimizeQuality"/iu);
    assert.match(basic.svg, /<defs>/u);
    assert.match(basic.svg, /viewBox=/u);
    assert.match(basic.svg, /#202020/iu);
    assert.doesNotMatch(basic.svg, /currentColor/iu);
    assert.doesNotMatch(
      basic.svg,
      /<(?:script|foreignObject|iframe|object|embed)\b|javascript:|\son[a-z]+\s*=/iu,
    );
    assert.doesNotMatch(
      basic.svg,
      /\b(?:xlink:)?href\s*=\s*["'](?!#)/iu,
    );
    assert.ok(basic.widthEm > 0);
    assert.ok(basic.heightEm > 0);

    const darkTheme = await render({
      foreground: "#F0F0F0",
      macroFingerprint: "theme-dark",
    });
    assert.equal(darkTheme.type, "result", darkTheme.message);
    assert.match(
      darkTheme.svg,
      /#f0f0f0/iu,
      "a dark editor theme must produce light SVG glyphs",
    );
    assert.doesNotMatch(
      darkTheme.svg,
      /#202020|currentColor/iu,
      "the worker must replace every MathJax currentColor occurrence with the requested dark-theme foreground",
    );

    const lightTheme = await render({
      foreground: "#202020",
      macroFingerprint: "theme-light",
    });
    assert.equal(lightTheme.type, "result", lightTheme.message);
    assert.match(
      lightTheme.svg,
      /#202020/iu,
      "a light editor theme must produce dark SVG glyphs",
    );
    assert.doesNotMatch(lightTheme.svg, /#f0f0f0|currentColor/iu);

    const cursorMarker = await render({
      tex: String.raw`\begin{align}q&=x\mathord{\color{#ffb454}\rule[-0.2em]{0.07em}{1.2em}}+y\\r&=\frac{a}{b}\end{align}`,
      foreground: "#f0f0f0",
      macroFingerprint: "cursor-marker",
    });
    assert.equal(cursorMarker.type, "result", cursorMarker.message);
    assert.match(
      cursorMarker.svg,
      /#ffb454/iu,
      "the cursor rule must retain its theme-distinct color in the SVG",
    );
    const markerTex = String.raw`\mathord{\color{#ffb454}\rule[-0.2em]{0.07em}{1.2em}}`;
    const cursorStructures = await Promise.all([
      render({
        tex: String.raw`\frac{a${markerTex}+b}{c}`,
        foreground: "#f0f0f0",
        macroFingerprint: "cursor-fraction",
      }),
      render({
        tex: String.raw`x_{i${markerTex}j}`,
        foreground: "#f0f0f0",
        macroFingerprint: "cursor-subscript",
      }),
    ]);
    for (const response of cursorStructures) {
      assert.equal(response.type, "result", response.message);
      assert.match(response.svg, /#ffb454/iu);
    }

    const unsafeForeground = await render({
      foreground: "var(--vscode-editor-foreground)",
      macroFingerprint: "theme-invalid-css",
    });
    assert.equal(unsafeForeground.type, "result", unsafeForeground.message);
    assert.match(
      unsafeForeground.svg,
      /#202020/iu,
      "non-hex CSS must fall back to a safe foreground instead of entering the SVG",
    );
    assert.doesNotMatch(
      unsafeForeground.svg,
      /var\s*\(|--vscode-editor-foreground|currentColor/iu,
    );

    const nonStringForeground = await render({ foreground: 0x202020 });
    assert.equal(
      nonStringForeground.type,
      "error",
      "the worker protocol must reject a non-string foreground",
    );

    const environment = await render({
      tex: String.raw`\begin{align}a&=b\\c&=d\end{align}`,
    });
    assert.equal(environment.type, "result", environment.message);
    assert.match(environment.svg, /^<svg\b/u);

    const tallRows = Array.from(
      { length: 20 },
      (_, index) => `x_{${index + 1}}&=y_{${index + 1}}+z_{${index + 1}}`,
    ).join(String.raw`\\`);
    const tallEnvironment = await render({
      tex: String.raw`\begin{align}${tallRows}\end{align}`,
      macroFingerprint: "tall-environment",
    });
    assert.equal(tallEnvironment.type, "result", tallEnvironment.message);
    assert.ok(
      tallEnvironment.heightEm > 8,
      "a real multiline formula must reach cursor layout at its readable height instead of being pre-capped to 8em",
    );
    const rootHeight = /\bheight="([0-9.]+)ex"/u.exec(
      tallEnvironment.svg,
    );
    assert.ok(rootHeight?.[1]);
    assert.ok(
      Math.abs(Number.parseFloat(rootHeight[1]) / 2 - tallEnvironment.heightEm) < 0.001,
      "worker SVG intrinsic height and metadata must describe the same geometry",
    );

    const configuredMacro = await render({
      tex: String.raw`\pair{y}`,
      macros: {
        pair: [String.raw`\left(#1,#2\right)`, 2, "x"],
      },
      macroFingerprint: '[[' + '"pair"' + ']]',
    });
    assert.equal(configuredMacro.type, "result", configuredMacro.message);

    const latinItalic = await render({
      tex: String.raw`\mathit{Àî}`,
      macroFingerprint: "dynamic-latin-i",
    });
    assert.equal(latinItalic.type, "result", latinItalic.message);
    assert.doesNotMatch(latinItalic.svg, /<text\b/iu);

    const greekAndCyrillic = await render({
      tex: String.raw`ἄ + Ж`,
      macroFingerprint: "dynamic-greek-cyrillic",
    });
    assert.equal(greekAndCyrillic.type, "result", greekAndCyrillic.message);
    assert.doesNotMatch(greekAndCyrillic.svg, /<text\b/iu);

    const definition = await render({
      tex: String.raw`\def\texleafisolatedmacro{LEAK}\texleafisolatedmacro`,
      macroFingerprint: "isolation-same-fingerprint",
    });
    assert.equal(definition.type, "result", definition.message);
    const sameFingerprintProbe = await render({
      tex: String.raw`\texleafisolatedmacro`,
      macroFingerprint: "isolation-same-fingerprint",
    });
    assert.equal(sameFingerprintProbe.type, "result", sameFingerprintProbe.message);
    const freshFingerprintProbe = await render({
      tex: String.raw`\texleafisolatedmacro`,
      macroFingerprint: "isolation-fresh-fingerprint",
    });
    assert.equal(freshFingerprintProbe.type, "result", freshFingerprintProbe.message);
    assert.equal(
      sameFingerprintProbe.svg,
      freshFingerprintProbe.svg,
      "formula-local definitions must not leak into a later request with the same fingerprint",
    );

    const linkAttempt = await render({
      tex: String.raw`\href{javascript:alert(1)}{x}`,
    });
    if (linkAttempt.type === "result") {
      assert.doesNotMatch(linkAttempt.svg, /javascript:|<a\b/iu);
    }

    const recursiveMacro = await render({
      tex: String.raw`\loop`,
      macros: { loop: String.raw`\loop` },
      macroFingerprint: "recursive",
    });
    assert.equal(recursiveMacro.type, "error");

    const oversized = await render({ tex: "x".repeat(32_769) });
    assert.equal(oversized.type, "error");

    const invalidMacro = await render({
      macros: { unsafe: [String.raw`#1`, 99] },
      macroFingerprint: "invalid-macro",
    });
    assert.equal(invalidMacro.type, "error");

    const concurrent = await Promise.all([
      render({ tex: String.raw`\sum_{n=1}^{10} n`, macroFingerprint: "[]" }),
      render({ tex: String.raw`\int_0^1 x^2\,dx`, macroFingerprint: "[]" }),
      render({ tex: String.raw`\begin{matrix}a&b\\c&d\end{matrix}`, macroFingerprint: "[]" }),
    ]);
    assert.equal(
      concurrent.every((response) => response.type === "result"),
      true,
      "queued worker requests must render without sharing mutable MathJax state",
    );

    console.log(
      "Math Preview worker smoke test passed: SVG rendering, dynamic Unicode fonts, request isolation, environments, macros, serialized concurrency, safety limits, and recursion guards work.",
    );
  } finally {
    await worker.terminate();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
