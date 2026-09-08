import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { scanVisualDocumentStructure } from "../src/core/visualStructure";

const webview = readFileSync("src/visualEditorWebview.ts", "utf8");
const start = webview.indexOf("function addTheoremDecorations("), end = webview.indexOf("function addFrameDecorations(", start);
assert.ok(start >= 0 && end > start);
const decorate = runInNewContext(ts.transpileModule(webview.slice(start, end), {
  compilerOptions: {target: ts.ScriptTarget.ES2022},
}).outputText + "\naddTheoremDecorations", { Decoration,
  TheoremBeginWidget: class {}, TheoremEndWidget: class {},
  validRange: (from: number, to: number, length: number) => from >= 0 && to >= from && to <= length,
});

test("same-line theorem wrappers share the body's outer frame without changing source", () => {
  for (const body of ["A checked target.", "First line.\nSecond line."]) {
    const source = "\\newtheorem{lemma}{Lemma}\n\\begin{document}\n\\begin{lemma}" + body + "\\end{lemma}\n\\end{document}";
    const record = scanVisualDocumentStructure(source).records.find(r => r.kind === "theorem")!;
    const state = EditorState.create({doc: source});
    const decorations: Array<{from: number; value: {spec: {class: string}}}> = [];
    decorate(decorations, [], record, state, () => true, false);
    assert.equal(decorations.filter(d => d.value.spec.class.includes("texleaf-theorem-inline-start")).length, 1);
    assert.equal(decorations.filter(d => d.value.spec.class.includes("texleaf-theorem-inline-end")).length, 1);
    assert.equal(decorations.length, body.split("\n").length);
    assert.equal(state.doc.toString(), source);
  }
});
