import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const filename = path.resolve("src/visualEditorWebview.ts");
const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.ES2022, true);
function declaration(name: string): string {
  const node = source.statements.find(node => (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.text === name);
  assert.ok(node, name);
  return node.getText(source);
}

test("wrapper widgets invalidate cached DOM when source ranges move", () => {
  const Widget = runInNewContext(ts.transpileModule(declaration("TransparentWrapperEditWidget") + "\nTransparentWrapperEditWidget;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { WidgetType: class {} });
  const record = { command: "source", editLabel: "源码", from: 10, to: 40, prefixFrom: 10, prefixTo: 20, contentFrom: 20, contentTo: 39 };
  assert.equal(new Widget(record).eq(new Widget({ ...record })), true);
  for (const field of ["from", "to", "prefixFrom", "prefixTo", "contentFrom", "contentTo"] as const) {
    assert.equal(new Widget(record).eq(new Widget({ ...record, [field]: record[field] + 1 })), false, field);
  }
});

test("source mode refuses to destroy an open graph draft before dispatching effects", () => {
  const messages: string[] = [];
  const context = {
    editorMode: "visual", editor: undefined,
    document: { querySelector: () => ({}) },
    setStatus: (_kind: string, message: string) => messages.push(message),
    updateEditorModeButton: () => assert.fail("mode must remain unchanged"),
  };
  const result = runInNewContext(ts.transpileModule(declaration("toggleEditorMode") + '\ntoggleEditorMode();', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  assert.equal(result, undefined);
  assert.equal(context.editorMode, "visual");
  assert.match(messages[0] ?? "", /应用|取消/u);
});


test("graph widgets retain the live draft across consecutive DOM reuse", () => {
  const Widget = runInNewContext(ts.transpileModule(declaration("TikzcdWidget") + "\nTikzcdWidget;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { WidgetType: class {}, visualPresentationKey: (record: { asset: number }) => record.asset });
  let current = new Widget({ tex: "graph", asset: 0 }, false);
  const card = { querySelector: () => ({}) };
  const cleanup = () => {};
  current.card = card;
  current.cleanup = cleanup;
  for (const asset of [1, 2, 3]) {
    const next = new Widget({ tex: "graph", asset }, false);
    assert.equal(current.eq(next), true);
    assert.equal(next.card, card);
    assert.equal(next.cleanup, cleanup);
    current = next;
  }
  assert.equal(current.eq(new Widget({ tex: "changed", asset: 4 }, false)), false);
  assert.equal(current.eq(new Widget({ tex: "graph", asset: 4 }, true)), false);
});
