/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const bundlePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "..", "dist", "extension.js");
const bundle = fs.readFileSync(bundlePath, "utf8");
const visualEditorBundlePath = path.resolve(
  path.dirname(bundlePath),
  "visualEditor.js",
);
const visualEditorBundle = fs.readFileSync(visualEditorBundlePath, "utf8");

assert.doesNotMatch(
  bundle,
  /\brequire\w*\(\s*["']\.\.?[\\/]/,
  "production bundle must not retain relative runtime require() calls",
);
assert.doesNotMatch(
  bundle,
  /["']\.\/impl\/(?:format|edit|scanner|parser)["']/,
  "jsonc-parser implementation modules must be bundled into extension.js",
);

const runtimeRequests = [
  ...bundle.matchAll(/\brequire\w*\(\s*["']([^"']+)["']\s*\)/g),
].map((match) => match[1]);
assert.deepEqual(
  [...new Set(runtimeRequests)].sort(),
  [
    "vscode",
    "node:child_process",
    "node:crypto",
    "node:fs",
    "node:fs/promises",
    "node:module",
    "node:os",
    "node:path",
    "node:worker_threads",
  ].sort(),
  "only VS Code and explicitly approved Node built-ins may remain external",
);

assert.doesNotMatch(
  visualEditorBundle,
  /\brequire\s*\(/,
  "the browser-only visual editor bundle must not retain runtime require() calls",
);
assert.match(
  visualEditorBundle,
  /acquireVsCodeApi/,
  "the visual editor bundle must contain its VS Code Webview handshake",
);
for (const [pattern, feature] of [
  [/texleaf-preamble-header/, "expandable preamble control"],
  [/texleaf-math-preview-tooltip/, "source-mode floating Math Preview"],
  [/texleaf-formula-scroll/, "formula-local horizontal overflow viewport"],
  [/texleaf-formula-layout-has-labels/, "non-overlapping formula label column"],
  [/texleaf-heading-line/, "heading-to-body visual spacing"],
  [/texleaf-heading-line-level-5/, "paragraph spacing"],
  [/texleaf-heading-line-level-6/, "subparagraph spacing"],
  [/ResizeObserver/, "post-SVG CodeMirror geometry measurement"],
  [/openBibliography/, "bibliography editor bridge"],
  [/texleaf-theorem-begin/, "theorem and proof visual blocks"],
  [/texleaf-theorem-formula-shell/, "continuous theorem borders around display formulas"],
  [/texleaf-list-marker/, "enumeration visual markers"],
  [/texleaf-label-chip/, "editable label previews"],
  [/texleaf-reference-chip/, "editable cross-reference previews"],
  [/texleaf-reference-chip::after/, "right-aligned cross-reference arrows"],
  [/texleaf-table-card/, "table previews"],
  [/texleaf-image-card/, "local image previews"],
  [/texleaf-measured-block-shell/, "font-size-aware exact block measurement"],
  [/--vscode-editor-font-size/, "VS Code editor font-size inheritance"],
  [/--vscode-editor-line-height/, "VS Code editor line-height inheritance"],
  [/open-native-source/, "explicit native-editor fallback next to same-tab source mode"],
  [/setFormulaVisualMode/, "same-tab visual/source presentation switching"],
  [/tok-comment/, "theme-variable source syntax highlighting"],
  [/--texleaf-syntax-command/, "resolved TextMate LaTeX command coloring"],
  [/--texleaf-syntax-comment/, "resolved TextMate comment coloring"],
  [/texleaf-native-syntax-optimistic/, "no-flash optimistic syntax bridge"],
  [/formulaCommitPreview/, "priority formula commit request"],
  [/queueViewportRequestFrame/, "frame-throttled visible-formula scheduling"],
]) {
  assert.match(
    visualEditorBundle,
    pattern,
    `the visual editor bundle must contain its ${feature}`,
  );
}
assert.doesNotMatch(
  visualEditorBundle,
  /texleaf-formula-edit-hint/,
  "rendered formulas must not add the obsolete hover frame hint",
);
assert.doesNotMatch(
  visualEditorBundle,
  /texleaf-reference-chip::before/,
  "cross-reference arrows must not be rendered before their reference text",
);
assert.match(
  bundle,
  /background:\s*transparent/,
  "the visual-editor Webview document must preserve editor background transparency",
);
assert.doesNotMatch(
  visualEditorBundle,
  /Cambria|Times New Roman|Noto Serif CJK SC/,
  "visual prose must inherit the configured VS Code editor font",
);
assert.match(
  bundle,
  /texleaf-visual-editor-v4/,
  "the extension bundle must contain the theme-neutral visual formula renderer",
);
assert.match(
  bundle,
  /renderCommittedFormula/,
  "the extension bundle must contain the dedicated selection-leave formula renderer",
);
assert.match(
  bundle,
  /waitForViewportInputQuiet/,
  "the extension bundle must contain the latest-request viewport render pump",
);
assert.match(
  bundle,
  /currentColor/,
  "visual formula SVG assets must follow the active Webview theme",
);
assert.doesNotThrow(
  () => new Function(visualEditorBundle),
  "the visual editor bundle must parse as standalone browser JavaScript",
);

const originalLoad = Module._load;
Module._load = function loadWithVsCodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return { EventEmitter: class { event = () => ({ dispose() {} }); } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  delete require.cache[bundlePath];
  const extension = require(bundlePath);
  assert.equal(typeof extension.activate, "function");
  assert.equal(typeof extension.deactivate, "function");
} finally {
  Module._load = originalLoad;
  delete require.cache[bundlePath];
}

console.log(
  "Bundle smoke test passed: extension.js and visualEditor.js are self-contained and parseable.",
);
