import * as vscode from "vscode";
import { isTeXLeafSourceUri } from "./core";

export type ManualTrigger = "tab" | "space";

export interface TeXLeafConfig {
  readonly enabled: boolean;
  readonly autoSnippets: boolean;
  readonly manualTrigger: ManualTrigger;
  readonly autoFraction: boolean;
  readonly autoFractionCommand: string;
  readonly autoEnlargeBrackets: boolean;
  readonly visualSnippets: boolean;
  readonly matrixShortcuts: boolean;
  readonly tabout: boolean;
  readonly skipPairedClosingCharacters: boolean;
  readonly autoDeleteMathDelimiters: boolean;
  readonly colorizeBrackets: boolean;
  readonly highlightActiveBracketPair: boolean;
  readonly enableCompletions: boolean;
  readonly languageIds: readonly string[];
  readonly snippetFiles: readonly string[];
  readonly excludedEnvironments: readonly string[];
  readonly matrixEnvironments: readonly string[];
  readonly autoFractionBreakingCharacters: string;
  readonly autoEnlargeTriggers: readonly string[];
  readonly maxRegexScanLength: number;
  readonly wordDelimiters: string;
}

const DEFAULT_LANGUAGE_IDS = ["latex", "tex", "bibtex"] as const;

export function readConfig(uri?: vscode.Uri): TeXLeafConfig {
  const config = vscode.workspace.getConfiguration("texleaf", uri);
  const manual = config.get<string>("manualTrigger", "tab");

  return {
    enabled: config.get<boolean>("enabled", true),
    autoSnippets: config.get<boolean>("autoSnippets", true),
    manualTrigger: manual === "space" ? "space" : "tab",
    autoFraction: config.get<boolean>("autoFraction", true),
    autoFractionCommand: normalizeLatexCommand(
      config.get<string>("autoFractionCommand", "\\frac"),
      "\\frac",
    ),
    autoEnlargeBrackets: config.get<boolean>("autoEnlargeBrackets", true),
    visualSnippets: config.get<boolean>("visualSnippets", true),
    matrixShortcuts: config.get<boolean>("matrixShortcuts", true),
    tabout: config.get<boolean>("tabout", true),
    skipPairedClosingCharacters: config.get<boolean>(
      "skipPairedClosingCharacters",
      true,
    ),
    autoDeleteMathDelimiters: config.get<boolean>(
      "autoDeleteMathDelimiters",
      true,
    ),
    colorizeBrackets: config.get<boolean>("colorizeBrackets", true),
    highlightActiveBracketPair: config.get<boolean>(
      "highlightActiveBracketPair",
      true,
    ),
    enableCompletions: config.get<boolean>("enableCompletions", true),
    languageIds: cleanStringArray(
      config.get<readonly string[]>("languageIds", DEFAULT_LANGUAGE_IDS),
      DEFAULT_LANGUAGE_IDS,
    ),
    snippetFiles: cleanStringArray(
      config.get<readonly string[]>("snippetFiles", []),
      [],
    ),
    excludedEnvironments: cleanStringArray(
      config.get<readonly string[]>("excludedEnvironments", [
        "verbatim",
        "lstlisting",
        "minted",
      ]),
      [],
    ),
    matrixEnvironments: cleanStringArray(
      config.get<readonly string[]>("matrixEnvironments", [
        "matrix",
        "pmatrix",
        "bmatrix",
        "Bmatrix",
        "vmatrix",
        "Vmatrix",
        "array",
        "cases",
        "align",
        "align*",
        "aligned",
      ]),
      [],
    ),
    autoFractionBreakingCharacters: decodeControlCharacters(
      config.get<string>("autoFractionBreakingCharacters", "+-=,;:&"),
    ),
    autoEnlargeTriggers: cleanStringArray(
      config.get<readonly string[]>("autoEnlargeTriggers", [
        "\\frac",
        "\\sum",
        "\\prod",
        "\\int",
        "\\lim",
      ]),
      [],
    ),
    maxRegexScanLength: clamp(
      config.get<number>("maxRegexScanLength", 512),
      64,
      8192,
    ),
    wordDelimiters: decodeControlCharacters(
      config.get<string>(
        "wordDelimiters",
        "., +-\\n\\t:;!?\\/{}[]()=~$",
      ),
    ),
  };
}

export function isSupportedDocument(
  document: vscode.TextDocument,
  config = readConfig(document.uri),
): boolean {
  return (
    config.enabled &&
    !document.isClosed &&
    isTeXLeafSourceUri(document.uri.scheme, document.uri.path) &&
    config.languageIds.includes(document.languageId)
  );
}

function cleanStringArray(
  value: readonly string[] | undefined,
  fallback: readonly string[],
): readonly string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = candidate.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeLatexCommand(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /[\r\n{}]/.test(trimmed)) {
    return fallback;
  }
  return trimmed.startsWith("\\") ? trimmed : `\\${trimmed}`;
}

function decodeControlCharacters(value: string): string {
  return value.replaceAll("\\n", "\n").replaceAll("\\t", "\t");
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
