/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import type { BibTeXEntry } from "./citation";
import { findLatexOpaqueEnvironmentEnd } from "./latexScanner";
import type { VisualFormulaAsset } from "./visualFormula";

const MAX_VISUAL_STRUCTURE_RECORDS = 4_000;
const MAX_BIBLIOGRAPHY_PREVIEW_ENTRIES = 120;

export interface VisualSourceText {
  readonly from: number;
  readonly to: number;
  readonly text: string;
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
  readonly replacement: VisualReplacementRange;
  readonly title: VisualSourceText | undefined;
  readonly authors: readonly VisualSourceText[];
  readonly affiliations: readonly VisualSourceText[];
  readonly emails: readonly VisualSourceText[];
  readonly date: VisualSourceText | undefined;
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
  readonly labels: readonly VisualLabelRecord[];
  readonly begin: VisualReplacementRange;
  readonly end: VisualReplacementRange;
  readonly bodyFrom: number;
  readonly bodyTo: number;
}

export interface VisualFrameRecord {
  readonly kind: "frame";
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
  readonly keys: readonly string[];
  readonly label: string;
  /** Resolved, serializable bibliography metadata used by the hover card. */
  readonly previews: readonly VisualCitationPreview[];
}

export interface VisualReferenceRecord {
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
}

export type VisualInlineContentSegment =
  | {
      readonly kind: "text";
      readonly text: string;
    }
  | {
      readonly kind: "math";
      readonly math: VisualMathFragment;
    };

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
  /** Exact optional argument on \begin{tikzcd}; visual body edits preserve it. */
  readonly environmentOptions: string | undefined;
  readonly visualEditable: boolean;
  readonly visualEditReason: string | undefined;
  readonly simplifiedOptions: readonly string[];
  readonly truncated: boolean;
  /** Exact local-TeX rendering; the geometric editor model remains available. */
  readonly asset?: VisualFormulaAsset;
}

export interface VisualTikzpictureRecord {
  readonly kind: "tikzpicture";
  readonly replacement: VisualReplacementRange;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  /** Exact environment source submitted to the restricted local renderer. */
  readonly tex: string;
  readonly asset?: VisualFormulaAsset;
}

export interface VisualImageRecord {
  readonly kind: "image";
  readonly replacement: VisualReplacementRange;
  readonly path: string;
  readonly caption: string | undefined;
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

export interface VisualDocumentEndRecord {
  readonly kind: "documentEnd";
  readonly language: VisualDocumentLanguage;
  readonly replacement: VisualReplacementRange;
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
  /**
   * A presentation-only wrapper whose TeX syntax is hidden without applying
   * typography to its body. The wrapper keeps an explicit edit affordance so
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
  | VisualImageRecord
  | VisualCitationRecord
  | VisualBibliographyRecord
  | VisualTextStyleRecord
  | VisualAccentRecord
  | VisualDocumentEndRecord;

export interface VisualDocumentStructure {
  readonly records: readonly VisualStructureRecord[];
  readonly bibliographyPaths: readonly string[];
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
  readonly labels: VisualLabelRecord[];
  readonly begin: VisualReplacementRange;
  readonly bodyFrom: number;
}

interface OpenFrame {
  readonly kind: "frame";
  readonly environment: "frame";
  readonly language: VisualDocumentLanguage;
  title: string | undefined;
  subtitle: string | undefined;
  readonly begin: VisualReplacementRange;
  readonly titleCommands: VisualReplacementRange[];
  readonly bodyFrom: number;
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
const TRANSPARENT_VISUAL_ENVIRONMENTS = new Set(["subequations"]);
const TRANSPARENT_VISUAL_SIZE_DECLARATIONS = new Set([
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
  const bibliographyPaths: string[] = [];
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
  const theoremCounters = new Map<string, VisualTheoremCounterState>();
  const stack: OpenEnvironment[] = [];
  let theoremStyle: VisualTheoremStyle = "plain";
  let preamble: VisualPreambleRecord | undefined;
  let title: VisualSourceText | undefined;
  let authors: readonly VisualSourceText[] = [];
  let affiliations: readonly VisualSourceText[] = [];
  let emails: readonly VisualSourceText[] = [];
  let date: VisualSourceText | undefined;
  let inDocument = options.fragmentKind === "body";
  let index = 0;
  // Some presentation commands contain a visible TeX branch followed by a
  // non-visual fallback branch. Keep scanning the visible branch so nested
  // accents/references remain interactive, then jump over the hidden branch.
  const scanJumps = new Map<number, number>();

  const pushRecord = (record: VisualStructureRecord): void => {
    if (records.length < MAX_VISUAL_STRUCTURE_RECORDS) {
      records.push(record);
    }
  };

  while (index < text.length) {
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
      index = skipVisualFunctionalConditional(
        text,
        control.end,
        text.length,
        structuralFunctionalConditionalArguments,
      ) ?? text.length;
      continue;
    }
    if (isVisualLabelConditionalControl(control.name)) {
      index = skipLiteralFalseConditional(text, control.end, text.length);
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

      const abstractMetadata = ABSTRACT_ENVIRONMENTS.get(environment);
      if (abstractMetadata !== undefined) {
        const begin = lineAwareReplacement(text, index, commandEnd);
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
        index = skipOpaqueEnvironment(text, commandEnd, environment);
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
        index = commandEnd;
        continue;
      }
      if (MATH_ENVIRONMENTS.has(environment)) {
        index = skipEnvironment(text, commandEnd, environment);
        continue;
      }

      const theorem = theoremDefinitions.get(environment);
      if (theorem !== undefined) {
        const optional = readOptionalArgument(text, commandEnd);
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
          definition: theorem,
          number: numberingKnown
            ? nextVisualTheoremNumber(
                environment,
                theorem,
                theoremCounters,
                headingNumbers,
              )
            : undefined,
          optionalTitle: optional === undefined
            ? undefined
            : latexToPlainText(optionalTitleLatex ?? ""),
          optionalTitleLatex,
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

    if (!inDocument && control.name === "usepackage") {
      const optional = readOptionalArgument(text, control.end);
      const argument = readRequiredArgument(text, optional?.end ?? control.end);
      if (argument !== undefined) {
        const packages = text
          .slice(argument.contentFrom, argument.contentTo)
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value.length > 0);
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

    if (!inDocument) {
      if (control.name === "title" || control.name === "author" || control.name === "date") {
        const optional = readOptionalArgument(text, control.end);
        const argument = readRequiredArgument(text, optional?.end ?? control.end);
        if (argument !== undefined) {
          const source: VisualSourceText = {
            from: argument.contentFrom,
            to: argument.contentTo,
            text: latexToPlainText(text.slice(argument.contentFrom, argument.contentTo)),
          };
          if (control.name === "title") {
            title = source;
          } else if (control.name === "date") {
            date = source;
          } else {
            authors = [...authors, ...splitAuthors(text, argument)];
            emails = [
              ...emails,
              ...extractEmailMetadata(text, argument),
            ];
          }
          index = argument.end;
          continue;
        }
      }
      if (
        TITLE_AFFILIATION_COMMANDS.has(control.name) ||
        TITLE_EMAIL_COMMANDS.has(control.name)
      ) {
        const optional = readOptionalArgument(text, control.end);
        const argument = readRequiredArgument(text, optional?.end ?? control.end);
        if (argument !== undefined) {
          const values = splitTitleMetadata(text, argument);
          if (TITLE_AFFILIATION_COMMANDS.has(control.name)) {
            affiliations = [...affiliations, ...values];
          } else {
            emails = [...emails, ...values];
          }
          index = argument.end;
          continue;
        }
      }
      index = control.end;
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

    const sizeDeclaration = parseVisualTransparentSizeDeclaration(
      text,
      index,
      control,
    );
    if (sizeDeclaration !== undefined) {
      pushRecord(sizeDeclaration);
      // Scan inside the group rather than jumping to its closing brace.
      index = control.end;
      continue;
    }

    const textStyle = parseVisualTextStyle(text, index, control);
    if (textStyle !== undefined) {
      pushRecord(textStyle);
      // Continue scanning inside the argument so nested styles, references and
      // inline formulas remain independent visual records.
      if (textStyle.command === "texorpdfstring") {
        scanJumps.set(textStyle.contentTo, textStyle.to);
        index = textStyle.contentFrom;
      } else {
        index = control.end;
      }
      continue;
    }

    const accent = parseVisualAccent(text, index, control);
    if (accent !== undefined) {
      pushRecord(accent);
      index = accent.to;
      continue;
    }

    if (control.name === "maketitle") {
      pushRecord({
        kind: "maketitle",
        replacement: lineAwareReplacement(text, index, control.end),
        title,
        authors: uniqueVisualSourceTexts(authors),
        affiliations: uniqueVisualSourceTexts(affiliations),
        emails: uniqueVisualSourceTexts(emails),
        date,
      });
      index = control.end;
      continue;
    }

    if (isHeadingLevel(control.name)) {
      const starred = text[control.end] === "*";
      const starEnd = starred ? control.end + 1 : control.end;
      const shortTitle = readOptionalArgument(text, starEnd);
      const argument = readRequiredArgument(text, shortTitle?.end ?? starEnd);
      if (argument !== undefined) {
        pushRecord({
          kind: "heading",
          command: control.name,
          level: HEADING_LEVELS[control.name],
          number: starred || !numberingKnown
            ? undefined
            : nextVisualHeadingNumber(
                control.name,
                numberingRootLevel,
                headingCounters,
                headingNumbers,
              ),
          from: index,
          to: argument.end,
          prefixFrom: index,
          prefixTo: argument.contentFrom,
          contentFrom: argument.contentFrom,
          contentTo: argument.contentTo,
          suffixFrom: argument.contentTo,
          suffixTo: argument.end,
          title: latexToPlainText(
            text.slice(argument.contentFrom, argument.contentTo),
          ),
        });
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

    if (CITATION_COMMANDS.has(control.name)) {
      let argumentOffset = control.end;
      for (let optionalIndex = 0; optionalIndex < 2; optionalIndex += 1) {
        const optional = readOptionalArgument(text, argumentOffset);
        if (optional === undefined) {
          break;
        }
        argumentOffset = optional.end;
      }
      const argument = readRequiredArgument(text, argumentOffset);
      if (argument !== undefined) {
        const keys = text
          .slice(argument.contentFrom, argument.contentTo)
          .split(",")
          .map((key) => key.trim())
          .filter((key) => key.length > 0)
          .slice(0, 64);
        if (keys.length > 0) {
          citedKeys.push(...keys);
          pushRecord({
            kind: "citation",
            from: index,
            to: argument.end,
            command: control.name,
            keys,
            label: citationFallbackLabel(control.name, keys),
            previews: [],
          });
        }
        index = argument.end;
        continue;
      }
    }

    if (REFERENCE_COMMANDS.has(control.name)) {
      const afterStar = text[control.end] === "*" ? control.end + 1 : control.end;
      const argument = readRequiredArgument(text, afterStar);
      if (argument !== undefined) {
        const keys = text
          .slice(argument.contentFrom, argument.contentTo)
          .split(",")
          .map((key) => key.trim())
          .filter(
            (key) => key.length > 0 && key.length <= MAX_VISUAL_LABEL_KEY_LENGTH,
          )
          .slice(0, 64);
        if (keys.length > 0) {
          pushRecord({
            kind: "reference",
            from: index,
            to: argument.end,
            command: control.name,
            keys,
            label: referenceFallbackLabel(control.name, keys),
          });
        }
        index = argument.end;
        continue;
      }
    }

    if (control.name === "bibliography" || control.name === "addbibresource") {
      const optional = control.name === "addbibresource"
        ? readOptionalArgument(text, control.end)
        : undefined;
      const argument = readRequiredArgument(text, optional?.end ?? control.end);
      if (argument !== undefined) {
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
  const resolvedRecords = resolveVisualTheoremOptionalTitles(records);
  return {
    records: resolvedRecords,
    bibliographyPaths: uniqueStrings(bibliographyPaths),
    citedKeys: uniqueStrings(citedKeys),
  };
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
  | "unknown";

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
  if (key.length === 0 || targetKind === "formula" || targetKind === "unknown") {
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
  return VISUAL_LABEL_CONDITIONAL_PRIMITIVES.has(name) || /^if[A-Za-z@]+$/u.test(name);
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

/** Attach serializable .bib metadata to citation chips and bibliography cards. */
export function resolveVisualBibliography(
  structure: VisualDocumentStructure,
  entries: readonly BibTeXEntry[],
  sourceName = "reference.bib",
): VisualDocumentStructure {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const normalizedSourceName = sourceName.trim() || "reference.bib";
  const previewEntries = entries
    .slice(0, MAX_BIBLIOGRAPHY_PREVIEW_ENTRIES)
    .map(toVisualBibliographyEntry);
  return {
    ...structure,
    records: structure.records.map((record) => {
      if (record.kind === "citation") {
        return {
          ...record,
          label: resolvedCitationLabel(record.command, record.keys, byKey),
          previews: record.keys.flatMap((key) => {
            const entry = byKey.get(key);
            return entry === undefined
              ? []
              : [{
                  ...toVisualBibliographyEntry(entry),
                  source: `${normalizedSourceName} · 已收录`,
                }];
          }),
        };
      }
      if (record.kind === "bibliography" && !record.manual) {
        return {
          ...record,
          entries: previewEntries,
          totalEntries: entries.length,
        };
      }
      return record;
    }),
  };
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

function nextVisualHeadingNumber(
  command: VisualHeadingLevel,
  numberingRootLevel: number,
  counters: Map<VisualHeadingLevel, number>,
  currentNumbers: Map<string, string>,
): string {
  const level = HEADING_LEVELS[command];
  counters.set(command, (counters.get(command) ?? 0) + 1);
  for (const deeper of HEADING_COMMANDS_BY_LEVEL) {
    if (HEADING_LEVELS[deeper] > level) {
      counters.set(deeper, 0);
      currentNumbers.delete(deeper);
    }
  }
  const number = command === "part"
    ? romanOrdinal(counters.get(command) ?? 1)
    : HEADING_COMMANDS_BY_LEVEL
        .slice(Math.min(level, numberingRootLevel), level + 1)
        .map((name) => String(counters.get(name) ?? 0))
        .join(".");
  currentNumbers.set(command, number);
  return number;
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

function romanOrdinal(value: number): string {
  let current = Math.max(1, Math.min(3_999, Math.trunc(value)));
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
  const end = findMatchingEnvironmentEnd(text, beginTo, environment);
  return end === undefined
    ? undefined
    : transparentVisualTextStyle(
        environment,
        from,
        end.to,
        from,
        beginTo,
        beginTo,
        end.from,
        end.from,
        end.to,
        `编辑 ${environment}`,
      );
}

function parseVisualTransparentSizeDeclaration(
  text: string,
  from: number,
  control: ParsedControl,
): VisualTextStyleRecord | undefined {
  if (!TRANSPARENT_VISUAL_SIZE_DECLARATIONS.has(control.name)) {
    return undefined;
  }
  let groupFrom = from - 1;
  while (groupFrom >= 0 && /[ \t\r\n]/u.test(text[groupFrom] ?? "")) {
    groupFrom -= 1;
  }
  if (
    groupFrom < 0 ||
    text[groupFrom] !== "{" ||
    text.slice(groupFrom + 1, from).trim().length > 0
  ) {
    return undefined;
  }
  const group = readDelimitedArgument(text, groupFrom, "{", "}");
  if (group === undefined || group.contentTo < control.end) {
    return undefined;
  }
  return transparentVisualTextStyle(
    control.name,
    groupFrom,
    group.end,
    groupFrom,
    control.end,
    control.end,
    group.contentTo,
    group.contentTo,
    group.end,
    `编辑 \\${control.name}`,
  );
}

function parseVisualTextStyle(
  text: string,
  from: number,
  control: ParsedControl,
): VisualTextStyleRecord | undefined {
  if (control.name === "texorpdfstring") {
    const visual = readRequiredArgument(text, control.end);
    const fallback = visual === undefined
      ? undefined
      : readRequiredArgument(text, visual.end);
    if (visual === undefined || fallback === undefined) {
      return undefined;
    }
    return {
      kind: "textStyle",
      command: control.name,
      from,
      to: fallback.end,
      prefixFrom: from,
      prefixTo: visual.contentFrom,
      contentFrom: visual.contentFrom,
      contentTo: visual.contentTo,
      // Hide the first closing brace together with the complete PDF-string
      // fallback. The visible TeX branch remains normal editable content.
      suffixFrom: visual.contentTo,
      suffixTo: fallback.end,
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
    ["sout", { bold: false, italic: false, underline: false, strike: true, smallCaps: false }],
    ["st", { bold: false, italic: false, underline: false, strike: true, smallCaps: false }],
    ["textsc", { bold: false, italic: false, underline: false, strike: false, smallCaps: true }],
  ]);
  const simpleStyle = simple.get(control.name);
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
          foreground: undefined,
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
  );
  const second = secondColor === undefined
    ? undefined
    : visualCssColor(
        text.slice(secondColor.contentFrom, secondColor.contentTo),
        colorModel,
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

function visualCssColor(value: string, model: string | undefined): string | undefined {
  const color = value.trim();
  if (color.length === 0 || color.length > 128) {
    return undefined;
  }
  const normalizedModel = model?.trim().toLocaleLowerCase("en-US");
  if (normalizedModel === "html" && /^[0-9a-f]{6}$/iu.test(color)) {
    return `#${color}`;
  }
  if (normalizedModel === "rgb") {
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
  const direct = named.get(color.toLocaleLowerCase("en-US"));
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
  const parsedRows = parseTabularRows(
    editableBodySource,
    longtableBody === undefined ? bodyFrom : 0,
  );
  const rows = longtableBody === undefined
    ? parsedRows.rows
    : reanchorVisualTableRows(parsedRows.rows, bodySource, bodyFrom);
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
    return undefined;
  }
  const simplified = new Set<string>();
  const environmentOptions = options === undefined
    ? undefined
    : text.slice(options.contentFrom, options.contentTo).trim() || undefined;
  const rows = rawRows.slice(0, MAX_VISUAL_TIKZCD_ROWS);
  const rowCells = rows.map((row) =>
    splitTabularCellSlices(row.source, row.sourceFrom).slice(
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
        splitTabularCellSlices(row.source, row.sourceFrom).length >
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
    visualEditable: !truncated && simplified.size === 0,
    visualEditReason: truncated
      ? "交换图超过可视化编辑上限。"
      : simplified.size > 0
        ? "交换图包含尚未安全支持的 tikz-cd 选项。"
        : undefined,
    simplifiedOptions: [...simplified].slice(0, 32),
    truncated,
  };
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
  const nodeParts: string[] = [];
  const arrows: PendingTikzcdArrow[] = [];
  let index = 0;
  while (index < source.length) {
    const next = source.indexOf("\\", index);
    if (next < 0) {
      nodeParts.push(source.slice(index));
      break;
    }
    const control = readControl(source, next);
    if (control?.name !== "arrow") {
      nodeParts.push(source.slice(index, control?.end ?? next + 1));
      index = control?.end ?? next + 1;
      continue;
    }
    nodeParts.push(source.slice(index, next));
    const options = readOptionalArgument(source, control.end);
    if (options === undefined) {
      simplified.add("\\arrow without an option list");
      index = control.end;
      continue;
    }
    const parsed = parseTikzcdArrowOptions(
      source.slice(options.contentFrom, options.contentTo),
      sourceFrom + options.contentFrom,
      row,
      column,
      simplified,
    );
    if (parsed !== undefined) {
      arrows.push(parsed);
    }
    index = options.end;
  }
  const nodeSource = nodeParts.join("").trim();
  const contiguousNodeFrom = source.indexOf(nodeSource);
  const nodeSourceFrom = contiguousNodeFrom >= 0
    ? sourceFrom + contiguousNodeFrom
    : sourceFrom + Math.max(0, source.search(/\S/u));
  return {
    node: mathFragmentFromLatex(nodeSource, nodeSourceFrom),
    arrows,
  };
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
    const labelMatch = /^"([\s\S]*)"(')?$/u.exec(option.source);
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

function findIncludeGraphics(
  text: string,
  from: number,
  to: number,
): { readonly path: string } | undefined {
  let index = from;
  while (index < to) {
    const next = text.indexOf("\\", index);
    if (next < 0 || next >= to) {
      return undefined;
    }
    const control = readControl(text, next);
    if (control?.name !== "includegraphics") {
      index = control?.end ?? next + 1;
      continue;
    }
    const afterStar = text[control.end] === "*" ? control.end + 1 : control.end;
    const optional = readOptionalArgument(text, afterStar);
    const argument = readRequiredArgument(text, optional?.end ?? afterStar);
    if (argument === undefined || argument.end > to) {
      return undefined;
    }
    const imagePath = text.slice(argument.contentFrom, argument.contentTo).trim();
    return validVisualImagePath(imagePath) ? { path: imagePath } : undefined;
  }
  return undefined;
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
      rowsSource: [header, data].filter((part) => part.trim().length > 0).join("\n"),
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
    result = `${result.slice(0, removal.from)}${result.slice(removal.to)}`;
  }
  return result
    .replace(/^\s*\\\\(?:\s*\[[^\]]{0,200}\])?/u, "")
    .trim();
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
): readonly AbsoluteSourceSlice[] {
  const cells: AbsoluteSourceSlice[] = [];
  let start = 0;
  let braceDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{" && !isEscapedAt(source, index)) {
      braceDepth += 1;
    } else if (character === "}" && !isEscapedAt(source, index)) {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (character === "&" && braceDepth === 0 && !isEscapedAt(source, index)) {
      cells.push(absoluteSourceSlice(source, start, index, sourceFrom));
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

/**
 * longtable preview rows are assembled from non-contiguous header/data slices.
 * Re-find each exact retained cell monotonically in the physical body so math
 * anchors still point at the real document rather than the assembled preview.
 */
function reanchorVisualTableRows(
  rows: readonly (readonly VisualTableCell[])[],
  bodySource: string,
  bodyFrom: number,
): readonly (readonly VisualTableCell[])[] {
  let cursor = 0;
  return rows.map((row) => row.map((cell) => {
    let found = bodySource.indexOf(cell.source, cursor);
    if (found < 0) {
      found = bodySource.indexOf(cell.source);
    }
    if (found < 0) {
      found = 0;
    }
    cursor = Math.min(bodySource.length, found + Math.max(1, cell.source.length));
    const delta = bodyFrom + found - cell.sourceFrom;
    const shiftMath = (math: VisualMathFragment): VisualMathFragment => ({
      ...math,
      sourceFrom: math.sourceFrom + delta,
      sourceTo: math.sourceTo + delta,
    });
    return {
      ...cell,
      sourceFrom: cell.sourceFrom + delta,
      sourceTo: cell.sourceTo + delta,
      math: cell.math === undefined ? undefined : shiftMath(cell.math),
      segments: cell.segments.map((segment) =>
        segment.kind === "text"
          ? segment
          : { ...segment, math: shiftMath(segment.math) }
      ),
    };
  }));
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
    const math = tableCellMathSource(source);
    return math === undefined
      ? [{ kind: "text", text: latexToPlainText(source) }]
      : [{ kind: "math", math: mathFragmentFromLatex(source, sourceFrom) }];
  }
  const segments: VisualInlineContentSegment[] = [];
  let offset = 0;
  for (const range of ranges) {
    appendVisualTextSegment(segments, source.slice(offset, range.from));
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
  appendVisualTextSegment(segments, source.slice(offset));
  return segments;
}

function appendVisualTextSegment(
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
    if (stack[index]?.environment === environment) {
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
  return open.items.slice(0, MAX_BIBLIOGRAPHY_PREVIEW_ENTRIES).map((item, index) => {
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

function splitAuthors(text: string, argument: ParsedArgument): readonly VisualSourceText[] {
  const raw = stripTitleMetadataMarkers(
    text.slice(argument.contentFrom, argument.contentTo),
  );
  const pieces = raw
    .split(/\\\\|\\and\b/gu)
    .map((piece) => latexToPlainText(piece))
    .filter((piece) => piece.length > 0);
  return (pieces.length > 0 ? pieces : [latexToPlainText(raw)]).map((author) => ({
    from: argument.contentFrom,
    to: argument.contentTo,
    text: author,
  }));
}

function splitTitleMetadata(
  text: string,
  argument: ParsedArgument,
): readonly VisualSourceText[] {
  const raw = stripTitleMetadataMarkers(
    text.slice(argument.contentFrom, argument.contentTo),
  );
  const pieces = raw
    .split(/\\\\|\\and\b/gu)
    .map((piece) => latexToPlainText(piece))
    .filter((piece) => piece.length > 0);
  return (pieces.length > 0 ? pieces : [latexToPlainText(raw)])
    .filter((value) => value.length > 0)
    .map((value) => ({
      from: argument.contentFrom,
      to: argument.contentTo,
      text: value,
    }));
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
    const optional = readOptionalArgument(prepared, control.end);
    const argument = readRequiredArgument(prepared, optional?.end ?? control.end);
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
  return `(${labels.join("; ")})`;
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
    case "accent":
      return record.from;
    case "maketitle":
    case "keywords":
    case "table":
    case "tikzcd":
    case "tikzpicture":
    case "image":
    case "bibliography":
    case "documentEnd":
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
