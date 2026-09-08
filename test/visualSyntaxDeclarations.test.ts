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

test("split column declaration heads and comments remain inert until the balanced body closes", async () => {
  await loadWASM(readFileSync("node_modules/vscode-oniguruma/release/onig.wasm"));
  const raw = parseRawGrammar(JSON.stringify({ scopeName: "text.tex.latex", patterns: [
    { begin: "\\$", end: "\\$", name: "meta.math.test" },
  ], repository: {} }), "fixture.json");
  const registry = new Registry({ onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async () => withLiteralColumnDefinitions(raw) });
  try {
    const parser = (await registry.loadGrammar(raw.scopeName))!;
    for (const head of [["\\newcolumntype", "{Q}", "[1]"], ["\\newcolumntype % name follows", "{Q} % arity follows", "[1] % body follows"], ["\\newcolumntype", "{Q}"]]) {
      let state = INITIAL;
      for (const line of [...head, "{>{\\textbf{#1}$}c}", "Normal prose", "$x$ prose"]) {
        const parsed = parser.tokenizeLine(line, state); state = parsed.ruleStack;
        if (!line.startsWith("$x$")) assert.ok(!parsed.tokens.some(t => t.scopes.includes("meta.math.test")), line);
        if (line.includes("prose")) {
          const prose = parsed.tokens.find(t => line.slice(t.startIndex, t.endIndex).includes("prose"))!;
          assert.ok(!prose.scopes.some(s => /math|column/.test(s)), JSON.stringify(prose.scopes));
        }
        if (line.startsWith("$x$")) assert.ok(parsed.tokens.some(t => t.scopes.includes("meta.math.test")));
      }
    }
  } finally { registry.dispose(); }
});

test("column bodies with adjacent plain nested groups return to prose", async () => {
  await loadWASM(readFileSync("node_modules/vscode-oniguruma/release/onig.wasm"));
  const raw = parseRawGrammar(JSON.stringify({ scopeName: "text.tex.latex", patterns: [{ begin: "\\$", end: "\\$", name: "meta.math.test" }], repository: {} }), "fixture.json");
  const registry = new Registry({ onigLib: Promise.resolve({ createOnigScanner, createOnigString }), loadGrammar: async () => withLiteralColumnDefinitions(raw) });
  try {
    const parser = (await registry.loadGrammar(raw.scopeName))!;
    for (const line of [String.raw`\newcolumntype{Q}{>{a}{b}$} prose $x$`, String.raw`\newcolumntype{Q}{>{a}$} prose $x$`]) {
      const parsed = parser.tokenizeLine(line, INITIAL);
      const prose = parsed.tokens.find(t => line.slice(t.startIndex, t.endIndex).includes("prose"))!;
      assert.ok(!prose.scopes.some(s => /math|column/.test(s)), JSON.stringify(prose.scopes));
      assert.ok(parsed.tokens.some(t => t.scopes.includes("meta.math.test")));
    }
  } finally { registry.dispose(); }
});
