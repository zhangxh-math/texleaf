import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { VISUAL_EDITOR_PROTOCOL } from "../src/visualEditorProtocol";

// Exercise the actual host parser and dispatch without starting VS Code.
function host() {
  const source = ts.createSourceFile("provider.ts", readFileSync("src/visualEditorProvider.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const names = new Set(["parseWebviewMessage", "isSelection", "clampSelection", "clampInteger", "resetViewportRenderRequest"]);
  const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? ""));
  const provider = source.statements.find(node => ts.isClassDeclaration(node) && node.members.some(member => member.name?.getText(source) === "handleWebviewMessage"));
  assert.ok(provider && ts.isClassDeclaration(provider));
  const handler = provider.members.find(member => member.name?.getText(source) === "handleWebviewMessage");
  assert.ok(handler);
  const module = { exports: {} as { parse: (value: unknown) => any; Provider: new () => any } };
  const compiled = ts.transpileModule(functions.map(node => node.getText(source)).join("\n") +
    `\nclass Provider { ${handler.getText(source)} }\nmodule.exports = { parse: parseWebviewMessage, Provider };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { module, VISUAL_EDITOR_PROTOCOL });
  return module.exports;
}

test("host routes navigation and invalidates evicted formula assets with strict message validation", async () => {
  const { parse, Provider } = host();
  const provider = new Provider();
  provider.stateFor = () => ({ mirrorText: "source text" });
  let direction: string | undefined;
  provider.navigateVisualHistory = async (value: string) => { direction = value; };
  const session = { disposed: false, document: {}, acceptedRevision: 3, selection: { anchor: 0, head: 0 },
    renderedFormulaIds: new Set(["released", "retained"]), viewportRenderRequest: {}, viewportRenderBudgetSequence: 4, viewportRenderBudgetUsed: 48 };
  const navigation = { protocol: VISUAL_EDITOR_PROTOCOL, type: "navigationCommand", direction: "forward", revision: 3, selection: { anchor: 4, head: 4 } };
  assert.ok(parse(navigation));
  await provider.handleWebviewMessage(session, navigation);
  assert.equal(direction, "forward");
  assert.equal(session.selection.anchor, 4);
  direction = undefined;
  await provider.handleWebviewMessage(session, { ...navigation, revision: 2 });
  assert.equal(direction, undefined, "stale navigation must not move the caret");
  assert.equal(parse({ ...navigation, direction: "sideways" }), undefined);
  const eviction = { protocol: VISUAL_EDITOR_PROTOCOL, type: "formulaCacheEvicted", formulaIds: ["released", "released"], refillViewport: true };
  assert.equal(parse(eviction).formulaIds.length, 1);
  await provider.handleWebviewMessage(session, eviction);
  assert.deepEqual([...session.renderedFormulaIds], ["retained"]);
  assert.equal(session.viewportRenderRequest, undefined);
  assert.equal(session.viewportRenderBudgetSequence, -1);
  assert.equal(session.viewportRenderBudgetUsed, 0);
  for (const formulaIds of [[], [""], ["x\0"], ["x".repeat(257)], Array(513).fill("x")]) {
    assert.equal(parse({ ...eviction, formulaIds }), undefined);
  }
  assert.equal(parse({ ...eviction, refillViewport: "yes" }), undefined);
});
