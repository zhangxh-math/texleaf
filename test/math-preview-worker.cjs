/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

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
      tex: String.raw`\begin{align}q&=x\mathord{\color{#ffb454}\rule[-0.2em]{0.09em}{1.2em}}+y\\r&=\frac{a}{b}\end{align}`,
      foreground: "#f0f0f0",
      macroFingerprint: "cursor-marker",
      cursorMarkerColor: "#ffb454",
    });
    assert.equal(cursorMarker.type, "result", cursorMarker.message);
    assert.match(
      cursorMarker.svg,
      /#ffb454/iu,
      "the cursor rule must retain its theme-distinct color in the SVG",
    );
    assert.match(cursorMarker.svg, /data-texleaf-preview-caret="true"/u);
    assert.ok(cursorMarker.cursor);
    assert.ok(Number.isFinite(cursorMarker.cursor.x));
    assert.ok(Number.isFinite(cursorMarker.cursor.y));
    assert.ok(cursorMarker.cursor.width > 0);
    assert.ok(cursorMarker.cursor.height > 0);
    const markerTex = String.raw`\mathord{\color{#ffb454}\rule[-0.2em]{0.09em}{1.2em}}`;
    const cursorStructures = await Promise.all([
      render({
        tex: String.raw`\frac{a${markerTex}+b}{c}`,
        foreground: "#f0f0f0",
        macroFingerprint: "cursor-fraction",
        cursorMarkerColor: "#ffb454",
      }),
      render({
        tex: String.raw`x_{i${markerTex}j}`,
        foreground: "#f0f0f0",
        macroFingerprint: "cursor-subscript",
        cursorMarkerColor: "#ffb454",
      }),
    ]);
    for (const response of cursorStructures) {
      assert.equal(response.type, "result", response.message);
      assert.match(response.svg, /#ffb454/iu);
      assert.match(response.svg, /data-texleaf-preview-caret="true"/u);
      assert.ok(response.cursor);
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

    const proofEndingEnvironment = await render({
      tex: String.raw`\begin{align*}F(y_1,x_2)&=0.\qedhere\end{align*}`,
      macroFingerprint: "proof-ending-align-star",
    });
    assert.equal(
      proofEndingEnvironment.type,
      "result",
      "proof-ending display environments must remain previewable: " +
        proofEndingEnvironment.message,
    );
    assert.match(proofEndingEnvironment.svg, /^<svg\b/u);

    const unknownCommand = await render({
      tex: String.raw`\texleafDefinitelyUnknown{x}`,
      macroFingerprint: "unknown-command-must-fail-closed",
    });
    assert.equal(
      unknownCommand.type,
      "error",
      "an unknown TeX command must keep source visible instead of producing a red-name SVG",
    );

    const twoLabeledRowsTex = String.raw`\begin{align}a&=b\label{one}\\c&=d\label{two}\end{align}`;
    const twoLabeledRows = await render({
      tex: twoLabeledRowsTex,
      macroFingerprint: "two-labeled-align-rows",
    });
    const twoLabeledRowsWithNoOpLabels = await render({
      tex: twoLabeledRowsTex,
      macros: { label: ["", 1] },
      macroFingerprint: "two-labeled-align-rows-no-op-label",
    });
    assert.equal(
      twoLabeledRowsWithNoOpLabels.type,
      "result",
      twoLabeledRowsWithNoOpLabels.message,
    );
    const recursiveLabelOverride = await render({
      tex: twoLabeledRowsTex,
      macros: { label: [String.raw`\label{#1}`, 1] },
      macroFingerprint: "two-labeled-align-rows-recursive-label-override",
    });
    assert.equal(
      recursiveLabelOverride.type,
      "result",
      "a request macro must not override the worker's renderer-only no-op label: " +
        recursiveLabelOverride.message,
    );

    const screenshotStyleTex = String.raw`\begin{align}
C(\mathbf{d}) & =\sum_{j=1}^{n}\frac{2d_{j}+1}{\chi(\mathbf{d})-1}C(d_{1},\dots,d_{j}+d_{0},\dots,d_{n})+\sum_{\substack{a,b\geq0\\a+b=d_{0}-1}}\left(\frac{2}{\chi(\mathbf{d})-1}C(a,b,d_{1},\dots,d_{n})\right.\label{eq:bgw-recursion-linear}\\
&\left.+\sum_{I\sqcup J=\{ 1,\dots n \}}\frac{(\chi(a,\mathbf{d}_{I})-1)!(\chi(b,\mathbf{d}_{J})-1)!}{(\chi(d)-1)!}C(a.\mathbf{d}_{I})C(b,\mathbf{d}_{J})\right).\label{eq:bgw-recursion-quadric}
\end{align}`;
    const screenshotStyleEnvironment = await render({
      tex: screenshotStyleTex,
      macroFingerprint: "screenshot-style-align",
    });
    const screenshotStyleWithNoOpLabels = await render({
      tex: screenshotStyleTex,
      macros: { label: ["", 1] },
      macroFingerprint: "screenshot-style-align-no-op-label",
    });
    assert.equal(
      screenshotStyleWithNoOpLabels.type,
      "result",
      screenshotStyleWithNoOpLabels.message,
    );
    assert.equal(twoLabeledRows.type, "result", twoLabeledRows.message);
    assert.equal(
      screenshotStyleEnvironment.type,
      "result",
      screenshotStyleEnvironment.message,
    );
    assert.match(screenshotStyleEnvironment.svg, /^<svg\b/u);

    const malformedDelimiter = await render({
      tex: String.raw`\begin{align}a&=\left(\end{align}`,
      macroFingerprint: "malformed-delimiter-error-message",
    });
    assert.equal(malformedDelimiter.type, "error");
    assert.equal(typeof malformedDelimiter.message, "string");
    assert.ok(malformedDelimiter.message.length > 0);
    assert.notEqual(
      malformedDelimiter.message,
      "[object Object]",
      "structured MathJax failures must retain their useful TeX error message",
    );

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

    // Representative commands and the labeled equation body used by the
    // official ThuThesis v7.7.1 chap03 fixture. These aliases are semantic
    // MathJax approximations, not claims of XeLaTeX font identity.
    const thuThesisMacros = {
      symup: [String.raw`\mathrm{#1}`, 1],
      symbf: [String.raw`\boldsymbol{#1}`, 1],
      symbfsf: [String.raw`\boldsymbol{\mathsf{#1}}`, 1],
      uppi: String.raw`\mathrm{\pi}`,
      increment: String.raw`\mathrm{\Delta}`,
      dif: String.raw`\mathop{}\!\mathrm{d}`,
    };
    const thuThesisEquation = await render({
      tex: String.raw`\frac{1}{2 \uppi \symup{i}} \int_\gamma f = \sum_{k=1}^m n(\gamma; a_k) \mathscr{R}(f; a_k).`,
      macros: thuThesisMacros,
      macroFingerprint: "thuthesis-v7.7.1-chap03-equation",
    });
    assert.equal(thuThesisEquation.type, "result", thuThesisEquation.message);
    const thuThesisSymbols = await render({
      tex: String.raw`\increment+\dif x+\symbf{x}+\symbf{\Sigma}+\symbfsf{T}`,
      macros: thuThesisMacros,
      macroFingerprint: "thuthesis-v7.7.1-symbols",
    });
    assert.equal(thuThesisSymbols.type, "result", thuThesisSymbols.message);

    const doubleAngleFallback = await render({
      tex: String.raw`\llangle x\rrangle`,
      macroFingerprint: "double-angle-fallback",
    });
    assert.equal(
      doubleAngleFallback.type,
      "result",
      "visual Math Preview must render common double-angle commands even when the document does not define them: " +
        doubleAngleFallback.message,
    );
    assert.match(doubleAngleFallback.svg, /^<svg\b/u);

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
    assert.equal(
      sameFingerprintProbe.type,
      "error",
      "a formula-local definition must not leak into a later request with the same fingerprint",
    );
    const freshFingerprintProbe = await render({
      tex: String.raw`\texleafisolatedmacro`,
      macroFingerprint: "isolation-fresh-fingerprint",
    });
    assert.equal(freshFingerprintProbe.type, "error");
    assert.equal(
      sameFingerprintProbe.message,
      freshFingerprintProbe.message,
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
