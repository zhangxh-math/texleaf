import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { normalizeVisualCompatibilityMode, localLatexPreviewKind, createLocalLatexPreviewDocument, sanitizeLocalLatexSvg } from "../src/core/localLatexPreview";
import { scanVisualDocumentStructure, resolveVisualBibliography, visualInlineReferenceRecords } from "../src/core/visualStructure";
import * as visualStructureCore from "../src/core/visualStructure";
import { parseBibTeXEntries } from "../src/core/citation";
import { scanMathPreviewDocument, createMathPreviewRenderInput, mathPreviewMacroEnvironmentAtOffset, collectLocalLatexPreviewSettings, createMathPreviewCursorRenderInput } from "../src/core/mathPreview";

const provider = readFileSync("src/visualEditorProvider.ts", "utf8");
function section(start: string, end: string): string {
  const from = provider.indexOf(start), to = provider.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return provider.slice(from, to);
}
const helpers = ts.transpileModule(
  section("async function resolveVisualStructureMath(", "async function resolveVisualImageUri(") +
  section("async function runBoundedTasks(", "function visualTexBinPath(") +
  section("function isWebviewCommand(", "function isBibliographyDocument("),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const runtime = runInNewContext(helpers + "\n({resolveVisualStructureMath, isWebviewCommand})", {
  mathPreviewMacroEnvironmentAtOffset,
  ...visualStructureCore,
  MAX_VISUAL_STRUCTURE_MATH_FRAGMENTS: 160, VISUAL_STRUCTURE_RENDER_CONCURRENCY: 1,
});

test("citation titles preserve BibTeX math and render in body and nested previews", async () => {
  const title = String.raw`Br\'ezin and $\frac{\mathbb{P}^{n+1}}{2}$ <img onerror=x>`;
  const entries = parseBibTeXEntries(`@article{title, title={${title}}, author={Vakil, Ravi}, year={2008}}`);
  assert.equal(Reflect.get(entries[0]!, "titleLatex"), title);
  const source = String.raw`\begin{document}\cite{title} Text\footnote{See \cite{title}.}\end{document}`;
  const structure = resolveVisualBibliography(scanVisualDocumentStructure(source), entries);
  const inputs: string[] = [];
  const resolved = await runtime.resolveVisualStructureMath({ usesLocalTeX: () => false,
    renderStructure: async (input: { tex: string }) => { inputs.push(input.tex); return { svg: "<svg/>", widthEm: 2, heightEm: 1 }; },
  }, structure, scanMathPreviewDocument(source), 1, "");
  const citations = visualInlineReferenceRecords(resolved).filter(record => record.kind === "citation");
  assert.equal(citations.length, 2);
  assert.deepEqual(inputs, [String.raw`\frac{\mathbb{P}^{n+1}}{2}`], "repeated title math shares the existing render queue");
  for (const citation of citations) {
    const segments = Reflect.get(citation.previews[0]!, "titleSegments") as Array<{kind: string; text?: string; math?: {asset?: {svg: string}}}>;
    assert.deepEqual(Array.from(segments, segment => segment.kind), ["text", "math", "text"]);
    assert.equal(segments[0]?.text, "Brézin and ");
    assert.equal(segments[1]?.math?.asset?.svg, "<svg/>");
    assert.equal(segments[2]?.text, " <img onerror=x>");
  }
});

test("citation title failures retain TeX and report errors without rendering flattened manual or overlength titles", async () => {
  const source = String.raw`\begin{document}\cite{bad,long}\end{document}`;
  const entries = parseBibTeXEntries(String.raw`@article{bad,title={Bad $\UndefinedCitationTitleCommand{x}$}}` +
    `@article{long,title={${"A ".repeat(1000)}$x$}}`);
  const structure = resolveVisualBibliography(scanVisualDocumentStructure(source), entries);
  const resolved = await runtime.resolveVisualStructureMath({ usesLocalTeX: () => false,
    renderStructure: async () => { throw new Error("Undefined control sequence"); },
  }, structure, scanMathPreviewDocument(source), 1, "");
  const citation = visualInlineReferenceRecords(resolved).find(record => record.kind === "citation")!;
  assert.equal(citation.kind, "citation");
  if (citation.kind !== "citation") return;
  const math = citation.previews[0]!.titleSegments?.find(segment => segment.kind === "math");
  assert.equal(math?.kind, "math");
  if (math?.kind !== "math") return;
  assert.equal(math.math.asset, undefined);
  assert.equal(math.math.fallback, String.raw`$\UndefinedCitationTitleCommand{x}$`);
  assert.equal(math.math.previewStatus?.state, "error");
  assert.match(math.math.previewStatus?.message ?? "", /Undefined control sequence/u);
  assert.equal(citation.previews[1]!.titleSegments, undefined);
  const manual = resolveVisualBibliography(scanVisualDocumentStructure(String.raw`\begin{document}\cite{m}\begin{thebibliography}{1}\bibitem{m} A $\frac{1}{2}$.\end{thebibliography}\end{document}`), []);
  const manualCitation = visualInlineReferenceRecords(manual).find(record => record.kind === "citation");
  assert.equal(manualCitation?.kind === "citation" ? manualCitation.previews[0]?.titleSegments : null, undefined);
});

test("visualization settings and toolbar commands reject unknown modes", () => {
  assert.equal(normalizeVisualCompatibilityMode("maximum"), "maximum");
  for (const value of [undefined, null, "basic", "max", {}, 1]) assert.equal(normalizeVisualCompatibilityMode(value), "basic");
  for (const value of ["visualBasic", "visualMaximum", "clearGraphCache"]) assert.equal(runtime.isWebviewCommand(value), true);
  for (const value of ["maximum", "clearAll", {}, undefined]) assert.equal(runtime.isWebviewCommand(value), false);
});

test("initial structure can publish before slow local TeX; deferred artwork preserves exact ranges", async () => {
  const source = String.raw`\begin{document}\title{Title $x$}\maketitle
\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}
\end{document}`;
  const structure = scanVisualDocumentStructure(source), preview = scanMathPreviewDocument(source);
  let launches = 0;
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const renderer = {
    usesLocalTeX: (input: Parameters<typeof localLatexPreviewKind>[0]) => localLatexPreviewKind(input) !== undefined,
    renderStructure: async (input: Parameters<typeof localLatexPreviewKind>[0]) => {
      if (localLatexPreviewKind(input)) { launches++; await held; }
      return { svg: "<svg/>", widthEm: 1, heightEm: 1 };
    },
  };
  const first = await runtime.resolveVisualStructureMath(renderer, structure, preview, 1, "", () => true,
    "structure", "maximum", undefined, false);
  assert.equal(launches, 0);
  assert.ok(first.records.find((r: {kind: string}) => r.kind === "maketitle").title.segments[1].math.asset);
  const later = runtime.resolveVisualStructureMath(renderer, first, preview, 1, "", () => true,
    "structure", "maximum");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(launches, 1);
  finish();
  const completed = await later;
  const graph = completed.records.find((r: {kind: string}) => r.kind === "tikzpicture");
  assert.equal(graph.asset.svg, "<svg/>");
  assert.equal(source.slice(graph.replacement.sourceFrom, graph.replacement.sourceTo), graph.tex);
  const basic = await runtime.resolveVisualStructureMath(renderer, structure, preview, 1, "", () => true, "structure", "basic");
  assert.equal(launches, 1, "basic does not enter the graph renderer");
  assert.equal(basic.records.find((r: {kind: string}) => r.kind === "tikzpicture").asset, undefined);
});

test("whole math containing inline TikZ, Young diagrams and transitive TeX boxes takes the enhanced route", () => {
  const source = String.raw`\DeclareMathOperator*{\ordered}{\prod\limits^{\vbox to -.5ex{\kern-.5ex\hbox{$\leftharpoonup$}\vss}}}
\newcommand{\chain}{\ordered}
\begin{document}
\[T=\tikz[baseline=-.5ex]{\draw (0,0)--(1,1);}+\tikz{\draw (1,1)--(2,1);}\]
\[\chain_{i=1}^n P_i\]
\[\ydiagram{4,2,1}\quad\ydiagram{3,2,2}\]
\[F=\vcenter{\hbox{\begin{tikzpicture}\node{A};\end{tikzpicture}}}+G\]
\end{document}`;
  const preview = scanMathPreviewDocument(source);
  const inputs = preview.formulas.map(formula => createMathPreviewRenderInput(source, formula, preview)!);
  assert.equal(inputs.length, 4);
  for (const input of inputs) {
    assert.ok(localLatexPreviewKind(input), input.tex);
    const document = createLocalLatexPreviewDocument(input)!;
    assert.ok(document.includes(input.tex), "the complete outer math stays together");
    assert.match(document, /\\\[/u);
  }
  assert.equal(localLatexPreviewKind({ tex: "x+y", display: false, macros: {}, macroFingerprint: "" }), undefined);
});


test("drawing settings ignore definitions and literal examples and include only colors actually used", () => {
  const settings = collectLocalLatexPreviewSettings(String.raw`\definecolor{teal}{HTML}{127D86}
\definecolor{unused}{HTML}{FFFFFF}
\usetikzlibrary{positioning,arrows.meta}\ytableausetup{boxsize=6mm}
\newcommand{\sample}{\definecolor{fake}{HTML}{000000}}
\begin{Verbatim}\definecolor{teal}{HTML}{000000}\ytableausetup{boxsize=1mm}\end{Verbatim}`);
  assert.deepEqual(Object.keys(settings.colors).sort(), ["teal", "unused"]);
  assert.equal(settings.colors.teal?.value, "127D86");
  assert.equal(settings.ytableauSetup, "boxsize=6mm");
  const document = createLocalLatexPreviewDocument({ tex: String.raw`\begin{tikzpicture}\node[draw=teal]{中文};\end{tikzpicture}`,
    display: true, macros: {}, macroFingerprint: "", localSettings: settings, localEngine: "xelatex" })!;
  assert.match(document, /\\definecolor\{teal\}\{HTML\}\{127D86\}/u);
  assert.doesNotMatch(document, /definecolor\{unused\}|fake|boxsize/u);
  assert.match(document, /fontset=fandol/u);
});


test("staged graphics reject alternate file options and SVG permits only embedded raster images", () => {
  const name = `asset-${"a".repeat(64)}.png`;
  const input = { tex: `\\begin{figure}\\includegraphics[width=.3\\textwidth]{${name}}\\end{figure}`,
    localFigure: true, display: true, macros: {}, macroFingerprint: "", localFiles: [{name, contents: new Uint8Array([1])}] };
  assert.ok(createLocalLatexPreviewDocument(input));
  for (const option of ["read=/private/image.png", "command=anything", "type=eps", "ext=.eps"]) {
    assert.equal(createLocalLatexPreviewDocument({...input, tex: input.tex.replace("width=.3\\textwidth", option)}), undefined);
  }
  assert.equal(createLocalLatexPreviewDocument({...input, tex: "\\setkeys{Gin}{read=/private/image.png}" + input.tex}), undefined);
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9sAAAAASUVORK5CYII=";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12pt" height="12pt"><image href="data:image/png;base64,${png}" width="12" height="12"/></svg>`;
  assert.ok(sanitizeLocalLatexSvg(svg, 1).svg.includes(png));
  for (const unsafe of [svg.replace("image/png", "image/svg+xml"), svg.replace(`data:image/png;base64,${png}`, "file:///private/image.png"), svg.replace("<image ", "<use ")]) {
    assert.throws(() => sanitizeLocalLatexSvg(unsafe, 1), /unsafe/);
  }
});


test("intertext references use known numbers without changing source or cursor coordinates", () => {
  const source = String.raw`\begin{align}a&=b\\\intertext{Using Lemma \ref{lem:known} and \eqref{eq:unknown}.}c&=d\end{align}`;
  const preview = {...scanMathPreviewDocument(source), referenceLabels: new Map([["lem:known", "2.3"]])};
  const formula = preview.formulas[0]!;
  const input = createMathPreviewRenderInput(source, formula, preview)!;
  assert.match(input.tex, /Lemma \\textnormal\{2\.3\}/u);
  assert.match(input.tex, /\\textnormal\{\(eq:unknown\)\}/u);
  assert.equal(source.slice(formula.outerRange.start, formula.outerRange.end), source);
  const cursor = createMathPreviewCursorRenderInput(source, formula, preview, source.indexOf("c&") + 1, String.raw`\color{red}{|}`)!;
  assert.match(cursor.tex, /c\\color\{red\}\{\|\}&=d/u);
  assert.match(cursor.tex, /Lemma \\textnormal\{2\.3\}/u);
  const updated = createMathPreviewRenderInput(source, formula, {...preview, referenceLabels: new Map([["lem:known", "A.2"]])})!;
  assert.notEqual(updated.tex, input.tex, "reference changes invalidate formula identity");
});

test("local drawing settings follow current groups and restore outer values", () => {
  const prefix = String.raw`\ytableausetup{boxsize=3mm}\definecolor{ink}{HTML}{123456}\begin{goalbox}{Title}
\ytableausetup{boxsize=6mm}\definecolor{ink}{HTML}{ABCDEF}`;
  assert.equal(collectLocalLatexPreviewSettings(prefix).ytableauSetup, "boxsize=6mm");
  assert.equal(collectLocalLatexPreviewSettings(prefix).colors.ink?.value, "ABCDEF");
  const closed = collectLocalLatexPreviewSettings(prefix + String.raw`\end{goalbox}`);
  assert.equal(closed.ytableauSetup, "boxsize=3mm");
  assert.equal(closed.colors.ink?.value, "123456");
  assert.equal(collectLocalLatexPreviewSettings(prefix + String.raw`{\ytableausetup{boxsize=9mm}}`).ytableauSetup, "boxsize=6mm");
});

test("local display previews omit invented equation counters and retain explicit tags", () => {
  for (const environment of ["equation", "align", "alignat", "gather", "multline", "flalign"]) {
    const tex = `\\begin{${environment}}` + String.raw`\tikz{\draw(0,0)--(1,1);}\tag{A.7}` + `\\end{${environment}}`;
    const document = createLocalLatexPreviewDocument({ tex, display: true, macros: {}, macroFingerprint: "" })!;
    assert.ok(document.includes(`\\begin{${environment}*}`));
    assert.ok(document.includes(`\\end{${environment}*}`));
    assert.ok(document.includes(String.raw`\tag{A.7}`));
    assert.ok(tex.startsWith(`\\begin{${environment}}`));
  }
});
