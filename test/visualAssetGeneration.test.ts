import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { collectLocalLatexPreviewSettings, createMathPreviewRenderInput, mathPreviewMacroEnvironmentAtOffset,
  scanMathPreviewDocument, type MathPreviewRenderInput } from "../src/core/mathPreview";
import { createLocalLatexPreviewDocument, localLatexPreviewKind } from "../src/core/localLatexPreview";
import { scanVisualDocumentStructure, visualInlineReferenceRecords, mapVisualRecordInlineSegments } from "../src/core/visualStructure";

// Exercise the provider's real deferred local-TeX lane without loading VS Code.
const provider = readFileSync("src/visualEditorProvider.ts", "utf8").replace(/\r\n/gu, "\n");
const start = provider.indexOf("          if (this.renderer.usesLocalTeX(input)) {");
const end = provider.indexOf("          try {\n            const result = await this.renderer.render(", start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(`
  function queueLocal(session, snapshot, generation, renderer) {
    const input = { tex: "graph" };
    const config = { visualCompatibilityMode: "maximum", mathPreviewScale: 1, buildBinPath: "" };
    const host = { renderer, prepareLocalPreviewInput: async (_session, _snapshot, input) => input,
      output: { warn: () => {} } };
    (function () {
      for (const record of [{ id: "graph", from: 0, to: 5 }]) {
        ${provider.slice(start, end)}
      }
    }).call(host);
    return session.localFormulaWork;
  }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const queueLocal = runInNewContext(compiled + "\nqueueLocal", {
  VISUAL_EDITOR_PROTOCOL: 1,
  visualTexBinPath: () => "",
  rememberRenderedFormulaId: (session: { renderedFormulaIds: Set<string> }, id: string) => session.renderedFormulaIds.add(id),
  errorMessage: (error: unknown) => String(error),
}) as (session: ReturnType<typeof fixture>["session"], snapshot: Snapshot, generation: number,
  renderer: { usesLocalTeX: () => boolean; render: () => Promise<Asset> }) => Promise<void>;

interface Snapshot { version: number; assetGeneration: number; text: string }
interface Asset { svg: string; widthEm: number; heightEm: number }
interface Batch { type: string; version: number; assetGeneration: number }
const asset: Asset = { svg: "<svg/>", widthEm: 1, heightEm: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(postMessage?: (message: Batch) => Promise<boolean>) {
  const messages: Batch[] = [];
  const snapshot: Snapshot = { version: 7, assetGeneration: 1, text: "graph" };
  const session = {
    document: { uri: {} }, snapshot, documentGeneration: 2, renderGeneration: 10, disposed: false,
    localAssetController: new AbortController(),
    renderedFormulaIds: new Set<string>(), pendingLocalFormulaIds: new Set<string>(),
    localFormulaWork: Promise.resolve(),
    panel: { webview: { postMessage: async (message: Batch) => {
      messages.push(message);
      return postMessage === undefined ? true : postMessage(message);
    } } },
  };
  return { session, snapshot, messages };
}

test("local assets keep the published snapshot generation while the next document prepares", async () => {
  const { session, snapshot, messages } = fixture();
  await queueLocal(session, snapshot, session.renderGeneration,
    { usesLocalTeX: () => true, render: async () => asset });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.assetGeneration, 1, "the WebView has generation 1 until the next document publishes");
  assert.equal(messages[0]?.version, snapshot.version);
  assert.equal(session.pendingLocalFormulaIds.size, 0);
});

test("a local render finishing after snapshot replacement cannot publish stale artwork", async () => {
  const { session, snapshot, messages } = fixture();
  const entered = deferred<void>(), held = deferred<Asset>();
  const work = queueLocal(session, snapshot, session.renderGeneration,
    { usesLocalTeX: () => true, render: () => { entered.resolve(); return held.promise; } });
  await entered.promise;
  session.snapshot = { ...snapshot, assetGeneration: 2 };
  session.renderGeneration += 1;
  held.resolve(asset);
  await work;
  assert.equal(messages.length, 0);
});

test("an old postMessage completion preserves a newer reservation for the same formula", async () => {
  const posted = deferred<void>(), delivered = deferred<boolean>();
  const { session, snapshot } = fixture(() => { posted.resolve(); return delivered.promise; });
  const work = queueLocal(session, snapshot, session.renderGeneration,
    { usesLocalTeX: () => true, render: async () => asset });
  await posted.promise;
  session.snapshot = { ...snapshot, assetGeneration: 2 };
  session.renderGeneration += 1;
  session.pendingLocalFormulaIds.clear();
  session.pendingLocalFormulaIds.add("graph");
  delivered.resolve(false);
  await work;
  assert.ok(session.pendingLocalFormulaIds.has("graph"));
  assert.ok(session.renderedFormulaIds.has("graph"));
});

function section(from: string, to: string): string {
  const begin = provider.indexOf(from), end = provider.indexOf(to, begin);
  assert.ok(begin >= 0 && end > begin);
  return provider.slice(begin, end);
}
const snapshotHelpers = ts.transpileModule(
  section("function buildVisualSnapshot(", "interface VisualEditorSession {") +
  section("async function runBoundedTasks(", "function visualTexBinPath(") +
  section("function visualFormulaIdentity(", "function rememberRenderedFormulaId(") +
  section("async function resolveVisualStructureMath(", "async function resolveVisualImageUri("),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const runtime = runInNewContext(snapshotHelpers + "\n({buildVisualSnapshot, resolveVisualStructureMath})", {
  createHash, createMathPreviewRenderInput, mathPreviewMacroEnvironmentAtOffset,
  visualInlineReferenceRecords, mapVisualRecordInlineSegments,
  localLatexPreviewKind, createLocalLatexPreviewDocument, collectLocalLatexPreviewSettings,
  indexVisualStructureReferences: () => new Map(), visualCollapsedSourceRanges: () => [],
  visualFormulaLabels: () => [], visualMathReferenceRecords: () => [],
  MAX_VISUAL_STRUCTURE_MATH_FRAGMENTS: 160, VISUAL_STRUCTURE_RENDER_CONCURRENCY: 1,
});

test("local formula identity changes for active drawing settings but survives unrelated edits", () => {
  const source = String.raw`\definecolor{ink}{HTML}{FF0000}\begin{document}
$\tikz{\draw[ink](0,0)--(1,1);}$ $x+y$
\end{document}`;
  const ids = (text: string) => runtime.buildVisualSnapshot(text, 1, scanMathPreviewDocument(text), [], 1).records;
  const red = ids(source), blue = ids(source.replace("FF0000", "0000FF"));
  assert.equal(red.length, 2);
  assert.notEqual(red[0].id, blue[0].id, "a changed color needs a new local SVG even after an optimistic visual edit");
  assert.equal(red[1].id, blue[1].id, "ordinary math does not depend on drawing colors");
  const moved = ids(source.replace("$\\tikz", "unrelated text $\\tikz"));
  assert.equal(red[0].id, moved[0].id, "unchanged local formulas remain reusable after offset changes");
});

test("identical local math fragments use the drawing settings at each source offset", async () => {
  const source = String.raw`\begin{document}\definecolor{ink}{HTML}{FF0000}A\footnote{$\tikz{\draw[ink](0,0)--(1,1);}$}\definecolor{ink}{HTML}{0000FF}B\footnote{$\tikz{\draw[ink](0,0)--(1,1);}$}\end{document}`;
  const offsets: number[] = [];
  const renderer = {
    usesLocalTeX: (input: MathPreviewRenderInput) => localLatexPreviewKind(input) !== undefined,
    renderStructure: async (input: MathPreviewRenderInput) => ({
      svg: input.localSettings?.colors.ink?.value, widthEm: 1, heightEm: 1,
    }),
  };
  const resolved = await runtime.resolveVisualStructureMath(renderer, scanVisualDocumentStructure(source),
    scanMathPreviewDocument(source), 1, "", () => true, "structure", "maximum", undefined, true,
    async (input: MathPreviewRenderInput, offset: number) => {
      offsets.push(offset);
      return { ...input, localSettings: collectLocalLatexPreviewSettings(source.slice(0, offset)) };
    });
  const footnotes = resolved.records.filter((record: { kind: string }) => record.kind === "footnote");
  assert.equal(footnotes.length, 2);
  assert.equal(offsets.length, 2, "local fragments must reach preparation in their own source scope");
  assert.equal(footnotes[0].source.segments[0].math.asset.svg, "FF0000");
  assert.equal(footnotes[1].source.segments[0].math.asset.svg, "0000FF");
});

test("publishing a changed compatibility mode clears IDs repopulated during preparation", () => {
  const body = section("    // Publish the snapshot and its generation together,", "    const delivered = await session.panel.webview.postMessage(message);");
  const publish = runInNewContext(ts.transpileModule(
    `function publish(session, snapshot, config, records) { ${body} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText + "\npublish");
  const { session, snapshot } = fixture();
  const previous = { ...snapshot, compatibilityMode: "basic" };
  session.snapshot = previous;
  session.renderedFormulaIds.add("graph");
  publish(session, { ...snapshot, compatibilityMode: "maximum" },
    { visualCompatibilityMode: "maximum" }, [{ id: "graph" }]);
  assert.equal(session.renderedFormulaIds.size, 0, "an old-mode render cannot suppress the new-mode request");
  session.renderedFormulaIds.add("graph");
  publish(session, { ...snapshot, compatibilityMode: "maximum" },
    { visualCompatibilityMode: "maximum" }, [{ id: "graph" }]);
  assert.ok(session.renderedFormulaIds.has("graph"), "same-mode refreshes retain reusable artwork");
});

test("stationary viewport and eviction refill requests renew after asset generation changes", () => {
  const webview = readFileSync("src/visualEditorWebview.ts", "utf8");
  const extract = (from: string, to: string) => {
    const begin = webview.indexOf(from), end = webview.indexOf(to, begin);
    assert.ok(begin >= 0 && end > begin);
    return webview.slice(begin, end);
  };
  const callbacks: Array<() => void> = [], messages: unknown[] = [];
  const code = `
    let assetGeneration = 1, documentVersion = 7;
    let viewportFrame, viewportRequestSettledPending = false, lastViewportGeometryKey;
    let lastFormulaCacheRefillViewportKey, lastSettledViewportRequestKey, lastViewportRequestKey, lastViewportRequestAt;
    const inputFeatures = { mathPreviewEnabled: true };
    const formulaField = {};
    const editor = { visibleRanges: [{ from: 0, to: 20 }],
      state: { field: () => ({ recordById: new Map([["graph", { from: 1, to: 10 }]]) }) } };
    ${extract("function queueViewportRequestFrame(): void {", "function scheduleSettledViewportRequest(): void {")}
    ${extract("function formulaCacheEvictionsTouchViewport(", "const VIEWPORT_REQUEST_MINIMUM_INTERVAL_MS")}
    ({ request: queueViewportRequestFrame, refill: formulaCacheEvictionsTouchViewport,
       nextGeneration: () => { assetGeneration += 1; } })
  `;
  const runtime = runInNewContext(ts.transpileModule(code,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    VISUAL_EDITOR_PROTOCOL: 1, performance: { now: () => 100 },
    requestAnimationFrame: (callback: () => void) => { callbacks.push(callback); return callbacks.length; },
    post: (message: unknown) => messages.push(message),
  });
  const request = () => { runtime.request(); assert.ok(callbacks.length); callbacks.shift()!(); };
  request();
  request();
  assert.equal(messages.length, 1, "unchanged geometry and generation remain deduplicated");
  assert.equal(runtime.refill(["graph"]), true);
  assert.equal(runtime.refill(["graph"]), false);
  runtime.nextGeneration();
  assert.equal(runtime.refill(["graph"]), true, "new assets get a refill budget without a scroll or edit");
  request();
  assert.equal(messages.length, 2, "a mode-change document can request artwork while geometry stays fixed");
});
