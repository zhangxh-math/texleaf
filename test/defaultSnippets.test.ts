import assert from "node:assert/strict";
import test from "node:test";
import {
  SnippetMatcher,
  compileSnippetFile,
  replacementPartsToText,
  validateSnippetFile,
} from "../src/core";
import { DEFAULT_SNIPPETS } from "../src/defaultSnippets";
import {
  createDefaultSnippetLibrary,
  DEFAULT_VARIABLES,
  FACTORY_DEFAULTS_REVISION,
  serializeDefaultSnippetLibrary,
} from "../src/defaultLibrary";

test("factory library remains complete, unique, and declarative", () => {
  assert.equal(DEFAULT_SNIPPETS.length, 199);
  assert.equal(DEFAULT_SNIPPETS.filter((snippet) => snippet.options.includes("r")).length, 35);
  assert.equal(DEFAULT_SNIPPETS.filter((snippet) => snippet.options.includes("v")).length, 9);

  const normalizedIds = DEFAULT_SNIPPETS.map((snippet) => snippet.id.toLowerCase());
  assert.equal(new Set(normalizedIds).size, normalizedIds.length);
  assert.ok(DEFAULT_SNIPPETS.every((snippet) => typeof snippet.replacement === "string"));

  const byTrigger = new Map(DEFAULT_SNIPPETS.map((snippet) => [snippet.trigger, snippet]));
  assert.equal(byTrigger.get("mk")?.replacement, "\\(@0\\)");
  assert.equal(byTrigger.get("//")?.replacement, "\\frac{@0}{@1}@2");
  assert.equal(byTrigger.get(";a")?.replacement, "\\alpha");
});

test("every factory definition validates and compiles through the production core", () => {
  const validated = validateSnippetFile({
    schemaVersion: 1,
    variables: DEFAULT_VARIABLES,
    snippets: DEFAULT_SNIPPETS.map((snippet) => ({
      id: snippet.id,
      trigger: snippet.trigger,
      replacement: snippet.replacement,
      options: snippet.options,
      ...(snippet.priority === undefined ? {} : { priority: snippet.priority }),
      ...(snippet.description === undefined
        ? {}
        : { description: snippet.description }),
      ...(snippet.flags === undefined ? {} : { flags: snippet.flags }),
      ...(snippet.syntaxVersion === undefined
        ? {}
        : { version: snippet.syntaxVersion }),
    })),
  });
  assert.deepEqual(validated.issues, []);
  assert.equal(validated.value.snippets.length, DEFAULT_SNIPPETS.length);

  const compiled = compileSnippetFile(validated.value);
  assert.deepEqual(compiled.issues, []);
  assert.equal(compiled.value.length, DEFAULT_SNIPPETS.length);
  assert.ok(
    compiled.value
      .filter((snippet) => snippet.triggerKind === "regex")
      .every((snippet) => snippet.triggerRegex instanceof RegExp),
  );

  const matcher = new SnippetMatcher(compiled.value);
  const inlineMathContext = {
    mathMode: "inline" as const,
    inComment: false,
    inVerbatim: false,
    environments: [],
    matrixEnvironment: undefined,
  };
  const accentCases = [
    ["Qhat", "accent.auto-hat", "Qhat", "\\hat{Q}"],
    ["qhat", "accent.auto-hat", "qhat", "\\hat{q}"],
    ["hat", "accent.hat", "hat", "\\hat{}"],
    ["Qbar", "accent.auto-bar", "Qbar", "\\bar{Q}"],
    ["bar", "accent.bar", "bar", "\\bar{}"],
    ["Qdot", "accent.auto-dot", "Qdot", "\\dot{Q}"],
    ["dot", "accent.dot", "dot", "\\dot{}"],
    ["Qddot", "accent.auto-ddot", "Qddot", "\\ddot{Q}"],
    ["ddot", "accent.ddot", "ddot", "\\ddot{}"],
    ["Qtilde", "accent.auto-tilde", "Qtilde", "\\tilde{Q}"],
    ["tilde", "accent.tilde", "tilde", "\\tilde{}"],
    ["Qund", "accent.auto-underline", "Qund", "\\underline{Q}"],
    ["und", "accent.underline", "und", "\\underline{}"],
    ["Qvec", "accent.auto-vector", "Qvec", "\\vec{Q}"],
    ["vec", "accent.vector", "vec", "\\vec{}"],
  ] as const;
  for (const [textBefore, id, matchedText, replacement] of accentCases) {
    const match = matcher.match({
      textBefore,
      context: inlineMathContext,
      activation: "auto",
    });
    assert.equal(match?.snippet.id, id, textBefore);
    assert.equal(match?.matchedText, matchedText, textBefore);
    assert.equal(
      replacementPartsToText(match?.replacement ?? []),
      replacement,
      textBefore,
    );
  }

  const postfixAccentCases = [
    ["\\alpha hat", "postfix.command-hat", "\\hat{\\alpha}"],
    ["\\alpha bar", "postfix.command-bar", "\\bar{\\alpha}"],
    ["\\alpha dot", "postfix.command-dot", "\\dot{\\alpha}"],
    ["\\alpha tilde", "postfix.command-tilde", "\\tilde{\\alpha}"],
    ["\\alpha und", "postfix.command-underline", "\\underline{\\alpha}"],
    ["\\alpha vec", "postfix.command-vector", "\\vec{\\alpha}"],
  ] as const;
  for (const [textBefore, id, replacement] of postfixAccentCases) {
    const match = matcher.match({
      textBefore,
      context: inlineMathContext,
      activation: "auto",
    });
    assert.equal(match?.snippet.id, id, textBefore);
    assert.equal(match?.matchedText, textBefore, textBefore);
    assert.equal(
      replacementPartsToText(match?.replacement ?? []),
      replacement,
      textBefore,
    );
  }

  assert.equal(
    matcher.match({
      textBefore: "Qhat",
      context: { ...inlineMathContext, mathMode: "text" },
      activation: "auto",
    }),
    undefined,
    "accent shortcuts stay math-only",
  );
});

test("the editable factory library is the complete canonical default source", () => {
  const text = serializeDefaultSnippetLibrary();
  assert.equal(text.endsWith("\n"), true);
  assert.equal(text.endsWith("\n\n"), false);

  const parsed = JSON.parse(text) as {
    version: number;
    defaultsRevision: number;
    variables: Record<string, string>;
    snippets: Array<{ id?: string; priority?: number }>;
  };
  const factory = createDefaultSnippetLibrary();
  assert.equal(parsed.version, 1);
  assert.equal(parsed.defaultsRevision, FACTORY_DEFAULTS_REVISION);
  assert.deepEqual(parsed.variables, DEFAULT_VARIABLES);
  assert.equal(parsed.snippets.length, DEFAULT_SNIPPETS.length);
  assert.deepEqual(parsed, factory);
  assert.equal(
    parsed.snippets.find((snippet) => snippet.id === "accent.auto-hat")?.priority,
    1,
  );

  const validated = validateSnippetFile({
    schemaVersion: parsed.version,
    variables: parsed.variables,
    snippets: parsed.snippets,
  });
  assert.deepEqual(validated.issues, []);
  const compiled = compileSnippetFile(validated.value);
  assert.deepEqual(compiled.issues, []);
  assert.equal(compiled.value.length, DEFAULT_SNIPPETS.length);
});
