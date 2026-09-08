import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { INITIAL, Registry, parseRawGrammar } from "vscode-textmate";
import { createOnigScanner, createOnigString, loadWASM } from "vscode-oniguruma";
import { withLiteralColumnDefinitions } from "../src/core/textMateGrammarRegistry";

test("column definitions keep literal dollars from recoloring later prose, including multiline groups", async () => {
  await loadWASM(readFileSync("node_modules/vscode-oniguruma/release/onig.wasm"));
  const raw = parseRawGrammar(JSON.stringify({ scopeName: "text.tex.latex", patterns: [
    { begin: "\\$", end: "\\$", name: "meta.math.test" },
    { begin: "%", end: "$", name: "comment.line.test" },
  ], repository: {} }), "fixture.json");
  const grammar = withLiteralColumnDefinitions(raw);
  assert.equal(raw.patterns.length, 2, "never mutate the installed grammar");
  const registry = new Registry({ onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async () => grammar });
  try {
    const parser = (await registry.loadGrammar(raw.scopeName))!;
    let state = INITIAL;
    for (const line of [String.raw`\newcolumntype{Q}[1]{`, String.raw`>{\textbf{#1}\$ $}c % } is a comment`, "}", "Normal prose", "$x$ prose"]) {
      const parsed = parser.tokenizeLine(line, state); state = parsed.ruleStack;
      if (line.includes("prose")) {
        const prose = parsed.tokens.find(t => line.slice(t.startIndex, t.endIndex).includes("prose"))!;
        assert.ok(!prose.scopes.some(s => /math|column/.test(s)), JSON.stringify(prose.scopes));
      }
      if (line.startsWith("$x$")) assert.ok(parsed.tokens.some(t => t.scopes.includes("meta.math.test")));
    }
  } finally { registry.dispose(); }
});
