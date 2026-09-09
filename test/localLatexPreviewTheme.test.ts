import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createLocalLatexPreviewDocument, sanitizeLocalLatexSvg } from "../src/core/localLatexPreview";
import { prepareVisualFormulaAsset } from "../src/core/visualFormula";

test("local TeX previews use paper cards and zoom artwork without rewriting its paints", () => {
  const raw = '<svg width="24pt" height="12pt"><path fill="#010203" stroke="#010203"/>' +
    '<path fill="#ff0000"/><path stroke="#0000ff"/><rect fill="#fff"/></svg>';
  const asset = prepareVisualFormulaAsset(sanitizeLocalLatexSvg(raw, 1), { display: true });
  assert.match(asset.svg, /fill="currentColor" stroke="currentColor"/u);
  for (const color of ["#ff0000", "#0000ff", "#fff"]) assert.ok(asset.svg.includes(color));

  const webview = readFileSync("src/visualEditorWebview.ts", "utf8");
  const start = webview.indexOf("function createLocalLatexStructurePreview(");
  const end = webview.indexOf("function createLocalPreviewStatus(", start);
  assert.ok(start >= 0 && end > start);
  const helper = ts.transpileModule(webview.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dimensions = new Map<string, string>();
  const style = () => ({ color: "", backgroundColor: "", padding: "",
    setProperty(name: string, value: string) { dimensions.set(name, value); } });
  const paint = (fill: string, stroke = "") => ({
    attributes: { fill, stroke }, style: { fill, stroke },
    closest: (_selector: string): object | null => null,
    getAttribute(name: "fill" | "stroke") { return this.attributes[name]; },
    setAttribute(name: "fill" | "stroke", value: string) { this.attributes[name] = value; },
  });
  const black = ["black", "#000", "#000000", "rgb(0, 0, 0)", "rgb(0%,0%,0%)"].map(value => paint(value, value));
  const colored = ["#ff0000", "#0000ff", "#fff", "none", "rgba(0,0,0,0.5)"].map(value => paint(value));
  const mask = { ...paint("#000"), closest: () => ({}) };
  const hollow = paint("rgb(100%, 100%, 100%)", "currentColor");
  const raster = { style: { filter: "url(#original-filter)" }, getAttribute: () => null };
  const maskRaster = { id: "mask-raster", style: { filter: "" }, getAttribute: () => null, querySelectorAll: () => [] };
  const maskReference = { getAttribute: (name: string) => name === "href" ? "#mask-raster" : null, querySelectorAll: () => [] };
  let filterMarkup = "";
  let insertedFilter: object | undefined;
  const svg = { ...paint("currentColor"), style: { ...style(), fill: "currentColor", stroke: "" },
    removeAttribute() {}, prepend: (filter: object) => { insertedFilter = filter; }, querySelector: () => ({}),
    querySelectorAll: (selector: string) => selector === "[fill], [stroke], [style]" ? [...black, ...colored, mask, hollow]
      : selector === "[id]" ? [maskRaster] : selector === "mask" ? [maskReference] : selector === "image" ? [raster, maskRaster] : [] };
  const buttons: { label: string; run: () => void; disabled: boolean; textContent?: string }[] = [];
  const events = new Map<string, () => void>();
  const inputFeatures: { previewZoomPercent?: number } = {};
  const root = { className: "", style: style(), append() {}, addEventListener: (name: string, listener: () => void) => events.set(name, listener) };
  const create = runInNewContext(helper + "\ncreateLocalLatexStructurePreview", {
    inputFeatures,
    crypto: { randomUUID: () => "unique" },
    parseSvg: (source: string) => { filterMarkup = source; return { firstElementChild: { filter: true } }; },
    document: { createElement: () => root.className ? { style: style(), append() {} } : root },
    configureStructureHorizontalScroll() {},
    safeFormulaDimension: (value: number) => value,
    createFormulaSvg: () => svg,
    createPlainStructureButton: (label: string, run: () => void) => {
      const button = { label, run, disabled: false, addEventListener() {}, setAttribute() {} };
      buttons.push(button);
      return button;
    },
  });
  assert.equal(create(asset, "TeX preview"), root);
  assert.equal(insertedFilter, undefined, "paper previews never recolor bitmap pixels");
  assert.ok(root.className.includes("texleaf-paper-preview"));
  assert.equal(raster.style.filter, "url(#original-filter)");
  assert.equal(maskRaster.style.filter, "");
  for (const [index, node] of black.entries()) {
    const value = ["black", "#000", "#000000", "rgb(0, 0, 0)", "rgb(0%,0%,0%)"][index];
    assert.deepEqual(node.attributes, { fill: value, stroke: value });
  }
  assert.deepEqual(colored.map(node => node.attributes.fill), ["#ff0000", "#0000ff", "#fff", "none", "rgba(0,0,0,0.5)"]);
  assert.equal(hollow.attributes.fill, "rgb(100%, 100%, 100%)");
  const width = () => dimensions.get("--texleaf-local-preview-width");
  const height = () => dimensions.get("--texleaf-local-preview-height");
  assert.equal(width(), "3em", "local previews start at 150% of the TeX size");
  assert.equal(height(), "1.5em");
  assert.equal(buttons.length, 3);
  const [smaller, reset, larger] = buttons;
  for (let index = 0; index < 20; index++) smaller!.run();
  assert.equal(width(), "1em");
  assert.equal(height(), "0.5em");
  assert.equal(smaller!.disabled, true);
  for (let index = 0; index < 20; index++) larger!.run();
  assert.equal(width(), "8em");
  assert.equal(height(), "4em");
  assert.equal(larger!.disabled, true);
  reset!.run();
  assert.equal(width(), "3em");
  assert.equal(height(), "1.5em");
  assert.equal(smaller!.disabled || larger!.disabled, false);
  inputFeatures.previewZoomPercent = 125;
  events.get("texleaf-preview-zoom-change")!();
  assert.equal(width(), "2.5em", "changing the setting updates mounted previews");
  larger!.run();
  assert.equal(width(), "3em");
  reset!.run();
  assert.equal(width(), "2.5em", "reset uses the user's current default");
});

test("tikz-cd default knockout paint follows the theme and preserves authored fills", () => {
  const input = { tex: String.raw`\begin{tikzcd}A \arrow[r,"{(x,y)}" description] & B\end{tikzcd}`,
    display: true, macros: {}, macroFingerprint: "" };
  const document = createLocalLatexPreviewDocument(input)!;
  assert.ok(document.includes(String.raw`\tikzcdset{background color=texleafPreviewBackground}`));
  const raw = '<svg width="24pt" height="12pt"><path fill="#040506" stroke="#040506"/>' +
    '<rect fill="#fff"/><path fill="#ff0000"/></svg>';
  const asset = prepareVisualFormulaAsset(sanitizeLocalLatexSvg(raw, 1), { display: true });
  assert.ok(!asset.svg.includes("#040506"));
  assert.match(asset.svg, /fill="var\(--vscode-editorWidget-background, var\(--vscode-editor-background, Canvas\)\)"/u);
  assert.ok(asset.svg.includes('fill="#fff"') && asset.svg.includes('fill="#ff0000"'));
  const pdfSvg = sanitizeLocalLatexSvg('<svg width="24pt" height="12pt">' +
    '<path fill="rgb(1.568604%, 1.960754%, 2.352905%)" stroke="rgb(0.390625%, 0.782776%, 1.174927%)"/>' +
    '<rect fill="rgb(100%, 100%, 100%)"/><path fill="rgb(12.3456%, 23.4567%, 34.5678%)"/></svg>', 1);
  assert.ok(pdfSvg.svg.includes('fill="var(--vscode-editorWidget-background'));
  assert.ok(prepareVisualFormulaAsset(pdfSvg, { display: true }).svg.includes('stroke="currentColor"'));
  assert.ok(pdfSvg.svg.includes('rgb(100%, 100%, 100%)') && pdfSvg.svg.includes('rgb(12.3456%, 23.4567%, 34.5678%)'));
  assert.ok(!createLocalLatexPreviewDocument({ ...input, tex: String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}` })!.includes('\\tikzcdset'));
});

test("quiver diagrams load their additional styles only in their isolated preview", () => {
  const tex = String.raw`\begin{tikzcd}A\arrow[r,curve={height=6pt}]&B
% texleaf-quiver-v1: cached
\end{tikzcd}`;
  const input = {tex, display: true, macros: {}, macroFingerprint: "empty"};
  assert.match(createLocalLatexPreviewDocument(input)!, /\\usepackage\{quiver\}/u);
  assert.doesNotMatch(createLocalLatexPreviewDocument({...input, tex: tex.replace(/% texleaf[^\n]*/, "")})!, /\\usepackage\{quiver\}/u);
});
