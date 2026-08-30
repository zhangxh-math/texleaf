/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import * as vscode from "vscode";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import {
  INITIAL,
  Registry,
  parseRawGrammar,
  type IGrammar,
  type IOnigLib,
  type IRawGrammar,
  type IRawTheme,
  type StateStack,
} from "vscode-textmate";
import {
  createOnigScanner,
  createOnigString,
  loadWASM,
} from "vscode-oniguruma";
import type {
  VisualEditorSyntaxPalette,
  VisualEditorSyntaxToken,
} from "./visualEditorProtocol";
import { visualEditorSyntaxTokenFromTextMate } from "./visualEditorSyntaxToken";

interface ThemeContribution {
  readonly id: string;
  readonly label: string;
  readonly uri: vscode.Uri;
}

interface ThemeTokenRule {
  readonly scopes: readonly string[];
  readonly foreground?: string;
  readonly background?: string;
  readonly fontStyle?: string;
}

interface ThemeBundle {
  readonly rules: readonly ThemeTokenRule[];
}

interface ResolvedTheme {
  readonly rawTheme: IRawTheme;
  readonly palette?: VisualEditorSyntaxPalette;
  /**
   * A private TextMate fallback color that means “inherit the real VS Code
   * editor foreground in the Webview”. It is only installed when a theme has
   * no unscoped token foreground of its own.
   */
  readonly inheritedForeground?: string;
}

interface GrammarContribution {
  readonly scopeName: string;
  readonly language?: string;
  readonly uri: vscode.Uri;
  readonly injectTo: readonly string[];
}

interface TextMateRuntime {
  readonly registry: Registry;
  readonly grammar: IGrammar;
  readonly colorMap: readonly string[];
  readonly inheritedForeground?: string;
}

export interface VisualEditorSyntaxLineInput {
  readonly text: string;
  readonly eolLength: 0 | 1 | 2;
}

export interface VisualEditorIncrementalSyntaxInput {
  readonly beforeText: string;
  readonly afterText: string;
  /** Zero-based logical line containing the earliest edit. */
  readonly startLine: number;
  /** Inclusive zero-based logical line reached by the edit in the old text. */
  readonly oldEndLine: number;
  /** Absolute UTF-16 offset of startLine in the new text. */
  readonly startOffset: number;
  /** Complete replacement lines from startLine through the new changed end. */
  readonly newLines: readonly VisualEditorSyntaxLineInput[];
}

export interface VisualEditorSyntaxTokenPatch {
  readonly from: number;
  readonly to: number;
  readonly expectedText: string;
  readonly tokens: readonly VisualEditorSyntaxToken[];
  /** False means the grammar state did not stabilize inside the safety cap. */
  readonly complete: boolean;
}

interface CachedSyntaxLine extends VisualEditorSyntaxLineInput {
  readonly ruleStack?: StateStack;
  readonly tokens: readonly VisualEditorSyntaxToken[];
}

interface SyntaxDocumentCache {
  readonly text: string;
  readonly lines: readonly CachedSyntaxLine[];
}

interface ThemeRequest {
  readonly key: string;
  readonly activeName: string;
  readonly customizations: unknown;
}

const TARGET_SCOPE_STACKS = {
  comment: ["text.tex.latex", "comment.line.percentage.tex"],
  command: ["text.tex.latex", "support.function.general.tex"],
  keyword: ["text.tex.latex", "keyword.control.preamble.latex"],
  string: ["text.tex.latex", "support.class.latex"],
  atom: ["text.tex.latex", "variable.parameter.function.latex"],
  number: [
    "text.tex.latex",
    "meta.math.block.latex",
    "constant.numeric.math.tex",
  ],
  variable: ["text.tex.latex", "meta.math.block.latex"],
  operator: [
    "text.tex.latex",
    "meta.math.block.latex",
    "punctuation.math.operator.tex",
  ],
  punctuation: [
    "text.tex.latex",
    "punctuation.definition.arguments.begin.latex",
  ],
  meta: ["text.tex.latex", "variable.parameter.function.latex"],
  link: [
    "text.tex.latex",
    "meta.citation.latex",
    "constant.other.reference.citation.latex",
  ],
  heading: [
    "text.tex.latex",
    "meta.function.section.section.latex",
    "entity.name.section.latex",
  ],
  invalid: ["text.tex.latex", "invalid.illegal.latex"],
} as const satisfies Record<keyof VisualEditorSyntaxPalette, readonly string[]>;

const DIRECT_CUSTOMIZATION_SCOPES = {
  comments: ["comment"],
  strings: ["string", "support.class.latex"],
  numbers: ["constant.numeric"],
  keywords: ["keyword"],
  types: ["support.class", "support.type", "entity.name.type"],
  functions: ["support.function", "entity.name.function"],
  variables: ["variable"],
} as const;

const TEXTMATE_FONT_STYLE_MASK = 0x00007800;
const TEXTMATE_FONT_STYLE_OFFSET = 11;
const TEXTMATE_FOREGROUND_MASK = 0x00ff8000;
const TEXTMATE_FOREGROUND_OFFSET = 15;
// vscode-textmate otherwise falls back to #000000 when a VS Code theme (such
// as Dark Modern) relies on editor.foreground instead of an unscoped
// tokenColors rule. The Webview already receives that fully resolved value as
// --vscode-editor-foreground, so this sentinel lets ordinary text inherit it.
const TEXTMATE_INHERITED_FOREGROUND = "#010203";
// A malformed or intentionally open construct can carry its TextMate state to
// the end of a very large paper. Keep routine typing bounded; in that rare
// case the Webview falls back to its immediate grammar colors and the normal
// idle document refresh supplies a complete native snapshot.
const MAX_INCREMENTAL_SYNTAX_LINES = 512;
let onigLibraryPromise: Promise<IOnigLib> | undefined;

/**
 * Resolve the active TextMate theme and tokenize LaTeX with the same grammar
 * that powers VS Code's native editor. The old coarse palette remains as a
 * fallback while exact per-token decorations are loading.
 */
export class VisualEditorSyntaxThemeResolver {
  private cachedKey: string | undefined;
  private cachedTheme: Promise<ResolvedTheme | undefined> | undefined;
  private cachedRuntime: Promise<TextMateRuntime | undefined> | undefined;
  private readonly documentCaches = new Map<string, SyntaxDocumentCache>();

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public invalidate(): void {
    this.cachedKey = undefined;
    this.cachedTheme = undefined;
    this.cachedRuntime = undefined;
    this.documentCaches.clear();
  }

  /**
   * Extension grammars can still be registering while a fresh Extension Host
   * resolves its first custom editor.  Do not pin that transient "no grammar"
   * result for the lifetime of the visual editor; keep the already resolved
   * colour theme and let a bounded provider retry rebuild only the grammar
   * runtime.
   */
  public invalidateRuntime(): void {
    this.cachedRuntime = undefined;
    this.documentCaches.clear();
  }

  public async resolve(
    resource: vscode.Uri,
  ): Promise<VisualEditorSyntaxPalette | undefined> {
    return (await this.resolveTheme(resource))?.palette;
  }

  public async tokenize(
    text: string,
    resource: vscode.Uri,
  ): Promise<readonly VisualEditorSyntaxToken[] | undefined> {
    const runtime = await this.resolveRuntime(resource);
    if (runtime === undefined) {
      return undefined;
    }
    try {
      const snapshot = tokenizeDocument(text, runtime);
      this.documentCaches.set(resource.toString(), snapshot.cache);
      return snapshot.tokens;
    } catch {
      // A third-party injection grammar must never make the custom editor
      // unusable. CodeMirror's local highlighting remains the safe fallback.
      return undefined;
    }
  }

  /**
   * Re-tokenize only the changed logical lines and the minimal suffix needed
   * for TextMate's rule stack to stabilize. This produces the same token
   * metadata as VS Code's native editor without re-scanning an entire thesis
   * after every key press.
   */
  public async tokenizeIncremental(
    input: VisualEditorIncrementalSyntaxInput,
    resource: vscode.Uri,
  ): Promise<VisualEditorSyntaxTokenPatch | undefined> {
    const runtime = await this.resolveRuntime(resource);
    if (runtime === undefined) {
      return undefined;
    }
    const key = resource.toString();
    const cache = this.documentCaches.get(key);
    if (cache === undefined || cache.text !== input.beforeText) {
      return undefined;
    }
    const startLine = input.startLine;
    const oldEndLine = input.oldEndLine;
    if (
      !Number.isSafeInteger(startLine) ||
      !Number.isSafeInteger(oldEndLine) ||
      !Number.isSafeInteger(input.startOffset) ||
      startLine < 0 ||
      oldEndLine < startLine ||
      oldEndLine >= cache.lines.length ||
      input.startOffset < 0 ||
      input.startOffset > input.afterText.length ||
      input.newLines.length === 0 ||
      input.newLines.some((line) =>
        line.eolLength !== 0 && line.eolLength !== 1 && line.eolLength !== 2
      )
    ) {
      return undefined;
    }

    const lines: CachedSyntaxLine[] = [...cache.lines];
    const replacement = input.newLines.map((line): CachedSyntaxLine => ({
      text: line.text,
      eolLength: line.eolLength,
      tokens: [],
    }));
    lines.splice(
      startLine,
      oldEndLine - startLine + 1,
      ...replacement,
    );
    const changedEndLine = startLine + replacement.length - 1;
    let incoming = startLine === 0
      ? INITIAL
      : lines[startLine - 1]?.ruleStack;
    if (incoming === undefined) {
      return undefined;
    }

    const tokens: VisualEditorSyntaxToken[] = [];
    let absoluteOffset = input.startOffset;
    let processedEndLine = startLine - 1;
    let complete = false;
    for (
      let lineIndex = startLine;
      lineIndex < lines.length &&
      lineIndex < startLine + MAX_INCREMENTAL_SYNTAX_LINES;
      lineIndex += 1
    ) {
      const previous = lines[lineIndex];
      if (previous === undefined) {
        break;
      }
      const tokenized = tokenizeSyntaxLine(previous.text, incoming, runtime);
      const next: CachedSyntaxLine = {
        text: previous.text,
        eolLength: previous.eolLength,
        ruleStack: tokenized.ruleStack,
        tokens: tokenized.tokens,
      };
      lines[lineIndex] = next;
      for (const token of tokenized.tokens) {
        appendSyntaxToken(tokens, {
          ...token,
          from: absoluteOffset + token.from,
          to: absoluteOffset + token.to,
        });
      }
      absoluteOffset += previous.text.length + previous.eolLength;
      processedEndLine = lineIndex;
      const reachedDocumentEnd = lineIndex === lines.length - 1;
      const reachedStableSuffix = lineIndex >= changedEndLine &&
        previous.ruleStack !== undefined &&
        tokenized.ruleStack.equals(previous.ruleStack);
      if (reachedDocumentEnd || reachedStableSuffix) {
        complete = true;
        break;
      }
      incoming = tokenized.ruleStack;
    }
    if (processedEndLine < startLine) {
      return undefined;
    }

    const patchTo = complete ? absoluteOffset : input.afterText.length;
    if (complete) {
      this.documentCaches.set(key, { text: input.afterText, lines });
    } else {
      // Do not let a partial rule-stack cache seed the next edit. The caller
      // schedules one idle full refresh after applying this safe fallback.
      this.documentCaches.delete(key);
    }
    return {
      from: input.startOffset,
      to: patchTo,
      expectedText: input.afterText.slice(input.startOffset, patchTo),
      tokens,
      complete,
    };
  }

  private resolveTheme(
    resource: vscode.Uri,
  ): Promise<ResolvedTheme | undefined> {
    const request = themeRequest(resource);
    this.ensureRequest(request);
    if (this.cachedTheme === undefined) {
      this.cachedTheme = resolveTheme(request.activeName, request.customizations);
    }
    return this.cachedTheme;
  }

  private resolveRuntime(
    resource: vscode.Uri,
  ): Promise<TextMateRuntime | undefined> {
    const request = themeRequest(resource);
    this.ensureRequest(request);
    if (this.cachedRuntime === undefined) {
      this.cachedRuntime = this.createRuntime(resource);
    }
    return this.cachedRuntime;
  }

  private ensureRequest(request: ThemeRequest): void {
    if (this.cachedKey === request.key) {
      return;
    }
    this.cachedKey = request.key;
    this.cachedTheme = resolveTheme(request.activeName, request.customizations);
    this.cachedRuntime = undefined;
    this.documentCaches.clear();
  }

  private async createRuntime(
    resource: vscode.Uri,
  ): Promise<TextMateRuntime | undefined> {
    const resolvedTheme = await this.resolveTheme(resource);
    if (resolvedTheme === undefined) {
      return undefined;
    }
    const contributions = grammarContributions();
    const latex = selectLatexGrammar(contributions);
    if (latex === undefined) {
      return undefined;
    }
    const grammarByScope = new Map<string, GrammarContribution>();
    for (const contribution of contributions) {
      const existing = grammarByScope.get(contribution.scopeName);
      if (
        existing === undefined ||
        grammarContributionPriority(contribution) >
          grammarContributionPriority(existing)
      ) {
        grammarByScope.set(contribution.scopeName, contribution);
      }
    }
    const injections = new Map<string, string[]>();
    for (const contribution of contributions) {
      for (const target of contribution.injectTo) {
        const scopes = injections.get(target) ?? [];
        if (!scopes.includes(contribution.scopeName)) {
          scopes.push(contribution.scopeName);
          injections.set(target, scopes);
        }
      }
    }
    const rawGrammarCache = new Map<
      string,
      Promise<IRawGrammar | undefined>
    >();
    const registry = new Registry({
      onigLib: loadOnigLibrary(this.context),
      theme: resolvedTheme.rawTheme,
      loadGrammar: async (scopeName) => {
        const contribution = grammarByScope.get(scopeName);
        if (contribution === undefined) {
          return undefined;
        }
        let pending = rawGrammarCache.get(scopeName);
        if (pending === undefined) {
          pending = readRawGrammar(contribution.uri);
          rawGrammarCache.set(scopeName, pending);
        }
        return pending;
      },
      getInjections: (scopeName) => injections.get(scopeName),
    });
    const grammar = await registry.loadGrammar(latex.scopeName);
    if (grammar === null) {
      registry.dispose();
      return undefined;
    }
    return {
      registry,
      grammar,
      colorMap: registry.getColorMap(),
      ...(resolvedTheme.inheritedForeground === undefined
        ? {}
        : { inheritedForeground: resolvedTheme.inheritedForeground }),
    };
  }
}

function themeRequest(resource: vscode.Uri): ThemeRequest {
  const activeName = vscode.workspace
    .getConfiguration("workbench", resource)
    .get<string>("colorTheme") ?? "";
  const customizations = vscode.workspace
    .getConfiguration("editor", resource)
    .get<unknown>("tokenColorCustomizations");
  return {
    key: `${vscode.window.activeColorTheme.kind}\u0000${activeName}\u0000${stableJson(customizations)}`,
    activeName,
    customizations,
  };
}

async function resolveTheme(
  activeName: string,
  customizations: unknown,
): Promise<ResolvedTheme | undefined> {
  const contribution = findThemeContribution(activeName) ??
    findThemeContribution(defaultThemeId(vscode.window.activeColorTheme.kind));
  const baseRules = contribution === undefined
    ? []
    : (await loadThemeBundle(contribution.uri, new Set<string>())).rules;
  const rules = [
    ...baseRules,
    ...customizationRules(customizations, activeName),
  ];
  if (rules.length === 0) {
    return undefined;
  }
  const palette = resolvePalette(rules);
  const inheritsEditorForeground = !rules.some(
    (rule) => rule.scopes.length === 0 && rule.foreground !== undefined,
  );
  const settings: IRawTheme["settings"] = [
    ...(inheritsEditorForeground
      ? [{ settings: { foreground: TEXTMATE_INHERITED_FOREGROUND } }]
      : []),
    ...rules.map((rule) => ({
    ...(rule.scopes.length === 0 ? {} : { scope: [...rule.scopes] }),
    settings: {
      ...(rule.foreground === undefined
        ? {}
        : { foreground: rule.foreground }),
      ...(rule.background === undefined
        ? {}
        : { background: rule.background }),
      ...(rule.fontStyle === undefined
        ? {}
        : { fontStyle: rule.fontStyle }),
    },
    })),
  ];
  return {
    rawTheme: {
      ...(activeName.trim().length === 0 ? {} : { name: activeName }),
      settings,
    },
    ...(palette === undefined ? {} : { palette }),
    ...(inheritsEditorForeground
      ? { inheritedForeground: TEXTMATE_INHERITED_FOREGROUND }
      : {}),
  };
}

function resolvePalette(
  rules: readonly ThemeTokenRule[],
): VisualEditorSyntaxPalette | undefined {
  const palette: Partial<Record<keyof VisualEditorSyntaxPalette, string>> = {};
  for (const [name, scopeStack] of Object.entries(TARGET_SCOPE_STACKS) as Array<
    [keyof VisualEditorSyntaxPalette, readonly string[]]
  >) {
    const foreground = resolveForeground(rules, scopeStack);
    if (foreground !== undefined) {
      palette[name] = foreground;
    }
  }
  return Object.keys(palette).length === 0
    ? undefined
    : palette as VisualEditorSyntaxPalette;
}

function findThemeContribution(activeName: string): ThemeContribution | undefined {
  const requested = normalizeThemeName(activeName);
  if (requested.length === 0) {
    return undefined;
  }
  const contributions: ThemeContribution[] = [];
  for (const extension of vscode.extensions.all) {
    const packageJson = asRecord(extension.packageJSON);
    const contributes = asRecord(packageJson?.["contributes"]);
    const themes = contributes?.["themes"];
    if (!Array.isArray(themes)) {
      continue;
    }
    for (const value of themes) {
      const theme = asRecord(value);
      const themePath = stringValue(theme?.["path"]);
      if (themePath === undefined) {
        continue;
      }
      const id = stringValue(theme?.["id"]) ?? "";
      const label = stringValue(theme?.["label"]) ?? "";
      contributions.push({
        id,
        label,
        uri: vscode.Uri.joinPath(extension.extensionUri, themePath),
      });
    }
  }
  return contributions.find((theme) =>
    normalizeThemeName(theme.id) === requested ||
    normalizeThemeName(theme.label) === requested ||
    normalizeThemeName(
      theme.uri.path.split("/").pop()?.replace(/\.jsonc?$/iu, "") ?? "",
    ) === requested
  );
}

async function loadThemeBundle(
  uri: vscode.Uri,
  visited: Set<string>,
): Promise<ThemeBundle> {
  const key = uri.toString();
  if (visited.has(key)) {
    return { rules: [] };
  }
  visited.add(key);
  const value = await readJsonc(uri);
  if (Array.isArray(value)) {
    return { rules: normalizeRules(value) };
  }
  const theme = asRecord(value);
  if (theme === undefined) {
    return { rules: [] };
  }
  const rules: ThemeTokenRule[] = [];
  const include = stringValue(theme["include"]);
  if (include !== undefined) {
    const included = await loadThemeBundle(relativeThemeUri(uri, include), visited);
    rules.push(...included.rules);
  }
  const tokenColors = theme["tokenColors"];
  if (typeof tokenColors === "string") {
    const included = await loadThemeBundle(
      relativeThemeUri(uri, tokenColors),
      visited,
    );
    rules.push(...included.rules);
  } else if (Array.isArray(tokenColors)) {
    rules.push(...normalizeRules(tokenColors));
  }
  // JSON conversions of .tmTheme files commonly store their rules here.
  const settings = theme["settings"];
  if (Array.isArray(settings)) {
    rules.push(...normalizeRules(settings));
  }
  return { rules };
}

async function readJsonc(uri: vscode.Uri): Promise<unknown> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const errors: ParseError[] = [];
    const value = parseJsonc(new TextDecoder().decode(bytes), errors, {
      allowTrailingComma: true,
      disallowComments: false,
    }) as unknown;
    return errors.length === 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function relativeThemeUri(base: vscode.Uri, relative: string): vscode.Uri {
  return vscode.Uri.joinPath(base, "..", relative);
}

function normalizeRules(values: readonly unknown[]): ThemeTokenRule[] {
  const rules: ThemeTokenRule[] = [];
  for (const value of values) {
    const rule = asRecord(value);
    const settings = asRecord(rule?.["settings"]);
    const foreground = sanitizedColor(settings?.["foreground"]);
    const background = sanitizedColor(settings?.["background"]);
    const fontStyle = sanitizedFontStyle(settings?.["fontStyle"]);
    if (
      foreground === undefined &&
      background === undefined &&
      fontStyle === undefined
    ) {
      continue;
    }
    const scopeValue = rule?.["scope"];
    const scopes = typeof scopeValue === "string"
      ? splitScopeSelectors(scopeValue)
      : Array.isArray(scopeValue)
        ? scopeValue.flatMap((scope) =>
            typeof scope === "string" ? splitScopeSelectors(scope) : [])
        : [];
    rules.push({
      scopes,
      ...(foreground === undefined ? {} : { foreground }),
      ...(background === undefined ? {} : { background }),
      ...(fontStyle === undefined ? {} : { fontStyle }),
    });
  }
  return rules;
}

function customizationRules(
  value: unknown,
  activeTheme: string,
): ThemeTokenRule[] {
  const root = asRecord(value);
  if (root === undefined) {
    return [];
  }
  const blocks: Record<string, unknown>[] = [root];
  const normalizedTheme = normalizeThemeName(activeTheme);
  for (const [key, nested] of Object.entries(root)) {
    if (
      key.startsWith("[") &&
      themeCustomizationNames(key).some(
        (name) => normalizeThemeName(name) === normalizedTheme,
      )
    ) {
      const block = asRecord(nested);
      if (block !== undefined) {
        blocks.push(block);
      }
    }
  }
  const rules: ThemeTokenRule[] = [];
  for (const block of blocks) {
    for (const [setting, scopes] of Object.entries(DIRECT_CUSTOMIZATION_SCOPES)) {
      const foreground = sanitizedColor(block[setting]);
      if (foreground !== undefined) {
        rules.push({ scopes, foreground });
      }
    }
    const textMateRules = block["textMateRules"];
    if (Array.isArray(textMateRules)) {
      rules.push(...normalizeRules(textMateRules));
    }
  }
  return rules;
}

function resolveForeground(
  rules: readonly ThemeTokenRule[],
  targetStack: readonly string[],
): string | undefined {
  let bestScore = -1;
  let foreground: string | undefined;
  for (const rule of rules) {
    for (const selector of rule.scopes) {
      const score = scopeSelectorScore(selector, targetStack);
      if (score >= 0 && score >= bestScore) {
        bestScore = score;
        foreground = rule.foreground;
      }
    }
  }
  return foreground;
}

function scopeSelectorScore(
  selector: string,
  targetStack: readonly string[],
): number {
  const terms = selector.trim().split(/\s+/u).filter((term) => term.length > 0);
  if (terms.length === 0) {
    return -1;
  }
  const excluded = terms
    .filter((term) => term.startsWith("-"))
    .map((term) => term.slice(1));
  if (
    excluded.some((term) =>
      targetStack.some((scope) => scopeMatches(term, scope)))
  ) {
    return -1;
  }
  const positive = terms.filter((term) => !term.startsWith("-"));
  let targetIndex = 0;
  let score = 0;
  for (const term of positive) {
    let matched = false;
    while (targetIndex < targetStack.length) {
      const scope = targetStack[targetIndex];
      targetIndex += 1;
      if (scope !== undefined && scopeMatches(term, scope)) {
        score += term.split(".").length * 1_000 + term.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      return -1;
    }
  }
  return score + positive.length * 100_000;
}

function scopeMatches(selector: string, scope: string): boolean {
  const normalized = selector.replace(/^[LRB]:/u, "");
  return scope === normalized || scope.startsWith(`${normalized}.`);
}

function splitScopeSelectors(value: string): string[] {
  return value.split(",").map((scope) => scope.trim()).filter(Boolean);
}

function themeCustomizationNames(key: string): string[] {
  return [...key.matchAll(/\[([^\]]+)\]/gu)].map((match) => match[1] ?? "");
}

function grammarContributions(): GrammarContribution[] {
  const contributions: GrammarContribution[] = [];
  for (const extension of vscode.extensions.all) {
    const packageJson = asRecord(extension.packageJSON);
    const contributes = asRecord(packageJson?.["contributes"]);
    const grammars = contributes?.["grammars"];
    if (!Array.isArray(grammars)) {
      continue;
    }
    for (const value of grammars) {
      const grammar = asRecord(value);
      const scopeName = stringValue(grammar?.["scopeName"]);
      const grammarPath = stringValue(grammar?.["path"]);
      if (scopeName === undefined || grammarPath === undefined) {
        continue;
      }
      const language = stringValue(grammar?.["language"]);
      const injectToValue = grammar?.["injectTo"];
      const injectTo = Array.isArray(injectToValue)
        ? injectToValue.flatMap((scope) =>
            typeof scope === "string" && scope.trim().length > 0
              ? [scope.trim()]
              : [])
        : [];
      contributions.push({
        scopeName,
        ...(language === undefined ? {} : { language }),
        uri: vscode.Uri.joinPath(extension.extensionUri, grammarPath),
        injectTo,
      });
    }
  }
  return contributions;
}

function selectLatexGrammar(
  contributions: readonly GrammarContribution[],
): GrammarContribution | undefined {
  return [...contributions]
    .filter((contribution) => contribution.scopeName === "text.tex.latex")
    .sort((left, right) =>
      grammarContributionPriority(right) - grammarContributionPriority(left))[0] ??
    [...contributions]
      .filter((contribution) => contribution.language === "latex")
      .sort((left, right) =>
        grammarContributionPriority(right) - grammarContributionPriority(left))[0];
}

function grammarContributionPriority(
  contribution: GrammarContribution,
): number {
  if (contribution.language === "latex") {
    return 30;
  }
  if (
    contribution.language === "latex-class" ||
    contribution.language === "latex-package"
  ) {
    return 20;
  }
  if (contribution.language === "tex") {
    return 10;
  }
  return contribution.injectTo.length > 0 ? 0 : 1;
}

async function readRawGrammar(
  uri: vscode.Uri,
): Promise<IRawGrammar | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return parseRawGrammar(new TextDecoder().decode(bytes), uri.fsPath);
  } catch {
    return undefined;
  }
}

function loadOnigLibrary(
  context: vscode.ExtensionContext,
): Promise<IOnigLib> {
  if (onigLibraryPromise === undefined) {
    onigLibraryPromise = (async () => {
      const wasmUri = vscode.Uri.joinPath(
        context.extensionUri,
        "dist",
        "onig.wasm",
      );
      const wasm = await vscode.workspace.fs.readFile(wasmUri);
      await loadWASM(wasm);
      return { createOnigScanner, createOnigString };
    })();
  }
  return onigLibraryPromise;
}

function tokenizeDocument(
  text: string,
  runtime: TextMateRuntime,
): {
  readonly tokens: readonly VisualEditorSyntaxToken[];
  readonly cache: SyntaxDocumentCache;
} {
  const tokens: VisualEditorSyntaxToken[] = [];
  const lines: CachedSyntaxLine[] = [];
  let ruleStack: StateStack | null = INITIAL;
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const rawLineEnd = newline < 0 ? text.length : newline;
    const contentEnd = rawLineEnd > lineStart &&
        text.charCodeAt(rawLineEnd - 1) === 13
      ? rawLineEnd - 1
      : rawLineEnd;
    const lineText = text.slice(lineStart, contentEnd);
    const tokenized = tokenizeSyntaxLine(lineText, ruleStack, runtime);
    ruleStack = tokenized.ruleStack;
    for (const token of tokenized.tokens) {
      appendSyntaxToken(tokens, {
        ...token,
        from: lineStart + token.from,
        to: lineStart + token.to,
      });
    }
    const eolLength = newline < 0
      ? 0
      : rawLineEnd - contentEnd + 1;
    lines.push({
      text: lineText,
      eolLength: eolLength as 0 | 1 | 2,
      ruleStack,
      tokens: tokenized.tokens,
    });
    if (newline < 0) {
      break;
    }
    lineStart = newline + 1;
  }
  return { tokens, cache: { text, lines } };
}

function tokenizeSyntaxLine(
  lineText: string,
  ruleStack: StateStack | null,
  runtime: TextMateRuntime,
): {
  readonly ruleStack: StateStack;
  readonly tokens: readonly VisualEditorSyntaxToken[];
} {
  const result = runtime.grammar.tokenizeLine2(lineText, ruleStack, 100);
  const tokens: VisualEditorSyntaxToken[] = [];
  const encoded = result.tokens;
  for (let index = 0; index + 1 < encoded.length; index += 2) {
    const localFrom = Math.min(lineText.length, encoded[index] ?? 0);
    const localTo = Math.min(
      lineText.length,
      index + 2 < encoded.length
        ? encoded[index + 2] ?? lineText.length
        : lineText.length,
    );
    if (localTo <= localFrom) {
      continue;
    }
    const metadata = encoded[index + 1] ?? 0;
    const fontStyle =
      (metadata & TEXTMATE_FONT_STYLE_MASK) >>> TEXTMATE_FONT_STYLE_OFFSET;
    const resolvedForeground = tokenColor(
      runtime.colorMap,
      (metadata & TEXTMATE_FOREGROUND_MASK) >>> TEXTMATE_FOREGROUND_OFFSET,
    );
    // TextMate's background field contains the theme-wide editor canvas
    // color for ordinary tokens. VS Code paints that once on the editor; it
    // does not wrap every token in an opaque background rectangle.
    const token = visualEditorSyntaxTokenFromTextMate({
      from: localFrom,
      to: localTo,
      ...(resolvedForeground === undefined ? {} : { resolvedForeground }),
      ...(runtime.inheritedForeground === undefined
        ? {}
        : { inheritedForeground: runtime.inheritedForeground }),
      fontStyle,
    });
    if (token === undefined) {
      continue;
    }
    appendSyntaxToken(tokens, token);
  }
  return { ruleStack: result.ruleStack, tokens };
}

function appendSyntaxToken(
  tokens: VisualEditorSyntaxToken[],
  token: VisualEditorSyntaxToken,
): void {
  const previous = tokens[tokens.length - 1];
  if (
    previous !== undefined &&
    previous.to === token.from &&
    previous.foreground === token.foreground &&
    previous.fontStyle === token.fontStyle
  ) {
    tokens[tokens.length - 1] = { ...previous, to: token.to };
    return;
  }
  tokens.push(token);
}

function tokenColor(
  colorMap: readonly string[],
  colorId: number,
): string | undefined {
  return colorId <= 0 ? undefined : sanitizedColor(colorMap[colorId]);
}

function defaultThemeId(kind: vscode.ColorThemeKind): string {
  switch (kind) {
    case vscode.ColorThemeKind.Light:
      return "Light Modern";
    case vscode.ColorThemeKind.HighContrast:
      return "Default High Contrast";
    case vscode.ColorThemeKind.HighContrastLight:
      return "Default High Contrast Light";
    case vscode.ColorThemeKind.Dark:
    default:
      return "Dark Modern";
  }
}

function sanitizedColor(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const color = value.trim();
  return /^#[0-9a-f]{3,8}$/iu.test(color) ? color : undefined;
}

function sanitizedFontStyle(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return "";
  }
  const styles = normalized
    .split(/\s+/u)
    .filter((style) =>
      style === "italic" ||
      style === "bold" ||
      style === "underline" ||
      style === "strikethrough");
  return styles.length === 0 ? undefined : [...new Set(styles)].join(" ");
}

function normalizeThemeName(value: string): string {
  return value.trim().replace(/^default\s+/iu, "").toLocaleLowerCase();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
