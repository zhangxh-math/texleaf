import * as vscode from "vscode";
import {
  isTeXLeafSourceUri,
  sanitizeMathPreviewConfiguredMacros,
} from "./core";
import type { MathPreviewPlacement } from "./mathPreviewLayout";

export type ManualTrigger = "tab" | "space";
export type BibliographyFormat = "bibtex" | "biblatex";
export type MathPreviewPresentation = "cursor" | "hover" | "both";

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
  readonly zoteroCitations: boolean;
  readonly autoShowCitationPicker: boolean;
  readonly bibliographyFile: string;
  readonly citationCommands: readonly string[];
  readonly zoteroPort: number;
  readonly zoteroLibrary: string;
  readonly zoteroRequestTimeoutMs: number;
  readonly zoteroCacheSeconds: number;
  readonly bibliographyFormat: BibliographyFormat;
  readonly mathPreviewEnabled: boolean;
  readonly mathPreviewPresentation: MathPreviewPresentation;
  readonly mathPreviewPlacement: MathPreviewPlacement;
  readonly mathPreviewDebounceMs: number;
  readonly mathPreviewScale: number;
  readonly mathPreviewMaxSourceLength: number;
  readonly mathPreviewMacros: Readonly<Record<string, string>>;
}

const DEFAULT_LANGUAGE_IDS = ["latex", "tex", "bibtex"] as const;
const DEFAULT_CITATION_COMMANDS = [
  "cite",
  "citep",
  "citet",
  "Cite",
  "Citet",
  "autocite",
  "parencite",
  "textcite",
  "footcite",
  "supercite",
] as const;

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
    zoteroCitations: config.get<boolean>("zoteroCitations", true),
    autoShowCitationPicker: config.get<boolean>(
      "autoShowCitationPicker",
      true,
    ),
    bibliographyFile: normalizeBibliographyPath(
      config.get<string>("bibliographyFile", "reference.bib"),
    ),
    citationCommands: cleanCitationCommands(
      config.get<readonly string[]>(
        "citationCommands",
        DEFAULT_CITATION_COMMANDS,
      ),
    ),
    zoteroPort: clamp(config.get<number>("zoteroPort", 23119), 1, 65_535),
    zoteroLibrary:
      config.get<string>("zoteroLibrary", "My Library").trim() || "My Library",
    zoteroRequestTimeoutMs: clamp(
      config.get<number>("zoteroRequestTimeoutMs", 10_000),
      500,
      60_000,
    ),
    zoteroCacheSeconds: clamp(
      config.get<number>("zoteroCacheSeconds", 30),
      0,
      3_600,
    ),
    bibliographyFormat: readBibliographyFormat(config),
    mathPreviewEnabled: config.get<boolean>("mathPreview.enabled", true),
    mathPreviewPresentation: readMathPreviewPresentation(
      config.get<string>("mathPreview.presentation", "cursor"),
    ),
    mathPreviewPlacement: readMathPreviewPlacement(
      config.get<string>("mathPreview.placement", "auto"),
    ),
    mathPreviewDebounceMs: clamp(
      config.get<number>("mathPreview.debounceMs", 120),
      50,
      2_000,
    ),
    mathPreviewScale: clampNumber(
      config.get<number>("mathPreview.scale", 1),
      0.5,
      3,
    ),
    mathPreviewMaxSourceLength: clamp(
      config.get<number>("mathPreview.maxSourceLength", 8_192),
      256,
      32_768,
    ),
    mathPreviewMacros: sanitizeMathPreviewConfiguredMacros(
      config.get<Readonly<Record<string, string>>>("mathPreview.macros", {}),
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

function cleanCitationCommands(
  value: readonly string[] | undefined,
): readonly string[] {
  const cleaned = cleanStringArray(value, DEFAULT_CITATION_COMMANDS);
  const commands: string[] = [];
  const seen = new Set<string>();
  for (const value of cleaned) {
    const command = value.replace(/^\\+/, "").replace(/\*$/, "");
    if (!/^[A-Za-z@]+$/.test(command) || seen.has(command)) {
      continue;
    }
    seen.add(command);
    commands.push(command);
  }
  return commands.length > 0 ? commands : [...DEFAULT_CITATION_COMMANDS];
}

function normalizeBibliographyPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes("://") ||
    segments.some((segment) => segment === "." || segment === "..") ||
    !normalized.toLowerCase().endsWith(".bib")
  ) {
    return "reference.bib";
  }
  return segments.join("/");
}

function readBibliographyFormat(
  config: vscode.WorkspaceConfiguration,
): BibliographyFormat {
  const configured = config.inspect<string>("bibliographyFormat");
  if (hasExplicitConfigurationValue(configured)) {
    return normalizeBibliographyFormat(
      config.get<string>("bibliographyFormat", "bibtex"),
    );
  }

  // 0.4.0 exposed this name. Keep explicitly configured values working, but
  // do not let its old contributed default mask the new public setting.
  const legacy = config.inspect<string>("zoteroExportFormat");
  if (hasExplicitConfigurationValue(legacy)) {
    return normalizeBibliographyFormat(
      config.get<string>("zoteroExportFormat", "bibtex"),
    );
  }

  return "bibtex";
}

function hasExplicitConfigurationValue(
  inspected: ReturnType<vscode.WorkspaceConfiguration["inspect"]>,
): boolean {
  return inspected !== undefined && [
    inspected.globalValue,
    inspected.workspaceValue,
    inspected.workspaceFolderValue,
    inspected.globalLanguageValue,
    inspected.workspaceLanguageValue,
    inspected.workspaceFolderLanguageValue,
  ].some((value) => value !== undefined);
}

function normalizeBibliographyFormat(
  value: string | undefined,
): BibliographyFormat {
  return value === "biblatex" ? "biblatex" : "bibtex";
}

function readMathPreviewPresentation(value: string): MathPreviewPresentation {
  return value === "hover" || value === "both" ? value : "cursor";
}

function readMathPreviewPlacement(value: string): MathPreviewPlacement {
  return value === "above" || value === "below" ? value : "auto";
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

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}
