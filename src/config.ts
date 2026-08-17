import * as vscode from "vscode";
import {
  isAIWritingSourceUri,
  isTeXLeafSourceUri,
  sanitizeMathPreviewConfiguredMacros,
} from "./core";
import {
  normalizeMathPreviewPlacement,
  type MathPreviewPlacement,
} from "./mathPreviewLayout";

export type ManualTrigger = "tab" | "space";
export type BibliographyFormat = "bibtex" | "biblatex";
export type MathPreviewPresentation = "cursor" | "hover" | "both";
export type AIWritingProvider = "deepseek" | "openai";
export type AIWritingDeepSeekModel = "deepseek-v4-flash" | "deepseek-v4-pro";
export type AIWritingLanguage = "auto" | "english" | "chinese";
export type AIWritingStyle = "academic" | "general" | "concise";

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
  readonly aiWritingEnabled: boolean;
  readonly aiWritingAutomaticReview: boolean;
  readonly aiWritingInlineCompletions: boolean;
  readonly aiWritingProvider: AIWritingProvider;
  readonly aiWritingDeepSeekModel: AIWritingDeepSeekModel;
  readonly aiWritingDeepSeekBaseUrl: string;
  readonly aiWritingOpenAIModel: string;
  readonly aiWritingOpenAIBaseUrl: string;
  /** The configured model for the currently selected provider. */
  readonly aiWritingModel: string;
  readonly aiWritingLanguage: AIWritingLanguage;
  readonly aiWritingStyle: AIWritingStyle;
  readonly aiWritingReviewDelayMs: number;
  readonly aiWritingCompletionDelayMs: number;
  readonly aiWritingMaxParagraphLength: number;
  readonly aiWritingMaxDocumentLength: number;
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
  const aiWritingProvider = readAIWritingProvider(
    readGlobalConfigurationValue(config, "aiWriting.provider", "deepseek"),
  );
  const aiWritingDeepSeekModel = readAIWritingDeepSeekModel(config);
  const aiWritingDeepSeekBaseUrl = readGlobalConfigurationValue(
    config,
    "aiWriting.deepseekBaseUrl",
    "https://api.deepseek.com",
  ).trim();
  const aiWritingOpenAIModel = readGlobalConfigurationValue(
    config,
    "aiWriting.openaiModel",
    "gpt-5.6-luna",
  ).trim();
  const aiWritingOpenAIBaseUrl = readGlobalConfigurationValue(
    config,
    "aiWriting.openaiBaseUrl",
    "https://api.openai.com/v1",
  ).trim();

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
    mathPreviewPlacement: normalizeMathPreviewPlacement(
      config.get<string>("mathPreview.placement", "autoBelow"),
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
    // Every network-, credential-, and billing-relevant AI option is read only
    // from the user/Profile layer. A repository's .vscode/settings.json must
    // never be able to enable requests or redirect/change their cost profile.
    aiWritingEnabled: readGlobalConfigurationValue(
      config,
      "aiWriting.enabled",
      false,
    ),
    aiWritingAutomaticReview: readGlobalConfigurationValue(
      config,
      "aiWriting.automaticReview",
      true,
    ),
    aiWritingInlineCompletions: readGlobalConfigurationValue(
      config,
      "aiWriting.inlineCompletions",
      true,
    ),
    aiWritingProvider,
    aiWritingDeepSeekModel,
    aiWritingDeepSeekBaseUrl,
    aiWritingOpenAIModel,
    aiWritingOpenAIBaseUrl,
    aiWritingModel: aiWritingProvider === "openai"
      ? aiWritingOpenAIModel
      : aiWritingDeepSeekModel,
    aiWritingLanguage: readAIWritingLanguage(
      readGlobalConfigurationValue(config, "aiWriting.language", "auto"),
    ),
    aiWritingStyle: readAIWritingStyle(
      readGlobalConfigurationValue(config, "aiWriting.style", "academic"),
    ),
    aiWritingReviewDelayMs: clamp(
      readGlobalConfigurationValue(config, "aiWriting.reviewDelayMs", 900),
      500,
      10_000,
    ),
    aiWritingCompletionDelayMs: clamp(
      readGlobalConfigurationValue(config, "aiWriting.completionDelayMs", 500),
      100,
      5_000,
    ),
    aiWritingMaxParagraphLength: clamp(
      readGlobalConfigurationValue(config, "aiWriting.maxParagraphLength", 6_000),
      500,
      20_000,
    ),
    aiWritingMaxDocumentLength: clamp(
      readGlobalConfigurationValue(config, "aiWriting.maxDocumentLength", 30_000),
      1_000,
      100_000,
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

/** AI writing deliberately excludes BibTeX and editors without a file URI. */
export function isAIWritingDocument(
  document: vscode.TextDocument,
  config = readConfig(document.uri),
): boolean {
  const rawConfiguration = vscode.workspace.getConfiguration(
    "texleaf",
    document.uri,
  );
  const userMasterEnabled = readGlobalConfigurationValue(
    rawConfiguration,
    "enabled",
    true,
  );
  const inspectedLanguageIds = rawConfiguration.inspect<readonly string[]>(
    "languageIds",
  );
  const userLanguageIds = cleanStringArray(
    inspectedLanguageIds?.globalValue ?? inspectedLanguageIds?.defaultValue,
    DEFAULT_LANGUAGE_IDS,
  );
  return (
    // A workspace may opt out, but it must never override a user/Profile-level
    // master disable or language exclusion to reactivate network access.
    userMasterEnabled &&
    userLanguageIds.includes(document.languageId) &&
    isSupportedDocument(document, config) &&
    isAIWritingSourceUri(document.uri.scheme, document.uri.path) &&
    (document.languageId === "latex" || document.languageId === "tex")
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

function readAIWritingProvider(value: string): AIWritingProvider {
  return value === "openai" ? "openai" : "deepseek";
}

function readAIWritingDeepSeekModel(
  config: vscode.WorkspaceConfiguration,
): AIWritingDeepSeekModel {
  const current = config.inspect<string>("aiWriting.deepseekModel");
  if (hasExplicitGlobalConfigurationValue(current)) {
    return normalizeAIWritingDeepSeekModel(
      current?.globalValue,
    );
  }

  // TeXLeaf 0.8.0 exposed aiWriting.model. Keep an explicitly configured
  // value working without continuing to expose the ambiguous setting in UI.
  const legacy = config.inspect<string>("aiWriting.model");
  if (hasExplicitGlobalConfigurationValue(legacy)) {
    return normalizeAIWritingDeepSeekModel(
      legacy?.globalValue,
    );
  }
  return normalizeAIWritingDeepSeekModel(current?.defaultValue);
}

/** Read a setting only from VS Code's user/Profile layer plus its default. */
function readGlobalConfigurationValue<T>(
  config: vscode.WorkspaceConfiguration,
  section: string,
  fallback: T,
): T {
  const inspected = config.inspect<T>(section);
  return inspected?.globalValue ?? inspected?.defaultValue ?? fallback;
}

function hasExplicitGlobalConfigurationValue(
  inspected: ReturnType<vscode.WorkspaceConfiguration["inspect"]>,
): boolean {
  return inspected?.globalValue !== undefined;
}

function normalizeAIWritingDeepSeekModel(
  value: string | undefined,
): AIWritingDeepSeekModel {
  return value === "deepseek-v4-pro" ? value : "deepseek-v4-flash";
}

function readAIWritingLanguage(value: string): AIWritingLanguage {
  return value === "english" || value === "chinese" ? value : "auto";
}

function readAIWritingStyle(value: string): AIWritingStyle {
  return value === "general" || value === "concise" ? value : "academic";
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
