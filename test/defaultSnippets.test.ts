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
  THEOREM_ENVIRONMENT_FACTORY_SNIPPET_IDS,
  upgradeRevisionTwoTheoremFactorySnippet,
} from "../src/defaultLibrary";

test("factory library remains complete, unique, and declarative", () => {
  assert.equal(DEFAULT_SNIPPETS.length, 212);
  assert.equal(DEFAULT_SNIPPETS.filter((snippet) => snippet.options.includes("r")).length, 35);
  assert.equal(DEFAULT_SNIPPETS.filter((snippet) => snippet.options.includes("v")).length, 9);

  const normalizedIds = DEFAULT_SNIPPETS.map((snippet) => snippet.id.toLowerCase());
  assert.equal(new Set(normalizedIds).size, normalizedIds.length);
  assert.ok(DEFAULT_SNIPPETS.every((snippet) => typeof snippet.replacement === "string"));

  const byTrigger = new Map(DEFAULT_SNIPPETS.map((snippet) => [snippet.trigger, snippet]));
  assert.equal(byTrigger.has("mk"), false);
  assert.equal(byTrigger.get("lm")?.replacement, "\\(@0\\)");
  assert.equal(byTrigger.get("//")?.replacement, "\\frac{@0}{@1}@2");
  assert.equal(byTrigger.get(";a")?.replacement, "\\alpha");

  const theoremTriggers = new Map([
    ["\\axm", "axiom"],
    ["\\dfn", "definition"],
    ["\\lem", "lemma"],
    ["\\prp", "proposition"],
    ["\\thm", "theorem"],
    ["\\cor", "corollary"],
    ["\\clm", "claim"],
    ["\\asm", "assumption"],
    ["\\exm", "example"],
    ["\\exr", "exercise"],
    ["\\cnj", "conjecture"],
    ["\\hyp", "hypothesis"],
    ["\\rmk", "remark"],
  ]);
  for (const [trigger, environment] of theoremTriggers) {
    const snippet = byTrigger.get(trigger);
    assert.equal(snippet?.options, "tAw", trigger);
    assert.equal(
      snippet?.replacement,
      `\\begin{${environment}}\n\t@0\n\\end{${environment}}\n@1`,
      trigger,
    );
    assert.equal(byTrigger.has(trigger.slice(1)), false, trigger);
  }
});

test("revision-2 theorem defaults upgrade only when the complete record is untouched", () => {
  assert.equal(FACTORY_DEFAULTS_REVISION, 3);
  assert.equal(THEOREM_ENVIRONMENT_FACTORY_SNIPPET_IDS.length, 13);

  for (const id of THEOREM_ENVIRONMENT_FACTORY_SNIPPET_IDS) {
    const current = DEFAULT_SNIPPETS.find((snippet) => snippet.id === id);
    assert.ok(current, id);
    const oldFactoryRecord = {
      ...current,
      trigger:
        id === "environment.definition" ? "def" : current.trigger.slice(1),
      options: "tw",
    };
    const untouchedSnapshot = structuredClone(oldFactoryRecord);
    assert.deepEqual(
      upgradeRevisionTwoTheoremFactorySnippet(oldFactoryRecord),
      current,
      `${id} must migrate from the exact revision-2 factory record`,
    );
    assert.deepEqual(
      oldFactoryRecord,
      untouchedSnapshot,
      `${id} migration must not mutate the parsed user record`,
    );

    const customizedRecords = [
      { ...oldFactoryRecord, trigger: `custom-${oldFactoryRecord.trigger}` },
      { ...oldFactoryRecord, options: "tAw" },
      {
        ...oldFactoryRecord,
        replacement: `${oldFactoryRecord.replacement}% custom`,
      },
      { ...oldFactoryRecord, description: "Custom description" },
      { ...oldFactoryRecord, category: "Custom category" },
      { ...oldFactoryRecord, enabled: false },
      { ...oldFactoryRecord, enabled: true },
      { ...oldFactoryRecord, priority: 100 },
      { ...oldFactoryRecord, customMetadata: "keep me" },
    ];
    const { category: _category, ...missingFactoryField } = oldFactoryRecord;
    customizedRecords.push(missingFactoryField as typeof oldFactoryRecord);
    for (const customized of customizedRecords) {
      assert.equal(
        upgradeRevisionTwoTheoremFactorySnippet(customized),
        undefined,
        `${id} customization must block the narrow migration`,
      );
    }
  }

  const customSameId = {
    id: "environment.theorem",
    trigger: "thm",
    replacement: "\\operatorname{MyTheorem}",
    options: "tw",
    description: "Theorem environment",
    category: "Theorem environments",
  };
  assert.equal(
    upgradeRevisionTwoTheoremFactorySnippet(customSameId),
    undefined,
    "a customized record with a factory ID must remain user-owned",
  );

  const currentTheorem = DEFAULT_SNIPPETS.find(
    (snippet) => snippet.id === "environment.theorem",
  );
  assert.ok(currentTheorem);
  const oldTheorem = { ...currentTheorem, trigger: "thm", options: "tw" };
  for (const conflictingSnippet of [
    {
      id: "user.literal-theorem",
      trigger: "\\thm",
      replacement: "custom",
      options: "tA",
      enabled: false,
    },
    {
      id: "user.regex-theorem",
      trigger: { kind: "regex", source: "\\\\thm", flags: "" },
      replacement: "custom",
      options: "rtA",
    },
  ]) {
    assert.equal(
      upgradeRevisionTwoTheoremFactorySnippet(oldTheorem, [
        oldTheorem,
        conflictingSnippet,
      ]),
      undefined,
      `${conflictingSnippet.id} must protect its occupied \\thm trigger`,
    );
  }
  assert.deepEqual(
    upgradeRevisionTwoTheoremFactorySnippet(oldTheorem, [
      oldTheorem,
      {
        id: "user.other-trigger",
        trigger: "\\other",
        replacement: "custom",
        options: "tA",
      },
    ]),
    currentTheorem,
    "an unrelated custom trigger must not block the narrow theorem upgrade",
  );
  assert.equal(upgradeRevisionTwoTheoremFactorySnippet(null), undefined);
  assert.equal(upgradeRevisionTwoTheoremFactorySnippet([]), undefined);
  assert.equal(
    upgradeRevisionTwoTheoremFactorySnippet({
      id: "user.theorem",
      trigger: "thm",
      replacement: "custom",
      options: "tw",
    }),
    undefined,
  );
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
  const textContext = {
    mathMode: "text" as const,
    inComment: false,
    inVerbatim: false,
    inSnippetSuppressedArgument: false,
    snippetSuppressionCommand: undefined,
    environments: [],
    matrixEnvironment: undefined,
  };
  for (const [trigger, environment] of [
    ["\\thm", "theorem"],
    ["\\dfn", "definition"],
  ] as const) {
    const match = matcher.match({
      textBefore: trigger,
      context: textContext,
      activation: "auto",
    });
    assert.equal(match?.matchedText, trigger);
    assert.equal(
      replacementPartsToText(match?.replacement ?? []),
      `\\begin{${environment}}\n\t\n\\end{${environment}}\n`,
    );
    assert.equal(
      matcher.match({
        textBefore: trigger.slice(1),
        context: textContext,
        activation: "auto",
      }),
      undefined,
      `${trigger} must retain its leading backslash requirement`,
    );
  }
  assert.equal(
    matcher.match({
      textBefore: "\\def",
      context: textContext,
      activation: "auto",
    }),
    undefined,
    "the TeX primitive \\def must not be claimed by the definition shortcut",
  );
  const inlineMathContext = {
    mathMode: "inline" as const,
    inComment: false,
    inVerbatim: false,
    inSnippetSuppressedArgument: false,
    snippetSuppressionCommand: undefined,
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
