/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import type { IRawGrammar } from "vscode-textmate";

export function withLiteralColumnDefinitions(grammar: IRawGrammar): IRawGrammar {
  const group = "texleaf-literal-column-group";
  const patterns = [
    { begin: "%", end: "$", name: "comment.line.percentage.tex" },
    { match: "\\\\(?:[A-Za-z@]+|.)", name: "support.function.general.tex" },
    { include: `#${group}` },
  ];
  return {
    ...grammar,
    patterns: [{
      // TextMate matches one line at a time: keep the command, name, optional
      // arity and body in separate states so newlines/comments stay inert.
      begin: "(\\\\newcolumntype)(?![A-Za-z@])",
      beginCaptures: { 1: { name: "storage.type.function.latex" } },
      // The \G guard prevents ending immediately after the name argument.
      end: "(?<=\\})(?!\\G)",
      name: "meta.column-definition.latex",
      patterns: [
        patterns[0]!,
        {
          begin: "\\{[^{}]+\\}", end: "(?<=\\})(?!\\G)",
          patterns: [patterns[0]!, { match: "\\[[0-9]+\\]" }, { include: `#${group}` }],
        },
      ],
    }, ...grammar.patterns],
    repository: Object.assign({}, grammar.repository, { [group]: { begin: "\\{", end: "\\}", patterns } }),
  };
}

/**
 * The manifest-order information needed to mirror VS Code's TextMate grammar
 * registry. The resource stays generic so this module remains independent of
 * the VS Code Extension Host and its selection rules can be tested directly.
 */
export interface TextMateGrammarContribution<Resource> {
  readonly scopeName: string;
  readonly language?: string;
  readonly uri: Resource;
  readonly injectTo: readonly string[];
}

export interface LatexTextMateGrammarRegistration<Resource> {
  /** The root scope selected for the VS Code `latex` language. */
  readonly rootScopeName: string | undefined;
  /** The final, last-registered contribution for every TextMate scope. */
  readonly grammarByScope: ReadonlyMap<
    string,
    TextMateGrammarContribution<Resource>
  >;
  /** Injection scope names indexed by their declared target scope. */
  readonly injectionsByTarget: ReadonlyMap<string, readonly string[]>;
}

/**
 * Resolve manifest contributions using the same two pieces of registration
 * state that matter to VS Code's grammar registry:
 *
 * - the last contribution registered for a scope owns that scope;
 * - the last contribution associated with the `latex` language chooses the
 *   root scope (with `text.tex.latex` as the compatibility fallback).
 *
 * Replacing a scope deletes and re-adds it so iteration order reflects the
 * winning contribution's actual registration position. Injections are then
 * derived only from those winners; an overwritten grammar can therefore not
 * leave a stale injection behind.
 */
export function resolveLatexTextMateGrammarRegistration<Resource>(
  contributions: readonly TextMateGrammarContribution<Resource>[],
): LatexTextMateGrammarRegistration<Resource> {
  const grammarByScope = new Map<
    string,
    TextMateGrammarContribution<Resource>
  >();
  for (const contribution of contributions) {
    grammarByScope.delete(contribution.scopeName);
    grammarByScope.set(contribution.scopeName, contribution);
  }

  let rootScopeName: string | undefined;
  for (let index = contributions.length - 1; index >= 0; index -= 1) {
    const contribution = contributions[index];
    if (contribution?.language === "latex") {
      rootScopeName = contribution.scopeName;
      break;
    }
  }
  if (rootScopeName === undefined) {
    for (let index = contributions.length - 1; index >= 0; index -= 1) {
      const contribution = contributions[index];
      if (contribution?.scopeName === "text.tex.latex") {
        rootScopeName = contribution.scopeName;
        break;
      }
    }
  }

  const injectionsByTarget = new Map<string, string[]>();
  for (const contribution of grammarByScope.values()) {
    for (const target of contribution.injectTo) {
      const injections = injectionsByTarget.get(target) ?? [];
      if (!injections.includes(contribution.scopeName)) {
        injections.push(contribution.scopeName);
        injectionsByTarget.set(target, injections);
      }
    }
  }

  return { rootScopeName, grammarByScope, injectionsByTarget };
}

/**
 * TextMate scopes are hierarchical. When loading `text.tex.latex`, VS Code
 * makes injections targeting `text`, then `text.tex`, and finally the exact
 * root scope available. Preserve that parent-to-child order and de-duplicate
 * an injection scope that deliberately targets more than one ancestor.
 */
export function textMateGrammarInjectionsForScope<Resource>(
  registration: LatexTextMateGrammarRegistration<Resource>,
  scopeName: string,
): string[] | undefined {
  const parts = scopeName.split(".").filter((part) => part.length > 0);
  const injections: string[] = [];
  let parent = "";
  for (const part of parts) {
    parent = parent.length === 0 ? part : `${parent}.${part}`;
    for (const injection of registration.injectionsByTarget.get(parent) ?? []) {
      if (!injections.includes(injection)) {
        injections.push(injection);
      }
    }
  }
  return injections.length === 0 ? undefined : injections;
}
