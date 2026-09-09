/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { parseHomeProjectTitle } from "./homeProjectTitle";
import type { BibTeXEntry } from "./citation";
import { findLatexOpaqueEnvironmentEnd } from "./latexScanner";
import { scanMathPreviewDocument, visitMathPreviewSource } from "./mathPreview";
import type { VisualFormulaAsset } from "./visualFormula";

const MAX_VISUAL_STRUCTURE_RECORDS = 4_000;
const MAX_VISUAL_HEADING_COUNTER = 1_000_000;
const MAX_BIBLIOGRAPHY_PREVIEW_ENTRIES = 120;

export interface VisualSourceText {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly markers?: readonly string[];
  readonly segments?: readonly VisualInlineContentSegment[];
  readonly navigationId?: string;
  readonly definition?: { readonly from: number; readonly to: number; readonly navigationId?: string };
}

export interface VisualFrontMatterSection {
  readonly role: "abstract" | "keywords" | "classification";
  readonly label: string;
  readonly source: VisualSourceText;
}

export interface VisualReplacementRange {
  readonly from: number;
  readonly to: number;
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly block: boolean;
}

export interface VisualPreambleRecord {
  readonly kind: "preamble";
  readonly from: number;
  readonly to: number;
  readonly bodyFrom: number;
}

export interface VisualMakeTitleRecord {
  readonly kind: "maketitle";
  readonly metadataReplacements?: readonly VisualReplacementRange[];
  readonly replacement: VisualReplacementRange;
  readonly title: VisualSourceText | undefined;
  readonly authors: readonly VisualSourceText[];
  readonly affiliations: readonly VisualSourceText[];
  readonly emails: readonly VisualSourceText[];
  readonly date: VisualSourceText | undefined;
  readonly frontMatter?: {
    readonly replacement: VisualReplacementRange;
    /** Other verified fields; intervening source remains visible. */
    readonly replacements?: readonly VisualReplacementRange[];
    readonly sections: readonly VisualFrontMatterSection[];
  };
}

export type VisualHeadingLevel =
  | "part"
  | "chapter"
  | "section"
  | "subsection"
  | "subsubsection"
  | "paragraph"
  | "subparagraph";

export interface VisualHeadingRecord {
  readonly kind: "heading";
  readonly command: VisualHeadingLevel;
  readonly level: number;
  readonly starred: boolean;
  readonly number: string | undefined;
  readonly from: number;
  readonly to: number;
  readonly prefixFrom: number;
  readonly prefixTo: number;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly suffixFrom: number;
  readonly suffixTo: number;
  readonly title: string;
  /** A standard zero-argument command supplies this title instead of a source argument. */
  readonly generatedTitle?: boolean;
  /** The optional short title written to the ToC, or the visible title when omitted. */
  readonly tocTitle: string;
}

export interface VisualTableOfContentsEntry {
  readonly id: string;
  readonly command: VisualHeadingLevel;
  readonly level: number;
  readonly number?: string;
  readonly title: string;
}

/**
 * Why a source-derived table of contents cannot exactly mirror the compiled
 * `.toc` artifact.  These values are safe to serialize to the Webview; source
 * paths, offsets, and project diagnostics remain host-only.
 */
export type VisualTableOfContentsNotice =
  | "projectGraph"
  | "conditionalHeadings"
  | "sourceLimit"
  | "includeOnly"
  | "manualContents"
  | "tocDepth"
  | "counterControl"
  | "frontMatter"
  | "mainMatter"
  | "backMatter"
  | "appendix";

/** A local \tableofcontents placeholder enriched with project entries by the host. */
export interface VisualTableOfContentsRecord {
  readonly kind: "tableOfContents";
  readonly replacement: VisualReplacementRange;
  readonly language: VisualDocumentLanguage;
  /** The Beamer scope requested by the command's optional arguments. */
  readonly scope: "all" | "currentSection" | "currentSubsection";
  /** True when the command lives in a preamble-defined frame template. */
  readonly template: boolean;
  readonly entries: readonly VisualTableOfContentsEntry[];
  /** True only when verified entries may be missing or extra. */
  readonly incomplete: boolean;
  /** True when entries are usable but source-only numbering may differ. */
  readonly numberingApproximate: boolean;
  /** Exact, bounded reasons for incomplete content or approximate numbering. */
  readonly notices: readonly VisualTableOfContentsNotice[];
}

export type VisualTheoremStyle = "plain" | "definition" | "remark" | "proof";
export type VisualDocumentLanguage = "en" | "zh";

/**
 * Describe how one physical source file participates in the active LaTeX
 * project. A body fragment is scanned as document content even though it does
 * not contain its own `\\begin{document}`; a preamble fragment keeps
 * presentation-only body constructs inactive. The default remains the
 * existing standalone-document behaviour.
 */
export type VisualDocumentFragmentKind = "standalone" | "body" | "preamble";

export interface VisualDocumentStructureScanOptions {
  readonly compatibilityMode?: "basic" | "maximum";
  readonly fragmentKind?: VisualDocumentFragmentKind;
  readonly documentLanguage?: VisualDocumentLanguage;
  readonly numberingRootLevel?: VisualHeadingLevel;
  /**
   * Body fragments do not know the counters at their include occurrence unless
   * a project execution seed or fresh build artifact exists. Consumers can
   * request unknown numbering so the UI keeps structure without inventing a
   * fresh chapter/theorem sequence for every physical file.
   */
  readonly numberingMode?: "local" | "unknown";
  /** Appendix package state inherited by an included body fragment. */
  readonly appendicesEnabled?: boolean;
}

export interface VisualLabelRecord {
  readonly kind: "label";
  readonly from: number;
  readonly to: number;
  readonly key: string;
  readonly replacement: VisualReplacementRange;
}

export interface VisualLabelTarget {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly keyFrom: number;
  readonly keyTo: number;
}

export interface VisualTheoremRecord {
  readonly kind: "theorem";
  readonly environment: string;
  readonly label: string;
  readonly style: VisualTheoremStyle;
  readonly number: string | undefined;
  readonly optionalTitle: string | undefined;
  /** Exact optional-title source retained for reference-number resolution. */
  readonly optionalTitleLatex: string | undefined;
  readonly optionalTitleSegments?: readonly VisualInlineContentSegment[];
  readonly labels: readonly VisualLabelRecord[];
  readonly begin: VisualReplacementRange;
  readonly end: VisualReplacementRange;
  readonly bodyFrom: number;
  readonly bodyTo: number;
}

export interface VisualFrameRecord {
  readonly kind: "frame";
  /** Whether the slide uses a frame environment or Beamer's command shorthand. */
  readonly syntax: "environment" | "command";
  readonly language: VisualDocumentLanguage;
  readonly title: string | undefined;
  readonly subtitle: string | undefined;
  readonly begin: VisualReplacementRange;
  readonly end: VisualReplacementRange;
  readonly titleCommands: readonly VisualReplacementRange[];
  readonly bodyFrom: number;
  readonly bodyTo: number;
}

export type VisualAbstractRole = "abstract" | "keywords";

/** A document abstract or keyword environment whose body remains directly editable. */
export interface VisualAbstractRecord {
  readonly kind: "abstract";
  readonly environment: string;
  readonly language: VisualDocumentLanguage;
  readonly role: VisualAbstractRole;
  readonly label: string;
  readonly begin: VisualReplacementRange;
  readonly end: VisualReplacementRange;
  readonly bodyFrom: number;
  readonly bodyTo: number;
}

export type VisualKeywordsRole = "keywords" | "classification";

/** Compact preview for command/line based keywords and subject classifications. */
export interface VisualKeywordsRecord {
  readonly kind: "keywords";
  readonly language: VisualDocumentLanguage;
  readonly role: VisualKeywordsRole;
  readonly label: string;
  readonly value: string;
  readonly replacement: VisualReplacementRange;
}

export interface VisualListItemRecord {
  readonly from: number;
  readonly to: number;
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly label: string;
  readonly ordinal: number;
  readonly marker: string;
}

export type VisualListKind = "itemize" | "enumerate" | "description";

export interface VisualListRecord {
  readonly kind: "list";
  readonly environment: string;
  readonly listKind: VisualListKind;
  readonly labelTemplate: string | undefined;
  readonly begin: VisualReplacementRange;
  readonly end: VisualReplacementRange;
  readonly items: readonly VisualListItemRecord[];
}

export interface VisualCitationRecord {
  readonly kind: "citation";
  readonly from: number;
  readonly to: number;
  readonly command: string;
  /**
   * Plain-text forms of the citation command's optional arguments, in source
   * order. Empty entries are retained because `[prenote][]` and `[postnote]`
   * have different citation semantics even though only one note is visible.
   */
  readonly optionalArguments: readonly string[];
  readonly keys: readonly string[];
  readonly label: string;
  /** Resolved, serializable bibliography metadata used by the hover card. */
  readonly previews: readonly VisualCitationPreview[];
}

export interface VisualReferenceRecord {
  readonly resolvedLabels?: Readonly<Record<string, string>>;
  readonly kind: "reference";
  readonly from: number;
  readonly to: number;
  readonly command: string;
  readonly keys: readonly string[];
  readonly label: string;
}

export interface VisualMathFragment {
  readonly tex: string;
  readonly fallback: string;
  /** Exact absolute UTF-16 source range used to choose the macro timeline. */
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly asset?: VisualFormulaAsset;
  readonly previewStatus?: VisualLocalPreviewStatus;
}

export type VisualInlineContentSegment =
  | {
      readonly kind: "text";
      readonly text: string;
    }
  | {
      readonly kind: "math";
      readonly math: VisualMathFragment;
    }
  | { readonly kind: "citation"; readonly citation: VisualCitationRecord }
  | { readonly kind: "reference"; readonly reference: VisualReferenceRecord };

export interface VisualTableCell {
  /** Exact bounded LaTeX source retained for safe visual round-tripping. */
  readonly source: string;
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly text: string;
  readonly math: VisualMathFragment | undefined;
  /** Ordered text/math fragments for cells that mix prose with inline math. */
  readonly segments: readonly VisualInlineContentSegment[];
}

export interface VisualTableRecord {
  readonly kind: "table";
  /** Inner data environment (`tabular`, `tabularx`, `longtable`, ...). */
  readonly environment: string;
  /** Optional outer float wrapper. Longtable deliberately has no wrapper. */
  readonly containerEnvironment: "table" | "table*" | undefined;
  readonly position: string | undefined;
  readonly width: string | undefined;
  readonly tableAlignment: "left" | "center" | "right";
  readonly replacement: VisualReplacementRange;
  /** Source range containing only rows/cells, excluding begin/end commands. */
  readonly bodyFrom: number;
  readonly bodyTo: number;
  /** Exact column-spec content range, for example the `ccc` inside `{ccc}`. */
  readonly columnSpecFrom: number;
  readonly columnSpecTo: number;
  readonly columnSpec: string;
  readonly columnAlignments: readonly ("left" | "center" | "right" | "flex")[];
  readonly caption: string | undefined;
  readonly captionLatex: string | undefined;
  readonly captionSegments: readonly VisualInlineContentSegment[];
  readonly label: VisualLabelRecord | undefined;
  readonly rows: readonly (readonly VisualTableCell[])[];
  readonly columnCount: number;
  readonly ruleStyle: "booktabs" | "hline" | "none";
  readonly longtableRepeatHeader: boolean;
  readonly visualEditable: boolean;
  readonly visualEditReason: string | undefined;
  readonly truncated: boolean;
}

export interface VisualTikzcdNode {
  readonly row: number;
  readonly column: number;
  readonly math: VisualMathFragment;
}

export interface VisualTikzcdArrow {
  readonly fromRow: number;
  readonly fromColumn: number;
  readonly toRow: number;
  readonly toColumn: number;
  readonly label: VisualMathFragment | undefined;
  readonly swap: boolean;
  /** Kept separately so line, bend, and arrow-head styles remain composable. */
  readonly lineStyle: "solid" | "dashed" | "dotted";
  /** Backward-compatible convenience flag for existing preview consumers. */
  readonly dashed: boolean;
  readonly bend: "left" | "right" | undefined;
  readonly bendAmount: number | undefined;
  readonly head: "normal" | "none" | "twoHeads" | "hook";
}

export interface VisualTikzcdRecord {
  readonly kind: "tikzcd";
  readonly replacement: VisualReplacementRange;
  /** Exact environment source used by the restricted local TeX renderer. */
  readonly tex: string;
  /** Exact source range between the tikzcd begin options and end command. */
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly nodes: readonly VisualTikzcdNode[];
  readonly arrows: readonly VisualTikzcdArrow[];
  readonly rowCount: number;
  readonly columnCount: number;
  /** Exact optional argument on \begin{tikzcd}. */
  readonly environmentOptions: string | undefined;
  readonly visualEditable: boolean;
  readonly visualEditReason: string | undefined;
  readonly simplifiedOptions: readonly string[];
  readonly truncated: boolean;
  /** Exact local-TeX rendering; the standard geometric preview remains available. */
  readonly asset?: VisualFormulaAsset;
  readonly previewStatus?: VisualLocalPreviewStatus;
}

export type VisualLocalPreviewStatus = { readonly state: "modeRequired" | "pending" | "error"; readonly message: string };

export interface VisualFigureRecord {
  readonly kind: "figure";
  readonly replacement: VisualReplacementRange;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly tex: string;
  readonly caption: string | undefined;
  readonly captionSegments: readonly VisualInlineContentSegment[];
  readonly label: VisualLabelRecord | undefined;
  readonly asset?: VisualFormulaAsset;
  readonly previewStatus?: VisualLocalPreviewStatus;
}

export interface VisualTikzpictureRecord {
  readonly kind: "tikzpicture";
  readonly replacement: VisualReplacementRange;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  /** Exact environment source submitted to the restricted local renderer. */
  readonly tex: string;
  readonly asset?: VisualFormulaAsset;
  readonly previewStatus?: VisualLocalPreviewStatus;
}

export interface VisualImageRecord {
  readonly kind: "image";
  readonly replacement: VisualReplacementRange;
  readonly path: string;
  readonly caption: string | undefined;
  readonly captionSegments?: readonly VisualInlineContentSegment[];
  readonly label: VisualLabelRecord | undefined;
  readonly previewUri: string | undefined;
}

export interface VisualBibliographyEntry {
  readonly key: string;
  readonly title: string;
  readonly authors: string;
  readonly year: string;
  readonly container: string;
  readonly entryType: string;
  /** Present only for entries physically defined in the current TeX source. */
  readonly sourceFrom?: number;
  readonly sourceTo?: number;
}

/** The same bibliography fields shown by native/visual citation completion. */
export interface VisualCitationPreview extends VisualBibliographyEntry {
  readonly source: string;
  /** Display-only title fragments use the citation's range for macro scope. */
  readonly titleSegments?: readonly VisualInlineContentSegment[];
}

export type VisualBibliographySettingKind =
  | "resource"
  | "style"
  | "citationStyle"
  | "backend"
  | "sorting"
  | "toc"
  | "title"
  | "heading"
  | "filter"
  | "scope"
  | "inclusion"
  | "widestLabel"
  | "option";

/** A bounded, display-only summary of one BibTeX/BibLaTeX source setting. */
export interface VisualBibliographySetting {
  readonly kind: VisualBibliographySettingKind;
  /** Stable option/command name, for example `style`, `keyword`, or `nocite`. */
  readonly name: string;
  readonly value: string;
  readonly sourceFrom: number;
  readonly sourceTo: number;
}

export interface VisualBibliographyRecord {
  readonly kind: "bibliography";
  readonly language: VisualDocumentLanguage;
  readonly replacement: VisualReplacementRange;
  readonly requestedPaths: readonly string[];
  readonly settings: readonly VisualBibliographySetting[];
  readonly entries: readonly VisualBibliographyEntry[];
  readonly totalEntries: number;
  readonly manual: boolean;
}

export interface VisualCommentRecord {
  readonly kind: "comment";
  readonly replacement: VisualReplacementRange;
}

export interface VisualDocumentEndRecord {
  readonly kind: "documentEnd";
  readonly language: VisualDocumentLanguage;
  readonly replacement: VisualReplacementRange;
}

export interface VisualFootnoteRecord {
  readonly kind: "footnote";
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly number: string | undefined;
  /** Exact editable body with the same rich inline segments as captions. */
  readonly source: VisualSourceText;
}

export interface VisualTextStyleRecord {
  readonly kind: "textStyle";
  readonly command: string;
  readonly from: number;
  readonly to: number;
  readonly prefixFrom: number;
  readonly prefixTo: number;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly suffixFrom: number;
  readonly suffixTo: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly smallCaps: boolean;
  readonly foreground: string | undefined;
  readonly background: string | undefined;
  readonly border: string | undefined;
  /** Relative to the editor body font; finite, bounded presentation sizes only. */
  readonly fontSize?: number;
  readonly lineHeight?: number;
  /**
   * A presentation wrapper whose TeX syntax stays hidden while editing its
   * body. An explicit edit affordance lets users reveal the delimiters, so
   * users can still reveal both delimiters in place.
   */
  readonly transparent?: boolean;
  readonly editLabel?: string;
}

/** A text-mode TeX accent or named text symbol rendered as Unicode text. */
export interface VisualAccentRecord {
  readonly kind: "accent";
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export type VisualStructureRecord =
  | VisualPreambleRecord
  | VisualMakeTitleRecord
  | VisualHeadingRecord
  | VisualTableOfContentsRecord
  | VisualFrameRecord
  | VisualAbstractRecord
  | VisualKeywordsRecord
  | VisualTheoremRecord
  | VisualListRecord
  | VisualLabelRecord
  | VisualReferenceRecord
  | VisualTableRecord
  | VisualTikzcdRecord
  | VisualTikzpictureRecord
  | VisualFigureRecord
  | VisualImageRecord
  | VisualCitationRecord
  | VisualBibliographyRecord
  | VisualTextStyleRecord
  | VisualFootnoteRecord
  | VisualAccentRecord
  | VisualDocumentEndRecord
  | VisualCommentRecord;

export interface VisualAppendixTransition {
  readonly from: number;
  readonly kind: "appendix" | "enter" | "exit";
}

export interface VisualHeadingCounterMutation {
  readonly from: number;
  readonly to: number;
  readonly kind: "set" | "add" | "step";
  readonly counter: VisualHeadingLevel;
  readonly value: number;
}

export type VisualHeadingNumberingTransition = VisualAppendixTransition | VisualHeadingCounterMutation;

export interface VisualDocumentStructure {
  readonly records: readonly VisualStructureRecord[];
  /** Executable standard appendix switches, replayed in project include order. */
  readonly appendixOffsets?: readonly number[];
  readonly appendixTransitions?: readonly VisualAppendixTransition[];
  /** Literal executable assignments, including preamble assignments, in source order. */
  readonly headingCounterMutations?: readonly VisualHeadingCounterMutation[];
  readonly headingCountersAmbiguous?: boolean;
  readonly appendicesEnabled?: boolean;
  readonly bibliographyPaths: readonly string[];
  /** True when an executable bibliography resource command was parsed, even if its path is unsafe. */
  readonly hasBibliographyDeclaration: boolean;
  readonly citedKeys: readonly string[];
}

interface ParsedControl {
  readonly name: string;
  readonly end: number;
}

interface ParsedArgument {
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly end: number;
}

interface TheoremDefinition {
  readonly requiredHeading?: boolean;
  readonly staticBox?: boolean;
  readonly optionalHeading?: boolean;
  readonly label: string;
  readonly style: VisualTheoremStyle;
  readonly numbered?: boolean;
  readonly counter?: string;
  readonly within?: string;
}

interface OpenTheorem {
  readonly kind: "theorem";
  readonly environment: string;
  readonly definition: TheoremDefinition;
  readonly number: string | undefined;
  readonly optionalTitle: string | undefined;
  readonly optionalTitleLatex: string | undefined;
  readonly optionalTitleSegments?: readonly VisualInlineContentSegment[];
  readonly labels: VisualLabelRecord[];
  readonly begin: VisualReplacementRange;
  readonly bodyFrom: number;
}

interface OpenFrame {
  readonly kind: "frame";
  readonly environment: "frame";
  readonly syntax: "environment" | "command";
  readonly language: VisualDocumentLanguage;
  title: string | undefined;
  subtitle: string | undefined;
  readonly begin: VisualReplacementRange;
  readonly titleCommands: VisualReplacementRange[];
  readonly bodyFrom: number;
  /** Closing brace offsets are present only for `\\frame[...]{...}`. */
  readonly commandBodyTo?: number;
  readonly commandEnd?: number;
}

interface OpenAbstract {
  readonly kind: "abstract";
  readonly environment: string;
  readonly language: VisualDocumentLanguage;
  readonly role: VisualAbstractRole;
  readonly label: string;
  readonly begin: VisualReplacementRange;
  readonly bodyFrom: number;
}

interface MutableListItem {
  readonly from: number;
  readonly to: number;
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly label: string;
}

interface OpenList {
  readonly kind: "list";
  readonly environment: string;
  readonly listKind: VisualListKind;
  readonly labelTemplate: string | undefined;
  readonly begin: VisualReplacementRange;
  readonly items: MutableListItem[];
}

interface ManualBibliographyItem {
  readonly key: string;
  readonly commandFrom: number;
  readonly contentFrom: number;
}

interface OpenManualBibliography {
  readonly kind: "manualBibliography";
  readonly environment: "thebibliography";
  readonly begin: VisualReplacementRange;
  readonly settings: readonly VisualBibliographySetting[];
  readonly items: ManualBibliographyItem[];
}

type OpenEnvironment =
  | OpenTheorem
  | OpenFrame
  | OpenAbstract
  | OpenList
  | OpenManualBibliography;

const HEADING_LEVELS: Readonly<Record<VisualHeadingLevel, number>> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};
const HEADING_COMMANDS_BY_LEVEL = [
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
] as const satisfies readonly VisualHeadingLevel[];

interface VisualTheoremCounterState {
  value: number;
  withinNumber: string | undefined;
}

const LIST_ENVIRONMENTS = new Map<string, VisualListKind>([
  ["itemize", "itemize"],
  ["itemize*", "itemize"],
  ["compactitem", "itemize"],
  ["inparaitem", "itemize"],
  ["asparaitem", "itemize"],
  ["enumerate", "enumerate"],
  ["enumerate*", "enumerate"],
  ["compactenum", "enumerate"],
  ["inparaenum", "enumerate"],
  ["asparaenum", "enumerate"],
  ["description", "description"],
  ["description*", "description"],
  ["compactdesc", "description"],
  ["inparadesc", "description"],
  ["asparadesc", "description"],
]);
const ABSTRACT_ENVIRONMENTS = new Map<
  string,
  { readonly role: VisualAbstractRole; readonly en: string; readonly zh: string }
>([
  ["abstract", { role: "abstract", en: "Abstract", zh: "摘要" }],
  ["keywords", { role: "keywords", en: "Keywords", zh: "关键词" }],
  ["keyword", { role: "keywords", en: "Keywords", zh: "关键词" }],
  ["IEEEkeywords", { role: "keywords", en: "Index Terms", zh: "关键词" }],
]);
const KEYWORDS_COMMANDS = new Set(["keywords", "keyword", "kwd"]);
const CLASSIFICATION_COMMANDS = new Set([
  "subjclass",
  "classification",
  "msc",
  "MSC",
]);
const VERBATIM_ENVIRONMENTS = new Set([
  "verbatim",
  "verbatim*",
  "lstlisting",
  "minted",
  "Verbatim",
  "Verbatim*",
  "comment",
  "filecontents",
  "filecontents*",
]);
const MATH_ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "flalign",
  "flalign*",
  "displaymath",
  "math",
  "split",
  "aligned",
  "alignedat",
  "gathered",
  "array",
  "cases",
  "cases*",
  "dcases",
  "dcases*",
  "rcases",
  "rcases*",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
]);
const TRANSPARENT_VISUAL_ENVIRONMENTS = new Set(["subequations", "multicols", "columns", "column"]);
const TRANSPARENT_VISUAL_SIZE_DECLARATIONS = new Set([
  "fontsize", "color", "bfseries", "itshape", "slshape", "scshape",
  "noindent",
  "rm",
  "tiny",
  "scriptsize",
  "footnotesize",
  "small",
  "normalsize",
  "large",
  "Large",
  "LARGE",
  "huge",
  "Huge",
]);
const CITATION_COMMANDS = new Set([
  "cite",
  "Cite",
  "citep",
  "Citep",
  "citet",
  "Citet",
  "citealp",
  "citealt",
  "autocite",
  "Autocite",
  "parencite",
  "Parencite",
  "textcite",
  "Textcite",
  "footcite",
  "footcitetext",
  "smartcite",
  "supercite",
]);
const REFERENCE_COMMANDS = new Set([
  "ref",
  "pageref",
  "eqref",
  "autoref",
  "Autoref",
  "cref",
  "Cref",
  "cpageref",
  "Cpageref",
  "vref",
  "Vref",
  "nameref",
]);
const MAX_VISUAL_LABEL_KEY_LENGTH = 512;
const MAX_VISUAL_TABLE_ROWS = 120;
const MAX_VISUAL_TABLE_COLUMNS = 32;
const MAX_VISUAL_TABLE_CELL_LENGTH = 1_024;
const MAX_VISUAL_TIKZCD_ROWS = 16;
const MAX_VISUAL_TIKZCD_COLUMNS = 16;
const MAX_VISUAL_TIKZCD_ARROWS = 128;
const TABLE_ENVIRONMENTS = new Set([
  "table",
  "table*",
  "tabular",
  "tabular*",
  "tabularx",
  "longtable",
]);
const TITLE_AFFILIATION_COMMANDS = new Set([
  "affil",
  "affiliation",
  "address",
  "department",
  "institute",
  "institution",
  "IEEEauthorblockA",
]);
const TITLE_EMAIL_COMMANDS = new Set([
  "email",
  "emailAdd",
  "ead",
  "corremail",
]);

/**
 * Scan only presentation-level LaTeX constructs. This is intentionally
 * independent from Overleaf's AGPL implementation: it uses TeXLeaf's own
 * bounded UTF-16 scanner and emits serializable source ranges for CodeMirror.
 */
export function scanVisualDocumentStructure(
  text: string,
  options: VisualDocumentStructureScanOptions = {},
): VisualDocumentStructure {
  const records: VisualStructureRecord[] = [];
  // Share the formula scanner so declared aliases hide mathematical conditionals too.
  const formulaRanges = scanMathPreviewDocument(text).formulas.map(formula => formula.outerRange);
  let formulaIndex = 0;
  const bibliographyPaths: string[] = [];
  let hasBibliographyDeclaration = false;
  const bibliographySettings: VisualBibliographySetting[] = [];
  const citedKeys: string[] = [];
  const documentLanguage = options.documentLanguage ?? detectVisualDocumentLanguage(text);
  const theoremDefinitions = defaultTheoremDefinitions(documentLanguage);
  const numberingRootLevel = options.numberingRootLevel === undefined
    ? visualHeadingNumberingRootLevel(text)
    : HEADING_LEVELS[options.numberingRootLevel];
  const numberingKnown = options.numberingMode !== "unknown";
  const headingCounters = new Map<VisualHeadingLevel, number>();
  const headingNumbers = new Map<string, string>();
  const appendixOffsets: number[] = [];
  const appendixTransitions: VisualAppendixTransition[] = [];
  const headingCounterMutations: VisualHeadingCounterMutation[] = [];
  let headingCountersAmbiguous = false;
  let appendixState: VisualAppendixState = { active: false, appendixCounter: 0 };
  let appendicesEnabled = options.appendicesEnabled ?? false;
  let footnoteCounter = 0;
  const theoremCounters = new Map<string, VisualTheoremCounterState>();
  const stack: OpenEnvironment[] = [];
  let theoremStyle: VisualTheoremStyle = "plain";
  let preamble: VisualPreambleRecord | undefined;
  let title: VisualSourceText | undefined;
  let authors: readonly VisualSourceText[] = [];
  let affiliations: readonly VisualSourceText[] = [];
  let emails: readonly VisualSourceText[] = [];
  let date: VisualSourceText | undefined;
  const namedColors = new Map<string, string>();
  const textStyleCommands = new Map<string, string>();
  const styleScopes = new Map<number, {end: number} | undefined>();
  const globalStyleDefinitions = new Set<number>();
  const scopeStack: {end: number; globalColors: boolean}[] = [];
  let globalColors = false, globalPrefix = false;
  visitMathPreviewSource(text, (offset, name) => {
    if (name === "global") { globalPrefix = true; return; }
    if (["long", "outer", "protected"].includes(name)) return;
    if (name === "globalcolorstrue" || name === "globalcolorsfalse") {
      globalColors = name === "globalcolorstrue";
      if (globalPrefix) for (const scope of scopeStack) scope.globalColors = globalColors;
    }
    if (name === "definecolor" || name === "setbeamercolor" || isVisualLabelDefinitionCommand(name)) {
      styleScopes.set(offset, scopeStack.at(-1));
      if (globalPrefix || name === "gdef" || name === "xdef" || name === "definecolor" && globalColors) {
        globalStyleDefinitions.add(offset);
      }
    }
    globalPrefix = false;
  }, (event, offset) => {
    if (event === "enter") scopeStack.push({end: text.length, globalColors});
    else {
      const scope = scopeStack.pop();
      if (scope !== undefined) { scope.end = offset; globalColors = scope.globalColors; }
    }
  });
  const styleRestorations: {end: number; map: Map<string, string>; name: string; previous: string | undefined}[] = [];
  const setStyleDefinition = (map: Map<string, string>, name: string, value: string | undefined): void => {
    // Unknown/opaque scopes remain source instead of promoting their definitions.
    if (!styleScopes.has(index)) return;
    const scope = styleScopes.get(index);
    if (globalStyleDefinitions.has(index)) {
      // A global assignment also replaces values saved by surrounding groups.
      for (let i = styleRestorations.length - 1; i >= 0; i -= 1) {
        if (styleRestorations[i]!.map === map && styleRestorations[i]!.name === name) styleRestorations.splice(i, 1);
      }
    } else if (scope !== undefined) styleRestorations.push({end: scope.end, map, name, previous: map.get(name)});
    if (value === undefined) map.delete(name); else map.set(name, value);
  };
  const titleMacros = new Map<string, ParsedArgument>();
  const redefinedCommands = new Set<string>();
  const literalTextCommands = new Set<string>();
  const staticBoxCommands = new Map<string, {environment: string; label?: string | undefined}>();
  const frontMatterCommands: VisualReplacementRange[] = [];
  const preambleSections: VisualFrontMatterSection[] = [];
  let authblk = false;
  let jhep = false;
  let documentClass = "";
  let affiliationGroupFrom = 0;
  let hadAffiliation = false;
  let affiliationOrdinal = 0;
  // A root file can be conservatively labelled as a body fragment while the
  // project graph is still resolving. When that physical file has its own
  // document boundary, retain standalone semantics from the first byte: this
  // keeps preamble commands as source, while still collecting title metadata
  // for a later `\frame{\titlepage}`. A genuine included body file has no such
  // boundary and remains executable from offset zero.
  const bodyFragmentHasDocumentBoundary = options.fragmentKind === "body" &&
    hasExplicitVisualDocumentStart(text);
  let inDocument = options.fragmentKind === "body" && !bodyFragmentHasDocumentBoundary;
  let index = 0;
  // Some presentation commands contain a visible TeX branch followed by a
  // non-visual fallback branch. Keep scanning the visible branch so nested
  // accents/references remain interactive, then jump over the hidden branch.
  const scanJumps = new Map<number, number>();

  const preserveTheoremCountersAfterAppendices = (): void => {
    // setcounter in appendix.sty does not step/reset descendant theorem counters.
    for (const [environment, definition] of theoremDefinitions) {
      const state = theoremCounters.get(definition.counter ?? environment);
      if (state !== undefined && definition.within !== undefined) {
        state.withinNumber = headingNumbers.get(definition.within) ?? "0";
      }
    }
  };

  const pushRecord = (record: VisualStructureRecord): void => {
    if (records.length < MAX_VISUAL_STRUCTURE_RECORDS) {
      records.push(record);
    }
  };

  while (index < text.length) {
    while (styleRestorations.length > 0 && styleRestorations.at(-1)!.end <= index) {
      const {map, name, previous} = styleRestorations.pop()!;
      if (previous === undefined) map.delete(name); else map.set(name, previous);
    }
    while (formulaIndex < formulaRanges.length && formulaRanges[formulaIndex]!.end <= index) formulaIndex += 1;
    const formulaRange = formulaRanges[formulaIndex];
    if (formulaRange !== undefined && index >= formulaRange.start && index < formulaRange.end) {
      index = formulaRange.end;
      continue;
    }
    const closingCommandFrameIndex = findClosingCommandFrame(stack, index);
    if (closingCommandFrameIndex >= 0) {
      const open = stack.splice(closingCommandFrameIndex, 1)[0];
      if (
        open?.kind === "frame" &&
        open.syntax === "command" &&
        open.commandBodyTo !== undefined &&
        open.commandEnd !== undefined
      ) {
        const end = commandFrameBoundaryReplacement(
          text,
          open.commandBodyTo,
          open.commandEnd,
          "end",
        );
        pushRecord({
          kind: "frame",
          syntax: "command",
          language: open.language,
          title: open.title,
          subtitle: open.subtitle,
          begin: open.begin,
          end: { ...end, block: true },
          titleCommands: open.titleCommands,
          bodyFrom: open.bodyFrom,
          bodyTo: open.commandBodyTo,
        });
        index = Math.max(index, open.commandEnd);
        continue;
      }
    }
    const scanJump = scanJumps.get(index);
    if (scanJump !== undefined && scanJump > index) {
      index = scanJump;
      continue;
    }
    const character = text[index];
    if (character === "%" && !isEscapedAt(text, index)) {
      index = skipComment(text, index);
      continue;
    }
    if (character === "$" && !isEscapedAt(text, index)) {
      index = skipDollarMath(text, index);
      continue;
    }
    if (character !== "\\") {
      index += 1;
      continue;
    }

    const control = readControl(text, index);
    if (control === undefined) {
      index += 1;
      continue;
    }
    if (control.name === "verb" || control.name === "verb*") {
      index = skipVerb(text, control.end);
      continue;
    }
    if (control.name === "newif") {
      index = skipVisualNewIfDeclaration(text, control.end, text.length) ?? control.end;
      continue;
    }
    const structuralFunctionalConditionalArguments =
      visualFunctionalConditionalArgumentCount(control.name);
    if (structuralFunctionalConditionalArguments !== undefined) {
      const conditionalEnd = skipVisualFunctionalConditional(
        text,
        control.end,
        text.length,
        structuralFunctionalConditionalArguments,
      ) ?? text.length;
      headingCountersAmbiguous ||= visualConditionalMayChangeHeadingCounters(text, control.end, conditionalEnd, literalTextCommands);
      index = conditionalEnd;
      continue;
    }
    if (isVisualLabelConditionalControl(control.name)) {
      const conditionalEnd = skipLiteralFalseConditional(text, control.end, text.length);
      headingCountersAmbiguous ||= visualConditionalMayChangeHeadingCounters(text, control.end, conditionalEnd, literalTextCommands);
      index = conditionalEnd;
      continue;
    }
    if (control.name === "(" || control.name === "[") {
      index = skipControlMath(text, control.end, control.name === "(" ? ")" : "]");
      continue;
    }

    if (control.name === "begin") {
      const environmentArgument = readRequiredArgument(text, control.end);
      if (environmentArgument === undefined) {
        index = control.end;
        continue;
      }
      const environment = text
        .slice(environmentArgument.contentFrom, environmentArgument.contentTo)
        .trim();
      let commandEnd = environmentArgument.end;

      if (environment === "document") {
        const replacement = lineAwareReplacement(text, index, commandEnd);
        // A project role can be temporarily conservative while the root graph
        // is being resolved, so a physical standalone file may arrive as a
        // `body` fragment. If it contains a real document boundary, discard
        // every presentation record tentatively scanned before that boundary.
        // Preamble metadata and macro/theorem declarations remain available,
        // but preamble frame/ToC/list/formula-like source never becomes cards.
        records.length = 0;
        citedKeys.length = 0;
        stack.length = 0;
        // Literal preamble counter assignments survive \\begin{document} in TeX.
        appendixOffsets.length = 0;
        appendixTransitions.length = 0;
        appendixState = { active: false, appendixCounter: 0 };
        footnoteCounter = 0;
        theoremCounters.clear();
        preamble = {
          kind: "preamble",
          from: 0,
          to: replacement.to,
          bodyFrom: replacement.to,
        };
        inDocument = true;
        index = commandEnd;
        continue;
      }

      // The preamble is configuration source, including callbacks such as
      // `\AtBeginSection{...}` that merely contain frame-looking templates.
      // Do not create nested structure cards until the executable document
      // body has started.
      if (!inDocument) {
        index = commandEnd;
        continue;
      }

      if (environment === "appendices" && appendicesEnabled && !redefinedCommands.has(environment)) {
        appendixTransitions.push({ from: index, kind: "enter" });
        applyVisualAppendixTransition(appendixState, "enter", headingCounters, headingNumbers, numberingRootLevel);
        preserveTheoremCountersAfterAppendices();
        pushRecord({ kind: "accent", from: index, to: commandEnd, text: "" });
        index = commandEnd;
        continue;
      }

      const abstractMetadata = ABSTRACT_ENVIRONMENTS.get(environment);
      if (abstractMetadata !== undefined) {
        const begin = { ...lineAwareReplacement(text, index, commandEnd), block: true };
        stack.push({
          kind: "abstract",
          environment,
          language: documentLanguage,
          role: abstractMetadata.role,
          label: documentLanguage === "zh" ? abstractMetadata.zh : abstractMetadata.en,
          begin,
          bodyFrom: begin.to,
        });
        index = commandEnd;
        continue;
      }

      if (environment === "frame") {
        const options = readOptionalArgument(text, commandEnd);
        commandEnd = options?.end ?? commandEnd;
        const titleArgument = readRequiredArgument(text, commandEnd);
        if (titleArgument !== undefined) {
          commandEnd = titleArgument.end;
        }
        const subtitleArgument = readRequiredArgument(text, commandEnd);
        if (subtitleArgument !== undefined) {
          commandEnd = subtitleArgument.end;
        }
        const begin = lineAwareReplacement(text, index, commandEnd);
        stack.push({
          kind: "frame",
          environment: "frame",
          syntax: "environment",
          language: documentLanguage,
          title: titleArgument === undefined
            ? undefined
            : latexToPlainText(
                text.slice(titleArgument.contentFrom, titleArgument.contentTo),
              ),
          subtitle: subtitleArgument === undefined
            ? undefined
            : latexToPlainText(
                text.slice(subtitleArgument.contentFrom, subtitleArgument.contentTo),
              ),
          begin,
          titleCommands: [],
          bodyFrom: begin.to,
        });
        index = commandEnd;
        continue;
      }

      if (environment === "tikzcd") {
        const diagram = parseVisualTikzcdEnvironment(
          text,
          index,
          commandEnd,
        );
        if (diagram !== undefined) {
          pushRecord(diagram);
          index = diagram.replacement.sourceTo;
          continue;
        }
      }

      if (environment === "tikzpicture") {
        const picture = parseVisualTikzpictureEnvironment(
          text,
          index,
          commandEnd,
        );
        if (picture !== undefined) {
          pushRecord(picture);
          index = picture.replacement.sourceTo;
          continue;
        }
      }

      if (TABLE_ENVIRONMENTS.has(environment)) {
        const table = parseVisualTableEnvironment(
          text,
          index,
          commandEnd,
          environment,
        );
        if (table !== undefined) {
          pushRecord(table);
          index = table.replacement.sourceTo;
          continue;
        }
      }

      if (environment === "figure" || environment === "figure*") {
        const whole = parseVisualFigureEnvironment(text, index, commandEnd, environment);
        if (whole !== undefined) {
          pushRecord(whole);
          index = whole.replacement.sourceTo;
          continue;
        }
        const image = parseVisualImageEnvironment(
          text,
          index,
          commandEnd,
          environment,
        );
        if (image !== undefined) {
          pushRecord(image);
          index = image.replacement.sourceTo;
          continue;
        }
      }

      if (VERBATIM_ENVIRONMENTS.has(environment)) {
        const end = skipOpaqueEnvironment(text, commandEnd, environment);
        if (environment === "comment") {
          pushRecord({ kind: "comment", replacement: lineAwareReplacement(text, index, end) });
        }
        index = end;
        continue;
      }
      if (TRANSPARENT_VISUAL_ENVIRONMENTS.has(environment)) {
        const wrapper = parseVisualTransparentEnvironment(
          text,
          index,
          commandEnd,
          environment,
        );
        if (wrapper !== undefined) {
          pushRecord(wrapper);
        }
        // Keep scanning the body so nested formulas, labels and references
        // remain independent visual records.
        index = wrapper?.contentFrom ?? commandEnd;
        continue;
      }
      if (MATH_ENVIRONMENTS.has(environment)) {
        index = skipEnvironment(text, commandEnd, environment);
        continue;
      }

      const theorem = theoremDefinitions.get(environment);
      if (theorem !== undefined) {
        const optional = theorem.requiredHeading ? readRequiredArgument(text, commandEnd) : readOptionalArgument(text, commandEnd);
        if (theorem.requiredHeading && optional === undefined) { index = commandEnd; continue; }
        const optionalTitleLatex = optional === undefined
          ? undefined
          : text.slice(optional.contentFrom, optional.contentTo);
        if (optional !== undefined) {
          commandEnd = optional.end;
        }
        const immediateLabels = readImmediateLabelsOnLine(text, commandEnd);
        const visualCommandEnd = immediateLabels.at(-1)?.to ?? commandEnd;
        const begin = lineAwareReplacement(text, index, visualCommandEnd);
        stack.push({
          kind: "theorem",
          environment,
          definition: (theorem.optionalHeading || theorem.requiredHeading) && optionalTitleLatex !== undefined
            ? { ...theorem, label: latexToPlainText(optionalTitleLatex) } : theorem,
          number: numberingKnown
            ? nextVisualTheoremNumber(
                environment,
                theorem,
                theoremCounters,
                headingNumbers,
              )
            : undefined,
          optionalTitle: optional === undefined || theorem.optionalHeading || theorem.requiredHeading
            ? undefined
            : latexToPlainText(optionalTitleLatex ?? ""),
          optionalTitleLatex: theorem.optionalHeading || theorem.requiredHeading ? undefined : optionalTitleLatex,
          optionalTitleSegments: optional === undefined || theorem.optionalHeading || theorem.requiredHeading ? []
            : visualInlineContentSegments(optionalTitleLatex ?? "", optional.contentFrom),
          labels: [...immediateLabels],
          begin,
          bodyFrom: begin.to,
        });
        index = visualCommandEnd;
        continue;
      }

      const listKind = LIST_ENVIRONMENTS.get(environment);
      if (listKind !== undefined) {
        const options = readOptionalArgument(text, commandEnd);
        if (options !== undefined) {
          commandEnd = options.end;
        }
        stack.push({
          kind: "list",
          environment,
          listKind,
          labelTemplate: listKind === "enumerate" && options !== undefined
            ? text.slice(options.contentFrom, options.contentTo).trim()
            : undefined,
          begin: lineAwareReplacement(text, index, commandEnd),
          items: [],
        });
        index = commandEnd;
        continue;
      }

      if (environment === "thebibliography") {
        const widthArgument = readRequiredArgument(text, commandEnd);
        if (widthArgument !== undefined) {
          commandEnd = widthArgument.end;
        }
        const localSettings = widthArgument === undefined
          ? bibliographySettings
          : [
              ...bibliographySettings,
              bibliographySetting(
                "widestLabel",
                "widest-label",
                text.slice(widthArgument.contentFrom, widthArgument.contentTo),
                index,
                commandEnd,
              ),
            ];
        const configurationFrom = bibliographyConfigurationStart(
          text,
          index,
          bibliographySettings,
        );
        stack.push({
          kind: "manualBibliography",
          environment,
          begin: lineAwareReplacement(text, configurationFrom, commandEnd),
          settings: uniqueVisualBibliographySettings(localSettings),
          items: [],
        });
        index = commandEnd;
        continue;
      }

      index = commandEnd;
      continue;
    }

    if (control.name === "end") {
      const environmentArgument = readRequiredArgument(text, control.end);
      if (environmentArgument === undefined) {
        index = control.end;
        continue;
      }
      const environment = text
        .slice(environmentArgument.contentFrom, environmentArgument.contentTo)
        .trim();
      const replacement = lineAwareReplacement(text, index, environmentArgument.end);
      if (environment === "document") {
        pushRecord({ kind: "documentEnd", language: documentLanguage, replacement });
        inDocument = false;
        index = environmentArgument.end;
        // The first executable document end terminates the physical job. Any
        // later table/TikZ/bibliography-looking text is inert source tail, not
        // presentation or a resource request.
        break;
      }

      if (environment === "appendices" && inDocument && appendicesEnabled && !redefinedCommands.has(environment)) {
        appendixTransitions.push({ from: index, kind: "exit" });
        applyVisualAppendixTransition(appendixState, "exit", headingCounters, headingNumbers, numberingRootLevel);
        preserveTheoremCountersAfterAppendices();
        pushRecord({ kind: "accent", from: index, to: environmentArgument.end, text: "" });
        index = environmentArgument.end;
        continue;
      }

      const openIndex = findOpenEnvironment(stack, environment);
      const open = openIndex < 0 ? undefined : stack.splice(openIndex, 1)[0];
      if (open?.kind === "theorem") {
        pushRecord({
          kind: "theorem",
          environment: open.environment,
          label: open.definition.label,
          style: open.definition.style,
          number: open.number,
          optionalTitle: open.optionalTitle,
          optionalTitleLatex: open.optionalTitleLatex,
          optionalTitleSegments: open.optionalTitleSegments ?? [],
          labels: open.labels,
          begin: open.begin,
          end: replacement,
          bodyFrom: open.bodyFrom,
          bodyTo: replacement.from,
        });
      } else if (open?.kind === "abstract") {
        pushRecord({
          kind: "abstract",
          environment: open.environment,
          language: open.language,
          role: open.role,
          label: open.label,
          begin: open.begin,
          end: replacement,
          bodyFrom: open.bodyFrom,
          bodyTo: replacement.from,
        });
      } else if (open?.kind === "frame") {
        pushRecord({
          kind: "frame",
          syntax: open.syntax,
          language: open.language,
          title: open.title,
          subtitle: open.subtitle,
          begin: open.begin,
          end: replacement,
          titleCommands: open.titleCommands,
          bodyFrom: open.bodyFrom,
          bodyTo: replacement.from,
        });
      } else if (open?.kind === "list") {
        pushRecord({
          kind: "list",
          environment: open.environment,
          listKind: open.listKind,
          labelTemplate: open.labelTemplate,
          begin: open.begin,
          end: replacement,
          items: open.items.map((item, ordinal) => {
            const itemOrdinal = ordinal + 1;
            return {
              ...item,
              ordinal: itemOrdinal,
              marker: visualListMarker(
                open.listKind,
                item.label,
                itemOrdinal,
                open.labelTemplate,
              ),
            };
          }),
        });
      } else if (open?.kind === "manualBibliography") {
        const manualEntries = manualBibliographyEntries(text, open, replacement.from);
        pushRecord({
          kind: "bibliography",
          replacement: {
            from: open.begin.from,
            to: replacement.to,
            sourceFrom: open.begin.sourceFrom,
            sourceTo: replacement.sourceTo,
            block: true,
          },
          requestedPaths: [],
          settings: open.settings,
          entries: manualEntries,
          totalEntries: manualEntries.length,
          manual: true,
          language: documentLanguage,
        });
      }
      index = environmentArgument.end;
      continue;
    }

    if (control.name === "theoremstyle") {
      const argument = readRequiredArgument(text, control.end);
      if (argument !== undefined) {
        theoremStyle = normalizeTheoremStyle(
          text.slice(argument.contentFrom, argument.contentTo).trim(),
        );
        index = argument.end;
        continue;
      }
    }

    if (control.name === "newenvironment" || control.name === "renewenvironment") {
      const parsed = parseTrivlistStatement(text, control.end) ?? parseStaticBoxEnvironment(text, control.end);
      if (parsed !== undefined) theoremDefinitions.set(parsed.environment, parsed.definition);
      else {
        const name = readRequiredArgument(text, control.end);
        const environment = name === undefined ? "" : text.slice(name.contentFrom, name.contentTo).trim();
        const previous = theoremDefinitions.get(environment);
        if (previous?.staticBox) theoremDefinitions.delete(environment);
      }
      // Command wrappers resolve their environment at use time below.
    }

    if (control.name === "newtheorem") {
      const parsed = parseNewTheorem(text, control.end, theoremStyle);
      if (parsed !== undefined) {
        const shared = parsed.definition.counter === parsed.environment
          ? undefined
          : theoremDefinitions.get(parsed.definition.counter ?? "");
        const within = parsed.definition.within ?? shared?.within;
        theoremDefinitions.set(parsed.environment, {
          ...parsed.definition,
          ...(within === undefined ? {} : { within }),
        });
        index = parsed.end;
        continue;
      }
    }

    if (!inDocument && control.name === "documentclass") {
      const optional = readOptionalArgument(text, control.end);
      const argument = readRequiredArgument(text, optional?.end ?? control.end);
      if (argument !== undefined) {
        documentClass = text.slice(argument.contentFrom, argument.contentTo).trim();
        index = argument.end;
        continue;
      }
    }

    if (!inDocument && control.name === "usepackage") {
      const optional = readOptionalArgument(text, control.end);
      const argument = readRequiredArgument(text, optional?.end ?? control.end);
      if (argument !== undefined) {
        const packages = text
          .slice(argument.contentFrom, argument.contentTo)
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value.length > 0);
        authblk ||= packages.includes("authblk");
        jhep ||= packages.includes("jheppub");
        appendicesEnabled ||= packages.includes("appendix");
        const bibliographyPackage = packages.includes("biblatex")
          ? "biblatex"
          : packages.includes("natbib")
          ? "natbib"
          : undefined;
        if (bibliographyPackage !== undefined) {
          bibliographySettings.push(bibliographySetting(
            "option",
            "package",
            bibliographyPackage,
            index,
            argument.end,
          ));
          if (optional !== undefined) {
            bibliographySettings.push(...bibliographySettingsFromOptions(
              text.slice(optional.contentFrom, optional.contentTo),
              index,
              argument.end,
              bibliographyPackage,
            ));
          }
        }
        index = argument.end;
        continue;
      }
    }

    if (control.name === "bibliographystyle") {
      const argument = readRequiredArgument(text, control.end);
      if (argument !== undefined) {
        bibliographySettings.push(bibliographySetting(
          "style",
          "bibliographystyle",
          text.slice(argument.contentFrom, argument.contentTo),
          index,
          argument.end,
        ));
        index = argument.end;
        continue;
      }
    }

    if (control.name === "ExecuteBibliographyOptions" || control.name === "setcitestyle") {
      const argument = readRequiredArgument(text, control.end);
      if (argument !== undefined) {
        bibliographySettings.push(...bibliographySettingsFromOptions(
          text.slice(argument.contentFrom, argument.contentTo),
          index,
          argument.end,
          control.name,
        ));
        index = argument.end;
        continue;
      }
    }

    if (control.name === "addcontentsline") {
      const target = readRequiredArgument(text, control.end);
      const level = target === undefined ? undefined : readRequiredArgument(text, target.end);
      const titleArgument = level === undefined ? undefined : readRequiredArgument(text, level.end);
      if (target !== undefined && level !== undefined && titleArgument !== undefined) {
        const targetName = text.slice(target.contentFrom, target.contentTo).trim();
        const levelName = text.slice(level.contentFrom, level.contentTo).trim();
        const titleLatex = text.slice(titleArgument.contentFrom, titleArgument.contentTo).trim();
        if (targetName === "toc" && bibliographyHeadingLooksRelevant(titleLatex)) {
          bibliographySettings.push(bibliographySetting(
            "toc",
            levelName || "toc",
            latexToPlainText(titleLatex) || titleLatex,
            index,
            titleArgument.end,
          ));
        }
        index = titleArgument.end;
        continue;
      }
    }

    if (
      control.name === "renewcommand" ||
      control.name === "providecommand" ||
      control.name === "newcommand"
    ) {
      const afterStar = text[control.end] === "*" ? control.end + 1 : control.end;
      const commandArgument = readRequiredArgument(text, afterStar);
      const valueArgument = commandArgument === undefined
        ? undefined
        : readRequiredArgument(text, commandArgument.end);
      if (commandArgument !== undefined && valueArgument !== undefined) {
        const commandName = text
          .slice(commandArgument.contentFrom, commandArgument.contentTo)
          .trim();
        if (commandName === "\\refname" || commandName === "\\bibname") {
          const valueLatex = text.slice(valueArgument.contentFrom, valueArgument.contentTo);
          bibliographySettings.push(bibliographySetting(
            "title",
            commandName.slice(1),
            latexToPlainText(valueLatex) || valueLatex,
            index,
            valueArgument.end,
          ));
          index = valueArgument.end;
          continue;
        }
      }
    }

    if (control.name === "setbeamercolor" && documentClass === "beamer") {
      const role = readRequiredArgument(text, control.end);
      const options = role === undefined ? undefined : readRequiredArgument(text, role.end);
      if (role !== undefined && options !== undefined && text.slice(role.contentFrom, role.contentTo).trim() === "alerted text") {
        const foreground = /^\s*fg\s*=\s*([^,{}]+)\s*$/u.exec(text.slice(options.contentFrom, options.contentTo));
        const color = foreground === null ? undefined : visualCssColor(foreground[1]!, undefined, namedColors);
        setStyleDefinition(namedColors, "beamer:alert", color);
        index = options.end;
        continue;
      }
    }

    if (control.name === "definecolor") {
      const name = readRequiredArgument(text, control.end);
      const model = name === undefined ? undefined : readRequiredArgument(text, name.end);
      const value = model === undefined ? undefined : readRequiredArgument(text, model.end);
      if (name !== undefined && model !== undefined && value !== undefined) {
        const key = text.slice(name.contentFrom, name.contentTo).trim();
        const color = visualCssColor(text.slice(value.contentFrom, value.contentTo), text.slice(model.contentFrom, model.contentTo));
        if (/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key)) setStyleDefinition(namedColors, key, color);
        index = value.end;
        continue;
      }
    }

    if (isVisualLabelDefinitionCommand(control.name)) {
      const staticBox = parseStaticBoxCommand(text, control, theoremDefinitions);
      if (staticBox !== undefined) staticBoxCommands.set(staticBox.name, staticBox);
      const textWrapper = parseStaticTextStyleCommand(text, control);
      const target = collectSimpleTitleMacro(text, control, titleMacros);
      if (target !== undefined) {
        if (control.name !== "providecommand" || !textStyleCommands.has(target)) {
          setStyleDefinition(textStyleCommands, target, textWrapper?.name === target ? textWrapper.group : "");
        }
        redefinedCommands.add(target);
        headingCountersAmbiguous ||= isHeadingLevel(target) ||
          target.startsWith("the") && isHeadingLevel(target.slice(3)) ||
          ["setcounter", "addtocounter", "stepcounter", "refstepcounter"].includes(target);
        if (staticBox?.name !== target) staticBoxCommands.delete(target);
        literalTextCommands.delete(target);
        if (isVisualDetokenizeWrapper(text, control)) literalTextCommands.add(target);
      }
      if (VISUAL_LABEL_NEW_ENVIRONMENT_DEFINITIONS.has(control.name) || VISUAL_LABEL_XPARSE_ENVIRONMENT_DEFINITIONS.has(control.name)) {
        const argument = readRequiredArgument(text, text[control.end] === "*" ? control.end + 1 : control.end);
        if (argument !== undefined) redefinedCommands.add(text.slice(argument.contentFrom, argument.contentTo).trim());
      }
      index = skipVisualLabelDefinition(text, control, text.length) ?? control.end;
      continue;
    }

    if (["setcounter", "addtocounter", "stepcounter", "refstepcounter"].includes(control.name)) {
      const argument = readRequiredArgument(text, control.end);
      const counter = argument === undefined ? "" : visualPreambleWithoutComments(text.slice(argument.contentFrom, argument.contentTo)).trim();
      if (isHeadingLevel(counter)) {
        const stepped = control.name === "stepcounter" || control.name === "refstepcounter";
        const valueArgument = stepped || argument === undefined ? undefined : readRequiredArgument(text, argument.end);
        const literal = stepped ? "1" : valueArgument === undefined ? "" : visualPreambleWithoutComments(text.slice(valueArgument.contentFrom, valueArgument.contentTo)).trim();
        const value = Number(literal);
        const end = valueArgument?.end ?? argument!.end;
        if (!redefinedCommands.has(control.name) && /^[+-]?\d+$/u.test(literal) && Number.isSafeInteger(value) &&
            Math.abs(value) <= MAX_VISUAL_HEADING_COUNTER && headingCounterMutations.length < MAX_VISUAL_STRUCTURE_RECORDS) {
          const mutation: VisualHeadingCounterMutation = { from: index, to: end, counter, value,
            kind: stepped ? "step" : control.name === "setcounter" ? "set" : "add" };
          headingCounterMutations.push(mutation);
          headingCountersAmbiguous ||= !applyVisualHeadingCounterMutation(mutation, headingCounters, headingNumbers, numberingRootLevel, appendixState.active);
          if (stepped && counter === "chapter") footnoteCounter = 0;
          if (!stepped) preserveTheoremCountersAfterAppendices();
          if (inDocument) pushRecord({ kind: "accent", from: index, to: end, text: "" });
        } else {
          headingCountersAmbiguous = true;
        }
        index = end;
        continue;
      }
    }
    if (["counterwithin", "counterwithout", "numberwithin", "@addtoreset", "@removefromreset"].includes(control.name)) {
      const argument = readRequiredArgument(text, text[control.end] === "*" ? control.end + 1 : control.end);
      if (argument !== undefined && isHeadingLevel(text.slice(argument.contentFrom, argument.contentTo).trim())) headingCountersAmbiguous = true;
    }
    if (control.name.startsWith("c@") && isHeadingLevel(control.name.slice(2))) headingCountersAmbiguous = true;

    const boxAlias = inDocument ? staticBoxCommands.get(control.name) : undefined;
    const boxCommand = boxAlias === undefined ? undefined : theoremDefinitions.get(boxAlias.environment);
    if (boxCommand?.staticBox) {
      const body = readRequiredArgument(text, control.end);
      if (body !== undefined) {
        pushRecord({ kind: "theorem", environment: control.name, label: boxAlias?.label ?? boxCommand.label,
          style: boxCommand.style, number: undefined, optionalTitle: undefined, optionalTitleLatex: undefined,
          labels: [], begin: lineAwareReplacement(text, index, body.contentFrom),
          end: lineAwareReplacement(text, body.contentTo, body.end), bodyFrom: body.contentFrom, bodyTo: body.contentTo });
        index = body.contentFrom;
        continue;
      }
    }

    if (inDocument && control.name === "ydiagram") {
      const diagram = parseVisualYoungDiagramSequence(text, index);
      if (diagram !== undefined) { pushRecord(diagram); index = diagram.replacement.sourceTo; continue; }
    }

    if (control.name === "nocite") {
      const argument = readRequiredArgument(text, control.end);
      if (argument !== undefined) {
        bibliographySettings.push(bibliographySetting(
          "inclusion",
          "nocite",
          text.slice(argument.contentFrom, argument.contentTo),
          index,
          argument.end,
        ));
        index = argument.end;
        continue;
      }
    }

    if (!inDocument && control.name === "addbibresource") {
      const optional = readOptionalArgument(text, control.end);
      const argument = readRequiredArgument(text, optional?.end ?? control.end);
      if (argument !== undefined) {
        hasBibliographyDeclaration = true;
        const paths = parseBibliographyPaths(
          text.slice(argument.contentFrom, argument.contentTo),
        );
        bibliographyPaths.push(...paths);
        bibliographySettings.push(...paths.map((path) => bibliographySetting(
          "resource",
          "addbibresource",
          path,
          index,
          argument.end,
        )));
        if (optional !== undefined) {
          bibliographySettings.push(...bibliographySettingsFromOptions(
            text.slice(optional.contentFrom, optional.contentTo),
            index,
            argument.end,
            "addbibresource",
          ));
        }
        index = argument.end;
        continue;
      }
    }

    // REVTeX front matter can follow \begin{document}; collect it in source
    // order so a later \maketitle receives the same metadata as other classes.
    if (control.name === "title" || control.name === "author" || control.name === "date") {
      const optional = readOptionalArgument(text, control.end);
      const argument = readRequiredArgument(text, optional?.end ?? control.end);
      if (argument !== undefined) {
        const source: VisualSourceText = {
          from: argument.contentFrom,
          to: argument.contentTo,
          text: latexToPlainText(text.slice(argument.contentFrom, argument.contentTo)),
          segments: visualInlineContentSegments(text.slice(argument.contentFrom, argument.contentTo), argument.contentFrom),
        };
        if (control.name === "title") {
          title = source;
        } else if (control.name === "date") {
          date = source;
        } else {
          if (hadAffiliation) {
            affiliationGroupFrom = authors.length;
            hadAffiliation = false;
          }
          const markers = (authblk || jhep) && optional !== undefined
            ? titleMarkerIds(text.slice(optional.contentFrom, optional.contentTo))
            : [];
          authors = [...authors, ...splitTitleMetadata(text, argument, markers)];
          emails = [
            ...emails,
            ...extractEmailMetadata(text, argument),
          ];
        }
        if (inDocument && !redefinedCommands.has(control.name) && canFoldTitleMetadata(
          text, argument, control.name === "author" ? undefined : titleMacros,
          control.name === "date" && !redefinedCommands.has("today"),
          control.name !== "date",
        )) frontMatterCommands.push(lineAwareReplacement(text, index, argument.end));
        // Body commands may be redefined as visible wrappers; still scan
        // their contents for nested styles and references.
        if (!inDocument) {
          index = argument.end;
          continue;
        }
      }
    }
    if (
      TITLE_AFFILIATION_COMMANDS.has(control.name) ||
      TITLE_EMAIL_COMMANDS.has(control.name)
    ) {
      const optional = readOptionalArgument(text, control.end);
      const argument = readRequiredArgument(text, optional?.end ?? control.end);
      if (argument !== undefined) {
        const markers = (authblk || jhep) && optional !== undefined
          ? titleMarkerIds(text.slice(optional.contentFrom, optional.contentTo))
          : [];
        let values = splitTitleMetadata(text, argument, markers);
        if (TITLE_AFFILIATION_COMMANDS.has(control.name)) {
          if (control.name === "affiliation" && optional === undefined &&
              (documentClass.startsWith("revtex") || documentClass.length === 0) &&
              authors.length > affiliationGroupFrom && values.length > 0) {
            const marker = String(++affiliationOrdinal);
            values = values.map(value => ({ ...value, markers: [marker] }));
            authors = authors.map((author, authorIndex) => authorIndex < affiliationGroupFrom
              ? author : { ...author, markers: [...(author.markers ?? []), marker] });
            hadAffiliation = true;
          }
          affiliations = [...affiliations, ...values];
        } else {
          emails = [...emails, ...values];
        }
        if (inDocument && !redefinedCommands.has(control.name) && canFoldTitleMetadata(text, argument, undefined, false, !TITLE_EMAIL_COMMANDS.has(control.name))) frontMatterCommands.push(lineAwareReplacement(text, index, argument.end));
        if (!inDocument) {
          index = argument.end;
          continue;
        }
      }
    }
    if (!inDocument && jhep && control.name === "abstract") {
      const argument = readRequiredArgument(text, control.end);
      if (argument !== undefined) {
        const source = frontMatterAbstractSource(text, argument.contentFrom, argument.contentTo);
        if (source !== undefined) preambleSections.push({ role: "abstract", label: documentLanguage === "zh" ? "摘要" : "Abstract", source });
        index = argument.end;
        continue;
      }
    }
    if (!inDocument && (documentClass === "amsart" || jhep)) {
      const keyword = parseVisualKeywordsCommand(text, index, control, documentLanguage);
      if (keyword !== undefined) {
        preambleSections.push(frontMatterKeywordSection(text, keyword));
        index = keyword.replacement.sourceTo;
        continue;
      }
    }
    if (!inDocument) {
      index = control.end;
      continue;
    }

    if (control.name === "frametitle" || control.name === "framesubtitle") {
      const openFrame = findLastOpenFrame(stack);
      const shortTitle = readOptionalArgument(text, control.end);
      const argument = readRequiredArgument(text, shortTitle?.end ?? control.end);
      if (openFrame !== undefined && argument !== undefined) {
        const value = latexToPlainText(
          text.slice(argument.contentFrom, argument.contentTo),
        );
        if (control.name === "frametitle") {
          openFrame.title = value;
        } else {
          openFrame.subtitle = value;
        }
        openFrame.titleCommands.push(
          lineAwareReplacement(text, index, argument.end),
        );
        index = argument.end;
        continue;
      }
    }

    if (control.name === "tableofcontents") {
      const optional = readOptionalArgument(text, control.end);
      pushRecord({
        kind: "tableOfContents",
        replacement: lineAwareReplacement(text, index, optional?.end ?? control.end),
        language: documentLanguage,
        scope: visualTableOfContentsScope(
          optional === undefined
            ? ""
            : text.slice(optional.contentFrom, optional.contentTo),
        ),
        template: false,
        entries: [],
        incomplete: false,
        numberingApproximate: false,
        notices: [],
      });
      index = optional?.end ?? control.end;
      continue;
    }

    const keywordLine = parseVisualKeywordLine(text, index, documentLanguage);
    if (keywordLine !== undefined) {
      pushRecord(keywordLine);
      index = keywordLine.replacement.sourceTo;
      continue;
    }

    const keywordCommand = parseVisualKeywordsCommand(
      text,
      index,
      control,
      documentLanguage,
    );
    if (keywordCommand !== undefined) {
      pushRecord(keywordCommand);
      index = keywordCommand.replacement.sourceTo;
      continue;
    }

    if (control.name === "label") {
      const argument = readRequiredArgument(text, control.end);
      if (argument !== undefined) {
        const key = text.slice(argument.contentFrom, argument.contentTo).trim();
        if (key.length > 0 && key.length <= MAX_VISUAL_LABEL_KEY_LENGTH) {
          const record: VisualLabelRecord = {
            kind: "label",
            from: index,
            to: argument.end,
            key,
            replacement: lineAwareReplacement(text, index, argument.end),
          };
          const theorem = findLastOpenTheorem(stack);
          if (theorem === undefined) {
            pushRecord(record);
          } else {
            theorem.labels.push(record);
          }
        }
        index = argument.end;
        continue;
      }
    }

    if (control.name === "includegraphics") {
      const image = parseVisualIncludeGraphics(text, index, control.end);
      if (image !== undefined) {
        pushRecord(image);
        index = image.replacement.sourceTo;
        continue;
      }
    }

    const styleGroup = textStyleCommands.get(control.name);
    if (styleGroup !== undefined) {
      const first = readControl(styleGroup, 1);
      const style = first === undefined ? undefined : parseVisualTransparentSizeDeclaration(styleGroup, 1, first, namedColors);
      const body = readRequiredArgument(text, control.end);
      if (style !== undefined && styleGroup.slice(style.contentFrom, style.contentTo) === "#1" && body !== undefined) {
        pushRecord({ ...style, command: control.name, from: index, to: body.end,
          prefixFrom: index, prefixTo: body.contentFrom, contentFrom: body.contentFrom, contentTo: body.contentTo,
          suffixFrom: body.contentTo, suffixTo: body.end, editLabel: `编辑 \\${control.name}` });
        index = body.contentFrom;
        continue;
      }
    }

    const sizeDeclaration = parseVisualTransparentSizeDeclaration(
      text,
      index,
      control,
      namedColors,
    );
    if (sizeDeclaration !== undefined) {
      pushRecord(sizeDeclaration);
      // Scan inside the group rather than jumping to its closing brace.
      scanJumps.set(sizeDeclaration.contentTo, sizeDeclaration.to);
      index = sizeDeclaration.contentFrom;
      continue;
    }

    if (control.name === "frame") {
      const options = readOptionalArgument(text, control.end);
      const body = readRequiredArgument(text, options?.end ?? control.end);
      if (body !== undefined) {
        const begin = commandFrameBoundaryReplacement(
          text,
          index,
          body.contentFrom,
          "begin",
        );
        stack.push({
          kind: "frame",
          environment: "frame",
          syntax: "command",
          language: documentLanguage,
          title: undefined,
          subtitle: undefined,
          begin: { ...begin, block: true },
          titleCommands: [],
          bodyFrom: body.contentFrom,
          commandBodyTo: body.contentTo,
          commandEnd: body.end,
        });
        // Keep scanning the argument. This is what lets a shorthand such as
        // `\\frame{\\titlepage}` retain the same title preview and lets richer
        // frame bodies reuse the ordinary formula/list/structure pipeline.
        index = body.contentFrom;
        continue;
      }
    }

    if (control.name === "detokenize" || literalTextCommands.has(control.name)) {
      const body = readRequiredArgument(text, control.end);
      if (body !== undefined) {
        pushRecord({ kind: "accent", from: index, to: body.end, text: text.slice(body.contentFrom, body.contentTo) });
        index = body.end;
        continue;
      }
    }

    if (control.name === "footnote" && !redefinedCommands.has(control.name)) {
      const optional = readOptionalArgument(text, control.end);
      const body = readRequiredArgument(text, optional?.end ?? control.end);
      if (body !== undefined) {
        const marker = optional === undefined ? undefined : text.slice(optional.contentFrom, optional.contentTo).trim();
        const number = marker === undefined ? (numberingKnown ? String(++footnoteCounter) : undefined)
          : /^[+-]?\d+$/u.test(marker) && Number.isSafeInteger(Number(marker)) ? String(Number(marker)) : undefined;
        const bodyText = text.slice(body.contentFrom, body.contentTo);
        pushRecord({ kind: "footnote", from: index, to: body.end, contentFrom: body.contentFrom, contentTo: body.contentTo, number,
          source: { from: body.contentFrom, to: body.contentTo, text: bodyText } });
        // Keep physical labels and references discoverable inside the collapsed body.
        index = body.contentFrom;
        continue;
      }
    }

    const textStyle = parseVisualTextStyle(text, index, control, namedColors, documentClass === "beamer");
    if (textStyle !== undefined) {
      pushRecord(textStyle);
      // Continue scanning inside the argument so nested styles, references and
      // inline formulas remain independent visual records.
      if (textStyle.command === "texorpdfstring" || textStyle.command === "href") {
        scanJumps.set(textStyle.contentTo, textStyle.to);
        index = textStyle.contentFrom;
      } else {
        index = control.end;
      }
      continue;
    }

    if (["noindent", "par", "vfill", "smallskip", "medskip", "bigskip", "hfill", "newpage", "clearpage"].includes(control.name)) {
      pushRecord({ kind: "accent", from: index, to: control.end, text: "" });
      index = control.end;
      continue;
    }

    if (control.name === "vspace" || control.name === "hspace") {
      const argument = readRequiredArgument(text, text[control.end] === "*" ? control.end + 1 : control.end);
      if (argument !== undefined) {
        pushRecord({ kind: "accent", from: index, to: argument.end, text: "" });
        index = argument.end;
        continue;
      }
    }

    if (control.name === "\\" && findLastOpenFrame(stack) !== undefined) {
      const optional = readOptionalArgument(text, text[control.end] === "*" ? control.end + 1 : control.end);
      const end = optional?.end ?? (text[control.end] === "*" ? control.end + 1 : control.end);
      pushRecord({ kind: "accent", from: index, to: end,
        text: /^[ \t]*(?:\r?\n|%)/u.test(text.slice(end)) ? "" : "\n" });
      index = end;
      continue;
    }

    const layoutEnd = redefinedCommands.has(control.name)
      ? undefined
      : staticVisualLayoutCommandEnd(text, control);
    if (layoutEnd !== undefined) {
      pushRecord({ kind: "accent", from: index, to: layoutEnd, text: "" });
      index = layoutEnd;
      continue;
    }

    const accent = parseVisualAccent(text, index, control);
    if (accent !== undefined) {
      pushRecord(accent);
      index = accent.to;
      continue;
    }

    if (control.name === "maketitle" || control.name === "titlepage") {
      pushRecord({
        kind: "maketitle",
        replacement: lineAwareReplacement(text, index, control.end),
        title: resolveSimpleTitleMacro(text, title, titleMacros),
        metadataReplacements: [...frontMatterCommands],
        authors,
        affiliations,
        emails: uniqueVisualSourceTexts(emails),
        date: resolveVisualDate(text, date, titleMacros, redefinedCommands, documentLanguage),
        ...(preambleSections.length === 0 ? {} : { frontMatter: {
          replacement: lineAwareReplacement(text, index, control.end),
          sections: [...preambleSections],
        } }),
      });
      index = control.end;
      continue;
    }

    if (jhep && control.name === "acknowledgments" && !redefinedCommands.has(control.name)) {
      pushRecord({
        kind: "heading", command: "section", level: HEADING_LEVELS.section,
        starred: true, number: undefined, generatedTitle: true,
        from: index, to: control.end, prefixFrom: index, prefixTo: control.end,
        contentFrom: control.end, contentTo: control.end,
        suffixFrom: control.end, suffixTo: control.end,
        title: "Acknowledgments", tocTitle: "Acknowledgments",
      });
      index = control.end;
      continue;
    }

    if (control.name === "appendix" && !redefinedCommands.has("appendix")) {
      appendixOffsets.push(index);
      appendixTransitions.push({ from: index, kind: "appendix" });
      applyVisualAppendixTransition(appendixState, "appendix", headingCounters, headingNumbers, numberingRootLevel);
      pushRecord({ kind: "accent", from: index, to: control.end, text: "" });
      index = control.end;
      continue;
    }

    if (isHeadingLevel(control.name)) {
      const starred = text[control.end] === "*";
      const starEnd = starred ? control.end + 1 : control.end;
      const shortTitle = readOptionalArgument(text, starEnd);
      const argument = readRequiredArgument(text, shortTitle?.end ?? starEnd);
      if (argument !== undefined) {
        const title = latexToPlainText(
          text.slice(argument.contentFrom, argument.contentTo),
        );
        pushRecord({
          kind: "heading",
          command: control.name,
          level: HEADING_LEVELS[control.name],
          starred,
          number: starred || !numberingKnown || headingCountersAmbiguous
            ? undefined
            : nextVisualHeadingNumber(
                control.name,
                numberingRootLevel,
                headingCounters,
                headingNumbers,
                appendixState.active,
              ),
          from: index,
          to: argument.end,
          prefixFrom: index,
          prefixTo: argument.contentFrom,
          contentFrom: argument.contentFrom,
          contentTo: argument.contentTo,
          suffixFrom: argument.contentTo,
          suffixTo: argument.end,
          title,
          tocTitle: shortTitle === undefined
            ? title
            : latexToPlainText(
                text.slice(shortTitle.contentFrom, shortTitle.contentTo),
              ),
        });
        if (control.name === "chapter" && !starred) footnoteCounter = 0;
        // Keep scanning inside the visible title. The heading decoration only
        // hides the command/braces, so nested text accents/symbols (for example
        // `K\"{a}hler` or `\S`) still need their own visual replacements.
        // Starting at the content also preserves reference/style widgets.
        index = argument.contentFrom;
        continue;
      }
    }

    if (control.name === "item") {
      const openList = findLastOpenList(stack);
      if (openList !== undefined) {
        const optional = readOptionalArgument(text, control.end);
        const sourceTo = optional?.end ?? control.end;
        openList.items.push({
          from: index,
          to: sourceTo,
          sourceFrom: index,
          sourceTo,
          label: optional === undefined
            ? ""
            : latexToPlainText(text.slice(optional.contentFrom, optional.contentTo)),
        });
        index = sourceTo;
        continue;
      }
    }

    if (control.name === "bibitem") {
      const openBibliography = findLastManualBibliography(stack);
      if (openBibliography !== undefined) {
        const optional = readOptionalArgument(text, control.end);
        const key = readRequiredArgument(text, optional?.end ?? control.end);
        if (key !== undefined) {
          openBibliography.items.push({
            key: text.slice(key.contentFrom, key.contentTo).trim(),
            commandFrom: index,
            contentFrom: key.end,
          });
          index = key.end;
          continue;
        }
      }
    }

    const inlineReference = parseVisualInlineReference(text, index, control);
    if (inlineReference !== undefined) {
      if (inlineReference.keys.length > 0) {
        if (inlineReference.kind === "citation") citedKeys.push(...inlineReference.keys);
        pushRecord(inlineReference);
      }
      index = inlineReference.to;
      continue;
    }

    if (control.name === "bibliography" || control.name === "addbibresource") {
      const optional = control.name === "addbibresource"
        ? readOptionalArgument(text, control.end)
        : undefined;
      const argument = readRequiredArgument(text, optional?.end ?? control.end);
      if (argument !== undefined) {
        hasBibliographyDeclaration = true;
        const requestedPaths = parseBibliographyPaths(
          text.slice(argument.contentFrom, argument.contentTo),
        );
        const configurationFrom = bibliographyConfigurationStart(
          text,
          index,
          bibliographySettings,
        );
        const localSettings = [
          ...requestedPaths.map((path) => bibliographySetting(
            "resource",
            control.name,
            path,
            index,
            argument.end,
          )),
          ...(optional === undefined
            ? []
            : bibliographySettingsFromOptions(
                text.slice(optional.contentFrom, optional.contentTo),
                index,
                argument.end,
                control.name,
              )),
        ];
        bibliographyPaths.push(...requestedPaths);
        bibliographySettings.push(...localSettings);
        pushRecord({
          kind: "bibliography",
          replacement: lineAwareReplacement(text, configurationFrom, argument.end),
          requestedPaths,
          settings: uniqueVisualBibliographySettings(bibliographySettings),
          entries: [],
          totalEntries: 0,
          manual: false,
          language: documentLanguage,
        });
        index = argument.end;
        continue;
      }
    }

    if (control.name === "printbibliography") {
      const optional = readOptionalArgument(text, control.end);
      const commandEnd = optional?.end ?? control.end;
      const configurationFrom = bibliographyConfigurationStart(
        text,
        index,
        bibliographySettings,
      );
      const localSettings = optional === undefined
        ? []
        : bibliographySettingsFromOptions(
            text.slice(optional.contentFrom, optional.contentTo),
            index,
            commandEnd,
            "printbibliography",
          );
      pushRecord({
        kind: "bibliography",
        replacement: lineAwareReplacement(text, configurationFrom, commandEnd),
        requestedPaths: uniqueStrings(bibliographyPaths),
        settings: uniqueVisualBibliographySettings([
          ...bibliographySettings,
          ...localSettings,
        ]),
        entries: [],
        totalEntries: 0,
        manual: false,
        language: documentLanguage,
      });
      index = commandEnd;
      continue;
    }

    index = Math.max(index + 1, control.end);
  }

  if (preamble !== undefined) {
    records.unshift(preamble);
  }
  records.sort((left, right) => structureRecordStart(left) - structureRecordStart(right));
  const resolvedRecords = resolveVisualTheoremOptionalTitles(
    groupVisualFrontMatter(text, resolveVisualFootnoteSegments(records), frontMatterCommands, options.compatibilityMode),
  );
  return {
    records: resolvedRecords,
    ...(appendixOffsets.length === 0 ? {} : { appendixOffsets }),
    ...(appendixTransitions.length === 0 ? {} : { appendixTransitions }),
    ...(headingCounterMutations.length === 0 ? {} : { headingCounterMutations }),
    ...(headingCountersAmbiguous ? { headingCountersAmbiguous: true } : {}),
    appendicesEnabled: appendicesEnabled && !redefinedCommands.has("appendices"),
    bibliographyPaths: uniqueStrings(bibliographyPaths),
    hasBibliographyDeclaration,
    citedKeys: uniqueStrings([...citedKeys, ...visualInlineReferenceRecords({ records: resolvedRecords })
      .flatMap(record => record.kind === "citation" ? record.keys : [])]),
  };
}

/** Reuse the scanner's visible source boundaries, including hidden link metadata. */
function resolveVisualFootnoteSegments(records: readonly VisualStructureRecord[]): readonly VisualStructureRecord[] {
  return records.map((record, index) => {
    if (record.kind !== "footnote") return record;
    const hidden: { from: number; to: number }[] = [];
    for (let childIndex = index + 1; childIndex < records.length; childIndex += 1) {
      const child = records[childIndex]!;
      if (structureRecordStart(child) >= record.contentTo) break;
      if (child.kind === "textStyle") hidden.push(
        { from: child.prefixFrom, to: child.prefixTo }, { from: child.suffixFrom, to: child.suffixTo });
      else if (child.kind === "label") hidden.push(child);
      else if (child.kind === "comment") hidden.push(child.replacement);
    }
    let offset = 0;
    let visible = "";
    for (const range of hidden.sort((left, right) => left.from - right.from)) {
      const from = Math.max(offset, range.from - record.contentFrom);
      const to = Math.min(record.source.text.length, range.to - record.contentFrom);
      if (to <= from) continue;
      visible += record.source.text.slice(offset, from) + " ".repeat(to - from);
      offset = to;
    }
    visible += record.source.text.slice(offset);
    return { ...record, source: { ...record.source,
      segments: visualInlineContentSegments(visible, record.contentFrom) } };
  });
}

function frontMatterKeywordSection(text: string, record: VisualKeywordsRecord): VisualFrontMatterSection {
  const control = readControl(text, record.replacement.sourceFrom);
  const optional = control === undefined ? undefined : readOptionalArgument(text, control.end);
  const argument = control === undefined || (!KEYWORDS_COMMANDS.has(control.name) && !CLASSIFICATION_COMMANDS.has(control.name))
    ? undefined : readRequiredArgument(text, optional?.end ?? control.end);
  return {
    role: record.role,
    label: record.label,
    source: {
      from: argument?.contentFrom ?? record.replacement.sourceFrom,
      to: argument?.contentTo ?? record.replacement.sourceTo,
      text: record.value,
    },
  };
}

function groupVisualFrontMatter(
  text: string,
  records: readonly VisualStructureRecord[],
  commands: readonly VisualReplacementRange[],
  compatibilityMode?: "basic" | "maximum",
): readonly VisualStructureRecord[] {
  // ponytail: interval scans are quadratic within the 4,000-record cap;
  // index ranges if large-document profiling makes this significant.
  const candidates: { replacement: VisualReplacementRange; sections?: readonly VisualFrontMatterSection[] }[] = commands.map(replacement => ({ replacement }));
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.kind === "abstract") {
      const tail = records.filter((nested): nested is VisualKeywordsRecord => nested.kind === "keywords" && nested.replacement.sourceFrom >= record.bodyFrom && nested.replacement.sourceTo <= record.bodyTo);
      let from = record.bodyFrom;
      let to = frontMatterProseEnd(text, from, tail[0]?.replacement.sourceFrom ?? record.bodyTo);
      while (from < to && /\s/u.test(text[from]!)) from += 1;
      const source = frontMatterAbstractSource(text, from, to);
      if (source === undefined) continue;
      let cursor = to;
      let validTail = true;
      for (const keyword of tail) {
        if (!frontMatterLayoutOnly(text.slice(cursor, keyword.replacement.sourceFrom))) {
          validTail = false;
          break;
        }
        cursor = keyword.replacement.sourceTo;
      }
      if (!validTail || !frontMatterLayoutOnly(text.slice(cursor, record.bodyTo))) continue;
      candidates.push({
        replacement: lineAwareReplacement(text, record.begin.sourceFrom, record.end.sourceTo),
        sections: [
          ...(from === to ? [] : [{ role: record.role, label: record.label, source }]),
          ...tail.map(keyword => frontMatterKeywordSection(text, keyword)),
        ],
      });
    } else if (record.kind === "keywords") {
      candidates.push({ replacement: record.replacement, sections: [frontMatterKeywordSection(text, record)] });
    } else if (record.kind === "heading" && record.command === "section" && record.starred && /^(?:Abstract|摘要)$/iu.test(record.title)) {
      const boundary = records.slice(index + 1).find(next => next.kind === "heading" || next.kind === "keywords" || next.kind === "maketitle" || next.kind === "documentEnd");
      const to = boundary === undefined ? undefined : structureRecordStart(boundary);
      // ponytail: only plain section-style abstracts have an unambiguous body;
      // retain richer/custom layouts as source until an explicit parser exists.
      if (to !== undefined && !/[\\{}$%]/u.test(text.slice(record.to, to))) {
        let from = record.to;
        let bodyTo = to;
        while (from < bodyTo && /\s/u.test(text[from]!)) from += 1;
        while (bodyTo > from && /\s/u.test(text[bodyTo - 1]!)) bodyTo -= 1;
        if (bodyTo > from) candidates.push({
          replacement: lineAwareReplacement(text, record.from, bodyTo),
          sections: [{ role: "abstract", label: record.title, source: { from, to: bodyTo, text: latexMetadataToPlainText(text.slice(from, bodyTo)) } }],
        });
      }
    }
  }
  const before = [...candidates].sort((left, right) => right.replacement.sourceTo - left.replacement.sourceTo);
  const after = [...candidates].sort((left, right) => left.replacement.sourceFrom - right.replacement.sourceFrom);
  const claimed = new Set<typeof candidates[number]>();
  return records.map(record => {
    if (record.kind !== "maketitle" || records.some(other => other.kind === "frame" && other.bodyFrom <= record.replacement.sourceFrom && other.bodyTo >= record.replacement.sourceTo)) return record;
    let from = record.replacement.sourceFrom;
    let to = record.replacement.sourceTo;
    const sections: VisualFrontMatterSection[] = [];
    for (const candidate of before) {
      if (candidate.replacement.sourceTo > from) continue;
      if (claimed.has(candidate) || skipTrivia(text, candidate.replacement.sourceTo) !== from) break;
      from = candidate.replacement.sourceFrom;
      claimed.add(candidate);
      if (candidate.sections !== undefined) sections.unshift(...candidate.sections);
    }
    for (const candidate of after) {
      if (candidate.replacement.sourceFrom < to) continue;
      if (candidate.sections === undefined || claimed.has(candidate) || skipTrivia(text, to) !== candidate.replacement.sourceFrom) break;
      to = candidate.replacement.sourceTo;
      claimed.add(candidate);
      sections.push(...candidate.sections);
    }
    const replacements: VisualReplacementRange[] = [];
    if (compatibilityMode === "maximum") {
      // Only fields before this title and after the last structural boundary
      // belong to it. Fold each field separately; never swallow report prose.
      const boundary = records.filter(other => other.kind === "heading" || other.kind === "maketitle" || other.kind === "frame")
        .map(structureRecordStart).filter(offset => offset < record.replacement.sourceFrom).reduce((a, b) => Math.max(a, b), 0);
      const extraSections: VisualFrontMatterSection[] = [];
      for (const candidate of after) {
        const range = candidate.replacement;
        if (claimed.has(candidate) || range.sourceFrom < boundary || range.sourceTo > from ||
          replacements.some(outer => range.from >= outer.from && range.to <= outer.to)) continue;
        replacements.push(range);
        claimed.add(candidate);
        if (candidate.sections !== undefined) extraSections.push(...candidate.sections);
      }
      sections.unshift(...extraSections);
    }
    sections.unshift(...(record.frontMatter?.sections ?? []));
    return from === record.replacement.sourceFrom && to === record.replacement.sourceTo && sections.length === 0 && replacements.length === 0
      ? record : { ...record, frontMatter: { replacement: lineAwareReplacement(text, from, to), sections, ...(replacements.length === 0 ? {} : { replacements }) } };
  });
}

const FRONT_MATTER_LAYOUT_COMMANDS = new Set(["par", "smallskip", "medskip", "bigskip", "noindent"]);

function frontMatterLayoutOnly(source: string): boolean {
  let index = skipTrivia(source, 0);
  while (index < source.length) {
    const control = source[index] === "\\" ? readControl(source, index) : undefined;
    if (control === undefined || !FRONT_MATTER_LAYOUT_COMMANDS.has(control.name)) return false;
    index = skipTrivia(source, control.end);
  }
  return true;
}

function frontMatterProseEnd(text: string, from: number, to: number): number {
  const source = text.slice(from, to);
  let index = 0;
  let end = 0;
  while (index < source.length) {
    index = skipTrivia(source, index);
    if (index >= source.length) break;
    const control = source[index] === "\\" ? readControl(source, index) : undefined;
    index = control?.end ?? index + 1;
    if (control === undefined || !FRONT_MATTER_LAYOUT_COMMANDS.has(control.name)) end = index;
  }
  return from + end;
}

function frontMatterAbstractSource(text: string, from: number, to: number): VisualSourceText | undefined {
  const body = text.slice(from, to);
  if ([...body.matchAll(/\\([A-Za-z@]+)/gu)].some(match => match[1] === "label" || REFERENCE_COMMANDS.has(match[1]!) || CITATION_COMMANDS.has(match[1]!))) return undefined;
  const ranges = explicitMathContentRanges(body);
  if (ranges.some(range => range.to - range.from > MAX_VISUAL_TABLE_CELL_LENGTH)) return undefined;
  let ordinary = "";
  let offset = 0;
  for (const range of ranges) {
    ordinary += body.slice(offset, range.from);
    offset = range.to;
  }
  ordinary += body.slice(offset);
  if (ordinary.includes("$") || !simpleFrontMatterText(ordinary)) return undefined;
  return { from, to, text: latexMetadataToPlainText(body), segments: visualInlineContentSegments(body, from) };
}

function simpleFrontMatterText(body: string): boolean {
  for (const command of body.matchAll(/\\([A-Za-z@]+|[^A-Za-z@])/gu)) {
    const name = command[1]!;
    if (!/^(?:textbf|textit|textrm|textsf|texttt|textsc|textnormal|emph|underline|LaTeX|TeX|quad|qquad|and)$/u.test(name) &&
        LATEX_NAMED_TEXT_GLYPHS[name] === undefined && LATEX_COMBINING_ACCENTS[name] === undefined &&
        !(name.length === 1 && "&%#${}_\\,;:! ".includes(name))) return false;
  }
  return true;
}

function canFoldTitleMetadata(
  text: string,
  argument: ParsedArgument,
  macros?: ReadonlyMap<string, ParsedArgument>,
  allowToday = false,
  allowMath = true,
): boolean {
  const raw = text.slice(argument.contentFrom, argument.contentTo);
  if (allowToday && /^\s*\\today(?:\{\})?\s*$/u.test(raw)) return true;
  const resolved = macros === undefined ? undefined : resolveSimpleTitleMacro(text, {
    from: argument.contentFrom, to: argument.contentTo, text: raw,
  }, macros);
  const body = resolved?.definition === undefined ? raw : text.slice(resolved.definition.from, resolved.definition.to);
  let prose = "";
  let index = 0;
  const mathRanges = explicitMathContentRanges(body);
  if (!allowMath && mathRanges.length > 0) return false;
  while (index < body.length) {
    const math = mathRanges.find(range => range.from === index);
    if (math !== undefined) { index = math.to; continue; }
    if (body[index] === "$" && !isEscapedAt(body, index)) return false;
    const control = body[index] === "\\" ? readControl(body, index) : undefined;
    if (control?.name === "vspace" || control?.name === "hspace") {
      const spacing = readRequiredArgument(body, body[control.end] === "*" ? control.end + 1 : control.end);
      if (spacing === undefined || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex)$/u.test(body.slice(spacing.contentFrom, spacing.contentTo).trim())) return false;
      index = spacing.end;
      continue;
    }
    if (control?.name === "inst") {
      const marker = readRequiredArgument(body, control.end);
      if (marker === undefined) return false;
      const ids = body.slice(marker.contentFrom, marker.contentTo);
      if (titleMarkerIds(ids).length !== uniqueStrings(ids.split(",").map(id => id.trim())).length) return false;
      index = marker.end;
      continue;
    }
    const end = control?.end ?? index + 1;
    prose += body.slice(index, end);
    index = end;
  }
  return simpleFrontMatterText(prose);
}

function resolveVisualDate(
  text: string,
  source: VisualSourceText | undefined,
  macros: ReadonlyMap<string, ParsedArgument>,
  redefinedCommands: ReadonlySet<string>,
  language: VisualDocumentLanguage,
): VisualSourceText | undefined {
  if (source !== undefined && !redefinedCommands.has("today") && /^\s*\\today(?:\{\})?\s*$/u.test(text.slice(source.from, source.to))) {
    return { ...source, text: new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
      year: "numeric", month: "long", day: "numeric",
    }).format(new Date()) };
  }
  return resolveSimpleTitleMacro(text, source, macros);
}

/** A finite literal wrapper, not general macro expansion or TeX execution. */
function isVisualDetokenizeWrapper(text: string, control: ParsedControl): boolean {
  if (!VISUAL_LABEL_NEW_COMMAND_DEFINITIONS.has(control.name)) return false;
  const start = skipTrivia(text, text[control.end] === "*" ? control.end + 1 : control.end);
  const targetEnd = readRequiredArgument(text, start)?.end ?? readControl(text, start)?.end;
  const arity = targetEnd === undefined ? undefined : readOptionalArgument(text, targetEnd);
  if (arity === undefined || text.slice(arity.contentFrom, arity.contentTo).trim() !== "1") return false;
  const body = readRequiredArgument(text, arity.end);
  if (body === undefined) return false;
  let value = text.slice(body.contentFrom, body.contentTo).trim();
  while (value.length > 0) {
    const command = readControl(value, 0);
    const argument = command === undefined ? undefined : readRequiredArgument(value, command.end);
    if (command === undefined || argument === undefined || argument.end !== value.length) return false;
    value = value.slice(argument.contentFrom, argument.contentTo).trim();
    if (command.name === "detokenize") return value === "#1";
    if (!["texttt", "textrm", "textsf", "textnormal", "textbf", "textit", "textsc"].includes(command.name)) return false;
  }
  return false;
}

function collectSimpleTitleMacro(text: string, control: ParsedControl, macros: Map<string, ParsedArgument>): string | undefined {
  const afterStar = text[control.end] === "*" ? control.end + 1 : control.end;
  const targetFrom = skipTrivia(text, afterStar);
  const grouped = readRequiredArgument(text, targetFrom);
  const target = readControl(text, grouped === undefined ? targetFrom : skipTrivia(text, grouped.contentFrom));
  if (target === undefined) return;
  if (control.name === "providecommand" && macros.has(target.name)) return target.name;
  macros.delete(target.name);
  if (!["newcommand", "renewcommand", "providecommand", "def", "gdef"].includes(control.name)) return target.name;
  if (grouped !== undefined && skipTrivia(text, target.end) !== grouped.contentTo) return target.name;
  const optional = readOptionalArgument(text, grouped?.end ?? target.end);
  if (optional !== undefined && text.slice(optional.contentFrom, optional.contentTo).trim() !== "0") return target.name;
  const body = readRequiredArgument(text, optional?.end ?? grouped?.end ?? target.end);
  if (body !== undefined && !text.slice(body.contentFrom, body.contentTo).includes("#")) macros.set(target.name, body);
  return target.name;
}

function resolveSimpleTitleMacro(text: string, source: VisualSourceText | undefined, macros: ReadonlyMap<string, ParsedArgument>): VisualSourceText | undefined {
  if (source === undefined) return source;
  const value = text.slice(source.from, source.to).trim();
  const match = /^\\([A-Za-z@]+)(?:\{\})?$/u.exec(value);
  const definition = match === null ? undefined : macros.get(match[1]!);
  const unresolved = match === null ? source : { ...source, text: value, segments: [{ kind: "text" as const, text: value }] };
  if (definition === undefined) return unresolved;
  const body = text.slice(definition.contentFrom, definition.contentTo);
  // Resolve one literal definition only; arbitrary commands and macro chains
  // need TeX execution and remain available in the source declaration.
  if (!simpleFrontMatterText(body)) return unresolved;
  return { ...source, text: latexMetadataToPlainText(body), segments: visualInlineContentSegments(body, definition.contentFrom), definition: { from: definition.contentFrom, to: definition.contentTo } };
}

function resolveVisualTheoremOptionalTitles(
  records: readonly VisualStructureRecord[],
): readonly VisualStructureRecord[] {
  const numbersByLabel = new Map<string, string[]>();
  for (const record of records) {
    if (record.kind !== "theorem" || record.number === undefined) {
      continue;
    }
    for (const label of record.labels) {
      const numbers = numbersByLabel.get(label.key) ?? [];
      numbers.push(record.number);
      numbersByLabel.set(label.key, numbers);
    }
  }
  return records.map((record): VisualStructureRecord => {
    if (record.kind !== "theorem" || record.optionalTitleLatex === undefined) {
      return record;
    }
    const resolvedLatex = record.optionalTitleLatex.replace(
      /\\(eqref|ref|autoref|Autoref|cref|Cref)\*?\s*\{([^{}]*)\}/gu,
      (source, command: string, rawKeys: string) => {
        const keys = rawKeys.split(",").map((key) => key.trim()).filter(Boolean);
        if (keys.length === 0) {
          return source;
        }
        const resolved = keys.map((key) => {
          const numbers = numbersByLabel.get(key) ?? [];
          return numbers.length === 1 ? numbers[0]! : key;
        });
        const joined = resolved.join(", ");
        return command === "eqref" ? `(${joined})` : joined;
      },
    );
    return {
      ...record,
      optionalTitle: latexToPlainText(resolvedLatex),
    };
  });
}

/**
 * Locate real \label targets, including labels inside display-math
 * environments that the presentation scanner deliberately treats as opaque.
 * Literal/comment contexts are skipped so navigation never guesses between a
 * real target and an example shown in source text.
 */
export function findVisualLabelTargets(
  text: string,
  requestedKey: string,
): readonly VisualLabelTarget[] {
  const key = requestedKey.trim();
  if (key.length === 0 || key.length > MAX_VISUAL_LABEL_KEY_LENGTH) {
    return [];
  }
  return findVisualLabelsInRange(text, 0, text.length)
    .filter((target) => target.key === key);
}

/**
 * Resolve a unique label to the heading that owns it.  LaTeX normally places
 * a section label immediately after the heading command, although a label in
 * the heading argument is valid as well.  Only whitespace and comments may
 * occur between an external label and the heading, so a later paragraph label
 * can never be mistaken for a section label.
 */
export function findVisualHeadingForLabel(
  text: string,
  records: readonly VisualStructureRecord[],
  requestedKey: string,
): VisualHeadingRecord | undefined {
  const targets = findVisualLabelTargets(text, requestedKey);
  if (targets.length !== 1) {
    return undefined;
  }
  const target = targets[0]!;
  const matches = records.filter(
    (record): record is VisualHeadingRecord =>
      record.kind === "heading" &&
      (
        (target.from >= record.from && target.to <= record.to) ||
        (
          target.from >= record.to &&
          visualHeadingLabelGapIsIgnorable(text, record.to, target.from)
        )
      ),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export type VisualReferenceTargetKind =
  | "formula"
  | "theorem"
  | "heading"
  | "table"
  | "image"
  | "diagram"
  | "unknown";

export interface VisualStructureReferencePresentation {
  readonly targetKind: Exclude<VisualReferenceTargetKind, "formula" | "unknown">;
  readonly label: string;
}

export type VisualLabeledStructureRecord =
  | VisualTableRecord
  | VisualImageRecord
  | VisualTikzcdRecord
  | VisualTikzpictureRecord
  | VisualFigureRecord;

export interface VisualLabeledStructureTarget {
  readonly targetKind: "table" | "image" | "diagram";
  readonly record: VisualLabeledStructureRecord;
}

/**
 * Resolve a unique label to a structure which already has a safe visual
 * representation.  Tables and images own their labels directly.  tikz-cd and
 * TikZ pictures normally inherit a figure counter, so they are associated only
 * when one figure contains exactly one real label and exactly one diagram.
 * Ambiguous figures deliberately remain unresolved instead of guessing from a
 * key prefix such as `fig:` or `diag:`.
 */
export function findVisualLabeledStructureForLabel(
  text: string,
  records: readonly VisualStructureRecord[],
  requestedKey: string,
): VisualLabeledStructureTarget | undefined {
  const key = requestedKey.trim();
  if (key.length === 0 || key.length > MAX_VISUAL_LABEL_KEY_LENGTH) {
    return undefined;
  }
  const labelsByKey = indexVisualLabelTargetsByKey(text);
  return indexVisualLabeledStructures(text, records, labelsByKey).get(key);
}

/**
 * Resolve every local theorem, heading, table, image, and diagram reference in
 * one pass.
 *
 * The visual editor rebuilds its structure decorations after an idle parser
 * snapshot and when the caret crosses a hidden structure boundary. Calling
 * `findVisualHeadingForLabel` for every rendered `\\ref` used to rescan the
 * complete document once (and, for headings, twice) per key. This index keeps
 * the same uniqueness rules while scanning LaTeX labels only once.
 */
export function indexVisualStructureReferences(
  text: string,
  records: readonly VisualStructureRecord[],
): ReadonlyMap<string, VisualStructureReferencePresentation> {
  const presentations = new Map<string, VisualStructureReferencePresentation>();
  const labelTargetsByKey = indexVisualLabelTargetsByKey(text);
  const theoremsByLabel = new Map<string, VisualTheoremRecord[]>();
  for (const record of records) {
    if (record.kind !== "theorem") {
      continue;
    }
    for (const label of record.labels) {
      const key = label.key.trim();
      if (key.length === 0) {
        continue;
      }
      const matches = theoremsByLabel.get(key);
      if (matches === undefined) {
        theoremsByLabel.set(key, [record]);
      } else {
        matches.push(record);
      }
    }
  }

  for (const [key, matches] of theoremsByLabel) {
    const theorem = matches.length === 1 ? matches[0] : undefined;
    if (theorem !== undefined) {
      presentations.set(key, {
        targetKind: "theorem",
        label: theorem.number ?? key,
      });
    }
  }

  for (const [key, target] of indexVisualLabeledStructures(
    text,
    records,
    labelTargetsByKey,
  )) {
    if (!presentations.has(key)) {
      presentations.set(key, {
        targetKind: target.targetKind,
        label: key,
      });
    }
  }

  const headings = records.filter(
    (record): record is VisualHeadingRecord => record.kind === "heading",
  );
  for (const [key, targets] of labelTargetsByKey) {
    // A unique theorem keeps the same precedence as the single-key helpers.
    if (presentations.has(key) || targets.length !== 1) {
      continue;
    }
    const target = targets[0]!;
    const matchingHeadings = headings.filter((record) =>
      (target.from >= record.from && target.to <= record.to) ||
      (
        target.from >= record.to &&
        visualHeadingLabelGapIsIgnorable(text, record.to, target.from)
      )
    );
    const heading = matchingHeadings.length === 1
      ? matchingHeadings[0]
      : undefined;
    if (heading !== undefined) {
      presentations.set(key, {
        targetKind: "heading",
        label: heading.number ?? key,
      });
    }
  }
  return presentations;
}

/**
 * Choose the compact text shown by a visual reference chip. Equations keep
 * their label key, while uniquely resolved theorem-like and heading targets
 * use the number already computed by the visual structure scanner. Unnumbered
 * or not-yet-indexed cross-file targets deliberately fall back to their key.
 */
export function visualReferenceDisplayLabel(
  text: string,
  records: readonly VisualStructureRecord[],
  requestedKey: string,
  targetKind: VisualReferenceTargetKind,
): string {
  const key = requestedKey.trim();
  if (
    key.length === 0 ||
    targetKind === "formula" ||
    targetKind === "table" ||
    targetKind === "image" ||
    targetKind === "diagram" ||
    targetKind === "unknown"
  ) {
    return key;
  }
  if (targetKind === "theorem") {
    const matches = records.filter(
      (record): record is VisualTheoremRecord =>
        record.kind === "theorem" &&
        record.labels.some((label) => label.key === key),
    );
    return matches.length === 1 && matches[0]?.number !== undefined
      ? matches[0].number
      : key;
  }
  return findVisualHeadingForLabel(text, records, key)?.number ?? key;
}

function indexVisualLabelTargetsByKey(
  text: string,
): ReadonlyMap<string, readonly VisualLabelTarget[]> {
  const labelsByKey = new Map<string, VisualLabelTarget[]>();
  for (const target of findVisualLabelsInRange(text, 0, text.length)) {
    const matches = labelsByKey.get(target.key);
    if (matches === undefined) {
      labelsByKey.set(target.key, [target]);
    } else {
      matches.push(target);
    }
  }
  return labelsByKey;
}

function indexVisualLabeledStructures(
  text: string,
  records: readonly VisualStructureRecord[],
  labelsByKey: ReadonlyMap<string, readonly VisualLabelTarget[]>,
): ReadonlyMap<string, VisualLabeledStructureTarget> {
  const candidates = new Map<string, VisualLabeledStructureTarget[]>();
  const append = (key: string, target: VisualLabeledStructureTarget): void => {
    if ((labelsByKey.get(key) ?? []).length !== 1) {
      return;
    }
    const existing = candidates.get(key) ?? [];
    if (!existing.some((candidate) =>
      candidate.record.kind === target.record.kind &&
      candidate.record.replacement.sourceFrom === target.record.replacement.sourceFrom &&
      candidate.record.replacement.sourceTo === target.record.replacement.sourceTo
    )) {
      existing.push(target);
    }
    candidates.set(key, existing);
  };

  for (const record of records) {
    if (record.kind !== "table" && record.kind !== "image" && record.kind !== "figure") {
      continue;
    }
    if (
      record.kind === "table" &&
      record.containerEnvironment === undefined &&
      record.environment !== "longtable"
    ) {
      // A bare tabular does not step the table counter.  A nearby label refers
      // to whichever counter happened to be active before it, not to this grid.
      continue;
    }
    if (
      record.kind === "image" &&
      countVisualFigureObjects(
          text,
          record.replacement.sourceFrom,
          record.replacement.sourceTo,
        ) !== 1
    ) {
      // The image parser intentionally keeps only one bounded preview card.
      // A figure containing several images or an image plus a diagram does not
      // provide enough subfigure ownership information for a correct hover.
      continue;
    }
    const key = record.label?.key.trim() ?? "";
    if (key.length > 0) {
      append(key, {
        targetKind: record.kind === "figure" ? "diagram" : record.kind,
        record,
      });
    }
  }

  const diagrams = records.filter(
    (record): record is VisualTikzcdRecord | VisualTikzpictureRecord =>
      record.kind === "tikzcd" || record.kind === "tikzpicture",
  );
  if (diagrams.length > 0) {
    for (const range of findVisualFigureRanges(text)) {
      const labels = findVisualLabelsInRange(text, range.bodyFrom, range.bodyTo);
      const contained = diagrams.filter((record) =>
        record.replacement.sourceFrom >= range.bodyFrom &&
        record.replacement.sourceTo <= range.bodyTo
      );
      const only = contained.length === 1 ? contained[0] : undefined;
      if (labels.length === 1 && only !== undefined &&
        countVisualFigureObjects(text, range.bodyFrom, only.replacement.sourceFrom) === 0 &&
        countVisualFigureObjects(text, only.replacement.sourceTo, range.bodyTo) === 0) {
        append(labels[0]!.key, {
          targetKind: "diagram",
          record: contained[0]!,
        });
      }
    }
  }

  const resolved = new Map<string, VisualLabeledStructureTarget>();
  for (const [key, matches] of candidates) {
    if (matches.length === 1) {
      resolved.set(key, matches[0]!);
    }
  }
  return resolved;
}

interface VisualFigureRange {
  readonly bodyFrom: number;
  readonly bodyTo: number;
}

function findVisualFigureRanges(text: string): readonly VisualFigureRange[] {
  const ranges: VisualFigureRange[] = [];
  let index = 0;
  while (index < text.length && ranges.length < 128) {
    const character = text[index];
    if (character === "%" && !isEscapedAt(text, index)) {
      index = skipComment(text, index);
      continue;
    }
    if (character !== "\\") {
      index += 1;
      continue;
    }
    const control = readControl(text, index);
    if (control?.name !== "begin") {
      index = Math.max(index + 1, control?.end ?? index + 1);
      continue;
    }
    const argument = readRequiredArgument(text, control.end);
    if (argument === undefined) {
      index = control.end;
      continue;
    }
    const environment = text.slice(argument.contentFrom, argument.contentTo).trim();
    if (environment !== "figure" && environment !== "figure*") {
      index = argument.end;
      continue;
    }
    const bounds = findEnvironmentBounds(text, argument.end, environment);
    if (bounds === undefined) {
      index = argument.end;
      continue;
    }
    ranges.push({ bodyFrom: argument.end, bodyTo: bounds.endFrom });
    index = bounds.endTo;
  }
  return ranges;
}

function countVisualFigureObjects(
  text: string,
  requestedFrom: number,
  requestedTo: number,
): number {
  const from = Math.max(0, Math.min(text.length, requestedFrom));
  const to = Math.max(from, Math.min(text.length, requestedTo));
  let count = 0;
  let index = from;
  while (index < to && count <= 1) {
    const character = text[index];
    if (character === "%" && !isEscapedAt(text, index)) {
      index = skipComment(text, index);
      continue;
    }
    if (character !== "\\") {
      index += 1;
      continue;
    }
    const control = readControl(text, index);
    if (control === undefined) {
      index += 1;
      continue;
    }
    if (control.name === "verb" || control.name === "verb*") {
      index = skipVerb(text, control.end);
      continue;
    }
    if (control.name === "includegraphics") {
      count += 1;
      index = control.end;
      continue;
    }
    if (control.name === "begin") {
      const argument = readRequiredArgument(text, control.end);
      if (argument !== undefined) {
        const environment = text.slice(argument.contentFrom, argument.contentTo).trim();
        if (environment === "tikzcd" || environment === "tikzpicture") {
          count += 1;
        }
        index = argument.end;
        continue;
      }
    }
    index = Math.max(index + 1, control.end);
  }
  return count;
}

function visualHeadingLabelGapIsIgnorable(
  text: string,
  requestedFrom: number,
  requestedTo: number,
): boolean {
  let cursor = Math.max(0, Math.min(text.length, requestedFrom));
  const to = Math.max(cursor, Math.min(text.length, requestedTo));
  while (cursor < to) {
    const character = text[cursor];
    if (/\s/u.test(character ?? "")) {
      cursor += 1;
      continue;
    }
    if (character === "%" && !isEscapedAt(text, cursor)) {
      cursor = Math.min(to, skipComment(text, cursor));
      continue;
    }
    return false;
  }
  return true;
}

/** Find bounded, editable label commands, including labels inside math. */
export function findVisualLabelsInRange(
  text: string,
  requestedFrom: number,
  requestedTo: number,
): readonly VisualLabelTarget[] {
  const from = Math.max(0, Math.min(text.length, Math.trunc(requestedFrom)));
  const to = Math.max(from, Math.min(text.length, Math.trunc(requestedTo)));
  const targets: VisualLabelTarget[] = [];
  let index = from;
  while (index < to && targets.length < 256) {
    const character = text[index];
    if (character === "%" && !isEscapedAt(text, index)) {
      index = skipComment(text, index);
      continue;
    }
    if (character !== "\\") {
      index += 1;
      continue;
    }
    const control = readControl(text, index);
    if (control === undefined) {
      index += 1;
      continue;
    }
    if (control.name === "verb" || control.name === "verb*") {
      index = skipVerb(text, control.end);
      continue;
    }
    if (control.name === "newif") {
      index = skipVisualNewIfDeclaration(text, control.end, to) ?? control.end;
      continue;
    }
    const functionalConditionalArguments = visualFunctionalConditionalArgumentCount(
      control.name,
    );
    if (functionalConditionalArguments !== undefined) {
      // Neither branch is source-authoritative without executing the
      // condition. A malformed invocation has no trustworthy resync point.
      index = skipVisualFunctionalConditional(
        text,
        control.end,
        to,
        functionalConditionalArguments,
      ) ?? to;
      continue;
    }
    if (isVisualLabelConditionalControl(control.name)) {
      // A source-only index cannot prove arbitrary TeX branch state. Skip the
      // complete bounded conditional instead of publishing a guessed target.
      index = skipLiteralFalseConditional(text, control.end, to);
      continue;
    }
    if (isVisualLabelDefinitionCommand(control.name)) {
      const definitionEnd = skipVisualLabelDefinition(text, control, to);
      if (definitionEnd === undefined) {
        // A malformed definition has no trustworthy resynchronization point.
        // Keep labels already established before it and fail closed afterward.
        break;
      }
      index = definitionEnd;
      continue;
    }
    if (control.name === "begin") {
      const argument = readRequiredArgument(text, control.end);
      if (argument !== undefined) {
        const environment = text
          .slice(argument.contentFrom, argument.contentTo)
          .trim();
        if (VERBATIM_ENVIRONMENTS.has(environment)) {
          index = skipOpaqueEnvironment(text, argument.end, environment);
          continue;
        }
        index = argument.end;
        continue;
      }
    }
    if (control.name === "label") {
      const argument = readRequiredArgument(text, control.end);
      if (argument !== undefined) {
        const foundKey = text
          .slice(argument.contentFrom, argument.contentTo)
          .trim();
        if (
          foundKey.length > 0 &&
          foundKey.length <= MAX_VISUAL_LABEL_KEY_LENGTH &&
          argument.end <= to
        ) {
          const leadingWhitespace = text
            .slice(argument.contentFrom, argument.contentTo)
            .search(/\S/u);
          const keyFrom = leadingWhitespace < 0
            ? argument.contentFrom
            : argument.contentFrom + leadingWhitespace;
          targets.push({
            key: foundKey,
            from: index,
            to: argument.end,
            keyFrom,
            keyTo: keyFrom + foundKey.length,
          });
        }
        index = argument.end;
        continue;
      }
    }
    index = Math.max(index + 1, control.end);
  }
  return targets;
}

const VISUAL_LABEL_NEW_COMMAND_DEFINITIONS = new Set([
  "newcommand",
  "renewcommand",
  "providecommand",
  "DeclareRobustCommand",
  "DeclareMathOperator",
]);

const VISUAL_LABEL_XPARSE_COMMAND_DEFINITIONS = new Set([
  "NewDocumentCommand",
  "RenewDocumentCommand",
  "ProvideDocumentCommand",
  "DeclareDocumentCommand",
  "NewExpandableDocumentCommand",
  "RenewExpandableDocumentCommand",
]);

const VISUAL_LABEL_NEW_ENVIRONMENT_DEFINITIONS = new Set([
  "newenvironment",
  "renewenvironment",
]);

const VISUAL_LABEL_XPARSE_ENVIRONMENT_DEFINITIONS = new Set([
  "NewDocumentEnvironment",
  "RenewDocumentEnvironment",
  "ProvideDocumentEnvironment",
  "DeclareDocumentEnvironment",
]);

const VISUAL_LABEL_TEX_DEFINITIONS = new Set(["def", "gdef", "edef", "xdef"]);

function isVisualLabelDefinitionCommand(name: string): boolean {
  return VISUAL_LABEL_NEW_COMMAND_DEFINITIONS.has(name) ||
    VISUAL_LABEL_XPARSE_COMMAND_DEFINITIONS.has(name) ||
    VISUAL_LABEL_NEW_ENVIRONMENT_DEFINITIONS.has(name) ||
    VISUAL_LABEL_XPARSE_ENVIRONMENT_DEFINITIONS.has(name) ||
    VISUAL_LABEL_TEX_DEFINITIONS.has(name);
}

function skipVisualLabelDefinition(
  text: string,
  control: ParsedControl,
  limit: number,
): number | undefined {
  let cursor = control.end;
  if (text[cursor] === "*") {
    cursor += 1;
  }
  if (VISUAL_LABEL_TEX_DEFINITIONS.has(control.name)) {
    cursor = skipTrivia(text, cursor);
    const target = readControl(text, cursor);
    if (target === undefined) {
      return undefined;
    }
    cursor = target.end;
    while (cursor < limit) {
      if (text[cursor] === "%" && !isEscapedAt(text, cursor)) {
        cursor = skipComment(text, cursor);
        continue;
      }
      if (text[cursor] === "{") {
        const body = readDelimitedArgument(text, cursor, "{", "}");
        return body !== undefined && body.end <= limit ? body.end : undefined;
      }
      const nested = text[cursor] === "\\" ? readControl(text, cursor) : undefined;
      cursor = nested?.end ?? cursor + 1;
    }
    return undefined;
  }

  const target = readVisualDefinitionTarget(text, cursor);
  if (target === undefined) {
    return undefined;
  }
  cursor = target;
  if (VISUAL_LABEL_NEW_COMMAND_DEFINITIONS.has(control.name)) {
    const argumentCount = readOptionalArgument(text, cursor);
    cursor = argumentCount?.end ?? cursor;
    const optionalDefault = readOptionalArgument(text, cursor);
    cursor = optionalDefault?.end ?? cursor;
    const body = readRequiredArgument(text, cursor);
    return body !== undefined && body.end <= limit ? body.end : undefined;
  }
  if (VISUAL_LABEL_XPARSE_COMMAND_DEFINITIONS.has(control.name)) {
    const signature = readRequiredArgument(text, cursor);
    const body = signature === undefined ? undefined : readRequiredArgument(text, signature.end);
    return body !== undefined && body.end <= limit ? body.end : undefined;
  }
  if (VISUAL_LABEL_NEW_ENVIRONMENT_DEFINITIONS.has(control.name)) {
    const argumentCount = readOptionalArgument(text, cursor);
    cursor = argumentCount?.end ?? cursor;
    const optionalDefault = readOptionalArgument(text, cursor);
    cursor = optionalDefault?.end ?? cursor;
    const beginBody = readRequiredArgument(text, cursor);
    const endBody = beginBody === undefined ? undefined : readRequiredArgument(text, beginBody.end);
    return endBody !== undefined && endBody.end <= limit ? endBody.end : undefined;
  }
  const signature = readRequiredArgument(text, cursor);
  const beginBody = signature === undefined ? undefined : readRequiredArgument(text, signature.end);
  const endBody = beginBody === undefined ? undefined : readRequiredArgument(text, beginBody.end);
  return endBody !== undefined && endBody.end <= limit ? endBody.end : undefined;
}

function readVisualDefinitionTarget(text: string, requestedOffset: number): number | undefined {
  const cursor = skipTrivia(text, requestedOffset);
  const grouped = readRequiredArgument(text, cursor);
  if (grouped !== undefined) {
    return grouped.end;
  }
  return readControl(text, cursor)?.end;
}

const VISUAL_LABEL_CONDITIONAL_PRIMITIVES = new Set([
  "if",
  "ifcat",
  "ifx",
  "ifnum",
  "ifdim",
  "ifodd",
  "ifvmode",
  "ifhmode",
  "ifmmode",
  "ifinner",
  "ifvoid",
  "ifhbox",
  "ifvbox",
  "ifeof",
  "iftrue",
  "iffalse",
  "ifcase",
  "ifdefined",
  "ifcsname",
  "ifincsname",
  "ifprimitive",
]);

function isVisualLabelConditionalControl(name: string): boolean {
  return name !== "iff" &&
    (VISUAL_LABEL_CONDITIONAL_PRIMITIVES.has(name) || /^if[A-Za-z@]+$/u.test(name));
}

function skipVisualNewIfDeclaration(
  text: string,
  requestedOffset: number,
  limit: number,
): number | undefined {
  const targetStart = skipTrivia(text, requestedOffset);
  if (targetStart >= limit || text[targetStart] !== "\\") {
    return undefined;
  }
  const target = readControl(text, targetStart);
  return target !== undefined && target.end <= limit && /^if[A-Za-z@]+$/u.test(target.name)
    ? target.end
    : undefined;
}

function visualFunctionalConditionalArgumentCount(name: string): number | undefined {
  if (
    name === "ifthenelse" ||
    name === "IfFileExists" ||
    name === "InputIfFileExists"
  ) {
    return 3;
  }
  if (/^If[A-Za-z@]*TF$/u.test(name)) {
    return 3;
  }
  if (/^If[A-Za-z@]*[TF]$/u.test(name)) {
    return 2;
  }
  if (/^@if(?:package|class)later$/u.test(name)) {
    return 4;
  }
  return /^@if[A-Za-z@]+$/u.test(name) ? 3 : undefined;
}

function skipVisualFunctionalConditional(
  text: string,
  requestedOffset: number,
  limit: number,
  argumentCount: number,
): number | undefined {
  let cursor = requestedOffset;
  for (let argumentIndex = 0; argumentIndex < argumentCount; argumentIndex += 1) {
    const argument = readRequiredArgument(text, cursor);
    if (argument === undefined || argument.end > limit) {
      return undefined;
    }
    cursor = argument.end;
  }
  return cursor;
}

function skipLiteralFalseConditional(text: string, requestedOffset: number, limit: number): number {
  let depth = 1;
  let index = requestedOffset;
  while (index < limit) {
    if (text[index] === "%" && !isEscapedAt(text, index)) {
      index = skipComment(text, index);
      continue;
    }
    if (text[index] !== "\\") {
      index += 1;
      continue;
    }
    const control = readControl(text, index);
    if (control === undefined) {
      index += 1;
      continue;
    }
    if (control.name === "verb" || control.name === "verb*") {
      index = skipVerb(text, control.end);
      continue;
    }
    if (control.name === "newif") {
      index = skipVisualNewIfDeclaration(text, control.end, limit) ?? control.end;
      continue;
    }
    const functionalConditionalArguments = visualFunctionalConditionalArgumentCount(
      control.name,
    );
    if (functionalConditionalArguments !== undefined) {
      index = skipVisualFunctionalConditional(
        text,
        control.end,
        limit,
        functionalConditionalArguments,
      ) ?? limit;
      continue;
    }
    if (isVisualLabelConditionalControl(control.name)) {
      depth += 1;
    } else if (control.name === "fi") {
      depth -= 1;
      if (depth === 0) {
        return control.end;
      }
    }
    index = control.end;
  }
  return limit;
}

/** Inspect skipped branches for possible counter effects, without selecting or executing a branch. */
function visualConditionalMayChangeHeadingCounters(
  text: string,
  from: number,
  to: number,
  literalTextCommands: ReadonlySet<string>,
): boolean {
  let index = from;
  while (index < to) {
    if (text[index] === "%" && !isEscapedAt(text, index)) { index = skipComment(text, index); continue; }
    if (text[index] === "$" && !isEscapedAt(text, index)) { index = skipDollarMath(text, index); continue; }
    if (text[index] !== "\\") { index++; continue; }
    const control = readControl(text, index);
    if (control === undefined) { index++; continue; }
    if (control.name === "verb" || control.name === "verb*") { index = skipVerb(text, control.end); continue; }
    if (control.name === "detokenize" || literalTextCommands.has(control.name)) { index = readRequiredArgument(text, control.end)?.end ?? to; continue; }
    if (control.name === "(" || control.name === "[") { index = skipControlMath(text, control.end, control.name === "(" ? ")" : "]"); continue; }
    if (isVisualLabelDefinitionCommand(control.name)) {
      const targetFrom = skipTrivia(text, text[control.end] === "*" ? control.end + 1 : control.end);
      const grouped = readRequiredArgument(text, targetFrom);
      const target = readControl(text, grouped === undefined ? targetFrom : skipTrivia(text, grouped.contentFrom));
      if (target !== undefined && (isHeadingLevel(target.name) || target.name.startsWith("the") && isHeadingLevel(target.name.slice(3)))) return true;
      index = skipVisualLabelDefinition(text, control, to) ?? to;
      continue;
    }
    if (control.name === "begin") {
      const argument = readRequiredArgument(text, control.end);
      const environment = argument === undefined ? "" : text.slice(argument.contentFrom, argument.contentTo).trim();
      if (argument !== undefined && (VERBATIM_ENVIRONMENTS.has(environment) || MATH_ENVIRONMENTS.has(environment))) {
        index = skipOpaqueEnvironment(text, argument.end, environment);
        continue;
      }
    }
    if (control.name.startsWith("c@") && isHeadingLevel(control.name.slice(2))) return true;
    if (["setcounter", "addtocounter", "stepcounter", "refstepcounter", "counterwithin", "counterwithout", "numberwithin", "@addtoreset", "@removefromreset"].includes(control.name)) {
      const argument = readRequiredArgument(text, text[control.end] === "*" ? control.end + 1 : control.end);
      if (argument !== undefined && isHeadingLevel(visualPreambleWithoutComments(text.slice(argument.contentFrom, argument.contentTo)).trim())) return true;
    }
    index = control.end;
  }
  return false;
}

/** One parser for body chips and references inside folded source ranges. */
function parseVisualInlineReference(
  text: string,
  from: number,
  control: ParsedControl,
): VisualCitationRecord | VisualReferenceRecord | undefined {
  const citation = CITATION_COMMANDS.has(control.name);
  if (!citation && !REFERENCE_COMMANDS.has(control.name)) return undefined;
  let cursor = text[control.end] === "*" ? control.end + 1 : control.end;
  const optionalArguments: string[] = [];
  if (citation) {
    for (let count = 0; count < 2; count += 1) {
      const optional = readOptionalArgument(text, cursor);
      if (optional === undefined) break;
      optionalArguments.push(latexToPlainText(text.slice(optional.contentFrom, optional.contentTo))
        .slice(0, MAX_VISUAL_LABEL_KEY_LENGTH));
      cursor = optional.end;
    }
  }
  const argument = readRequiredArgument(text, cursor);
  if (argument === undefined) return undefined;
  const keys = text.slice(argument.contentFrom, argument.contentTo).split(",")
    .map(key => key.trim()).filter(key => key.length > 0 && (citation || key.length <= MAX_VISUAL_LABEL_KEY_LENGTH)).slice(0, 64);
  return citation ? {
    kind: "citation", from, to: argument.end, command: control.name, keys,
    optionalArguments, label: citationFallbackLabel(control.name, keys), previews: [],
  } : {
    kind: "reference", from, to: argument.end, command: control.name, keys,
    label: referenceFallbackLabel(control.name, keys),
  };
}

export function mapVisualRecordInlineSegments(
  record: VisualStructureRecord,
  map: (segments: readonly VisualInlineContentSegment[]) => readonly VisualInlineContentSegment[],
): VisualStructureRecord {
  const source = (value: VisualSourceText | undefined): VisualSourceText | undefined =>
    value?.segments === undefined ? value : { ...value, segments: map(value.segments) };
  if (record.kind === "footnote") return { ...record, source: source(record.source)! };
  if ((record.kind === "image" || record.kind === "figure") && record.captionSegments !== undefined) {
    return { ...record, captionSegments: map(record.captionSegments) };
  }
  if (record.kind === "theorem" && record.optionalTitleSegments !== undefined) {
    return { ...record, optionalTitleSegments: map(record.optionalTitleSegments) };
  }
  if (record.kind === "table") {
    return { ...record, captionSegments: map(record.captionSegments),
      rows: record.rows.map(row => row.map(cell => ({ ...cell, segments: map(cell.segments) }))) };
  }
  if (record.kind === "maketitle") {
    return { ...record, title: source(record.title), date: source(record.date),
      authors: record.authors.map(value => source(value)!), affiliations: record.affiliations.map(value => source(value)!),
      emails: record.emails.map(value => source(value)!),
      ...(record.frontMatter === undefined ? {} : { frontMatter: { ...record.frontMatter,
        sections: record.frontMatter.sections.map(section => ({ ...section, source: source(section.source)! })) } }),
    };
  }
  return record;
}

/** Reference controls inside a bounded formula, kept as source-backed navigation targets. */
export function visualMathReferenceRecords(text: string, from: number, to: number): readonly VisualReferenceRecord[] {
  const result: VisualReferenceRecord[] = [];
  let index = Math.max(0, from);
  while (index < Math.min(to, text.length) && result.length < 128) {
    if (text[index] === "%") { index = skipComment(text, index); continue; }
    if (text[index] !== "\\") { index++; continue; }
    const control = readControl(text, index);
    if (control === undefined) { index++; continue; }
    if (control.name === "verb") { index = skipVerb(text, control.end); continue; }
    if (control.name === "detokenize") { index = readRequiredArgument(text, control.end)?.end ?? to; continue; }
    if (isVisualLabelDefinitionCommand(control.name)) { index = skipVisualLabelDefinition(text, control, to) ?? to; continue; }
    const record = parseVisualInlineReference(text, index, control);
    if (record?.kind === "reference" && record.to <= to) { result.push(record); index = record.to; }
    else index = control.end;
  }
  return result;
}

/** Attach verified compiled numbers to body and folded reference controls alike. */
export function resolveVisualReferenceLabels(structure: VisualDocumentStructure, labels: ReadonlyMap<string, string>): VisualDocumentStructure {
  if (labels.size === 0) return structure;
  const resolve = (record: VisualReferenceRecord): VisualReferenceRecord => ({...record,
    resolvedLabels: Object.fromEntries(record.keys.flatMap(key => labels.has(key) ? [[key, labels.get(key)!]] : []))});
  return {...structure, records: structure.records.map(record => record.kind === "reference" ? resolve(record)
    : mapVisualRecordInlineSegments(record, segments => segments.map(segment => segment.kind === "reference"
      ? {...segment, reference: resolve(segment.reference)} : segment)))};
}

/** Physical-source references, including those rendered inside folded widgets. */
export function visualInlineReferenceRecords(
  structure: Pick<VisualDocumentStructure, "records">,
): readonly (VisualCitationRecord | VisualReferenceRecord)[] {
  const references = new Map<string, VisualCitationRecord | VisualReferenceRecord>();
  const add = (record: VisualCitationRecord | VisualReferenceRecord): void => {
    references.set(`${record.kind}:${record.from}:${record.to}`, record);
  };
  for (const record of structure.records) {
    if (record.kind === "citation" || record.kind === "reference") add(record);
    mapVisualRecordInlineSegments(record, segments => {
      for (const segment of segments) {
        if (segment.kind === "citation") add(segment.citation);
        else if (segment.kind === "reference") add(segment.reference);
      }
      return segments;
    });
  }
  return [...references.values()].sort((left, right) => left.from - right.from || left.to - right.to);
}

/** Attach serializable .bib metadata to citation chips and bibliography cards. */
export function resolveVisualBibliography(
  structure: VisualDocumentStructure,
  entries: readonly BibTeXEntry[],
  sourceName = "reference.bib",
): VisualDocumentStructure {
  const manualByKey = new Map<string, VisualBibliographyEntry | undefined>();
  for (const record of structure.records) {
    if (record.kind !== "bibliography" || !record.manual) continue;
    for (const entry of record.entries) {
      // Duplicate manual keys are ambiguous; do not fall back to another source.
      manualByKey.set(entry.key, manualByKey.has(entry.key) ? undefined : entry);
    }
  }
  const byKey = new Map(entries.filter((entry) => !manualByKey.has(entry.key)).map((entry) => [entry.key, entry]));
  const normalizedSourceName = sourceName.trim() || "reference.bib";
  const previewEntries = entries
    .slice(0, MAX_BIBLIOGRAPHY_PREVIEW_ENTRIES)
    .map(toVisualBibliographyEntry);
  const resolveCitation = (record: VisualCitationRecord): VisualCitationRecord => ({
    ...record,
    label: resolvedCitationLabel(record.command, record.keys, byKey),
    previews: record.keys.flatMap((key) => {
      if (manualByKey.has(key)) {
        const manual = manualByKey.get(key);
        return manual === undefined ? [] : [{ ...manual, source: "thebibliography · 已收录" }];
      }
      const entry = byKey.get(key);
      return entry === undefined ? [] : [{
        ...toVisualBibliographyEntry(entry), ...visualCitationTitlePresentation(entry, record), source: `${normalizedSourceName} · 已收录`,
      }];
    }),
  });
  return {
    ...structure,
    records: structure.records.map((record) => {
      if (record.kind === "citation") return resolveCitation(record);
      if (record.kind === "bibliography" && !record.manual) {
        return { ...record, entries: previewEntries, totalEntries: entries.length };
      }
      return mapVisualRecordInlineSegments(record, segments => segments.map(segment =>
        segment.kind === "citation" ? { ...segment, citation: resolveCitation(segment.citation) } : segment));
    }),
  };
}

function visualCitationTitlePresentation(
  entry: { readonly title: string; readonly titleLatex?: string },
  citation: VisualCitationRecord,
): Pick<VisualCitationPreview, "titleSegments"> {
  if (entry.titleLatex === undefined) return {};
  const title = parseHomeProjectTitle(entry.titleLatex);
  if (!title.segments.some(segment => segment.kind === "math")) return {};
  return { titleSegments: title.segments.map(segment => segment.kind === "text" ? segment : {
    kind: "math", math: { tex: segment.tex, fallback: segment.fallbackText,
      sourceFrom: citation.from, sourceTo: citation.to },
  }) };
}

export function detectVisualDocumentLanguage(text: string): VisualDocumentLanguage {
  const documentStart = text.search(/\\begin\s*\{document\}/u);
  const preamble = text.slice(
    0,
    Math.min(
      text.length,
      documentStart < 0 ? 200_000 : documentStart,
      200_000,
    ),
  );
  const source = visualPreambleWithoutComments(preamble);
  const thuThesis = /\\documentclass(?:\s*\[([^\]]*)\])?\s*\{\s*thuthesis\s*\}/iu.exec(
    source,
  );
  if (thuThesis !== null) {
    return /(?:^|,)\s*language\s*=\s*english\s*(?:,|$)/iu.test(thuThesis[1] ?? "")
      ? "en"
      : "zh";
  }
  return /\\documentclass(?:\s*\[[^\]]*\])?\s*\{\s*ctex(?:art|rep|book|beamer)\s*\}/iu.test(source) ||
      /\\usepackage(?:\s*\[[^\]]*\])?\s*\{[^}]*\bctex\b[^}]*\}/iu.test(source) ||
      /\\(?:setmainlanguage|setdefaultlanguage)\s*\{\s*(?:chinese|zh(?:-cn)?)\s*\}/iu.test(source) ||
      /\\usepackage\s*\[[^\]]*\b(?:chinese|zh(?:-cn)?)\b[^\]]*\]\s*\{\s*babel\s*\}/iu.test(source)
    ? "zh"
    : "en";
}

function visualHeadingNumberingRootLevel(text: string): number {
  const documentStart = text.search(/\\begin\s*\{document\}/u);
  const preamble = visualPreambleWithoutComments(text.slice(
    0,
    Math.min(
      text.length,
      documentStart < 0 ? 200_000 : documentStart,
      200_000,
    ),
  ));
  const match = /\\documentclass(?:\s*\[[^\]]*\])?\s*\{\s*([^}]+?)\s*\}/iu.exec(
    preamble,
  );
  const documentClass = match?.[1]?.trim().toLowerCase() ?? "article";
  return /^(?:book|report|memoir|ctexbook|ctexrep|thuthesis)$/u.test(documentClass)
    ? HEADING_LEVELS.chapter
    : HEADING_LEVELS.section;
}

/**
 * Number a project-wide heading stream after include expansion has established
 * its execution order. Starred headings retain their position in the returned
 * array but do not advance or reset any structural counter.
 */
export function numberVisualHeadingSequence(
  headings: readonly (Pick<VisualHeadingRecord, "command" | "starred"> & { readonly appendixStart?: boolean; readonly appendixTransitions?: readonly VisualAppendixTransition["kind"][]; readonly numberingTransitions?: readonly VisualHeadingNumberingTransition[] })[],
  numberingRoot: "chapter" | "section",
): readonly (string | undefined)[] {
  const counters = new Map<VisualHeadingLevel, number>();
  const currentNumbers = new Map<string, string>();
  const numberingRootLevel = HEADING_LEVELS[numberingRoot];
  const appendixState: VisualAppendixState = { active: false, appendixCounter: 0 };
  let known = true;
  return headings.map((heading) => {
    for (const transition of heading.numberingTransitions ?? []) {
      if ("counter" in transition) known = applyVisualHeadingCounterMutation(transition, counters, currentNumbers, numberingRootLevel, appendixState.active) && known;
      else applyVisualAppendixTransition(appendixState, transition.kind, counters, currentNumbers, numberingRootLevel);
    }
    for (const transition of heading.appendixTransitions ?? (heading.appendixStart ? ["appendix" as const] : [])) {
      applyVisualAppendixTransition(appendixState, transition, counters, currentNumbers, numberingRootLevel);
    }
    return heading.starred || !known
      ? undefined
      : nextVisualHeadingNumber(
          heading.command,
          numberingRootLevel,
          counters,
          currentNumbers,
          appendixState.active,
        );
  });
}

interface VisualAppendixState {
  active: boolean;
  appendixCounter: number;
  main?: { counter: number; number: string | undefined; active: boolean };
}

/** Mirror appendix.sty's root save/restore; descendant counters are not restored on exit. */
function applyVisualAppendixTransition(
  state: VisualAppendixState,
  transition: VisualAppendixTransition["kind"],
  counters: Map<VisualHeadingLevel, number>,
  numbers: Map<string, string>,
  rootLevel: number,
): void {
  const root = HEADING_COMMANDS_BY_LEVEL[rootLevel]!;
  if (transition === "appendix") {
    state.active = true;
    resetVisualHeadingCounters(counters, numbers, rootLevel);
  } else if (transition === "enter") {
    state.main = { counter: counters.get(root) ?? 0, number: numbers.get(root), active: state.active };
    // The package resets section, plus chapter (books) or subsection (articles).
    for (const command of [root, HEADING_COMMANDS_BY_LEVEL[rootLevel + 1]!]) {
      counters.set(command, 0);
      numbers.delete(command);
    }
    counters.set(root, state.appendixCounter);
    if (state.appendixCounter > 0) numbers.set(root, alphabeticOrdinal(state.appendixCounter, true));
    state.active = true;
  } else if (state.main !== undefined) {
    state.appendixCounter = counters.get(root) ?? 0;
    counters.set(root, state.main.counter);
    if (state.main.number === undefined) numbers.delete(root);
    else numbers.set(root, state.main.number);
    state.active = state.main.active;
    delete state.main;
  }
}

function resetVisualHeadingCounters(
  counters: Map<VisualHeadingLevel, number>,
  currentNumbers: Map<string, string>,
  rootLevel: number,
): void {
  for (const command of HEADING_COMMANDS_BY_LEVEL) {
    if (HEADING_LEVELS[command] >= rootLevel) {
      counters.delete(command);
      currentNumbers.delete(command);
    }
  }
}

function nextVisualHeadingNumber(
  command: VisualHeadingLevel,
  numberingRootLevel: number,
  counters: Map<VisualHeadingLevel, number>,
  currentNumbers: Map<string, string>,
  appendix = false,
): string {
  counters.set(command, (counters.get(command) ?? 0) + 1);
  resetVisualHeadingDescendants(command, counters, currentNumbers);
  const number = currentVisualHeadingNumber(command, numberingRootLevel, counters, appendix);
  currentNumbers.set(command, number);
  return number;
}

function resetVisualHeadingDescendants(
  command: VisualHeadingLevel,
  counters: Map<VisualHeadingLevel, number>,
  numbers: Map<string, string>,
): void {
  // Standard classes keep part independent of the chapter/section reset chain.
  if (command === "part") return;
  for (const deeper of HEADING_COMMANDS_BY_LEVEL) {
    if (HEADING_LEVELS[deeper] > HEADING_LEVELS[command]) {
      counters.set(deeper, 0);
      numbers.delete(deeper);
    }
  }
}

function currentVisualHeadingNumber(
  command: VisualHeadingLevel,
  numberingRootLevel: number,
  counters: Map<VisualHeadingLevel, number>,
  appendix: boolean,
): string {
  const level = HEADING_LEVELS[command];
  return command === "part"
    ? (counters.get(command) ?? 0) <= 0 ? "" : romanOrdinal(counters.get(command) ?? 1, MAX_VISUAL_HEADING_COUNTER + 1)
    : HEADING_COMMANDS_BY_LEVEL
        .slice(Math.min(level, numberingRootLevel), level + 1)
        .map((name) => appendix && HEADING_LEVELS[name] === numberingRootLevel
          ? (counters.get(name) ?? 0) > 0 ? alphabeticOrdinal(counters.get(name)!, true) : ""
          : String(counters.get(name) ?? 0))
        .join(".");
}

function applyVisualHeadingCounterMutation(
  mutation: VisualHeadingCounterMutation,
  counters: Map<VisualHeadingLevel, number>,
  numbers: Map<string, string>,
  numberingRootLevel: number,
  appendix: boolean,
): boolean {
  const value = mutation.kind === "set" ? mutation.value : (counters.get(mutation.counter) ?? 0) + mutation.value;
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_VISUAL_HEADING_COUNTER) return false;
  counters.set(mutation.counter, value);
  if (mutation.kind === "step") resetVisualHeadingDescendants(mutation.counter, counters, numbers);
  // Assignments change the printed prefix immediately, without resetting child counters.
  for (const command of HEADING_COMMANDS_BY_LEVEL) {
    if (command === mutation.counter || numbers.has(command)) {
      numbers.set(command, currentVisualHeadingNumber(command, numberingRootLevel, counters, appendix));
    }
  }
  return true;
}

function nextVisualTheoremNumber(
  environment: string,
  definition: TheoremDefinition,
  counters: Map<string, VisualTheoremCounterState>,
  currentHeadingNumbers: ReadonlyMap<string, string>,
): string | undefined {
  if (definition.numbered === false || definition.style === "proof") {
    return undefined;
  }
  const counter = definition.counter ?? environment;
  const withinNumber = definition.within === undefined
    ? undefined
    : currentHeadingNumbers.get(definition.within) ?? "0";
  let state = counters.get(counter);
  if (state === undefined || state.withinNumber !== withinNumber) {
    state = { value: 0, withinNumber };
    counters.set(counter, state);
  }
  state.value += 1;
  return withinNumber === undefined
    ? String(state.value)
    : `${withinNumber}.${state.value}`;
}

function visualPreambleWithoutComments(value: string): string {
  let output = "";
  let index = 0;
  while (index < value.length) {
    if (value[index] === "%" && !isEscapedAt(value, index)) {
      const next = skipComment(value, index);
      output += value.slice(index, next).replace(/[^\r\n]/gu, " ");
      index = next;
      continue;
    }
    output += value[index];
    index += 1;
  }
  return output;
}

function defaultTheoremDefinitions(
  language: VisualDocumentLanguage,
): Map<string, TheoremDefinition> {
  if (language === "zh") {
    return new Map<string, TheoremDefinition>([
      ["theorem", { label: "定理", style: "plain" }],
      ["lemma", { label: "引理", style: "plain" }],
      ["proposition", { label: "命题", style: "plain" }],
      ["corollary", { label: "推论", style: "plain" }],
      ["conjecture", { label: "猜想", style: "plain" }],
      ["claim", { label: "断言", style: "plain" }],
      ["axiom", { label: "公理", style: "plain" }],
      ["assumption", { label: "假设", style: "plain" }],
      ["definition", { label: "定义", style: "definition" }],
      ["example", { label: "例", style: "definition" }],
      ["exercise", { label: "练习", style: "definition" }],
      ["problem", { label: "问题", style: "definition" }],
      ["question", { label: "问题", style: "definition" }],
      ["solution", { label: "解", style: "definition" }],
      ["remark", { label: "注", style: "remark" }],
      ["notation", { label: "记号", style: "remark" }],
      ["observation", { label: "观察", style: "remark" }],
      ["proof", { label: "证明", style: "proof" }],
    ]);
  }
  return new Map<string, TheoremDefinition>([
    ["theorem", { label: "Theorem", style: "plain" }],
    ["lemma", { label: "Lemma", style: "plain" }],
    ["proposition", { label: "Proposition", style: "plain" }],
    ["corollary", { label: "Corollary", style: "plain" }],
    ["conjecture", { label: "Conjecture", style: "plain" }],
    ["claim", { label: "Claim", style: "plain" }],
    ["axiom", { label: "Axiom", style: "plain" }],
    ["assumption", { label: "Assumption", style: "plain" }],
    ["definition", { label: "Definition", style: "definition" }],
    ["example", { label: "Example", style: "definition" }],
    ["exercise", { label: "Exercise", style: "definition" }],
    ["problem", { label: "Problem", style: "definition" }],
    ["question", { label: "Question", style: "definition" }],
    ["solution", { label: "Solution", style: "definition" }],
    ["remark", { label: "Remark", style: "remark" }],
    ["notation", { label: "Notation", style: "remark" }],
    ["observation", { label: "Observation", style: "remark" }],
    ["proof", { label: "Proof", style: "proof" }],
  ]);
}

function visualListMarker(
  listKind: VisualListKind,
  itemLabel: string,
  ordinal: number,
  labelTemplate: string | undefined,
): string {
  if (listKind === "itemize") {
    return itemLabel || "•";
  }
  if (listKind === "description") {
    return `${itemLabel || "项目"}:`;
  }
  if (itemLabel.length > 0) {
    return itemLabel;
  }
  return formatEnumerateLabel(labelTemplate, ordinal);
}

function formatEnumerateLabel(
  rawTemplate: string | undefined,
  ordinal: number,
): string {
  if (rawTemplate === undefined || rawTemplate.trim().length === 0) {
    return `${ordinal}.`;
  }
  let template = enumitemLabelTemplate(rawTemplate.trim());
  template = stripBalancedOuterBraces(template);
  const replacements: readonly [RegExp, string][] = [
    [/\\arabic\s*(?:\*|\{\s*\*\s*\})/gu, String(ordinal)],
    [/\\alph\s*(?:\*|\{\s*\*\s*\})/gu, alphabeticOrdinal(ordinal, false)],
    [/\\Alph\s*(?:\*|\{\s*\*\s*\})/gu, alphabeticOrdinal(ordinal, true)],
    [/\\roman\s*(?:\*|\{\s*\*\s*\})/gu, romanOrdinal(ordinal).toLowerCase()],
    [/\\Roman\s*(?:\*|\{\s*\*\s*\})/gu, romanOrdinal(ordinal)],
  ];
  let replaced = template;
  let recognized = false;
  for (const [pattern, value] of replacements) {
    const next = replaced.replace(pattern, () => {
      recognized = true;
      return value;
    });
    replaced = next;
  }
  if (!recognized) {
    const legacy = /^([^A-Za-z0-9]*)(1|a|A|i|I)([^A-Za-z0-9]*)$/u.exec(
      latexToPlainText(template),
    );
    if (legacy !== null) {
      const token = legacy[2];
      const value = token === "1"
        ? String(ordinal)
        : token === "a"
          ? alphabeticOrdinal(ordinal, false)
          : token === "A"
            ? alphabeticOrdinal(ordinal, true)
            : token === "i"
              ? romanOrdinal(ordinal).toLowerCase()
              : romanOrdinal(ordinal);
      return `${legacy[1] ?? ""}${value}${legacy[3] ?? ""}`;
    }
  }
  const plain = latexToPlainText(replaced);
  return plain.length > 0 ? plain : `${ordinal}.`;
}

function enumitemLabelTemplate(options: string): string {
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= options.length; index += 1) {
    const character = options[index];
    if (character === "{" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === "]") {
      depth = Math.max(0, depth - 1);
    }
    if ((character === "," && depth === 0) || index === options.length) {
      const option = options.slice(start, index).trim();
      const equals = option.indexOf("=");
      if (equals >= 0 && option.slice(0, equals).trim() === "label") {
        return option.slice(equals + 1).trim();
      }
      start = index + 1;
    }
  }
  return options;
}

function stripBalancedOuterBraces(value: string): string {
  let result = value.trim();
  while (result.startsWith("{") && result.endsWith("}")) {
    const argument = readDelimitedArgument(result, 0, "{", "}");
    if (argument?.end !== result.length) {
      break;
    }
    result = result.slice(1, -1).trim();
  }
  return result;
}

function alphabeticOrdinal(value: number, upper: boolean): string {
  let current = Math.max(1, Math.trunc(value));
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode((upper ? 65 : 97) + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function romanOrdinal(value: number, maximum = 3_999): string {
  let current = Math.max(1, Math.min(maximum, Math.trunc(value)));
  let result = "";
  for (const [amount, numeral] of [
    [1_000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ] as const) {
    while (current >= amount) {
      result += numeral;
      current -= amount;
    }
  }
  return result;
}

/** Literal wrappers reuse the existing source-backed statement presentation. */
function parseStaticBoxEnvironment(text: string, offset: number): { environment: string; definition: TheoremDefinition } | undefined {
  const name = readRequiredArgument(text, offset);
  const count = name === undefined ? undefined : readOptionalArgument(text, name.end);
  const begin = name === undefined ? undefined : readRequiredArgument(text, count?.end ?? name.end);
  const end = begin === undefined ? undefined : readRequiredArgument(text, begin.end);
  if (name === undefined || begin === undefined || end === undefined) return undefined;
  const environment = text.slice(name.contentFrom, name.contentTo).trim();
  const args = count === undefined ? "0" : text.slice(count.contentFrom, count.contentTo).trim();
  if (!/^[A-Za-z@][A-Za-z0-9@*:-]{0,63}$/u.test(environment) || !/^[01]$/u.test(args)) return undefined;
  const opening = /^\s*\\begin\s*\{tcolorbox\}\s*(?:\[([^\]]*)\])?\s*$/u.exec(text.slice(begin.contentFrom, begin.contentTo));
  if (opening === null || !/^\s*\\end\s*\{tcolorbox\}\s*$/u.test(text.slice(end.contentFrom, end.contentTo))) return undefined;
  const title = /(?:^|,)\s*title\s*=\s*\{([^{}]*)\}/u.exec(opening[1] ?? "")?.[1] ?? "";
  if (args === "1" ? title !== "#1" : /[#\\]/u.test(title)) return undefined;
  return { environment, definition: { label: title || "文本框", style: "definition", numbered: false,
    staticBox: true, ...(args === "1" ? {requiredHeading: true} : {}) } };
}

function parseStaticBoxCommand(text: string, control: ParsedControl, definitions: ReadonlyMap<string, TheoremDefinition>):
  { name: string; environment: string; label?: string | undefined } | undefined {
  if (!["newcommand", "renewcommand", "providecommand"].includes(control.name)) return undefined;
  const name = readRequiredArgument(text, text[control.end] === "*" ? control.end + 1 : control.end);
  const count = name === undefined ? undefined : readOptionalArgument(text, name.end);
  const body = count === undefined ? undefined : readRequiredArgument(text, count.end);
  if (name === undefined || count === undefined || body === undefined || text.slice(count.contentFrom, count.contentTo).trim() !== "1") return undefined;
  const command = /^\\([A-Za-z@]+)$/u.exec(text.slice(name.contentFrom, name.contentTo).trim())?.[1];
  const wrapper = /^\s*\\begin\s*\{([A-Za-z@][A-Za-z0-9@*:-]*)\}\s*(?:\{([^{}\\#]*)\})?\s*#1\s*\\end\s*\{\1\}\s*$/u.exec(text.slice(body.contentFrom, body.contentTo));
  const definition = wrapper === null ? undefined : definitions.get(wrapper[1]!);
  if (command === undefined || definition?.staticBox !== true || (definition.requiredHeading && wrapper?.[2] === undefined)) return undefined;
  return {name: command, environment: wrapper![1]!, label: wrapper?.[2]};
}

function parseTrivlistStatement(
  text: string,
  offset: number,
): { readonly environment: string; readonly definition: TheoremDefinition } | undefined {
  const name = readRequiredArgument(text, offset);
  const count = name === undefined ? undefined : readOptionalArgument(text, name.end);
  const heading = count === undefined ? undefined : readOptionalArgument(text, count.end);
  const begin = heading === undefined ? undefined : readRequiredArgument(text, heading.end);
  const end = begin === undefined ? undefined : readRequiredArgument(text, begin.end);
  if (name === undefined || count === undefined || heading === undefined || begin === undefined || end === undefined ||
    text.slice(count.contentFrom, count.contentTo).trim() !== "1") return undefined;
  const environment = text.slice(name.contentFrom, name.contentTo).trim();
  if (!/^[A-Za-z@][A-Za-z0-9@*:-]{0,63}$/u.test(environment)) return undefined;
  const opening = text.slice(begin.contentFrom, begin.contentTo).trim();
  const closing = text.slice(end.contentFrom, end.contentTo).trim();
  // ponytail: recognize literal trivlist headings; retain source for dynamic environment programs.
  if (!/^\\begin\s*\{trivlist\}\s*\\item\s*\[\s*\\hskip\s*\\labelsep\s*\{\s*\\bfseries\s+#1\s*\}\s*\]\s*(?:\\(?:it|itshape)\s*)?$/u.test(opening) ||
    !/^\\end\s*\{trivlist\}$/u.test(closing)) return undefined;
  return { environment, definition: {
    label: latexToPlainText(text.slice(heading.contentFrom, heading.contentTo)),
    style: /\\(?:it|itshape)\b/u.test(opening) ? "plain" : "remark",
    numbered: false,
    optionalHeading: true,
  } };
}

function parseNewTheorem(
  text: string,
  offset: number,
  style: VisualTheoremStyle,
): { readonly environment: string; readonly definition: TheoremDefinition; readonly end: number } | undefined {
  const starred = text[offset] === "*";
  const afterStar = starred ? offset + 1 : offset;
  const environment = readRequiredArgument(text, afterStar);
  if (environment === undefined) {
    return undefined;
  }
  const sharedCounter = readOptionalArgument(text, environment.end);
  const label = readRequiredArgument(text, sharedCounter?.end ?? environment.end);
  if (label === undefined) {
    return undefined;
  }
  const within = readOptionalArgument(text, label.end);
  const environmentName = text
    .slice(environment.contentFrom, environment.contentTo)
    .trim();
  if (!/^[A-Za-z@*][A-Za-z0-9@*:-]{0,63}$/u.test(environmentName)) {
    return undefined;
  }
  const sharedCounterName = sharedCounter === undefined
    ? undefined
    : text.slice(sharedCounter.contentFrom, sharedCounter.contentTo).trim();
  const withinName = within === undefined
    ? undefined
    : text.slice(within.contentFrom, within.contentTo).trim();
  if (
    (sharedCounterName !== undefined &&
      !/^[A-Za-z@][A-Za-z0-9@:-]{0,63}$/u.test(sharedCounterName)) ||
    (withinName !== undefined &&
      !/^[A-Za-z@][A-Za-z0-9@:-]{0,63}$/u.test(withinName))
  ) {
    return undefined;
  }
  return {
    environment: environmentName,
    definition: {
      label: latexToPlainText(text.slice(label.contentFrom, label.contentTo)) || environmentName,
      style,
      numbered: !starred,
      counter: sharedCounterName ?? environmentName,
      ...(withinName === undefined ? {} : { within: withinName }),
    },
    end: within?.end ?? label.end,
  };
}

function hasExplicitVisualDocumentStart(text: string): boolean {
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === "%" && !isEscapedAt(text, index)) {
      index = skipComment(text, index);
      continue;
    }
    if (character === "$" && !isEscapedAt(text, index)) {
      index = skipDollarMath(text, index);
      continue;
    }
    if (character !== "\\") {
      index += 1;
      continue;
    }
    const control = readControl(text, index);
    if (control === undefined) {
      index += 1;
      continue;
    }
    if (control.name === "verb" || control.name === "verb*") {
      index = skipVerb(text, control.end);
      continue;
    }
    if (control.name === "begin") {
      const environment = readRequiredArgument(text, control.end);
      if (
        environment !== undefined &&
        text.slice(environment.contentFrom, environment.contentTo).trim() === "document"
      ) {
        return true;
      }
      index = environment?.end ?? control.end;
      continue;
    }
    index = control.end;
  }
  return false;
}

function readControl(text: string, offset: number): ParsedControl | undefined {
  if (text[offset] !== "\\" || offset + 1 >= text.length) {
    return undefined;
  }
  let end = offset + 1;
  const first = text[end];
  if (first === undefined) {
    return undefined;
  }
  if (/[A-Za-z@]/u.test(first)) {
    end += 1;
    while (end < text.length && /[A-Za-z@]/u.test(text[end] ?? "")) {
      end += 1;
    }
  } else {
    end += 1;
  }
  let name = text.slice(offset + 1, end);
  if (name === "verb" && text[end] === "*") {
    name = "verb*";
    end += 1;
  }
  return { name, end };
}

function readRequiredArgument(text: string, offset: number): ParsedArgument | undefined {
  return readDelimitedArgument(text, skipTrivia(text, offset), "{", "}");
}

function readOptionalArgument(text: string, offset: number): ParsedArgument | undefined {
  return readDelimitedArgument(text, skipTrivia(text, offset), "[", "]");
}

function readDelimitedArgument(
  text: string,
  offset: number,
  open: string,
  close: string,
): ParsedArgument | undefined {
  if (text[offset] !== open) {
    return undefined;
  }
  let depth = 1;
  let index = offset + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === "%" && !isEscapedAt(text, index)) {
      index = skipComment(text, index);
      continue;
    }
    if (character === "\\") {
      const control = readControl(text, index);
      index = control?.end ?? index + 1;
      continue;
    }
    if (open !== "{" && character === "{") {
      const group = readDelimitedArgument(text, index, "{", "}");
      if (group === undefined) return undefined;
      index = group.end;
      continue;
    }
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          from: offset,
          to: index + 1,
          contentFrom: offset + 1,
          contentTo: index,
          end: index + 1,
        };
      }
    }
    index += 1;
  }
  return undefined;
}

function skipTrivia(text: string, offset: number): number {
  let index = offset;
  while (index < text.length) {
    if (/\s/u.test(text[index] ?? "")) {
      index += 1;
      continue;
    }
    if (text[index] === "%" && !isEscapedAt(text, index)) {
      index = skipComment(text, index);
      continue;
    }
    break;
  }
  return index;
}

function skipComment(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset);
  return newline < 0 ? text.length : newline + 1;
}

function skipVerb(text: string, offset: number): number {
  const delimiter = text[offset];
  if (delimiter === undefined || /\s/u.test(delimiter)) {
    return offset;
  }
  const end = text.indexOf(delimiter, offset + 1);
  return end < 0 ? text.length : end + 1;
}

function skipDollarMath(text: string, offset: number): number {
  const delimiter = text[offset + 1] === "$" ? "$$" : "$";
  let index = offset + delimiter.length;
  while (index < text.length) {
    const next = text.indexOf(delimiter, index);
    if (next < 0) {
      return text.length;
    }
    if (!isEscapedAt(text, next)) {
      return next + delimiter.length;
    }
    index = next + delimiter.length;
  }
  return text.length;
}

function skipControlMath(text: string, offset: number, closingName: string): number {
  let index = offset;
  while (index < text.length) {
    const next = text.indexOf("\\", index);
    if (next < 0) {
      return text.length;
    }
    const control = readControl(text, next);
    if (control?.name === closingName) {
      return control.end;
    }
    index = control?.end ?? next + 1;
  }
  return text.length;
}

function skipEnvironment(text: string, offset: number, environment: string): number {
  let index = offset;
  let depth = 1;
  while (index < text.length) {
    const next = text.indexOf("\\", index);
    if (next < 0) {
      return text.length;
    }
    if (text[next - 1] === "%" && !isEscapedAt(text, next - 1)) {
      index = skipComment(text, next - 1);
      continue;
    }
    const control = readControl(text, next);
    if (control?.name !== "begin" && control?.name !== "end") {
      index = control?.end ?? next + 1;
      continue;
    }
    const argument = readRequiredArgument(text, control.end);
    if (argument === undefined) {
      index = control.end;
      continue;
    }
    if (text.slice(argument.contentFrom, argument.contentTo).trim() === environment) {
      depth += control.name === "begin" ? 1 : -1;
      if (depth === 0) {
        return argument.end;
      }
    }
    index = argument.end;
  }
  return text.length;
}

interface VisualEnvironmentEndRange {
  readonly from: number;
  readonly to: number;
}

function findMatchingEnvironmentEnd(
  text: string,
  offset: number,
  environment: string,
): VisualEnvironmentEndRange | undefined {
  let index = offset;
  let depth = 1;
  while (index < text.length) {
    const character = text[index];
    if (character === "%" && !isEscapedAt(text, index)) {
      index = skipComment(text, index);
      continue;
    }
    if (character !== "\\") {
      index += 1;
      continue;
    }
    const control = readControl(text, index);
    if (control?.name !== "begin" && control?.name !== "end") {
      index = control?.end ?? index + 1;
      continue;
    }
    const argument = readRequiredArgument(text, control.end);
    if (argument === undefined) {
      index = control.end;
      continue;
    }
    if (text.slice(argument.contentFrom, argument.contentTo).trim() === environment) {
      depth += control.name === "begin" ? 1 : -1;
      if (depth === 0) {
        return { from: index, to: argument.end };
      }
    }
    index = argument.end;
  }
  return undefined;
}

function parseVisualKeywordsCommand(
  text: string,
  commandFrom: number,
  control: ParsedControl,
  language: VisualDocumentLanguage,
): VisualKeywordsRecord | undefined {
  const keywords = KEYWORDS_COMMANDS.has(control.name);
  const classification = CLASSIFICATION_COMMANDS.has(control.name);
  if (!keywords && !classification) {
    return undefined;
  }
  const optional = readOptionalArgument(text, control.end);
  const argument = readRequiredArgument(text, optional?.end ?? control.end);
  if (argument === undefined) {
    return undefined;
  }
  const value = latexMetadataToPlainText(
    text.slice(argument.contentFrom, argument.contentTo),
  );
  const role: VisualKeywordsRole = classification ? "classification" : "keywords";
  let label: string;
  if (role === "keywords") {
    label = language === "zh" ? "关键词" : "Keywords";
  } else {
    const year = optional === undefined
      ? ""
      : latexMetadataToPlainText(
          text.slice(optional.contentFrom, optional.contentTo),
        ).trim();
    const base = language === "zh"
      ? "数学主题分类"
      : "Mathematics Subject Classification";
    label = year.length > 0 ? `${year} ${base}` : base;
  }
  return {
    kind: "keywords",
    language,
    role,
    label,
    value,
    replacement: lineAwareReplacement(text, commandFrom, argument.end),
  };
}

function parseVisualKeywordLine(
  text: string,
  commandFrom: number,
  language: VisualDocumentLanguage,
): VisualKeywordsRecord | undefined {
  const lineStart = text.lastIndexOf("\n", Math.max(0, commandFrom - 1)) + 1;
  if (text.slice(lineStart, commandFrom).trim().length > 0) {
    return undefined;
  }
  const newline = text.indexOf("\n", commandFrom);
  const lineEnd = newline < 0 ? text.length : newline;
  const plain = latexMetadataToPlainText(text.slice(commandFrom, lineEnd));
  const match = /^(Keywords?|Key\s+words|关键词|關鍵詞|(?:(?:19|20)\d{2}\s+)?Mathematics\s+Subject\s+Classification|(?:AMS\s+)?MSC)\s*[:：]\s*(.+)$/iu.exec(
    plain,
  );
  if (match === null) {
    return undefined;
  }
  const rawLabel = match[1]?.trim() ?? "";
  const value = match[2]?.trim() ?? "";
  if (value.length === 0) {
    return undefined;
  }
  const role: VisualKeywordsRole = /^(?:Keywords?|Key\s+words|关键词|關鍵詞)$/iu.test(
    rawLabel,
  )
    ? "keywords"
    : "classification";
  const label = role === "keywords"
    ? language === "zh" ? "关键词" : "Keywords"
    : /Mathematics\s+Subject\s+Classification/iu.test(rawLabel)
    ? rawLabel
    : language === "zh" ? "数学主题分类" : "Mathematics Subject Classification";
  return {
    kind: "keywords",
    language,
    role,
    label,
    value,
    replacement: lineAwareReplacement(text, commandFrom, lineEnd),
  };
}

function latexMetadataToPlainText(value: string): string {
  return latexToPlainText(
    value.replace(
      /\\(LaTeX|TeX|BibTeX|XeTeX|XeLaTeX|LuaTeX|LuaLaTeX)(?![A-Za-z@])/gu,
      "$1",
    ),
  );
}

function lineAwareReplacement(
  text: string,
  sourceFrom: number,
  sourceTo: number,
): VisualReplacementRange {
  const lineStart = text.lastIndexOf("\n", Math.max(0, sourceFrom - 1)) + 1;
  const newline = text.indexOf("\n", sourceTo);
  const lineEnd = newline < 0 ? text.length : newline;
  const prefix = text.slice(lineStart, sourceFrom);
  const suffix = text.slice(sourceTo, lineEnd);
  const suffixWithoutComment = suffix.replace(/%[\s\S]*$/u, "");
  const standalone = prefix.trim().length === 0 && suffixWithoutComment.trim().length === 0;
  return {
    from: standalone ? lineStart : sourceFrom,
    to: standalone && newline >= 0 ? newline + 1 : standalone ? lineEnd : sourceTo,
    sourceFrom,
    sourceTo,
    block: standalone,
  };
}

/**
 * A command-style Beamer frame may put its opening command, body and closing
 * brace on the same physical source line. Block widgets split that line into
 * separate CodeMirror rows. If the indentation before `\\frame` or the
 * trailing whitespace after its closing brace is left outside the block
 * replacement, CodeMirror renders a blank source row beyond the visible slide
 * header/footer and attaches the frame line rail to it. Consume only those
 * whitespace-only outer fragments while preserving the body byte-for-byte.
 */
function commandFrameBoundaryReplacement(
  text: string,
  sourceFrom: number,
  sourceTo: number,
  boundary: "begin" | "end",
): VisualReplacementRange {
  const replacement = lineAwareReplacement(text, sourceFrom, sourceTo);
  const lineStart = text.lastIndexOf("\n", Math.max(0, sourceFrom - 1)) + 1;
  const newline = text.indexOf("\n", sourceTo);
  const lineEnd = newline < 0 ? text.length : newline;

  if (boundary === "begin") {
    const prefix = text.slice(lineStart, sourceFrom);
    const suffix = text.slice(sourceTo, lineEnd);
    const suffixWithoutComment = suffix.replace(/%[\s\S]*$/u, "");
    return {
      ...replacement,
      from: prefix.trim().length === 0 ? lineStart : replacement.from,
      to: suffixWithoutComment.trim().length === 0
        ? newline < 0 ? lineEnd : newline + 1
        : replacement.to,
      block: true,
    };
  }

  const suffix = text.slice(sourceTo, lineEnd);
  const suffixWithoutComment = suffix.replace(/%[\s\S]*$/u, "");
  return {
    ...replacement,
    to: suffixWithoutComment.trim().length === 0
      ? newline < 0 ? lineEnd : newline + 1
      : replacement.to,
    block: true,
  };
}

function readImmediateLabelsOnLine(
  text: string,
  offset: number,
): readonly VisualLabelRecord[] {
  const records: VisualLabelRecord[] = [];
  let cursor = offset;
  while (cursor < text.length) {
    while (text[cursor] === " " || text[cursor] === "\t") {
      cursor += 1;
    }
    if (text[cursor] === "\n" || text[cursor] === "\r") {
      break;
    }
    const control = readControl(text, cursor);
    if (control?.name !== "label") {
      break;
    }
    const argument = readRequiredArgument(text, control.end);
    if (argument === undefined) {
      break;
    }
    const key = text.slice(argument.contentFrom, argument.contentTo).trim();
    if (key.length === 0 || key.length > MAX_VISUAL_LABEL_KEY_LENGTH) {
      break;
    }
    records.push({
      kind: "label",
      from: cursor,
      to: argument.end,
      key,
      replacement: lineAwareReplacement(text, cursor, argument.end),
    });
    cursor = argument.end;
  }
  return records;
}

interface VisualEnvironmentBounds {
  readonly contentFrom: number;
  readonly endFrom: number;
  readonly endTo: number;
}

function transparentVisualTextStyle(
  command: string,
  from: number,
  to: number,
  prefixFrom: number,
  prefixTo: number,
  contentFrom: number,
  contentTo: number,
  suffixFrom: number,
  suffixTo: number,
  editLabel: string,
): VisualTextStyleRecord {
  return {
    kind: "textStyle",
    command,
    from,
    to,
    prefixFrom,
    prefixTo,
    contentFrom,
    contentTo,
    suffixFrom,
    suffixTo,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    smallCaps: false,
    foreground: undefined,
    background: undefined,
    border: undefined,
    transparent: true,
    editLabel,
  };
}

function parseVisualTransparentEnvironment(
  text: string,
  from: number,
  beginTo: number,
  environment: string,
): VisualTextStyleRecord | undefined {
  let contentFrom = beginTo;
  if (environment === "columns" || environment === "column") {
    const options = readOptionalArgument(text, beginTo);
    const value = options === undefined ? "" : text.slice(options.contentFrom, options.contentTo).trim();
    if (value && !value.split(",").every(option => /^(?:[tTcb]|onlytextwidth|totalwidth\s*=\s*(?:\d+(?:\.\d*)?|\.\d+)\\textwidth)$/u.test(option.trim()))) return undefined;
    contentFrom = options?.end ?? beginTo;
    if (environment === "column") {
      const width = readRequiredArgument(text, contentFrom);
      if (width === undefined || !/^(?:\d+(?:\.\d*)?|\.\d+)\s*(?:\\(?:textwidth|linewidth)|pt|cm|mm|in|em)$/u.test(text.slice(width.contentFrom, width.contentTo).trim())) return undefined;
      contentFrom = width.end;
    }
  }
  if (environment === "multicols") {
    const columns = readRequiredArgument(text, beginTo);
    const count = columns === undefined ? "" : text.slice(columns.contentFrom, columns.contentTo).trim();
    if (columns === undefined || !/^\d+$/u.test(count) || !Number.isSafeInteger(Number(count)) || Number(count) < 2 ||
      readOptionalArgument(text, columns.end) !== undefined) {
      return undefined;
    }
    contentFrom = columns.end;
  }
  const end = findMatchingEnvironmentEnd(text, contentFrom, environment);
  return end === undefined
    ? undefined
    : transparentVisualTextStyle(
        environment,
        from,
        end.to,
        from,
        contentFrom,
        contentFrom,
        end.from,
        end.from,
        end.to,
        `编辑 ${environment}`,
      );
}

function staticVisualLayoutCommandEnd(text: string, control: ParsedControl): number | undefined {
  if (control.name !== "setlength" && control.name !== "setcounter") return undefined;
  const target = readRequiredArgument(text, control.end);
  const value = target === undefined ? undefined : readRequiredArgument(text, target.end);
  if (target === undefined || value === undefined) return undefined;
  const name = text.slice(target.contentFrom, target.contentTo).trim();
  const literal = text.slice(value.contentFrom, value.contentTo).trim();
  if (control.name === "setcounter") {
    // Page numbers do not change the continuous prose view. Structural and
    // dynamic counters remain source because they affect visible numbering.
    return name === "page" && /^[+-]?\d+$/u.test(literal) && Number.isSafeInteger(Number(literal))
      ? value.end : undefined;
  }
  return /^\\(?:itemsep|parsep|topsep|partopsep|parskip|parindent|columnsep)$/u.test(name) &&
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex)$/u.test(literal)
    ? value.end : undefined;
}

function parseVisualTransparentSizeDeclaration(
  text: string,
  from: number,
  control: ParsedControl,
  namedColors: ReadonlyMap<string, string>,
): VisualTextStyleRecord | undefined {
  if (!TRANSPARENT_VISUAL_SIZE_DECLARATIONS.has(control.name)) return undefined;
  let groupFrom = from - 1;
  while (groupFrom >= 0 && /\s/u.test(text[groupFrom]!)) groupFrom -= 1;
  if (text[groupFrom] !== "{") return undefined;
  const group = readDelimitedArgument(text, groupFrom, "{", "}");
  if (group === undefined || group.contentTo < control.end) return undefined;
  const sizes: Record<string, number> = { tiny: .5, scriptsize: .65, footnotesize: .8, small: .9,
    normalsize: 1, large: 1.2, Large: 1.44, LARGE: 1.73, huge: 2.07, Huge: 2.49 };
  let cursor = from, fontSize: number | undefined, lineHeight: number | undefined, foreground: string | undefined;
  let bold = false, italic = false, smallCaps = false;
  while (cursor < group.contentTo) {
    const declaration = readControl(text, cursor);
    if (declaration === undefined) break;
    let end = declaration.end;
    if (declaration.name === "fontsize") {
      const size = readRequiredArgument(text, end);
      const leading = size === undefined ? undefined : readRequiredArgument(text, size.end);
      if (size === undefined || leading === undefined) return undefined;
      const number = (argument: ParsedArgument): number => {
        const value = text.slice(argument.contentFrom, argument.contentTo).trim();
        return /^(?:\d+(?:\.\d*)?|\.\d+)(?:pt)?$/u.test(value) ? Number(value.replace(/pt$/u, "")) : NaN;
      };
      const points = number(size), baseline = number(leading);
      if (!(points >= 5 && points <= 72 && baseline >= points && baseline <= points * 3)) return undefined;
      fontSize = points / 12;
      lineHeight = baseline / points;
      end = leading.end;
    } else if (declaration.name === "color") {
      const model = readOptionalArgument(text, end);
      const color = readRequiredArgument(text, model?.end ?? end);
      if (color === undefined) return undefined;
      foreground = visualCssColor(text.slice(color.contentFrom, color.contentTo), model === undefined ? undefined : text.slice(model.contentFrom, model.contentTo), namedColors);
      if (foreground === undefined) return undefined;
      end = color.end;
    } else if (declaration.name === "bfseries") bold = true;
    else if (["itshape", "slshape"].includes(declaration.name)) italic = true;
    else if (declaration.name === "scshape") smallCaps = true;
    else if (sizes[declaration.name] !== undefined) fontSize = sizes[declaration.name];
    else if (!["selectfont", "noindent", "rm"].includes(declaration.name)) break;
    cursor = end;
    while (cursor < group.contentTo && /\s/u.test(text[cursor]!)) cursor += 1;
  }
  if (cursor === from) return undefined;
  const trailing = /\\par\s*$/u.exec(text.slice(cursor, group.contentTo));
  const contentTo = trailing === null || isEscapedAt(text, cursor + trailing.index)
    ? group.contentTo : cursor + trailing.index;
  return { ...transparentVisualTextStyle(control.name, groupFrom, group.end, groupFrom, cursor,
    cursor, contentTo, contentTo, group.end, `编辑 \\${control.name}`),
    bold, italic, smallCaps, foreground, ...(fontSize === undefined ? {} : {fontSize}),
    ...(lineHeight === undefined ? {} : {lineHeight}) };
}

function parseStaticTextStyleCommand(text: string, control: ParsedControl): {name: string; group: string} | undefined {
  if (!["newcommand", "renewcommand", "providecommand"].includes(control.name)) return undefined;
  const name = readRequiredArgument(text, text[control.end] === "*" ? control.end + 1 : control.end);
  const count = name === undefined ? undefined : readOptionalArgument(text, name.end);
  const body = count === undefined ? undefined : readRequiredArgument(text, count.end);
  if (name === undefined || count === undefined || body === undefined || text.slice(count.contentFrom, count.contentTo).trim() !== "1") return undefined;
  const command = /^\\([A-Za-z@]+)$/u.exec(text.slice(name.contentFrom, name.contentTo).trim())?.[1];
  // ponytail: literal one-argument formatting wrappers only; dynamic TeX remains source.
  const wrapper = /^\s*(?:\\(?:par|vfill)\s*)*(\{[^#]*#1\s*(?:\\par\s*)?\})\s*$/u.exec(text.slice(body.contentFrom, body.contentTo));
  return command === undefined || wrapper === null ? undefined : {name: command, group: wrapper[1]!};
}

function parseVisualTextStyle(
  text: string,
  from: number,
  control: ParsedControl,
  namedColors: ReadonlyMap<string, string>,
  beamer: boolean,
): VisualTextStyleRecord | undefined {
  if (control.name === "texorpdfstring" || control.name === "href") {
    const optional = control.name === "href" ? readOptionalArgument(text, control.end) : undefined;
    const first = readRequiredArgument(text, optional?.end ?? control.end);
    const second = first === undefined
      ? undefined
      : readRequiredArgument(text, first.end);
    if (first === undefined || second === undefined) {
      return undefined;
    }
    const visual = control.name === "href" ? second : first;
    return {
      kind: "textStyle",
      command: control.name,
      from,
      to: second.end,
      prefixFrom: from,
      prefixTo: visual.contentFrom,
      contentFrom: visual.contentFrom,
      contentTo: visual.contentTo,
      // Only the visible argument participates in prose scanning: PDF-string
      // alternatives and hyperlink destinations are metadata, not body text.
      suffixFrom: visual.contentTo,
      suffixTo: second.end,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      smallCaps: false,
      foreground: undefined,
      background: undefined,
      border: undefined,
    };
  }
  const simple = new Map<string, Pick<
    VisualTextStyleRecord,
    "bold" | "italic" | "underline" | "strike" | "smallCaps"
  >>([
    ["textbf", { bold: true, italic: false, underline: false, strike: false, smallCaps: false }],
    ["textit", { bold: false, italic: true, underline: false, strike: false, smallCaps: false }],
    ["textsl", { bold: false, italic: true, underline: false, strike: false, smallCaps: false }],
    ["emph", { bold: false, italic: true, underline: false, strike: false, smallCaps: false }],
    ["underline", { bold: false, italic: false, underline: true, strike: false, smallCaps: false }],
    ["uline", { bold: false, italic: false, underline: true, strike: false, smallCaps: false }],
    ["ul", { bold: false, italic: false, underline: true, strike: false, smallCaps: false }],
    ["sout", { bold: false, italic: false, underline: false, strike: true, smallCaps: false }],
    ["st", { bold: false, italic: false, underline: false, strike: true, smallCaps: false }],
    ["textsc", { bold: false, italic: false, underline: false, strike: false, smallCaps: true }],
  ]);
  if (beamer) simple.set("alert", { bold: true, italic: false, underline: false, strike: false, smallCaps: false });
  const simpleStyle = simple.get(control.name) ?? (["text", "textrm", "textsf", "texttt", "textnormal"].includes(control.name)
    ? { bold: false, italic: false, underline: false, strike: false, smallCaps: false } : undefined);
  if (simpleStyle !== undefined) {
    const content = readRequiredArgument(text, control.end);
    return content === undefined
      ? undefined
      : {
          kind: "textStyle",
          command: control.name,
          from,
          to: content.end,
          prefixFrom: from,
          prefixTo: content.contentFrom,
          contentFrom: content.contentFrom,
          contentTo: content.contentTo,
          suffixFrom: content.contentTo,
          suffixTo: content.end,
          ...simpleStyle,
          foreground: beamer && control.name === "alert" ? namedColors.get("beamer:alert") : undefined,
          background: undefined,
          border: undefined,
        };
  }
  if (
    control.name !== "textcolor" &&
    control.name !== "colorbox" &&
    control.name !== "fcolorbox"
  ) {
    return undefined;
  }
  const model = readOptionalArgument(text, control.end);
  let cursor = model?.end ?? control.end;
  const firstColor = readRequiredArgument(text, cursor);
  if (firstColor === undefined) {
    return undefined;
  }
  cursor = firstColor.end;
  const secondColor = control.name === "fcolorbox"
    ? readRequiredArgument(text, cursor)
    : undefined;
  if (control.name === "fcolorbox" && secondColor === undefined) {
    return undefined;
  }
  cursor = secondColor?.end ?? cursor;
  const content = readRequiredArgument(text, cursor);
  if (content === undefined) {
    return undefined;
  }
  const colorModel = model === undefined
    ? undefined
    : text.slice(model.contentFrom, model.contentTo).trim();
  const first = visualCssColor(
    text.slice(firstColor.contentFrom, firstColor.contentTo),
    colorModel,
    namedColors,
  );
  const second = secondColor === undefined
    ? undefined
    : visualCssColor(
        text.slice(secondColor.contentFrom, secondColor.contentTo),
        colorModel,
        namedColors,
      );
  return {
    kind: "textStyle",
    command: control.name,
    from,
    to: content.end,
    prefixFrom: from,
    prefixTo: content.contentFrom,
    contentFrom: content.contentFrom,
    contentTo: content.contentTo,
    suffixFrom: content.contentTo,
    suffixTo: content.end,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    smallCaps: false,
    foreground: control.name === "textcolor" ? first : undefined,
    background: control.name === "textcolor" ? undefined : second ?? first,
    border: control.name === "fcolorbox" ? first : undefined,
  };
}

function parseVisualAccent(
  text: string,
  from: number,
  control: ParsedControl,
): VisualAccentRecord | undefined {
  const rendered = latexAccentText(text, control);
  return rendered === undefined
    ? undefined
    : {
        kind: "accent",
        from,
        to: rendered.to,
        text: rendered.text,
      };
}

function visualCssColor(value: string, model: string | undefined, colors: ReadonlyMap<string, string> = new Map()): string | undefined {
  const color = value.trim();
  if (color.length === 0 || color.length > 128) {
    return undefined;
  }
  const normalizedModel = model?.trim().toLocaleLowerCase("en-US");
  if (normalizedModel === "html" && /^[0-9a-f]{6}$/iu.test(color)) {
    return `#${color}`;
  }
  if (normalizedModel === "rgb" && model !== "RGB") {
    const channels = color.split(",").map((part) => Number(part.trim()));
    return channels.length === 3 && channels.every((channel) =>
      Number.isFinite(channel) && channel >= 0 && channel <= 1
    )
      ? `rgb(${channels.map((channel) => Math.round(channel * 255)).join(", ")})`
      : undefined;
  }
  if (normalizedModel === "rgb255" || model === "RGB") {
    const channels = color.split(",").map((part) => Number(part.trim()));
    return channels.length === 3 && channels.every((channel) =>
      Number.isInteger(channel) && channel >= 0 && channel <= 255
    )
      ? `rgb(${channels.join(", ")})`
      : undefined;
  }
  if (normalizedModel === "gray") {
    const channel = Number(color);
    return Number.isFinite(channel) && channel >= 0 && channel <= 1
      ? `rgb(${Math.round(channel * 255)}, ${Math.round(channel * 255)}, ${Math.round(channel * 255)})`
      : undefined;
  }
  if (normalizedModel !== undefined) {
    return undefined;
  }
  if (/^#[0-9a-f]{3,8}$/iu.test(color)) {
    return color;
  }
  const named = new Map<string, string>([
    ["red", "#ff0000"], ["green", "#008000"], ["blue", "#0000ff"],
    ["cyan", "#00ffff"], ["magenta", "#ff00ff"], ["yellow", "#ffff00"],
    ["black", "#000000"], ["white", "#ffffff"], ["gray", "#808080"],
    ["grey", "#808080"], ["darkgray", "#555555"], ["lightgray", "#c0c0c0"],
    ["brown", "#a52a2a"], ["lime", "#00ff00"], ["olive", "#808000"],
    ["orange", "#ffa500"], ["pink", "#ffc0cb"], ["purple", "#800080"],
    ["teal", "#008080"], ["violet", "#8a2be2"],
  ]);
  const direct = colors.get(color) ?? named.get(color.toLocaleLowerCase("en-US"));
  if (direct !== undefined) {
    return direct;
  }
  const mix = /^([A-Za-z]+)!([0-9]{1,3})!([A-Za-z]+)$/u.exec(color);
  if (mix !== null) {
    const left = named.get(mix[1]!.toLocaleLowerCase("en-US"));
    const right = named.get(mix[3]!.toLocaleLowerCase("en-US"));
    const percentage = Number(mix[2]);
    if (left !== undefined && right !== undefined && percentage >= 0 && percentage <= 100) {
      return `color-mix(in srgb, ${left} ${percentage}%, ${right})`;
    }
  }
  return undefined;
}

function parseVisualTableEnvironment(
  text: string,
  beginFrom: number,
  commandEnd: number,
  environment: string,
): VisualTableRecord | undefined {
  const bounds = findEnvironmentBounds(text, commandEnd, environment);
  if (bounds === undefined) {
    return undefined;
  }
  let tableEnvironment = environment;
  const containerEnvironment = environment === "table" || environment === "table*"
    ? environment
    : undefined;
  let bodyFrom = commandEnd;
  let bodyTo = bounds.endFrom;
  let columns: ParsedArgument | undefined;
  let tablePosition: ParsedArgument | undefined;
  let tableWidth: ParsedArgument | undefined;
  if (environment === "table" || environment === "table*") {
    tablePosition = readOptionalArgument(text, commandEnd);
    const nested = findNestedTabular(text, commandEnd, bounds.endFrom);
    if (nested === undefined) {
      return undefined;
    }
    tableEnvironment = nested.environment;
    bodyFrom = nested.bodyFrom;
    bodyTo = nested.bodyTo;
    columns = nested.columns;
    tableWidth = nested.width;
  } else {
    const tableArgs = tableArguments(text, commandEnd, environment);
    if (tableArgs === undefined) {
      return undefined;
    }
    bodyFrom = tableArgs.end;
    columns = tableArgs.columns;
    tablePosition = tableArgs.position;
    tableWidth = tableArgs.width;
  }
  if (columns === undefined) {
    return undefined;
  }
  const bodySource = text.slice(bodyFrom, bodyTo);
  const longtableBody = tableEnvironment === "longtable"
    ? longtablePreviewBody(bodySource)
    : undefined;
  const editableBodySource = longtableBody?.rowsSource ?? bodySource;
  const parsedRows = parseTabularRows(editableBodySource, bodyFrom);
  const rows = parsedRows.rows;
  if (parsedRows.rows.length === 0) {
    return undefined;
  }
  const replacement = lineAwareReplacement(text, beginFrom, bounds.endTo);
  if (!replacement.block) {
    return undefined;
  }
  const caption = findCommandArgument(text, commandEnd, bounds.endFrom, "caption");
  const captionLatex = caption === undefined
    ? undefined
    : text.slice(caption.contentFrom, caption.contentTo);
  const label = findLabelRecord(text, commandEnd, bounds.endFrom);
  const columnSpec = text.slice(columns.contentFrom, columns.contentTo);
  const columnAlignments = simpleTableColumnAlignments(columnSpec);
  const editability = visualTableEditability(
    editableBodySource,
    columnAlignments,
    rows.length,
    parsedRows.columnCount,
    parsedRows.truncated,
  );
  return {
    kind: "table",
    environment: tableEnvironment,
    containerEnvironment: containerEnvironment as "table" | "table*" | undefined,
    position: tablePosition === undefined
      ? undefined
      : text.slice(tablePosition.contentFrom, tablePosition.contentTo).trim(),
    width: tableWidth === undefined
      ? undefined
      : text.slice(tableWidth.contentFrom, tableWidth.contentTo).trim(),
    tableAlignment: /\\raggedright\b/u.test(text.slice(beginFrom, bounds.endTo))
      ? "left"
      : /\\raggedleft\b/u.test(text.slice(beginFrom, bounds.endTo))
        ? "right"
        : "center",
    replacement,
    bodyFrom,
    bodyTo,
    columnSpecFrom: columns.contentFrom,
    columnSpecTo: columns.contentTo,
    columnSpec,
    columnAlignments,
    caption: captionLatex === undefined
      ? undefined
      : latexToPlainText(captionLatex),
    captionLatex,
    captionSegments: captionLatex === undefined
      ? []
      : visualInlineContentSegments(captionLatex, caption!.contentFrom),
    label,
    rows,
    columnCount: parsedRows.columnCount,
    ruleStyle: /\\(?:toprule|midrule|bottomrule)\b/u.test(bodySource)
      ? "booktabs"
      : /\\hline\b/u.test(bodySource)
        ? "hline"
        : "none",
    longtableRepeatHeader: longtableBody?.repeatHeader ?? false,
    visualEditable: editability.editable,
    visualEditReason: editability.reason,
    truncated: parsedRows.truncated,
  };
}

interface PendingTikzcdArrow {
  readonly fromRow: number;
  readonly fromColumn: number;
  readonly toRow: number;
  readonly toColumn: number;
  readonly label: VisualMathFragment | undefined;
  readonly swap: boolean;
  readonly lineStyle: VisualTikzcdArrow["lineStyle"];
  readonly bend: "left" | "right" | undefined;
  readonly bendAmount: number | undefined;
  readonly head: VisualTikzcdArrow["head"];
}

function parseVisualTikzcdEnvironment(
  text: string,
  beginFrom: number,
  commandEnd: number,
): VisualTikzcdRecord | undefined {
  const bounds = findEnvironmentBounds(text, commandEnd, "tikzcd");
  if (bounds === undefined) {
    return undefined;
  }
  const options = readOptionalArgument(text, commandEnd);
  const bodyFrom = options?.end ?? commandEnd;
  const body = text.slice(bodyFrom, bounds.endFrom);
  const rawRows = [...splitTabularRowSlices(body, bodyFrom)];
  while (rawRows.length > 0 && rawRows[0]?.source.trim().length === 0) {
    rawRows.shift();
  }
  while (rawRows.length > 0 && rawRows.at(-1)?.source.trim().length === 0) {
    rawRows.pop();
  }
  if (rawRows.length === 0) {
    rawRows.push({source: body, sourceFrom: bodyFrom, sourceTo: bounds.endFrom});
  }
  const simplified = new Set<string>();
  const environmentOptions = options === undefined
    ? undefined
    : text.slice(options.contentFrom, options.contentTo).trim() || undefined;
  const separatorOption = splitTikzcdOptions(environmentOptions ?? "")
    .find(option => /^ampersand\s+replacement\s*=/u.test(option));
  const separator = separatorOption === undefined ? "&"
    : /^ampersand\s+replacement\s*=\s*\\&\s*$/u.test(separatorOption) ? "\\&" : undefined;
  const rows = rawRows.slice(0, MAX_VISUAL_TIKZCD_ROWS);
  const rowCells = rows.map((row) =>
    splitTabularCellSlices(row.source, row.sourceFrom, separator ?? "&", true).slice(
      0,
      MAX_VISUAL_TIKZCD_COLUMNS,
    )
  );
  const rowCount = rowCells.length;
  const columnCount = Math.max(1, ...rowCells.map((cells) => cells.length));
  const nodes: VisualTikzcdNode[] = [];
  const pendingArrows: PendingTikzcdArrow[] = [];
  for (let row = 0; row < rowCells.length; row += 1) {
    const cells = rowCells[row] ?? [];
    for (let column = 0; column < cells.length; column += 1) {
      const parsed = parseTikzcdCell(
        cells[column]?.source ?? "",
        cells[column]?.sourceFrom ?? bodyFrom,
        row,
        column,
        simplified,
      );
      if (parsed.node.tex.length > 0) {
        nodes.push({ row, column, math: parsed.node });
      }
      pendingArrows.push(...parsed.arrows);
    }
  }
  let truncated = rawRows.length > MAX_VISUAL_TIKZCD_ROWS ||
    rawRows.some(
      (row) =>
        splitTabularCellSlices(row.source, row.sourceFrom, separator ?? "&", true).length >
          MAX_VISUAL_TIKZCD_COLUMNS,
    ) ||
    pendingArrows.length > MAX_VISUAL_TIKZCD_ARROWS;
  const arrows: VisualTikzcdArrow[] = [];
  for (const arrow of pendingArrows.slice(0, MAX_VISUAL_TIKZCD_ARROWS)) {
    if (
      arrow.fromRow < 0 ||
      arrow.fromRow >= rowCount ||
      arrow.fromColumn < 0 ||
      arrow.fromColumn >= columnCount ||
      arrow.toRow < 0 ||
      arrow.toRow >= rowCount ||
      arrow.toColumn < 0 ||
      arrow.toColumn >= columnCount
    ) {
      truncated = true;
      simplified.add("arrow target outside the preview grid");
      continue;
    }
    arrows.push({
      fromRow: arrow.fromRow,
      fromColumn: arrow.fromColumn,
      toRow: arrow.toRow,
      toColumn: arrow.toColumn,
      label: arrow.label,
      swap: arrow.swap,
      lineStyle: arrow.lineStyle,
      dashed: arrow.lineStyle !== "solid",
      bend: arrow.bend,
      bendAmount: arrow.bendAmount,
      head: arrow.head,
    });
  }
  const replacement = lineAwareReplacement(text, beginFrom, bounds.endTo);
  if (!replacement.block) {
    return undefined;
  }
  return {
    kind: "tikzcd",
    replacement,
    tex: text.slice(beginFrom, bounds.endTo),
    bodyFrom,
    bodyTo: bounds.endFrom,
    nodes,
    arrows,
    rowCount,
    columnCount,
    environmentOptions,
    visualEditable: true,
    visualEditReason: truncated
      ? "交换图超过可视化编辑上限。"
      : simplified.size > 0
        ? "交换图包含尚未安全支持的 tikz-cd 选项。"
        : undefined,
    simplifiedOptions: [...simplified].slice(0, 32),
    truncated,
  };
}

function parseVisualYoungDiagramSequence(text: string, from: number): VisualFigureRecord | undefined {
  let cursor = from, end = from;
  for (let count = 0; count < 16; count++) {
    const control = readControl(text, cursor);
    if (control?.name !== "ydiagram") break;
    const optional = readOptionalArgument(text, control.end);
    const argument = readRequiredArgument(text, optional?.end ?? control.end);
    if (argument === undefined) break;
    end = argument.end;
    cursor = skipTrivia(text, end);
    const spacing = readControl(text, cursor);
    if (spacing?.name === "quad" || spacing?.name === "qquad") cursor = skipTrivia(text, spacing.end);
    else if (spacing?.name === "hspace") {
      const width = readRequiredArgument(text, spacing.end);
      if (width === undefined) break;
      cursor = skipTrivia(text, width.end);
    }
  }
  const replacement = lineAwareReplacement(text, from, end);
  if (end === from || !replacement.block) return undefined;
  return {kind: "figure", replacement, bodyFrom: from, bodyTo: end, tex: text.slice(from, end),
    caption: undefined, captionSegments: [], label: undefined};
}

function parseVisualTikzpictureEnvironment(
  text: string,
  beginFrom: number,
  commandEnd: number,
): VisualTikzpictureRecord | undefined {
  const bounds = findEnvironmentBounds(text, commandEnd, "tikzpicture");
  if (bounds === undefined) {
    return undefined;
  }
  const options = readOptionalArgument(text, commandEnd);
  const replacement = lineAwareReplacement(text, beginFrom, bounds.endTo);
  if (!replacement.block) {
    return undefined;
  }
  return {
    kind: "tikzpicture",
    replacement,
    bodyFrom: options?.end ?? commandEnd,
    bodyTo: bounds.endFrom,
    tex: text.slice(beginFrom, bounds.endTo),
  };
}

function parseTikzcdCell(
  source: string,
  sourceFrom: number,
  row: number,
  column: number,
  simplified: Set<string>,
): {
  readonly node: VisualMathFragment;
  readonly arrows: readonly PendingTikzcdArrow[];
} {
  const nodeParts: {source: string; from: number}[] = [];
  const arrows: PendingTikzcdArrow[] = [];
  let index = 0;
  let segmentStart = 0;
  let depth = 0;
  let firstCommand = source.length;
  while (index < source.length) {
    if (source[index] === "%" && !isEscapedAt(source, index)) {
      nodeParts.push({source: source.slice(segmentStart, index), from: segmentStart});
      firstCommand = Math.min(firstCommand, index);
      index = skipComment(source, index);
      segmentStart = index;
      continue;
    }
    if (source[index] === "{" && !isEscapedAt(source, index)) depth++;
    if (source[index] === "}" && !isEscapedAt(source, index)) depth = Math.max(0, depth - 1);
    if (source[index] === "|" && depth === 0) {
      const options = readOptionalArgument(source, index + 1);
      if (options !== undefined && source[options.end] === "|") { index = options.end + 1; continue; }
    }
    if (source[index] !== "\\") { index++; continue; }
    const control = readControl(source, index);
    if (depth !== 0 || (control?.name !== "arrow" && control?.name !== "ar")) {
      index = control?.end ?? index + 1;
      continue;
    }
    nodeParts.push({source: source.slice(segmentStart, index), from: segmentStart});
    firstCommand = Math.min(firstCommand, index);
    const options = readOptionalArgument(source, control.end);
    if (options === undefined) {
      simplified.add("\\arrow without an option list");
      index = control.end;
      segmentStart = index;
      continue;
    }
    const parsed = parseTikzcdArrowOptions(
      source.slice(options.contentFrom, options.contentTo),
      sourceFrom + options.contentFrom,
      row,
      column,
      simplified,
    );
    if (parsed !== undefined) arrows.push(parsed);
    index = options.end;
    segmentStart = index;
  }
  nodeParts.push({source: source.slice(segmentStart), from: segmentStart});
  const nodeSource = nodeParts.map(part => part.source).join("").trim();
  const contiguousPart = nodeParts.find(part => part.source.includes(nodeSource));
  const contiguousNodeFrom = contiguousPart === undefined ? -1 : contiguousPart.from + contiguousPart.source.indexOf(nodeSource);
  let prefix = "";
  if (nodeSource.startsWith("|")) {
    const options = readOptionalArgument(nodeSource, 1);
    if (options !== undefined && nodeSource[options.end] === "|") prefix = nodeSource.slice(0, options.end + 1);
  }
  const labelSource = nodeSource.slice(prefix.length).trim();
  const nodeSourceFrom = contiguousNodeFrom >= 0 ? sourceFrom + contiguousNodeFrom : -1;
  const labelFrom = nodeSourceFrom < 0 ? -1 : labelSource.length === 0
    ? sourceFrom + Math.min(firstCommand, Math.max(0, source.search(/\S/u))) + prefix.length
    : nodeSourceFrom + nodeSource.indexOf(labelSource, prefix.length);
  return {
    node: mathFragmentFromLatex(labelSource, Math.max(sourceFrom, labelFrom)),
    arrows,
  };
}

function tikzcdLabelOption(source: string): RegExpExecArray | null {
  return /^"((?:\\.|[^"\\])*)"(')?([\s\S]*)$/u.exec(source);
}

function parseTikzcdArrowOptions(
  source: string,
  sourceFrom: number,
  row: number,
  column: number,
  simplified: Set<string>,
): PendingTikzcdArrow | undefined {
  const options = splitTikzcdOptionSlices(source, sourceFrom);
  const direction = options.find((option) => /^[rlud]+$/u.test(option.source));
  const explicitFrom = parseTikzcdCoordinateOption(options, "from");
  const explicitTo = parseTikzcdCoordinateOption(options, "to");
  if ((explicitFrom === undefined && options.some(option => /^from\s*=/u.test(option.source))) ||
      (explicitTo === undefined && options.some(option => /^to\s*=/u.test(option.source)))) {
    simplified.add(`arrow direction: ${source.slice(0, 160)}`);
    return undefined;
  }
  if (direction === undefined && explicitTo === undefined) {
    simplified.add(`arrow direction: ${source.slice(0, 160)}`);
    return undefined;
  }
  let deltaRow = 0;
  let deltaColumn = 0;
  for (const character of direction?.source ?? "") {
    deltaRow += character === "d" ? 1 : character === "u" ? -1 : 0;
    deltaColumn += character === "r" ? 1 : character === "l" ? -1 : 0;
  }
  const fromRow = explicitFrom?.[0] ?? row;
  const fromColumn = explicitFrom?.[1] ?? column;
  const toRow = explicitTo?.[0] ?? fromRow + deltaRow;
  const toColumn = explicitTo?.[1] ?? fromColumn + deltaColumn;
  let label: VisualMathFragment | undefined;
  let swap = false;
  let lineStyle: PendingTikzcdArrow["lineStyle"] = "solid";
  let bend: PendingTikzcdArrow["bend"];
  let bendAmount: number | undefined;
  let head: PendingTikzcdArrow["head"] = "normal";
  for (const option of options) {
    if (
      option === direction ||
      option.source.length === 0 ||
      /^\s*(?:from|to)\s*=/u.test(option.source)
    ) {
      continue;
    }
    const labelMatch = tikzcdLabelOption(option.source);
    if (labelMatch !== null) {
      label = mathFragmentFromLatex(labelMatch[1] ?? "", option.sourceFrom + 1);
      swap ||= labelMatch[2] === "'";
      continue;
    }
    if (option.source === "swap") {
      swap = true;
    } else if (option.source === "dashed") {
      lineStyle = "dashed";
    } else if (option.source === "dotted") {
      lineStyle = "dotted";
    } else if (/^bend (?:left|right)(?:\s*=.*)?$/u.test(option.source)) {
      const bendMatch = /^bend (left|right)(?:\s*=\s*([-+]?\d+(?:\.\d+)?))?$/u.exec(
        option.source,
      );
      if (bendMatch === null) {
        simplified.add(option.source.slice(0, 160));
        continue;
      }
      bend = bendMatch[1] as "left" | "right";
      bendAmount = bendMatch[2] === undefined
        ? undefined
        : Math.min(90, Math.max(1, Math.abs(Number.parseFloat(bendMatch[2]))));
    } else if (option.source === "two heads" || option.source === "Rightarrow") {
      head = "twoHeads";
    } else if (option.source === "hook" || option.source === "tail") {
      head = "hook";
    } else if (option.source === "no head") {
      head = "none";
    } else {
      simplified.add(option.source.slice(0, 160));
    }
  }
  return {
    fromRow,
    fromColumn,
    toRow,
    toColumn,
    label,
    swap,
    lineStyle,
    bend,
    bendAmount,
    head,
  };
}

function parseTikzcdCoordinateOption(
  options: readonly AbsoluteSourceSlice[],
  name: "from" | "to",
): readonly [number, number] | undefined {
  const pattern = new RegExp(`^${name}\\s*=\\s*(\\d+)-(\\d+)$`, "u");
  for (const option of options) {
    const match = pattern.exec(option.source);
    if (match === null) {
      continue;
    }
    const row = Number.parseInt(match[1] ?? "0", 10) - 1;
    const column = Number.parseInt(match[2] ?? "0", 10) - 1;
    return [row, column];
  }
  return undefined;
}

function splitTikzcdOptionSlices(
  source: string,
  sourceFrom: number,
): readonly AbsoluteSourceSlice[] {
  const options: AbsoluteSourceSlice[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' && !isEscapedAt(source, index)) {
      quoted = !quoted;
    } else if (!quoted && /[{[(]/u.test(character ?? "")) {
      depth += 1;
    } else if (!quoted && /[})\]]/u.test(character ?? "")) {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && !quoted && depth === 0) {
      options.push(trimmedAbsoluteSourceSlice(source, start, index, sourceFrom));
      start = index + 1;
    }
  }
  options.push(trimmedAbsoluteSourceSlice(source, start, source.length, sourceFrom));
  return options;
}

function skipOpaqueEnvironment(text: string, offset: number, environment: string): number {
  return findLatexOpaqueEnvironmentEnd(text, offset, text.length, environment) ?? text.length;
}

function splitTikzcdOptions(source: string): readonly string[] {
  return splitTikzcdOptionSlices(source, 0).map((option) => option.source);
}

function parseVisualFigureEnvironment(text: string, beginFrom: number, commandEnd: number, environment: string): VisualFigureRecord | undefined {
  const bounds = findEnvironmentBounds(text, commandEnd, environment);
  if (bounds === undefined) return undefined;
  const body = text.slice(commandEnd, bounds.endFrom);
  if (countVisualFigureObjects(text, commandEnd, bounds.endFrom) < 2 &&
      !/\\(?:ydiagram|tikz|vbox|vcenter)\b|\\begin\s*\{tikzpicture\}/u.test(body)) return undefined;
  const replacement = lineAwareReplacement(text, beginFrom, bounds.endTo);
  if (!replacement.block) return undefined;
  const options = readOptionalArgument(text, commandEnd);
  const caption = findCommandArgument(text, commandEnd, bounds.endFrom, "caption");
  return { kind: "figure", replacement, bodyFrom: options?.end ?? commandEnd, bodyTo: bounds.endFrom,
    tex: text.slice(beginFrom, bounds.endTo),
    caption: caption === undefined ? undefined : latexToPlainText(text.slice(caption.contentFrom, caption.contentTo)),
    captionSegments: caption === undefined ? [] : visualInlineContentSegments(text.slice(caption.contentFrom, caption.contentTo), caption.contentFrom),
    label: findLabelRecord(text, commandEnd, bounds.endFrom) };
}

function parseVisualImageEnvironment(
  text: string,
  beginFrom: number,
  commandEnd: number,
  environment: string,
): VisualImageRecord | undefined {
  const bounds = findEnvironmentBounds(text, commandEnd, environment);
  if (bounds === undefined) {
    return undefined;
  }
  // A single image cannot represent a composite figure or a TikZ composition.
  if (countVisualFigureObjects(text, commandEnd, bounds.endFrom) !== 1) {
    return undefined;
  }
  const graphics = findIncludeGraphics(text, commandEnd, bounds.endFrom);
  if (graphics === undefined) {
    return undefined;
  }
  const replacement = lineAwareReplacement(text, beginFrom, bounds.endTo);
  if (!replacement.block) {
    return undefined;
  }
  const caption = findCommandArgument(text, commandEnd, bounds.endFrom, "caption");
  return {
    kind: "image",
    replacement,
    path: graphics.path,
    caption: caption === undefined
      ? undefined
      : latexToPlainText(
          text.slice(caption.contentFrom, caption.contentTo),
        ),
    captionSegments: caption === undefined ? []
      : visualInlineContentSegments(text.slice(caption.contentFrom, caption.contentTo), caption.contentFrom),
    label: findLabelRecord(text, commandEnd, bounds.endFrom),
    previewUri: undefined,
  };
}

function parseVisualIncludeGraphics(
  text: string,
  commandFrom: number,
  controlEnd: number,
): VisualImageRecord | undefined {
  const afterStar = text[controlEnd] === "*" ? controlEnd + 1 : controlEnd;
  const optional = readOptionalArgument(text, afterStar);
  const argument = readRequiredArgument(text, optional?.end ?? afterStar);
  if (argument === undefined) {
    return undefined;
  }
  const imagePath = text.slice(argument.contentFrom, argument.contentTo).trim();
  if (!validVisualImagePath(imagePath)) {
    return undefined;
  }
  const replacement = lineAwareReplacement(text, commandFrom, argument.end);
  if (!replacement.block) {
    return undefined;
  }
  return {
    kind: "image",
    replacement,
    path: imagePath,
    caption: undefined,
    label: undefined,
    previewUri: undefined,
  };
}

function findEnvironmentBounds(
  text: string,
  offset: number,
  environment: string,
): VisualEnvironmentBounds | undefined {
  let depth = 1;
  let index = offset;
  while (index < text.length) {
    const next = text.indexOf("\\", index);
    if (next < 0) {
      return undefined;
    }
    const lineStart = text.lastIndexOf("\n", Math.max(0, next - 1)) + 1;
    const comment = text.indexOf("%", lineStart);
    if (comment >= 0 && comment < next && !isEscapedAt(text, comment)) {
      index = skipComment(text, comment);
      continue;
    }
    const control = readControl(text, next);
    if (control?.name !== "begin" && control?.name !== "end") {
      index = control?.end ?? next + 1;
      continue;
    }
    const argument = readRequiredArgument(text, control.end);
    if (argument === undefined) {
      index = control.end;
      continue;
    }
    if (text.slice(argument.contentFrom, argument.contentTo).trim() === environment) {
      depth += control.name === "begin" ? 1 : -1;
      if (depth === 0) {
        return {
          contentFrom: offset,
          endFrom: next,
          endTo: argument.end,
        };
      }
    }
    index = argument.end;
  }
  return undefined;
}

function findNestedTabular(
  text: string,
  from: number,
  to: number,
): {
  readonly environment: string;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly columns: ParsedArgument;
  readonly width: ParsedArgument | undefined;
} | undefined {
  let index = from;
  while (index < to) {
    const next = text.indexOf("\\", index);
    if (next < 0 || next >= to) {
      return undefined;
    }
    const control = readControl(text, next);
    if (control?.name !== "begin") {
      index = control?.end ?? next + 1;
      continue;
    }
    const argument = readRequiredArgument(text, control.end);
    if (argument === undefined) {
      index = control.end;
      continue;
    }
    const environment = text.slice(argument.contentFrom, argument.contentTo).trim();
    if (!["tabular", "tabular*", "tabularx", "longtable"].includes(environment)) {
      index = argument.end;
      continue;
    }
    const bounds = findEnvironmentBounds(text, argument.end, environment);
    const tableArgs = tableArguments(text, argument.end, environment);
    if (bounds === undefined || tableArgs === undefined || bounds.endFrom > to) {
      return undefined;
    }
    return {
      environment,
      bodyFrom: tableArgs.end,
      bodyTo: bounds.endFrom,
      columns: tableArgs.columns,
      width: tableArgs.width,
    };
  }
  return undefined;
}

function tableArguments(
  text: string,
  offset: number,
  environment: string,
): {
  readonly end: number;
  readonly columns: ParsedArgument;
  readonly position: ParsedArgument | undefined;
  readonly width: ParsedArgument | undefined;
} | undefined {
  let cursor = offset;
  let position: ParsedArgument | undefined;
  let width: ParsedArgument | undefined;
  if (environment === "tabularx" || environment === "tabular*") {
    width = readRequiredArgument(text, cursor);
    if (width === undefined) {
      return undefined;
    }
    cursor = width.end;
    position = readOptionalArgument(text, cursor);
    cursor = position?.end ?? cursor;
  } else {
    position = readOptionalArgument(text, cursor);
    cursor = position?.end ?? cursor;
  }
  const columns = readRequiredArgument(text, cursor);
  return columns === undefined
    ? undefined
    : { end: columns.end, columns, position, width };
}

function findCommandArgument(
  text: string,
  from: number,
  to: number,
  commandName: string,
): ParsedArgument | undefined {
  let index = from;
  while (index < to) {
    const next = text.indexOf("\\", index);
    if (next < 0 || next >= to) {
      return undefined;
    }
    const control = readControl(text, next);
    if (control?.name !== commandName) {
      index = control?.end ?? next + 1;
      continue;
    }
    const afterStar = text[control.end] === "*" ? control.end + 1 : control.end;
    const optional = readOptionalArgument(text, afterStar);
    const argument = readRequiredArgument(text, optional?.end ?? afterStar);
    return argument !== undefined && argument.end <= to ? argument : undefined;
  }
  return undefined;
}

function findLabelRecord(
  text: string,
  from: number,
  to: number,
): VisualLabelRecord | undefined {
  let index = from;
  while (index < to) {
    const next = text.indexOf("\\", index);
    if (next < 0 || next >= to) {
      return undefined;
    }
    const control = readControl(text, next);
    if (control?.name !== "label") {
      index = control?.end ?? next + 1;
      continue;
    }
    const argument = readRequiredArgument(text, control.end);
    if (argument === undefined || argument.end > to) {
      return undefined;
    }
    const key = text.slice(argument.contentFrom, argument.contentTo).trim();
    if (key.length === 0 || key.length > MAX_VISUAL_LABEL_KEY_LENGTH) {
      return undefined;
    }
    return {
      kind: "label",
      from: next,
      to: argument.end,
      key,
      replacement: lineAwareReplacement(text, next, argument.end),
    };
  }
  return undefined;
}

function findIncludeGraphics(text: string, from: number, to: number): { readonly path: string } | undefined {
  return visualImageSourcePaths(text, from, to)[0];
}

/** Literal image arguments only; offsets permit staging without changing source. */
export function visualImageSourcePaths(text: string, from = 0, to = text.length): readonly { readonly path: string; readonly from: number; readonly to: number }[] {
  const result: { path: string; from: number; to: number }[] = [];
  let index = from;
  while (index < to && result.length < 17) {
    if (text[index] === "%" && !isEscapedAt(text, index)) { index = skipComment(text, index); continue; }
    if (text[index] !== "\\") { index++; continue; }
    const control = readControl(text, index);
    if (control === undefined) { index++; continue; }
    if (control.name === "verb") { index = skipVerb(text, control.end); continue; }
    if (isVisualLabelDefinitionCommand(control.name)) { index = skipVisualLabelDefinition(text, control, to) ?? to; continue; }
    if (control.name === "begin") {
      const argument = readRequiredArgument(text, control.end);
      const environment = argument === undefined ? "" : text.slice(argument.contentFrom, argument.contentTo).trim();
      if (argument !== undefined && VERBATIM_ENVIRONMENTS.has(environment)) { index = skipOpaqueEnvironment(text, argument.end, environment); continue; }
    }
    if (control.name !== "includegraphics") { index = control.end; continue; }
    const afterStar = text[control.end] === "*" ? control.end + 1 : control.end;
    const optional = readOptionalArgument(text, afterStar);
    const argument = readRequiredArgument(text, optional?.end ?? afterStar);
    if (argument === undefined || argument.end > to) break;
    const imagePath = text.slice(argument.contentFrom, argument.contentTo).trim();
    if (validVisualImagePath(imagePath)) result.push({ path: imagePath, from: argument.contentFrom, to: argument.contentTo });
    index = argument.end;
  }
  return result;
}

function validVisualImagePath(value: string): boolean {
  return value.length > 0 &&
    value.length <= 2_048 &&
    !/[\u0000\r\n]/u.test(value) &&
    !value.includes("\\") &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) &&
    !value.startsWith("/");
}

function longtablePreviewBody(source: string): {
  readonly rowsSource: string;
  readonly repeatHeader: boolean;
} {
  const firstHead = source.indexOf("\\endfirsthead");
  const head = source.indexOf("\\endhead", Math.max(0, firstHead));
  const foot = source.indexOf("\\endfoot", Math.max(0, head));
  const lastFoot = source.indexOf("\\endlastfoot", Math.max(0, foot));
  if (firstHead >= 0 && head > firstHead) {
    const header = stripLongtableMetadata(source.slice(0, firstHead));
    const dataFrom = lastFoot > foot && foot > head
      ? lastFoot + "\\endlastfoot".length
      : foot > head
        ? foot + "\\endfoot".length
        : head + "\\endhead".length;
    const data = stripLongtableMetadata(
      source.slice(dataFrom),
    );
    return {
      // Mask discarded slices without moving physical source offsets. Repeated
      // headers and body cells may contain identical text and citation keys.
      rowsSource: header + maskSourceMatch(source.slice(firstHead, dataFrom)) + data,
      repeatHeader: true,
    };
  }
  return { rowsSource: stripLongtableMetadata(source), repeatHeader: false };
}

function stripLongtableMetadata(source: string): string {
  const removals: { from: number; to: number }[] = [];
  for (const commandName of ["caption", "label"] as const) {
    const commandFrom = source.indexOf(`\\${commandName}`);
    if (commandFrom < 0) {
      continue;
    }
    const control = readControl(source, commandFrom);
    if (control?.name !== commandName) {
      continue;
    }
    const optional = commandName === "caption"
      ? readOptionalArgument(source, control.end)
      : undefined;
    const argument = readRequiredArgument(source, optional?.end ?? control.end);
    if (argument !== undefined) {
      removals.push({ from: commandFrom, to: argument.end });
    }
  }
  let result = source;
  for (const removal of removals.sort((left, right) => right.from - left.from)) {
    result = `${result.slice(0, removal.from)}${maskSourceMatch(result.slice(removal.from, removal.to))}${result.slice(removal.to)}`;
  }
  return result
    .replace(/^\s*\\\\(?:\s*\[[^\]]{0,200}\])?/u, maskSourceMatch);
}

interface AbsoluteSourceSlice {
  readonly source: string;
  readonly sourceFrom: number;
  readonly sourceTo: number;
}

function parseTabularRows(source: string, sourceFrom: number): {
  readonly rows: readonly (readonly VisualTableCell[])[];
  readonly columnCount: number;
  readonly truncated: boolean;
} {
  const rawRows = splitTabularRowSlices(source, sourceFrom);
  const rows: VisualTableCell[][] = [];
  let columnCount = 0;
  let truncated = rawRows.length > MAX_VISUAL_TABLE_ROWS;
  for (const rawRow of rawRows.slice(0, MAX_VISUAL_TABLE_ROWS)) {
    const masked = rawRow.source
      .replace(/\\(?:toprule|midrule|bottomrule|hline)\b/gu, maskSourceMatch)
      .replace(
        /\\(?:c?midrule|cline)(?:\([^)]{0,200}\))?\s*\{[^{}]{0,200}\}/gu,
        maskSourceMatch,
      );
    const semanticFrom = masked.search(/\S/u);
    if (semanticFrom < 0) {
      continue;
    }
    const semanticTo = masked.search(/\s*$/u);
    const rowSource = rawRow.source.slice(semanticFrom, semanticTo);
    const rowSourceFrom = rawRow.sourceFrom + semanticFrom;
    const rawCells = splitTabularCellSlices(rowSource, rowSourceFrom);
    if (rawCells.length > MAX_VISUAL_TABLE_COLUMNS) {
      truncated = true;
    }
    if (rawCells.some((cell) => cell.source.trim().length > MAX_VISUAL_TABLE_CELL_LENGTH)) {
      truncated = true;
    }
    const cells = rawCells
      .slice(0, MAX_VISUAL_TABLE_COLUMNS)
      .map(latexTableCell);
    if (cells.every((cell) => cell.text.length === 0)) {
      continue;
    }
    columnCount = Math.max(columnCount, cells.length);
    rows.push(cells);
  }
  return { rows, columnCount, truncated };
}

function simpleTableColumnAlignments(
  source: string,
): readonly ("left" | "center" | "right" | "flex")[] {
  const normalized = source
    .replace(/[@!]\{\s*\}/gu, "")
    .replace(/[|\s]/gu, "");
  if (!/^[lcrX]+$/u.test(normalized)) {
    return [];
  }
  return [...normalized].map((alignment) =>
    alignment === "l"
      ? "left"
      : alignment === "r"
        ? "right"
        : alignment === "X"
          ? "flex"
          : "center"
  );
}

function visualTableEditability(
  bodySource: string,
  columnAlignments: readonly ("left" | "center" | "right" | "flex")[],
  rowCount: number,
  columnCount: number,
  truncated: boolean,
): { readonly editable: boolean; readonly reason: string | undefined } {
  if (truncated || rowCount > 80 || columnCount > 24) {
    return { editable: false, reason: "表格超过可视化编辑上限。" };
  }
  if (columnAlignments.length !== columnCount) {
    return {
      editable: false,
      reason: "列格式包含 p/m/b、重复器或自定义间距；当前支持 l/c/r/X，其他高级列定义仅提供预览。",
    };
  }
  if (/(^|[^\\])%/mu.test(bodySource)) {
    return { editable: false, reason: "表格正文含注释；为保留注释，仅提供源码编辑。" };
  }
  if (
    /\\(?:begin|end|multicolumn|multirow|cline|cmidrule|addlinespace|specialrule)\b/u.test(
      bodySource,
    ) ||
    /\\\\\s*\[/u.test(bodySource)
  ) {
    return {
      editable: false,
      reason: "表格含合并单元格、嵌套环境或高级横线；当前保持源码无损。",
    };
  }
  return { editable: true, reason: undefined };
}

function splitTabularRows(source: string): readonly string[] {
  return splitTabularRowSlices(source, 0).map((row) => row.source);
}

function splitTabularRowSlices(
  source: string,
  sourceFrom: number,
): readonly AbsoluteSourceSlice[] {
  const rows: AbsoluteSourceSlice[] = [];
  let start = 0;
  let braceDepth = 0;
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === "%" && !isEscapedAt(source, index)) {
      index = skipComment(source, index);
      continue;
    }
    if (character === "{" && !isEscapedAt(source, index)) {
      braceDepth += 1;
    } else if (character === "}" && !isEscapedAt(source, index)) {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (
      character === "\\" &&
      source[index + 1] === "\\" &&
      braceDepth === 0 &&
      !isEscapedAt(source, index)
    ) {
      rows.push(absoluteSourceSlice(source, start, index, sourceFrom));
      index += 2;
      const optional = readOptionalArgument(source, index);
      index = optional?.end ?? index;
      start = index;
      continue;
    }
    index += 1;
  }
  rows.push(absoluteSourceSlice(source, start, source.length, sourceFrom));
  return rows;
}

function splitTabularCells(source: string): readonly string[] {
  return splitTabularCellSlices(source, 0).map((cell) => cell.source);
}

function splitTabularCellSlices(
  source: string,
  sourceFrom: number,
  separator = "&",
  protectOptions = false,
): readonly AbsoluteSourceSlice[] {
  const cells: AbsoluteSourceSlice[] = [];
  let start = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "%" && !isEscapedAt(source, index)) {
      index = skipComment(source, index) - 1;
      continue;
    }
    if (character === "{" && !isEscapedAt(source, index)) {
      braceDepth += 1;
    } else if (character === "}" && !isEscapedAt(source, index)) {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (protectOptions && braceDepth === 0 && character === "[" && !isEscapedAt(source, index)) {
      bracketDepth++;
    } else if (protectOptions && braceDepth === 0 && character === "]" && !isEscapedAt(source, index)) {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (source.startsWith(separator, index) && braceDepth === 0 && bracketDepth === 0 && !isEscapedAt(source, index)) {
      cells.push(absoluteSourceSlice(source, start, index, sourceFrom));
      index += separator.length - 1;
      start = index + 1;
    }
  }
  cells.push(absoluteSourceSlice(source, start, source.length, sourceFrom));
  return cells;
}

function absoluteSourceSlice(
  source: string,
  from: number,
  to: number,
  sourceFrom: number,
): AbsoluteSourceSlice {
  return {
    source: source.slice(from, to),
    sourceFrom: sourceFrom + from,
    sourceTo: sourceFrom + to,
  };
}

function trimmedAbsoluteSourceSlice(
  source: string,
  from: number,
  to: number,
  sourceFrom: number,
): AbsoluteSourceSlice {
  const boundedFrom = Math.max(0, Math.min(source.length, from));
  const boundedTo = Math.max(boundedFrom, Math.min(source.length, to));
  const raw = source.slice(boundedFrom, boundedTo);
  const leading = raw.length - raw.trimStart().length;
  const trailing = raw.length - raw.trimEnd().length;
  const trimmedFrom = boundedFrom + leading;
  const trimmedTo = Math.max(trimmedFrom, boundedTo - trailing);
  return absoluteSourceSlice(source, trimmedFrom, trimmedTo, sourceFrom);
}

function maskSourceMatch(match: string): string {
  return " ".repeat(match.length);
}

function latexTableCell(value: AbsoluteSourceSlice): VisualTableCell {
  const trimmed = trimmedAbsoluteSourceSlice(
    value.source,
    0,
    value.source.length,
    value.sourceFrom,
  );
  const source = trimmed.source.slice(0, MAX_VISUAL_TABLE_CELL_LENGTH);
  const sourceTo = trimmed.sourceFrom + source.length;
  const fallbackSource = source.replace(
    /\\(?:dfrac|tfrac|frac)\s*\{([^{}]{0,256})\}\s*\{([^{}]{0,256})\}/gu,
    "$1/$2",
  );
  const plain = latexToPlainText(
    fallbackSource
      .replace(/\$+/gu, "")
      .replace(/\\[()[\]]/gu, " "),
  ).slice(0, MAX_VISUAL_TABLE_CELL_LENGTH);
  const segments = visualInlineContentSegments(source, trimmed.sourceFrom);
  const onlyMath = segments.length === 1 && segments[0]?.kind === "math"
    ? segments[0].math
    : undefined;
  return {
    source,
    sourceFrom: trimmed.sourceFrom,
    sourceTo,
    text: plain,
    math: onlyMath === undefined ? undefined : { ...onlyMath, fallback: plain || onlyMath.fallback },
    segments,
  };
}

interface ExplicitMathContentRange {
  readonly from: number;
  readonly to: number;
  readonly innerFrom: number;
  readonly innerTo: number;
}

function visualInlineContentSegments(
  source: string,
  sourceFrom: number,
): readonly VisualInlineContentSegment[] {
  const ranges = explicitMathContentRanges(source);
  if (ranges.length === 0) {
    const inline: VisualInlineContentSegment[] = [];
    appendVisualTextSegment(inline, source, sourceFrom);
    if (inline.some(segment => segment.kind === "citation" || segment.kind === "reference")) return inline;
    const math = tableCellMathSource(source);
    return math === undefined
      ? [{ kind: "text", text: latexToPlainText(source) }]
      : [{ kind: "math", math: mathFragmentFromLatex(source, sourceFrom) }];
  }
  const segments: VisualInlineContentSegment[] = [];
  let offset = 0;
  for (const range of ranges) {
    appendVisualTextSegment(segments, source.slice(offset, range.from), sourceFrom + offset);
    const mathSource = source.slice(range.innerFrom, range.innerTo).trim();
    if (mathSource.length > 0) {
      segments.push({
        kind: "math",
        math: mathFragmentFromLatex(
          source.slice(range.from, range.to),
          sourceFrom + range.from,
        ),
      });
    }
    offset = range.to;
  }
  appendVisualTextSegment(segments, source.slice(offset), sourceFrom + offset);
  return segments;
}

function appendVisualTextSegment(
  segments: VisualInlineContentSegment[],
  source: string,
  sourceFrom: number,
): void {
  let plainFrom = 0;
  let index = 0;
  while (index < source.length) {
    if (source[index] === "%" && !isEscapedAt(source, index)) {
      index = skipComment(source, index);
      continue;
    }
    if (source[index] !== "\\") { index += 1; continue; }
    const control = readControl(source, index);
    if (control === undefined) { index += 1; continue; }
    if (control.name === "verb" || control.name === "verb*") {
      index = skipVerb(source, control.end); continue;
    }
    if (control.name === "newif") {
      index = skipVisualNewIfDeclaration(source, control.end, source.length) ?? control.end; continue;
    }
    const conditionalArguments = visualFunctionalConditionalArgumentCount(control.name);
    if (conditionalArguments !== undefined) {
      index = skipVisualFunctionalConditional(source, control.end, source.length, conditionalArguments) ?? source.length;
      continue;
    }
    if (isVisualLabelConditionalControl(control.name)) {
      index = skipLiteralFalseConditional(source, control.end, source.length); continue;
    }
    if (isVisualLabelDefinitionCommand(control.name)) {
      index = skipVisualLabelDefinition(source, control, source.length) ?? control.end; continue;
    }
    if (control.name === "begin") {
      const environment = readRequiredArgument(source, control.end);
      if (environment !== undefined && VERBATIM_ENVIRONMENTS.has(source.slice(environment.contentFrom, environment.contentTo))) {
        index = skipOpaqueEnvironment(source, environment.end, source.slice(environment.contentFrom, environment.contentTo));
        continue;
      }
    }
    const record = parseVisualInlineReference(source, index, control);
    if (record !== undefined && record.keys.length > 0) {
      appendPlainTextSegment(segments, source.slice(plainFrom, index));
      const range = { from: sourceFrom + record.from, to: sourceFrom + record.to };
      segments.push(record.kind === "citation"
        ? { kind: "citation", citation: { ...record, ...range } }
        : { kind: "reference", reference: { ...record, ...range } });
      plainFrom = record.to;
      index = record.to;
      continue;
    }
    index = record?.to ?? control.end;
  }
  appendPlainTextSegment(segments, source.slice(plainFrom));
}

function appendPlainTextSegment(
  segments: VisualInlineContentSegment[],
  source: string,
): void {
  if (source.length === 0) {
    return;
  }
  const plain = latexToPlainText(source);
  const leading = /^\s/u.test(source) ? " " : "";
  const trailing = /\s$/u.test(source) ? " " : "";
  const text = plain.length === 0
    ? (leading || trailing)
    : `${leading}${plain}${trailing}`;
  if (text.length > 0) {
    segments.push({ kind: "text", text });
  }
}

function explicitMathContentRanges(source: string): readonly ExplicitMathContentRange[] {
  const ranges: ExplicitMathContentRange[] = [];
  let index = 0;
  while (index < source.length) {
    let open = "";
    let close = "";
    if (source[index] === "$" && !isEscapedAt(source, index)) {
      open = source[index + 1] === "$" ? "$$" : "$";
      close = open;
    } else if (
      source[index] === "\\" &&
      !isEscapedAt(source, index) &&
      (source[index + 1] === "(" || source[index + 1] === "[")
    ) {
      open = source.slice(index, index + 2);
      close = source[index + 1] === "(" ? "\\)" : "\\]";
    }
    if (open.length === 0) {
      index += 1;
      continue;
    }
    const closeFrom = findUnescapedToken(source, close, index + open.length);
    if (closeFrom < 0) {
      index += open.length;
      continue;
    }
    ranges.push({
      from: index,
      to: closeFrom + close.length,
      innerFrom: index + open.length,
      innerTo: closeFrom,
    });
    index = closeFrom + close.length;
  }
  return ranges;
}

function findUnescapedToken(source: string, token: string, from: number): number {
  let offset = source.indexOf(token, from);
  while (offset >= 0 && isEscapedAt(source, offset)) {
    offset = source.indexOf(token, offset + token.length);
  }
  return offset;
}

function tableCellMathSource(source: string): string | undefined {
  const trimmed = source.trim();
  if (
    (trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length > 2) ||
    (trimmed.startsWith("\\(") && trimmed.endsWith("\\)") && trimmed.length > 4) ||
    (trimmed.startsWith("\\[") && trimmed.endsWith("\\]") && trimmed.length > 4)
  ) {
    return unwrapMathDelimiters(trimmed);
  }
  return /\\(?:[dt]?frac|binom|sqrt|sum|prod|int|math[a-zA-Z]+|operatorname|left|right|overline|underline|vec|hat|bar)\b|[_^]/u.test(
    trimmed,
  )
    ? trimmed
    : undefined;
}

function mathFragmentFromLatex(
  source: string,
  sourceFrom: number,
  fallbackOverride?: string,
): VisualMathFragment {
  const leadingWhitespace = source.length - source.trimStart().length;
  const trimmed = source.trim();
  const boundedSourceLength = Math.min(trimmed.length, MAX_VISUAL_TABLE_CELL_LENGTH);
  const tex = unwrapMathDelimiters(trimmed)
    .trim()
    .slice(0, MAX_VISUAL_TABLE_CELL_LENGTH);
  const fallback = fallbackOverride ?? latexToPlainText(
    tex.replace(
      /\\(?:dfrac|tfrac|frac)\s*\{([^{}]{0,256})\}\s*\{([^{}]{0,256})\}/gu,
      "$1/$2",
    ),
  );
  return {
    tex,
    fallback: fallback || tex,
    sourceFrom: sourceFrom + leadingWhitespace,
    sourceTo: sourceFrom + leadingWhitespace + boundedSourceLength,
  };
}

function unwrapMathDelimiters(source: string): string {
  if (source.startsWith("$$") && source.endsWith("$$") && source.length > 4) {
    return source.slice(2, -2);
  }
  if (source.startsWith("$") && source.endsWith("$") && source.length > 2) {
    return source.slice(1, -1);
  }
  if (
    ((source.startsWith("\\(") && source.endsWith("\\)")) ||
      (source.startsWith("\\[") && source.endsWith("\\]"))) &&
    source.length > 4
  ) {
    return source.slice(2, -2);
  }
  return source;
}

function findOpenEnvironment(stack: readonly OpenEnvironment[], environment: string): number {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const open = stack[index];
    if (
      open?.environment === environment &&
      !(open.kind === "frame" && open.syntax === "command")
    ) {
      return index;
    }
  }
  return -1;
}

function findClosingCommandFrame(
  stack: readonly OpenEnvironment[],
  offset: number,
): number {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const open = stack[index];
    if (
      open?.kind === "frame" &&
      open.syntax === "command" &&
      open.commandBodyTo !== undefined &&
      offset >= open.commandBodyTo
    ) {
      return index;
    }
  }
  return -1;
}

function findLastOpenList(stack: readonly OpenEnvironment[]): OpenList | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const open = stack[index];
    if (open?.kind === "list") {
      return open;
    }
  }
  return undefined;
}

function findLastOpenTheorem(
  stack: readonly OpenEnvironment[],
): OpenTheorem | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const open = stack[index];
    if (open?.kind === "theorem") {
      return open;
    }
  }
  return undefined;
}

function findLastOpenFrame(
  stack: readonly OpenEnvironment[],
): OpenFrame | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const open = stack[index];
    if (open?.kind === "frame") {
      return open;
    }
  }
  return undefined;
}

function visualTableOfContentsScope(
  options: string,
): VisualTableOfContentsRecord["scope"] {
  const names = new Set(
    options
      .split(",")
      .map((option) => option.trim().split("=", 1)[0]?.toLowerCase())
      .filter((option): option is string => option !== undefined && option.length > 0),
  );
  if (names.has("currentsubsection")) {
    return "currentSubsection";
  }
  if (names.has("currentsection")) {
    return "currentSection";
  }
  return "all";
}

function findLastManualBibliography(
  stack: readonly OpenEnvironment[],
): OpenManualBibliography | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const open = stack[index];
    if (open?.kind === "manualBibliography") {
      return open;
    }
  }
  return undefined;
}

function manualBibliographyEntries(
  text: string,
  open: OpenManualBibliography,
  end: number,
): readonly VisualBibliographyEntry[] {
  return open.items.map((item, index) => {
    const next = open.items[index + 1];
    const contentTo = next?.commandFrom ?? end;
    const plain = latexToPlainText(text.slice(item.contentFrom, contentTo));
    return {
      key: item.key,
      title: plain.slice(0, 300),
      authors: "",
      year: "",
      container: "",
      entryType: "bibitem",
      sourceFrom: item.commandFrom,
      sourceTo: contentTo,
    };
  });
}

function splitTitleMetadata(
  text: string,
  argument: ParsedArgument,
  inheritedMarkers: readonly string[] = [],
): readonly VisualSourceText[] {
  const raw = text.slice(argument.contentFrom, argument.contentTo);
  const ranges: { readonly from: number; readonly to: number }[] = [];
  let segmentFrom = 0;
  let depth = 0;
  let index = 0;
  while (index < raw.length) {
    const character = raw[index];
    if (character === "\\") {
      const control = readControl(raw, index);
      if (control === undefined) {
        index += 1;
        continue;
      }
      if (depth === 0 && (control.name === "\\" || control.name === "and")) {
        ranges.push({ from: segmentFrom, to: index });
        const optional = control.name === "\\"
          ? readOptionalArgument(raw, control.end)
          : undefined;
        segmentFrom = optional?.end ?? control.end;
        index = segmentFrom;
        continue;
      }
      index = control.end;
      continue;
    }
    if (character === "{" && !isEscapedAt(raw, index)) {
      depth += 1;
    } else if (character === "}" && !isEscapedAt(raw, index) && depth > 0) {
      depth -= 1;
    }
    index += 1;
  }
  ranges.push({ from: segmentFrom, to: raw.length });

  const pieces: VisualSourceText[] = [];
  for (const range of ranges) {
    let from = range.from;
    let to = range.to;
    while (from < to && /\s/u.test(raw[from] ?? "")) {
      from += 1;
    }
    while (to > from && /\s/u.test(raw[to - 1] ?? "")) {
      to -= 1;
    }
    if (from >= to) {
      continue;
    }
    const value = latexToPlainText(stripTitleMetadataMarkers(raw.slice(from, to)));
    if (value.length === 0) {
      continue;
    }
    pieces.push({
      from: argument.contentFrom + from,
      to: argument.contentFrom + to,
      text: value,
      ...(explicitMathContentRanges(raw.slice(from, to)).length === 0 ? {} : { segments: visualInlineContentSegments(raw.slice(from, to), argument.contentFrom + from) }),
      ...titleSourceMarkers(raw.slice(from, to), inheritedMarkers),
    });
  }
  if (pieces.length > 0) {
    return pieces;
  }
  const fallback = latexToPlainText(stripTitleMetadataMarkers(raw));
  return fallback.length === 0
    ? []
    : [{
        from: argument.contentFrom,
        to: argument.contentTo,
        text: fallback,
        ...titleSourceMarkers(raw, inheritedMarkers),
      }];
}

function titleMarkerIds(value: string): readonly string[] {
  return uniqueStrings(value.split(",").map(marker => marker.trim()).filter(marker => /^[\p{L}\p{N}*†‡_-]+$/u.test(marker)));
}

function titleSourceMarkers(value: string, inherited: readonly string[]): { readonly markers?: readonly string[] } {
  const markers = [...inherited];
  let index = 0;
  while (index < value.length) {
    if (value[index] === "%" && !isEscapedAt(value, index)) {
      index = skipComment(value, index);
      continue;
    }
    const control = value[index] === "\\" ? readControl(value, index) : undefined;
    if (control?.name === "inst") {
      const argument = readRequiredArgument(value, control.end);
      if (argument !== undefined) {
        markers.push(...titleMarkerIds(value.slice(argument.contentFrom, argument.contentTo)));
        index = argument.end;
        continue;
      }
    }
    index = control?.end ?? index + 1;
  }
  return markers.length === 0 ? {} : { markers: uniqueStrings(markers) };
}

const HIDDEN_TITLE_METADATA_COMMANDS = new Set([
  "inst",
  "thanksref",
  "thanks",
  "footnote",
  "authornote",
  "corref",
  "fnref",
  "orcidlink",
  "vspace",
  "hspace",
]);

function stripTitleMetadataMarkers(value: string): string {
  const prepared = value
    // Beamer/authblk marker commands link authors to institutions but are not
    // themselves useful prose in the title preview.
    // Preserve the visible address of the common hyperref mailto spelling.
    .replace(
      /\\href\s*\{mailto:[^{}]*\}\s*\{([^{}]*)\}/giu,
      "$1",
    );
  let output = "";
  let index = 0;
  while (index < prepared.length) {
    if (prepared[index] !== "\\") {
      output += prepared[index];
      index += 1;
      continue;
    }
    const control = readControl(prepared, index);
    if (control === undefined || !HIDDEN_TITLE_METADATA_COMMANDS.has(control.name)) {
      output += prepared[index];
      index += 1;
      continue;
    }
    const end = prepared[control.end] === "*" ? control.end + 1 : control.end;
    const optional = readOptionalArgument(prepared, end);
    const argument = readRequiredArgument(prepared, optional?.end ?? end);
    index = argument?.end ?? optional?.end ?? control.end;
  }
  return output;
}

function extractEmailMetadata(
  text: string,
  argument: ParsedArgument,
): readonly VisualSourceText[] {
  const raw = text.slice(argument.contentFrom, argument.contentTo);
  const emails: VisualSourceText[] = [];
  for (const match of raw.matchAll(
    /[A-Z0-9.!#$%&'*+/=?^_`~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/giu,
  )) {
    const value = match[0];
    if (value === undefined || match.index === undefined) {
      continue;
    }
    emails.push({
      from: argument.contentFrom + match.index,
      to: argument.contentFrom + match.index + value.length,
      text: value,
    });
  }
  return emails;
}

function uniqueVisualSourceTexts(
  values: readonly VisualSourceText[],
): readonly VisualSourceText[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.text.trim().toLocaleLowerCase();
    if (key.length === 0 || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeTheoremStyle(value: string): VisualTheoremStyle {
  return value === "definition" || value === "remark" ? value : "plain";
}

function isHeadingLevel(value: string): value is VisualHeadingLevel {
  return Object.prototype.hasOwnProperty.call(HEADING_LEVELS, value);
}

function bibliographySetting(
  kind: VisualBibliographySettingKind,
  name: string,
  value: string,
  sourceFrom: number,
  sourceTo: number,
): VisualBibliographySetting {
  const compact = value.replace(/\s+/gu, " ").trim();
  return {
    kind,
    name: name.trim().slice(0, 80),
    value: compact.slice(0, 240),
    sourceFrom,
    sourceTo,
  };
}

function bibliographySettingsFromOptions(
  source: string,
  sourceFrom: number,
  sourceTo: number,
  owner: string,
): readonly VisualBibliographySetting[] {
  return splitTikzcdOptions(source)
    .filter((option) => option.length > 0)
    .slice(0, 32)
    .map((option) => {
      const equals = topLevelEqualsIndex(option);
      const rawName = (equals < 0 ? option : option.slice(0, equals)).trim();
      const rawValue = equals < 0 ? "true" : option.slice(equals + 1).trim();
      const standaloneCitationStyle = equals < 0 && owner === "setcitestyle";
      const name = (standaloneCitationStyle ? owner : rawName)
        .toLowerCase()
        .replace(/\s+/gu, "")
        .slice(0, 80);
      const valueLatex = stripOneOuterGroup(
        standaloneCitationStyle ? rawName : rawValue,
      );
      const plain = latexToPlainText(valueLatex) || valueLatex;
      return bibliographySetting(
        bibliographyOptionKind(name, owner),
        name || owner,
        plain,
        sourceFrom,
        sourceTo,
      );
    });
}

function bibliographyOptionKind(
  name: string,
  owner: string,
): VisualBibliographySettingKind {
  if (owner === "setcitestyle" || name === "citestyle") {
    return "citationStyle";
  }
  if (name === "style" || name === "bibstyle") {
    return "style";
  }
  if (name === "backend") {
    return "backend";
  }
  if (name === "sorting" || name === "sortlocale") {
    return "sorting";
  }
  if (name === "title") {
    return "title";
  }
  if (name === "heading") {
    return "heading";
  }
  if (/^(?:type|nottype|subtype|notsubtype|keyword|notkeyword|category|notcategory|filter)$/u.test(name)) {
    return "filter";
  }
  if (/^(?:section|segment|refsection|refsegment)$/u.test(name)) {
    return "scope";
  }
  return "option";
}

function topLevelEqualsIndex(source: string): number {
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (isEscapedAt(source, index)) {
      continue;
    }
    if (character === "{" || character === "[" || character === "(") {
      depth += 1;
    } else if (character === "}" || character === "]" || character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (character === "=" && depth === 0) {
      return index;
    }
  }
  return -1;
}

function stripOneOuterGroup(source: string): string {
  const trimmed = source.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function uniqueVisualBibliographySettings(
  settings: readonly VisualBibliographySetting[],
): readonly VisualBibliographySetting[] {
  const seen = new Set<string>();
  const unique: VisualBibliographySetting[] = [];
  for (const setting of settings) {
    if (setting.value.length === 0) {
      continue;
    }
    const key = `${setting.kind}\u0000${setting.name}\u0000${setting.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(setting);
    if (unique.length >= 48) {
      break;
    }
  }
  return unique;
}

function bibliographyConfigurationStart(
  text: string,
  commandFrom: number,
  settings: readonly VisualBibliographySetting[],
): number {
  let start = commandFrom;
  let cursor = commandFrom;
  const candidates = [...settings]
    .filter((setting) => setting.sourceTo <= commandFrom)
    .sort((left, right) => right.sourceFrom - left.sourceFrom);
  for (const setting of candidates) {
    if (setting.sourceTo > cursor) {
      continue;
    }
    if (!bibliographyConfigurationGap(text.slice(setting.sourceTo, cursor))) {
      break;
    }
    start = setting.sourceFrom;
    cursor = setting.sourceFrom;
  }
  return start;
}

function bibliographyConfigurationGap(source: string): boolean {
  return source.replace(/%[^\r\n]*(?:\r?\n|$)/gu, "\n").trim().length === 0;
}

function bibliographyHeadingLooksRelevant(source: string): boolean {
  const plain = latexToPlainText(source).toLowerCase();
  return /(?:references?|bibliograph|参考文献|參考文獻|参考資料|參考資料|文献目录|文獻目錄)/u.test(plain) ||
    /\\(?:refname|bibname)\b/u.test(source);
}

function parseBibliographyPaths(value: string): readonly string[] {
  return value
    .split(",")
    .map((path) => path.trim().replaceAll("\\", "/"))
    .filter((path) => path.length > 0 && !path.includes("#") && !path.includes("\\"))
    .map((path) => /\.bib$/iu.test(path) ? path : `${path}.bib`)
    .slice(0, 16);
}

function citationFallbackLabel(command: string, keys: readonly string[]): string {
  const joined = keys.join(", ");
  return isTextualCitation(command) ? joined : `[${joined}]`;
}

function referenceFallbackLabel(command: string, keys: readonly string[]): string {
  const joined = keys.join(", ");
  return command === "eqref" ? `(${joined})` : joined;
}

function resolvedCitationLabel(
  command: string,
  keys: readonly string[],
  entries: ReadonlyMap<string, BibTeXEntry>,
): string {
  const labels = keys.map((key) => {
    const entry = entries.get(key);
    if (entry === undefined) {
      return key;
    }
    const author = citationAuthor(entry.authors);
    if (author.length > 0 && entry.year.length > 0) {
      return `${author}, ${entry.year}`;
    }
    return author || entry.year || key;
  });
  if (isTextualCitation(command) && labels.length === 1) {
    const [author = "", year = ""] = labels[0]?.split(/,\s*/u) ?? [];
    return year.length > 0 ? `${author} (${year})` : labels[0] ?? keys[0] ?? "";
  }
  // Keep the resolved author/year presentation aligned with the unresolved
  // fallback (`[citation-key]`): non-textual literature citations use square
  // brackets even after bibliography metadata becomes available.
  return `[${labels.join("; ")}]`;
}

function citationAuthor(value: string): string {
  const authors = value.split(/\s+and\s+/iu).filter((author) => author.trim().length > 0);
  const first = authors[0]?.trim() ?? "";
  const surname = first.includes(",")
    ? first.split(",")[0]?.trim() ?? ""
    : first.split(/\s+/u).at(-1) ?? "";
  return authors.length > 2 ? `${surname} et al.` : authors.length === 2
    ? `${surname} et al.`
    : surname;
}

function isTextualCitation(command: string): boolean {
  return /^(?:[Cc]itet|[Tt]extcite)$/u.test(command);
}

function toVisualBibliographyEntry(entry: BibTeXEntry): VisualBibliographyEntry {
  return {
    key: entry.key,
    title: entry.title,
    authors: entry.authors,
    year: entry.year,
    container: entry.container,
    entryType: entry.entryType,
  };
}

interface LatexAccentText {
  readonly text: string;
  readonly to: number;
}

const LATEX_NAMED_TEXT_GLYPHS: Readonly<Record<string, string>> = {
  aa: "å",
  AA: "Å",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  o: "ø",
  O: "Ø",
  l: "ł",
  L: "Ł",
  ss: "ß",
  i: "ı",
  j: "ȷ",
  S: "§",
  P: "¶",
  dag: "†",
  ddag: "‡",
  copyright: "©",
  pounds: "£",
  textcopyright: "©",
  textregistered: "®",
  texttrademark: "™",
  textsection: "§",
  textparagraph: "¶",
  textdagger: "†",
  textdaggerdbl: "‡",
  texteuro: "€",
  textsterling: "£",
  textdegree: "°",
  ldots: "…",
  dots: "…",
};

const LATEX_COMBINING_ACCENTS: Readonly<Record<string, string>> = {
  "'": "\u0301",
  '"': "\u0308",
  "`": "\u0300",
  "^": "\u0302",
  "~": "\u0303",
  "=": "\u0304",
  ".": "\u0307",
  u: "\u0306",
  v: "\u030C",
  H: "\u030B",
  c: "\u0327",
  k: "\u0328",
  r: "\u030A",
  b: "\u0331",
  d: "\u0323",
  t: "\u0361",
};

function latexAccentText(
  value: string,
  control: ParsedControl,
): LatexAccentText | undefined {
  const named = LATEX_NAMED_TEXT_GLYPHS[control.name];
  if (named !== undefined) {
    return { text: named, to: control.end };
  }
  const combining = LATEX_COMBINING_ACCENTS[control.name];
  if (combining === undefined) {
    return undefined;
  }

  const argument = readRequiredArgument(value, control.end);
  let base = "";
  let to = control.end;
  if (argument !== undefined) {
    base = latexToPlainText(value.slice(argument.contentFrom, argument.contentTo));
    to = argument.end;
  } else {
    const cursor = skipTrivia(value, control.end);
    if (cursor >= value.length) {
      return undefined;
    }
    if (value[cursor] === "\\") {
      const baseControl = readControl(value, cursor);
      if (baseControl === undefined) {
        return undefined;
      }
      base = LATEX_NAMED_TEXT_GLYPHS[baseControl.name] ??
        (baseControl.name.length === 1 ? baseControl.name : "");
      to = baseControl.end;
    } else {
      const codePoint = value.codePointAt(cursor);
      if (codePoint === undefined) {
        return undefined;
      }
      base = String.fromCodePoint(codePoint);
      to = cursor + base.length;
    }
  }
  if (base.length === 0) {
    return undefined;
  }

  const glyphs = Array.from(base);
  const first = glyphs.shift();
  if (first === undefined) {
    return undefined;
  }
  const normalizedBase = first === "ı" ? "i" : first === "ȷ" ? "j" : first;
  const text = combining === "\u0361" && glyphs.length > 0
    ? `${normalizedBase}${combining}${glyphs.join("")}`.normalize("NFC")
    : `${normalizedBase}${combining}`.normalize("NFC") + glyphs.join("");
  return { text, to };
}

function latexToPlainText(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    if (character === "%" && !isEscapedAt(value, index)) {
      index = skipComment(value, index);
      result += " ";
      continue;
    }
    if (character === "{" || character === "}") {
      index += 1;
      continue;
    }
    if (character === "~") {
      result += " ";
      index += 1;
      continue;
    }
    if (character !== "\\") {
      result += character;
      index += 1;
      continue;
    }
    const control = readControl(value, index);
    if (control === undefined) {
      index += 1;
      continue;
    }
    const accent = latexAccentText(value, control);
    if (accent !== undefined) {
      result += accent.text;
      index = accent.to;
      continue;
    }
    if (control.name === "hspace" || control.name === "vspace") {
      const spacing = readRequiredArgument(value, value[control.end] === "*" ? control.end + 1 : control.end);
      if (spacing !== undefined) {
        result += " ";
        index = spacing.end;
        continue;
      }
    }
    if (control.name === "bibinfo" || control.name === "bibfield" || control.name === "href") {
      const metadata = readRequiredArgument(value, control.end);
      const visible = metadata === undefined ? undefined : readRequiredArgument(value, metadata.end);
      if (visible !== undefined) {
        result += latexToPlainText(value.slice(visible.contentFrom, visible.contentTo));
        index = visible.end;
        continue;
      }
    }
    if (control.name === "BibitemShut") {
      index = readRequiredArgument(value, control.end)?.end ?? control.end;
      continue;
    }
    if (control.name === "texorpdfstring") {
      const visual = readRequiredArgument(value, control.end);
      const fallback = visual === undefined
        ? undefined
        : readRequiredArgument(value, visual.end);
      if (visual !== undefined && fallback !== undefined) {
        result += latexToPlainText(
          value.slice(visual.contentFrom, visual.contentTo),
        );
        index = fallback.end;
        continue;
      }
    }
    if (control.name === "\\") {
      result += " ";
    } else if (control.name.length === 1 && "&%#${}_".includes(control.name)) {
      result += control.name;
    } else if (control.name === "quad" || control.name === "qquad" || control.name === "and") {
      result += " ";
    }
    index = control.end;
  }
  return result.replace(/\s+/gu, " ").trim();
}

function structureRecordStart(record: VisualStructureRecord): number {
  switch (record.kind) {
    case "preamble":
    case "heading":
    case "label":
    case "reference":
    case "citation":
    case "textStyle":
    case "footnote":
    case "accent":
      return record.from;
    case "maketitle":
    case "tableOfContents":
    case "keywords":
    case "table":
    case "tikzcd":
    case "figure":
    case "tikzpicture":
    case "image":
    case "bibliography":
    case "documentEnd":
    case "comment":
      return record.replacement.from;
    case "theorem":
    case "frame":
    case "abstract":
    case "list":
      return record.begin.from;
  }
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function isEscapedAt(text: string, offset: number): boolean {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}
