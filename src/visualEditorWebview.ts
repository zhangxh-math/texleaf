/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  MapMode,
  Prec,
  RangeSet,
  StateEffect,
  StateField,
  Transaction,
  type ChangeDesc,
  type Range,
} from "@codemirror/state";
import {
  crosshairCursor,
  Decoration,
  type DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  GutterMarker,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumberMarkers,
  lineNumberWidgetMarker,
  lineNumbers,
  rectangularSelection,
  repositionTooltips,
  runScopeHandlers,
  showTooltip,
  tooltips,
  type Panel,
  type Tooltip,
  type TooltipView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  defaultKeymap,
  deleteCharBackward,
  history,
  historyKeymap,
  indentLess,
  indentWithTab,
  insertNewlineAndIndent,
  isolateHistory,
  redo as redoLocalEdit,
  undo as undoLocalEdit,
} from "@codemirror/commands";
import {
  acceptCompletion,
  autocompletion,
  clearSnippet,
  closeBrackets,
  closeCompletion,
  completionStatus,
  closeBracketsKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  deleteBracketPair,
  insertBracket,
  nextSnippetField,
  prevSnippetField,
  startCompletion,
} from "@codemirror/autocomplete";
import {
  bracketMatching,
  foldGutter,
  indentUnit,
  indentOnInput,
  syntaxHighlighting,
  StreamLanguage,
} from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { getDocument, GlobalWorkerOptions, PDFWorker, type PDFDocumentLoadingTask, type RenderTask } from "pdfjs-dist";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import {
  VISUAL_EDITOR_PROTOCOL,
  type VisualEditorAiIssue,
  type VisualEditorBackground,
  type VisualEditorBracketToken,
  type VisualEditorCapabilities,
  type VisualEditorChange,
  type VisualEditorCompletionItem,
  type VisualEditorDiagnostic,
  type VisualEditorFocusOptions,
  type VisualEditorHostMessage,
  type VisualEditorInputAction,
  type VisualEditorInputFeatures,
  type VisualMathPreviewPlacement,
  type VisualEditorReferenceFormulaPreview,
  type VisualEditorReferenceHeadingPreview,
  type VisualEditorReferenceStructurePreview,
  type VisualEditorReferenceTheoremPreview,
  type VisualEditorSelection,
  type VisualEditorSyntaxPalette,
  type VisualEditorSyntaxToken,
  type VisualEditorTemplateMenuItem,
  type VisualEditorVirtualCompletionItem,
  type VisualEditorVirtualInputContext,
  type VisualEditorWebviewCommand,
  type VisualEditorWebviewMessage,
  type VisualFormulaRecord,
} from "./visualEditorProtocol";
import {
  emptyMathDelimiterOffsets,
  innermostLatexMathRegion,
  planVisualAlignTab,
  planVisualEnvironmentExit,
  planVisualHiddenEnvironmentBoundaryBackspace,
  planVisualListEnter,
  planVisualLogicalLineNavigation,
  planVisualInlineStyleToggle,
  planVisualTextColorApply,
  replacementPartsToCodeMirrorSnippet,
  shouldActivateVisualProviderCompletion,
  visualCompletedArgumentCursor,
  visualFloatingPreviewPlacement,
  visualLatexSearchQuerySpec,
  visualLatexCompletionContextAt,
  visualSearchInputUsesNativeHistory,
  visualSingleTextDifference,
  visualTabTargetLeavesEnvironment,
  type VisualInlineStyleTogglePlan,
  type VirtualSnippetEncoding,
  type VirtualSnippetField,
  type VirtualSnippetRange,
} from "./core/visualEditing";
import {
  resolveVisualPointerPosition,
  visualPointerTargetsCollapsedSource,
} from "./core/visualPointer";
import {
  visualBlockReplacementInclusiveEnd,
  visualDocumentEndFollowingLinePosition,
  visualSourceLineNumberRange,
  visualSourceRangeLineNumberLayout,
  visualTerminalSyntheticEofLinePosition,
  type VisualSourceRangeLineNumberLayout,
} from "./core/visualLineNumbers";
import {
  DEFAULT_CITATION_COMMANDS,
} from "./core/citation";
import {
  rebindVisualFormulaAssetSource,
  visualFormulaAssetsHaveCurrentSource,
} from "./core/visualFormula";
import { resolveVisualFormulaActivationTarget } from "./core/visualFormulaActivation";
import {
  applyAtomicCodeMirrorSnippet,
  buildVisualSelectionPresentationRangeSet,
  insertLiteralMathApostrophe,
  mergeVisualImeCompositionInputIntent,
  planProtectedFullwidthImeInsertion,
  planVisualImeCompositionUpdate,
  resolveVisualImeCompositionStartRange,
  shouldProtectVisualImeInput,
  synchronizeVisualEnvironmentNamesAfterComposition,
  type AtomicCodeMirrorSnippetField,
  type VisualSelectionPresentationRange,
  type VisualSelectionPresentationRangeSet,
  type VisualImeCompositionInputIntent,
  visualEnvironmentNameSyncExtension,
  visualActiveBracketPairs,
  visualInitialSelectionCandidate,
  visualLatexEnvironmentIndentationExtension,
  visualSelectionPresentationKey,
} from "./visualEditorCodeMirror";
import { planLeftRightEnter } from "./core/leftRightEnter";
import { planTabout } from "./core/tabout";
import type { ReplacementPart } from "./core/types";
import {
  coalesceVisualLatexIndentationChanges,
  planVisualLatexIndentationFormat,
  visualSourceIndentationColumns,
  VISUAL_LATEX_INDENT_UNIT,
} from "./core/visualIndentation";
import { createMathPreviewErrorCard } from "./mathPreviewCard";
import { resolveMathPreviewAppearance } from "./mathPreviewAppearance";
import {
  VISUAL_THEOREM_BORDER_PROPERTY,
  VISUAL_THEOREM_BORDER_VALUE,
  VISUAL_THEOREM_FRAME_BORDER,
  VISUAL_THEOREM_FRAME_RADIUS,
} from "./visualEditorTheoremFrame";
import {
  pairedVisualEnvironmentBoundaryReveal,
  selectionRetainsVisualStructureSourceReveal,
  type VisualStructureSourceRange as StructureSourceRange,
  type VisualStructureSourceReveal as StructureSourceReveal,
} from "./visualEditorStructureReveal";
import {
  indexVisualStructureReferences,
  type VisualReferenceTargetKind,
  type VisualStructureReferencePresentation,
} from "./core/visualStructure";
import type {
  VisualAbstractRecord,
  VisualAccentRecord,
  VisualBibliographyEntry,
  VisualBibliographyRecord,
  VisualBibliographySetting,
  VisualCitationPreview,
  VisualCitationRecord,
  VisualDocumentEndRecord,
  VisualFrameRecord,
  VisualHeadingRecord,
  VisualImageRecord,
  VisualInlineContentSegment,
  VisualKeywordsRecord,
  VisualLabelRecord,
  VisualListItemRecord,
  VisualListRecord,
  VisualMakeTitleRecord,
  VisualPreambleRecord,
  VisualReferenceRecord,
  VisualReplacementRange,
  VisualSourceText,
  VisualMathFragment,
  VisualStructureRecord,
  VisualFootnoteRecord,
  VisualTableCell,
  VisualTableOfContentsNotice,
  VisualTableOfContentsRecord,
  VisualTableRecord,
  VisualTextStyleRecord,
  VisualTheoremRecord,
  VisualTikzcdRecord,
  VisualTikzpictureRecord,
  VisualFigureRecord,
} from "./core/visualStructure";

interface VsCodeApi {
  postMessage(message: VisualEditorWebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

interface PersistedState {
  readonly selection?: VisualEditorSelection;
  readonly scrollTop?: number;
  readonly preambleExpanded?: boolean;
  readonly editorMode?: "visual" | "source";
}

interface RenderedFormula {
  readonly svg: string;
  readonly widthEm: number;
  readonly heightEm: number;
  /** Exact source represented by an optimistic formula-commit render. */
  readonly source?: string;
  /** Present when the SVG is an explicit render-failure card. */
  readonly errorMessage?: string;
}

interface FormulaRenderUpdate {
  readonly formulaId: string;
  readonly rendered: RenderedFormula;
}

interface CursorRenderedFormula {
  readonly formulaId: string;
  readonly cursorOffset: number;
  readonly rendered: RenderedFormula;
}

interface FormulaSourceTooltip extends Tooltip {
  readonly texleafRecord: VisualFormulaRecord;
  readonly texleafFormula: RenderedFormula;
  readonly texleafCursorOffset: number;
  readonly texleafRenderedCursorOffset: number | undefined;
}

interface FormulaFieldValue {
  readonly records: readonly VisualFormulaRecord[];
  readonly activeFormulaIds: ReadonlySet<string>;
  readonly recordById: ReadonlyMap<string, VisualFormulaRecord>;
  readonly rendered: ReadonlyMap<string, RenderedFormula>;
  readonly cursorRendered: CursorRenderedFormula | undefined;
  /** Stable IDs of formulas whose source is currently exposed. */
  readonly sourceFormulaKey: string;
  readonly enabled: boolean;
  readonly visual: boolean;
  readonly placement: VisualMathPreviewPlacement;
  readonly decorations: DecorationSet;
  readonly tooltip: FormulaSourceTooltip | null;
}

interface NativeSyntaxFieldValue {
  /** Authoritative TextMate decorations, including active-formula tokens. */
  readonly base: DecorationSet;
  /** Decorations currently allowed into CodeMirror's content DOM. */
  readonly decorations: DecorationSet;
  /** Forces a one-formula DOM rebuild after a malformed IME presentation. */
  readonly imeRepairVersion: number;
}

interface NativeBracketFieldValue {
  readonly base: DecorationSet;
  readonly decorations: DecorationSet;
  readonly enabled: boolean;
}

interface StructureFieldValue {
  readonly records: readonly VisualStructureRecord[];
  /**
   * Formula records from the same host snapshot as the structure records.
   *
   * Formula presentation reads this structure field for theorem styling, so
   * caching the shared snapshot here avoids a circular StateField read.
   */
  readonly formulaRecords: readonly VisualFormulaRecord[];
  readonly preambleExpanded: boolean;
  readonly sourceReveal: StructureSourceReveal | undefined;
  readonly enabled: boolean;
  readonly decorations: DecorationSet;
  readonly atomic: DecorationSet;
  /** Mappable ranges whose hidden/source presentation depends on selection. */
  readonly selectionRanges: VisualSelectionPresentationRangeSet;
  readonly selectionPresentationKey: string;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const toolbarElement = requiredElement<HTMLDivElement>("toolbar");
const editorHost = requiredElement<HTMLDivElement>("editor");
const editorBackground = requiredElement<HTMLDivElement>("editor-background");
const statusElement = requiredElement<HTMLSpanElement>("status");
const buildMenuButton = requiredElement<HTMLButtonElement>("build-menu-button");
const toolbarMenuTriggers = Array.from(
  document.querySelectorAll<HTMLButtonElement>("#toolbar [data-toolbar-menu]"),
);
const toolbarPopupMenus = Array.from(
  document.querySelectorAll<HTMLDivElement>(".toolbar-popup-menu"),
);
const editingContextMenu = requiredElement<HTMLDivElement>("editing-context-menu");
const buildPdfLaTexButton = requiredElement<HTMLButtonElement>("build-pdflatex");
const buildXeLaTexButton = requiredElement<HTMLButtonElement>("build-xelatex");
const buildLuaLaTexButton = requiredElement<HTMLButtonElement>("build-lualatex");
const buildBibTexButton = requiredElement<HTMLButtonElement>("build-bibtex");
const buildBibLaTexButton = requiredElement<HTMLButtonElement>("build-biblatex");
const topViewPdfButton = requiredElement<HTMLButtonElement>("top-view-pdf");
const topOpenSourceButton = requiredElement<HTMLButtonElement>("top-open-source");
const topOpenNativeSourceButton = requiredElement<HTMLButtonElement>("top-open-native-source");
const topSaveDocumentButton = requiredElement<HTMLButtonElement>("top-save-document");
const topFormatDocumentButton = requiredElement<HTMLButtonElement>("top-format-document");
const viewPdfButton = requiredElement<HTMLButtonElement>("view-pdf");
const synctexButton = requiredElement<HTMLButtonElement>("synctex");
const saveDocumentButton = requiredElement<HTMLButtonElement>("save-document");
const openSourceButton = requiredElement<HTMLButtonElement>("open-source");
const openNativeSourceButton = requiredElement<HTMLButtonElement>("open-native-source");
const aiReviewButton = requiredElement<HTMLButtonElement>("ai-review");
const aiRewriteButton = requiredElement<HTMLButtonElement>("ai-rewrite");
const aiCompletionButton = requiredElement<HTMLButtonElement>("ai-completion");
const aiReviewDocumentButton = requiredElement<HTMLButtonElement>("ai-review-document");
const aiSuggestionElement = requiredElement<HTMLDivElement>("ai-suggestion");
const aiSuggestionTitle = requiredElement<HTMLDivElement>("ai-suggestion-title");
const aiSuggestionMessage = requiredElement<HTMLDivElement>("ai-suggestion-message");
const aiSuggestionExplanation = requiredElement<HTMLDivElement>("ai-suggestion-explanation");
const aiSuggestionReplacement = requiredElement<HTMLElement>("ai-suggestion-replacement");
const aiApplyButton = requiredElement<HTMLButtonElement>("ai-apply");
const aiIgnoreButton = requiredElement<HTMLButtonElement>("ai-ignore");
const referenceHoverElement = requiredElement<HTMLDivElement>("reference-hover");
const referenceHoverContent = requiredElement<HTMLDivElement>("reference-hover-content");
const editUndoButton = requiredElement<HTMLButtonElement>("edit-undo");
const editRedoButton = requiredElement<HTMLButtonElement>("edit-redo");
const editCutButton = requiredElement<HTMLButtonElement>("edit-cut");
const editCopyButton = requiredElement<HTMLButtonElement>("edit-copy");
const editPasteButton = requiredElement<HTMLButtonElement>("edit-paste");
const topPickSnippetButton = requiredElement<HTMLButtonElement>("top-pick-snippet");
const topPickCitationButton = requiredElement<HTMLButtonElement>("top-pick-citation");
const topOpenSnippetManagerButton = requiredElement<HTMLButtonElement>("top-open-snippet-manager");
const topOpenTemplateManagerButton = requiredElement<HTMLButtonElement>("top-open-template-manager");
const templateMenuItems = requiredElement<HTMLDivElement>("template-menu-items");
const topAiReviewButton = requiredElement<HTMLButtonElement>("top-ai-review");
const topAiRewriteButton = requiredElement<HTMLButtonElement>("top-ai-rewrite");
const topAiCompletionButton = requiredElement<HTMLButtonElement>("top-ai-completion");
const topAiReviewDocumentButton = requiredElement<HTMLButtonElement>("top-ai-review-document");
const textColorButton = requiredElement<HTMLButtonElement>("text-color-button");
const textColorSwatch = requiredElement<HTMLSpanElement>("text-color-swatch");
const textColorPopover = requiredElement<HTMLDivElement>("text-color-popover");
const textColorPicker = requiredElement<HTMLInputElement>("text-color-picker");
const textColorHex = requiredElement<HTMLInputElement>("text-color-hex");
const textColorApplyButton = requiredElement<HTMLButtonElement>("text-color-apply");
const textColorCancelButton = requiredElement<HTMLButtonElement>("text-color-cancel");
const cspNonce = editorHost.dataset.cspNonce ?? "";
const persisted = parsePersistedState(vscode.getState());
let editorMode: "visual" | "source" = persisted.editorMode ?? "visual";
let editingContextSelection: VisualEditorSelection | undefined;
let activeToolbarMenu: {
  readonly trigger: HTMLButtonElement;
  readonly menu: HTMLDivElement;
} | undefined;
let toolbarBusy = false;
let pendingTextColorSelection: {
  readonly selection: VisualEditorSelection;
  readonly revision: number;
  readonly selectedSource: string;
} | undefined;

const hostSync = Annotation.define<boolean>();
const visualLogicalLineNavigation = Annotation.define<boolean>();
const hostSyncAnnotations = [
  hostSync.of(true),
  Transaction.addToHistory.of(false),
] as const;
const syntheticSnippetCompletion: Completion = { label: "TeXLeaf snippet" };
const editableCompartment = new Compartment();
const bracketMatchingCompartment = new Compartment();
const syntaxHighlightingCompartment = new Compartment();
const setFormulaDocument = StateEffect.define<{
  readonly resetRenders?: boolean;
  readonly records: readonly VisualFormulaRecord[];
  readonly enabled: boolean;
  readonly placement: VisualMathPreviewPlacement;
}>();
const setFormulaRenders = StateEffect.define<readonly FormulaRenderUpdate[]>();
const setFormulaCursorRender = StateEffect.define<CursorRenderedFormula>();
const clearFormulaCursorRender = StateEffect.define<null>();
const setFormulaEnabled = StateEffect.define<boolean>();
const setFormulaVisualMode = StateEffect.define<boolean>();
const setEditorPresentationMode = StateEffect.define<"visual" | "source">();
const setStructureDocument = StateEffect.define<readonly VisualStructureRecord[]>();
const setStructureEnabled = StateEffect.define<boolean>();
const setPreambleExpanded = StateEffect.define<boolean>();
const setStructureSourceReveal = StateEffect.define<StructureSourceReveal | undefined>();
const setAiIssues = StateEffect.define<readonly VisualEditorAiIssue[]>();
const setDiagnostics = StateEffect.define<readonly VisualEditorDiagnostic[]>();
const setNativeSyntaxTokens = StateEffect.define<
  readonly VisualEditorSyntaxToken[]
>();
const patchNativeSyntaxTokens = StateEffect.define<{
  readonly from: number;
  readonly to: number;
  readonly tokens: readonly VisualEditorSyntaxToken[];
}>();
const setNativeBracketTokens = StateEffect.define<{
  readonly enabled: boolean;
  readonly tokens?: readonly VisualEditorBracketToken[];
}>();
const patchNativeBracketTokens = StateEffect.define<{
  readonly from: number;
  readonly to: number;
  readonly tokens: readonly VisualEditorBracketToken[];
}>();
const repairVisualImeFormulaPresentation = StateEffect.define<number>();
const setVisualSnippetFrames = StateEffect.define<readonly VisualSnippetFrame[]>();
const setReverseSyncFlash = StateEffect.define<{
  readonly position: number;
  readonly sequence: number;
} | undefined>();

interface VisualSnippetFieldRange {
  readonly field: number;
  readonly from: number;
  readonly to: number;
}

interface VisualSnippetFrame {
  readonly active: number;
  readonly ranges: readonly VisualSnippetFieldRange[];
  readonly exit: number;
}

const visualSnippetFramesField = StateField.define<readonly VisualSnippetFrame[]>({
  create: () => [],
  update(value, transaction) {
    if (transaction.docChanged && value.length > 0) {
      const mapped: VisualSnippetFrame[] = [];
      for (const frame of value) {
        const exit = transaction.changes.mapPos(
          frame.exit,
          1,
          MapMode.TrackDel,
        );
        if (exit === null) {
          break;
        }
        const ranges = frame.ranges.flatMap((range) => {
          const from = transaction.changes.mapPos(
            range.from,
            -1,
            MapMode.TrackDel,
          );
          const to = transaction.changes.mapPos(
            range.to,
            1,
            MapMode.TrackDel,
          );
          return from === null || to === null || to < from
            ? []
            : [{ ...range, from, to }];
        });
        if (!ranges.some((range) => range.field === frame.active)) {
          break;
        }
        mapped.push({ active: frame.active, ranges, exit });
      }
      value = mapped;
    }

    let explicitlySet = false;
    for (const effect of transaction.effects) {
      if (effect.is(setVisualSnippetFrames)) {
        value = effect.value;
        explicitlySet = true;
      }
    }
    if (!explicitlySet && value.length > 0 && transaction.selection !== undefined) {
      // A child snippet replaces text inside its parent's active field. Its
      // CodeMirror transaction can invalidate only the child frame (or move
      // the selection just beyond that child) while the parent still contains
      // the caret. Drop invalid descendants one by one instead of clearing the
      // complete stack; otherwise a nested power/subscript consumes the outer
      // inline-math or environment Tab stop.
      while (
        value.length > 0 &&
        !visualSelectionInsideActiveSnippetField(
          transaction.newSelection,
          value.at(-1)!,
        )
      ) {
        value = value.slice(0, -1);
      }
    }
    return value;
  },
});

function mapVisualFormulaRecord(
  record: VisualFormulaRecord,
  changes: ChangeDesc,
): VisualFormulaRecord {
  return {
    ...record,
    from: changes.mapPos(record.from, 1),
    to: changes.mapPos(record.to, -1),
    // The body is a half-open range. Text typed just inside either delimiter
    // belongs to the formula, while text typed just outside remains prose.
    bodyFrom: changes.mapPos(record.bodyFrom, -1),
    bodyTo: changes.mapPos(record.bodyTo, 1),
    ...(record.references === undefined ? {} : { references: record.references.map(reference => ({
      ...reference, from: changes.mapPos(reference.from, 1), to: changes.mapPos(reference.to, -1),
    })) }),
    labels: record.labels.map((label) => ({
      ...label,
      from: changes.mapPos(label.from, 1),
      to: changes.mapPos(label.to, -1),
    })),
  };
}

const reverseSyncFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = transaction.docChanged ? value.map(transaction.changes) : value;
    for (const effect of transaction.effects) {
      if (!effect.is(setReverseSyncFlash)) {
        continue;
      }
      if (effect.value === undefined) {
        value = Decoration.none;
        continue;
      }
      const position = clampInteger(
        effect.value.position,
        0,
        transaction.state.doc.length,
      );
      const line = transaction.state.doc.lineAt(position);
      const attributes = {
        "data-texleaf-reverse-sync-target": "line",
        "data-texleaf-reverse-sync-sequence": String(effect.value.sequence),
      };
      value = Decoration.set([
        Decoration.line({
          class: "texleaf-reverse-sync-flash texleaf-reverse-sync-flash-line",
          attributes,
        }).range(line.from),
      ]);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function visualSelectionInsideActiveSnippetField(
  selection: EditorSelection,
  frame: VisualSnippetFrame,
): boolean {
  const activeRanges = frame.ranges.filter((range) => range.field === frame.active);
  return activeRanges.length > 0 && selection.ranges.every((selectionRange) =>
    activeRanges.some((range) =>
      range.from <= selectionRange.from && range.to >= selectionRange.to
    )
  );
}

const editorPresentationModeField = StateField.define<"visual" | "source">({
  create: () => editorMode,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setEditorPresentationMode)) {
        value = effect.value;
      }
    }
    return value;
  },
  provide: (field) => EditorView.editorAttributes.from(field, (mode) => ({
    class: mode === "visual" ? "texleaf-visual-mode" : "texleaf-source-mode",
  })),
});

interface AiIssueFieldValue {
  readonly issues: readonly VisualEditorAiIssue[];
  readonly decorations: DecorationSet;
}

interface DiagnosticFieldValue {
  readonly diagnostics: readonly VisualEditorDiagnostic[];
  readonly decorations: DecorationSet;
}

type DiagnosticInsightState =
  | { readonly status: "pending"; readonly requestId: number }
  | { readonly status: "unavailable" }
  | {
      readonly status: "ready";
      readonly explanation: string;
      readonly suggestion: string;
      readonly model: string;
    };

interface PendingInputRequest {
  readonly action: VisualEditorInputAction;
  readonly revision: number;
  readonly selection: VisualEditorSelection;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PendingCompletionRequest {
  readonly revision: number;
  readonly position: number;
  readonly from: number;
  readonly resolve: (result: CompletionResult | null) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PendingCompletionReferencePreviewRequest {
  readonly key: string;
  readonly revision: number;
  readonly resolve: (value: HTMLElement) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface MutableVirtualSnippetField {
  readonly index: number;
  ranges: { from: number; to: number }[];
}

interface VirtualSnippetSession {
  fields: MutableVirtualSnippetField[];
  active: number;
}

interface VirtualLatexInputSnapshot {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

interface VirtualLatexInputBinding {
  readonly input: HTMLInputElement;
  readonly context: VisualEditorVirtualInputContext;
  readonly getAnchor: () => number;
  readonly commit: (value: string) => void;
  readonly mathPreview: boolean;
  readonly onMathRendered: ((tex: string, rendered: RenderedFormula) => void) | undefined;
  snippet: VirtualSnippetSession | undefined;
  beforeValue: string;
  beforeSelectionStart: number;
  beforeSelectionEnd: number;
  beforeEditorScrollTop: number;
  beforeEditorScrollLeft: number;
  scrollRestoreSequence: number;
  readonly undoStack: VirtualLatexInputSnapshot[];
  readonly redoStack: VirtualLatexInputSnapshot[];
  completionTimer: ReturnType<typeof setTimeout> | undefined;
  mathPreviewTimer: ReturnType<typeof setTimeout> | undefined;
  mathPreviewRequestId: number | undefined;
}

interface PendingVirtualSnippetRequest {
  readonly binding: VirtualLatexInputBinding;
  readonly expectedValue: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly fallback: "none" | "tab" | "space";
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PendingVirtualCompletionRequest {
  readonly binding: VirtualLatexInputBinding;
  readonly expectedValue: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PendingVirtualMathRenderRequest {
  readonly binding: VirtualLatexInputBinding;
  readonly expectedValue: string;
  readonly tex: string;
  readonly revision: number;
  readonly projectContextKey: string;
  readonly anchor: number;
}

interface AtomicVisualHistoryEntry {
  readonly beforeText: string;
  readonly afterText: string;
  readonly beforeCaret: number;
  readonly afterCaret: number;
}

let editor: EditorView | undefined;
/** Latest host focus received while the initial EditorView is still absent. */
let pendingHostFocus: {
  readonly requestId?: number;
  readonly selection: VisualEditorSelection;
  readonly options?: VisualEditorFocusOptions;
} | undefined;
let visualLogicalLineGoalColumn: number | undefined;
let editorScrollbarTrack: HTMLDivElement | undefined;
let editorScrollbarThumb: HTMLDivElement | undefined;
let editorScrollbarFrame = 0;
let editorScrollbarResizeObserver: ResizeObserver | undefined;
let editorScrollbarMutationObserver: MutationObserver | undefined;
let persistEditorStateTimer: ReturnType<typeof setTimeout> | undefined;
type VisualDocumentHostMessage = Extract<
  VisualEditorHostMessage,
  { readonly type: "initialize" | "document" }
>;
let deferredDocumentMessage: VisualDocumentHostMessage | undefined;
let deferredDocumentTimer: ReturnType<typeof setTimeout> | undefined;
let documentVersion = 0;
let clientRevision = 0;
let projectContextKey = "";
let assetGeneration: number | undefined;
let mathPreviewPlacement: VisualMathPreviewPlacement = "autoAbove";
let inputFeatures: VisualEditorInputFeatures = {
  enabled: true,
  manualTrigger: "tab",
  matrixShortcuts: true,
  matrixEnvironments: [
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
  ],
  autoDeleteMathDelimiters: true,
  internalCompletions: true,
  mathPreviewEnabled: true,
  mathPreviewDebounceMs: 120,
  bracketPairColorizationEnabled: false,
  highlightActiveBracketPair: true,
  citationCommands: DEFAULT_CITATION_COMMANDS,
};
let editorCapabilities: VisualEditorCapabilities = {
  localFileSystem: false,
  workspaceTrusted: false,
  buildEnabled: false,
  pdfViewerEnabled: false,
  synctexEnabled: false,
};
let completionRequestSequence = 0;
const pendingCompletionRequests = new Map<number, PendingCompletionRequest>();
let mirroredCompletionRetryTimers: ReturnType<typeof setTimeout>[] = [];
let completionReferencePreviewRequestSequence = 0;
const pendingCompletionReferencePreviewRequests = new Map<
  number,
  PendingCompletionReferencePreviewRequest
>();
let virtualInputRequestSequence = 0;
const virtualLatexBindings = new WeakMap<HTMLInputElement, VirtualLatexInputBinding>();
const pendingVirtualSnippetRequests = new Map<number, PendingVirtualSnippetRequest>();
const pendingVirtualCompletionRequests = new Map<number, PendingVirtualCompletionRequest>();
let virtualCompletionPopup: HTMLElement | undefined;
let virtualCompletionItems: readonly VisualEditorVirtualCompletionItem[] = [];
let virtualCompletionSelection = 0;
let virtualCompletionBinding: VirtualLatexInputBinding | undefined;
let virtualMathRenderRequestSequence = 0;
const pendingVirtualMathRenderRequests = new Map<number, PendingVirtualMathRenderRequest>();
let virtualMathPreviewPopup: HTMLElement | undefined;
let virtualMathPreviewBinding: VirtualLatexInputBinding | undefined;
let viewportTimer: ReturnType<typeof setTimeout> | undefined;
let viewportFrame: number | undefined;
let viewportSettleTimer: ReturnType<typeof setTimeout> | undefined;
let viewportRequestSettledPending = false;
let lastViewportRequestAt = 0;
let lastViewportRequestKey: string | undefined;
let lastSettledViewportRequestKey: string | undefined;
let lastViewportGeometryKey: string | undefined;
let lastFormulaCacheRefillViewportKey: string | undefined;
const pendingFormulaCacheEvictions = new Set<string>();
let formulaCacheEvictionNoticeScheduled = false;
let cursorPreviewFrame: number | undefined;
let cursorPreviewTimer: ReturnType<typeof setTimeout> | undefined;
let cursorPreviewScheduledView: EditorView | undefined;
let cursorPreviewRequestSequence = 0;
let formulaCommitPreviewRequestSequence = 0;
const latestFormulaCommitPreviewRequests = new Map<string, number>();
let reverseSyncFlashTimer: ReturnType<typeof setTimeout> | undefined;
let reverseSyncFlashSequence = 0;
let reverseSyncWidgetFlashElement: HTMLElement | undefined;
let latestCursorPreviewRequestId = 0;
let lastCursorPreviewRequestKey: string | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let nextInputRequestId = 0;
let applyingHostOperation = false;
let suppressHostEditMessages = false;
let visualImeCompositionActive = false;
let visualImeCompositionDomEnded = false;
let visualImeCompositionBeforeText: string | undefined;
let visualImeCompositionFinalizeTimer: ReturnType<typeof setTimeout> | undefined;
interface VisualImeCompositionSession {
  readonly from: number;
  to: number;
  readonly prefix: string;
  readonly suffix: string;
  eventText: string | undefined;
  pendingInputIntent: VisualImeCompositionInputIntent | undefined;
}
let visualImeCompositionSession: VisualImeCompositionSession | undefined;
let visualImePresentationRepairSequence = 0;
let visualImeStableSelection:
  | {
      readonly doc: EditorState["doc"];
      readonly from: number;
      readonly to: number;
    }
  | undefined;
let visualImePointerGesture:
  | {
      readonly x: number;
      readonly y: number;
      readonly position: number | undefined;
      /**
       * Physical source line represented by the painted `.cm-line` under the
       * pointer before CodeMirror installs its native selection. Replacement
       * widgets can make `posAtCoords` resolve to the following line, so the
       * DOM line is authoritative for hidden begin/end rows.
       */
      readonly logicalLine:
        | { readonly from: number; readonly to: number }
        | undefined;
      moved: boolean;
    }
  | undefined;
let visualImePointerCaret:
  | {
      readonly doc: EditorState["doc"];
      readonly position: number;
    }
  | undefined;
const deferredImeHostMessages: VisualEditorHostMessage[] = [];
const atomicVisualHistoryEntries: AtomicVisualHistoryEntry[] = [];

function rememberAtomicVisualHistory(entry: AtomicVisualHistoryEntry): void {
  atomicVisualHistoryEntries.push(entry);
  if (atomicVisualHistoryEntries.length > 32) {
    atomicVisualHistoryEntries.shift();
  }
}
let activeAiIssueId: string | undefined;
let hoveredIssueCard:
  | { readonly kind: "ai"; readonly id: string; readonly anchor: HTMLElement }
  | { readonly kind: "diagnostic"; readonly id: string; readonly anchor: HTMLElement }
  | undefined;
let issueCardPointerInside = false;
let issueCardHideTimer: ReturnType<typeof setTimeout> | undefined;
let diagnosticInsightRequestSequence = 0;
const diagnosticInsights = new Map<string, DiagnosticInsightState>();
const pendingInputRequests = new Map<number, PendingInputRequest>();
let referenceHoverRequestSequence = 0;
let activeReferenceHover:
  | {
      readonly kind: "citation";
      readonly anchor: HTMLElement;
      readonly from: number;
      readonly to: number;
      readonly key: string;
    }
  | {
      readonly kind: "reference";
      readonly anchor: HTMLElement;
      readonly from: number;
      readonly to: number;
      readonly key: string;
      readonly requestId: number;
      /**
       * `unknown` is intentional: a label owned by another project file is
       * not present in this CodeMirror document, so the extension host must
       * resolve its preview kind from the project index.
       */
      readonly previewKind: VisualReferenceTargetKind;
    }
  | undefined;
let referenceHoverPointerInside = false;
let referenceHoverHideTimer: ReturnType<typeof setTimeout> | undefined;
let referenceHoverPositionFrame = 0;
const transientReferenceDiagramCleanups = new Map<HTMLElement, () => void>();
let transientReferenceDiagramObserver: MutationObserver | undefined;

const formulaField = StateField.define<FormulaFieldValue>({
  create: () => ({
    records: [],
    activeFormulaIds: new Set<string>(),
    recordById: new Map<string, VisualFormulaRecord>(),
    rendered: new Map<string, RenderedFormula>(),
    cursorRendered: undefined,
    sourceFormulaKey: "",
    enabled: true,
    visual: editorMode === "visual",
    placement: "autoAbove",
    decorations: Decoration.none,
    tooltip: null,
  }),
  update(value, transaction) {
    let records = value.records;
    let activeFormulaIds = value.activeFormulaIds;
    let recordById = value.recordById;
    let rendered = value.rendered;
    let cursorRendered = value.cursorRendered;
    if (transaction.docChanged && cursorRendered !== undefined) {
      const cursorRecord = value.records.find(
        (record) => record.id === cursorRendered?.formulaId,
      );
      if (
        cursorRecord === undefined ||
        transaction.changes.touchesRange(cursorRecord.from, cursorRecord.to) !== false
      ) {
        // The current formula changed. Keep its last complete caret SVG through
        // `previousTooltip` below until the worker returns the next complete
        // frame; do not fall back to a differently sized base render.
        cursorRendered = undefined;
      } else {
        // An edit elsewhere only moves offsets. The formula and its caret SVG
        // are unchanged, so retain both without asking the worker to repaint.
        cursorRendered = {
          ...cursorRendered,
          cursorOffset: transaction.changes.mapPos(cursorRendered.cursorOffset, 1),
        };
      }
    }
    let enabled = value.enabled;
    let visual = value.visual;
    let placement = value.placement;
    let changed = transaction.docChanged || transaction.selection !== undefined;
    let requiresFullDecorationRebuild = false;
    let recordsMayNeedSorting = false;
    const formulaRenderUpdates: FormulaRenderUpdate[] = [];
    const changedFormulaIds = new Set<string>();

    if (
      transaction.docChanged &&
      records.some((record) =>
        record.display &&
        visualFormulaReplacementRange(transaction.startState, record).to ===
          transaction.startState.doc.length
      )
    ) {
      // End-inclusive terminal widgets intentionally absorb CodeMirror's empty
      // EOF text block. Rebuild instead of merely mapping such a decoration so
      // text inserted at the old EOF is not temporarily swallowed by it.
      requiresFullDecorationRebuild = true;
    }

    if (transaction.docChanged && records.length > 0) {
      const nextRecords: VisualFormulaRecord[] = [];
      for (const record of records) {
        const touched = transaction.changes.touchesRange(record.from, record.to) !== false;
        const mapped = mapVisualFormulaRecord(record, transaction.changes);
        // Keep the formula currently being edited as a mapped source record so
        // its Math Preview tooltip can remain mounted while the host reparses
        // the new source. Other touched formulas stay out of the visual
        // replacement set until a fresh record arrives from the host.
        if (
          (!touched || selectionIntersectsFormula(transaction.state, mapped)) &&
          mapped.from < mapped.to
        ) {
          nextRecords.push(mapped);
        } else if (touched) {
          // Mapping a DecorationSet cannot remove the widget owned by a
          // formula record that we intentionally discard while waiting for
          // the host parser. Force one complete presentation rebuild so the
          // stale replacement widget does not survive at its mapped range.
          requiresFullDecorationRebuild = true;
        }
      }
      records = nextRecords;
      activeFormulaIds = new Set(records.map((record) => record.id));
      recordById = new Map(records.map((record) => [record.id, record]));
    }

    for (const effect of transaction.effects) {
      if (effect.is(setFormulaDocument)) {
        const previousRecords = records;
        if (effect.value.resetRenders) { rendered = new Map(); cursorRendered = undefined; }
        records = effect.value.records;
        recordsMayNeedSorting = true;
        activeFormulaIds = new Set(records.map((record) => record.id));
        recordById = new Map(records.map((record) => [record.id, record]));
        // Formula IDs are content-derived. Keep a bounded set of inactive IDs
        // so repeated undo/redo can restore a prior SVG even when the host has
        // already de-duplicated that ID and therefore does not send it again.
        const beforeMigration = retainRenderedFormulaCache(rendered, activeFormulaIds);
        const migrated = migrateCommittedFormulaRenders(
          previousRecords,
          records,
          beforeMigration.rendered,
          transaction.state,
        );
        const afterMigration = retainRenderedFormulaCache(migrated, activeFormulaIds);
        rendered = afterMigration.rendered;
        scheduleFormulaCacheEvictionNotice([
          ...beforeMigration.evictedFormulaIds,
          ...afterMigration.evictedFormulaIds,
        ]);
        if (
          cursorRendered !== undefined &&
          !activeFormulaIds.has(cursorRendered.formulaId)
        ) {
          cursorRendered = undefined;
        }
        enabled = effect.value.enabled;
        placement = effect.value.placement;
        changed = true;
        requiresFullDecorationRebuild = true;
      } else if (effect.is(setFormulaRenders)) {
        formulaRenderUpdates.push(...effect.value);
        for (const update of effect.value) {
          changedFormulaIds.add(update.formulaId);
        }
        changed = true;
      } else if (effect.is(setFormulaCursorRender)) {
        cursorRendered = effect.value;
        changed = true;
      } else if (effect.is(clearFormulaCursorRender)) {
        cursorRendered = undefined;
        changed = true;
      } else if (effect.is(setFormulaEnabled)) {
        enabled = effect.value;
        changed = true;
        requiresFullDecorationRebuild = true;
      } else if (effect.is(setFormulaVisualMode)) {
        visual = effect.value;
        changed = true;
        requiresFullDecorationRebuild = true;
      }
    }
    if (formulaRenderUpdates.length > 0) {
      const nextRendered = new Map(rendered);
      for (const update of formulaRenderUpdates) {
        // Refresh insertion order so the bounded Map behaves as an LRU.
        nextRendered.delete(update.formulaId);
        nextRendered.set(update.formulaId, update.rendered);
      }
      const retained = retainRenderedFormulaCache(
        nextRendered,
        activeFormulaIds,
      );
      rendered = retained.rendered;
      for (const formulaId of retained.evictedFormulaIds) {
        changedFormulaIds.add(formulaId);
      }
      scheduleFormulaCacheEvictionNotice(retained.evictedFormulaIds);
    }

    if (!changed) {
      return value;
    }
    const sortedRecords = recordsMayNeedSorting && !formulaRecordsAreSorted(records)
      ? [...records].sort(compareFormulaRecords)
      : records;
    const sourceRecords = selectedFormulaRecords(transaction.state, sortedRecords);
    const sourceFormulaKey = formulaSourceRecordKey(sourceRecords);
    if (
      !requiresFullDecorationRebuild &&
      sourceFormulaKey === value.sourceFormulaKey
    ) {
      let decorations = transaction.docChanged
        ? value.decorations.map(transaction.changes)
        : value.decorations;
      if (formulaRenderUpdates.length > 0) {
        decorations = patchFormulaRenderDecorations(
          decorations,
          recordById,
          rendered,
          changedFormulaIds,
          enabled,
          visual,
          transaction.state,
        );
      }
      return {
        records: sortedRecords,
        activeFormulaIds,
        recordById,
        rendered,
        cursorRendered,
        sourceFormulaKey,
        enabled,
        visual,
        placement,
        decorations,
        tooltip: buildActiveFormulaTooltip(
          activeFormulaPreviewTarget(transaction.state, sortedRecords),
          rendered,
          cursorRendered,
          placement,
          transaction.state,
          value.tooltip,
        ),
      };
    }
    const presentation = buildFormulaPresentation(
      sortedRecords,
      rendered,
      cursorRendered,
      enabled,
      visual,
      placement,
      transaction.state,
      value.tooltip,
    );
    return {
      records: sortedRecords,
      activeFormulaIds,
      recordById,
      rendered,
      cursorRendered,
      sourceFormulaKey: presentation.sourceFormulaKey,
      enabled,
      visual,
      placement,
      decorations: presentation.decorations,
      tooltip: presentation.tooltip,
    };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    showTooltip.from(field, (value) => value.tooltip),
  ],
});

const structureField = StateField.define<StructureFieldValue>({
  create: (state) => {
    const enabled = editorMode === "visual";
    const presentation = enabled
      ? buildStructurePresentation(
          [],
          [],
          persisted.preambleExpanded === true,
          undefined,
          state,
        )
      : emptyStructurePresentation();
    const selectionPresentationKey = visualSelectionPresentationKey(
      state,
      presentation.selectionRanges,
    );
    return {
      records: [],
      formulaRecords: [],
      preambleExpanded: persisted.preambleExpanded === true,
      sourceReveal: undefined,
      enabled,
      decorations: presentation.decorations,
      atomic: presentation.atomic,
      selectionRanges: presentation.selectionRanges,
      selectionPresentationKey,
    };
  },
  update(value, transaction) {
    let records = value.records;
    let formulaRecords = value.formulaRecords;
    let preambleExpanded = value.preambleExpanded;
    let sourceReveal = transaction.docChanged
      ? mapStructureSourceReveal(value.sourceReveal, transaction.changes)
      : value.sourceReveal;
    let enabled = value.enabled;
    const hadTerminalDocumentEndBlock = transaction.docChanged &&
      value.records.some((record) =>
        record.kind === "documentEnd" &&
        record.replacement.block &&
        visualTerminalSyntheticEofLinePosition(
            transaction.startState.doc,
            record.replacement.sourceTo,
          ) !== undefined
      );
    let selectionRanges = transaction.docChanged
      ? value.selectionRanges.map(transaction.changes)
      : value.selectionRanges;
    let selectionPresentationKey =
      transaction.docChanged || transaction.selection !== undefined
        ? visualSelectionPresentationKey(transaction.state, selectionRanges)
        : value.selectionPresentationKey;
    let rebuild = hadTerminalDocumentEndBlock ||
      selectionPresentationKey !== value.selectionPresentationKey;
    if (transaction.docChanged && records.length > 0) {
      // Decorations map themselves through document edits, but their backing
      // structure records do not. Keep those source coordinates in lock-step
      // as well: an undo immediately followed by a selection-only transaction
      // rebuilds from these records before the host parser can answer. Without
      // this mapping, the rebuild uses the pre-undo offsets and exposes the
      // following theorem/proof/table source at the caret.
      records = mapVisualStructureRecords(records, transaction.changes);
    }
    if (transaction.docChanged && formulaRecords.length > 0) {
      // Formula records participate in reference-chip and structure rendering.
      // Mapping them in the same local transaction lets a later idle host
      // acknowledgement prove that nothing changed, instead of rebuilding all
      // visual widgets merely because offsets moved after prose input.
      formulaRecords = formulaRecords.map((record) =>
        mapVisualFormulaRecord(record, transaction.changes)
      );
    }
    let decorations = transaction.docChanged
      ? value.decorations.map(transaction.changes)
      : value.decorations;
    let atomic = transaction.docChanged
      ? value.atomic.map(transaction.changes)
      : value.atomic;
    if (
      transaction.selection !== undefined &&
      sourceReveal !== undefined &&
      !selectionRetainsVisualStructureSourceReveal(
        sourceReveal,
        transaction.state.selection.ranges,
        (position) => transaction.state.doc.lineAt(
          clampInteger(position, 0, transaction.state.doc.length),
        ).number,
      )
    ) {
      // Inline commands restore their visual widget immediately after the
      // caret crosses the exact source range. Paired begin/end source remains
      // exposed anywhere on either physical boundary line so theorem/proof
      // titles and list-label options stay comfortable to edit.
      sourceReveal = undefined;
      rebuild = true;
    }
    for (const effect of transaction.effects) {
      if (effect.is(setStructureDocument)) {
        records = effect.value;
        rebuild = true;
      } else if (effect.is(setPreambleExpanded)) {
        preambleExpanded = effect.value;
        rebuild = true;
      } else if (effect.is(setStructureEnabled)) {
        enabled = effect.value;
        rebuild = true;
      } else if (effect.is(setStructureSourceReveal)) {
        sourceReveal = effect.value;
        rebuild = true;
      } else if (effect.is(setFormulaDocument)) {
        // Formula and structure indexes arrive in one host snapshot. Rebuild
        // reference chips immediately so they never flash a stale label key.
        formulaRecords = effect.value.records;
        rebuild = true;
      }
    }
    if (rebuild) {
      const presentation = enabled
        ? buildStructurePresentation(
            records,
            formulaRecords,
            preambleExpanded,
            sourceReveal,
            transaction.state,
          )
        : emptyStructurePresentation();
      decorations = presentation.decorations;
      atomic = presentation.atomic;
      selectionRanges = presentation.selectionRanges;
      selectionPresentationKey = visualSelectionPresentationKey(
        transaction.state,
        selectionRanges,
      );
    }
    return {
      records,
      formulaRecords,
      preambleExpanded,
      sourceReveal,
      enabled,
      decorations,
      atomic,
      selectionRanges,
      selectionPresentationKey,
    };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.from(field, (value) => () => value.atomic),
  ],
});

/**
 * Keep CodeMirror's terminal document boundary on the collapsed footer.
 *
 * An atomic range intentionally excludes its endpoints. Thus a caret restored,
 * clicked, or moved to `doc.length` can otherwise sit after a collapsed
 * `\\end{document}` even though there is no editable visual line there. This
 * filter only redirects empty selections while the terminal footer is really
 * collapsed. Source mode, an explicitly revealed footer, non-empty selections,
 * and edits that create genuine tail content remain byte-for-byte untouched.
 */
const visualTerminalDocumentEndSelectionBarrier =
  EditorState.transactionFilter.of((transaction) => {
    if (transaction.docChanged) {
      return transaction;
    }
    const changesTerminalPresentation = transaction.effects.some((effect) =>
      effect.is(setStructureDocument) ||
      effect.is(setStructureEnabled) ||
      effect.is(setStructureSourceReveal)
    );
    if (transaction.selection === undefined && !changesTerminalPresentation) {
      return transaction;
    }

    const current = transaction.startState.field(structureField, false);
    let records = current?.records ?? [];
    let enabled = current?.enabled === true;
    let sourceReveal = current?.sourceReveal;
    for (const effect of transaction.effects) {
      if (effect.is(setStructureDocument)) {
        records = effect.value;
      } else if (effect.is(setStructureEnabled)) {
        enabled = effect.value;
      } else if (effect.is(setStructureSourceReveal)) {
        sourceReveal = effect.value;
      }
    }
    if (!enabled) {
      return transaction;
    }

    const terminal = records.find(
      (record): record is VisualDocumentEndRecord =>
        record.kind === "documentEnd" &&
        record.replacement.block &&
        record.replacement.from < record.replacement.to &&
        validRange(
          record.replacement.from,
          record.replacement.to,
          transaction.newDoc.length,
        ) &&
        visualTerminalSyntheticEofLinePosition(
            transaction.newDoc,
            record.replacement.sourceTo,
          ) !== undefined &&
        !sourceRevealTouchesRange(
          sourceReveal,
          record.replacement.sourceFrom,
          record.replacement.sourceTo,
        ),
    );
    if (terminal === undefined) {
      return transaction;
    }

    let corrected = false;
    const terminalPhysicalLineEnd = transaction.newDoc.lineAt(
      terminal.replacement.from,
    ).to;
    const ranges = transaction.newSelection.ranges.map((range) => {
      if (
        !range.empty ||
        (range.head !== transaction.newDoc.length &&
          range.head !== terminalPhysicalLineEnd)
      ) {
        return range;
      }
      corrected = true;
      return EditorSelection.cursor(terminal.replacement.from, -1);
    });
    return corrected
      ? [
          transaction,
          {
            selection: EditorSelection.create(
              ranges,
              transaction.newSelection.mainIndex,
            ),
            sequential: true,
          },
        ]
      : transaction;
  });

const aiIssueField = StateField.define<AiIssueFieldValue>({
  create: () => ({ issues: [], decorations: Decoration.none }),
  update(value, transaction) {
    let issues = value.issues;
    let changed = transaction.docChanged;
    if (transaction.docChanged && issues.length > 0) {
      issues = issues.flatMap((issue) => {
        if (transaction.changes.touchesRange(issue.from, issue.to) !== false) {
          return [];
        }
        const from = transaction.changes.mapPos(issue.from, 1);
        const to = transaction.changes.mapPos(issue.to, -1);
        return from < to ? [{ ...issue, from, to }] : [];
      });
    }
    for (const effect of transaction.effects) {
      if (effect.is(setAiIssues)) {
        issues = effect.value;
        changed = true;
      }
    }
    if (!changed) {
      return value;
    }
    return {
      issues,
      decorations: buildAiIssueDecorations(issues, transaction.state.doc.length),
    };
  },
  provide: (field) => EditorView.decorations.from(
    field,
    (value) => value.decorations,
  ),
});

const diagnosticField = StateField.define<DiagnosticFieldValue>({
  create: () => ({ diagnostics: [], decorations: Decoration.none }),
  update(value, transaction) {
    let diagnostics = value.diagnostics;
    let changed = transaction.docChanged;
    if (transaction.docChanged && diagnostics.length > 0) {
      diagnostics = diagnostics.flatMap((diagnostic) => {
        if (transaction.changes.touchesRange(diagnostic.from, diagnostic.to) !== false) {
          return [];
        }
        const from = transaction.changes.mapPos(diagnostic.from, 1);
        const to = transaction.changes.mapPos(diagnostic.to, -1);
        return [{ ...diagnostic, from, to: Math.max(from, to) }];
      });
    }
    for (const effect of transaction.effects) {
      if (effect.is(setDiagnostics)) {
        diagnostics = effect.value;
        changed = true;
      }
    }
    if (!changed) {
      return value;
    }
    return {
      diagnostics,
      decorations: buildDiagnosticDecorations(
        diagnostics,
        transaction.state.doc.length,
      ),
    };
  },
  provide: (field) => EditorView.decorations.from(
    field,
    (value) => value.decorations,
  ),
});

const nativeSyntaxField = StateField.define<NativeSyntaxFieldValue>({
  create: () => ({
    base: Decoration.none,
    decorations: Decoration.none,
    imeRepairVersion: 0,
  }),
  update(value, transaction) {
    let base = transaction.docChanged
      ? value.base.map(transaction.changes)
      : value.base;
    let imeRepairVersion = value.imeRepairVersion;
    if (transaction.docChanged) {
      // Preserve mapped TextMate marks for unchanged characters on the edited
      // line. Clearing the whole logical line made every keystroke paint one
      // default-foreground frame before the Extension Host returned its exact
      // incremental token patch. Newly inserted characters get a synchronous
      // optimistic mark, inferred from their LaTeX context or nearest native
      // token. The authoritative patch atomically replaces the complete line
      // a moment later, so this removes the white flash without weakening the
      // native-theme bridge.
      const optimistic = optimisticNativeSyntaxDecorationRanges(
        base,
        transaction,
      );
      if (optimistic.length > 0) {
        base = base.update({ add: optimistic, sort: true });
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(setNativeSyntaxTokens)) {
        base = buildNativeSyntaxDecorations(
          effect.value,
          transaction.state.doc.length,
        );
      } else if (effect.is(patchNativeSyntaxTokens)) {
        const from = Math.max(
          0,
          Math.min(transaction.state.doc.length, effect.value.from),
        );
        const to = Math.max(
          from,
          Math.min(transaction.state.doc.length, effect.value.to),
        );
        const add = nativeSyntaxDecorationRanges(
          effect.value.tokens,
          transaction.state.doc.length,
        );
        base = base.update({
          filterFrom: from,
          filterTo: to,
          filter: (tokenFrom, tokenTo) =>
            from === to
              ? tokenFrom !== from && tokenTo !== to
              : tokenTo <= from || tokenFrom >= to,
          add,
          sort: true,
        });
      } else if (effect.is(repairVisualImeFormulaPresentation)) {
        imeRepairVersion = effect.value;
      }
    }
    return {
      base,
      decorations: nativeSyntaxDecorationsForPresentation(
        base,
        transaction.state,
        imeRepairVersion,
      ),
      imeRepairVersion,
    };
  },
  provide: (field) => EditorView.decorations.from(
    field,
    (value) => value.decorations,
  ),
});

const nativeBracketField = StateField.define<NativeBracketFieldValue>({
  create: () => ({
    base: Decoration.none,
    decorations: Decoration.none,
    enabled: false,
  }),
  update(value, transaction) {
    let base = transaction.docChanged
      ? value.base.map(transaction.changes)
      : value.base;
    let enabled = value.enabled;
    for (const effect of transaction.effects) {
      if (effect.is(setNativeBracketTokens)) {
        enabled = effect.value.enabled;
        if (effect.value.tokens !== undefined) {
          base = buildNativeBracketDecorations(
            effect.value.tokens,
            transaction.state.doc.length,
          );
        }
      } else if (effect.is(patchNativeBracketTokens)) {
        const from = Math.max(
          0,
          Math.min(transaction.state.doc.length, effect.value.from),
        );
        const to = Math.max(
          from,
          Math.min(transaction.state.doc.length, effect.value.to),
        );
        base = base.update({
          filterFrom: from,
          filterTo: to,
          filter: (tokenFrom, tokenTo) =>
            from === to
              ? tokenFrom !== from && tokenTo !== to
              : tokenTo <= from || tokenFrom >= to,
          add: nativeBracketDecorationRanges(
            effect.value.tokens,
            transaction.state.doc.length,
          ),
          sort: true,
        });
      }
    }
    return {
      base,
      decorations: enabled ? base : Decoration.none,
      enabled,
    };
  },
  provide: (field) => EditorView.decorations.from(
    field,
    (value) => value.decorations,
  ),
});

const VISUAL_SOFT_WRAP_MAX_INDENT_COLUMNS = 16;

/**
 * Preserve a physical line's leading source indentation on its soft-wrapped
 * rows. CodeMirror intentionally leaves continuation indentation to CSS. Extra
 * logical-start padding reserves the indentation for every visual row, while a
 * zero-width ::before marker pulls only the first row back. This neither
 * consumes the real borders used by visual cards nor relies on `text-indent`,
 * whose value CodeMirror samples from the first mounted line when drawing
 * rectangular selections.
 */
function visualSoftWrapIndentDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const visitedLines = new Set<number>();
  for (const visibleRange of view.visibleRanges) {
    let position = view.state.doc.lineAt(visibleRange.from).from;
    while (position <= visibleRange.to && position <= view.state.doc.length) {
      const line = view.state.doc.lineAt(position);
      if (!visitedLines.has(line.from)) {
        visitedLines.add(line.from);
        // The rendered continuation is capped below, so never materialise an
        // arbitrarily long logical line merely to inspect its leading prefix.
        const indentationProbe = view.state.sliceDoc(
          line.from,
          Math.min(
            line.to,
            line.from + VISUAL_SOFT_WRAP_MAX_INDENT_COLUMNS + 1,
          ),
        );
        const indentation = /^[\t ]+/u.exec(indentationProbe)?.[0] ?? "";
        const columns = visualSourceIndentationColumns(
          indentation,
          view.state.tabSize,
          VISUAL_SOFT_WRAP_MAX_INDENT_COLUMNS,
        );
        if (columns > 0) {
          decorations.push(
            Decoration.line({
              class: "texleaf-soft-wrap-indent",
              attributes: {
                style: `--texleaf-soft-wrap-indent:${columns}ch`,
                "data-texleaf-soft-wrap-indent-columns": String(columns),
              },
            }).range(line.from),
          );
        }
      }
      if (line.to >= visibleRange.to || line.to >= view.state.doc.length) {
        break;
      }
      position = line.to + 1;
    }
  }
  return Decoration.set(decorations, true);
}

const visualSoftWrapIndentPlugin = ViewPlugin.fromClass(class {
  public decorations: DecorationSet;

  public constructor(view: EditorView) {
    this.decorations = visualSoftWrapIndentDecorations(view);
  }

  public update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.startState.tabSize !== update.state.tabSize
    ) {
      this.decorations = visualSoftWrapIndentDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

const VISUAL_ACTIVE_BRACKET_HIGHLIGHT_NAME =
  "texleaf-active-bracket-pair";
const VISUAL_ACTIVE_BRACKET_MAX_DOM_RANGE_LENGTH = 256;
type VisualDomRange = InstanceType<typeof window.Range>;

interface VisualHighlightRegistry {
  set(name: string, highlight: Highlight): void;
  delete(name: string): boolean;
}

interface VisualActiveBracketHighlightController {
  schedule(): void;
  clear(): void;
}

const visualActiveBracketHighlightControllers = new WeakMap<
  EditorView,
  VisualActiveBracketHighlightController
>();

function visualHighlightRegistry(): VisualHighlightRegistry | undefined {
  const registry = CSS.highlights as HighlightRegistry &
    Partial<VisualHighlightRegistry>;
  return typeof registry?.set === "function" &&
      typeof registry.delete === "function"
    ? registry as VisualHighlightRegistry
    : undefined;
}

function clearVisualActiveBracketHighlight(view: EditorView): void {
  visualActiveBracketHighlightControllers.get(view)?.clear();
}

function scheduleVisualActiveBracketHighlight(view: EditorView): void {
  visualActiveBracketHighlightControllers.get(view)?.schedule();
}

/**
 * Visual mode cannot use CodeMirror's ordinary `cm-matchingBracket` marks:
 * inserting/removing those nested spans next to a live Chromium IME range can
 * corrupt the composition DOM. CSS Custom Highlight paints the same exact DOM
 * ranges without changing the content tree. CodeMirror owns every node below
 * contentDOM and deliberately removes foreign classes during its next
 * decoration sync. `docViewUpdate` rebinds the DOM Ranges after CodeMirror
 * replaces syntax/bracket token nodes. The Highlight background is painted
 * behind glyphs from each endpoint's already-visible currentColor, so a theme
 * cannot accidentally erase it by defining every bracket/focus token as
 * transparent. Foreground lines, outlines, and overlays are deliberately
 * forbidden so narrow or tightly adjacent text remains untouched.
 */
const visualActiveBracketHighlightPlugin = ViewPlugin.fromClass(class {
  private frame: number | undefined;

  public constructor(private readonly view: EditorView) {
    visualActiveBracketHighlightControllers.set(view, this);
    this.schedule();
  }

  public update(update: ViewUpdate): void {
    const modeChanged =
      update.startState.field(editorPresentationModeField) !==
      update.state.field(editorPresentationModeField);
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.focusChanged ||
      modeChanged
    ) {
      this.schedule();
    }
  }

  public docViewUpdate(): void {
    // Effect-only native syntax, bracket, formula, and structure decoration
    // updates can rebuild text nodes without changing the document, selection,
    // viewport, geometry, or focus. CSS Highlight ranges point at concrete DOM
    // text nodes, so recreate them after CodeMirror has completed that redraw.
    this.schedule();
  }

  public schedule(): void {
    if (this.frame !== undefined) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.paint();
    });
  }

  public clear(): void {
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    visualHighlightRegistry()?.delete(VISUAL_ACTIVE_BRACKET_HIGHLIGHT_NAME);
  }

  public destroy(): void {
    this.clear();
    visualActiveBracketHighlightControllers.delete(this.view);
  }

  private paint(): void {
    const registry = visualHighlightRegistry();
    if (
      !visualActiveBracketPaintingEnabled(this.view)
    ) {
      registry?.delete(VISUAL_ACTIVE_BRACKET_HIGHLIGHT_NAME);
      return;
    }
    const ranges: VisualDomRange[] = [];
    for (const pair of visualActiveBracketPairs(this.view.state)) {
      const first = visualActiveBracketDomRange(
        this.view,
        pair.first.from,
        pair.first.to,
      );
      const second = visualActiveBracketDomRange(
        this.view,
        pair.second.from,
        pair.second.to,
      );
      // If either endpoint remains hidden behind a visual replacement, do not
      // paint a misleading half-pair or force CodeMirror to reveal its source.
      if (first === undefined || second === undefined) {
        continue;
      }
      ranges.push(first, second);
    }
    if (registry !== undefined && ranges.length > 0 && typeof Highlight === "function") {
      registry.set(
        VISUAL_ACTIVE_BRACKET_HIGHLIGHT_NAME,
        new Highlight(...ranges),
      );
    } else {
      registry?.delete(VISUAL_ACTIVE_BRACKET_HIGHLIGHT_NAME);
    }
  }
});

function visualActiveBracketDomRange(
  view: EditorView,
  from: number,
  to: number,
): VisualDomRange | undefined {
  if (
    from < 0 ||
    to <= from ||
    to > view.state.doc.length ||
    to - from > VISUAL_ACTIVE_BRACKET_MAX_DOM_RANGE_LENGTH
  ) {
    return undefined;
  }
  try {
    const start = view.domAtPos(from);
    const end = view.domAtPos(to);
    const range = view.contentDOM.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range.toString() === view.state.sliceDoc(from, to)
      ? range
      : undefined;
  } catch {
    return undefined;
  }
}

function visualActiveBracketPaintingEnabled(view: EditorView): boolean {
  return (
    view.state.field(editorPresentationModeField) === "visual" &&
    inputFeatures.highlightActiveBracketPair &&
    view.hasFocus &&
    !visualImeCompositionActive &&
    !view.composing &&
    !visualImeOwnsKeyboardInput(view)
  );
}

const viewportPlugin = ViewPlugin.fromClass(class {
  public constructor(_view: EditorView) {
    scheduleViewportRequest();
    scheduleSettledViewportRequest();
    scheduleCursorPreviewRequest();
  }

  public update(update: ViewUpdate): void {
    if (update.viewportChanged || update.docChanged || update.geometryChanged) {
      scheduleViewportRequest();
      if (update.docChanged) {
        scheduleSettledViewportRequest();
      }
    }
    if (update.selectionSet || update.docChanged) {
      scheduleCursorPreviewRequest(update.view);
    }
    if (
      update.selectionSet &&
      !update.docChanged &&
      !update.transactions.some((transaction) =>
        transaction.annotation(hostSync) === true
      )
    ) {
      requestCommittedFormulaAfterSelectionLeave(update);
    }
  }
});

interface VisualLineNumberAnchorMeasurement {
  readonly anchorId: number;
  readonly target: HTMLElement;
  readonly shift: number | undefined;
}

interface VisualLineNumberAnchorReadResult {
  readonly measurements: readonly VisualLineNumberAnchorMeasurement[];
  readonly observed: readonly Element[];
}

let visualLineNumberAnchorScopeSequence = 0;

function visualLineNumberAnchorId(element: HTMLElement): number | undefined {
  const value = Number(element.dataset.texleafLineNumberAnchorId);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function firstVisibleTextRect(element: HTMLElement): DOMRect | undefined {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if ((node.textContent ?? "").trim().length === 0) {
      continue;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects.item(index);
      if (rect !== null && rect.width > 0 && rect.height > 0) {
        return rect;
      }
    }
  }
  const fallback = element.getClientRects().item(0);
  return fallback !== null && fallback.width > 0 && fallback.height > 0
    ? fallback
    : undefined;
}

const visualLineNumberAnchorPlugin = ViewPlugin.fromClass(class {
  private readonly styleElement: HTMLStyleElement;
  private readonly resizeObserver: ResizeObserver | undefined;
  private readonly mutationObserver: MutationObserver | undefined;
  private readonly observed = new Set<Element>();
  private readonly scope: string;
  private destroyed = false;

  public constructor(private readonly view: EditorView) {
    this.scope = String(++visualLineNumberAnchorScopeSequence);
    view.dom.dataset.texleafLineNumberAnchorScope = this.scope;
    this.styleElement = document.createElement("style");
    if (cspNonce.length > 0) {
      this.styleElement.setAttribute("nonce", cspNonce);
    }
    this.styleElement.dataset.texleafLineNumberAnchorStyles = this.scope;
    document.head.append(this.styleElement);
    this.resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => this.requestAlignment())
      : undefined;
    this.mutationObserver = typeof MutationObserver === "function"
      ? new MutationObserver(() => this.requestAlignment())
      : undefined;
    this.mutationObserver?.observe(view.dom, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    this.requestAlignment();
    void document.fonts?.ready.then(() => {
      if (!this.destroyed) {
        this.requestAlignment();
      }
    });
  }

  public update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.selectionSet
    ) {
      this.requestAlignment();
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.observed.clear();
    this.styleElement.remove();
    delete this.view.dom.dataset.texleafLineNumberAnchorScope;
  }

  private requestAlignment(): void {
    if (this.destroyed) {
      return;
    }
    this.view.requestMeasure({
      key: this,
      read: () => this.readAlignment(),
      write: (result) => this.writeAlignment(result),
    });
  }

  private readAlignment(): VisualLineNumberAnchorReadResult {
    const anchors = new Map<number, DOMRect>();
    const observed: Element[] = [];
    const anchorElements = this.view.contentDOM.querySelectorAll<HTMLElement>(
      "[data-texleaf-line-number-anchor-id]",
    );
    for (let index = 0; index < anchorElements.length; index += 1) {
      const element = anchorElements[index]!;
      if (element.classList.contains("texleaf-line-number-anchor-target")) {
        continue;
      }
      observed.push(element);
      const anchorId = visualLineNumberAnchorId(element);
      if (anchorId === undefined || anchors.has(anchorId)) {
        continue;
      }
      const rect = firstVisibleTextRect(element);
      if (rect !== undefined) {
        anchors.set(anchorId, rect);
      }
    }

    const scaleY = Number.isFinite(this.view.scaleY) && this.view.scaleY > 0
      ? this.view.scaleY
      : 1;
    const measurements: VisualLineNumberAnchorMeasurement[] = [];
    const targets = this.view.dom.querySelectorAll<HTMLElement>(
      ".texleaf-line-number-anchor-target[data-texleaf-line-number-anchor-id]",
    );
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]!;
      const value = target.querySelector<HTMLElement>(
        ".texleaf-line-number-anchor-value",
      );
      observed.push(target);
      if (value !== null) {
        observed.push(value);
      }
      const anchorId = visualLineNumberAnchorId(target);
      const anchorRect = anchorId === undefined ? undefined : anchors.get(anchorId);
      const valueRect = value === null ? undefined : firstVisibleTextRect(value);
      let shift: number | undefined;
      if (anchorId !== undefined && anchorRect !== undefined && valueRect !== undefined) {
        const applied = Number(target.dataset.texleafLineNumberAnchorShift);
        const appliedShift = Number.isFinite(applied) ? applied : 0;
        const anchorCenter = anchorRect.top + anchorRect.height / 2;
        const paintedValueCenter = valueRect.top + valueRect.height / 2;
        const unshiftedValueCenter = paintedValueCenter - appliedShift * scaleY;
        const measured = (anchorCenter - unshiftedValueCenter) / scaleY;
        if (Number.isFinite(measured) && Math.abs(measured) <= 96) {
          shift = Math.round(measured * 4) / 4;
        }
      }
      measurements.push({
        anchorId: anchorId ?? -1,
        target,
        shift,
      });
    }
    return { measurements, observed };
  }

  private writeAlignment(result: VisualLineNumberAnchorReadResult): void {
    const current = new Set(result.observed.filter((element) => element.isConnected));
    for (const element of this.observed) {
      if (!current.has(element)) {
        this.resizeObserver?.unobserve(element);
        this.observed.delete(element);
      }
    }
    for (const element of current) {
      if (!this.observed.has(element)) {
        this.observed.add(element);
        this.resizeObserver?.observe(element);
      }
    }

    const shifts = new Map<number, number>();
    for (const measurement of result.measurements) {
      if (!measurement.target.isConnected || measurement.shift === undefined) {
        delete measurement.target.dataset.texleafLineNumberAnchorShift;
        continue;
      }
      const normalized = Object.is(measurement.shift, -0) ? 0 : measurement.shift;
      measurement.target.dataset.texleafLineNumberAnchorShift = String(normalized);
      shifts.set(measurement.anchorId, normalized);
    }
    const scope = this.scope;
    this.styleElement.textContent = [...shifts]
      .map(([anchorId, shift]) =>
        `.cm-editor[data-texleaf-line-number-anchor-scope="${scope}"] ` +
        `.texleaf-line-number-anchor-target[data-texleaf-line-number-anchor-id="${anchorId}"] ` +
        `.texleaf-line-number-anchor-value{transform:translateY(${shift}px)}`
      )
      .join("\n");
  }
});

const measuredBlockPlugin = ViewPlugin.fromClass(class {
  private readonly observed = new Set<Element>();
  private readonly observer: ResizeObserver | undefined;
  private observationFrame: number | undefined;
  private exactMeasureFrame: number | undefined;

  public constructor(private readonly view: EditorView) {
    this.observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => this.requestExactMeasure())
      : undefined;
    this.scheduleObservationSync();
  }

  public update(update: ViewUpdate): void {
    if (update.viewportChanged || update.docChanged || update.geometryChanged) {
      this.scheduleObservationSync();
    }
  }

  public destroy(): void {
    if (this.observationFrame !== undefined) {
      cancelAnimationFrame(this.observationFrame);
    }
    if (this.exactMeasureFrame !== undefined) {
      cancelAnimationFrame(this.exactMeasureFrame);
    }
    this.observer?.disconnect();
    this.observed.clear();
  }

  private scheduleObservationSync(): void {
    if (this.observationFrame !== undefined) {
      cancelAnimationFrame(this.observationFrame);
    }
    this.observationFrame = requestAnimationFrame(() => {
      this.observationFrame = undefined;
      const current = new Set<Element>(
        Array.from(this.view.dom.querySelectorAll(
          ".texleaf-measured-block-shell, .texleaf-formula-widget-inline",
        )),
      );
      let membershipChanged = false;
      for (const element of this.observed) {
        if (!current.has(element)) {
          this.observer?.unobserve(element);
          this.observed.delete(element);
          membershipChanged = true;
        }
      }
      for (const element of current) {
        if (!this.observed.has(element)) {
          this.observed.add(element);
          this.observer?.observe(element);
          membershipChanged = true;
        }
      }
      if (membershipChanged || this.observer === undefined) {
        this.view.requestMeasure();
      }
    });
  }

  private requestExactMeasure(): void {
    if (this.exactMeasureFrame !== undefined) {
      cancelAnimationFrame(this.exactMeasureFrame);
    }
    this.exactMeasureFrame = requestAnimationFrame(() => {
      this.exactMeasureFrame = undefined;
      this.view.requestMeasure();
    });
  }
});

const mappedWidgetRangePlugin = ViewPlugin.fromClass(class {
  public constructor(_view: EditorView) {}

  public update(update: ViewUpdate): void {
    if (!update.docChanged) {
      return;
    }
    const elements = update.view.dom.querySelectorAll<HTMLElement>(
      "[data-texleaf-source-from], [data-formula-from], [data-texleaf-body-from], [data-texleaf-columns-from], [data-texleaf-indent-from]",
    );
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]!;
      mapWidgetDatasetRange(update, element, "texleafSourceFrom", "texleafSourceTo");
      mapWidgetDatasetRange(update, element, "formulaFrom", "formulaTo");
      mapWidgetDatasetRange(update, element, "formulaBodyFrom", "formulaBodyTo");
      mapWidgetDatasetRange(update, element, "texleafBodyFrom", "texleafBodyTo");
      mapWidgetDatasetRange(update, element, "texleafColumnsFrom", "texleafColumnsTo");
      const indentationFrom = Number(element.dataset.texleafIndentFrom);
      if (Number.isSafeInteger(indentationFrom)) {
        const mapped = update.changes.mapPos(indentationFrom, 1);
        const mappedText = String(mapped);
        if (element.dataset.texleafIndentFrom !== mappedText) {
          element.dataset.texleafIndentFrom = mappedText;
        }
        refreshVisualSourceIndentation(element, update.state, mapped);
      }
    }
  }
});

function mapWidgetDatasetRange(
  update: ViewUpdate,
  element: HTMLElement,
  fromKey: keyof DOMStringMap,
  toKey: keyof DOMStringMap,
): void {
  const from = Number(element.dataset[fromKey]);
  const to = Number(element.dataset[toKey]);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) {
    return;
  }
  const mappedFrom = String(update.changes.mapPos(from, 1));
  const mappedTo = String(update.changes.mapPos(to, -1));
  if (element.dataset[fromKey] !== mappedFrom) {
    element.dataset[fromKey] = mappedFrom;
  }
  if (element.dataset[toKey] !== mappedTo) {
    element.dataset[toKey] = mappedTo;
  }
}

const VISUAL_FRAME_SURFACE =
  "color-mix(in srgb, var(--vscode-editorWidget-background) 72%, var(--vscode-editor-background))";
const VISUAL_FRAME_HEADER =
  "color-mix(in srgb, var(--vscode-textLink-foreground) 10%, var(--vscode-editorWidget-background))";
const VISUAL_FRAME_THEOREM_SURFACE =
  "color-mix(in srgb, var(--vscode-textLink-foreground) 5%, var(--vscode-editorWidget-background))";
const VISUAL_FRAME_DIVIDER =
  "1px solid color-mix(in srgb, var(--vscode-editor-foreground) 28%, var(--vscode-editorWidget-border))";
const VISUAL_FRAME_RAIL = "3px solid var(--vscode-textLink-foreground)";
const VISUAL_FRAME_EDGE = "2px solid var(--vscode-textLink-foreground)";

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "transparent",
    fontSize: "var(--vscode-editor-font-size, 14px)",
    [VISUAL_THEOREM_BORDER_PROPERTY]: VISUAL_THEOREM_BORDER_VALUE,
    "--texleaf-editor-scrollbar-thumb": "color-mix(in srgb, var(--vscode-scrollbarSlider-background) 62%, var(--vscode-editor-foreground) 38%)",
    "--texleaf-editor-scrollbar-track": "color-mix(in srgb, var(--vscode-editorWidget-background) 55%, transparent)",
  },
  ".cm-scroller": {
    overflowX: "auto",
    overflowY: "scroll",
    scrollbarGutter: "auto",
    scrollbarColor: "var(--vscode-scrollbarSlider-background) transparent",
    scrollbarWidth: "auto",
    backgroundColor: "transparent",
    fontFamily: "var(--vscode-editor-font-family, monospace)",
    fontSize: "var(--vscode-editor-font-size, 14px)",
    lineHeight: "var(--vscode-editor-line-height, 1.5)",
  },
  "&.texleaf-visual-mode .cm-scroller": {
    // Keep the document-level horizontal scrollbar available in visual mode.
    // Wide formulas, images, tables, and diagrams additionally own local
    // scrollports, so users can choose either scope without stretching cards.
    overflowX: "auto",
  },
  "&.texleaf-source-mode .cm-scroller": {
    overflowX: "auto",
  },
  ".cm-scroller::-webkit-scrollbar": {
    // The always-present document scrollbar lives in a reserved sibling
    // gutter. Suppress Chromium's focus-dependent vertical overlay scrollbar
    // while retaining the native horizontal scrollbar for source-like rows.
    width: "0",
    height: "12px",
  },
  ".cm-scroller::-webkit-scrollbar-track, .cm-scroller::-webkit-scrollbar-corner": {
    backgroundColor: "var(--texleaf-editor-scrollbar-track)",
  },
  ".cm-scroller::-webkit-scrollbar-thumb": {
    minHeight: "34px",
    backgroundColor: "var(--texleaf-editor-scrollbar-thumb)",
    backgroundClip: "content-box",
    border: "2px solid transparent",
    borderRadius: "7px",
  },
  ".cm-scroller::-webkit-scrollbar-thumb:hover": {
    backgroundColor: "var(--vscode-scrollbarSlider-hoverBackground)",
  },
  ".cm-scroller::-webkit-scrollbar-thumb:active": {
    backgroundColor: "var(--vscode-scrollbarSlider-activeBackground)",
  },
  ".cm-line.texleaf-reverse-sync-flash-line": {
    animation: "texleaf-reverse-sync-flash 1.15s ease-out both",
    boxShadow: "inset 3px 0 var(--vscode-editorInfo-foreground), inset 0 0 0 1px color-mix(in srgb, var(--vscode-editorInfo-foreground) 38%, transparent)",
    borderRadius: "4px",
  },
  ".texleaf-reverse-sync-widget-flash": {
    animation: "texleaf-reverse-sync-flash 1.15s ease-out both",
    boxShadow: "inset 3px 0 var(--vscode-editorInfo-foreground), inset 0 0 0 1px color-mix(in srgb, var(--vscode-editorInfo-foreground) 38%, transparent)",
    borderRadius: "4px",
  },
  ".texleaf-source-indented-block": {
    // Keep this stable declaration in CSS; document edits only update the
    // custom property when the actual source indentation column changes.
    paddingInlineStart: "var(--texleaf-source-indent, 0ch)",
  },
  ".cm-panels": {
    color: "var(--vscode-editorWidget-foreground, var(--vscode-editor-foreground))",
    fontFamily: "var(--vscode-font-family, var(--vscode-editor-font-family, sans-serif))",
    fontSize: "var(--vscode-font-size, 13px)",
  },
  ".cm-panels-top:has(> .texleaf-search-panel)": {
    position: "absolute",
    inset: "0 0 auto 0",
    zIndex: "40",
    height: "0",
    overflow: "visible",
    pointerEvents: "none",
    color: "inherit",
    backgroundColor: "transparent",
    border: "0",
  },
  ".cm-panel.texleaf-search-panel": {
    boxSizing: "border-box",
    display: "grid",
    gap: "6px",
    width: "min(610px, calc(100% - 16px))",
    minWidth: "0",
    margin: "6px 8px 0 auto",
    padding: "6px",
    color: "inherit",
    backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
    border: "1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border))",
    borderRadius: "7px",
    boxShadow: "0 5px 18px color-mix(in srgb, var(--vscode-widget-shadow) 62%, transparent)",
    pointerEvents: "auto",
  },
  ".texleaf-search-row": {
    boxSizing: "border-box",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "4px",
    minWidth: "0",
  },
  ".texleaf-search-row[hidden]": {
    display: "none",
  },
  ".texleaf-search-field": {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    flex: "1 1 190px",
    minWidth: "92px",
    height: "28px",
    color: "var(--vscode-input-foreground, var(--vscode-editor-foreground))",
    backgroundColor: "var(--vscode-input-background, var(--vscode-editor-background))",
    border: "1px solid var(--vscode-input-border, var(--vscode-editorWidget-border))",
    borderRadius: "5px",
  },
  ".texleaf-search-field:focus-within": {
    borderColor: "var(--vscode-focusBorder)",
    boxShadow: "0 0 0 1px var(--vscode-focusBorder)",
  },
  ".texleaf-search-field > input": {
    boxSizing: "border-box",
    flex: "1 1 auto",
    width: "0",
    minWidth: "0",
    height: "26px",
    padding: "3px 7px",
    color: "inherit",
    backgroundColor: "transparent",
    border: "0",
    outline: "0",
    font: "inherit",
    fontFamily: "var(--vscode-editor-font-family, monospace)",
  },
  ".texleaf-search-field > input::placeholder": {
    color: "var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground))",
    opacity: "1",
  },
  ".texleaf-search-status": {
    flex: "0 0 auto",
    minWidth: "52px",
    padding: "0 7px 0 3px",
    color: "var(--vscode-descriptionForeground)",
    textAlign: "right",
    fontSize: "0.92em",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  ".texleaf-search-flags": {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
  },
  ".texleaf-search-panel button": {
    boxSizing: "border-box",
    flex: "0 0 auto",
    minHeight: "28px",
    margin: "0",
    padding: "3px 7px",
    color: "var(--vscode-icon-foreground, var(--vscode-editorWidget-foreground, var(--vscode-editor-foreground)))",
    backgroundColor: "transparent",
    border: "1px solid transparent",
    borderRadius: "4px",
    font: "inherit",
    lineHeight: "1.25",
    cursor: "pointer",
  },
  ".texleaf-search-panel button:hover:not(:disabled)": {
    backgroundColor: "var(--vscode-toolbar-hoverBackground)",
  },
  ".texleaf-search-panel button:focus-visible": {
    outline: "1px solid var(--vscode-focusBorder)",
    outlineOffset: "1px",
  },
  ".texleaf-search-panel button:disabled": {
    opacity: "0.38",
    cursor: "default",
  },
  ".texleaf-search-icon": {
    width: "28px",
    padding: "0 !important",
    fontSize: "15px !important",
  },
  ".texleaf-search-flag": {
    minWidth: "28px",
    padding: "2px 5px !important",
    fontFamily: "var(--vscode-editor-font-family, monospace) !important",
    fontSize: "12px !important",
    fontWeight: "600",
  },
  ".texleaf-search-flag.active, .texleaf-search-flag[aria-pressed=true]": {
    color: "var(--vscode-inputOption-activeForeground, var(--vscode-foreground))",
    backgroundColor: "var(--vscode-inputOption-activeBackground, var(--vscode-toolbar-activeBackground))",
    borderColor: "var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder))",
  },
  ".texleaf-search-text-button": {
    whiteSpace: "nowrap",
  },
  ".texleaf-search-replace-row": {
    paddingLeft: "32px",
  },
  ".texleaf-search-replace-field": {
    maxWidth: "none",
  },
  ".texleaf-search-panel[data-search-state=not-found] .texleaf-search-field, .texleaf-search-panel[data-search-state=invalid] .texleaf-search-field": {
    borderColor: "var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground))",
  },
  ".texleaf-search-panel[data-search-state=not-found] .texleaf-search-status, .texleaf-search-panel[data-search-state=invalid] .texleaf-search-status": {
    color: "var(--vscode-errorForeground)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--vscode-editor-findMatchHighlightBackground)",
    outline: "1px solid var(--vscode-editor-findMatchHighlightBorder, transparent)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--vscode-editor-findMatchBackground)",
    outlineColor: "var(--vscode-editor-findMatchBorder, var(--vscode-focusBorder))",
  },
  ".cm-content": {
    caretColor: "var(--vscode-editorCursor-foreground)",
    backgroundColor: "transparent",
    padding: "8px 0 48px",
    fontFamily: "var(--vscode-editor-font-family, monospace)",
    fontSize: "inherit",
    lineHeight: "inherit",
  },
  ".cm-line": {
    // The decoration supplies only the dynamic indent custom property. Keeping
    // each visual card's original inset in a separate base variable lets this
    // padding coexist with its real frame borders.
    "--texleaf-line-base-padding-inline-start": "8px",
    padding: "0 8px",
    paddingInlineStart:
      "calc(var(--texleaf-line-base-padding-inline-start, 8px) + var(--texleaf-soft-wrap-indent, 0ch))",
  },
  ".cm-line.texleaf-soft-wrap-indent::before": {
    // Pull only the first visual row back by the reserved amount. Its real
    // leading spaces/tabs then place the first glyph at its unchanged source
    // column; wrapped rows start at that same column automatically.
    content: '""',
    marginInlineStart:
      "calc(0px - var(--texleaf-soft-wrap-indent, 0ch))",
    pointerEvents: "none",
  },
  ".tok-comment": {
    color: "var(--texleaf-syntax-comment, var(--vscode-descriptionForeground, var(--vscode-editorLineNumber-foreground)))",
    fontStyle: "italic",
  },
  ".tok-keyword": {
    color: "var(--texleaf-syntax-keyword, var(--vscode-textLink-foreground))",
  },
  ".tok-macroName, .tok-typeName, .tok-className, .tok-namespace": {
    color: "var(--texleaf-syntax-command, var(--vscode-textLink-foreground))",
  },
  ".tok-string, .tok-string2, .tok-url, .tok-literal": {
    color: "var(--texleaf-syntax-string, var(--vscode-debugTokenExpression-string, var(--vscode-testing-iconPassed, var(--vscode-textLink-foreground))))",
  },
  ".tok-atom": {
    color: "var(--texleaf-syntax-atom, var(--texleaf-syntax-string, var(--vscode-editor-foreground)))",
  },
  ".tok-number, .tok-bool, .tok-unit": {
    color: "var(--texleaf-syntax-number, var(--vscode-debugTokenExpression-number, var(--vscode-editorWarning-foreground)))",
  },
  ".tok-variableName, .tok-variableName2, .tok-propertyName, .tok-labelName": {
    color: "var(--texleaf-syntax-variable, var(--vscode-editor-foreground))",
  },
  ".tok-operator": {
    color: "var(--texleaf-syntax-operator, var(--vscode-editor-foreground))",
  },
  ".tok-punctuation": {
    color: "var(--texleaf-syntax-punctuation, var(--vscode-editor-foreground))",
  },
  ".tok-meta": {
    color: "var(--texleaf-syntax-meta, var(--vscode-textPreformat-foreground, var(--vscode-descriptionForeground)))",
  },
  ".tok-link": {
    color: "var(--texleaf-syntax-link, var(--vscode-textLink-foreground))",
    textDecoration: "underline",
  },
  ".tok-heading, .tok-strong": {
    color: "var(--texleaf-syntax-heading, var(--vscode-symbolIcon-functionForeground, var(--vscode-textLink-foreground)))",
    fontWeight: "700",
  },
  ".tok-invalid": {
    color: "var(--texleaf-syntax-invalid, var(--vscode-editorError-foreground))",
  },
  ".texleaf-native-syntax-token": {
    // Authoritative TextMate colors and font styles are applied as sanitized
    // inline declarations by nativeSyntaxField. Source-mode fallback spans can
    // be nested inside this mark, so every child inherits the more precise
    // host-resolved token instead of repainting it with a coarse tok-* role.
    opacity: "1",
    color: "var(--texleaf-native-foreground, inherit) !important",
    fontStyle: "var(--texleaf-native-font-style, normal) !important",
    fontWeight: "var(--texleaf-native-font-weight, 400) !important",
    textDecorationLine: "var(--texleaf-native-decoration, none) !important",
  },
  ".texleaf-native-syntax-token [class*='tok-']": {
    color: "var(--texleaf-native-foreground, inherit) !important",
    fontStyle: "var(--texleaf-native-font-style, normal) !important",
    fontWeight: "var(--texleaf-native-font-weight, 400) !important",
    textDecorationLine: "var(--texleaf-native-decoration, none) !important",
  },
  // TextMate and bracket marks overlap on exactly one character. Depending on
  // CodeMirror's mark ordering either can become the outer span. Paint the
  // bracket mark, an inner native mark, and the innermost tok-* fallback
  // directly. Avoid an intermediate camel-cased custom property: style-mod
  // normalizes property names, while CSS custom-property references are case
  // sensitive and would silently fall back to editor.foreground.
  ".texleaf-bracket-depth-0, .texleaf-bracket-depth-0 .texleaf-native-syntax-token, .texleaf-bracket-depth-0 [class*='tok-']": {
    color:
      "var(--vscode-editorBracketHighlight-foreground1, var(--vscode-editor-foreground)) !important",
  },
  ".texleaf-bracket-depth-1, .texleaf-bracket-depth-1 .texleaf-native-syntax-token, .texleaf-bracket-depth-1 [class*='tok-']": {
    color:
      "var(--vscode-editorBracketHighlight-foreground2, var(--vscode-editor-foreground)) !important",
  },
  ".texleaf-bracket-depth-2, .texleaf-bracket-depth-2 .texleaf-native-syntax-token, .texleaf-bracket-depth-2 [class*='tok-']": {
    color:
      "var(--vscode-editorBracketHighlight-foreground3, var(--vscode-editor-foreground)) !important",
  },
  ".texleaf-bracket-depth-3, .texleaf-bracket-depth-3 .texleaf-native-syntax-token, .texleaf-bracket-depth-3 [class*='tok-']": {
    color:
      "var(--vscode-editorBracketHighlight-foreground4, var(--vscode-editor-foreground)) !important",
  },
  ".texleaf-bracket-depth-4, .texleaf-bracket-depth-4 .texleaf-native-syntax-token, .texleaf-bracket-depth-4 [class*='tok-']": {
    color:
      "var(--vscode-editorBracketHighlight-foreground5, var(--vscode-editor-foreground)) !important",
  },
  ".texleaf-bracket-depth-5, .texleaf-bracket-depth-5 .texleaf-native-syntax-token, .texleaf-bracket-depth-5 [class*='tok-']": {
    color:
      "var(--vscode-editorBracketHighlight-foreground6, var(--vscode-editor-foreground)) !important",
  },
  "&.cm-focused .cm-content::highlight(texleaf-active-bracket-pair), &.cm-focused .cm-content *::highlight(texleaf-active-bracket-pair)": {
    backgroundColor:
      "color-mix(in srgb, transparent 65%, currentColor 35%)",
    textDecorationLine: "none",
    textShadow: "none",
  },
  ".tok-emphasis": {
    fontStyle: "italic",
  },
  ".texleaf-formula-references": { display: "flex", gap: "0.5em", fontSize: "0.8em", justifyContent: "flex-end", marginTop: "0.25em" },
  ".texleaf-text-style": {
    cursor: "text",
  },
  ".texleaf-text-style-bold": {
    fontWeight: "700",
  },
  ".texleaf-text-style-italic": {
    fontStyle: "italic",
  },
  ".texleaf-text-style-underline": {
    textDecorationLine: "underline",
  },
  ".texleaf-text-style-strike": {
    textDecorationLine: "line-through",
  },
  ".texleaf-text-style-underline.texleaf-text-style-strike": {
    textDecorationLine: "underline line-through",
  },
  ".texleaf-text-style-smallcaps": {
    fontVariant: "small-caps",
  },
  ".texleaf-accent-glyph": {
    font: "inherit",
    color: "inherit",
    cursor: "text",
  },
  ".tok-invalid, .tok-deleted": {
    color: "var(--texleaf-syntax-invalid, var(--vscode-editorError-foreground))",
    textDecoration: "underline wavy",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--vscode-editorCursor-foreground)",
  },
  "&.cm-focused .cm-cursor-primary": {
    borderLeftWidth: "2px",
    marginLeft: "-1px",
    zIndex: "30",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--vscode-editor-selectionBackground) !important",
  },
  ".cm-gutters": {
    color: "var(--vscode-editorLineNumber-foreground)",
    // The document canvas may be transparent so a user-configured VS Code
    // background remains visible. The sticky gutter itself must stay opaque,
    // otherwise horizontally scrolled LaTeX is visible underneath line
    // numbers and appears to overlap them.
    backgroundColor: "var(--vscode-editor-background)",
    borderRight: "1px solid var(--vscode-editorWidget-border)",
    boxShadow: "2px 0 3px color-mix(in srgb, var(--vscode-editor-background) 78%, transparent)",
    zIndex: "6",
  },
  ".cm-activeLineGutter": {
    color: "var(--vscode-editorLineNumber-activeForeground)",
    backgroundColor: "var(--vscode-editor-lineHighlightBackground)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--vscode-editor-lineHighlightBackground)",
  },
  ".cm-foldPlaceholder": {
    color: "var(--vscode-descriptionForeground)",
    backgroundColor: "var(--vscode-editor-foldBackground)",
    borderColor: "var(--vscode-editorWidget-border)",
  },
  ".cm-snippetField": {
    backgroundColor: "var(--vscode-editor-snippetTabstopHighlightBackground, var(--vscode-editor-wordHighlightBackground))",
    outline: "1px solid var(--vscode-editor-snippetTabstopHighlightBorder, transparent)",
  },
  ".cm-snippetFieldPosition": {
    borderLeft: "1px solid var(--vscode-editor-snippetFinalTabstopHighlightBorder, var(--vscode-focusBorder))",
  },
  ".cm-lineNumbers .cm-gutterElement.texleaf-source-range-gutter": {
    display: "flex",
    alignItems: "stretch",
    justifyContent: "flex-end",
    boxSizing: "border-box",
    paddingTop: "2px",
    paddingInlineEnd: "3px",
    paddingBottom: "2px",
  },
  ".texleaf-source-range-number": {
    display: "grid",
    // Keep one zero-content spacer followed by one intrinsic digit column. The
    // marker shrink-wraps the widest endpoint and the gutter flex container
    // keeps its right edge on the native line-number axis. Thus the frame hugs
    // the digits instead of spanning the empty gutter, including 999 -> 1000.
    gridTemplateColumns: "minmax(0, 1fr) max-content",
    gridTemplateRows: "max-content minmax(8px, 1fr) max-content",
    justifyItems: "end",
    alignItems: "stretch",
    alignSelf: "stretch",
    width: "max-content",
    maxWidth: "100%",
    height: "100%",
    minHeight: "0",
    color: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "normal",
    lineHeight: "1",
    userSelect: "none",
    // Paint the visual-range frame outside the marker's layout box. Unlike a
    // border or padding, an outline contributes no intrinsic width, so the
    // digit column keeps precisely the same right edge as native CodeMirror
    // line numbers (including when it grows from three to four digits).
    outline: "1px solid color-mix(in srgb, currentColor 58%, transparent)",
    // Compact markers use the native one-line-height metrics, whose painted
    // glyph bounds extend slightly beyond their CSS line boxes. Two pixels of
    // paint-only offset keep the square frame outside those glyphs without
    // moving either endpoint.
    outlineOffset: "2px",
    borderRadius: "0",
  },
  ".texleaf-source-range-number-compact": {
    position: "relative",
    display: "grid",
    gridTemplateRows: "auto 4px auto",
    alignItems: "center",
    alignSelf: "center",
    justifyItems: "end",
    width: "max-content",
    maxWidth: "100%",
    height: "auto",
    columnGap: "0",
    rowGap: "0",
    fontSize: "inherit",
    letterSpacing: "normal",
    lineHeight: "1",
    whiteSpace: "nowrap",
  },
  ".texleaf-source-range-start": {
    gridColumn: "2",
    gridRow: "1",
    justifySelf: "end",
  },
  ".texleaf-source-range-end": {
    gridColumn: "2",
    gridRow: "3",
    justifySelf: "end",
  },
  ".texleaf-source-range-number-compact .texleaf-source-range-start": {
    gridColumn: "2",
    gridRow: "1",
  },
  ".texleaf-source-range-number-compact .texleaf-source-range-end": {
    gridColumn: "2",
    gridRow: "3",
  },
  ".texleaf-source-range-number-compact .texleaf-source-range-rule": {
    display: "block",
    position: "relative",
    gridColumn: "2",
    gridRow: "2",
    justifySelf: "center",
    width: "1px",
    minHeight: "4px",
  },
  ".texleaf-source-range-number-capped": {
    alignSelf: "center",
    height: "4.5em",
    maxHeight: "100%",
  },
  ".texleaf-source-range-number-single": {
    display: "block",
  },
  ".texleaf-line-number-anchor-target": {
    width: "100%",
  },
  ".texleaf-source-range-number.texleaf-line-number-anchor-target": {
    // A semantic single-line marker still moves only its inner value vertically;
    // it does not need the range frame to stretch across the whole gutter.
    width: "max-content",
    maxWidth: "100%",
  },
  ".texleaf-line-number-anchor-value": {
    display: "inline-block",
  },
  ".texleaf-source-range-rule": {
    position: "relative",
    display: "block",
    justifySelf: "stretch",
    gridColumn: "2",
    gridRow: "2",
    width: "100%",
    minHeight: "8px",
  },
  ".texleaf-source-range-rule::before": {
    content: '""',
    position: "absolute",
    insetBlock: "2px",
    insetInlineEnd: "50%",
    borderInlineEnd: "1px solid currentColor",
    transform: "translateX(50%)",
    opacity: "0.62",
  },
  "@media (forced-colors: active)": {
    ".texleaf-source-range-number": {
      outlineColor: "CanvasText",
    },
    ".texleaf-source-range-rule::before": {
      borderInlineEndColor: "CanvasText",
      opacity: "1",
    },
  },
  ".texleaf-measured-block-shell": {
    boxSizing: "border-box",
    display: "block",
    width: "100%",
    maxWidth: "100%",
    minWidth: "0",
    margin: "0",
  },
  ".texleaf-preamble-shell": {
    paddingTop: "0.5em",
  },
  ".texleaf-title-shell": {
    paddingTop: "1.5em",
    paddingBottom: "1.9em",
  },
  ".texleaf-theorem-begin-shell": {
    paddingInlineStart: "0",
    paddingTop: "1em",
  },
  ".texleaf-frame-begin-shell": {
    paddingTop: "1em",
    paddingInlineStart: "0",
  },
  ".texleaf-abstract-begin-shell": {
    paddingInlineStart: "0",
    paddingTop: "1.15em",
  },
  ".texleaf-theorem-end-shell": {
    paddingInlineStart: "0",
    paddingBottom: "1em",
  },
  ".texleaf-frame-end-shell": {
    paddingBottom: "1em",
    paddingInlineStart: "0",
  },
  ".texleaf-abstract-end-shell": {
    paddingInlineStart: "0",
    paddingBottom: "1.15em",
  },
  ".texleaf-keywords-shell": {
    paddingTop: "0.35em",
    paddingBottom: "0.35em",
  },
  ".texleaf-keywords-shell-embedded": {
    boxSizing: "border-box",
    width: "calc(100% - 32px)",
    margin: "0 16px",
    padding: "0",
    borderLeft: "1px solid var(--vscode-editorWidget-border)",
    borderRight: "1px solid var(--vscode-editorWidget-border)",
  },
  ".texleaf-bibliography-shell, .texleaf-table-of-contents-shell": {
    paddingTop: "1.15em",
    paddingBottom: "1.15em",
  },
  ".texleaf-table-shell, .texleaf-tikzcd-shell, .texleaf-tikzpicture-shell, .texleaf-image-shell": {
    paddingTop: "0.9em",
    paddingBottom: "0.9em",
    overflow: "hidden",
    contain: "inline-size",
  },
  ".texleaf-document-end-shell": {
    paddingTop: "1.25em",
    paddingBottom: "2.25em",
  },
  // CodeMirror keeps one empty line carrier for the separator immediately
  // after a block document-end widget. It belongs to the footer even when a
  // genuine blank/tail line follows. Only an exact terminal separator creates
  // a second, synthetic EOF carrier; the terminal class collapses that one as
  // well while leaving every authored following line measurable and editable.
  ".texleaf-document-end-shell-line-terminated + .cm-line, .texleaf-document-end-shell-terminal + .cm-line + .cm-line": {
    boxSizing: "border-box",
    height: "0 !important",
    minHeight: "0 !important",
    lineHeight: "0 !important",
    paddingTop: "0 !important",
    paddingBottom: "0 !important",
    borderTopWidth: "0 !important",
    borderBottomWidth: "0 !important",
    overflow: "hidden !important",
    pointerEvents: "none",
  },
  ".texleaf-formula-shell": {
    minWidth: "0",
    paddingTop: "0.25em",
    paddingBottom: "0.25em",
    overflow: "hidden",
    contain: "inline-size",
  },
  ".texleaf-theorem-formula-shell": {
    boxSizing: "border-box",
    width: "calc(100% - 24px)",
    margin: "0 12px",
    borderLeft: VISUAL_THEOREM_FRAME_BORDER,
    borderRight: VISUAL_THEOREM_FRAME_BORDER,
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 58%, transparent)",
  },
  ".texleaf-preamble-header": {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "calc(100% - 20px)",
    margin: "0 10px",
    padding: "8px 11px",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "var(--vscode-editorWidget-background)",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "7px",
    fontFamily: "var(--vscode-font-family)",
    fontSize: "12px",
    cursor: "pointer",
  },
  ".texleaf-preamble-header:hover, .texleaf-preamble-header:focus-visible": {
    borderColor: "var(--vscode-focusBorder)",
    outline: "none",
  },
  ".texleaf-preamble-header-main": {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    fontWeight: "600",
  },
  ".texleaf-preamble-help": {
    display: "inline-grid",
    placeItems: "center",
    width: "16px",
    height: "16px",
    color: "var(--vscode-badge-foreground)",
    backgroundColor: "var(--vscode-badge-background)",
    borderRadius: "50%",
    fontSize: "10px",
  },
  ".texleaf-preamble-chevron": {
    color: "var(--vscode-descriptionForeground)",
    fontSize: "14px",
  },
  ".cm-line.texleaf-preamble-line": {
    "--texleaf-line-base-padding-inline-start": "12px",
    margin: "0 10px",
    paddingInlineEnd: "12px",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background))",
    borderLeft: "1px solid var(--vscode-editorWidget-border)",
    borderRight: "1px solid var(--vscode-editorWidget-border)",
    fontFamily: "var(--vscode-editor-font-family)",
  },
  ".cm-line.texleaf-preamble-first-line": {
    paddingTop: "8px",
  },
  ".cm-line.texleaf-preamble-last-line": {
    paddingBottom: "8px",
    borderBottom: "1px solid var(--vscode-editorWidget-border)",
    borderBottomLeftRadius: "7px",
    borderBottomRightRadius: "7px",
  },
  ".texleaf-title-card": {
    position: "relative",
    boxSizing: "border-box",
    width: "calc(100% - 32px)",
    margin: "0 16px",
    padding: "18px 24px",
    color: "var(--vscode-editor-foreground)",
    textAlign: "center",
    borderBottom: "1px solid var(--vscode-editorWidget-border)",
    cursor: "text",
  },
  ".texleaf-front-matter-section": {
    textAlign: "start",
    marginTop: "1em",
    lineHeight: "1.65",
    whiteSpace: "pre-wrap",
  },
  ".texleaf-front-matter-label": {
    fontWeight: "600",
    marginInlineEnd: "0.65em",
  },
  ".texleaf-front-matter-abstract > .texleaf-front-matter-label": {
    display: "block",
    marginBottom: "0.35em",
  },
  ".texleaf-title-card [role=button]:focus-visible, .texleaf-front-matter-section [role=button]:focus-visible": {
    outline: "1px solid var(--vscode-focusBorder)",
    outlineOffset: "3px",
  },
  ".texleaf-title-definition": {
    color: "var(--vscode-textLink-foreground)",
    fontSize: "0.75em",
    cursor: "pointer",
  },
  ".texleaf-frame-begin": {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "0.38em 0.65em",
    width: "auto",
    maxWidth: "calc(100% - 32px)",
    minWidth: "0",
    margin: "0 16px",
    padding: "0.68em 1em 0.62em",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: VISUAL_FRAME_HEADER,
    border: "0",
    borderTop: VISUAL_FRAME_EDGE,
    borderBottom: VISUAL_FRAME_DIVIDER,
    borderLeft: VISUAL_FRAME_RAIL,
    borderRight: VISUAL_FRAME_RAIL,
    borderTopLeftRadius: "9px",
    borderTopRightRadius: "9px",
    cursor: "text",
  },
  ".texleaf-frame-label": {
    flex: "0 0 auto",
    color: "var(--vscode-textLink-foreground)",
    padding: "0.06em 0.48em",
    backgroundColor: "color-mix(in srgb, var(--vscode-textLink-foreground) 7%, transparent)",
    border: "1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 24%, transparent)",
    borderRadius: "999px",
    fontFamily: "var(--vscode-font-family)",
    fontSize: "0.7em",
    fontWeight: "700",
    letterSpacing: "0.07em",
    textTransform: "uppercase",
  },
  ".texleaf-frame-title": {
    minWidth: "0",
    fontSize: "1.14em",
    fontWeight: "700",
  },
  ".texleaf-frame-begin-untitled": {
    minHeight: "2.5em",
  },
  ".texleaf-frame-begin > .texleaf-environment-edit-chip": {
    marginInlineStart: "auto",
    opacity: "0.52",
  },
  ".texleaf-frame-begin:hover > .texleaf-environment-edit-chip, .texleaf-frame-begin > .texleaf-environment-edit-chip:focus-visible": {
    opacity: "1",
  },
  ".texleaf-frame-subtitle": {
    flexBasis: "100%",
    paddingInlineStart: "0.15em",
    color: "var(--vscode-descriptionForeground)",
    fontSize: "0.86em",
  },
  ".cm-line.texleaf-frame-line": {
    "--texleaf-line-base-padding-inline-start": "18px",
    boxSizing: "border-box",
    width: "auto",
    maxWidth: "calc(100% - 32px)",
    minWidth: "0",
    minHeight: "var(--vscode-editor-line-height, 1.5em)",
    margin: "0 16px",
    paddingInlineEnd: "18px",
    backgroundColor: VISUAL_FRAME_SURFACE,
    borderLeft: VISUAL_FRAME_RAIL,
    borderRight: VISUAL_FRAME_RAIL,
    lineHeight: "1.55",
  },
  ".texleaf-frame-end": {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    width: "auto",
    maxWidth: "calc(100% - 32px)",
    minWidth: "0",
    minHeight: "0.68em",
    margin: "0 16px",
    padding: "0.08em 0.8em 0.32em",
    backgroundColor: VISUAL_FRAME_SURFACE,
    borderRight: VISUAL_FRAME_RAIL,
    borderBottom: VISUAL_FRAME_EDGE,
    borderLeft: VISUAL_FRAME_RAIL,
    borderBottomLeftRadius: "9px",
    borderBottomRightRadius: "9px",
    boxShadow: "0 9px 20px color-mix(in srgb, var(--vscode-widget-shadow) 14%, transparent)",
    cursor: "text",
  },
  ".texleaf-frame-end > .texleaf-environment-edit-chip": {
    minHeight: "16px",
    borderColor: "transparent",
    opacity: "0.36",
  },
  ".texleaf-frame-end:hover > .texleaf-environment-edit-chip, .texleaf-frame-end > .texleaf-environment-edit-chip:focus-visible": {
    opacity: "1",
  },
  ".texleaf-abstract-begin": {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75em",
    width: "calc(100% - 32px)",
    margin: "0 16px",
    padding: "0.7em 1em 0.5em",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 72%, transparent)",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderBottom: "0",
    borderTopLeftRadius: "8px",
    borderTopRightRadius: "8px",
    cursor: "text",
  },
  ".texleaf-abstract-label": {
    flex: "1 1 auto",
    fontFamily: "inherit",
    fontSize: "1.08em",
    fontWeight: "700",
    textAlign: "center",
  },
  ".cm-line.texleaf-abstract-line, .texleaf-abstract-begin-shell + .cm-line:not(.texleaf-abstract-line), .texleaf-front-matter-abstract-body": {
    "--texleaf-line-base-padding-inline-start": "1em",
    boxSizing: "border-box",
    minHeight: "var(--vscode-editor-line-height, 1.5em)",
    margin: "0 16px",
    paddingInlineEnd: "1em",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 52%, transparent)",
    borderLeft: "1px solid var(--vscode-editorWidget-border)",
    borderRight: "1px solid var(--vscode-editorWidget-border)",
    lineHeight: "1.55",
  },
  ".texleaf-front-matter-abstract-body": {
    display: "block",
    width: "calc(100% - 32px)",
    paddingInlineStart: "1em",
    paddingBottom: "0.65em",
    borderBottom: "1px solid var(--vscode-editorWidget-border)",
    borderBottomLeftRadius: "8px",
    borderBottomRightRadius: "8px",
  },
  ".texleaf-title-source": {
    display: "block",
    width: "fit-content",
    maxWidth: "100%",
    margin: "0 0 12px auto",
    whiteSpace: "normal",
  },
  ".cm-line.texleaf-abstract-layout-line": {
    minHeight: "0",
    height: "0",
    paddingTop: "0",
    paddingBottom: "0",
    overflow: "hidden",
    lineHeight: "0",
  },
  ".cm-line.texleaf-abstract-layout-small": {
    minHeight: "0.18em",
    height: "0.18em",
    lineHeight: "0.18em",
  },
  ".cm-line.texleaf-abstract-layout-medium": {
    minHeight: "0.3em",
    height: "0.3em",
    lineHeight: "0.3em",
  },
  ".cm-line.texleaf-abstract-layout-large": {
    minHeight: "0.5em",
    height: "0.5em",
    lineHeight: "0.5em",
  },
  ".cm-line.texleaf-abstract-adjacent-blank": {
    minHeight: "0",
    height: "0",
    paddingTop: "0",
    paddingBottom: "0",
    overflow: "hidden",
    lineHeight: "0",
  },
  ".cm-line.texleaf-abstract-source-begin": {
    borderTop: "1px solid var(--vscode-editorWidget-border)",
    borderTopLeftRadius: "8px",
    borderTopRightRadius: "8px",
  },
  ".cm-line.texleaf-abstract-source-end": {
    borderBottom: "1px solid var(--vscode-editorWidget-border)",
    borderBottomLeftRadius: "8px",
    borderBottomRightRadius: "8px",
  },
  ".cm-line.texleaf-abstract-source-widget-end": {
    minHeight: "0",
    height: "0",
    paddingTop: "0",
    paddingBottom: "0",
    overflow: "hidden",
    lineHeight: "0",
  },
  ".texleaf-abstract-end": {
    boxSizing: "border-box",
    display: "block",
    width: "calc(100% - 32px)",
    minHeight: "0.65em",
    margin: "0 16px",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderTop: "0",
    borderBottomLeftRadius: "8px",
    borderBottomRightRadius: "8px",
    cursor: "text",
  },
  ".texleaf-keywords-card": {
    boxSizing: "border-box",
    alignItems: "baseline",
    gap: "0.55em",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 76%, transparent)",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "7px",
    cursor: "text",
  },
  ".texleaf-keywords-card-block": {
    display: "flex",
    flexWrap: "wrap",
    width: "calc(100% - 32px)",
    margin: "0 16px",
    padding: "0.55em 0.8em",
  },
  ".texleaf-keywords-card-inline": {
    display: "inline-flex",
    margin: "0 0.25em",
    padding: "0.12em 0.45em",
  },
  ".texleaf-keywords-card-embedded": {
    flexWrap: "nowrap",
    width: "100%",
    margin: "0",
    padding: "0.22em 1em",
    backgroundColor: "transparent",
    border: "0",
    borderRadius: "0",
  },
  ".texleaf-keywords-card-embedded .texleaf-environment-edit-chip": {
    flex: "0 0 auto",
    marginInlineStart: "auto",
    paddingInline: "2px",
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  ".texleaf-keywords-label": {
    flex: "0 0 auto",
    fontWeight: "700",
  },
  ".texleaf-keywords-label::after": {
    content: "':'",
  },
  ".texleaf-keywords-value": {
    flex: "1 1 16em",
    minWidth: "0",
  },
  ".texleaf-keywords-card-embedded .texleaf-keywords-value": {
    flexBasis: "auto",
  },
  ".texleaf-keywords-classification .texleaf-keywords-label": {
    color: "var(--vscode-descriptionForeground)",
  },
  ".texleaf-document-title": {
    margin: "0 0 16px",
    fontFamily: "inherit",
    fontSize: "clamp(1.65em, 4vw, 2.35em)",
    lineHeight: "1.2",
    fontWeight: "700",
    overflowWrap: "anywhere",
  },
  ".texleaf-document-authors": {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "6px 18px",
    marginTop: "8px",
    fontSize: "1.08em",
  },
  ".texleaf-document-affiliations, .texleaf-document-emails": {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
    marginTop: "8px",
    color: "var(--vscode-descriptionForeground)",
    fontSize: "0.92em",
    lineHeight: "1.4",
  },
  ".texleaf-document-emails": {
    marginTop: "4px",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "0.86em",
  },
  ".texleaf-document-author, .texleaf-document-affiliation, .texleaf-document-email, .texleaf-document-date": {
    padding: "2px 5px",
    borderRadius: "4px",
    cursor: "text",
  },
  ".texleaf-document-author:hover, .texleaf-document-affiliation:hover, .texleaf-document-email:hover, .texleaf-document-date:hover, .texleaf-document-title:hover": {
    backgroundColor: "var(--vscode-editor-wordHighlightBackground)",
  },
  ".texleaf-document-date": {
    display: "inline-block",
    marginTop: "12px",
    color: "var(--vscode-descriptionForeground)",
  },
  ".texleaf-heading": {
    color: "var(--vscode-editor-foreground)",
    fontFamily: "inherit",
    fontWeight: "700",
    lineHeight: "1.25",
  },
  ".texleaf-heading-line": {
    // Keep visual headings clearly separated from both the preceding material
    // and the prose they introduce. This applies to section through
    // subparagraph, including headings that immediately follow display math.
    // This is presentation-only spacing; it does not mirror or mutate source
    // indentation/blank lines.
    paddingTop: "0.72em",
    paddingBottom: "0.72em",
  },
  ".texleaf-heading-line-level-0, .texleaf-heading-line-level-1": {
    paddingTop: "1.05em",
    paddingBottom: "0.95em",
  },
  ".texleaf-heading-line-level-2": {
    paddingTop: "0.9em",
    paddingBottom: "0.84em",
  },
  ".texleaf-heading-line-level-3": {
    paddingTop: "0.82em",
    paddingBottom: "0.76em",
  },
  ".texleaf-heading-line-level-4": {
    paddingTop: "0.76em",
    paddingBottom: "0.72em",
  },
  ".texleaf-heading-line-level-5, .texleaf-heading-line-level-6": {
    paddingTop: "0.68em",
    paddingBottom: "0.68em",
  },
  ".texleaf-heading-number": {
    display: "inline-block",
    marginInlineEnd: "0.38em",
    color: "var(--vscode-descriptionForeground)",
    fontVariantNumeric: "tabular-nums",
  },
  ".texleaf-heading-level-0, .texleaf-heading-level-1": {
    fontSize: "1.9em",
  },
  ".texleaf-heading-generated": {
    background: "transparent", border: "none", padding: "0", cursor: "text", fontFamily: "inherit",
  },
  ".texleaf-heading-level-2": {
    fontSize: "1.55em",
  },
  ".texleaf-heading-level-3": {
    fontSize: "1.3em",
  },
  ".texleaf-heading-level-4": {
    fontSize: "1.15em",
  },
  ".texleaf-heading-level-5, .texleaf-heading-level-6": {
    fontSize: "1.05em",
  },
  ".texleaf-heading-edit-chip": {
    marginInlineStart: "0.65em",
    verticalAlign: "middle",
    opacity: "0.52",
  },
  ".cm-line:hover .texleaf-heading-edit-chip, .texleaf-heading-edit-chip:focus-visible": {
    opacity: "1",
  },
  ".texleaf-theorem-begin": {
    boxSizing: "border-box",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 58%, transparent)",
    borderTop: VISUAL_THEOREM_FRAME_BORDER,
    borderLeft: VISUAL_THEOREM_FRAME_BORDER,
    borderRight: VISUAL_THEOREM_FRAME_BORDER,
    borderTopLeftRadius: VISUAL_THEOREM_FRAME_RADIUS,
    borderTopRightRadius: VISUAL_THEOREM_FRAME_RADIUS,
    fontFamily: "inherit",
    cursor: "text",
  },
  ".texleaf-theorem-begin-block": {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: "0.55em",
    rowGap: "0.25em",
    width: "calc(100% - 24px)",
    margin: "0 12px",
    padding: "0.55em 0.8em 0.4em",
    lineHeight: "inherit",
  },
  ".texleaf-theorem-begin-inline": {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "4px",
    margin: "0 0.3em",
    padding: "2px 6px",
    border: "0",
    borderRadius: "0",
    backgroundColor: "transparent",
  },
  ".texleaf-theorem-label": {
    flex: "0 0 auto",
    fontWeight: "700",
  },
  ".texleaf-theorem-optional-title": {
    marginLeft: "0",
    fontWeight: "400",
  },
  ".texleaf-theorem-begin .texleaf-label-chip": {
    margin: "0",
  },
  ".texleaf-label-chip, .texleaf-reference-chip": {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    maxWidth: "min(42em, 70vw)",
    margin: "0 0.3em",
    padding: "1px 5px",
    overflow: "hidden",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "4px",
    fontFamily: "inherit",
    fontSize: "0.78em",
    fontStyle: "normal",
    fontWeight: "400",
    lineHeight: "1.4",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    verticalAlign: "baseline",
    cursor: "text",
  },
  ".texleaf-label-chip": {
    color: "var(--vscode-descriptionForeground)",
    backgroundColor: "var(--vscode-editorWidget-background)",
  },
  ".texleaf-label-chip::before": {
    content: "'⌁'",
    marginRight: "4px",
    color: "var(--vscode-symbolIcon-keyForeground, var(--vscode-textLink-foreground))",
  },
  ".texleaf-reference-chip": {
    color: "var(--vscode-textLink-foreground)",
    backgroundColor: "var(--vscode-textBlockQuote-background)",
    borderColor: "var(--vscode-textBlockQuote-border)",
  },
  ".texleaf-reference-chip::after": {
    content: "'↗'",
    marginLeft: "4px",
  },
  ".texleaf-label-chip:hover, .texleaf-label-chip:focus-visible, .texleaf-reference-chip:hover, .texleaf-reference-chip:focus-visible": {
    borderColor: "var(--vscode-focusBorder)",
    outline: "none",
  },
  ".texleaf-reference-chip-target, .texleaf-citation-chip-target": {
    display: "inline-block",
    minWidth: "0",
    padding: "0 1px",
    color: "inherit",
    borderRadius: "2px",
    outline: "none",
    cursor: "pointer",
  },
  ".texleaf-reference-chip-target:hover, .texleaf-reference-chip-target:focus-visible, .texleaf-citation-chip-target:hover, .texleaf-citation-chip-target:focus-visible": {
    color: "var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground))",
    backgroundColor: "var(--vscode-list-hoverBackground)",
    boxShadow: "0 0 0 1px var(--vscode-focusBorder)",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  ".texleaf-label-block": {
    display: "flex",
    width: "calc(100% - 24px)",
    margin: "0 12px",
  },
  ".cm-line.texleaf-theorem-line": {
    "--texleaf-line-base-padding-inline-start": "12px",
    boxSizing: "border-box",
    position: "relative",
    minHeight: "var(--vscode-editor-line-height, 1.5em)",
    margin: "0 12px",
    paddingInlineEnd: "12px",
    borderLeft: VISUAL_THEOREM_FRAME_BORDER,
    borderRight: VISUAL_THEOREM_FRAME_BORDER,
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 58%, transparent)",
    lineHeight: "inherit",
    overflowWrap: "anywhere",
  },
  ".cm-line.texleaf-theorem-plain": {
    fontStyle: "italic",
  },
  ".cm-line.texleaf-theorem-inline-start": {
    borderTop: VISUAL_THEOREM_FRAME_BORDER,
    borderTopLeftRadius: VISUAL_THEOREM_FRAME_RADIUS,
    borderTopRightRadius: VISUAL_THEOREM_FRAME_RADIUS,
    paddingTop: "0.4em",
  },
  ".cm-line.texleaf-theorem-inline-end": {
    borderBottom: VISUAL_THEOREM_FRAME_BORDER,
    borderBottomLeftRadius: VISUAL_THEOREM_FRAME_RADIUS,
    borderBottomRightRadius: VISUAL_THEOREM_FRAME_RADIUS,
    paddingBottom: "0.4em",
  },
  ".texleaf-theorem-formula-shell:not(.texleaf-theorem-proof) + .cm-line:not(.texleaf-theorem-line), .texleaf-list-boundary.texleaf-theorem-list-boundary:not(.texleaf-theorem-proof) + .cm-line:not(.texleaf-theorem-line)": {
    "--texleaf-line-base-padding-inline-start": "12px",
    boxSizing: "border-box",
    minHeight: "var(--vscode-editor-line-height, 1.5em)",
    margin: "0 12px",
    paddingInlineEnd: "12px",
    borderLeft: VISUAL_THEOREM_FRAME_BORDER,
    borderRight: VISUAL_THEOREM_FRAME_BORDER,
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 58%, transparent)",
    lineHeight: "inherit",
    overflowWrap: "anywhere",
  },
  ".texleaf-theorem-formula-shell.texleaf-theorem-plain + .cm-line:not(.texleaf-theorem-line), .texleaf-list-boundary.texleaf-theorem-list-boundary.texleaf-theorem-plain + .cm-line:not(.texleaf-theorem-line)": {
    fontStyle: "italic",
  },
  ".cm-line.texleaf-theorem-proof": {
    fontStyle: "normal",
  },
  ".cm-line.texleaf-theorem-source-boundary": {
    fontStyle: "normal",
  },
  ".cm-line.texleaf-theorem-source-begin": {
    borderTop: VISUAL_THEOREM_FRAME_BORDER,
    borderTopLeftRadius: VISUAL_THEOREM_FRAME_RADIUS,
    borderTopRightRadius: VISUAL_THEOREM_FRAME_RADIUS,
  },
  ".cm-line.texleaf-theorem-source-end": {
    borderBottom: VISUAL_THEOREM_FRAME_BORDER,
    borderBottomLeftRadius: VISUAL_THEOREM_FRAME_RADIUS,
    borderBottomRightRadius: VISUAL_THEOREM_FRAME_RADIUS,
  },
  ".cm-line.texleaf-theorem-source-widget-end": {
    minHeight: "0",
    height: "0",
    paddingTop: "0",
    paddingBottom: "0",
    overflow: "hidden",
    lineHeight: "0",
  },
  ".texleaf-theorem-end": {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "0.45em",
    width: "calc(100% - 24px)",
    minHeight: "0.55em",
    margin: "0 12px",
    padding: "0 0.65em 0.4em",
    borderLeft: VISUAL_THEOREM_FRAME_BORDER,
    borderRight: VISUAL_THEOREM_FRAME_BORDER,
    borderBottom: VISUAL_THEOREM_FRAME_BORDER,
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 58%, transparent)",
    borderBottomLeftRadius: VISUAL_THEOREM_FRAME_RADIUS,
    borderBottomRightRadius: VISUAL_THEOREM_FRAME_RADIUS,
    cursor: "text",
  },
  ".texleaf-theorem-end-inline": {
    display: "inline-flex",
    width: "auto",
    minHeight: "0",
    margin: "0 0.3em",
    padding: "2px 6px",
    border: "0",
    borderRadius: "0",
    backgroundColor: "transparent",
    lineHeight: "inherit",
    verticalAlign: "baseline",
  },
  ".texleaf-proof-qed": {
    fontSize: "0.9em",
  },
  ".texleaf-theorem-begin.texleaf-theorem-proof": {
    border: "0",
    borderRadius: "0",
    backgroundColor: "transparent",
  },
  ".cm-line.texleaf-theorem-line.texleaf-theorem-proof, .cm-line.texleaf-theorem-proof.texleaf-theorem-source-boundary": {
    border: "0",
    backgroundColor: "transparent",
  },
  ".texleaf-theorem-formula-shell.texleaf-theorem-proof": {
    border: "0",
    backgroundColor: "transparent",
  },
  ".texleaf-theorem-end.texleaf-theorem-proof": {
    border: "0",
    borderRadius: "0",
    backgroundColor: "transparent",
  },
  ".texleaf-list-marker": {
    display: "inline-block",
    minWidth: "2.1em",
    marginRight: "0.25em",
    color: "var(--vscode-editor-foreground)",
    fontWeight: "600",
    textAlign: "right",
    cursor: "text",
  },
  ".texleaf-citation-chip": {
    display: "inline",
    margin: "0 2px",
    padding: "0 4px",
    color: "var(--vscode-textLink-foreground)",
    backgroundColor: "var(--vscode-textBlockQuote-background)",
    border: "1px solid var(--vscode-textBlockQuote-border)",
    borderRadius: "4px",
    fontFamily: "inherit",
    fontSize: "0.9em",
    lineHeight: "1.35",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    boxDecorationBreak: "clone",
    cursor: "text",
  },
  ".texleaf-citation-chip-target": {
    display: "inline",
  },
  ".texleaf-citation-note": {
    color: "var(--vscode-editor-foreground)",
    fontFamily: "inherit",
    fontSize: "inherit",
    fontStyle: "normal",
    fontWeight: "400",
  },
  ".texleaf-bibliography-card": {
    boxSizing: "border-box",
    width: "min(calc(100% - 24px), calc(100vw - 88px))",
    maxWidth: "calc(100vw - 88px)",
    margin: "0 12px",
    padding: "10px 12px",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 94%, transparent)",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "7px",
  },
  ".texleaf-table-of-contents-card": {
    boxSizing: "border-box",
    width: "min(calc(100% - 24px), calc(100vw - 88px))",
    maxWidth: "calc(100vw - 88px)",
    minWidth: "0",
    margin: "0 12px",
    padding: "10px 12px 12px",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 94%, transparent)",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "7px",
    fontFamily: "inherit",
    cursor: "text",
  },
  ".texleaf-table-of-contents-card:focus-visible": {
    borderColor: "var(--vscode-focusBorder)",
    outline: "1px solid var(--vscode-focusBorder)",
    outlineOffset: "-1px",
  },
  ".texleaf-table-card, .texleaf-image-card, .texleaf-tikzpicture-card": {
    boxSizing: "border-box",
    width: "calc(100% - 24px)",
    maxWidth: "calc(100% - 24px)",
    minWidth: "0",
    margin: "0 12px",
    padding: "12px 14px",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 82%, transparent)",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "7px",
    fontFamily: "inherit",
    cursor: "text",
    overflow: "hidden",
    contain: "inline-size",
  },
  ".texleaf-structure-actions": {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "6px",
    marginBottom: "8px",
  },
  ".texleaf-structure-action": {
    minHeight: "24px",
    padding: "2px 8px",
    color: "var(--vscode-button-secondaryForeground)",
    backgroundColor: "var(--vscode-button-secondaryBackground)",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "4px",
    font: "inherit",
    fontSize: "0.82em",
    cursor: "pointer",
  },
  ".texleaf-structure-action:hover": {
    backgroundColor: "var(--vscode-button-secondaryHoverBackground)",
  },
  ".texleaf-structure-action-primary": {
    color: "var(--vscode-button-foreground)",
    backgroundColor: "var(--vscode-button-background)",
    borderColor: "var(--vscode-button-background)",
  },
  ".texleaf-structure-action-primary:hover": {
    backgroundColor: "var(--vscode-button-hoverBackground)",
  },
  ".texleaf-environment-edit-chip": {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "18px",
    marginInlineStart: "6px",
    padding: "0 5px",
    color: "var(--vscode-descriptionForeground)",
    backgroundColor: "transparent",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "4px",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "0.72em",
    fontStyle: "normal",
    fontWeight: "400",
    lineHeight: "1.35",
    whiteSpace: "nowrap",
    cursor: "pointer",
    opacity: "0.76",
  },
  ".texleaf-environment-edit-chip:hover, .texleaf-environment-edit-chip:focus-visible": {
    color: "var(--vscode-textLink-foreground)",
    borderColor: "var(--vscode-focusBorder)",
    opacity: "1",
    outline: "none",
  },
  ".texleaf-list-boundary": {
    display: "flex",
    justifyContent: "flex-end",
    boxSizing: "border-box",
    width: "100%",
    minHeight: "1.1em",
    padding: "1px 10px",
  },
  ".texleaf-list-boundary.texleaf-frame-list-boundary": {
    width: "auto",
    maxWidth: "calc(100% - 32px)",
    minWidth: "0",
    margin: "0 16px",
    padding: "2px 18px",
    backgroundColor: VISUAL_FRAME_SURFACE,
    borderLeft: VISUAL_FRAME_RAIL,
    borderRight: VISUAL_FRAME_RAIL,
  },
  ".texleaf-list-boundary.texleaf-frame-list-boundary .texleaf-environment-edit-chip": {
    opacity: "0.48",
  },
  ".texleaf-list-boundary.texleaf-frame-list-boundary:hover .texleaf-environment-edit-chip, .texleaf-list-boundary.texleaf-frame-list-boundary .texleaf-environment-edit-chip:focus-visible": {
    opacity: "1",
  },
  ".texleaf-list-boundary.texleaf-theorem-list-boundary": {
    width: "calc(100% - 24px)",
    margin: "0 12px",
    borderLeft: VISUAL_THEOREM_FRAME_BORDER,
    borderRight: VISUAL_THEOREM_FRAME_BORDER,
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 58%, transparent)",
  },
  ".texleaf-list-boundary.texleaf-theorem-list-boundary.texleaf-theorem-proof": {
    width: "100%",
    margin: "0",
    border: "0",
    backgroundColor: "transparent",
  },
  ".texleaf-list-boundary.texleaf-frame-list-boundary.texleaf-theorem-list-boundary": {
    width: "auto",
    maxWidth: "calc(100% - 32px)",
    minWidth: "0",
    margin: "0 16px",
    padding: "2px 18px",
    backgroundColor: VISUAL_FRAME_THEOREM_SURFACE,
    borderLeft: VISUAL_FRAME_RAIL,
    borderRight: VISUAL_FRAME_RAIL,
  },
  ".texleaf-visual-structure-editor": {
    position: "relative",
    marginTop: "12px",
    padding: "10px",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "var(--vscode-sideBar-background)",
    border: "1px solid var(--vscode-focusBorder)",
    borderRadius: "6px",
    cursor: "default",
  },
  ".texleaf-visual-structure-editor-title": {
    margin: "0 0 8px",
    fontSize: "0.92em",
    fontWeight: "700",
  },
  ".texleaf-table-parameter-grid": {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(13em, 1fr))",
    gap: "8px 10px",
    marginBottom: "10px",
    paddingBottom: "10px",
    borderBottom: "1px solid var(--vscode-editorWidget-border)",
  },
  ".texleaf-table-parameter": {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    minWidth: "0",
    color: "var(--vscode-descriptionForeground)",
    fontSize: "0.78em",
  },
  ".texleaf-table-parameter-wide": {
    gridColumn: "1 / -1",
  },
  ".texleaf-table-parameter-label": {
    lineHeight: "1.25",
  },
  ".texleaf-table-parameter-input": {
    boxSizing: "border-box",
    width: "100%",
    minHeight: "28px",
    padding: "3px 6px",
    color: "var(--vscode-input-foreground)",
    backgroundColor: "var(--vscode-input-background)",
    border: "1px solid var(--vscode-input-border, var(--vscode-editorWidget-border))",
    borderRadius: "3px",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "var(--vscode-editor-font-size)",
  },
  ".texleaf-table-option-row": {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px 16px",
    minHeight: "28px",
  },
  ".texleaf-table-checkbox": {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    color: "var(--vscode-editor-foreground)",
    whiteSpace: "nowrap",
  },
  ".texleaf-table-editor-scroll": {
    maxWidth: "100%",
    overflow: "auto",
    padding: "2px 0",
  },
  ".texleaf-table-editor-grid": {
    borderCollapse: "collapse",
    borderSpacing: "0",
    width: "max-content",
    margin: "0 auto",
    tableLayout: "fixed",
  },
  ".texleaf-table-editor-grid th, .texleaf-table-editor-grid td": {
    padding: "0",
  },
  ".texleaf-table-editor-alignment-row th": {
    padding: "0 2px 4px",
    border: "0",
  },
  ".texleaf-table-editor-cell": {
    border: "1px solid var(--vscode-editorWidget-border)",
    backgroundColor: "var(--vscode-input-background)",
  },
  ".texleaf-table-editor-remove-cell": {
    width: "24px",
    paddingLeft: "3px !important",
    border: "0",
    backgroundColor: "transparent",
  },
  ".texleaf-table-cell-input": {
    boxSizing: "border-box",
    width: "clamp(7.5em, 14vw, 18em)",
    minHeight: "27px",
    padding: "3px 6px",
    color: "var(--vscode-input-foreground)",
    backgroundColor: "transparent",
    border: "0",
    borderRadius: "0",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "0.88em",
  },
  ".texleaf-virtual-latex-input:focus": {
    borderColor: "var(--vscode-focusBorder)",
    outline: "1px solid var(--vscode-focusBorder)",
    outlineOffset: "-1px",
  },
  ".texleaf-virtual-completion": {
    position: "absolute",
    zIndex: "80",
    minWidth: "16em",
    maxWidth: "min(34em, calc(100% - 16px))",
    maxHeight: "15em",
    padding: "3px",
    overflow: "auto",
    color: "var(--vscode-editorSuggestWidget-foreground)",
    backgroundColor: "var(--vscode-editorSuggestWidget-background)",
    border: "1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-editorWidget-border))",
    borderRadius: "4px",
    boxShadow: "0 3px 10px var(--vscode-widget-shadow)",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "0.82em",
  },
  ".texleaf-virtual-math-preview": {
    position: "absolute",
    display: "none",
    zIndex: "79",
    boxSizing: "border-box",
    maxWidth: "min(30em, calc(100% - 16px))",
    maxHeight: "12em",
    padding: "6px 8px",
    overflow: "auto",
    color: "var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground))",
    backgroundColor: "var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background))",
    border: "1px solid var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border))",
    borderRadius: "5px",
    boxShadow: "0 3px 12px var(--vscode-widget-shadow)",
    pointerEvents: "none",
  },
  ".texleaf-virtual-math-preview.visible": {
    display: "block",
  },
  ".texleaf-virtual-math-preview .texleaf-structure-math svg": {
    maxWidth: "none",
    maxHeight: "none",
  },
  ".texleaf-virtual-completion-item": {
    display: "grid",
    gridTemplateColumns: "minmax(7em, auto) 1fr auto",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    minHeight: "25px",
    padding: "3px 6px",
    color: "inherit",
    backgroundColor: "transparent",
    border: "0",
    borderRadius: "2px",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
  },
  ".texleaf-virtual-completion-item[aria-selected='true']": {
    color: "var(--vscode-editorSuggestWidget-selectedForeground)",
    backgroundColor: "var(--vscode-editorSuggestWidget-selectedBackground)",
  },
  ".texleaf-virtual-completion-label": {
    fontWeight: "700",
    whiteSpace: "nowrap",
  },
  ".texleaf-virtual-completion-detail, .texleaf-virtual-completion-source": {
    color: "var(--vscode-descriptionForeground)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".texleaf-table-align-select": {
    boxSizing: "border-box",
    width: "100%",
    minHeight: "26px",
    color: "var(--vscode-dropdown-foreground)",
    backgroundColor: "var(--vscode-dropdown-background)",
    border: "1px solid var(--vscode-dropdown-border)",
    borderRadius: "3px",
    font: "inherit",
    fontSize: "0.82em",
  },
  ".texleaf-table-row-remove": {
    width: "22px",
    minHeight: "24px",
    padding: "0",
    color: "var(--vscode-errorForeground)",
    backgroundColor: "transparent",
    border: "1px solid transparent",
    borderRadius: "3px",
    cursor: "pointer",
  },
  ".texleaf-visual-editor-note": {
    marginTop: "7px",
    color: "var(--vscode-descriptionForeground)",
    fontSize: "0.8em",
  },
  ".texleaf-tikzcd-card": {
    boxSizing: "border-box",
    width: "calc(100% - 24px)",
    maxWidth: "calc(100% - 24px)",
    minWidth: "0",
    margin: "0 12px",
    padding: "12px 14px",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 82%, transparent)",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "7px",
    fontFamily: "inherit",
    cursor: "text",
    overflow: "hidden",
    contain: "inline-size",
  },
  ".texleaf-local-latex-preview": {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "100%",
    minWidth: "0",
    padding: "8px",
    color: "var(--vscode-editor-foreground)",
    textAlign: "center",
    scrollbarWidth: "thin",
  },
  ".texleaf-local-latex-preview svg": {
    display: "block",
    flex: "none",
    width: "var(--texleaf-local-preview-width, auto)",
    height: "var(--texleaf-local-preview-height, auto)",
    maxWidth: "none",
    maxHeight: "none",
    margin: "0 auto",
    color: "inherit",
    pointerEvents: "none",
  },
  ".texleaf-local-latex-preview-fallback": {
    display: "grid",
    minHeight: "7em",
    placeItems: "center",
    color: "var(--vscode-descriptionForeground)",
    backgroundColor: "var(--vscode-textCodeBlock-background)",
    border: "1px dashed var(--vscode-editorWidget-border)",
    borderRadius: "5px",
  },
  ".texleaf-tikzcd-canvas": {
    position: "relative",
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "100%",
    minWidth: "0",
    minHeight: "8em",
    padding: "1.5em",
  },
  ".texleaf-tikzcd-grid": {
    position: "relative",
    zIndex: "2",
    display: "grid",
    alignItems: "center",
    justifyItems: "center",
    gridAutoRows: "minmax(3.2em, max-content)",
    gap: "3.2em 4.2em",
    width: "max-content",
    minWidth: "0",
    margin: "0 auto",
  },
  ".texleaf-tikzcd-node": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "4.5em",
    minHeight: "2.5em",
    padding: "0.2em 0.45em",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 94%, transparent)",
    borderRadius: "4px",
  },
  ".texleaf-tikzcd-node-empty": {
    minWidth: "0.5em",
    minHeight: "0.5em",
    padding: "0",
    opacity: "0.35",
  },
  ".texleaf-tikzcd-arrows": {
    position: "absolute",
    inset: "0",
    zIndex: "1",
    width: "100%",
    height: "100%",
    overflow: "visible",
    color: "var(--vscode-editor-foreground)",
    pointerEvents: "none",
  },
  ".texleaf-tikzcd-arrow-label": {
    position: "absolute",
    zIndex: "3",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1px 4px",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "var(--vscode-editorWidget-background)",
    borderRadius: "3px",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none",
  },
  ".texleaf-tikzcd-note": {
    marginTop: "7px",
    color: "var(--vscode-descriptionForeground)",
    fontSize: "0.82em",
    textAlign: "center",
  },
  ".texleaf-tikzcd-editor-grid": {
    display: "grid",
    gap: "5px",
    width: "max-content",
    minWidth: "100%",
  },
  ".texleaf-tikzcd-direct-toolbar": {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "5px",
    marginBottom: "8px",
  },
  ".texleaf-tikzcd-direct-toolbar-spacer": {
    flex: "1 1 auto",
  },
  ".texleaf-tikzcd-zoom": {
    minWidth: "4.5em",
    color: "var(--vscode-descriptionForeground)",
    fontSize: "0.78em",
    textAlign: "center",
  },
  ".texleaf-tikzcd-direct-workspace": {
    position: "relative",
    boxSizing: "border-box",
    minHeight: "22em",
    maxHeight: "min(52vh, 38em)",
    padding: "0",
    overflow: "auto",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-editor-background) 96%, var(--vscode-focusBorder) 4%)",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "8px",
    outline: "none",
  },
  ".texleaf-tikzcd-direct-workspace:focus-within": {
    borderColor: "var(--vscode-focusBorder)",
  },
  ".texleaf-tikzcd-direct-canvas": {
    position: "relative",
    boxSizing: "border-box",
    width: "max-content",
    minWidth: "0",
    minHeight: "20em",
    margin: "0 auto",
    padding: "4em",
    transformOrigin: "top left",
  },
  ".texleaf-tikzcd-direct-grid": {
    position: "relative",
    zIndex: "2",
    display: "grid",
    alignItems: "stretch",
    justifyItems: "stretch",
    gridAutoRows: "8em",
    gap: "0",
    width: "max-content",
    minWidth: "0",
    borderRight: "1px dashed color-mix(in srgb, var(--vscode-editor-foreground) 22%, transparent)",
    borderBottom: "1px dashed color-mix(in srgb, var(--vscode-editor-foreground) 22%, transparent)",
  },
  ".texleaf-tikzcd-editor-cell": {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    width: "8em",
    minWidth: "8em",
    height: "8em",
    minHeight: "8em",
    padding: "0",
    border: "0",
    borderTop: "1px dashed color-mix(in srgb, var(--vscode-editor-foreground) 22%, transparent)",
    borderLeft: "1px dashed color-mix(in srgb, var(--vscode-editor-foreground) 22%, transparent)",
    borderRadius: "0",
    outline: "none",
    cursor: "move",
  },
  ".texleaf-tikzcd-editor-cell:hover, .texleaf-tikzcd-editor-cell:focus": {
    outline: "none",
  },
  ".texleaf-tikzcd-editor-cell-selected": {
    borderTopColor: "color-mix(in srgb, var(--vscode-editor-foreground) 22%, transparent)",
    borderLeftColor: "color-mix(in srgb, var(--vscode-editor-foreground) 22%, transparent)",
  },
  ".texleaf-tikzcd-editor-cell-selected .texleaf-tikzcd-editor-node": {
    backgroundColor: "color-mix(in srgb, var(--vscode-editor-foreground) 17%, transparent)",
    boxShadow: "0 0 0 2px color-mix(in srgb, var(--vscode-focusBorder) 88%, transparent)",
  },
  ".texleaf-tikzcd-editor-cell-drop .texleaf-tikzcd-editor-node": {
    backgroundColor: "color-mix(in srgb, var(--vscode-terminal-ansiGreen, var(--vscode-focusBorder)) 22%, transparent)",
    boxShadow: "0 0 0 2px var(--vscode-terminal-ansiGreen, var(--vscode-focusBorder))",
  },
  ".texleaf-tikzcd-editor-node": {
    position: "relative",
    zIndex: "4",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    minWidth: "4em",
    minHeight: "4em",
    padding: "0.45em 0.8em",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "transparent",
    border: "0",
    borderRadius: "1em",
    boxShadow: "none",
    cursor: "crosshair",
    userSelect: "none",
    transition: "background-color 80ms ease, box-shadow 80ms ease, opacity 80ms ease",
  },
  ".texleaf-tikzcd-editor-node:hover": {
    backgroundColor: "color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent)",
  },
  ".texleaf-tikzcd-direct-workspace-arrow-mode .texleaf-tikzcd-editor-node": {
    cursor: "crosshair",
  },
  ".texleaf-tikzcd-direct-workspace:not(.texleaf-tikzcd-direct-workspace-arrow-mode) .texleaf-tikzcd-editor-node": {
    cursor: "move",
  },
  ".texleaf-tikzcd-editor-node-source": {
    backgroundColor: "color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent)",
    boxShadow: "0 0 0 2px var(--vscode-focusBorder)",
  },
  ".texleaf-tikzcd-editor-node-empty": {
    minWidth: "4em",
    minHeight: "4em",
    opacity: "0.22",
  },
  ".texleaf-tikzcd-editor-node-empty:hover, .texleaf-tikzcd-editor-cell-selected .texleaf-tikzcd-editor-node-empty, .texleaf-tikzcd-editor-cell-drop .texleaf-tikzcd-editor-node-empty": {
    opacity: "1",
  },
  ".texleaf-tikzcd-editor-node-label": {
    pointerEvents: "none",
  },
  ".texleaf-tikzcd-connect-handle": {
    position: "absolute",
    left: "50%",
    top: "50%",
    zIndex: "-1",
    width: "18px",
    height: "18px",
    padding: "0",
    backgroundColor: "transparent",
    border: "0",
    borderRadius: "50%",
    opacity: "0",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none",
  },
  ".texleaf-tikzcd-mode-active": {
    color: "var(--vscode-button-foreground)",
    backgroundColor: "var(--vscode-button-background)",
    borderColor: "var(--vscode-focusBorder)",
  },
  ".texleaf-tikzcd-editor-arrows": {
    position: "absolute",
    inset: "0",
    zIndex: "3",
    width: "100%",
    height: "100%",
    overflow: "visible",
    color: "var(--vscode-editor-foreground)",
    pointerEvents: "none",
  },
  ".texleaf-tikzcd-editor-arrow-hit": {
    fill: "none",
    stroke: "transparent",
    strokeWidth: "16px",
    pointerEvents: "stroke",
    cursor: "pointer",
  },
  ".texleaf-tikzcd-editor-arrow-selected": {
    filter: "drop-shadow(0 0 2px var(--vscode-focusBorder))",
  },
  ".texleaf-tikzcd-editor-endpoint": {
    // Keep the drag target visible without painting over the marker-end that
    // terminates at the same coordinate.
    fill: "transparent",
    stroke: "var(--vscode-focusBorder)",
    strokeWidth: "2px",
    pointerEvents: "all",
    cursor: "crosshair",
  },
  ".texleaf-tikzcd-editor-drag-line": {
    fill: "none",
    stroke: "var(--vscode-focusBorder)",
    strokeWidth: "1.7px",
    strokeLinecap: "round",
    pointerEvents: "none",
  },
  ".texleaf-tikzcd-editor-arrow-label": {
    position: "absolute",
    zIndex: "5",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    maxWidth: "18em",
    padding: "1px 4px",
    overflow: "hidden",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "var(--vscode-editorWidget-background)",
    border: "1px solid transparent",
    borderRadius: "3px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none",
  },
  ".texleaf-tikzcd-editor-arrow-label-selected": {
    borderColor: "var(--vscode-focusBorder)",
  },
  ".texleaf-tikzcd-selection-panel": {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(11em, 1fr))",
    gap: "8px",
    marginTop: "9px",
    padding: "9px",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 70%, transparent)",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "5px",
  },
  ".texleaf-tikzcd-selection-title, .texleaf-tikzcd-selection-hint": {
    gridColumn: "1 / -1",
    margin: "0",
  },
  ".texleaf-tikzcd-selection-title": {
    fontSize: "0.86em",
    fontWeight: "700",
  },
  ".texleaf-tikzcd-selection-hint": {
    color: "var(--vscode-descriptionForeground)",
    fontSize: "0.78em",
  },
  ".texleaf-tikzcd-field": {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    minWidth: "0",
    color: "var(--vscode-descriptionForeground)",
    fontSize: "0.76em",
  },
  ".texleaf-tikzcd-field input[type=text], .texleaf-tikzcd-field select": {
    boxSizing: "border-box",
    width: "100%",
    minHeight: "29px",
    padding: "3px 6px",
    color: "var(--vscode-input-foreground)",
    backgroundColor: "var(--vscode-input-background)",
    border: "1px solid var(--vscode-input-border, var(--vscode-editorWidget-border))",
    borderRadius: "3px",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "var(--vscode-editor-font-size)",
  },
  ".texleaf-tikzcd-selection-actions": {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "5px",
  },
  ".texleaf-tikzcd-node-input": {
    boxSizing: "border-box",
    width: "clamp(7em, 14vw, 18em)",
    minHeight: "30px",
    padding: "4px 6px",
    color: "var(--vscode-input-foreground)",
    backgroundColor: "var(--vscode-input-background)",
    border: "1px solid var(--vscode-input-border, var(--vscode-editorWidget-border))",
    borderRadius: "3px",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "0.86em",
    textAlign: "center",
  },
  ".texleaf-tikzcd-arrow-editor": {
    display: "grid",
    gridTemplateColumns: "minmax(7em, auto) minmax(7em, auto) minmax(8em, 1fr) minmax(7em, auto) auto auto",
    alignItems: "center",
    gap: "5px",
    marginTop: "6px",
  },
  ".texleaf-tikzcd-arrow-editor select, .texleaf-tikzcd-arrow-editor input[type=text]": {
    boxSizing: "border-box",
    minHeight: "27px",
    minWidth: "0",
    padding: "3px 5px",
    color: "var(--vscode-input-foreground)",
    backgroundColor: "var(--vscode-input-background)",
    border: "1px solid var(--vscode-input-border, var(--vscode-editorWidget-border))",
    borderRadius: "3px",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "0.82em",
  },
  ".texleaf-table-caption, .texleaf-image-caption": {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: "4px",
    fontWeight: "600",
    textAlign: "center",
  },
  ".texleaf-table-caption": {
    marginBottom: "0.65em",
  },
  ".texleaf-image-caption": {
    marginTop: "0.65em",
  },
  ".texleaf-table-scroll": {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "100%",
    minWidth: "0",
  },
  ".texleaf-table": {
    width: "max-content",
    minWidth: "min(100%, 32em)",
    margin: "0 auto",
    borderCollapse: "collapse",
    fontFamily: "inherit",
    fontSize: "0.94em",
  },
  ".texleaf-table th, .texleaf-table td": {
    maxWidth: "36em",
    padding: "5px 9px",
    borderBottom: "1px solid var(--vscode-editorWidget-border)",
    textAlign: "center",
    verticalAlign: "middle",
    whiteSpace: "pre-wrap",
  },
  ".texleaf-table th": {
    fontWeight: "700",
    borderTop: "2px solid var(--vscode-editor-foreground)",
    borderBottom: "1px solid var(--vscode-editor-foreground)",
  },
  ".texleaf-table tbody tr:last-child td": {
    borderBottom: "2px solid var(--vscode-editor-foreground)",
  },
  ".texleaf-table-inline-content": {
    whiteSpace: "pre-wrap",
  },
  ".texleaf-structure-math": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    maxWidth: "100%",
    lineHeight: "1",
    verticalAlign: "middle",
  },
  ".texleaf-structure-math svg": {
    display: "block",
    width: "var(--texleaf-structure-math-width, 1em)",
    height: "var(--texleaf-structure-math-height, 1em)",
    maxWidth: "100%",
    maxHeight: "2.8em",
    color: "inherit",
    pointerEvents: "none",
  },
  ".texleaf-table-note": {
    marginTop: "8px",
    color: "var(--vscode-descriptionForeground)",
    fontSize: "0.85em",
    textAlign: "center",
  },
  ".texleaf-image-card": {
    textAlign: "center",
  },
  ".texleaf-image-canvas": {
    display: "grid",
    width: "max-content",
    minWidth: "100%",
    placeItems: "center",
  },
  ".texleaf-image-preview": {
    display: "block",
    width: "auto",
    maxWidth: "none",
    maxHeight: "min(70vh, 48em)",
    margin: "0 auto",
    objectFit: "contain",
    borderRadius: "4px",
  },
  ".texleaf-image-placeholder": {
    display: "grid",
    minHeight: "7em",
    placeItems: "center",
    padding: "14px",
    color: "var(--vscode-descriptionForeground)",
    backgroundColor: "var(--vscode-textCodeBlock-background)",
    border: "1px dashed var(--vscode-editorWidget-border)",
    borderRadius: "5px",
    overflowWrap: "anywhere",
  },
  ".texleaf-table-of-contents-header": {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "8px",
    minWidth: "0",
    marginBottom: "8px",
    flexWrap: "wrap",
  },
  ".texleaf-table-of-contents-heading": {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    minWidth: "0",
  },
  ".texleaf-table-of-contents-title": {
    margin: "0",
    fontFamily: "inherit",
    fontSize: "1.2em",
    fontWeight: "700",
    lineHeight: "1.25",
  },
  ".texleaf-table-of-contents-count": {
    display: "inline-flex",
    alignItems: "center",
    padding: "1px 5px",
    color: "var(--vscode-descriptionForeground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-badge-background) 24%, transparent)",
    border: "1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 82%, transparent)",
    borderRadius: "4px",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "0.78em",
    lineHeight: "1.35",
    whiteSpace: "nowrap",
  },
  ".texleaf-table-of-contents-tree": {
    display: "grid",
    gap: "2px",
    maxHeight: "min(55vh, 36em)",
    margin: "0",
    padding: "0 2px",
    listStyle: "none",
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  ".texleaf-table-of-contents-item": {
    position: "relative",
    minWidth: "0",
    margin: "0",
    padding: "0",
  },
  ".texleaf-table-of-contents-entry": {
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: "minmax(2.6em, max-content) minmax(0, 1fr)",
    alignItems: "baseline",
    gap: "8px",
    width: "100%",
    minWidth: "0",
    paddingBlock: "5px",
    paddingInlineStart: "calc(8px + var(--texleaf-toc-indent, 0px))",
    paddingInlineEnd: "8px",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "transparent",
    border: "1px solid transparent",
    borderRadius: "5px",
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "1.35",
    textAlign: "start",
    cursor: "pointer",
  },
  ".texleaf-table-of-contents-entry::before": {
    content: '""',
    position: "absolute",
    top: "0.5em",
    bottom: "0.5em",
    insetInlineStart: "calc(5px + var(--texleaf-toc-indent, 0px))",
    borderInlineStart: "1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 82%, transparent)",
    pointerEvents: "none",
  },
  ".texleaf-table-of-contents-entry:hover": {
    color: "var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground))",
    backgroundColor: "var(--vscode-list-hoverBackground)",
    borderColor: "color-mix(in srgb, var(--vscode-focusBorder) 58%, transparent)",
  },
  ".texleaf-table-of-contents-entry:focus-visible": {
    color: "var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground))",
    backgroundColor: "var(--vscode-list-focusBackground, var(--vscode-list-hoverBackground))",
    borderColor: "var(--vscode-focusBorder)",
    outline: "none",
  },
  ".texleaf-table-of-contents-number": {
    color: "var(--vscode-descriptionForeground)",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "0.86em",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  ".texleaf-table-of-contents-entry:hover .texleaf-table-of-contents-number, .texleaf-table-of-contents-entry:focus-visible .texleaf-table-of-contents-number": {
    color: "inherit",
  },
  ".texleaf-table-of-contents-entry-title": {
    minWidth: "0",
    overflowWrap: "anywhere",
  },
  ".texleaf-table-of-contents-empty, .texleaf-table-of-contents-incomplete, .texleaf-table-of-contents-numbering-note": {
    padding: "7px 8px",
    color: "var(--vscode-descriptionForeground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-editor-background) 54%, transparent)",
    border: "1px dashed var(--vscode-editorWidget-border)",
    borderRadius: "5px",
    fontSize: "0.86em",
    lineHeight: "1.4",
  },
  ".texleaf-table-of-contents-incomplete": {
    marginTop: "7px",
    color: "var(--vscode-editorWarning-foreground, var(--vscode-descriptionForeground))",
    borderColor: "var(--vscode-editorWarning-border, var(--vscode-editorWidget-border))",
  },
  ".texleaf-table-of-contents-numbering-note": {
    marginTop: "7px",
    color: "var(--vscode-editorInfo-foreground, var(--vscode-editor-foreground))",
    borderColor: "var(--vscode-editorInfo-border, var(--vscode-editorWidget-border))",
  },
  ".texleaf-bibliography-header": {
    display: "block",
    marginBottom: "7px",
  },
  ".texleaf-bibliography-heading": {
    minWidth: "0",
  },
  ".texleaf-bibliography-title-row": {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    minWidth: "0",
    flexWrap: "wrap",
  },
  ".texleaf-bibliography-title": {
    margin: "0",
    fontFamily: "inherit",
    fontSize: "1.2em",
    lineHeight: "1.25",
    cursor: "text",
  },
  ".texleaf-bibliography-count, .texleaf-bibliography-key, .texleaf-bibliography-type": {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: "100%",
    padding: "1px 5px",
    color: "var(--vscode-descriptionForeground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-badge-background) 24%, transparent)",
    border: "1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 82%, transparent)",
    borderRadius: "4px",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "0.78em",
    lineHeight: "1.35",
  },
  ".texleaf-bibliography-source": {
    marginTop: "2px",
    overflow: "hidden",
    color: "var(--vscode-descriptionForeground)",
    fontFamily: "inherit",
    fontSize: "0.82em",
    lineHeight: "1.35",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".texleaf-bibliography-settings": {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    marginTop: "5px",
    flexWrap: "wrap",
  },
  ".texleaf-bibliography-setting": {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "4px",
    maxWidth: "100%",
    padding: "2px 6px",
    color: "var(--vscode-descriptionForeground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-editor-background) 58%, transparent)",
    border: "1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 82%, transparent)",
    borderRadius: "5px",
    fontFamily: "inherit",
    fontSize: "0.8em",
    lineHeight: "1.35",
  },
  ".texleaf-bibliography-setting-label": {
    color: "var(--vscode-descriptionForeground)",
    whiteSpace: "nowrap",
  },
  ".texleaf-bibliography-setting-value": {
    minWidth: "0",
    overflowWrap: "anywhere",
    color: "var(--vscode-editor-foreground)",
    fontFamily: "var(--vscode-editor-font-family)",
  },
  ".texleaf-bibliography-actions": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flex: "0 0 auto",
    flexWrap: "wrap",
  },
  ".texleaf-bibliography-open": {
    padding: "3px 7px",
    color: "var(--vscode-button-secondaryForeground)",
    backgroundColor: "var(--vscode-button-secondaryBackground)",
    border: "0",
    borderRadius: "4px",
    fontFamily: "var(--vscode-font-family)",
    cursor: "pointer",
  },
  ".texleaf-bibliography-open:hover": {
    backgroundColor: "var(--vscode-button-secondaryHoverBackground)",
  },
  ".texleaf-bibliography-list": {
    margin: "0",
    padding: "0",
    display: "grid",
    gap: "5px",
    listStyle: "none",
  },
  ".texleaf-bibliography-entry": {
    display: "grid",
    gridTemplateColumns: "2.2em minmax(0, 1fr)",
    gap: "6px",
    margin: "0",
    padding: "6px 8px",
    backgroundColor: "color-mix(in srgb, var(--vscode-editor-background) 82%, transparent)",
    border: "1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 72%, transparent)",
    borderRadius: "5px",
  },
  ".texleaf-bibliography-entry-index": {
    color: "var(--vscode-descriptionForeground)",
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
  },
  ".texleaf-bibliography-entry-body": {
    minWidth: "0",
  },
  ".texleaf-bibliography-entry-heading": {
    display: "flex",
    alignItems: "baseline",
    gap: "6px",
    minWidth: "0",
    flexWrap: "wrap",
  },
  ".texleaf-bibliography-entry-title": {
    fontWeight: "600",
    overflowWrap: "anywhere",
  },
  ".texleaf-bibliography-entry-meta": {
    display: "flex",
    gap: "4px 9px",
    marginTop: "2px",
    flexWrap: "wrap",
  },
  ".texleaf-bibliography-meta, .texleaf-bibliography-empty, .texleaf-bibliography-more": {
    color: "var(--vscode-descriptionForeground)",
    fontFamily: "inherit",
    fontSize: "0.86em",
  },
  ".texleaf-bibliography-empty": {
    padding: "7px 8px",
    backgroundColor: "color-mix(in srgb, var(--vscode-editor-background) 48%, transparent)",
    border: "1px dashed var(--vscode-editorWidget-border)",
    borderRadius: "5px",
  },
  ".texleaf-bibliography-more": {
    marginTop: "6px",
    textAlign: "right",
  },
  ".texleaf-document-end": {
    display: "block",
    width: "calc(100% - 32px)",
    margin: "0 16px",
    color: "var(--vscode-descriptionForeground)",
    borderTop: "1px solid var(--vscode-editorWidget-border)",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "11px",
    lineHeight: "22px",
    textAlign: "center",
    cursor: "text",
  },
  ".texleaf-ai-issue": {
    backgroundColor: "color-mix(in srgb, var(--vscode-editorInfo-foreground) 14%, transparent)",
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textDecorationColor: "var(--vscode-editorInfo-foreground)",
    textDecorationThickness: "1.5px",
    textUnderlineOffset: "3px",
    cursor: "help",
  },
  ".texleaf-ai-issue-warning": {
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWarning-foreground) 16%, transparent)",
    textDecorationColor: "var(--vscode-editorWarning-foreground)",
  },
  ".texleaf-ai-issue-error": {
    backgroundColor: "color-mix(in srgb, var(--vscode-editorError-foreground) 16%, transparent)",
    textDecorationColor: "var(--vscode-editorError-foreground)",
  },
  ".texleaf-diagnostic": {
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textDecorationThickness: "1.5px",
    textUnderlineOffset: "3px",
    cursor: "help",
  },
  ".texleaf-diagnostic-error": {
    backgroundColor: "color-mix(in srgb, var(--vscode-editorError-foreground) 11%, transparent)",
    textDecorationColor: "var(--vscode-editorError-foreground)",
  },
  ".texleaf-diagnostic-warning": {
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWarning-foreground) 11%, transparent)",
    textDecorationColor: "var(--vscode-editorWarning-foreground)",
  },
  ".texleaf-diagnostic-information": {
    backgroundColor: "color-mix(in srgb, var(--vscode-editorInfo-foreground) 10%, transparent)",
    textDecorationColor: "var(--vscode-editorInfo-foreground)",
  },
  ".texleaf-diagnostic-hint": {
    textDecorationStyle: "dotted",
    textDecorationColor: "var(--vscode-editorHint-foreground, var(--vscode-descriptionForeground))",
  },
  ".texleaf-formula-widget": {
    position: "relative",
    boxSizing: "border-box",
    maxWidth: "100%",
    border: "1px solid transparent",
    borderRadius: "4px",
    color: "var(--vscode-editor-foreground)",
    cursor: "text",
    touchAction: "manipulation",
  },
  ".texleaf-formula-widget:hover, .texleaf-formula-widget:focus-visible": {
    outline: "none",
  },
  ".texleaf-formula-widget-error": {
    borderColor:
      "color-mix(in srgb, var(--vscode-editorError-foreground) 70%, transparent)",
    backgroundColor:
      "color-mix(in srgb, var(--vscode-editorError-foreground) 6%, transparent)",
  },
  ".texleaf-formula-widget-inline": {
    display: "inline-flex",
    alignItems: "center",
    verticalAlign: "middle",
    margin: "0 2px",
    padding: "1px 3px",
    lineHeight: "normal",
  },
  ".texleaf-formula-widget-block": {
    display: "block",
    width: "calc(100% - 16px)",
    minWidth: "0",
    minHeight: "2.2em",
    margin: "0 8px",
    padding: "0.375em 0.75em",
    overflow: "hidden",
  },
  ".texleaf-formula-layout": {
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    alignItems: "stretch",
    width: "100%",
    maxWidth: "100%",
    minWidth: "0",
  },
  ".texleaf-formula-layout-has-labels": {
    gridTemplateColumns: "minmax(0, 1fr) fit-content(42%)",
    columnGap: "0.55em",
  },
  ".texleaf-formula-scroll, .texleaf-structure-horizontal-scroll": {
    boxSizing: "border-box",
    display: "block",
    width: "100%",
    maxWidth: "100%",
    minWidth: "0",
    overflowX: "auto",
    overflowY: "hidden",
    overscrollBehaviorInline: "contain",
    scrollbarColor: "var(--vscode-scrollbarSlider-background) transparent",
    scrollbarWidth: "thin",
  },
  ".texleaf-formula-scroll::-webkit-scrollbar, .texleaf-structure-horizontal-scroll::-webkit-scrollbar": {
    height: "6px",
  },
  ".texleaf-formula-scroll::-webkit-scrollbar-track, .texleaf-formula-scroll::-webkit-scrollbar-corner, .texleaf-structure-horizontal-scroll::-webkit-scrollbar-track, .texleaf-structure-horizontal-scroll::-webkit-scrollbar-corner": {
    backgroundColor: "transparent",
  },
  ".texleaf-formula-scroll::-webkit-scrollbar-thumb, .texleaf-structure-horizontal-scroll::-webkit-scrollbar-thumb": {
    backgroundColor: "var(--vscode-scrollbarSlider-background)",
    border: "1px solid transparent",
    backgroundClip: "content-box",
    borderRadius: "4px",
  },
  ".texleaf-formula-scroll::-webkit-scrollbar-thumb:hover, .texleaf-structure-horizontal-scroll::-webkit-scrollbar-thumb:hover": {
    backgroundColor: "var(--vscode-scrollbarSlider-hoverBackground)",
  },
  ".texleaf-formula-scroll::-webkit-scrollbar-thumb:active, .texleaf-structure-horizontal-scroll::-webkit-scrollbar-thumb:active": {
    backgroundColor: "var(--vscode-scrollbarSlider-activeBackground)",
  },
  ".texleaf-formula-widget svg": {
    display: "block",
    flex: "0 0 auto",
    width: "var(--texleaf-formula-width)",
    height: "var(--texleaf-formula-height)",
    pointerEvents: "none",
  },
  ".texleaf-formula-widget-block svg": {
    maxWidth: "none",
    maxHeight: "none",
    margin: "0 auto",
  },
  ".texleaf-formula-widget-inline svg": {
    maxWidth: "100%",
    maxHeight: "4.5em",
  },
  ".texleaf-formula-labels": {
    position: "relative",
    display: "grid",
    alignItems: "stretch",
    width: "max-content",
    maxWidth: "18em",
    minWidth: "0",
    zIndex: "1",
    pointerEvents: "none",
  },
  ".texleaf-formula-label-row": {
    position: "relative",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "4px",
    minWidth: "0",
    pointerEvents: "none",
  },
  ".texleaf-formula-label-chip": {
    boxSizing: "border-box",
    display: "block",
    maxWidth: "18em",
    padding: "1px 5px",
    color: "var(--vscode-textLink-foreground)",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 90%, transparent)",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "4px",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "0.72em",
    fontWeight: "400",
    lineHeight: "1.35",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    cursor: "pointer",
    pointerEvents: "auto",
  },
  ".texleaf-formula-source-active": {
    backgroundColor: "color-mix(in srgb, var(--vscode-editor-wordHighlightBackground) 45%, transparent)",
    boxShadow: "inset 0 -1px var(--vscode-editor-wordHighlightStrongBorder, var(--vscode-focusBorder))",
  },
  ".cm-tooltip.texleaf-math-preview-tooltip": {
    boxSizing: "border-box",
    maxWidth: "min(84vw, 72em)",
    maxHeight: "min(58vh, 32em)",
    padding: "0",
    overflow: "hidden",
    color: "var(--vscode-editor-foreground)",
    backgroundColor: "var(--vscode-editorHoverWidget-background)",
    border: "1px solid var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border))",
    borderRadius: "5px",
    boxShadow: "0 3px 12px var(--vscode-widget-shadow)",
    pointerEvents: "auto",
    zIndex: "20",
  },
  ".cm-tooltip.texleaf-math-preview-tooltip-error": {
    borderColor: "var(--vscode-editorError-foreground)",
  },
  ".texleaf-math-preview-scroll": {
    boxSizing: "border-box",
    height: "100%",
    maxWidth: "min(84vw, 72em)",
    maxHeight: "min(58vh, 32em)",
    padding: "8px",
    overflow: "auto",
    overscrollBehavior: "contain",
    scrollbarGutter: "auto",
    scrollbarWidth: "none",
  },
  ".texleaf-math-preview-scroll::-webkit-scrollbar": {
    display: "none",
    width: "0",
    height: "0",
  },
  ".texleaf-math-preview-scrollbar": {
    position: "absolute",
    display: "none",
    zIndex: "2",
    borderRadius: "4px",
    backgroundColor: "color-mix(in srgb, var(--vscode-scrollbarSlider-background) 22%, transparent)",
    pointerEvents: "auto",
    touchAction: "none",
  },
  ".texleaf-math-preview-scrollbar.visible": {
    display: "block",
  },
  ".texleaf-math-preview-scrollbar-x": {
    left: "8px",
    right: "8px",
    bottom: "1px",
    height: "6px",
  },
  ".texleaf-math-preview-scrollbar-y": {
    top: "8px",
    right: "1px",
    bottom: "8px",
    width: "6px",
  },
  ".texleaf-math-preview-scrollbar-thumb": {
    position: "absolute",
    borderRadius: "4px",
    backgroundColor: "var(--vscode-scrollbarSlider-background)",
    cursor: "pointer",
  },
  ".texleaf-math-preview-scrollbar-thumb:hover": {
    backgroundColor: "var(--vscode-scrollbarSlider-hoverBackground)",
  },
  ".texleaf-math-preview-scrollbar-x .texleaf-math-preview-scrollbar-thumb": {
    top: "1px",
    height: "4px",
  },
  ".texleaf-math-preview-scrollbar-y .texleaf-math-preview-scrollbar-thumb": {
    left: "1px",
    width: "4px",
  },
  ".texleaf-math-preview-canvas": {
    position: "relative",
    boxSizing: "content-box",
    width: "var(--texleaf-formula-width)",
    height: "var(--texleaf-formula-height)",
    minWidth: "var(--texleaf-formula-width)",
    minHeight: "var(--texleaf-formula-height)",
  },
  ".cm-tooltip-autocomplete": {
    maxWidth: "min(31em, 46vw)",
    color: "var(--vscode-editorSuggestWidget-foreground, var(--vscode-editor-foreground))",
    backgroundColor: "var(--vscode-editorSuggestWidget-background, var(--vscode-editorWidget-background))",
    border: "1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-editorWidget-border))",
    borderRadius: "5px",
    boxShadow: "0 3px 12px var(--vscode-widget-shadow)",
    fontFamily: "var(--vscode-editor-font-family)",
    fontSize: "var(--vscode-editor-font-size)",
  },
  ".cm-tooltip-autocomplete > ul": {
    maxWidth: "inherit",
    maxHeight: "min(45vh, 24em)",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    color: "inherit",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    color: "var(--vscode-editorSuggestWidget-selectedForeground, var(--vscode-list-activeSelectionForeground))",
    backgroundColor: "var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-activeSelectionBackground))",
  },
  ".cm-tooltip-autocomplete .cm-completionMatchedText": {
    color: "var(--vscode-editorSuggestWidget-highlightForeground, var(--vscode-list-highlightForeground))",
    textDecoration: "none",
    fontWeight: "700",
  },
  ".cm-tooltip-autocomplete .cm-completionDetail": {
    color: "var(--vscode-editorSuggestWidget-foreground, var(--vscode-descriptionForeground))",
    opacity: "0.78",
  },
  ".cm-tooltip.cm-completionInfo.texleaf-completion-info-adaptive": {
    boxSizing: "border-box",
    width: "min(26em, calc(100vw - 16px))",
    minWidth: "0",
    maxHeight: "min(52vh, 30em)",
    padding: "12px 14px",
    overflow: "auto",
    color: "var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground))",
    backgroundColor: "var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background))",
    border: "1px solid var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border))",
    borderRadius: "6px",
    boxShadow: "0 3px 12px var(--vscode-widget-shadow)",
    whiteSpace: "normal",
    lineHeight: "1.45",
  },
  ".texleaf-completion-info h3": {
    margin: "0 0 10px",
    color: "inherit",
    fontFamily: "var(--vscode-font-family)",
    fontSize: "1.08em",
    lineHeight: "1.3",
  },
  ".texleaf-completion-info p": {
    margin: "7px 0",
  },
  ".texleaf-completion-info code": {
    padding: "1px 4px",
    color: "var(--vscode-textPreformat-foreground)",
    backgroundColor: "var(--vscode-textCodeBlock-background)",
    borderRadius: "3px",
    fontFamily: "var(--vscode-editor-font-family)",
  },
  ".texleaf-completion-info hr": {
    height: "1px",
    margin: "10px 0",
    border: "0",
    backgroundColor: "var(--vscode-editorWidget-border)",
  },
  ".texleaf-completion-reference-preview": {
    boxSizing: "border-box",
    width: "100%",
    minWidth: "0",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-empty": {
    color: "var(--vscode-descriptionForeground)",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-heading": {
    display: "grid",
    gap: "7px",
    padding: "10px 11px",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "6px",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 76%, transparent)",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-heading-title": {
    fontFamily: "inherit",
    fontSize: "1.08em",
    lineHeight: "1.35",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-heading-meta": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    color: "var(--vscode-descriptionForeground)",
    fontSize: "0.82em",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-formula": {
    padding: "2px 0",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-key": {
    marginBottom: "7px",
    color: "var(--vscode-textLink-foreground)",
    fontSize: "0.88em",
    fontWeight: "600",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-math-scroll": {
    maxWidth: "100%",
    maxHeight: "min(40vh, 280px)",
    padding: "8px",
    overflow: "auto",
    borderRadius: "4px",
    backgroundColor: "color-mix(in srgb, var(--vscode-editor-background) 74%, transparent)",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-math-canvas": {
    position: "relative",
    isolation: "isolate",
    boxSizing: "content-box",
    width: "var(--texleaf-formula-width)",
    height: "var(--texleaf-formula-height)",
    minWidth: "var(--texleaf-formula-width)",
    minHeight: "var(--texleaf-formula-height)",
    margin: "0 auto",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-math-canvas svg, .texleaf-completion-reference-preview .texleaf-reference-hover-theorem-math-canvas svg": {
    position: "relative",
    zIndex: "1",
    display: "block",
    width: "100%",
    height: "100%",
    maxWidth: "none",
    maxHeight: "none",
    color: "inherit",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-row-highlight": {
    position: "absolute",
    zIndex: "0",
    left: "0",
    right: "0",
    boxSizing: "border-box",
    pointerEvents: "none",
    borderBlock: "1px solid var(--vscode-editor-findMatchBorder, var(--vscode-focusBorder))",
    borderRadius: "3px",
    background: "var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.24))",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-theorem": {
    overflow: "hidden",
    border: VISUAL_THEOREM_FRAME_BORDER,
    borderRadius: "7px",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 76%, transparent)",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-theorem-header": {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: "4px 8px",
    padding: "8px 10px 7px",
    borderBottom: "1px solid var(--vscode-editorWidget-border)",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-theorem-header code": {
    marginLeft: "auto",
    fontSize: "0.78em",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-theorem-body": {
    padding: "8px 10px 9px",
    whiteSpace: "pre-wrap",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-theorem-plain .texleaf-reference-hover-theorem-body": {
    fontStyle: "italic",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-theorem-math-inline": {
    display: "inline-block",
    maxWidth: "100%",
    overflowX: "auto",
    verticalAlign: "middle",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-theorem-math-display": {
    display: "block",
    maxWidth: "100%",
    margin: "7px 0",
    overflow: "auto",
    textAlign: "center",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-theorem-math-canvas": {
    display: "inline-block",
    boxSizing: "content-box",
    width: "var(--texleaf-formula-width)",
    height: "var(--texleaf-formula-height)",
    minWidth: "var(--texleaf-formula-width)",
    minHeight: "var(--texleaf-formula-height)",
    verticalAlign: "middle",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-theorem-truncated": {
    marginTop: "7px",
    color: "var(--vscode-descriptionForeground)",
    fontSize: "0.86em",
    fontStyle: "normal",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-structure": {
    overflow: "hidden",
    border: "1px solid var(--vscode-editorWidget-border)",
    borderRadius: "7px",
    backgroundColor: "color-mix(in srgb, var(--vscode-editorWidget-background) 76%, transparent)",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-structure-header": {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "10px",
    padding: "8px 10px 7px",
    borderBottom: "1px solid var(--vscode-editorWidget-border)",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-structure-caption": {
    padding: "7px 10px",
    color: "var(--vscode-descriptionForeground)",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-structure-scroll": {
    boxSizing: "border-box",
    maxWidth: "100%",
    maxHeight: "min(42vh, 300px)",
    padding: "8px",
    overflow: "auto",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-structure-note": {
    padding: "6px 10px 8px",
    color: "var(--vscode-descriptionForeground)",
    fontSize: "0.84em",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-image-viewport": {
    display: "grid",
    maxWidth: "100%",
    maxHeight: "min(42vh, 320px)",
    padding: "8px",
    overflow: "auto",
    placeItems: "center",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-image-preview": {
    display: "block",
    maxWidth: "100%",
    maxHeight: "min(40vh, 300px)",
    objectFit: "contain",
    borderRadius: "4px",
  },
  ".texleaf-completion-reference-preview .texleaf-reference-hover-diagram-canvas": {
    maxHeight: "min(42vh, 320px)",
    overflow: "auto",
  },
  // A Beamer frame is one slide canvas. Block replacements are siblings of
  // CodeMirror lines, so they explicitly carry the same surface segment
  // instead of becoming independent cards between broken border fragments.
  ".texleaf-frame-content-shell": {
    boxSizing: "border-box",
    width: "auto",
    maxWidth: "calc(100% - 32px)",
    minWidth: "0",
    margin: "0 16px",
    padding: "0.42em 18px",
    backgroundColor: VISUAL_FRAME_SURFACE,
    borderLeft: VISUAL_FRAME_RAIL,
    borderRight: VISUAL_FRAME_RAIL,
  },
  ".texleaf-frame-content-shell.texleaf-table-of-contents-shell": {
    padding: "0.72em 18px 0.9em",
  },
  ".texleaf-frame-content-shell.texleaf-table-shell, .texleaf-frame-content-shell.texleaf-tikzcd-shell, .texleaf-frame-content-shell.texleaf-tikzpicture-shell, .texleaf-frame-content-shell.texleaf-image-shell, .texleaf-frame-content-shell.texleaf-bibliography-shell": {
    padding: "0.72em 18px",
  },
  ".texleaf-frame-content-shell > .texleaf-table-of-contents-card": {
    width: "100%",
    maxWidth: "100%",
    margin: "0",
    padding: "0",
    backgroundColor: "transparent",
    border: "0",
    borderRadius: "0",
  },
  ".texleaf-frame-content-shell > .texleaf-table-of-contents-card:focus-visible": {
    outlineOffset: "3px",
  },
  ".texleaf-frame-content-shell > .texleaf-table-card, .texleaf-frame-content-shell > .texleaf-tikzcd-card, .texleaf-frame-content-shell > .texleaf-tikzpicture-card, .texleaf-frame-content-shell > .texleaf-image-card, .texleaf-frame-content-shell > .texleaf-bibliography-card": {
    width: "100%",
    maxWidth: "100%",
    margin: "0",
    padding: "0",
    backgroundColor: "transparent",
    border: "0",
    borderRadius: "0",
  },
  ".texleaf-frame-content-shell.texleaf-formula-shell": {
    padding: "0.3em 18px",
  },
  ".texleaf-frame-content-shell.texleaf-title-shell": {
    padding: "0.72em 18px 0.9em",
  },
  ".texleaf-frame-content-shell .texleaf-title-card": {
    width: "100%",
    margin: "0",
    padding: "16px 18px",
    backgroundColor: "transparent",
    border: "0",
  },
  ".texleaf-frame-content-shell.texleaf-theorem-begin-shell": {
    padding: "0.62em 0 0",
  },
  ".texleaf-frame-content-shell.texleaf-theorem-end-shell": {
    padding: "0 0 0.62em",
  },
  ".texleaf-frame-content-shell > .texleaf-theorem-begin-block, .texleaf-frame-content-shell > .texleaf-theorem-end-block": {
    width: "100%",
    margin: "0",
    border: "0",
    borderRadius: "0",
    backgroundColor: VISUAL_FRAME_THEOREM_SURFACE,
    boxShadow: "none",
  },
  ".texleaf-frame-content-shell > .texleaf-theorem-begin-block": {
    padding: "0.55em 18px 0.38em",
    borderTop: "1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 38%, transparent)",
  },
  ".texleaf-frame-content-shell > .texleaf-theorem-end-block": {
    minHeight: "0.5em",
    padding: "0 18px 0.38em",
    borderBottom: "1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 30%, transparent)",
  },
  ".cm-line.texleaf-frame-line.texleaf-theorem-line": {
    "--texleaf-line-base-padding-inline-start": "18px",
    margin: "0 16px",
    paddingInlineEnd: "18px",
    backgroundColor: VISUAL_FRAME_THEOREM_SURFACE,
    borderLeft: VISUAL_FRAME_RAIL,
    borderRight: VISUAL_FRAME_RAIL,
    boxShadow: "none",
  },
  ".texleaf-frame-content-shell.texleaf-theorem-formula-shell": {
    width: "auto",
    maxWidth: "calc(100% - 32px)",
    minWidth: "0",
    margin: "0 16px",
    padding: "0.3em 18px",
    backgroundColor: VISUAL_FRAME_THEOREM_SURFACE,
    borderLeft: VISUAL_FRAME_RAIL,
    borderRight: VISUAL_FRAME_RAIL,
    boxShadow: "none",
  },
  // A block replacement in the middle of one physical source line makes
  // CodeMirror render the trailing source as a second `.cm-line`. Line
  // decorations belong to the physical line and are attached only to its
  // leading DOM fragment, so the trailing fragment cannot inherit
  // `texleaf-frame-line`. Continue the slide canvas explicitly across that
  // generated sibling. The repeated shell classes intentionally match the
  // specificity of the legacy theorem-fragment rule above.
  ".texleaf-frame-content-shell.texleaf-measured-block-shell + .cm-line:not(.texleaf-frame-line), .texleaf-list-boundary.texleaf-frame-list-boundary + .cm-line:not(.texleaf-frame-line)": {
    "--texleaf-line-base-padding-inline-start": "18px",
    boxSizing: "border-box",
    width: "auto",
    maxWidth: "calc(100% - 32px)",
    minWidth: "0",
    minHeight: "var(--vscode-editor-line-height, 1.5em)",
    margin: "0 16px",
    paddingInlineEnd: "18px",
    backgroundColor: VISUAL_FRAME_SURFACE,
    borderLeft: VISUAL_FRAME_RAIL,
    borderRight: VISUAL_FRAME_RAIL,
    lineHeight: "1.55",
    overflowWrap: "anywhere",
  },
  ".texleaf-frame-content-shell.texleaf-theorem-formula-shell + .cm-line:not(.texleaf-frame-line), .texleaf-list-boundary.texleaf-frame-list-boundary.texleaf-theorem-list-boundary + .cm-line:not(.texleaf-frame-line)": {
    backgroundColor: VISUAL_FRAME_THEOREM_SURFACE,
  },
  ".texleaf-math-preview-tooltip svg": {
    display: "block",
    width: "100%",
    height: "100%",
    maxWidth: "none",
    maxHeight: "none",
    color: "inherit",
  },
  ".texleaf-math-preview-tooltip [data-texleaf-preview-caret=\"true\"]": {
    fill: "var(--texleaf-math-preview-caret, #ff2bd6)",
    stroke: "var(--texleaf-math-preview-caret, #ff2bd6)",
    strokeWidth: "0.04em",
    paintOrder: "stroke fill",
    filter: "drop-shadow(0 0 0.3em var(--texleaf-math-preview-caret, #ff2bd6))",
  },
});

const visualEditorChinesePhrases = EditorState.phrases.of({
  Find: "查找",
  Replace: "替换",
  next: "下一个",
  previous: "上一个",
  all: "全部",
  "match case": "区分大小写",
  regexp: "正则表达式",
  "by word": "全字匹配",
  replace: "替换",
  "replace all": "全部替换",
  close: "关闭",
  "current match": "当前匹配",
  "on line": "位于行号",
  "replaced match on line $": "已替换第 $ 行的匹配项",
  "replaced $ matches": "已替换 $ 处匹配",
  "Go to line": "转到行",
  go: "转到",
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = parseHostMessage(event.data);
  if (message === undefined) {
    return;
  }
  handleHostMessage(message);
});
window.addEventListener("keydown", handleUnifiedNavigationKeydown, { capture: true });
window.addEventListener("keydown", handleVisualSearchNativeHistoryKeydown, { capture: true });
window.addEventListener("keydown", handleVirtualInputHistoryKeydown, { capture: true });
window.addEventListener("keydown", handleVisualHistoryKeydown, { capture: true });
window.addEventListener("resize", () => {
  closeToolbarPopupMenu(false);
  closeEditingContextMenu(false);
  if (editor !== undefined) {
    updateIssueCard(editor.state);
  }
  if (activeReferenceHover !== undefined) {
    scheduleReferenceHoverPosition();
  }
  scheduleEditorScrollbarUpdate();
});
editorHost.addEventListener("scroll", () => {
  closeToolbarPopupMenu(false);
  closeEditingContextMenu(false);
  if (activeReferenceHover !== undefined) {
    scheduleReferenceHoverPosition();
  }
}, true);
editorHost.addEventListener("contextmenu", openEditingContextMenu);
for (const trigger of toolbarMenuTriggers) {
  const menuId = trigger.dataset.toolbarMenu;
  const menu = menuId === undefined ? null : document.getElementById(menuId);
  if (!(menu instanceof HTMLDivElement)) {
    continue;
  }
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (activeToolbarMenu?.menu === menu) {
      closeToolbarPopupMenu(true);
    } else {
      openToolbarPopupMenu(trigger, menu);
    }
  });
}
for (const menu of toolbarPopupMenus) {
  menu.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  menu.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target !== null && target.closest("button") !== null) {
      closeToolbarPopupMenu(false);
    }
  });
  menu.addEventListener("keydown", (event) => {
    handleToolbarPopupMenuKeydown(event, menu);
  });
}
editingContextMenu.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  event.stopPropagation();
});
editingContextMenu.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target !== null && target.closest("button") !== null) {
    closeEditingContextMenu(false);
  }
});
editingContextMenu.addEventListener("keydown", handleEditingContextMenuKeydown);
referenceHoverElement.addEventListener("pointerenter", () => {
  referenceHoverPointerInside = true;
  cancelReferenceHoverHide();
});
referenceHoverElement.addEventListener("pointerleave", () => {
  referenceHoverPointerInside = false;
  scheduleReferenceHoverHide();
});

wireButton(requiredElement<HTMLButtonElement>("visual-mode-basic"), "visualBasic");
wireButton(requiredElement<HTMLButtonElement>("visual-mode-maximum"), "visualMaximum");
wireButton(requiredElement<HTMLButtonElement>("clear-graph-cache"), "clearGraphCache");
wireButton(buildPdfLaTexButton, "buildPdfLaTex");
wireButton(buildXeLaTexButton, "buildXeLaTex");
wireButton(buildLuaLaTexButton, "buildLuaLaTex");
wireButton(buildBibTexButton, "buildBibTex");
wireButton(buildBibLaTexButton, "buildBibLaTex");
wireButton(viewPdfButton, "viewPdf");
wireButton(topViewPdfButton, "viewPdf");
wireButton(synctexButton, "synctex");
wireButton(saveDocumentButton, "save");
wireButton(topSaveDocumentButton, "save");
topFormatDocumentButton.addEventListener("click", () => {
  closeToolbarPopupMenu(false);
  closeEditingContextMenu(false);
  closeTextColorPopover(false);
  if (editor !== undefined) {
    runVisualFormatDocument(editor);
  }
});
wireButton(topPickSnippetButton, "pickSnippet");
wireButton(topPickCitationButton, "pickCitation");
wireButton(topOpenSnippetManagerButton, "openSnippetManager");
wireButton(topOpenTemplateManagerButton, "openTemplateManager");
templateMenuItems.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("button[data-template-id]")
    : null;
  const templateId = target?.dataset.templateId;
  if (templateId === undefined || target?.disabled === true) {
    return;
  }
  post({
    protocol: VISUAL_EDITOR_PROTOCOL,
    type: "openTemplate",
    templateId,
  });
});
wireButton(aiReviewButton, "aiReview");
wireButton(topAiReviewButton, "aiReview");
wireButton(aiRewriteButton, "aiRewrite");
wireButton(topAiRewriteButton, "aiRewrite");
wireButton(aiCompletionButton, "aiCompletion");
wireButton(topAiCompletionButton, "aiCompletion");
wireButton(aiReviewDocumentButton, "aiReviewDocument");
wireButton(topAiReviewDocumentButton, "aiReviewDocument");
editUndoButton.addEventListener("click", () => {
  closeEditingContextMenu(false);
  if (editor !== undefined) {
    runVisualUndo(editor);
    editor.focus();
  }
});
editRedoButton.addEventListener("click", () => {
  closeEditingContextMenu(false);
  if (editor !== undefined) {
    runVisualRedo(editor);
    editor.focus();
  }
});
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(
  "#toolbar [data-texleaf-insert], .toolbar-popup-menu [data-texleaf-insert], " +
    "#editing-context-menu [data-texleaf-insert]",
))) {
  let pointerSelection: VisualEditorSelection | undefined;
  button.addEventListener("pointerdown", (event) => {
    pointerSelection = event.button === 0 && editor !== undefined
      ? editingContextSelection ?? currentSelection(editor.state)
      : undefined;
  });
  button.addEventListener("click", () => {
    const command = button.dataset.texleafInsert;
    if (command !== undefined) {
      // A toolbar button takes DOM focus before its click handler runs. Retain
      // the editor range captured at pointerdown so formatting applies to the
      // text the user visibly selected, even when the browser has already
      // moved its native focus to this button. Keyboard activation has no
      // pointerdown and deliberately falls back to CodeMirror's live range.
      runEditingToolbarInsertion(command, pointerSelection);
    }
    pointerSelection = undefined;
    closeToolbarPopupMenu(false);
    closeEditingContextMenu(false);
  });
}
editCutButton.addEventListener("click", () => runClipboardAction("cut"));
editCopyButton.addEventListener("click", () => runClipboardAction("copy"));
editPasteButton.addEventListener("click", () => runClipboardAction("paste"));
textColorButton.addEventListener("pointerdown", () => {
  captureTextColorSelection();
});
textColorButton.addEventListener("click", () => {
  openTextColorPopover();
});
textColorPicker.addEventListener("input", () => {
  setTextColorPanelValue(textColorPicker.value);
});
textColorHex.addEventListener("input", () => {
  const normalized = normalizedHtmlColor(textColorHex.value);
  textColorHex.classList.toggle("invalid", normalized === undefined);
  textColorApplyButton.disabled = normalized === undefined;
  if (normalized !== undefined) {
    textColorPicker.value = `#${normalized}`;
    textColorSwatch.style.backgroundColor = `#${normalized}`;
  }
});
textColorApplyButton.addEventListener("click", applyPendingTextColor);
textColorCancelButton.addEventListener("click", () => closeTextColorPopover(true));
textColorPopover.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeTextColorPopover(true);
  }
});
document.addEventListener("pointerdown", (event) => {
  if (
    activeToolbarMenu !== undefined &&
    !activeToolbarMenu.menu.contains(event.target as Node) &&
    !activeToolbarMenu.trigger.contains(event.target as Node)
  ) {
    closeToolbarPopupMenu(false);
  }
  if (
    !editingContextMenu.hidden &&
    !editingContextMenu.contains(event.target as Node)
  ) {
    closeEditingContextMenu(false);
  }
  if (
    !textColorPopover.hidden &&
    !textColorPopover.contains(event.target as Node) &&
    !textColorButton.contains(event.target as Node)
  ) {
    closeTextColorPopover(false);
  }
}, { capture: true });
aiApplyButton.addEventListener("click", () => runAiIssueAction("apply"));
aiIgnoreButton.addEventListener("click", () => runAiIssueAction("ignore"));
aiSuggestionElement.addEventListener("mouseenter", () => {
  issueCardPointerInside = true;
  cancelIssueCardHide();
});
aiSuggestionElement.addEventListener("mouseleave", () => {
  issueCardPointerInside = false;
  hoveredIssueCard = undefined;
  if (editor !== undefined) {
    updateIssueCard(editor.state);
  }
});
wireButton(openNativeSourceButton, "openSource");
wireButton(topOpenNativeSourceButton, "openSource");
openSourceButton.addEventListener("click", toggleEditorMode);
topOpenSourceButton.addEventListener("click", toggleEditorMode);
updateEditorModeButton();

window.addEventListener("pagehide", () => {
  cancelViewportRequestSchedule();
  if (editor !== undefined) {
    persistEditorState(editor);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && editor !== undefined) {
    persistEditorState(editor);
  }
});

post({ protocol: VISUAL_EDITOR_PROTOCOL, type: "ready" });

function handleHostMessage(message: VisualEditorHostMessage): void {
  if (
    visualImeCompositionActive &&
    message.type !== "initialize" &&
    message.type !== "document" &&
    message.type !== "status" &&
    message.type !== "projectContextInvalidated"
  ) {
    // Rendering, syntax and completion responses may all dispatch CodeMirror
    // transactions. Keep them away from Chromium's provisional composition DOM
    // and replay only the still-current messages after compositionend.
    deferredImeHostMessages.push(message);
    if (deferredImeHostMessages.length > 256) {
      deferredImeHostMessages.shift();
    }
    return;
  }
  switch (message.type) {
    case "initialize":
    case "document":
      applyDocumentMessage(message);
      return;
    case "projectContextInvalidated":
      applyProjectContextInvalidatedMessage(message.projectContextKey);
      return;
    case "syntaxTokenPatch":
      applySyntaxTokenPatch(message);
      return;
    case "bracketTokenPatch":
      applyBracketTokenPatch(message);
      return;
    case "structureAssets":
      if (editor !== undefined && message.version === documentVersion && message.assetGeneration === assetGeneration &&
          message.revision === clientRevision) {
        const patches = new Map(message.structures.map(record => [visualStructureIdentity(record), record]));
        const records = message.replaceAll ? message.structures : editor.state.field(structureField).records.map(record => patches.get(visualStructureIdentity(record)) ?? record);
        editor.dispatch({ effects: setStructureDocument.of(records) });
      }
      return;
    case "renderBatch":
      if (editor === undefined || message.version !== documentVersion ||
          (message.assetGeneration !== undefined && message.assetGeneration !== assetGeneration)) {
        return;
      }
      {
        const updates: FormulaRenderUpdate[] = message.results
          .filter((result) => isSafeSvg(result.svg))
          .map((result) => ({
            formulaId: result.formulaId,
            rendered: {
              svg: result.svg,
              widthEm: result.widthEm,
              heightEm: result.heightEm,
              source: result.formulaSource,
            },
          }));
        for (const error of message.errors) {
          if (editor === undefined) {
            break;
          }
          const rendered = currentFormulaRenderError(
            editor.state,
            error.formulaId,
            error.message,
          );
          if (rendered !== undefined) {
            updates.push({ formulaId: error.formulaId, rendered });
          }
        }
        if (updates.length > 0) {
          editor.dispatch({
            effects: setFormulaRenders.of(updates),
            annotations: hostSyncAnnotations,
          });
        }
        if (message.errors.length > 0) {
          const first = message.errors[0];
          const suffix = message.errors.length > 1
            ? `（本批共 ${message.errors.length} 条）`
            : "";
          setStatus(
            "warning",
            `有一条公式暂时无法预览：${first?.message ?? "未知错误"}${suffix}`,
            4_000,
          );
        }
      }
      return;
    case "cursorRenderResult":
      if (
        editor === undefined ||
        message.version !== documentVersion ||
        message.revision !== clientRevision ||
        message.requestId > latestCursorPreviewRequestId ||
        !formulaPreviewTargetMatches(
          activeFormulaPreviewTarget(
            editor.state,
            editor.state.field(formulaField, false)?.records ?? [],
          ),
          message.formulaId,
          message.cursorOffset,
        )
      ) {
        return;
      }
      editor.dispatch({
        effects: setFormulaCursorRender.of({
          formulaId: message.formulaId,
          cursorOffset: message.cursorOffset,
          rendered: {
            svg: message.svg,
            widthEm: message.widthEm,
            heightEm: message.heightEm,
            source: message.formulaSource,
          },
        }),
        annotations: hostSyncAnnotations,
      });
      return;
    case "cursorRenderError":
      if (message.requestId === latestCursorPreviewRequestId) {
        lastCursorPreviewRequestKey = undefined;
      }
      return;
    case "formulaCommitRenderResult":
      if (
        editor === undefined ||
        message.version !== documentVersion ||
        message.revision !== clientRevision ||
        latestFormulaCommitPreviewRequests.get(message.formulaId) !==
          message.requestId
      ) {
        return;
      }
      latestFormulaCommitPreviewRequests.delete(message.formulaId);
      editor.dispatch({
        effects: setFormulaRenders.of([{
          formulaId: message.formulaId,
          rendered: {
            svg: message.svg,
            widthEm: message.widthEm,
            heightEm: message.heightEm,
            source: message.formulaSource,
          },
        }]),
        annotations: hostSyncAnnotations,
      });
      return;
    case "formulaCommitRenderError":
      if (
        latestFormulaCommitPreviewRequests.get(message.formulaId) ===
          message.requestId
      ) {
        latestFormulaCommitPreviewRequests.delete(message.formulaId);
        if (
          editor !== undefined &&
          message.version === documentVersion &&
          message.revision === clientRevision
        ) {
          const rendered = currentFormulaRenderError(
            editor.state,
            message.formulaId,
            message.message,
          );
            if (rendered !== undefined) {
              editor.dispatch({
                effects: setFormulaRenders.of([{
                  formulaId: message.formulaId,
                  rendered,
                }]),
              annotations: hostSyncAnnotations,
            });
          }
        }
      }
      return;
    case "referencePreviewResult":
      resolveReferencePreviewResult(message);
      return;
    case "completionReferencePreviewResult":
      resolveCompletionReferencePreviewResult(message);
      return;
    case "status":
      setStatus(message.level, message.message, message.busy ? undefined : 3_500);
      setToolbarBusy(message.busy === true);
      return;
    case "focus":
      if (editor === undefined) {
        // `ready` is posted before the provider finishes the potentially
        // expensive initial snapshot. An external file:line redirect can race
        // that snapshot; retain only its newest exact target for consumption
        // immediately after CodeMirror is constructed.
        pendingHostFocus = {
          ...(message.requestId === undefined ? {} : { requestId: message.requestId }),
          selection: message.selection,
          ...(message.options === undefined ? {} : { options: message.options }),
        };
      } else {
        revealSelection(message.selection, message.options);
      }
      if (editor !== undefined && message.requestId !== undefined) {
        post({ protocol: VISUAL_EDITOR_PROTOCOL, type: "focusApplied", requestId: message.requestId });
      }
      return;
    case "applySnippet":
      applySnippetMessage(message);
      return;
    case "applyEdit":
      applyEditMessage(message);
      return;
    case "inputFallback":
      applyInputFallback(message);
      return;
    case "completionResult":
      resolveCompletionResult(message);
      return;
    case "completionRefresh":
      refreshVisualCitationCompletion(message);
      return;
    case "virtualSnippetResult":
      resolveVirtualSnippetResult(message);
      return;
    case "virtualCompletionResult":
      resolveVirtualCompletionResult(message);
      return;
    case "virtualMathRenderResult":
      resolveVirtualMathRenderResult(message);
      return;
    case "virtualMathRenderError":
      resolveVirtualMathRenderError(message);
      return;
    case "aiIssues":
      if (
        editor !== undefined &&
        message.revision === clientRevision &&
        editor.state.doc.length >= 0
      ) {
        editor.dispatch({
          effects: setAiIssues.of(message.issues),
          annotations: hostSyncAnnotations,
        });
        updateIssueCard(editor.state);
      }
      return;
    case "diagnostics":
      if (
        editor !== undefined &&
        message.revision === clientRevision &&
        message.version === documentVersion
      ) {
        editor.dispatch({
          effects: setDiagnostics.of(message.diagnostics),
          annotations: hostSyncAnnotations,
        });
        pruneDiagnosticInsights(message.diagnostics);
        updateIssueCard(editor.state);
      }
      return;
    case "diagnosticInsight": {
      if (
        editor === undefined ||
        message.revision !== clientRevision ||
        message.version !== documentVersion
      ) {
        return;
      }
      const current = diagnosticInsights.get(message.diagnosticId);
      if (current?.status !== "pending" || current.requestId !== message.requestId) {
        return;
      }
      if (
        message.available &&
        typeof message.explanation === "string" &&
        typeof message.suggestion === "string" &&
        typeof message.model === "string"
      ) {
        diagnosticInsights.set(message.diagnosticId, {
          status: "ready",
          explanation: message.explanation,
          suggestion: message.suggestion,
          model: message.model,
        });
      } else {
        diagnosticInsights.set(message.diagnosticId, { status: "unavailable" });
      }
      updateIssueCard(editor.state);
      return;
    }
  }
}

function resolveReferencePreviewResult(
  message: Extract<
    VisualEditorHostMessage,
    { readonly type: "referencePreviewResult" }
  >,
): void {
  const active = activeReferenceHover;
  if (
    active?.kind !== "reference" ||
    active.requestId !== message.requestId ||
    active.from !== message.from ||
    active.to !== message.to ||
    active.key !== message.key ||
    message.version !== documentVersion ||
    message.revision !== clientRevision
  ) {
    return;
  }
  const elements = createReferencePreviewElements(
    message,
    scheduleReferenceHoverPosition,
  );
  referenceHoverContent.replaceChildren(...elements);
  referenceHoverElement.classList.toggle(
    "texleaf-reference-hover-wide",
    message.structure !== undefined,
  );
  showReferenceHoverCard();
}

function createReferencePreviewElements(message: {
  readonly previews: readonly VisualEditorReferenceFormulaPreview[];
  readonly theorem?: VisualEditorReferenceTheoremPreview;
  readonly heading?: VisualEditorReferenceHeadingPreview;
  readonly structure?: VisualEditorReferenceStructurePreview;
  readonly unavailableKeys: readonly string[];
}, onLayout: () => void): HTMLElement[] {
  const elements: HTMLElement[] = [];
  if (message.structure !== undefined) {
    elements.push(createStructureReferenceHover(message.structure, onLayout));
  }
  if (message.heading !== undefined) {
    elements.push(createHeadingReferenceHover(message.heading));
  }
  if (message.theorem !== undefined) {
    elements.push(createTheoremReferenceHover(message.theorem));
  }
  for (const preview of message.previews) {
    const rendered: RenderedFormula = {
      svg: preview.svg,
      widthEm: preview.widthEm,
      heightEm: preview.heightEm,
    };
    const svg = createFormulaSvg(rendered);
    if (svg === undefined) {
      continue;
    }
    const root = document.createElement("div");
    root.className = "texleaf-reference-hover-formula";
    const key = document.createElement("div");
    key.className = "texleaf-reference-hover-key";
    key.textContent = `公式 ${preview.key}`;
    const scroll = document.createElement("div");
    scroll.className = "texleaf-reference-hover-math-scroll";
    scroll.tabIndex = 0;
    const canvas = document.createElement("div");
    canvas.className = "texleaf-reference-hover-math-canvas";
    applyFormulaGeometry(canvas, rendered);
    canvas.append(svg);
    scheduleReferenceFormulaRowHighlight(canvas, svg, preview);
    scroll.append(canvas);
    root.append(key, scroll);
    elements.push(root);
  }
  if (message.unavailableKeys.length > 0) {
    const unavailable = document.createElement("div");
    unavailable.className = "texleaf-reference-hover-empty";
    unavailable.textContent = elements.length === 0
      ? `未找到可唯一预览的引用目标：${message.unavailableKeys.join(", ")}`
      : `其余标签暂无预览：${message.unavailableKeys.join(", ")}`;
    elements.push(unavailable);
  }
  if (elements.length === 0) {
    const empty = document.createElement("div");
    empty.className = "texleaf-reference-hover-empty";
    empty.textContent = "这个标签尚未解析到可预览的公式、定理、章节、表格、图片或交换图。";
    elements.push(empty);
  }
  return elements;
}

function createStructureReferenceHover(
  preview: VisualEditorReferenceStructurePreview,
  onLayout: () => void,
): HTMLElement {
  const root = document.createElement("section");
  root.className = `texleaf-reference-hover-structure texleaf-reference-hover-${preview.kind}`;
  const header = document.createElement("header");
  header.className = "texleaf-reference-hover-structure-header";
  const title = document.createElement("strong");
  title.textContent = preview.kind === "table"
    ? "表格"
    : preview.kind === "image"
      ? "图片"
      : preview.record.kind === "tikzcd"
        ? "交换图"
        : "TikZ 图";
  const key = document.createElement("code");
  key.textContent = preview.key;
  header.append(title, key);
  root.append(header);

  if (preview.kind === "table") {
    appendTableReferenceHover(root, preview);
  } else if (preview.kind === "image") {
    appendImageReferenceHover(root, preview, onLayout);
  } else {
    appendDiagramReferenceHover(root, preview, onLayout);
  }
  return root;
}

function appendTableReferenceHover(
  root: HTMLElement,
  preview: Extract<VisualEditorReferenceStructurePreview, { readonly kind: "table" }>,
): void {
  const record = preview.record;
  if (record.caption !== undefined && record.caption.length > 0) {
    const caption = document.createElement("div");
    caption.className = "texleaf-reference-hover-structure-caption";
    caption.append(createInlineContentElement(
      record.captionSegments,
      record.caption,
      "texleaf-table-inline-content",
    ));
    root.append(caption);
  }
  const scroll = document.createElement("div");
  scroll.className = "texleaf-reference-hover-structure-scroll";
  configureStructureHorizontalScroll(scroll, "引用目标表格预览");
  const table = document.createElement("table");
  table.className = "texleaf-table texleaf-reference-hover-table-grid";
  const [headerRow, ...bodyRows] = record.rows;
  if (headerRow !== undefined) {
    const head = document.createElement("thead");
    head.append(createTableRow(headerRow, record.columnCount, true));
    table.append(head);
  }
  if (bodyRows.length > 0) {
    const body = document.createElement("tbody");
    for (const row of bodyRows) {
      body.append(createTableRow(row, record.columnCount, false));
    }
    table.append(body);
  }
  scroll.append(table);
  root.append(scroll);
  if (preview.previewTruncated) {
    const note = document.createElement("div");
    note.className = "texleaf-reference-hover-structure-note";
    note.textContent = "表格较大，引用预览只显示前 12 行、前 8 列。";
    root.append(note);
  }
}

function appendImageReferenceHover(
  root: HTMLElement,
  preview: Extract<VisualEditorReferenceStructurePreview, { readonly kind: "image" }>,
  onLayout: () => void,
): void {
  const record = preview.record;
  const viewport = document.createElement("div");
  viewport.className = "texleaf-reference-hover-image-viewport";
  configureStructureHorizontalScroll(viewport, "引用目标图片预览");
  if (record.previewUri === undefined) {
    viewport.append(createImagePlaceholder(record.path));
  } else {
    const image = document.createElement("img");
    image.className = "texleaf-reference-hover-image-preview";
    image.alt = record.caption ?? record.path;
    image.loading = "eager";
    image.draggable = false;
    image.addEventListener("load", onLayout, { once: true });
    image.addEventListener("error", () => {
      image.replaceWith(createImagePlaceholder(record.path));
      onLayout();
    }, { once: true });
    viewport.append(image);
    loadVisualImagePreview(image, record.previewUri);
  }
  root.append(viewport);
  const details = [record.caption, record.path]
    .filter((value): value is string => value !== undefined && value.length > 0);
  if (details.length > 0) {
    const caption = document.createElement("div");
    caption.className = "texleaf-reference-hover-structure-caption";
    caption.textContent = details.join(" · ");
    root.append(caption);
  }
}

function appendDiagramReferenceHover(
  root: HTMLElement,
  preview: Extract<VisualEditorReferenceStructurePreview, { readonly kind: "diagram" }>,
  onLayout: () => void,
): void {
  const record = preview.record;
  if (record.asset !== undefined) {
    const exact = createLocalLatexStructurePreview(
      record.asset,
      record.kind === "tikzcd" ? "引用目标交换图" : "引用目标 TikZ 图",
    );
    exact.classList.add("texleaf-reference-hover-diagram-exact");
    root.append(exact);
    if (record.kind === "figure" && record.caption !== undefined) root.append(createInlineContentElement(record.captionSegments, record.caption, "texleaf-reference-hover-structure-caption"));
    return;
  }
  if (record.kind === "tikzpicture" || record.kind === "figure") {
    root.append(createLocalLatexStructureFallback(
      record.previewStatus?.message ?? "图形预览尚未生成。",
    ));
    return;
  }

  const canvas = document.createElement("div");
  canvas.className = "texleaf-tikzcd-canvas texleaf-reference-hover-diagram-canvas";
  configureStructureHorizontalScroll(canvas, "引用目标交换图预览");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("texleaf-tikzcd-arrows");
  canvas.append(svg);
  const grid = document.createElement("div");
  grid.className = "texleaf-tikzcd-grid";
  grid.style.gridTemplateColumns = `repeat(${Math.max(1, record.columnCount)}, minmax(7.5em, max-content))`;
  const nodeElements = new Map<string, HTMLElement>();
  const nodeRecords = new Map(
    record.nodes.map((node) => [`${node.row}:${node.column}`, node]),
  );
  for (let row = 0; row < record.rowCount; row += 1) {
    for (let column = 0; column < record.columnCount; column += 1) {
      const coordinate = `${row}:${column}`;
      const node = document.createElement("div");
      node.className = "texleaf-tikzcd-node";
      const nodeRecord = nodeRecords.get(coordinate);
      if (nodeRecord === undefined) {
        node.classList.add("texleaf-tikzcd-node-empty");
      } else {
        node.append(createMathFragmentElement(nodeRecord.math, nodeRecord.math.fallback));
      }
      nodeElements.set(coordinate, node);
      grid.append(node);
    }
  }
  canvas.append(grid);
  const arrowLabels = record.arrows.map((arrow) => {
    if (arrow.label === undefined) {
      return undefined;
    }
    const label = document.createElement("span");
    label.className = "texleaf-tikzcd-arrow-label";
    label.append(createMathFragmentElement(arrow.label, arrow.label.fallback));
    canvas.append(label);
    return label;
  });
  root.append(canvas);
  const markerId = `texleaf-reference-tikzcd-marker-${++tikzcdMarkerSequence}`;
  installTransientReferenceDiagramLayout(canvas, grid, () => {
    drawTikzcdArrows(canvas, svg, nodeElements, arrowLabels, record, markerId);
  }, onLayout);
}

function installTransientReferenceDiagramLayout(
  canvas: HTMLElement,
  grid: HTMLElement,
  draw: () => void,
  onLayout: () => void,
): void {
  let frame = 0;
  let disposed = false;
  const schedule = (): void => {
    if (disposed) {
      return;
    }
    onLayout();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!canvas.isConnected) {
        transientReferenceDiagramCleanups.get(canvas)?.();
        return;
      }
      draw();
      onLayout();
    });
  };
  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(schedule)
    : undefined;
  resizeObserver?.observe(canvas);
  resizeObserver?.observe(grid);
  const cleanup = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    transientReferenceDiagramCleanups.delete(canvas);
    if (transientReferenceDiagramCleanups.size === 0) {
      transientReferenceDiagramObserver?.disconnect();
      transientReferenceDiagramObserver = undefined;
    }
  };
  transientReferenceDiagramCleanups.set(canvas, cleanup);
  if (
    transientReferenceDiagramObserver === undefined &&
    typeof MutationObserver === "function"
  ) {
    transientReferenceDiagramObserver = new MutationObserver(() => {
      for (const [element, dispose] of transientReferenceDiagramCleanups) {
        if (!element.isConnected) {
          dispose();
        }
      }
    });
    transientReferenceDiagramObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
  schedule();
}

/** Highlight the exact outer aligned row which owns the hovered label. */
function scheduleReferenceFormulaRowHighlight(
  canvas: HTMLDivElement,
  svg: SVGElement,
  preview: VisualEditorReferenceFormulaPreview,
): void {
  if (preview.rowCount <= 1) {
    return;
  }
  const rowIndex = Math.max(0, Math.min(preview.rowIndex, preview.rowCount - 1));
  requestAnimationFrame(() => {
    if (!canvas.isConnected) {
      return;
    }
    const canvasRect = canvas.getBoundingClientRect();
    if (!(canvasRect.width > 0) || !(canvasRect.height > 0)) {
      return;
    }
    const targetRect = outerMathTableRows(svg)[rowIndex]?.getBoundingClientRect();
    const fallbackHeight = canvasRect.height / preview.rowCount;
    const top = targetRect !== undefined && targetRect.height > 0
      ? targetRect.top - canvasRect.top
      : fallbackHeight * rowIndex;
    const height = targetRect !== undefined && targetRect.height > 0
      ? targetRect.height
      : fallbackHeight;
    const highlight = document.createElement("div");
    highlight.className = "texleaf-reference-hover-row-highlight";
    highlight.setAttribute("aria-hidden", "true");
    highlight.style.top = `${Math.max(0, top - 2)}px`;
    highlight.style.height = `${Math.min(canvasRect.height, height + 4)}px`;
    canvas.prepend(highlight);
    canvas.dataset.highlightedRow = String(rowIndex);
    canvas.dataset.rowCount = String(preview.rowCount);
  });
}

function outerMathTableRows(svg: SVGElement): SVGGraphicsElement[] {
  const rows = Array.from(svg.querySelectorAll(
    'g[data-mml-node="mtr"], g[data-mml-node="mlabeledtr"]',
  )) as SVGGraphicsElement[];
  return rows.filter((row) => {
    const table = row.closest('g[data-mml-node="mtable"]') as
      | SVGGraphicsElement
      | null;
    return table !== null &&
      table.parentElement?.closest('g[data-mml-node="mtable"]') === null;
  });
}

function createHeadingReferenceHover(
  preview: VisualEditorReferenceHeadingPreview,
): HTMLElement {
  const root = document.createElement("article");
  root.className = "texleaf-reference-hover-heading";
  const title = document.createElement("strong");
  title.className = "texleaf-reference-hover-heading-title";
  title.textContent = [preview.number, preview.title]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" ");
  const metadata = document.createElement("div");
  metadata.className = "texleaf-reference-hover-heading-meta";
  const kind = document.createElement("span");
  kind.textContent = visualHeadingReferenceName(preview.command);
  const key = document.createElement("code");
  key.textContent = preview.key;
  metadata.append(kind, key);
  root.append(title, metadata);
  return root;
}

function visualHeadingReferenceName(command: VisualHeadingRecord["command"]): string {
  switch (command) {
    case "part":
      return "部分";
    case "chapter":
      return "章";
    case "section":
      return "节";
    case "subsection":
      return "小节";
    case "subsubsection":
      return "三级小节";
    case "paragraph":
      return "段落标题";
    case "subparagraph":
      return "子段落标题";
  }
}

function createTheoremReferenceHover(
  preview: VisualEditorReferenceTheoremPreview,
): HTMLElement {
  const root = document.createElement("article");
  root.className = `texleaf-reference-hover-theorem texleaf-reference-hover-theorem-${preview.style}`;

  const header = document.createElement("header");
  header.className = "texleaf-reference-hover-theorem-header";
  const heading = document.createElement("strong");
  heading.textContent = visualTheoremHeadingText(
    preview.label,
    preview.number,
    preview.optionalTitle,
    preview.style,
  );
  header.append(heading);
  if (
    preview.style !== "proof" &&
    preview.optionalTitle !== undefined &&
    preview.optionalTitle.length > 0
  ) {
    const optional = document.createElement("span");
    optional.textContent = `(${preview.optionalTitle})`;
    header.append(optional);
  }
  const key = document.createElement("code");
  key.textContent = preview.key;
  header.append(key);
  root.append(header);

  const body = document.createElement("div");
  body.className = "texleaf-reference-hover-theorem-body";
  const formulas = [...preview.formulas]
    .filter((formula) =>
      Number.isInteger(formula.from) &&
      Number.isInteger(formula.to) &&
      formula.from >= 0 &&
      formula.to > formula.from &&
      formula.to <= preview.body.length
    )
    .sort((left, right) => left.from - right.from || left.to - right.to);
  let offset = 0;
  for (const formula of formulas) {
    if (formula.from < offset) {
      continue;
    }
    appendTheoremHoverText(body, preview.body.slice(offset, formula.from));
    const rendered: RenderedFormula = {
      svg: formula.svg,
      widthEm: formula.widthEm,
      heightEm: formula.heightEm,
    };
    const svg = createFormulaSvg(rendered);
    if (svg === undefined) {
      appendTheoremHoverText(body, preview.body.slice(formula.from, formula.to));
      offset = formula.to;
      continue;
    }
    const math = document.createElement(formula.display ? "div" : "span");
    math.className = formula.display
      ? "texleaf-reference-hover-theorem-math texleaf-reference-hover-theorem-math-display"
      : "texleaf-reference-hover-theorem-math texleaf-reference-hover-theorem-math-inline";
    const canvas = document.createElement("span");
    canvas.className = "texleaf-reference-hover-theorem-math-canvas";
    applyFormulaGeometry(canvas, rendered);
    canvas.append(svg);
    math.append(canvas);
    body.append(math);
    offset = formula.to;
  }
  appendTheoremHoverText(body, preview.body.slice(offset));
  if (preview.style === "proof") {
    const qed = document.createElement("span");
    qed.className = "texleaf-reference-hover-theorem-qed";
    qed.textContent = "□";
    body.append(qed);
  }
  if (preview.truncated) {
    const truncated = document.createElement("div");
    truncated.className = "texleaf-reference-hover-theorem-truncated";
    truncated.textContent = "定理内容较长，卡片仅显示开头；Ctrl/⌘ 单击可查看完整内容。";
    body.append(truncated);
  }
  root.append(body);
  return root;
}

function appendTheoremHoverText(root: HTMLElement, source: string): void {
  const text = theoremHoverPlainText(source);
  if (text.length === 0) {
    return;
  }
  const span = document.createElement("span");
  span.className = "texleaf-reference-hover-theorem-text";
  span.textContent = text;
  root.append(span);
}

function theoremHoverPlainText(source: string): string {
  let text = source
    .replace(/%[^\r\n]*/gu, "")
    .replace(/\\label\s*\{[^{}]*\}/gu, "")
    .replace(/\\(?:begin|end)\s*\{[^{}]*\}(?:\s*\[[^\]]*\])?/gu, "")
    .replace(/\\item(?:\s*\[[^\]]*\])?/gu, "\n• ")
    .replace(/\\(?:par|smallskip|medskip|bigskip)\b/gu, "\n")
    .replace(/\\\\/gu, "\n")
    .replace(/~+/gu, "\u00a0");
  for (let pass = 0; pass < 4; pass += 1) {
    const unwrapped = text.replace(
      /\\(?:textbf|textit|textsl|textsc|texttt|textrm|textsf|emph|underline|text)\s*\{([^{}]*)\}/gu,
      "$1",
    );
    if (unwrapped === text) {
      break;
    }
    text = unwrapped;
  }
  return text
    .replace(/\\(?:eqref|ref|autoref|Autoref|cref|Cref|cite|citep|citet|textcite)\s*\{([^{}]*)\}/gu, "$1")
    .replace(/\\([%&#_$])/gu, "$1")
    .replace(/[ \t]+/gu, " ")
    .replace(/ *\r?\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

interface EditorScrollbarMetrics {
  readonly inset: number;
  readonly maxScroll: number;
  readonly thumbHeight: number;
  readonly thumbTravel: number;
}

function installPersistentEditorScrollbar(view: EditorView): void {
  if (editorScrollbarTrack !== undefined) {
    scheduleEditorScrollbarUpdate(view);
    return;
  }
  const track = editorHost.querySelector<HTMLDivElement>(":scope > .texleaf-editor-scrollbar")
    ?? document.createElement("div");
  track.className = "texleaf-editor-scrollbar";
  track.tabIndex = 0;
  track.setAttribute("role", "scrollbar");
  track.setAttribute("aria-orientation", "vertical");
  track.setAttribute("aria-label", "可视化编辑器文档滚动条");
  track.title = "可视化编辑器文档滚动条";
  const thumb = track.querySelector<HTMLDivElement>(":scope > .texleaf-editor-scrollbar-thumb")
    ?? document.createElement("div");
  thumb.className = "texleaf-editor-scrollbar-thumb disabled";
  // Paint a usable thumb in the same frame as the track. The first measured
  // size replaces this fallback, but focus/selection must never be required to
  // make the document scrollbar visible.
  track.hidden = false;
  track.removeAttribute("hidden");
  track.style.opacity = "1";
  track.style.visibility = "visible";
  thumb.style.top = "3px";
  thumb.style.height = "52px";
  thumb.style.opacity = "1";
  thumb.style.visibility = "visible";
  if (!thumb.isConnected) {
    track.append(thumb);
  }
  if (!track.isConnected) {
    editorHost.append(track);
  }
  editorScrollbarTrack = track;
  editorScrollbarThumb = thumb;

  let drag:
    | {
        readonly pointerId: number;
        readonly startY: number;
        readonly startScrollTop: number;
      }
    | undefined;
  thumb.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: view.scrollDOM.scrollTop,
    };
    thumb.classList.add("dragging");
    thumb.setPointerCapture(event.pointerId);
  });
  thumb.addEventListener("pointermove", (event) => {
    if (drag?.pointerId !== event.pointerId) {
      return;
    }
    const metrics = editorScrollbarMetrics(view);
    if (metrics === undefined || metrics.thumbTravel <= 0) {
      return;
    }
    event.preventDefault();
    view.scrollDOM.scrollTop = drag.startScrollTop +
      (event.clientY - drag.startY) * metrics.maxScroll / metrics.thumbTravel;
  });
  const finishDrag = (event: PointerEvent): void => {
    if (drag?.pointerId !== event.pointerId) {
      return;
    }
    drag = undefined;
    thumb.classList.remove("dragging");
    if (thumb.hasPointerCapture(event.pointerId)) {
      thumb.releasePointerCapture(event.pointerId);
    }
  };
  thumb.addEventListener("pointerup", finishDrag);
  thumb.addEventListener("pointercancel", finishDrag);
  thumb.addEventListener("lostpointercapture", () => {
    drag = undefined;
    thumb.classList.remove("dragging");
  });
  track.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target === thumb) {
      return;
    }
    event.preventDefault();
    const metrics = editorScrollbarMetrics(view);
    if (metrics === undefined || metrics.thumbTravel <= 0) {
      return;
    }
    const bounds = track.getBoundingClientRect();
    const desiredThumbTop = event.clientY - bounds.top - metrics.thumbHeight / 2;
    const normalized = Math.max(
      0,
      Math.min(metrics.thumbTravel, desiredThumbTop - metrics.inset),
    );
    view.scrollDOM.scrollTop = normalized / metrics.thumbTravel * metrics.maxScroll;
  });
  track.addEventListener("wheel", (event) => {
    event.preventDefault();
    view.scrollDOM.scrollBy({ top: event.deltaY, behavior: "auto" });
  }, { passive: false });
  track.addEventListener("keydown", (event) => {
    const scroller = view.scrollDOM;
    let next: number | undefined;
    switch (event.key) {
      case "ArrowUp":
        next = scroller.scrollTop - 48;
        break;
      case "ArrowDown":
        next = scroller.scrollTop + 48;
        break;
      case "PageUp":
        next = scroller.scrollTop - scroller.clientHeight * 0.9;
        break;
      case "PageDown":
        next = scroller.scrollTop + scroller.clientHeight * 0.9;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = scroller.scrollHeight;
        break;
    }
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    scroller.scrollTop = next;
  });
  view.scrollDOM.addEventListener("scroll", () => {
    scheduleEditorScrollbarUpdate(view);
    scheduleViewportRequest();
    scheduleSettledViewportRequest();
  }, { passive: true });
  editorScrollbarResizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => scheduleEditorScrollbarUpdate(view))
    : undefined;
  editorScrollbarResizeObserver?.observe(editorHost);
  editorScrollbarResizeObserver?.observe(view.scrollDOM);
  // The host and scroller keep a fixed viewport height while CodeMirror adds
  // visual structure widgets asynchronously. Observe the changing content and
  // sizer as well, otherwise the first calculation can see scrollHeight ===
  // clientHeight, hide the bar, and never be notified when the document grows.
  editorScrollbarResizeObserver?.observe(view.contentDOM);
  const sizer = view.scrollDOM.querySelector<HTMLElement>(".cm-sizer");
  if (sizer !== null) {
    editorScrollbarResizeObserver?.observe(sizer);
  }
  editorScrollbarMutationObserver?.disconnect();
  editorScrollbarMutationObserver = typeof MutationObserver === "function"
    ? new MutationObserver(() => scheduleEditorScrollbarUpdate(view))
    : undefined;
  editorScrollbarMutationObserver?.observe(view.contentDOM, {
    childList: true,
    subtree: true,
  });
  scheduleEditorScrollbarUpdate(view);
  // Structure widgets, SVG formulae and editor fonts settle over several
  // asynchronous layout passes. These bounded retries make the scrollbar
  // correct on first open even when none of those passes produces an editor
  // transaction (selection/input used to be the accidental refresh trigger).
  for (const delay of [0, 16, 64, 180, 480, 1_000]) {
    window.setTimeout(() => {
      if (editor !== view) {
        return;
      }
      view.requestMeasure();
      scheduleEditorScrollbarUpdate(view);
    }, delay);
  }
  void document.fonts?.ready.then(() => {
    if (editor === view) {
      view.requestMeasure();
      scheduleEditorScrollbarUpdate(view);
    }
  });
}

function editorScrollbarMetrics(view: EditorView): EditorScrollbarMetrics | undefined {
  const track = editorScrollbarTrack;
  if (track === undefined) {
    return undefined;
  }
  const inset = 3;
  const maxScroll = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
  const available = Math.max(0, track.clientHeight - inset * 2);
  if (maxScroll <= 1 || available <= 0) {
    return { inset, maxScroll, thumbHeight: available, thumbTravel: 0 };
  }
  const ratio = Math.min(1, view.scrollDOM.clientHeight / view.scrollDOM.scrollHeight);
  const thumbHeight = Math.min(available, Math.max(52, available * ratio));
  return {
    inset,
    maxScroll,
    thumbHeight,
    thumbTravel: Math.max(0, available - thumbHeight),
  };
}

function scheduleEditorScrollbarUpdate(view = editor): void {
  if (view === undefined || editorScrollbarFrame !== 0) {
    return;
  }
  editorScrollbarFrame = requestAnimationFrame(() => {
    editorScrollbarFrame = 0;
    updateEditorScrollbar(view);
  });
}

function updateEditorScrollbar(view: EditorView): void {
  const track = editorScrollbarTrack;
  const thumb = editorScrollbarThumb;
  const metrics = editorScrollbarMetrics(view);
  if (track === undefined || thumb === undefined || metrics === undefined) {
    return;
  }
  // Keep the document scrollbar present from the first paint. During initial
  // visual rendering the document can briefly report no overflow; displaying a
  // disabled full-height thumb avoids the bar appearing only after user input.
  track.hidden = false;
  if (metrics.thumbHeight <= 0) {
    return;
  }
  const scrollable = metrics.maxScroll > 1 && metrics.thumbTravel > 0;
  thumb.classList.toggle("disabled", !scrollable);
  track.setAttribute("aria-disabled", scrollable ? "false" : "true");
  const normalized = scrollable
    ? Math.max(0, Math.min(1, view.scrollDOM.scrollTop / metrics.maxScroll))
    : 0;
  const top = metrics.inset + normalized * metrics.thumbTravel;
  thumb.style.top = `${Math.round(top)}px`;
  thumb.style.height = `${Math.round(metrics.thumbHeight)}px`;
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", String(Math.round(metrics.maxScroll)));
  track.setAttribute("aria-valuenow", String(Math.round(view.scrollDOM.scrollTop)));
}

const MAX_VISUAL_PROTOCOL_EQUALITY_PAIRS = 250_000;

/**
 * Compare the acyclic, plain data received from the Extension Host without
 * serialising it into another pair of full-document strings. This is used only
 * for a same-revision acknowledgement of text that CodeMirror already owns.
 * Exceeding the bounded work budget safely falls back to the normal rebuild.
 */
function visualProtocolValueEqual(left: unknown, right: unknown): boolean {
  const pending: Array<readonly [unknown, unknown]> = [[left, right]];
  let compared = 0;
  while (pending.length > 0) {
    if ((compared += 1) > MAX_VISUAL_PROTOCOL_EQUALITY_PAIRS) {
      return false;
    }
    const [currentLeft, currentRight] = pending.pop()!;
    if (Object.is(currentLeft, currentRight)) {
      continue;
    }
    if (
      currentLeft === null ||
      currentRight === null ||
      typeof currentLeft !== "object" ||
      typeof currentRight !== "object"
    ) {
      return false;
    }
    const leftIsArray = Array.isArray(currentLeft);
    if (leftIsArray !== Array.isArray(currentRight)) {
      return false;
    }
    if (leftIsArray) {
      const leftItems = currentLeft as readonly unknown[];
      const rightItems = currentRight as readonly unknown[];
      if (leftItems.length !== rightItems.length) {
        return false;
      }
      for (let index = 0; index < leftItems.length; index += 1) {
        pending.push([leftItems[index], rightItems[index]]);
      }
      continue;
    }
    const leftRecord = currentLeft as Readonly<Record<string, unknown>>;
    const rightRecord = currentRight as Readonly<Record<string, unknown>>;
    const leftKeys = Object.keys(leftRecord);
    if (leftKeys.length !== Object.keys(rightRecord).length) {
      return false;
    }
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) {
        return false;
      }
      pending.push([leftRecord[key], rightRecord[key]]);
    }
  }
  return true;
}

function applyDocumentMessage(message: VisualDocumentHostMessage): void {
  if (
    message.type === "document" &&
    editor !== undefined &&
    (
      visualImeCompositionActive ||
      (editor.composing && !visualImeCompositionDomEnded)
    )
  ) {
    // Never rebuild formula/structure decorations around Chromium's live IME
    // composition range.  The exact snapshot is applied after compositionend.
    deferDocumentMessageUntilCompletionCloses(message);
    return;
  }
  if (
    message.type === "document" &&
    editor !== undefined &&
    message.revision > 0 &&
    (
      message.revision < clientRevision ||
      (
        message.revision === clientRevision &&
        message.text !== editor.state.doc.toString()
      )
    )
  ) {
    // The provider may have completed an expensive bibliography/image/math
    // snapshot just before a newer local edit (notably undo) invalidated it.
    // A posted Webview message cannot be recalled, so reject it again here.
    // A same-revision snapshot with different text is equally stale: every
    // accepted edit deterministically mirrors the exact Webview text. Revision
    // 0 remains reserved for genuine external/native-editor resets.
    return;
  }
  const preservesCompletionContext =
    message.type === "document" &&
    editor !== undefined &&
    message.revision === clientRevision &&
    message.text === editor.state.doc.toString();
  if (
    preservesCompletionContext &&
    editor !== undefined &&
    completionStatus(editor.state) !== null
  ) {
    deferDocumentMessageUntilCompletionCloses(message);
    return;
  }
  clearDeferredDocumentMessage();
  hideReferenceHover();
  applyEditorBackground(message.background);
  applySyntaxPalette(message.syntaxPalette);
  // A routine snapshot acknowledges the exact local text and revision while
  // refreshing formula/structure metadata. Building that snapshot can also
  // advance the project's index key, so the key alone must not cancel an
  // in-flight completion: otherwise the acknowledgement can arrive between
  // `startCompletion()` and a valid command, label, or bibliography result.
  // Genuine external project changes have their own
  // `projectContextInvalidated` message, while resolveCompletionResult still
  // performs strict revision, range, selection, and request-key checks.
  if (!preservesCompletionContext) {
    cancelPendingCompletionRequests();
    cancelPendingCompletionReferencePreviewRequests();
  }
  if (documentVersion !== message.version) {
    diagnosticInsights.clear();
  }
  documentVersion = message.version;
  clientRevision = message.revision;
  projectContextKey = message.projectContextKey;
  mathPreviewPlacement = message.mathPreviewPlacement;
  const activeBracketConfigurationChanged =
    inputFeatures.highlightActiveBracketPair !==
      message.inputFeatures.highlightActiveBracketPair;
  const compatibilityModeChanged = inputFeatures.compatibilityMode !== message.inputFeatures.compatibilityMode;
  assetGeneration = message.assetGeneration;
  inputFeatures = message.inputFeatures;
  const enhanced = inputFeatures.compatibilityMode === "maximum";
  requiredElement<HTMLButtonElement>("visual-mode-button").textContent = enhanced ? "增强可视化" : "标准可视化";
  requiredElement<HTMLButtonElement>("visual-mode-basic").setAttribute("aria-checked", String(!enhanced));
  requiredElement<HTMLButtonElement>("visual-mode-maximum").setAttribute("aria-checked", String(enhanced));
  if (editor !== undefined) {
    if (activeBracketConfigurationChanged) {
      editor.dispatch({
        effects: bracketMatchingCompartment.reconfigure(
          editorMode === "source" && inputFeatures.highlightActiveBracketPair
            ? bracketMatching()
            : [],
        ),
        annotations: hostSyncAnnotations,
      });
    }
    scheduleVisualActiveBracketHighlight(editor);
  }
  updateTemplateMenu(message.templates);
  updateEditorModeButton();
  updateCapabilities(message.capabilities);

  if (editor === undefined) {
    const explicitInitialFocus = message.initialFocus !== undefined;
    const initialSelection = adjustSelectionForCollapsedPreamble(
      clampSelection(
        visualInitialSelectionCandidate(
          persisted.selection,
          message.selection,
          explicitInitialFocus,
        ),
        message.text.length,
      ),
      message.structures,
      editorMode === "source" || persisted.preambleExpanded === true,
    );
    editor = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: message.text,
        selection: EditorSelection.single(
          initialSelection.anchor,
          initialSelection.head,
        ),
        extensions: createEditorExtensions(message.editable),
      }),
    });
    rememberVisualImeStableSelection(editor, true);
    syncEditorModeClass(editor);
    installPersistentEditorScrollbar(editor);
    editor.dispatch({
      effects: [
        setFormulaDocument.of({
          records: message.formulas,
          enabled: inputFeatures.mathPreviewEnabled,
          placement: mathPreviewPlacement,
        }),
        setFormulaVisualMode.of(editorMode === "visual"),
        setStructureDocument.of(message.structures),
        setStructureEnabled.of(editorMode === "visual"),
        setAiIssues.of(message.aiIssues),
        setDiagnostics.of(message.diagnostics),
        setNativeSyntaxTokens.of(message.syntaxTokens ?? []),
        setNativeBracketTokens.of({
          enabled: message.inputFeatures.bracketPairColorizationEnabled,
          tokens: message.bracketTokens ?? [],
        }),
      ],
      annotations: hostSyncAnnotations,
    });
    const queuedFocus = pendingHostFocus;
    pendingHostFocus = undefined;
    const initialReveal = queuedFocus ?? (
      message.initialFocus === undefined
        ? undefined
        : {
            selection: message.selection ?? initialSelection,
            options: message.initialFocus,
          }
    );
    if (initialReveal !== undefined) {
      revealSelection(initialReveal.selection, initialReveal.options);
      if (queuedFocus?.requestId !== undefined) {
        post({ protocol: VISUAL_EDITOR_PROTOCOL, type: "focusApplied", requestId: queuedFocus.requestId });
      }
    }
    requestAnimationFrame(() => {
      // A fresh visual tab must begin with the document actions visible. The
      // compact toolbar remains horizontally scrollable on narrow windows, but
      // a previously focused category must not make Compile/PDF/Save start
      // offscreen.
      toolbarElement.scrollLeft = 0;
      if (
        editor !== undefined &&
        initialReveal === undefined &&
        persisted.scrollTop !== undefined
      ) {
        editor.scrollDOM.scrollTop = Math.max(0, persisted.scrollTop);
      }
      // The user may have opened native source while this view initialized.
      if (document.hasFocus()) {
        editor?.focus();
      }
      scheduleViewportRequest();
      scheduleCursorPreviewRequest(editor);
    });
  } else {
    const currentText = editor.state.doc.toString();
    const currentFormula = editor.state.field(formulaField);
    const currentStructure = editor.state.field(structureField);
    const currentAiIssues = editor.state.field(aiIssueField);
    const currentDiagnostics = editor.state.field(diagnosticField);
    const visualModeEnabled = editorMode === "visual";
    // A same-revision acknowledgement follows a local CodeMirror transaction.
    // Its records have already been mapped above, so compare the inexpensive
    // protocol data and avoid rebuilding every formula/structure widget when
    // the authoritative parser confirms that the metadata did not change.
    const canReuseMappedMetadata = preservesCompletionContext;
    const formulaRecordsEqual = canReuseMappedMetadata && visualProtocolValueEqual(
      currentFormula.records,
      message.formulas,
    ) && visualFormulaAssetsHaveCurrentSource(
      message.text,
      message.formulas,
      currentFormula.rendered,
    );
    const structureRecordsEqual = canReuseMappedMetadata && visualProtocolValueEqual(
      currentStructure.records,
      message.structures,
    );
    const effects: StateEffect<unknown>[] = [];
    if (
      compatibilityModeChanged || !formulaRecordsEqual ||
      currentFormula.enabled !== inputFeatures.mathPreviewEnabled ||
      currentFormula.placement !== mathPreviewPlacement
    ) {
      effects.push(setFormulaDocument.of({
        resetRenders: compatibilityModeChanged,
        records: message.formulas,
        enabled: inputFeatures.mathPreviewEnabled,
        placement: mathPreviewPlacement,
      }));
    }
    if (currentFormula.visual !== visualModeEnabled) {
      effects.push(setFormulaVisualMode.of(visualModeEnabled));
    }
    if (!structureRecordsEqual) {
      effects.push(setStructureDocument.of(message.structures));
    }
    if (currentStructure.enabled !== visualModeEnabled) {
      effects.push(setStructureEnabled.of(visualModeEnabled));
    }
    if (editor.state.readOnly === message.editable) {
      effects.push(editableCompartment.reconfigure([
        EditorState.readOnly.of(!message.editable),
        EditorView.editable.of(message.editable),
      ]));
    }
    if (
      !canReuseMappedMetadata ||
      !visualProtocolValueEqual(currentAiIssues.issues, message.aiIssues)
    ) {
      effects.push(setAiIssues.of(message.aiIssues));
    }
    if (
      !canReuseMappedMetadata ||
      !visualProtocolValueEqual(currentDiagnostics.diagnostics, message.diagnostics)
    ) {
      effects.push(setDiagnostics.of(message.diagnostics));
    }
    // A routine visual edit intentionally omits full-document TextMate tokens.
    // nativeSyntaxField has already mapped its exact theme decorations through
    // the local transaction; preserving them avoids an expensive whole-paper
    // rebuild and prevents a brief uncoloured frame. Initial/theme/external
    // refreshes still replace the complete token set here.
    if (message.syntaxTokens !== undefined) {
      effects.push(setNativeSyntaxTokens.of(message.syntaxTokens));
    }
    effects.push(setNativeBracketTokens.of({
      enabled: message.inputFeatures.bracketPairColorizationEnabled,
      ...(message.bracketTokens === undefined
        ? {}
        : { tokens: message.bracketTokens }),
    }));
    if (currentText === message.text) {
      if (effects.length > 0) {
        editor.dispatch({ effects, annotations: hostSyncAnnotations });
      }
    } else {
      const change = visualSingleTextDifference(currentText, message.text);
      if (change === undefined) {
        return;
      }
      const changes = editor.state.changes(change);
      editor.dispatch({
        // Keep this as the smallest authoritative replacement and deliberately
        // map selections with right affinity. A Zotero key may extend the typed
        // query by inserting text exactly at its old end (`sato|}`); default
        // left affinity would strand the caret before that suffix. Positions
        // elsewhere remain attached to their surrounding text, including a
        // caret the user moved during the async export.
        changes,
        selection: editor.state.selection.map(changes, 1),
        effects,
        annotations: hostSyncAnnotations,
      });
    }
    scheduleViewportRequest();
    scheduleCursorPreviewRequest(editor);
  }
  if (editor !== undefined) {
    updateIssueCard(editor.state);
  }
  updateFormatDocumentButtonState();
  setStatus(
    "info",
    editorMode === "source"
      ? "同标签页源码模式；光标进入公式时显示 Math Preview。"
      : "所有受支持内容都会自动预览；点击预览即可编辑对应的 LaTeX 源码。",
    4_500,
  );
}

function applySyntaxTokenPatch(
  message: Extract<
    VisualEditorHostMessage,
    { readonly type: "syntaxTokenPatch" }
  >,
): void {
  if (
    editor === undefined ||
    visualImeCompositionActive ||
    (editor.composing && !visualImeCompositionDomEnded) ||
    message.revision !== clientRevision ||
    !Number.isSafeInteger(message.from) ||
    !Number.isSafeInteger(message.to) ||
    message.from < 0 ||
    message.to < message.from ||
    message.to > editor.state.doc.length ||
    editor.state.doc.sliceString(message.from, message.to) !==
      message.expectedText
  ) {
    return;
  }
  editor.dispatch({
    effects: patchNativeSyntaxTokens.of({
      from: message.from,
      to: message.to,
      tokens: message.tokens,
    }),
    annotations: hostSyncAnnotations,
  });
}

function applyBracketTokenPatch(
  message: Extract<
    VisualEditorHostMessage,
    { readonly type: "bracketTokenPatch" }
  >,
): void {
  if (
    editor === undefined ||
    visualImeCompositionActive ||
    (editor.composing && !visualImeCompositionDomEnded) ||
    !inputFeatures.bracketPairColorizationEnabled ||
    message.revision !== clientRevision ||
    !Number.isSafeInteger(message.from) ||
    !Number.isSafeInteger(message.to) ||
    message.from < 0 ||
    message.to < message.from ||
    message.to > editor.state.doc.length ||
    editor.state.doc.sliceString(message.from, message.to) !==
      message.expectedText
  ) {
    return;
  }
  editor.dispatch({
    effects: patchNativeBracketTokens.of({
      from: message.from,
      to: message.to,
      tokens: message.tokens,
    }),
    annotations: hostSyncAnnotations,
  });
}

function applyProjectContextInvalidatedMessage(nextProjectContextKey: string): void {
  if (nextProjectContextKey.length === 0 || nextProjectContextKey === projectContextKey) {
    return;
  }
  projectContextKey = nextProjectContextKey;
  clearDeferredDocumentMessage();
  invalidateCursorPreviewRequest();
  cancelPendingCompletionRequests();
  cancelPendingCompletionReferencePreviewRequests();
  if (editor !== undefined) {
    closeCompletion(editor);
    editor.dispatch({
      effects: clearFormulaCursorRender.of(null),
      annotations: hostSyncAnnotations,
    });
  }
  for (const pending of pendingVirtualCompletionRequests.values()) {
    clearTimeout(pending.timer);
  }
  pendingVirtualCompletionRequests.clear();
  closeVirtualCompletion();
  closeVirtualMathPreview();
  hideReferenceHover();
}

function deferDocumentMessageUntilCompletionCloses(
  message: VisualDocumentHostMessage,
): void {
  deferredDocumentMessage = message;
  if (deferredDocumentTimer !== undefined) {
    return;
  }
  deferredDocumentTimer = setTimeout(flushDeferredDocumentMessage, 40);
}

function flushDeferredDocumentMessage(): void {
  deferredDocumentTimer = undefined;
  const message = deferredDocumentMessage;
  if (message === undefined) {
    return;
  }
  if (
    editor !== undefined &&
    (
      visualImeCompositionActive ||
      (editor.composing && !visualImeCompositionDomEnded) ||
      completionStatus(editor.state) !== null
    )
  ) {
    deferredDocumentTimer = setTimeout(flushDeferredDocumentMessage, 40);
    return;
  }
  deferredDocumentMessage = undefined;
  applyDocumentMessage(message);
}

function clearDeferredDocumentMessage(): void {
  deferredDocumentMessage = undefined;
  if (deferredDocumentTimer !== undefined) {
    clearTimeout(deferredDocumentTimer);
    deferredDocumentTimer = undefined;
  }
}

function applyEditorBackground(background: VisualEditorBackground | undefined): void {
  editorBackground.classList.toggle("front", background?.useFront === true);
  editorHost.dataset.hasBackground = background === undefined ? "false" : "true";
  if (background === undefined) {
    editorBackground.style.removeProperty("background-image");
    editorBackground.style.removeProperty("background-position");
    editorBackground.style.removeProperty("background-size");
    editorBackground.style.removeProperty("background-repeat");
    editorBackground.style.removeProperty("opacity");
    return;
  }
  editorBackground.style.backgroundImage = `url(${JSON.stringify(background.imageUrl)})`;
  editorBackground.style.backgroundPosition = background.position;
  editorBackground.style.backgroundSize = background.size;
  editorBackground.style.backgroundRepeat = background.repeat;
  editorBackground.style.opacity = String(Math.min(1, Math.max(0, background.opacity)));
}

const SYNTAX_PALETTE_PROPERTIES = {
  comment: "--texleaf-syntax-comment",
  command: "--texleaf-syntax-command",
  keyword: "--texleaf-syntax-keyword",
  string: "--texleaf-syntax-string",
  atom: "--texleaf-syntax-atom",
  number: "--texleaf-syntax-number",
  variable: "--texleaf-syntax-variable",
  operator: "--texleaf-syntax-operator",
  punctuation: "--texleaf-syntax-punctuation",
  meta: "--texleaf-syntax-meta",
  link: "--texleaf-syntax-link",
  heading: "--texleaf-syntax-heading",
  invalid: "--texleaf-syntax-invalid",
} as const satisfies Record<keyof VisualEditorSyntaxPalette, string>;

function applySyntaxPalette(
  palette: VisualEditorSyntaxPalette | undefined,
): void {
  const root = document.documentElement.style;
  for (const [name, property] of Object.entries(SYNTAX_PALETTE_PROPERTIES) as Array<
    [keyof VisualEditorSyntaxPalette, string]
  >) {
    const color = palette?.[name];
    if (typeof color === "string" && /^#[0-9a-f]{3,8}$/iu.test(color)) {
      root.setProperty(property, color);
    } else {
      root.removeProperty(property);
    }
  }
}

function buildNativeSyntaxDecorations(
  tokens: readonly VisualEditorSyntaxToken[],
  documentLength: number,
): DecorationSet {
  return Decoration.set(
    nativeSyntaxDecorationRanges(tokens, documentLength),
    true,
  );
}

function buildNativeBracketDecorations(
  tokens: readonly VisualEditorBracketToken[],
  documentLength: number,
): DecorationSet {
  return Decoration.set(
    nativeBracketDecorationRanges(tokens, documentLength),
    true,
  );
}

function nativeBracketDecorationRanges(
  tokens: readonly VisualEditorBracketToken[],
  documentLength: number,
): readonly Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  for (const token of tokens) {
    const from = Math.max(0, Math.min(documentLength, token.from));
    const to = Math.max(from, Math.min(documentLength, token.to));
    if (
      from >= to ||
      to - from !== 1 ||
      !Number.isSafeInteger(token.depth) ||
      token.depth < 0
    ) {
      continue;
    }
    ranges.push(Decoration.mark({
      class: `texleaf-bracket-pair texleaf-bracket-depth-${token.depth % 6}`,
    }).range(from, to));
  }
  return ranges;
}

/**
 * Keep revealed formula source structurally flat while it is editable.
 * Chromium's Windows IME can corrupt a composition range when a full-formula
 * mark contains nested TextMate token marks, so the native token layer is
 * flattened into sibling marks only for formulas touched by the selection.
 */
function nativeSyntaxDecorationsForPresentation(
  base: DecorationSet,
  state: EditorState,
  imeRepairVersion = 0,
): DecorationSet {
  const formula = state.field(formulaField, false);
  if (formula === undefined || formula.records.length === 0) {
    return base;
  }
  const active = selectedFormulaRecords(state, formula.records);
  if (active.length === 0) {
    return base;
  }
  const activeRanges = active.flatMap((record) =>
    activeFormulaSyntaxDecorationRanges(base, record, imeRepairVersion)
  );
  return base.update({
    filter: (from, to) => !active.some((record) =>
      from < record.to && to > record.from
    ),
    add: activeRanges,
    sort: true,
  });
}

interface NativeSyntaxSegment {
  readonly from: number;
  readonly to: number;
  readonly decoration: Decoration;
}

function activeFormulaSyntaxDecorationRanges(
  base: DecorationSet,
  record: VisualFormulaRecord,
  imeRepairVersion = 0,
): readonly Range<Decoration>[] {
  const segments: NativeSyntaxSegment[] = [];
  const boundaries = new Set<number>([record.from, record.to]);
  base.between(record.from, record.to, (from, to, decoration) => {
    const clippedFrom = Math.max(record.from, from);
    const clippedTo = Math.min(record.to, to);
    if (clippedFrom >= clippedTo) {
      return;
    }
    const classes = typeof decoration.spec.class === "string"
      ? decoration.spec.class
      : "";
    if (!classes.includes("texleaf-native-syntax-token")) {
      return;
    }
    segments.push({ from: clippedFrom, to: clippedTo, decoration });
    boundaries.add(clippedFrom);
    boundaries.add(clippedTo);
  });

  const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
  const ranges: Range<Decoration>[] = [];
  for (let index = 0; index + 1 < sortedBoundaries.length; index += 1) {
    const from = sortedBoundaries[index]!;
    const to = sortedBoundaries[index + 1]!;
    if (from >= to) {
      continue;
    }
    const candidates = segments.filter((segment) =>
      segment.from <= from && segment.to >= to
    );
    candidates.sort((left, right) => {
      const leftClasses = String(left.decoration.spec.class ?? "");
      const rightClasses = String(right.decoration.spec.class ?? "");
      const optimisticDifference = Number(
        rightClasses.includes("texleaf-native-syntax-optimistic"),
      ) - Number(leftClasses.includes("texleaf-native-syntax-optimistic"));
      return optimisticDifference !== 0
        ? optimisticDifference
        : (left.to - left.from) - (right.to - right.from);
    });
    const token = candidates[0]?.decoration;
    const tokenClasses = typeof token?.spec.class === "string"
      ? token.spec.class
      : "";
    const tokenAttributes = token?.spec.attributes as
      | Readonly<Record<string, string>>
      | undefined;
    ranges.push(Decoration.mark({
      class: ["texleaf-formula-source-active", tokenClasses]
        .filter((value) => value.length > 0)
        .join(" "),
      attributes: {
        ...(tokenAttributes ?? {}),
        ...formulaSourceAttributes(record),
        "data-texleaf-ime-repair-version": String(imeRepairVersion),
      },
    }).range(from, to));
  }
  return ranges;
}

function visualFormulaDomSource(
  view: EditorView,
  record: VisualFormulaRecord,
): string | undefined {
  const matching = Array.from(
    view.contentDOM.querySelectorAll<HTMLElement>(
      ".texleaf-formula-source-active[data-texleaf-formula-from]",
    ),
  ).filter((element) =>
    Number(element.dataset.texleafFormulaFrom) === record.from &&
    Number(element.dataset.texleafFormulaTo) === record.to
  );
  const first = matching[0];
  const last = matching.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    !first.isConnected ||
    !last.isConnected
  ) {
    return undefined;
  }
  const range = view.contentDOM.ownerDocument.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  return range.toString();
}

function visualImeFormulaRecord(
  view: EditorView,
  session: VisualImeCompositionSession,
): VisualFormulaRecord | undefined {
  const records = view.state.field(formulaField, false)?.records ?? [];
  const anchor = Math.max(0, Math.min(view.state.doc.length, session.from));
  return records
    .filter((record) => anchor >= record.from && anchor <= record.to)
    .sort((left, right) =>
      (left.to - left.from) - (right.to - right.from) || left.from - right.from
    )[0];
}

function scheduleVisualImeFormulaPresentationRepair(
  view: EditorView,
  session: VisualImeCompositionSession | undefined,
): void {
  if (session === undefined) {
    return;
  }
  let attempts = 0;
  const inspect = (): void => {
    if (
      editor !== view ||
      visualImeCompositionActive ||
      view.composing
    ) {
      return;
    }
    const record = visualImeFormulaRecord(view, session);
    if (record === undefined) {
      return;
    }
    const domSource = visualFormulaDomSource(view, record);
    const stateSource = view.state.sliceDoc(record.from, record.to);
    if (domSource === undefined || domSource === stateSource) {
      return;
    }
    attempts += 1;
    view.dispatch({
      effects: repairVisualImeFormulaPresentation.of(
        ++visualImePresentationRepairSequence,
      ),
      annotations: hostSyncAnnotations,
    });
    view.requestMeasure();
    if (attempts < 2) {
      requestAnimationFrame(inspect);
    }
  };
  requestAnimationFrame(inspect);
}

function beginVisualImeComposition(view: EditorView): void {
  if (visualImeCompositionFinalizeTimer !== undefined) {
    clearTimeout(visualImeCompositionFinalizeTimer);
    visualImeCompositionFinalizeTimer = undefined;
  }
  let source: string | undefined;
  if (!visualImeCompositionActive) {
    source = view.state.doc.toString();
    visualImeCompositionBeforeText = source;
  }
  if (!visualImeCompositionActive || visualImeCompositionDomEnded) {
    const selection = visualImeCompositionStartRange(view);
    source ??= view.state.doc.toString();
    visualImeCompositionSession = {
      from: selection.from,
      to: selection.to,
      prefix: source.slice(0, selection.from),
      suffix: source.slice(selection.to),
      eventText: undefined,
      pendingInputIntent: undefined,
    };
  }
  visualImeCompositionDomEnded = false;
  visualImeCompositionActive = true;
  cancelPendingInputRequests();
  cancelPendingCompletionRequests();
  cancelPendingCompletionReferencePreviewRequests();
  invalidateCursorPreviewRequest();
  hideReferenceHover();
}

function rememberVisualImeStableSelection(
  view: EditorView,
  allowNonEmpty = false,
): void {
  if (visualImeCompositionActive || view.composing) {
    return;
  }
  const selection = view.state.selection.main;
  if (!selection.empty && !allowNonEmpty) {
    return;
  }
  visualImeStableSelection = {
    doc: view.state.doc,
    from: selection.from,
    to: selection.to,
  };
}

function visualImeCompositionStartRange(
  view: EditorView,
): { readonly from: number; readonly to: number } {
  const current = view.state.selection.main;
  const stable = visualImeStableSelection?.doc === view.state.doc
    ? visualImeStableSelection
    : undefined;
  const pointerCaret = visualImePointerCaret?.doc === view.state.doc
    ? visualImePointerCaret.position
    : undefined;
  const nativeDomCaret = collapsedVisualImeDomCaret(view);
  return resolveVisualImeCompositionStartRange(
    view.state.doc.length,
    current.from,
    current.to,
    stable?.from,
    stable?.to,
    pointerCaret,
    nativeDomCaret,
  ) ?? { from: current.from, to: current.to };
}

/** Map Chromium's live collapsed selection back to immutable TeX source. */
function collapsedVisualImeDomCaret(view: EditorView): number | undefined {
  const selection = view.contentDOM.ownerDocument.getSelection();
  const anchorNode = selection?.anchorNode;
  if (
    selection === null ||
    selection === undefined ||
    !selection.isCollapsed ||
    anchorNode === null ||
    anchorNode === undefined ||
    !view.contentDOM.contains(anchorNode)
  ) {
    return undefined;
  }

  const formulaElement = anchorNode.nodeType === Node.ELEMENT_NODE
    ? (anchorNode as Element).closest<HTMLElement>(
        ".texleaf-formula-source-active",
      )
    : anchorNode.parentElement?.closest<HTMLElement>(
        ".texleaf-formula-source-active",
      );
  const formulaFrom = Number(formulaElement?.dataset.texleafFormulaFrom);
  if (formulaElement !== undefined && Number.isSafeInteger(formulaFrom)) {
    const matching = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(
      ".texleaf-formula-source-active",
    )).filter((candidate) =>
      Number(candidate.dataset.texleafFormulaFrom) === formulaFrom
    );
    const first = matching[0];
    const last = matching.at(-1);
    const formulaTo = matching.reduce(
      (maximum, candidate) => Math.max(
        maximum,
        Number(candidate.dataset.texleafFormulaTo) || maximum,
      ),
      formulaFrom,
    );
    if (
      first !== undefined &&
      last !== undefined &&
      formulaFrom >= 0 &&
      formulaTo >= formulaFrom &&
      formulaTo <= view.state.doc.length
    ) {
      const document = view.contentDOM.ownerDocument;
      const formulaRange = document.createRange();
      formulaRange.setStartBefore(first);
      formulaRange.setEndAfter(last);
      if (formulaRange.toString() === view.state.sliceDoc(formulaFrom, formulaTo)) {
        const caretRange = document.createRange();
        caretRange.setStartBefore(first);
        try {
          caretRange.setEnd(anchorNode, selection.anchorOffset);
          const position = formulaFrom + caretRange.toString().length;
          if (position >= formulaFrom && position <= formulaTo) {
            return position;
          }
        } catch {
          // Fall through to CodeMirror's generic mapping below.
        }
      }
    }
  }
  try {
    const position = view.posAtDOM(anchorNode, selection.anchorOffset);
    return Math.max(0, Math.min(view.state.doc.length, position));
  } catch {
    return undefined;
  }
}

function updateVisualImeCompositionText(event: Event): void {
  if (!visualImeCompositionActive || visualImeCompositionSession === undefined) {
    return;
  }
  if (event instanceof InputEvent) {
    visualImeCompositionSession.pendingInputIntent =
      mergeVisualImeCompositionInputIntent(
        visualImeCompositionSession.pendingInputIntent,
        event.inputType,
        undefined,
      );
    // InputEvent.data is not consistently the complete Pinyin candidate. Some
    // Chromium builds report only the newest letter here. Keep it solely as a
    // first-update fallback; CompositionEvent.data below is authoritative.
    if (
      visualImeCompositionSession.eventText === undefined &&
      event.data !== null
    ) {
      visualImeCompositionSession.eventText = event.data;
    }
    return;
  }
  if (event instanceof CompositionEvent) {
    visualImeCompositionSession.eventText = event.data;
  }
}

function finishVisualImeComposition(view: EditorView): void {
  if (visualImeCompositionFinalizeTimer !== undefined) {
    clearTimeout(visualImeCompositionFinalizeTimer);
  }
  // `compositionend` is authoritative for keyboard behavior. CodeMirror may
  // keep `view.composing` true until its mutation observer settles, but normal
  // letters and Backspace pressed after this point must already behave as
  // ordinary editor input.
  visualImeCompositionDomEnded = true;
  let settleAttempts = 0;
  const finalize = (): void => {
    visualImeCompositionFinalizeTimer = undefined;
    if (editor !== view) {
      visualImeCompositionActive = false;
      visualImeCompositionDomEnded = true;
      visualImeCompositionBeforeText = undefined;
      visualImeCompositionSession = undefined;
      visualImeStableSelection = undefined;
      deferredImeHostMessages.length = 0;
      return;
    }
    if (view.composing && settleAttempts < 12) {
      settleAttempts += 1;
      visualImeCompositionFinalizeTimer = setTimeout(finalize, 16);
      return;
    }

    const beforeText = visualImeCompositionBeforeText;
    const completedSession = visualImeCompositionSession;
    visualImeCompositionBeforeText = undefined;
    visualImeCompositionActive = false;
    visualImeCompositionSession = undefined;
    if (beforeText !== undefined) {
      synchronizeVisualEnvironmentNamesAfterComposition(view, beforeText);
    }
    rememberVisualImeStableSelection(view);

    // Apply the newest exact document acknowledgement before auxiliary render
    // responses. Revision/text guards discard anything made stale by the final
    // composition transaction or environment-name reconciliation.
    flushDeferredDocumentMessage();
    const pending = deferredImeHostMessages.splice(0);
    for (const message of pending) {
      handleHostMessage(message);
    }
    scheduleVisualImeFormulaPresentationRepair(view, completedSession);
    scheduleCursorPreviewRequest(view);
    scheduleVisualActiveBracketHighlight(view);
    if (
      view.state.selection.main.from === view.state.selection.main.head
    ) {
      // ASCII triggers such as `lm` may be committed by a Chinese IME. Expand
      // only after the native composition range and every provisional update
      // have fully settled.
      requestInput(view, "auto");
    }
  };
  visualImeCompositionFinalizeTimer = setTimeout(finalize, 0);
}

function visualImeOwnsKeyboardInput(view: EditorView): boolean {
  return !visualImeCompositionDomEnded &&
    (visualImeCompositionActive || view.composing);
}

function nativeSyntaxDecorationRanges(
  tokens: readonly VisualEditorSyntaxToken[],
  documentLength: number,
): readonly Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  for (const token of tokens) {
    const from = Math.max(0, Math.min(documentLength, token.from));
    const to = Math.max(from, Math.min(documentLength, token.to));
    if (from >= to) {
      continue;
    }
    const style = nativeSyntaxTokenStyle(token);
    if (style.length === 0) {
      continue;
    }
    ranges.push(Decoration.mark({
      class: "texleaf-native-syntax-token",
      attributes: { style },
    }).range(from, to));
  }
  return ranges;
}

function nativeSyntaxTokenStyle(token: VisualEditorSyntaxToken): string {
  const declarations: string[] = [];
  if (isSanitizedSyntaxColor(token.foreground)) {
    declarations.push(`--texleaf-native-foreground:${token.foreground}`);
  }
  declarations.push(
    `--texleaf-native-font-style:${(token.fontStyle & 1) !== 0 ? "italic" : "normal"}`,
    `--texleaf-native-font-weight:${(token.fontStyle & 2) !== 0 ? "700" : "400"}`,
  );
  const textDecorations: string[] = [];
  if ((token.fontStyle & 4) !== 0) {
    textDecorations.push("underline");
  }
  if ((token.fontStyle & 8) !== 0) {
    textDecorations.push("line-through");
  }
  declarations.push(
    `--texleaf-native-decoration:${textDecorations.length > 0 ? textDecorations.join(" ") : "none"}`,
  );
  return declarations.join(";");
}

type OptimisticNativeSyntaxKind =
  | "comment"
  | "command"
  | "number"
  | "operator"
  | "punctuation"
  | "variable";

function optimisticNativeSyntaxDecorationRanges(
  decorations: DecorationSet,
  transaction: Transaction,
): readonly Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  transaction.changes.iterChanges(
    (_fromA, _toA, fromB, toB) => {
      if (fromB >= toB) {
        return;
      }
      const kind = optimisticNativeSyntaxKind(transaction.state, fromB, toB);
      const style = kind === undefined
        ? nearestNativeSyntaxTokenStyle(
            decorations,
            fromB,
            toB,
            transaction.state.doc.length,
          ) ?? optimisticNativeSyntaxStyle("variable")
        : optimisticNativeSyntaxStyle(kind);
      ranges.push(Decoration.mark({
        class: "texleaf-native-syntax-token texleaf-native-syntax-optimistic",
        attributes: { style },
      }).range(fromB, toB));
    },
    true,
  );
  return ranges;
}

function optimisticNativeSyntaxKind(
  state: EditorState,
  from: number,
  to: number,
): OptimisticNativeSyntaxKind | undefined {
  const inserted = state.sliceDoc(from, to);
  const line = state.doc.lineAt(from);
  const prefix = line.text.slice(0, from - line.from);
  if (latexLineHasOpenComment(prefix) || inserted.startsWith("%")) {
    return "comment";
  }
  if (
    inserted.includes("\\") ||
    /\\[A-Za-z@]*$/u.test(prefix)
  ) {
    return "command";
  }
  if (/^[0-9.]+$/u.test(inserted)) {
    return "number";
  }
  if (/^[{}[\]()]$/u.test(inserted)) {
    return "punctuation";
  }
  if (/^[_^&=+*/<>|,:;!-]+$/u.test(inserted)) {
    return "operator";
  }
  return undefined;
}

function latexLineHasOpenComment(prefix: string): boolean {
  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    if (prefix[index] !== "%") {
      continue;
    }
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && prefix[cursor] === "\\"; cursor -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) {
      return true;
    }
  }
  return false;
}

function nearestNativeSyntaxTokenStyle(
  decorations: DecorationSet,
  from: number,
  to: number,
  documentLength: number,
): string | undefined {
  let containing: string | undefined;
  let left: { readonly distance: number; readonly style: string } | undefined;
  let right: { readonly distance: number; readonly style: string } | undefined;
  decorations.between(
    Math.max(0, from - 2),
    Math.min(documentLength, to + 2),
    (tokenFrom, tokenTo, decoration) => {
      const classes = typeof decoration.spec.class === "string"
        ? decoration.spec.class
        : "";
      const attributes = decoration.spec.attributes as
        | Readonly<Record<string, unknown>>
        | undefined;
      const style = typeof attributes?.style === "string"
        ? attributes.style
        : undefined;
      if (!classes.includes("texleaf-native-syntax-token") || style === undefined) {
        return;
      }
      if (tokenFrom <= from && tokenTo >= to) {
        containing = style;
        return;
      }
      if (tokenTo <= from) {
        const distance = from - tokenTo;
        if (left === undefined || distance < left.distance) {
          left = { distance, style };
        }
      }
      if (tokenFrom >= to) {
        const distance = tokenFrom - to;
        if (right === undefined || distance < right.distance) {
          right = { distance, style };
        }
      }
    },
  );
  return containing ?? left?.style ?? right?.style;
}

function optimisticNativeSyntaxStyle(kind: OptimisticNativeSyntaxKind): string {
  const fallback = kind === "comment"
    ? "var(--vscode-descriptionForeground, var(--vscode-editor-foreground))"
    : kind === "command"
      ? "var(--vscode-textLink-foreground, var(--vscode-editor-foreground))"
      : kind === "number"
        ? "var(--vscode-editorWarning-foreground, var(--vscode-editor-foreground))"
        : "var(--vscode-editor-foreground)";
  return [
    `--texleaf-native-foreground:var(--texleaf-syntax-${kind}, ${fallback})`,
    `--texleaf-native-font-style:${kind === "comment" ? "italic" : "normal"}`,
    "--texleaf-native-font-weight:400",
    "--texleaf-native-decoration:none",
  ].join(";");
}

function isSanitizedSyntaxColor(value: string | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-f]{3,8}$/iu.test(value);
}

const VISUAL_SEARCH_MATCH_LIMIT = 10_000;
const VISUAL_SEARCH_SELECT_LIMIT = 1_000;

/**
 * A compact source-aware search panel for the visual editor.
 *
 * Formula widgets only replace CodeMirror's presentation—the authoritative
 * LaTeX source remains in EditorState.doc. Selecting the first source match as
 * soon as a query is committed therefore reuses the existing formula/structure
 * reveal logic and makes a hidden match immediately visible.
 */
class VisualLatexSearchPanel implements Panel {
  public readonly dom: HTMLElement;
  public readonly top = true;

  private readonly searchInput: HTMLInputElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly replaceRow: HTMLDivElement;
  private readonly replaceToggle: HTMLButtonElement;
  private readonly status: HTMLSpanElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly selectAllButton: HTMLButtonElement;
  private readonly replaceButton: HTMLButtonElement;
  private readonly replaceAllButton: HTMLButtonElement;
  private readonly caseButton: HTMLButtonElement;
  private readonly wordButton: HTMLButtonElement;
  private readonly regexpButton: HTMLButtonElement;
  private searchOrigin: number;

  private query: SearchQuery;
  private caseSensitive = false;
  private wholeWord = false;
  private regexp = false;
  private searchComposing = false;
  private replaceComposing = false;
  private statusFrame = 0;
  private readOnly: boolean;
  private matchCache: {
    readonly doc: EditorState["doc"];
    readonly query: SearchQuery;
    readonly ranges: readonly { readonly from: number; readonly to: number }[];
    readonly capped: boolean;
  } | undefined;

  public constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.caseSensitive = this.query.caseSensitive;
    this.wholeWord = this.query.wholeWord;
    this.regexp = this.query.regexp;
    this.searchOrigin = view.state.selection.main.head;
    this.readOnly = view.state.readOnly;

    this.dom = document.createElement("div");
    this.dom.className = "texleaf-search-panel";
    this.dom.setAttribute("role", "search");
    this.dom.setAttribute("aria-label", "查找和替换 LaTeX 源码");

    const findRow = document.createElement("div");
    findRow.className = "texleaf-search-row texleaf-search-find-row";

    this.replaceToggle = visualSearchButton(
      "展开替换",
      "›",
      "texleaf-search-icon texleaf-search-expand",
      "toggleReplace",
    );
    this.replaceToggle.setAttribute("aria-expanded", "false");

    const searchField = document.createElement("label");
    searchField.className = "texleaf-search-field";
    this.searchInput = document.createElement("input");
    this.searchInput.type = "text";
    this.searchInput.name = "search";
    this.searchInput.value = this.query.search;
    this.searchInput.placeholder = "查找 LaTeX 源码";
    this.searchInput.autocomplete = "off";
    this.searchInput.spellcheck = false;
    this.searchInput.setAttribute("main-field", "true");
    this.searchInput.setAttribute("aria-label", "查找 LaTeX 源码");
    this.searchInput.title = "普通模式按 LaTeX 源码原样匹配；开启正则后使用正则语法";
    this.status = document.createElement("span");
    this.status.className = "texleaf-search-status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.status.setAttribute("aria-atomic", "true");
    searchField.append(this.searchInput, this.status);

    const flags = document.createElement("div");
    flags.className = "texleaf-search-flags";
    this.caseButton = visualSearchButton(
      "区分大小写（Alt+C）",
      "Aa",
      "texleaf-search-flag",
      "case",
    );
    this.wordButton = visualSearchButton(
      "全字匹配（Alt+W）",
      "W",
      "texleaf-search-flag",
      "word",
    );
    this.regexpButton = visualSearchButton(
      "使用正则表达式（Alt+R）",
      ".*",
      "texleaf-search-flag",
      "regexp",
    );
    flags.append(this.caseButton, this.wordButton, this.regexpButton);

    this.previousButton = visualSearchButton(
      "上一个匹配（Shift+Enter）",
      "↑",
      "texleaf-search-icon",
      "previous",
    );
    this.nextButton = visualSearchButton(
      "下一个匹配（Enter）",
      "↓",
      "texleaf-search-icon",
      "next",
    );
    this.selectAllButton = visualSearchButton(
      "选择全部匹配",
      "全选",
      "texleaf-search-text-button",
      "selectAll",
    );
    const closeButton = visualSearchButton(
      "关闭查找（Escape）",
      "×",
      "texleaf-search-icon texleaf-search-close",
      "close",
    );
    findRow.append(
      this.replaceToggle,
      searchField,
      flags,
      this.previousButton,
      this.nextButton,
      this.selectAllButton,
      closeButton,
    );

    this.replaceRow = document.createElement("div");
    this.replaceRow.className = "texleaf-search-row texleaf-search-replace-row";
    this.replaceRow.hidden = true;
    const replaceField = document.createElement("label");
    replaceField.className = "texleaf-search-field texleaf-search-replace-field";
    this.replaceInput = document.createElement("input");
    this.replaceInput.type = "text";
    this.replaceInput.name = "replace";
    this.replaceInput.value = this.query.replace;
    this.replaceInput.placeholder = "替换为 LaTeX 源码";
    this.replaceInput.autocomplete = "off";
    this.replaceInput.spellcheck = false;
    this.replaceInput.setAttribute("aria-label", "替换为 LaTeX 源码");
    replaceField.append(this.replaceInput);
    this.replaceButton = visualSearchButton(
      "替换当前匹配（Enter）",
      "替换",
      "texleaf-search-text-button",
      "replace",
    );
    this.replaceAllButton = visualSearchButton(
      "替换全部匹配",
      "全部替换",
      "texleaf-search-text-button",
      "replaceAll",
    );
    this.replaceRow.append(replaceField, this.replaceButton, this.replaceAllButton);
    this.dom.append(findRow, this.replaceRow);

    if (this.readOnly) {
      this.replaceToggle.hidden = true;
    } else if (this.query.replace.length > 0) {
      this.setReplaceExpanded(true);
    }

    this.syncFlagButtons();
    this.wireEvents(closeButton);
    this.updateControlAvailability(this.query, false);
    this.scheduleStatusUpdate();
  }

  public mount(): void {
    this.searchInput.select();
  }

  public update(update: ViewUpdate): void {
    for (const transaction of update.transactions) {
      this.searchOrigin = transaction.changes.mapPos(this.searchOrigin, 1);
    }
    const external = getSearchQuery(update.state);
    const queryChanged = !sameVisualSearchQuery(external, this.query);
    const searchSemanticsChanged = !sameVisualSearchSemantics(external, this.query);
    if (queryChanged) {
      this.query = external;
      this.searchInput.value = external.search;
      this.replaceInput.value = external.replace;
      this.caseSensitive = external.caseSensitive;
      this.wholeWord = external.wholeWord;
      this.regexp = external.regexp;
      this.syncFlagButtons();
      this.updateControlAvailability(external, false);
    }
    const readOnlyChanged = this.readOnly !== update.state.readOnly;
    if (readOnlyChanged) {
      this.readOnly = update.state.readOnly;
      this.replaceToggle.hidden = this.readOnly;
      if (this.readOnly) {
        this.setReplaceExpanded(false);
      }
      this.updateControlAvailability(external, false);
    }
    if (update.docChanged || searchSemanticsChanged) {
      this.matchCache = undefined;
    }
    if (update.docChanged || update.selectionSet || queryChanged || readOnlyChanged) {
      this.scheduleStatusUpdate();
    }
  }

  public destroy(): void {
    if (this.statusFrame !== 0) {
      cancelAnimationFrame(this.statusFrame);
      this.statusFrame = 0;
    }
  }

  private wireEvents(closeButton: HTMLButtonElement): void {
    this.searchInput.addEventListener("compositionstart", () => {
      this.searchComposing = true;
    });
    this.searchInput.addEventListener("compositionend", () => {
      this.searchComposing = false;
      this.commitQuery(true);
    });
    this.searchInput.addEventListener("input", () => {
      if (!this.searchComposing) {
        this.commitQuery(true);
      }
    });
    this.replaceInput.addEventListener("compositionstart", () => {
      this.replaceComposing = true;
    });
    this.replaceInput.addEventListener("compositionend", () => {
      this.replaceComposing = false;
      this.commitQuery(false);
    });
    this.replaceInput.addEventListener("input", () => {
      if (!this.replaceComposing) {
        this.commitQuery(false);
      }
    });

    this.replaceToggle.addEventListener("click", () => {
      this.setReplaceExpanded(this.replaceRow.hidden);
    });
    this.caseButton.addEventListener("click", () => this.toggleFlag("case"));
    this.wordButton.addEventListener("click", () => this.toggleFlag("word"));
    this.regexpButton.addEventListener("click", () => this.toggleFlag("regexp"));
    this.previousButton.addEventListener("click", () => {
      findPrevious(this.view);
      this.scheduleStatusUpdate();
    });
    this.nextButton.addEventListener("click", () => {
      findNext(this.view);
      this.scheduleStatusUpdate();
    });
    this.selectAllButton.addEventListener("click", () => {
      selectMatches(this.view);
      this.scheduleStatusUpdate();
    });
    this.replaceButton.addEventListener("click", () => {
      this.commitQuery(false);
      replaceNext(this.view);
      this.scheduleStatusUpdate();
    });
    this.replaceAllButton.addEventListener("click", () => {
      this.commitQuery(false);
      replaceAll(this.view);
      this.scheduleStatusUpdate();
    });
    closeButton.addEventListener("click", () => closeSearchPanel(this.view));
    this.dom.addEventListener("keydown", (event) => this.handleKeydown(event));
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (
      event.isComposing ||
      event.key === "Process" ||
      event.keyCode === 229 ||
      this.searchComposing ||
      this.replaceComposing
    ) {
      return;
    }
    if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault();
      event.stopPropagation();
      this.scheduleStatusUpdate();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearchPanel(this.view);
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const key = event.key.toLowerCase();
      const flag = key === "c" ? "case" : key === "w" ? "word" : key === "r" ? "regexp" : undefined;
      if (flag !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        this.toggleFlag(flag);
        return;
      }
    }
    if (event.key !== "Enter") {
      return;
    }
    if (event.target === this.searchInput) {
      event.preventDefault();
      event.stopPropagation();
      (event.shiftKey ? findPrevious : findNext)(this.view);
      this.scheduleStatusUpdate();
    } else if (event.target === this.replaceInput) {
      event.preventDefault();
      event.stopPropagation();
      this.commitQuery(false);
      replaceNext(this.view);
      this.scheduleStatusUpdate();
    }
  }

  private toggleFlag(flag: "case" | "word" | "regexp"): void {
    if (flag === "case") {
      this.caseSensitive = !this.caseSensitive;
    } else if (flag === "word") {
      this.wholeWord = !this.wholeWord;
    } else {
      this.regexp = !this.regexp;
    }
    this.syncFlagButtons();
    this.commitQuery(true);
    this.searchInput.focus({ preventScroll: true });
  }

  private syncFlagButtons(): void {
    setVisualSearchPressed(this.caseButton, this.caseSensitive);
    setVisualSearchPressed(this.wordButton, this.wholeWord);
    setVisualSearchPressed(this.regexpButton, this.regexp);
  }

  private setReplaceExpanded(expanded: boolean): void {
    this.replaceRow.hidden = !expanded;
    this.replaceToggle.setAttribute("aria-expanded", String(expanded));
    this.replaceToggle.textContent = expanded ? "⌄" : "›";
    this.replaceToggle.setAttribute("aria-label", expanded ? "收起替换" : "展开替换");
    this.replaceToggle.title = expanded ? "收起替换" : "展开替换";
    if (expanded) {
      this.replaceInput.focus({ preventScroll: true });
    }
  }

  private queryFromControls(): SearchQuery {
    return new SearchQuery(visualLatexSearchQuerySpec({
      search: this.searchInput.value,
      replace: this.replaceInput.value,
      caseSensitive: this.caseSensitive,
      regexp: this.regexp,
      wholeWord: this.wholeWord,
    }));
  }

  private commitQuery(navigate: boolean): void {
    const previous = this.query;
    const next = this.queryFromControls();
    const searchChanged = !sameVisualSearchSemantics(previous, next);
    if (!sameVisualSearchQuery(previous, next)) {
      this.query = next;
      this.view.dispatch({ effects: setSearchQuery.of(next) });
    }
    this.updateControlAvailability(next, false);
    if (navigate && searchChanged && next.search.length > 0 && next.valid) {
      this.selectInitialMatch(next);
    }
    this.scheduleStatusUpdate();
  }

  private selectInitialMatch(query: SearchQuery): void {
    if (this.summarizeMatches(query).current > 0) {
      return;
    }
    const match = firstVisualSearchMatch(this.view.state, query, this.searchOrigin);
    if (match === undefined) {
      return;
    }
    const selection = EditorSelection.range(match.from, match.to);
    this.view.dispatch({
      selection,
      effects: EditorView.scrollIntoView(selection, { y: "center" }),
      userEvent: "select.search",
    });
  }

  private scheduleStatusUpdate(): void {
    if (this.statusFrame !== 0) {
      return;
    }
    this.statusFrame = requestAnimationFrame(() => {
      this.statusFrame = 0;
      this.updateStatus();
    });
  }

  private updateStatus(): void {
    const query = getSearchQuery(this.view.state);
    if (query.search.length === 0) {
      this.status.textContent = "";
      this.status.title = "";
      this.dom.dataset.searchState = "idle";
      this.searchInput.removeAttribute("aria-invalid");
      this.updateControlAvailability(query, false);
      return;
    }
    if (!query.valid) {
      this.status.textContent = "正则无效";
      this.status.title = "正则表达式无效";
      this.dom.dataset.searchState = "invalid";
      this.searchInput.setAttribute("aria-invalid", "true");
      this.updateControlAvailability(query, false);
      return;
    }
    this.searchInput.removeAttribute("aria-invalid");
    const summary = this.summarizeMatches(query);
    if (summary.total === 0) {
      this.status.textContent = "无结果";
      this.status.title = "没有匹配的 LaTeX 源码";
      this.dom.dataset.searchState = "not-found";
      this.updateControlAvailability(query, false);
      return;
    }
    const total = summary.capped ? `${summary.total}+` : String(summary.total);
    this.status.textContent = summary.current > 0
      ? `${summary.current} / ${total}`
      : `${total} 个结果`;
    this.status.title = summary.capped
      ? `至少 ${summary.total} 个匹配`
      : summary.current > 0
        ? `第 ${summary.current} 个，共 ${summary.total} 个匹配`
        : `共 ${summary.total} 个匹配`;
    this.dom.dataset.searchState = "matched";
    this.updateControlAvailability(
      query,
      true,
      !summary.capped && summary.total <= VISUAL_SEARCH_SELECT_LIMIT,
    );
  }

  private summarizeMatches(
    query: SearchQuery,
  ): { readonly current: number; readonly total: number; readonly capped: boolean } {
    const state = this.view.state;
    let cache = this.matchCache;
    if (
      cache === undefined ||
      cache.doc !== state.doc ||
      !sameVisualSearchSemantics(cache.query, query)
    ) {
      const matches = collectVisualSearchMatches(
        state,
        query,
        VISUAL_SEARCH_MATCH_LIMIT,
      );
      cache = {
        doc: state.doc,
        query,
        ranges: matches.ranges,
        capped: matches.capped,
      };
      this.matchCache = cache;
    }
    const selection = state.selection.main;
    const currentIndex = cache.ranges.findIndex(
      (range) => range.from === selection.from && range.to === selection.to,
    );
    return {
      current: currentIndex < 0 ? 0 : currentIndex + 1,
      total: cache.ranges.length,
      capped: cache.capped,
    };
  }

  private updateControlAvailability(
    query: SearchQuery,
    hasMatches: boolean,
    canSelectAll = false,
  ): void {
    const enabled = query.search.length > 0 && query.valid && hasMatches;
    this.previousButton.disabled = !enabled;
    this.nextButton.disabled = !enabled;
    this.selectAllButton.disabled = !enabled || !canSelectAll;
    const selectLabel = enabled && !canSelectAll
      ? `匹配超过 ${VISUAL_SEARCH_SELECT_LIMIT} 项，不能一次全部选择`
      : "选择全部匹配";
    this.selectAllButton.title = selectLabel;
    this.selectAllButton.setAttribute("aria-label", selectLabel);
    this.replaceButton.disabled = this.view.state.readOnly || !enabled;
    this.replaceAllButton.disabled = this.view.state.readOnly || !enabled;
  }
}

function visualSearchButton(
  label: string,
  content: string,
  className: string,
  name: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.name = name;
  button.className = className;
  button.textContent = content;
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

function setVisualSearchPressed(button: HTMLButtonElement, pressed: boolean): void {
  button.setAttribute("aria-pressed", String(pressed));
  button.classList.toggle("active", pressed);
}

function sameVisualSearchSemantics(left: SearchQuery, right: SearchQuery): boolean {
  return left.search === right.search &&
    left.caseSensitive === right.caseSensitive &&
    left.literal === right.literal &&
    left.regexp === right.regexp &&
    left.wholeWord === right.wholeWord &&
    left.test === right.test;
}

function sameVisualSearchQuery(left: SearchQuery, right: SearchQuery): boolean {
  return sameVisualSearchSemantics(left, right) && left.replace === right.replace;
}

function firstVisualSearchMatch(
  state: EditorState,
  query: SearchQuery,
  requestedOrigin: number,
): { readonly from: number; readonly to: number } | undefined {
  if (!query.valid || query.search.length === 0) {
    return undefined;
  }
  const origin = clampInteger(requestedOrigin, 0, state.doc.length);
  const after = query.getCursor(state, origin).next();
  if (!after.done) {
    return after.value;
  }
  if (origin === 0) {
    return undefined;
  }
  const wrapped = query.getCursor(state, 0, origin).next();
  return wrapped.done ? undefined : wrapped.value;
}

function collectVisualSearchMatches(
  state: EditorState,
  query: SearchQuery,
  maximum: number,
): {
  readonly ranges: readonly { readonly from: number; readonly to: number }[];
  readonly capped: boolean;
} {
  const cursor = query.getCursor(state);
  const ranges: { from: number; to: number }[] = [];
  while (ranges.length < maximum) {
    const result = cursor.next();
    if (result.done) {
      return { ranges, capped: false };
    }
    ranges.push({ from: result.value.from, to: result.value.to });
  }
  return { ranges, capped: !cursor.next().done };
}

function adaptiveCompletionInfoPosition(
  list: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
  option: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
  info: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
  space: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
  tooltip?: HTMLElement,
): { readonly style: string; readonly class: string } {
  const gap = 6;
  const scaleX = Math.max(
    0.01,
    (list.right - list.left) / Math.max(1, tooltip?.offsetWidth ?? list.right - list.left),
  );
  const scaleY = Math.max(
    0.01,
    (list.bottom - list.top) / Math.max(1, tooltip?.offsetHeight ?? list.bottom - list.top),
  );
  const naturalWidth = Math.min(420, Math.max(1, info.right - info.left));
  const naturalHeight = Math.max(1, info.bottom - info.top);
  const available = {
    right: Math.max(0, space.right - list.right - gap),
    left: Math.max(0, list.left - space.left - gap),
    below: Math.max(0, space.bottom - list.bottom - gap),
    above: Math.max(0, list.top - space.top - gap),
  };
  const placement = visualFloatingPreviewPlacement(available, {
    width: naturalWidth,
    height: naturalHeight,
  });
  const viewportHeight = Math.max(1, space.bottom - space.top);
  const viewportWidth = Math.max(1, space.right - space.left);
  if (placement === "overlay") {
    const maximumWidth = Math.min(420, viewportWidth);
    const maximumHeight = viewportHeight;
    const renderedWidth = Math.min(naturalWidth, maximumWidth);
    const renderedHeight = Math.min(naturalHeight, maximumHeight);
    const viewportLeft = Math.max(
      space.left,
      Math.min(list.left, space.right - renderedWidth),
    );
    const viewportTop = available.below >= available.above
      ? Math.max(space.top, Math.min(list.bottom + gap, space.bottom - renderedHeight))
      : Math.max(space.top, Math.min(list.top - gap - renderedHeight, space.bottom - renderedHeight));
    return {
      style: [
        `left: ${(viewportLeft - list.left) / scaleX}px`,
        `top: ${(viewportTop - list.top) / scaleY}px`,
        `max-width: ${maximumWidth / scaleX}px`,
        `max-height: ${maximumHeight / scaleY}px`,
      ].join("; "),
      class: "texleaf-completion-info-adaptive texleaf-completion-info-overlay",
    };
  }
  const side = placement;
  const className = `texleaf-completion-info-adaptive texleaf-completion-info-${side}`;
  if (side === "right" || side === "left") {
    const sideWidth = side === "right" ? available.right : available.left;
    const maximumWidth = Math.max(1, Math.min(420, sideWidth));
    const renderedHeight = Math.min(naturalHeight, viewportHeight);
    const viewportTop = Math.max(
      space.top,
      Math.min(option.top, space.bottom - renderedHeight),
    );
    return {
      style: [
        `top: ${(viewportTop - list.top) / scaleY}px`,
        `max-width: ${maximumWidth / scaleX}px`,
        `max-height: ${viewportHeight / scaleY}px`,
      ].join("; "),
      class: `${side === "right" ? "cm-completionInfo-right" : "cm-completionInfo-left"} ${className}`,
    };
  }

  const maximumWidth = Math.min(420, viewportWidth);
  const renderedWidth = Math.min(naturalWidth, maximumWidth);
  const viewportLeft = Math.max(
    space.left,
    Math.min(list.left, space.right - renderedWidth),
  );
  const sideHeight = side === "below" ? available.below : available.above;
  const maximumHeight = Math.max(1, Math.min(viewportHeight, sideHeight));
  const renderedHeight = Math.min(naturalHeight, maximumHeight);
  const viewportTop = side === "below"
    ? Math.min(space.bottom - renderedHeight, list.bottom + gap)
    : Math.max(space.top, list.top - gap - renderedHeight);
  return {
    style: [
      `left: ${(viewportLeft - list.left) / scaleX}px`,
      `top: ${(viewportTop - list.top) / scaleY}px`,
      `max-width: ${maximumWidth / scaleX}px`,
      `max-height: ${maximumHeight / scaleY}px`,
    ].join("; "),
    class: className,
  };
}

/** Line-number marker shown alongside a source range collapsed into one block. */
class VisualSourceRangeLineNumberMarker extends GutterMarker {
  public override readonly elementClass = "texleaf-source-range-gutter";

  public constructor(
    private readonly fromLine: number,
    private readonly toLine: number,
    private readonly layout: VisualSourceRangeLineNumberLayout,
    private readonly semanticAnchorFrom: number | undefined,
  ) {
    super();
  }

  public override eq(other: VisualSourceRangeLineNumberMarker): boolean {
    return this.fromLine === other.fromLine
      && this.toLine === other.toLine
      && this.layout === other.layout
      && this.semanticAnchorFrom === other.semanticAnchorFrom;
  }

  public override toDOM(): Node {
    const root = document.createElement("span");
    root.className = "texleaf-source-range-number";
    root.dataset.fromLine = String(this.fromLine);
    root.dataset.toLine = String(this.toLine);
    root.setAttribute(
      "aria-label",
      this.fromLine === this.toLine
        ? `源代码第 ${this.fromLine} 行`
        : `源代码第 ${this.fromLine} 至 ${this.toLine} 行`,
    );
    root.title = root.getAttribute("aria-label") ?? "";

    if (this.fromLine === this.toLine) {
      root.classList.add("texleaf-source-range-number-single");
      if (this.semanticAnchorFrom === undefined) {
        root.textContent = String(this.fromLine);
      } else {
        root.classList.add("texleaf-line-number-anchor-target");
        root.dataset.texleafLineNumberAnchorId = String(
          this.semanticAnchorFrom,
        );
        const value = document.createElement("span");
        value.className = "texleaf-line-number-anchor-value";
        value.textContent = String(this.fromLine);
        root.append(value);
      }
      return root;
    }

    root.dataset.layout = this.layout;
    root.classList.add(`texleaf-source-range-number-${this.layout}`);

    const start = document.createElement("span");
    start.className = "texleaf-source-range-start";
    start.textContent = String(this.fromLine);
    const rule = document.createElement("span");
    rule.className = "texleaf-source-range-rule";
    rule.setAttribute("aria-hidden", "true");
    const end = document.createElement("span");
    end.className = "texleaf-source-range-end";
    end.textContent = String(this.toLine);
    root.append(start, rule, end);
    return root;
  }
}

/** Empty marker that replaces a native number already owned by a block widget. */
class VisualNativeLineNumberSuppressionMarker extends GutterMarker {
  public override readonly elementClass =
    "texleaf-native-line-number-suppression";

  public override toDOM(): Node {
    const root = document.createElement("span");
    root.setAttribute("aria-hidden", "true");
    root.hidden = true;
    return root;
  }
}

const visualNativeLineNumberSuppressionMarker =
  new VisualNativeLineNumberSuppressionMarker();

/** Exact physical line number whose inner value follows a visual text anchor. */
class VisualHeadingLineNumberMarker extends GutterMarker {
  public constructor(
    private readonly lineNumber: number,
    private readonly semanticAnchorFrom: number,
  ) {
    super();
  }

  public override eq(other: VisualHeadingLineNumberMarker): boolean {
    return this.lineNumber === other.lineNumber &&
      this.semanticAnchorFrom === other.semanticAnchorFrom;
  }

  public override toDOM(): Node {
    const root = document.createElement("span");
    root.className = "texleaf-line-number-anchor-target";
    root.dataset.texleafLineNumberAnchorId = String(this.semanticAnchorFrom);
    const value = document.createElement("span");
    value.className = "texleaf-line-number-anchor-value";
    value.textContent = String(this.lineNumber);
    root.append(value);
    return root;
  }
}

const visualHeadingLineNumbers = lineNumberMarkers.compute(
  [structureField, "doc"],
  (state) => {
    const structure = state.field(structureField);
    if (!structure.enabled) {
      return RangeSet.empty;
    }
    const markers = new Map<number, VisualHeadingLineNumberMarker>();
    for (const record of structure.records) {
      if (
        record.kind !== "heading" ||
        !validRange(record.from, record.to, state.doc.length) ||
        sourceRevealTouchesRange(
          structure.sourceReveal,
          record.from,
          record.to,
        )
      ) {
        continue;
      }
      const line = state.doc.lineAt(record.from);
      markers.set(
        line.from,
        new VisualHeadingLineNumberMarker(line.number, record.from),
      );
    }
    return RangeSet.of(
      [...markers].map(([position, marker]) => marker.range(position)),
      true,
    );
  },
);

const visualTerminalNativeLineNumberSuppressions = lineNumberMarkers.compute(
  [structureField, "doc", "selection"],
  (state) => {
    const structure = state.field(structureField);
    if (!structure.enabled) {
      return RangeSet.empty;
    }
    const positions = new Set<number>();
    for (const record of structure.records) {
      if (
        record.kind !== "documentEnd" ||
        !record.replacement.block ||
        !validRange(
          record.replacement.from,
          record.replacement.to,
          state.doc.length,
        ) ||
        record.replacement.from === record.replacement.to ||
        selectionTouchesRange(
          state,
          record.replacement.sourceFrom,
          record.replacement.sourceTo,
        ) ||
        sourceRevealTouchesRange(
          structure.sourceReveal,
          record.replacement.sourceFrom,
          record.replacement.sourceTo,
        )
      ) {
        continue;
      }
      const range = visualSourceLineNumberRange(
        state.doc,
        record.replacement.from,
        record.replacement.to,
      );
      if (range === undefined) {
        continue;
      }
      // CodeMirror can anchor a terminal native text block to either boundary
      // of the source line (not only line.from). Suppress both exact anchors.
      const sourceLine = state.doc.line(range.toLine);
      positions.add(sourceLine.from);
      positions.add(sourceLine.to);
      const syntheticEof = visualTerminalSyntheticEofLinePosition(
        state.doc,
        record.replacement.sourceTo,
      );
      if (syntheticEof !== undefined) {
        // A single final LF/CRLF is the terminator owned by the footer, not an
        // authored blank line after it. Two line separators make replacement
        // `to` non-terminal, so a genuine blank tail remains numbered.
        positions.add(syntheticEof);
      }
    }
    return RangeSet.of(
      [...positions].map((position) =>
        visualNativeLineNumberSuppressionMarker.range(position)
      ),
      true,
    );
  },
);

const visualSourceRangeLineNumbers = lineNumberWidgetMarker.of(
  (view, widget, block) => {
    // `block.from/to` belongs to the current decoration tree, so unlike a DOM
    // widget closure it cannot retain stale offsets after edits or formatting.
    const range = visualSourceLineNumberRange(
      view.state.doc,
      block.from,
      block.to,
    );
    return range === undefined
      ? null
      : new VisualSourceRangeLineNumberMarker(
          range.fromLine,
          range.toLine,
          visualSourceRangeLineNumberLayout(
            block.height,
            view.defaultLineHeight,
          ),
          widget instanceof AbstractBeginWidget ||
              widget instanceof TheoremBeginWidget ||
              widget instanceof TableOfContentsWidget
            ? block.from
            : undefined,
        );
  },
);

/**
 * Hide only the synthetic logical line which CodeMirror exposes after a
 * terminal line separator consumed by the collapsed document-end footer.
 * The formatter is deliberately used in addition to line-number markers:
 * CodeMirror may anchor that terminal gutter element to a height-map boundary
 * that has no stable document position for a marker, while its logical line
 * number is deterministic. Source mode and authored blank/tail lines continue
 * through the normal formatter unchanged.
 */
function visualEditorLineNumberText(
  lineNumber: number,
  state: EditorState,
): string {
  const structure = state.field(structureField, false);
  if (!structure?.enabled) {
    return String(lineNumber);
  }
  const terminalLineNumber = state.doc.lineAt(state.doc.length).number;
  if (lineNumber !== terminalLineNumber) {
    return String(lineNumber);
  }
  const hidesSyntheticTerminalLine = structure.records.some((record) =>
    record.kind === "documentEnd" &&
    record.replacement.block &&
    record.replacement.from < record.replacement.to &&
    validRange(
      record.replacement.from,
      record.replacement.to,
      state.doc.length,
    ) &&
    !selectionTouchesRange(
      state,
      record.replacement.sourceFrom,
      record.replacement.sourceTo,
    ) &&
    !sourceRevealTouchesRange(
      structure.sourceReveal,
      record.replacement.sourceFrom,
      record.replacement.sourceTo,
    ) &&
    visualTerminalSyntheticEofLinePosition(
        state.doc,
        record.replacement.sourceTo,
      ) !== undefined
  );
  return hidesSyntheticTerminalLine ? "" : String(lineNumber);
}

function createEditorExtensions(editable: boolean) {
  return [
    cspNonce.length > 0 ? EditorView.cspNonce.of(cspNonce) : [],
    visualEditorChinesePhrases,
    lineNumbers({ formatNumber: visualEditorLineNumberText }),
    visualHeadingLineNumbers,
    visualTerminalNativeLineNumberSuppressions,
    visualSourceRangeLineNumbers,
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentUnit.of(VISUAL_LATEX_INDENT_UNIT),
    visualLatexEnvironmentIndentationExtension(),
    indentOnInput(),
    // The nested cm-matchingBracket mark can corrupt Chromium's live Windows
    // IME composition DOM inside revealed formulas. Keep it in source mode,
    // while visual mode retains closeBrackets and structural key handling.
    bracketMatchingCompartment.of(
      editorMode === "source" && inputFeatures.highlightActiveBracketPair
        ? bracketMatching()
        : [],
    ),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    search({
      top: true,
      literal: true,
      createPanel: (view) => new VisualLatexSearchPanel(view),
      scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: "center" }),
    }),
    highlightSelectionMatches(),
    StreamLanguage.define(stex),
    // The host TextMate layer supplies active-theme or fixed-Primer colors.
    // Keep a real stex fallback in full source mode for the interval before host
    // tokens arrive or if the tokenizer cannot start. Visual mode omits nested
    // tok-* spans because Chromium IME composition inside revealed formulas
    // must remain structurally flat.
    syntaxHighlightingCompartment.of(
      editorMode === "source"
        ? syntaxHighlighting(classHighlighter, { fallback: true })
        : [],
    ),
    history(),
    autocompletion({
      override: [visualProviderCompletionSource],
      activateOnTyping: true,
      activateOnTypingDelay: 140,
      // The visual editor owns Enter so it can perform list/matrix actions
      // after completion. CodeMirror's default 75 ms interaction guard made
      // a freshly visible (and already selected) candidate ignore the first
      // Enter, which looked like every completion required two presses.
      interactionDelay: 0,
      maxRenderedOptions: 100,
      // Keep citation/reference details visible in split editors. A right-only
      // pane disappears behind the neighbouring PDF when the list is already
      // near the edge, so choose among right, left, below, and above from the
      // actual tooltip space and clamp the card to that space.
      positionInfo: (view, list, option, info, space) =>
        adaptiveCompletionInfoPosition(
          list,
          option,
          info,
          space,
          view.dom.querySelector<HTMLElement>(".cm-tooltip-autocomplete") ?? undefined,
        ),
    }),
    tooltips({
      tooltipSpace: (view) => {
        const box = view.scrollDOM.getBoundingClientRect();
        return {
          left: Math.max(0, box.left),
          right: Math.min(window.innerWidth, box.right),
          top: Math.max(0, box.top),
          bottom: Math.min(window.innerHeight, box.bottom),
        };
      },
    }),
    EditorView.domEventHandlers({
      mouseover: (event) => handleIssueMarkerMouseOver(event),
      mouseout: (event) => handleIssueMarkerMouseOut(event),
      mousedown: (event, view) => {
        if (event.button !== 0) {
          return false;
        }
        visualLogicalLineGoalColumn = undefined;
        visualImePointerGesture = {
          x: event.clientX,
          y: event.clientY,
          position: view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
            undefined,
          logicalLine: visualPointerLogicalLine(view, event),
          moved: false,
        };
        return false;
      },
      mousemove: (event) => {
        const gesture = visualImePointerGesture;
        if (
          gesture !== undefined &&
          Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 3
        ) {
          gesture.moved = true;
        }
        return false;
      },
      mouseup: (event, view) => {
        const gesture = visualImePointerGesture;
        visualImePointerGesture = undefined;
        if (event.button !== 0 || gesture === undefined) {
          return false;
        }
        const simplePrimaryClick =
          event.detail < 2 &&
          !event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey;
        if (!gesture.moved && simplePrimaryClick) {
          const domPosition = collapsedVisualImeDomCaret(view);
          const coordinatePosition = gesture.position === undefined
            ? undefined
            : Math.max(0, Math.min(view.state.doc.length, gesture.position));
          const position = resolveVisualPointerPosition(
            view.state.doc.length,
            domPosition,
            coordinatePosition,
            gesture.logicalLine,
          );
          if (position !== undefined) {
            // Collapsed structures and display formulas leave physical source
            // lines in the logical document without a painted source glyph.
            // Use the same reveal rule as logical Up/Down navigation before
            // remembering the IME caret.
            const boundaryRevealed = revealVisualCollapsedSourceAtPointer(
              view,
              position,
              gesture.logicalLine,
            );
            const nativeSelection = view.state.selection.main;
            const nativeCaretLeftClickedLine =
              !boundaryRevealed &&
              nativeSelection.empty &&
              gesture.logicalLine !== undefined &&
              (
                nativeSelection.head < gesture.logicalLine.from ||
                nativeSelection.head > gesture.logicalLine.to
              );
            if (nativeCaretLeftClickedLine) {
              // A block replacement may have installed a native selection in
              // the adjacent formula during mousedown. Put it back on the
              // physical source line captured before that selection existed.
              view.dispatch({
                selection: EditorSelection.cursor(position),
                scrollIntoView: false,
                annotations: [
                  Transaction.addToHistory.of(false),
                  Transaction.userEvent.of("select.pointer"),
                ],
              });
            }
            const liveSelection = view.state.selection.main;
            if (liveSelection.empty) {
              const stablePosition = boundaryRevealed
                ? liveSelection.head
                : position;
              visualImePointerCaret = {
                doc: view.state.doc,
                position: stablePosition,
              };
              visualImeStableSelection = {
                doc: view.state.doc,
                from: stablePosition,
                to: stablePosition,
              };
            } else {
              // A tiny drag can stay below the movement threshold, and the
              // first click of a multi-click sequence can already yield a
              // native range. Preserve that range for the next IME edit.
              visualImePointerCaret = undefined;
              rememberVisualImeStableSelection(view, true);
            }
          } else {
            visualImePointerCaret = undefined;
            rememberVisualImeStableSelection(view, true);
          }
        } else {
          visualImePointerCaret = undefined;
          rememberVisualImeStableSelection(view, true);
        }
        return false;
      },
      keydown: (event, view) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
          visualLogicalLineGoalColumn = undefined;
        }
        rememberVisualImeStableSelection(view);
        const mayStartImeComposition =
          event.isComposing ||
          event.key === "Process" ||
          event.key === "Unidentified" ||
          event.keyCode === 229 ||
          (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          );
        if (
          mayStartImeComposition &&
          (!visualImeCompositionActive || visualImeCompositionDomEnded)
        ) {
          const domCaret = collapsedVisualImeDomCaret(view);
          if (domCaret !== undefined) {
            visualImePointerCaret = { doc: view.state.doc, position: domCaret };
            visualImeStableSelection = {
              doc: view.state.doc,
              from: domCaret,
              to: domCaret,
            };
          }
        } else if (!mayStartImeComposition) {
          visualImePointerCaret = undefined;
        }
        return false;
      },
      compositionstart: (_event, view) => {
        clearVisualActiveBracketHighlight(view);
        beginVisualImeComposition(view);
        visualImePointerCaret = undefined;
        return false;
      },
      compositionupdate: (event) => {
        updateVisualImeCompositionText(event);
        return false;
      },
      beforeinput: (event) => {
        if (visualImeCompositionActive) {
          updateVisualImeCompositionText(event);
        }
        return false;
      },
      compositionend: (event, view) => {
        updateVisualImeCompositionText(event);
        finishVisualImeComposition(view);
        return false;
      },
    }),
    editableCompartment.of([
      EditorState.readOnly.of(!editable),
      EditorView.editable.of(editable),
    ]),
    EditorView.inputHandler.of(handleVisualInputBeforeCollapsedBlock),
    visualEnvironmentNameSyncExtension(hostSync),
    Prec.highest(keymap.of([
      // Environment exit must win over completion, snippets, default Enter,
      // and any host/extension keybinding while this TeX webview has focus.
      { key: "Shift-Enter", run: handleVisualShiftEnter },
      // Keep formatting inside this document Webview instead of leaking the
      // conventional shortcut to VS Code's native editor command.
      { key: "Shift-Alt-f", run: runVisualFormatDocument },
    ])),
    keymap.of([
      { key: "Mod-s", run: () => runCommand("save") },
      { key: "Mod-z", run: runVisualUndo },
      { key: "Mod-Shift-z", run: runVisualRedo },
      { key: "Mod-y", run: runVisualRedo },
      { key: "Ctrl-Alt-b", mac: "Cmd-Alt-b", run: () => runCommand("build") },
      { key: "Ctrl-Alt-l", mac: "Cmd-Alt-l", run: () => runCommand("pickSnippet") },
      { key: "Ctrl-Alt-c", mac: "Cmd-Alt-c", run: () => runCommand("pickCitation") },
      { key: "Ctrl-Space", run: startCompletion },
      { key: "ArrowUp", run: (view) => handleVisualLogicalLineArrow(view, -1) },
      { key: "ArrowDown", run: (view) => handleVisualLogicalLineArrow(view, 1) },
      { key: "Tab", run: handleVisualTab },
      { key: "Shift-Tab", run: handleVisualShiftTab },
      { key: "Space", run: handleVisualSpace },
      { key: "Enter", run: handleVisualEnter },
      { key: "Backspace", run: handleVisualBackspace },
      { key: "(", run: (view) => insertVisualMathPairTrigger(view, "(") },
      { key: "[", run: (view) => insertVisualMathPairTrigger(view, "[") },
      { key: "{", run: (view) => insertVisualMathPairTrigger(view, "{") },
      {
        key: "'",
        run: (view) =>
          visualImeOwnsKeyboardInput(view)
            ? false
            : insertLiteralMathApostrophe(view),
      },
      ...closeBracketsKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      ...searchKeymap,
    ]),
    structureField,
    visualTerminalDocumentEndSelectionBarrier,
    formulaField,
    editorPresentationModeField,
    EditorView.lineWrapping,
    visualSoftWrapIndentPlugin,
    aiIssueField,
    diagnosticField,
    nativeSyntaxField,
    nativeBracketField,
    visualActiveBracketHighlightPlugin,
    visualSnippetFramesField,
    reverseSyncFlashField,
    viewportPlugin,
    visualLineNumberAnchorPlugin,
    measuredBlockPlugin,
    mappedWidgetRangePlugin,
    editorTheme,
    EditorView.updateListener.of(handleEditorUpdate),
  ];
}

function runVisualUndo(view: EditorView): boolean {
  // Never let an exhausted local history bubble into VS Code's native editor
  // command. The native undo stack is updated asynchronously by the provider;
  // invoking it as a fallback races the Webview mirror and can jump to line 1.
  runVisualHistoryCommand(view, undoLocalEdit);
  return true;
}

function openToolbarPopupMenu(
  trigger: HTMLButtonElement,
  menu: HTMLDivElement,
): void {
  closeToolbarPopupMenu(false);
  closeEditingContextMenu(false);
  closeTextColorPopover(false);
  activeToolbarMenu = { trigger, menu };
  menu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  menu.style.left = "0px";
  menu.style.top = "0px";
  const anchor = trigger.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.max(6, Math.min(anchor.left, window.innerWidth - width - 6));
  const preferredTop = anchor.bottom + 4;
  const top = preferredTop + height <= window.innerHeight - 6
    ? preferredTop
    : Math.max(6, anchor.top - height - 4);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")
    ?.focus({ preventScroll: true });
}

function closeToolbarPopupMenu(restoreTriggerFocus: boolean): void {
  const active = activeToolbarMenu;
  if (active === undefined) {
    return;
  }
  active.menu.hidden = true;
  active.trigger.setAttribute("aria-expanded", "false");
  active.menu.style.removeProperty("left");
  active.menu.style.removeProperty("top");
  activeToolbarMenu = undefined;
  if (restoreTriggerFocus) {
    active.trigger.focus({ preventScroll: true });
  }
}

function handleToolbarPopupMenuKeydown(
  event: KeyboardEvent,
  menu: HTMLDivElement,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeToolbarPopupMenu(true);
    return;
  }
  if (
    event.key !== "ArrowDown" && event.key !== "ArrowUp" &&
    event.key !== "Home" && event.key !== "End"
  ) {
    return;
  }
  const buttons = Array.from(
    menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  );
  if (buttons.length === 0) {
    return;
  }
  event.preventDefault();
  const current = buttons.findIndex((button) => button === document.activeElement);
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
    ? buttons.length - 1
    : event.key === "ArrowDown"
    ? (current + 1 + buttons.length) % buttons.length
    : (current - 1 + buttons.length) % buttons.length;
  buttons[next]?.focus({ preventScroll: true });
}

function openEditingContextMenu(event: MouseEvent): void {
  const view = editor;
  const target = event.target instanceof Element ? event.target : null;
  if (
    view === undefined ||
    (target !== null &&
      target.closest("input, textarea, select, [contenteditable='true']:not(.cm-content)") !== null)
  ) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  closeToolbarPopupMenu(false);
  closeTextColorPopover(false);
  editingContextSelection = currentSelection(view.state);
  const selection = editingContextSelection;
  const hasSelection = selection.anchor !== selection.head;
  editCutButton.disabled = view.state.readOnly || !hasSelection;
  editCopyButton.disabled = !hasSelection;
  editPasteButton.disabled = view.state.readOnly;
  for (const button of Array.from(
    editingContextMenu.querySelectorAll<HTMLButtonElement>("[data-texleaf-insert]"),
  )) {
    button.disabled = view.state.readOnly;
  }
  editingContextMenu.hidden = false;
  editingContextMenu.style.left = "0px";
  editingContextMenu.style.top = "0px";
  const width = editingContextMenu.offsetWidth;
  const height = editingContextMenu.offsetHeight;
  const left = Math.max(6, Math.min(event.clientX, window.innerWidth - width - 6));
  const top = Math.max(6, Math.min(event.clientY, window.innerHeight - height - 6));
  editingContextMenu.style.left = `${Math.round(left)}px`;
  editingContextMenu.style.top = `${Math.round(top)}px`;
  editingContextMenu.querySelector<HTMLButtonElement>("button:not(:disabled)")
    ?.focus({ preventScroll: true });
}

function closeEditingContextMenu(restoreEditorFocus: boolean): void {
  if (editingContextMenu.hidden) {
    return;
  }
  editingContextMenu.hidden = true;
  editingContextMenu.style.removeProperty("left");
  editingContextMenu.style.removeProperty("top");
  editingContextSelection = undefined;
  if (restoreEditorFocus) {
    editor?.focus();
  }
}

function handleEditingContextMenuKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeEditingContextMenu(true);
    return;
  }
  if (
    event.key !== "ArrowDown" && event.key !== "ArrowUp" &&
    event.key !== "Home" && event.key !== "End"
  ) {
    return;
  }
  const buttons = Array.from(
    editingContextMenu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  );
  if (buttons.length === 0) {
    return;
  }
  event.preventDefault();
  const active = document.activeElement;
  const current = buttons.findIndex((button) => button === active);
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
    ? buttons.length - 1
    : event.key === "ArrowDown"
    ? (current + 1 + buttons.length) % buttons.length
    : (current - 1 + buttons.length) % buttons.length;
  buttons[next]?.focus({ preventScroll: true });
}

function runClipboardAction(action: "cut" | "copy" | "paste"): void {
  const view = editor;
  if (view === undefined || (view.state.readOnly && action !== "copy")) {
    return;
  }
  const selection = editingContextSelection ?? currentSelection(view.state);
  closeEditingContextMenu(false);
  post({
    protocol: VISUAL_EDITOR_PROTOCOL,
    type: "clipboard",
    action,
    revision: clientRevision,
    selection,
  });
  view.focus();
}

function handleUnifiedNavigationKeydown(event: KeyboardEvent): void {
  if (
    editor === undefined ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.altKey ||
    (!event.ctrlKey && !event.metaKey)
  ) {
    return;
  }
  const key = event.key.toLowerCase();
  const direction = event.code === "BracketLeft" || key === "["
    ? "back"
    : event.code === "BracketRight" || key === "]"
      ? "forward"
      : undefined;
  if (direction === undefined) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  post({
    protocol: VISUAL_EDITOR_PROTOCOL,
    type: "navigationCommand",
    direction,
    revision: clientRevision,
    selection: currentSelection(editor.state),
  });
}

/**
 * Preserve Chromium's own undo stack for the two search-panel text controls.
 * VS Code's Webview preload otherwise cancels these keys and forwards them to
 * the document-wide command service. Stopping propagation without calling
 * preventDefault keeps the native input history (and its normal input event)
 * intact while protecting the LaTeX document's history.
 */
function handleVisualSearchNativeHistoryKeydown(event: KeyboardEvent): void {
  const eventTarget = event.composedPath()[0];
  if (
    !(eventTarget instanceof HTMLInputElement) ||
    (eventTarget.name !== "search" && eventTarget.name !== "replace") ||
    eventTarget.closest(".texleaf-search-panel") === null ||
    !visualSearchInputUsesNativeHistory(event)
  ) {
    return;
  }
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function handleVisualHistoryKeydown(event: KeyboardEvent): void {
  const eventTarget = event.composedPath()[0];
  if (
    editor === undefined ||
    !editor.hasFocus ||
    eventTarget instanceof HTMLInputElement ||
    eventTarget instanceof HTMLTextAreaElement ||
    eventTarget instanceof HTMLSelectElement ||
    event.altKey ||
    (!event.ctrlKey && !event.metaKey)
  ) {
    return;
  }
  const key = event.key.toLowerCase();
  const redo = key === "y" || (key === "z" && event.shiftKey);
  const undo = key === "z" && !event.shiftKey;
  if (!undo && !redo) {
    return;
  }
  // VS Code can receive a keybinding after a Webview's bubbling key handler,
  // causing both its TextDocument undo stack and CodeMirror's local history to
  // run for one keystroke. Capture and consume history keys at the iframe
  // boundary before CodeMirror's own keymap and before the host can act.
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (redo) {
    runVisualRedo(editor);
  } else {
    runVisualUndo(editor);
  }
}

function runVisualRedo(view: EditorView): boolean {
  runVisualHistoryCommand(view, redoLocalEdit);
  return true;
}

function runVisualHistoryCommand(
  view: EditorView,
  command: (target: { state: EditorState; dispatch: typeof view.dispatch }) => boolean,
): void {
  const beforeText = view.state.doc.toString();
  const beforeHead = view.state.selection.main.head;
  applyingHostOperation = true;
  let applied = false;
  try {
    // History changes must still be mirrored to the TextDocument, but marking
    // them as host-originated prevents the provider from running automatic
    // input transforms on restored trigger text (for example expanding `lm`
    // straight back to `\\(\\)` immediately after undo).
    applied = command(view);
  } finally {
    applyingHostOperation = false;
  }
  if (!applied) {
    return;
  }
  const afterText = view.state.doc.toString();
  const historyHead = view.state.selection.main.head;
  const caret = atomicVisualHistoryCaret(beforeText, afterText) ??
    historyChangeCaret(
      beforeText,
      afterText,
      beforeHead,
      historyHead,
    );
  view.dispatch({
    selection: EditorSelection.cursor(caret),
    scrollIntoView: true,
    annotations: Transaction.addToHistory.of(false),
  });
}

/**
 * A visual table/tikzcd apply or host-provided snippet expansion is one atomic
 * history event. CodeMirror can otherwise restore a nested widget selection,
 * or place the caret before the restored trigger. Match only exact before/after
 * document states and restore the explicitly recorded caret. Ordinary typing
 * history remains untouched.
 */
function atomicVisualHistoryCaret(
  beforeText: string,
  afterText: string,
): number | undefined {
  for (let index = atomicVisualHistoryEntries.length - 1; index >= 0; index -= 1) {
    const entry = atomicVisualHistoryEntries[index];
    if (entry === undefined) {
      continue;
    }
    if (entry.afterText === beforeText && entry.beforeText === afterText) {
      return clampInteger(entry.beforeCaret, 0, afterText.length);
    }
    if (entry.beforeText === beforeText && entry.afterText === afterText) {
      return clampInteger(entry.afterCaret, 0, afterText.length);
    }
  }
  return undefined;
}

function historyChangeCaret(
  beforeText: string,
  afterText: string,
  fallback: number,
  historyHead?: number,
): number {
  if (beforeText === afterText) {
    return clampInteger(historyHead ?? fallback, 0, afterText.length);
  }
  const sharedLimit = Math.min(beforeText.length, afterText.length);
  let prefix = 0;
  while (prefix < sharedLimit && beforeText[prefix] === afterText[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeText.length - prefix &&
    suffix < afterText.length - prefix &&
    beforeText[beforeText.length - 1 - suffix] === afterText[afterText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const restoredLength = afterText.length - prefix - suffix;
  const restoredTo = afterText.length - suffix;
  if (
    historyHead !== undefined &&
    historyHead >= prefix &&
    historyHead <= restoredTo
  ) {
    // CodeMirror usually has the exact historical selection. Keep it when it
    // belongs to the changed range (notably just after an applied table or
    // tikzcd environment). The fallback remains necessary for stale selections
    // such as offset 0 after editing a collapsed visual block.
    return clampInteger(historyHead, 0, afterText.length);
  }
  return clampInteger(prefix + restoredLength, 0, afterText.length);
}

interface HiddenPairedEnvironmentBoundary {
  readonly edge: "begin" | "end";
  readonly range: VisualReplacementRange;
}

function hiddenPairedEnvironmentBoundaries(
  structure: StructureFieldValue | undefined,
): readonly HiddenPairedEnvironmentBoundary[] {
  if (structure?.enabled !== true) {
    return [];
  }
  return structure.records.flatMap((record): HiddenPairedEnvironmentBoundary[] => {
    if (
      record.kind !== "theorem" &&
      record.kind !== "frame" &&
      record.kind !== "abstract" &&
      record.kind !== "list"
    ) {
      return [];
    }
    return ([
      { edge: "begin", range: record.begin },
      { edge: "end", range: record.end },
    ] as const).filter(({ range }) =>
      atomicDecorationCoversRange(structure.atomic, range.from, range.to)
    );
  });
}

/**
 * Test the presentation that CodeMirror is actually enforcing, rather than
 * the transient source-reveal request that originally produced it. A reveal
 * request can briefly outlive a selection-only rebuild: in that state the DOM
 * is collapsed and atomic again, while `sourceReveal` still mentions the old
 * boundary. Treating the old request as authoritative lets the native input
 * path place the caret inside an invisible `\\end{...}` and overwrite it.
 */
function atomicDecorationCoversRange(
  atomic: DecorationSet,
  from: number,
  to: number,
): boolean {
  let covered = false;
  atomic.between(from, to, (atomicFrom, atomicTo) => {
    if (atomicFrom <= from && atomicTo >= to) {
      covered = true;
    }
  });
  return covered;
}

function atomicDecorationTouchesInput(
  atomic: DecorationSet,
  from: number,
  to: number,
): boolean {
  let touched = false;
  atomic.between(Math.max(0, from - 1), Math.max(to, from) + 1, (
    atomicFrom,
    atomicTo,
  ) => {
    if (
      from === to
        ? from >= atomicFrom && from <= atomicTo
        : from < atomicTo && to > atomicFrom
    ) {
      touched = true;
    }
  });
  return touched;
}

function handleVisualInputBeforeCollapsedBlock(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  insert: () => Transaction,
): boolean {
  if (visualImeCompositionActive || view.composing) {
    const nativeTransaction = insert();
    const nativeUserEvent = nativeTransaction.annotation(Transaction.userEvent);
    if (!shouldProtectVisualImeInput(
      visualImeCompositionActive,
      visualImeCompositionDomEnded,
      view.composing,
      nativeUserEvent,
    )) {
      // The DOM composition has ended. Let CodeMirror process this ordinary
      // letter/deletion normally instead of applying it to the stale IME range.
      return false;
    }
    let session = visualImeCompositionSession;
    if (session === undefined) {
      // The native composition may have started before this editor received
      // its DOM notification. Capture the current real selection rather than
      // trusting a possibly broad DOM-diff range.
      const selection = visualImeCompositionStartRange(view);
      const source = view.state.doc.toString();
      session = visualImeCompositionSession = {
        from: selection.from,
        to: selection.to,
        prefix: source.slice(0, selection.from),
        suffix: source.slice(selection.to),
        eventText: undefined,
        pendingInputIntent: undefined,
      };
    }
    const inputIntent = mergeVisualImeCompositionInputIntent(
      session.pendingInputIntent,
      undefined,
      nativeUserEvent,
    );
    session.pendingInputIntent = undefined;
    const source = view.state.doc.toString();
    if (
      !source.startsWith(session.prefix) ||
      !source.endsWith(session.suffix) ||
      source.length < session.prefix.length + session.suffix.length
    ) {
      return true;
    }
    session.to = source.length - session.suffix.length;
    const plan = planVisualImeCompositionUpdate(
      source,
      session.from,
      session.to,
      from,
      to,
      text,
      session.eventText,
      inputIntent,
      {
        finalCommit:
          visualImeCompositionDomEnded &&
          nativeUserEvent?.includes("compose") === true,
      },
    );
    if (plan === undefined) {
      // Refuse an update that cannot be represented as composition text. This
      // is deliberately narrower than accepting a DOM diff that can erase TeX.
      return true;
    }

    session.to = plan.cursor;
    session.eventText = plan.insert;
    // Always replay the immutable-prefix/suffix plan. Even when the native
    // transaction produces the right EditorState, Chromium can retain a stale
    // composition DOM anchored to an earlier decorated formula token.
    view.dispatch({
      changes: {
        from: plan.from,
        to: plan.to,
        insert: plan.insert,
      },
      selection: EditorSelection.cursor(plan.cursor),
      scrollIntoView: nativeTransaction.scrollIntoView,
      annotations: Transaction.userEvent.of(
        nativeTransaction.annotation(Transaction.userEvent) ??
          "input.type.compose",
      ),
    });
    return true;
  }
  if (editorMode === "visual") {
    const selection = view.state.selection.main;
    // The protected full-width path only applies to a native broad
    // replacement around a collapsed caret. Ordinary character insertion has
    // from === to, so do not materialise the whole document just to have the
    // planner reject it immediately.
    const protectedInsertion = selection.empty &&
        to > from &&
        text.length > 0 &&
        !/[\r\n]/u.test(text) &&
        selection.head >= from &&
        selection.head <= to
      ? planProtectedFullwidthImeInsertion(
          view.state.doc.toString(),
          selection.from,
          selection.to,
          from,
          to,
          text,
        )
      : undefined;
    if (protectedInsertion !== undefined) {
      view.dispatch({
        changes: protectedInsertion,
        selection: EditorSelection.cursor(protectedInsertion.cursor),
        annotations: Transaction.userEvent.of("input.type.compose"),
      });
      return true;
    }
  }
  if (
    editorMode === "visual" &&
    text.length > 0 &&
    !/[\r\n]/u.test(text)
  ) {
    const structure = view.state.field(structureField, false);
    const touchesAtomicBoundary = structure?.enabled === true &&
      atomicDecorationTouchesInput(structure.atomic, from, to);
    const hiddenBoundary = touchesAtomicBoundary
      ? hiddenPairedEnvironmentBoundaries(structure).find(
          ({ range }) =>
            from === to
              ? from >= range.from && from <= range.to
              : from < range.to && to > range.from,
        )
      : undefined;
    if (hiddenBoundary !== undefined) {
      const boundary = hiddenBoundary.range;
      const pointAtTrailingEdge = from === to && from === boundary.to;
      const insertAt = pointAtTrailingEdge
        ? boundary.to
        : hiddenBoundary.edge === "begin"
          ? boundary.to
          : boundary.from;
      const insert = pointAtTrailingEdge ? text : `${text}\n`;
      const sourceReveal = pairedEnvironmentSourceReveal(
        structure?.records ?? [],
        boundary.sourceFrom,
        boundary.sourceTo,
        view.state.doc.toString(),
      );
      view.dispatch({
        changes: { from: insertAt, to: insertAt, insert },
        selection: EditorSelection.cursor(insertAt + text.length),
        ...(sourceReveal === undefined
          ? {}
          : { effects: setStructureSourceReveal.of(sourceReveal) }),
        scrollIntoView: true,
        annotations: Transaction.userEvent.of("input.type"),
      });
      return true;
    }
  }
  if (
    editorMode !== "visual" ||
    from !== to ||
    text.length === 0 ||
    /[\r\n]/u.test(text) ||
    (from > 0 && view.state.sliceDoc(from - 1, from) !== "\n")
  ) {
    return false;
  }
  const structure = view.state.field(structureField, false);
  const collapsedStructureBoundary = structure?.enabled === true && structure.records.some((record) => {
    let boundary: VisualReplacementRange | undefined;
    switch (record.kind) {
      case "theorem":
      case "frame":
      case "abstract":
      case "list":
        boundary = record.begin;
        break;
      case "maketitle":
      case "keywords":
      case "table":
      case "tikzcd":
      case "figure":
      case "tikzpicture":
      case "image":
      case "tableOfContents":
      case "bibliography":
      case "documentEnd":
      case "comment":
        boundary = record.replacement;
        break;
      default:
        return false;
    }
    return boundary.from === from &&
      !sourceRevealTouchesRange(
        structure.sourceReveal,
        boundary.sourceFrom,
        boundary.sourceTo,
      );
  });
  const formulas = view.state.field(formulaField, false);
  const collapsedFormulaBoundary = formulas?.enabled === true && formulas.visual &&
    formulas.records.some((record) => {
      if (
        !record.display ||
        !formulas.rendered.has(record.id) ||
        selectionIntersectsFormula(view.state, record)
      ) {
        return false;
      }
      return visualFormulaReplacementRange(view.state, record).from === from;
    });
  if (!collapsedStructureBoundary && !collapsedFormulaBoundary) {
    return false;
  }

  // A structure or display-formula replacement has no visible source
  // characters at its start. A click in the visual gap before it therefore
  // resolves to the hidden `\\begin`/`\\[` position. Treat ordinary typing
  // there as a new paragraph above the block, rather than concatenating text
  // into `s\\begin{proof}` or accidentally triggering a math-only snippet.
  //
  // CodeMirror may call an input handler with the geometrically resolved
  // `from` while its state selection still points at the previous location
  // (commonly offset 0 after opening a custom editor). Seed the real boundary
  // selection outside history first, otherwise undo removes the text correctly
  // but restores that stale selection and scrolls the document back to line 1.
  if (
    view.state.selection.main.from !== from ||
    view.state.selection.main.to !== from
  ) {
    view.dispatch({
      selection: EditorSelection.cursor(from),
      annotations: Transaction.addToHistory.of(false),
    });
  }
  view.dispatch({
    changes: { from, to, insert: `${text}\n` },
    selection: EditorSelection.cursor(from + text.length),
    annotations: Transaction.userEvent.of("input.type"),
  });
  return true;
}

function handleEditorUpdate(update: ViewUpdate): void {
  // Do not promote Chromium's transient broad decorated selection to an IME
  // replacement range. Genuine drags are recorded by the mouseup handler.
  rememberVisualImeStableSelection(update.view);
  scheduleEditorScrollbarUpdate(update.view);
  if (update.docChanged || update.selectionSet) {
    reconcileReferenceHoverOwner();
  }
  const fromLogicalLineNavigation = update.transactions.some(
    (transaction) => transaction.annotation(visualLogicalLineNavigation) === true,
  );
  if (
    (update.docChanged || update.selectionSet) &&
    !fromLogicalLineNavigation
  ) {
    visualLogicalLineGoalColumn = undefined;
  }
  const fromHost = update.transactions.some(
    (transaction) => transaction.annotation(hostSync) === true,
  );
  const fromHistory = update.transactions.some(
    (transaction) =>
      transaction.isUserEvent("undo") || transaction.isUserEvent("redo"),
  );
  if (update.docChanged && !fromHost && !suppressHostEditMessages) {
    const changes: VisualEditorChange[] = [];
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changes.push({ from: fromA, to: toA, insert: inserted.toString() });
    });
    clientRevision += 1;
    post({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "edit",
      revision: clientRevision,
      changes,
      selection: currentSelection(update.state),
      composing: update.view.composing,
      // Detect history from the transaction itself. CodeMirror may deliver the
      // update listener after the command's outer call frame has unwound, so an
      // ambient boolean alone is not a reliable guard. Restored trigger text
      // such as `lm` must be mirrored without immediately auto-expanding again.
      source: applyingHostOperation || fromHistory ? "host" : "user",
    });
    if (!applyingHostOperation && !fromHistory) {
      scheduleCompletionAfterMirroredEdit(update, true);
    }
  }
  if (
    update.selectionSet &&
    !update.docChanged &&
    !fromHost &&
    !suppressHostEditMessages
  ) {
    // Moving the caret into an existing `\cite{}` should be sufficient to
    // show the collected bibliography; it must not require typing a dummy
    // character or pressing Ctrl+Space first.
    scheduleCompletionAfterMirroredEdit(update, false);
  }
  if (
    update.selectionSet &&
    !update.docChanged &&
    !fromHost &&
    !suppressHostEditMessages
  ) {
    post({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "selection",
      version: documentVersion,
      selection: currentSelection(update.state),
    });
  }
  const preambleStateChanged = update.transactions.some((transaction) =>
    transaction.effects.some((effect) => effect.is(setPreambleExpanded))
  );
  if (
    update.docChanged ||
    update.selectionSet ||
    update.viewportChanged ||
    preambleStateChanged
  ) {
    schedulePersistEditorState(update.view);
  }
  if (
    update.docChanged ||
    update.selectionSet ||
    update.viewportChanged ||
    update.geometryChanged
  ) {
    updateIssueCard(update.state);
  }
}

function applySnippetMessage(
  message: Extract<VisualEditorHostMessage, { readonly type: "applySnippet" }>,
): void {
  if (editor === undefined || message.revision !== clientRevision) {
    discardInputRequest(message.requestId);
    return;
  }
  if (message.requestId !== undefined) {
    const pending = takeInputRequest(message.requestId);
    if (
      pending === undefined ||
      pending.revision !== message.revision ||
      !sameSelection(currentSelection(editor.state), pending.selection)
    ) {
      return;
    }
  }
  const source = editor.state.doc.toString();
  if (
    !validRange(message.from, message.to, source.length) ||
    source.slice(message.from, message.to) !== message.expectedText ||
    message.openBraceMarker.length !== 1 ||
    message.closeBraceMarker.length !== 1 ||
    message.openBraceMarker === message.closeBraceMarker ||
    message.insertedText.includes(message.openBraceMarker) ||
    message.insertedText.includes(message.closeBraceMarker) ||
    !validSnippetModifiers(message.modifiers, source, message.from, message.to)
  ) {
    return;
  }

  const beforeText = source;
  const beforeCaret = message.to;
  applyingHostOperation = true;
  suppressHostEditMessages = true;
  try {
    let from = message.from;
    let to = message.to;
    const prefixChanges = message.modifiers.map((modifier) => ({
      from: modifier.from,
      to: modifier.to,
      insert: modifier.insert,
    }));
    if (message.modifiers.length > 0) {
      const modifierChanges = editor.state.changes(prefixChanges);
      from = modifierChanges.mapPos(message.from, 1);
      to = modifierChanges.mapPos(message.to, -1);
    }
    const applied = applyAtomicCodeMirrorSnippet(editor, {
      template: message.template,
      completion: syntheticSnippetCompletion,
      from,
      to,
      openBraceMarker: message.openBraceMarker,
      closeBraceMarker: message.closeBraceMarker,
      prefixChanges,
      // Literal auto-expansions such as `;g` -> `\gamma` and `nu` -> `\nu`
      // do not own a Tab stop.  Treating their post-insert caret as a snippet
      // field adds a phantom child frame: the first Tab is then consumed by
      // that frame instead of leaving the surrounding sub/superscript.  Real
      // snippets (including a lone final @0 cursor such as `lm`) explicitly
      // report a field and keep the normal nested-snippet behaviour.
      retainLoneFinalCursor: message.hasSnippetFields !== false,
    });
    registerVisualSnippetFields(editor, applied.fields, applied.exit);
    rememberAtomicVisualHistory({
      beforeText,
      afterText: editor.state.doc.toString(),
      beforeCaret,
      afterCaret: editor.state.selection.main.head,
    });
    clientRevision += 1;
    post({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "edit",
      revision: clientRevision,
      // CodeMirror applies the configured indentation unit to multiline
      // snippets. Mirror the exact atomic transaction it actually dispatched,
      // rather than the provider's canonical preview text. Otherwise the host
      // and Webview diverge (for example a tab becomes two spaces), the next
      // snapshot rolls the snippet back, and completion appears to jump to the
      // beginning of the document.
      changes: applied.changes,
      selection: currentSelection(editor.state),
      composing: false,
      source: "host",
    });
    editor.focus();
  } catch (error: unknown) {
    setStatus(
      "error",
      error instanceof Error ? error.message : "无法应用可视化片段。",
      4_000,
    );
    post({ protocol: VISUAL_EDITOR_PROTOCOL, type: "ready" });
  } finally {
    suppressHostEditMessages = false;
    applyingHostOperation = false;
  }
}

function applyEditMessage(
  message: Extract<VisualEditorHostMessage, { readonly type: "applyEdit" }>,
): void {
  if (editor === undefined || message.revision !== clientRevision) {
    discardInputRequest(message.requestId);
    return;
  }
  if (message.requestId !== undefined) {
    const pending = takeInputRequest(message.requestId);
    if (
      pending === undefined ||
      pending.revision !== message.revision ||
      !sameSelection(currentSelection(editor.state), pending.selection)
    ) {
      return;
    }
  }
  const source = editor.state.doc.toString();
  if (
    !validRange(message.from, message.to, source.length) ||
    source.slice(message.from, message.to) !== message.expectedText
  ) {
    return;
  }
  const nextLength = source.length - (message.to - message.from) + message.insert.length;
  const selection = clampSelection(message.selection, nextLength);
  applyingHostOperation = true;
  try {
    editor.dispatch({
      changes: { from: message.from, to: message.to, insert: message.insert },
      selection: EditorSelection.single(selection.anchor, selection.head),
      scrollIntoView: true,
    });
    editor.focus();
  } finally {
    applyingHostOperation = false;
  }
}

function applyInputFallback(
  message: Extract<VisualEditorHostMessage, { readonly type: "inputFallback" }>,
): void {
  if (editor === undefined || message.revision !== clientRevision) {
    discardInputRequest(message.requestId);
    return;
  }
  const pending = takeInputRequest(message.requestId);
  if (
    pending === undefined ||
    pending.revision !== message.revision ||
    pending.action !== message.action ||
    !sameSelection(currentSelection(editor.state), pending.selection)
  ) {
    return;
  }
  runInputFallback(editor, message.action);
}

const VISUAL_COMPLETION_SCAN_LENGTH = 65_536;

/** Classify completion context from CodeMirror's bounded rope slice. */
function visualCompletionContextAtState(
  state: EditorState,
  requestedPosition: number,
): ReturnType<typeof visualLatexCompletionContextAt> {
  const position = Math.max(0, Math.min(state.doc.length, requestedPosition));
  const sliceFrom = Math.max(0, position - VISUAL_COMPLETION_SCAN_LENGTH);
  const local = visualLatexCompletionContextAt(
    state.sliceDoc(sliceFrom, position),
    position - sliceFrom,
    inputFeatures.citationCommands,
  );
  return {
    ...local,
    from: sliceFrom + local.from,
    to: position,
  };
}

function visualProviderCompletionSource(
  context: CompletionContext,
): Promise<CompletionResult | null> | null {
  if (
    editor === undefined ||
    !inputFeatures.enabled ||
    !inputFeatures.internalCompletions ||
    context.state.readOnly ||
    context.state.selection.main.from !== context.pos ||
    context.state.selection.main.to !== context.pos
  ) {
    return null;
  }
  const latexCompletion = visualCompletionContextAtState(
    context.state,
    context.pos,
  );
  const from = latexCompletion.from;
  const query = latexCompletion.query;
  const characterBefore = context.pos > 0
    ? context.state.sliceDoc(context.pos - 1, context.pos)
    : "";
  if (!shouldActivateVisualProviderCompletion({
    explicit: context.explicit,
    query,
    characterBefore,
    contextKind: latexCompletion.kind,
  })) {
    return null;
  }

  completionRequestSequence = completionRequestSequence >= 1_000_000_000
    ? 1
    : completionRequestSequence + 1;
  const requestId = completionRequestSequence;
  const revision = clientRevision;
  return new Promise<CompletionResult | null>((resolve) => {
    const timer = setTimeout(() => {
      const pending = pendingCompletionRequests.get(requestId);
      if (pending === undefined) {
        return;
      }
      pendingCompletionRequests.delete(requestId);
      pending.resolve(null);
    }, 2_500);
    pendingCompletionRequests.set(requestId, {
      revision,
      position: context.pos,
      from,
      resolve,
      timer,
    });
    context.addEventListener(
      "abort",
      () => discardCompletionRequest(requestId),
      { onDocChange: true },
    );
    post({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "completionRequest",
      requestId,
      revision,
      position: context.pos,
      from,
      explicit: context.explicit,
    });
  });
}

function resolveCompletionResult(
  message: Extract<VisualEditorHostMessage, { readonly type: "completionResult" }>,
): void {
  const pending = pendingCompletionRequests.get(message.requestId);
  if (pending === undefined) {
    return;
  }
  clearTimeout(pending.timer);
  pendingCompletionRequests.delete(message.requestId);
  if (
    editor === undefined ||
    message.revision !== pending.revision ||
    message.revision !== clientRevision ||
    message.from !== pending.from ||
    editor.state.selection.main.from !== pending.position ||
    editor.state.selection.main.to !== pending.position
  ) {
    pending.resolve(null);
    return;
  }
  const source = editor.state.doc.toString();
  const query = source.slice(pending.from, pending.position);
  const options: Completion[] = [];
  for (const item of message.items) {
    if (!validVisualCompletionItem(item, source, pending.position)) {
      continue;
    }
    let label = item.filterText ?? item.label;
    const providerSkippedLeadingBackslash =
      query.startsWith("\\") &&
      !label.startsWith("\\") &&
      item.from > pending.from &&
      source.slice(pending.from, item.from) === "\\";
    if (providerSkippedLeadingBackslash) {
      // A catalog item may replace a narrower range than the range which
      // activated completion, such as only the command name after `\\`, while
      // the visual editor's shared context starts at the backslash (`\\usepa`).
      // CodeMirror filters all options against the one
      // common `from`, so normalise only the filter label here; the item's own
      // range is still used by applyVisualProviderCompletion below.
      label = `\\${label}`;
    } else if (label.startsWith("\\") && !query.startsWith("\\")) {
      label = label.slice(1);
    }
    if (label.length === 0) {
      continue;
    }
    const displayLabel = `${item.label}${item.labelDetail ?? ""}`;
    const detailParts = [item.labelDescription, firstLine(item.detail)]
      .filter((part): part is string => part !== undefined && part.length > 0);
    const capturedRevision = message.revision;
    options.push({
      label,
      ...(displayLabel === label ? {} : { displayLabel }),
      ...(detailParts.length === 0 ? {} : { detail: detailParts.join(" · ") }),
      ...(item.referencePreviewKey !== undefined && item.referencePreviewKind !== undefined
        ? { info: () => requestCompletionReferencePreview(item) }
        : item.type === "reference" && item.documentation !== undefined
          ? { info: () => visualCompletionInfo(item.documentation!) }
          : {}),
      type: item.type,
      ...(item.boost === undefined ? {} : { boost: item.boost }),
      apply: (view, completion) => {
        applyVisualProviderCompletion(
          view,
          completion,
          item,
          capturedRevision,
        );
      },
    });
  }
  pending.resolve(options.length === 0
    ? null
    : {
        from: pending.from,
        to: pending.position,
        options,
        ...(message.providerFiltered === true
          ? {
              // CitationController already searched title, author,
              // publication, year, DOI/ISBN, and citation key and returned a
              // ranked incomplete list. Preserve it exactly and force a new
              // provider request when the query changes.
              filter: false,
              validFor: (text: string) => text === query,
            }
          : {}),
      });
}

function requestCompletionReferencePreview(
  item: VisualEditorCompletionItem,
): Promise<HTMLElement> {
  const key = item.referencePreviewKey;
  if (editor === undefined || key === undefined) {
    return Promise.resolve(completionReferencePreviewFallback("引用预览暂不可用。"));
  }
  completionReferencePreviewRequestSequence =
    completionReferencePreviewRequestSequence >= 1_000_000_000
      ? 1
      : completionReferencePreviewRequestSequence + 1;
  const requestId = completionReferencePreviewRequestSequence;
  const revision = clientRevision;
  return new Promise<HTMLElement>((resolve) => {
    const timer = setTimeout(() => {
      const pending = pendingCompletionReferencePreviewRequests.get(requestId);
      if (pending === undefined) {
        return;
      }
      pendingCompletionReferencePreviewRequests.delete(requestId);
      pending.resolve(completionReferencePreviewFallback("引用预览生成超时。"));
    }, 4_000);
    pendingCompletionReferencePreviewRequests.set(requestId, {
      key,
      revision,
      resolve,
      timer,
    });
    post({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "completionReferencePreview",
      requestId,
      version: documentVersion,
      revision,
      key,
    });
  });
}

function resolveCompletionReferencePreviewResult(
  message: Extract<
    VisualEditorHostMessage,
    { readonly type: "completionReferencePreviewResult" }
  >,
): void {
  const pending = pendingCompletionReferencePreviewRequests.get(message.requestId);
  if (pending === undefined) {
    return;
  }
  clearTimeout(pending.timer);
  pendingCompletionReferencePreviewRequests.delete(message.requestId);
  if (
    editor === undefined ||
    message.revision !== clientRevision ||
    message.revision !== pending.revision ||
    message.key !== pending.key
  ) {
    pending.resolve(completionReferencePreviewFallback("引用目标已发生变化。"));
    return;
  }
  const root = document.createElement("div");
  root.className = "texleaf-completion-info texleaf-completion-reference-preview";
  root.append(...createReferencePreviewElements(message, () => {
    editor?.requestMeasure();
  }));
  pending.resolve(root);
}

function completionReferencePreviewFallback(message: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "texleaf-completion-info texleaf-reference-hover-empty";
  root.textContent = message;
  return root;
}

function attachVirtualLatexInput(
  input: HTMLInputElement,
  options: {
    readonly context: VisualEditorVirtualInputContext;
    readonly getAnchor: () => number;
    readonly commit: (value: string) => void;
    readonly mathPreview?: boolean;
    readonly onMathRendered?: (tex: string, rendered: RenderedFormula) => void;
  },
): void {
  isolateNativeInputHistory(input);
  input.classList.add("texleaf-virtual-latex-input");
  input.title = [
    input.title,
    "支持 TeXLeaf 自动片段、Tab/空格触发与占位符；Ctrl+Space 显示内置 LaTeX 补全",
  ].filter(Boolean).join("\n");
  const binding: VirtualLatexInputBinding = {
    input,
    context: options.context,
    getAnchor: options.getAnchor,
    commit: options.commit,
    mathPreview: options.mathPreview === true,
    onMathRendered: options.onMathRendered,
    snippet: undefined,
    beforeValue: input.value,
    beforeSelectionStart: input.selectionStart ?? input.value.length,
    beforeSelectionEnd: input.selectionEnd ?? input.value.length,
    beforeEditorScrollTop: editor?.scrollDOM.scrollTop ?? 0,
    beforeEditorScrollLeft: editor?.scrollDOM.scrollLeft ?? 0,
    scrollRestoreSequence: 0,
    undoStack: [],
    redoStack: [],
    completionTimer: undefined,
    mathPreviewTimer: undefined,
    mathPreviewRequestId: undefined,
  };
  virtualLatexBindings.set(input, binding);
  input.addEventListener("beforeinput", () => {
    binding.beforeValue = input.value;
    binding.beforeSelectionStart = input.selectionStart ?? input.value.length;
    binding.beforeSelectionEnd = input.selectionEnd ?? binding.beforeSelectionStart;
    binding.beforeEditorScrollTop = editor?.scrollDOM.scrollTop ?? 0;
    binding.beforeEditorScrollLeft = editor?.scrollDOM.scrollLeft ?? 0;
  });
  input.addEventListener("input", (event) => {
    recordVirtualInputMutation(binding, {
      value: binding.beforeValue,
      selectionStart: binding.beforeSelectionStart,
      selectionEnd: binding.beforeSelectionEnd,
    });
    mapVirtualSnippetSession(binding, binding.beforeValue, input.value);
    binding.beforeValue = input.value;
    binding.beforeSelectionStart = input.selectionStart ?? input.value.length;
    binding.beforeSelectionEnd = input.selectionEnd ?? binding.beforeSelectionStart;
    binding.commit(input.value);
    closeVirtualCompletion(binding);
    scheduleVirtualMathPreview(binding);
    restoreVirtualInputEditorScroll(
      binding,
      binding.beforeEditorScrollTop,
      binding.beforeEditorScrollLeft,
    );
    if (!inputFeatures.enabled || (event as InputEvent).isComposing) {
      return;
    }
    requestVirtualSnippet(binding, "auto", "none");
    scheduleVirtualCompletion(binding);
  });
  input.addEventListener("focus", () => {
    if (binding.mathPreview) {
      virtualMathPreviewBinding = binding;
      scheduleVirtualMathPreview(binding, true);
    }
  });
  input.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
      event.preventDefault();
      event.stopPropagation();
      requestVirtualCompletion(binding, true);
      return;
    }
    if (virtualCompletionBinding === binding && virtualCompletionItems.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        virtualCompletionSelection = (
          virtualCompletionSelection + delta + virtualCompletionItems.length
        ) % virtualCompletionItems.length;
        renderVirtualCompletionSelection();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const item = virtualCompletionItems[virtualCompletionSelection];
        if (item !== undefined) {
          applyVirtualCompletion(binding, item);
        }
        return;
      }
      if (event.key === "Tab") {
        // Completion is accepted exclusively with Enter. Tab belongs to the
        // local LaTeX/snippet tab-out pipeline below.
        closeVirtualCompletion(binding);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeVirtualCompletion(binding);
        return;
      }
    }
    if (event.key === "Tab") {
      if (advanceVirtualSnippetField(binding, event.shiftKey ? -1 : 1)) {
        event.preventDefault();
        return;
      }
      if (!event.shiftKey && inputFeatures.enabled && inputFeatures.manualTrigger === "tab") {
        event.preventDefault();
        requestVirtualSnippet(binding, "manual", "tab");
      }
      return;
    }
    if (
      event.key === " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      inputFeatures.enabled &&
      inputFeatures.manualTrigger === "space"
    ) {
      event.preventDefault();
      requestVirtualSnippet(binding, "manual", "space");
    }
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement !== input) {
        closeVirtualCompletion(binding);
        closeVirtualMathPreview(binding);
      }
    }, 0);
  });
}

/**
 * Inputs embedded in a CodeMirror block widget still live below the editor in
 * the DOM. Browser-native history is not reliable after a completion or
 * snippet assigns `input.value`: Chromium can replay only part of the edit and
 * duplicate TeX backslashes. Keep an exact per-input history instead, and
 * consume the shortcut before CodeMirror/VS Code can also undo the document.
 */
function isolateNativeInputHistory(input: HTMLInputElement): void {
  input.addEventListener("keydown", (event) => {
    if (
      event.altKey ||
      (!event.ctrlKey && !event.metaKey) ||
      !(
        event.key.toLowerCase() === "y" ||
        event.key.toLowerCase() === "z"
      )
    ) {
      return;
    }
    const binding = virtualLatexBindings.get(input);
    if (binding === undefined) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const redo = event.key.toLowerCase() === "y" || event.shiftKey;
    consumeVirtualInputHistory(binding, redo);
  });
}

/**
 * Capture virtual-input history before CodeMirror or VS Code can observe the
 * shortcut. A target-phase listener is too late for host keybindings in an
 * Electron Webview and can leave the document caret/scroll in an older state.
 */
function handleVirtualInputHistoryKeydown(event: KeyboardEvent): void {
  const target = event.composedPath()[0];
  if (
    !(target instanceof HTMLInputElement) ||
    event.altKey ||
    (!event.ctrlKey && !event.metaKey)
  ) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") {
    return;
  }
  const binding = virtualLatexBindings.get(target);
  if (binding === undefined) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  consumeVirtualInputHistory(binding, key === "y" || event.shiftKey);
}

function consumeVirtualInputHistory(
  binding: VirtualLatexInputBinding,
  redo: boolean,
): void {
  const scrollTop = editor?.scrollDOM.scrollTop ?? binding.beforeEditorScrollTop;
  const scrollLeft = editor?.scrollDOM.scrollLeft ?? binding.beforeEditorScrollLeft;
  restoreVirtualInputHistory(binding, redo);
  restoreVirtualInputEditorScroll(binding, scrollTop, scrollLeft);
}

function recordVirtualInputMutation(
  binding: VirtualLatexInputBinding,
  snapshot: VirtualLatexInputSnapshot = virtualInputSnapshot(binding.input),
): void {
  if (snapshot.value === binding.input.value) {
    return;
  }
  const previous = binding.undoStack.at(-1);
  if (
    previous?.value !== snapshot.value ||
    previous.selectionStart !== snapshot.selectionStart ||
    previous.selectionEnd !== snapshot.selectionEnd
  ) {
    binding.undoStack.push(snapshot);
    if (binding.undoStack.length > 200) {
      binding.undoStack.shift();
    }
  }
  binding.redoStack.length = 0;
}

function restoreVirtualInputHistory(binding: VirtualLatexInputBinding, redo: boolean): void {
  const source = redo ? binding.redoStack : binding.undoStack;
  const target = source.pop();
  if (target === undefined) {
    return;
  }
  const destination = redo ? binding.undoStack : binding.redoStack;
  destination.push(virtualInputSnapshot(binding.input));
  const input = binding.input;
  input.value = target.value;
  binding.beforeValue = target.value;
  binding.beforeSelectionStart = clampVirtualInputOffset(target.selectionStart, target.value.length);
  binding.beforeSelectionEnd = clampVirtualInputOffset(target.selectionEnd, target.value.length);
  input.setSelectionRange(binding.beforeSelectionStart, binding.beforeSelectionEnd);
  binding.snippet = undefined;
  binding.commit(target.value);
  closeVirtualCompletion(binding);
  scheduleVirtualMathPreview(binding, true);
  input.focus({ preventScroll: true });
}

function restoreVirtualInputEditorScroll(
  binding: VirtualLatexInputBinding,
  scrollTop: number,
  scrollLeft: number,
): void {
  const view = editor;
  if (view === undefined) {
    return;
  }
  binding.scrollRestoreSequence += 1;
  const sequence = binding.scrollRestoreSequence;
  const restore = (): void => {
    if (
      sequence !== binding.scrollRestoreSequence ||
      !binding.input.isConnected ||
      document.activeElement !== binding.input
    ) {
      return;
    }
    view.scrollDOM.scrollTop = scrollTop;
    view.scrollDOM.scrollLeft = scrollLeft;
  };
  restore();
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(restore);
  });
}

function virtualInputSnapshot(input: HTMLInputElement): VirtualLatexInputSnapshot {
  const selectionStart = input.selectionStart ?? input.value.length;
  return {
    value: input.value,
    selectionStart,
    selectionEnd: input.selectionEnd ?? selectionStart,
  };
}

function clampVirtualInputOffset(offset: number, length: number): number {
  return Math.max(0, Math.min(length, Number.isFinite(offset) ? Math.trunc(offset) : length));
}

function scheduleVirtualMathPreview(
  binding: VirtualLatexInputBinding,
  immediate = false,
): void {
  if (!binding.mathPreview) {
    return;
  }
  if (binding.mathPreviewTimer !== undefined) {
    clearTimeout(binding.mathPreviewTimer);
  }
  const tex = virtualMathPreviewSource(
    binding.context,
    binding.input.value,
    binding.input.selectionStart ?? binding.input.value.length,
  );
  if (tex === undefined) {
    closeVirtualMathPreview(binding);
    return;
  }
  virtualMathPreviewBinding = binding;
  binding.mathPreviewTimer = setTimeout(() => {
    binding.mathPreviewTimer = undefined;
    if (
      !binding.input.isConnected ||
      document.activeElement !== binding.input ||
      virtualMathPreviewBinding !== binding
    ) {
      return;
    }
    if (binding.mathPreviewRequestId !== undefined) {
      pendingVirtualMathRenderRequests.delete(binding.mathPreviewRequestId);
    }
    const requestId = ++virtualMathRenderRequestSequence;
    const anchor = binding.getAnchor();
    binding.mathPreviewRequestId = requestId;
    pendingVirtualMathRenderRequests.set(requestId, {
      binding,
      expectedValue: binding.input.value,
      tex,
      revision: clientRevision,
      projectContextKey,
      anchor,
    });
    post({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "virtualMathRenderRequest",
      requestId,
      revision: clientRevision,
      projectContextKey,
      anchor,
      tex,
    });
  }, immediate ? 0 : 90);
}

function virtualMathPreviewSource(
  context: VisualEditorVirtualInputContext,
  value: string,
  cursor: number,
): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (context === "tikzcd") {
    return trimmed;
  }
  if (trimmed.length > 2 && trimmed.startsWith("$") && trimmed.endsWith("$")) {
    const unwrapped = trimmed.slice(1, -1).trim();
    return unwrapped.length === 0 ? undefined : unwrapped;
  }
  for (const [open, close] of [["\\(", "\\)"], ["\\[", "\\]"]] as const) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      const unwrapped = trimmed.slice(open.length, -close.length).trim();
      return unwrapped.length === 0 ? undefined : unwrapped;
    }
  }
  if (context === "table") {
    const boundedCursor = clampVirtualInputOffset(cursor, value.length);
    const region = [boundedCursor, boundedCursor - 1, boundedCursor - 2]
      .filter((offset, index, values) => offset >= 0 && values.indexOf(offset) === index)
      .map((offset) => innermostLatexMathRegion(value, offset))
      .find((candidate) => candidate !== undefined);
    if (region !== undefined) {
      const unwrapped = value.slice(region.innerStart, region.innerEnd).trim();
      return unwrapped.length === 0 ? undefined : unwrapped;
    }
    // A mixed cell with explicit math delimiters must never fall through to
    // whole-cell rendering merely because the caret sits just outside the
    // current region. That produced previews such as `Partition\\(d\\)`.
    if (/\$|\\[([]/u.test(value)) {
      return undefined;
    }
  }
  // A tabular cell lives in text mode, so ordinary words should not suddenly
  // turn into italic mathematics merely because the cell is focused. Still
  // preview explicit LaTeX-like math while its delimiters are being composed.
  return /(?:\\[A-Za-z]+|[_^{}])/u.test(trimmed) ? trimmed : undefined;
}

function resolveVirtualMathRenderResult(
  message: Extract<VisualEditorHostMessage, { readonly type: "virtualMathRenderResult" }>,
): void {
  const pending = pendingVirtualMathRenderRequests.get(message.requestId);
  pendingVirtualMathRenderRequests.delete(message.requestId);
  if (pending === undefined) {
    return;
  }
  const { binding } = pending;
  if (
    binding.mathPreviewRequestId !== message.requestId ||
    virtualMathPreviewBinding !== binding ||
    !binding.input.isConnected ||
    document.activeElement !== binding.input ||
    binding.input.value !== pending.expectedValue ||
    message.tex !== pending.tex ||
    message.revision !== clientRevision ||
    message.revision !== pending.revision ||
    message.projectContextKey !== projectContextKey ||
    message.projectContextKey !== pending.projectContextKey
  ) {
    return;
  }
  showVirtualMathPreview(binding, {
    svg: message.svg,
    widthEm: message.widthEm,
    heightEm: message.heightEm,
  });
  binding.onMathRendered?.(message.tex, {
    svg: message.svg,
    widthEm: message.widthEm,
    heightEm: message.heightEm,
  });
}

function resolveVirtualMathRenderError(
  message: Extract<VisualEditorHostMessage, { readonly type: "virtualMathRenderError" }>,
): void {
  const pending = pendingVirtualMathRenderRequests.get(message.requestId);
  pendingVirtualMathRenderRequests.delete(message.requestId);
  if (
    pending !== undefined &&
    pending.binding.mathPreviewRequestId === message.requestId &&
    pending.binding.input.value === pending.expectedValue &&
    message.revision === clientRevision &&
    message.revision === pending.revision &&
    message.projectContextKey === projectContextKey &&
    message.projectContextKey === pending.projectContextKey
  ) {
    closeVirtualMathPreview(pending.binding);
  }
}

function showVirtualMathPreview(
  binding: VirtualLatexInputBinding,
  rendered: RenderedFormula,
): void {
  const panel = binding.input.closest<HTMLElement>(".texleaf-visual-structure-editor");
  const svg = createFormulaSvg(rendered);
  if (panel === null || svg === undefined) {
    closeVirtualMathPreview(binding);
    return;
  }
  virtualMathPreviewPopup?.remove();
  const popup = document.createElement("div");
  popup.className = "texleaf-virtual-math-preview visible";
  popup.setAttribute("role", "status");
  popup.setAttribute("aria-label", "当前输入的 LaTeX 公式预览");
  popup.dataset.texleafVirtualMathContext = binding.context;
  const math = document.createElement("span");
  math.className = "texleaf-structure-math";
  applyStructureMathGeometry(math, rendered);
  math.append(svg);
  popup.append(math);
  panel.append(popup);
  virtualMathPreviewPopup = popup;
  positionVirtualMathPreview(binding, popup, panel);
}

function positionVirtualMathPreview(
  binding: VirtualLatexInputBinding,
  popup: HTMLElement,
  panel: HTMLElement,
): void {
  const panelRect = panel.getBoundingClientRect();
  const inputRect = binding.input.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const preferredLeft = inputRect.left - panelRect.left;
  popup.style.left = `${clampNumber(
    preferredLeft,
    4,
    Math.max(4, panel.clientWidth - popupRect.width - 4),
  )}px`;
  const above = inputRect.top - panelRect.top - popupRect.height - 4;
  const below = inputRect.bottom - panelRect.top + 4;
  popup.style.top = `${above >= 4 ? above : below}px`;
}

function closeVirtualMathPreview(binding?: VirtualLatexInputBinding): void {
  if (binding !== undefined && virtualMathPreviewBinding !== binding) {
    return;
  }
  const active = binding ?? virtualMathPreviewBinding;
  if (active?.mathPreviewTimer !== undefined) {
    clearTimeout(active.mathPreviewTimer);
    active.mathPreviewTimer = undefined;
  }
  if (active?.mathPreviewRequestId !== undefined) {
    pendingVirtualMathRenderRequests.delete(active.mathPreviewRequestId);
    active.mathPreviewRequestId = undefined;
  }
  virtualMathPreviewPopup?.remove();
  virtualMathPreviewPopup = undefined;
  virtualMathPreviewBinding = undefined;
}

function mapVirtualSnippetSession(
  binding: VirtualLatexInputBinding,
  before: string,
  after: string,
): void {
  const session = binding.snippet;
  if (session === undefined || before === after) {
    return;
  }
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) {
    from += 1;
  }
  let beforeTo = before.length;
  let afterTo = after.length;
  while (
    beforeTo > from &&
    afterTo > from &&
    before[beforeTo - 1] === after[afterTo - 1]
  ) {
    beforeTo -= 1;
    afterTo -= 1;
  }
  const delta = (afterTo - from) - (beforeTo - from);
  for (const field of session.fields) {
    const mapped: { from: number; to: number }[] = [];
    for (const range of field.ranges) {
      if (range.to <= from) {
        mapped.push(range);
      } else if (range.from >= beforeTo) {
        mapped.push({ from: range.from + delta, to: range.to + delta });
      } else if (from >= range.from && beforeTo <= range.to) {
        mapped.push({ from: range.from, to: range.to + delta });
      } else {
        binding.snippet = undefined;
        return;
      }
    }
    field.ranges = mapped;
  }
}

function requestVirtualSnippet(
  binding: VirtualLatexInputBinding,
  activation: "auto" | "manual",
  fallback: PendingVirtualSnippetRequest["fallback"],
): void {
  const input = binding.input;
  const selectionStart = input.selectionStart ?? input.value.length;
  const selectionEnd = input.selectionEnd ?? selectionStart;
  const anchor = binding.getAnchor();
  if (
    !input.isConnected ||
    !Number.isSafeInteger(anchor) ||
    anchor < 0 ||
    input.value.length > 32_768
  ) {
    runVirtualSnippetFallback(binding, fallback);
    return;
  }
  virtualInputRequestSequence = virtualInputRequestSequence >= 1_000_000_000
    ? 1
    : virtualInputRequestSequence + 1;
  const requestId = virtualInputRequestSequence;
  const expectedValue = input.value;
  const timer = setTimeout(() => {
    const pending = pendingVirtualSnippetRequests.get(requestId);
    if (pending === undefined) {
      return;
    }
    pendingVirtualSnippetRequests.delete(requestId);
    runVirtualSnippetFallback(binding, pending.fallback);
  }, activation === "manual" ? 1_200 : 2_000);
  pendingVirtualSnippetRequests.set(requestId, {
    binding,
    expectedValue,
    selectionStart,
    selectionEnd,
    fallback,
    timer,
  });
  post({
    protocol: VISUAL_EDITOR_PROTOCOL,
    type: "virtualSnippetRequest",
    requestId,
    revision: clientRevision,
    value: expectedValue,
    selectionStart,
    selectionEnd,
    anchor,
    context: binding.context,
    activation,
  });
}

function resolveVirtualSnippetResult(
  message: Extract<VisualEditorHostMessage, { readonly type: "virtualSnippetResult" }>,
): void {
  const pending = pendingVirtualSnippetRequests.get(message.requestId);
  if (pending === undefined) {
    return;
  }
  clearTimeout(pending.timer);
  pendingVirtualSnippetRequests.delete(message.requestId);
  const { binding } = pending;
  const input = binding.input;
  if (
    message.revision !== clientRevision ||
    message.expectedValue !== pending.expectedValue ||
    message.selectionStart !== pending.selectionStart ||
    message.selectionEnd !== pending.selectionEnd ||
    !input.isConnected ||
    input.value !== pending.expectedValue ||
    (input.selectionStart ?? input.value.length) !== pending.selectionStart ||
    (input.selectionEnd ?? pending.selectionStart) !== pending.selectionEnd
  ) {
    return;
  }
  if (
    !message.matched ||
    message.from === undefined ||
    message.to === undefined ||
    message.snippet === undefined ||
    !validRange(message.from, message.to, input.value.length) ||
    message.to > pending.selectionStart
  ) {
    runVirtualSnippetFallback(binding, pending.fallback);
    return;
  }
  applyVirtualSnippet(binding, message.from, message.to, message.snippet);
}

function applyVirtualSnippet(
  binding: VirtualLatexInputBinding,
  from: number,
  to: number,
  snippetEncoding: VirtualSnippetEncoding,
): void {
  const input = binding.input;
  if (
    !validRange(from, to, input.value.length) ||
    snippetEncoding.text.length > 100_000
  ) {
    return;
  }
  const before = virtualInputSnapshot(input);
  input.value = `${input.value.slice(0, from)}${snippetEncoding.text}${input.value.slice(to)}`;
  recordVirtualInputMutation(binding, before);
  binding.beforeValue = input.value;
  binding.commit(input.value);
  binding.snippet = createVirtualSnippetSession(snippetEncoding.fields, from);
  if (!selectVirtualSnippetField(binding, 0)) {
    const cursor = from + snippetEncoding.text.length;
    input.setSelectionRange(cursor, cursor);
    binding.snippet = undefined;
  }
  binding.beforeSelectionStart = input.selectionStart ?? input.value.length;
  binding.beforeSelectionEnd = input.selectionEnd ?? binding.beforeSelectionStart;
  closeVirtualCompletion(binding);
  // Programmatic snippet/completion insertion does not emit a DOM `input`
  // event. Refresh from the complete resulting field value so the popup and
  // the tikzcd canvas cannot remain on the trigger-only render.
  scheduleVirtualMathPreview(binding, true);
}

function createVirtualSnippetSession(
  fields: readonly VirtualSnippetField[],
  offset: number,
): VirtualSnippetSession | undefined {
  const mapped = fields
    .filter((field) => field.ranges.length > 0)
    .map((field): MutableVirtualSnippetField => ({
      index: field.index,
      ranges: field.ranges.map((range: VirtualSnippetRange) => ({
        from: offset + range.from,
        to: offset + range.to,
      })),
    }));
  return mapped.length === 0 ? undefined : { fields: mapped, active: 0 };
}

function selectVirtualSnippetField(
  binding: VirtualLatexInputBinding,
  index: number,
): boolean {
  const session = binding.snippet;
  const field = session?.fields[index];
  const range = field?.ranges[0];
  if (session === undefined || field === undefined || range === undefined) {
    return false;
  }
  session.active = index;
  binding.input.focus();
  binding.input.setSelectionRange(range.from, range.to);
  return true;
}

function advanceVirtualSnippetField(
  binding: VirtualLatexInputBinding,
  direction: -1 | 1,
): boolean {
  const session = binding.snippet;
  if (session === undefined) {
    return false;
  }
  const next = session.active + direction;
  if (next >= 0 && next < session.fields.length) {
    return selectVirtualSnippetField(binding, next);
  }
  binding.snippet = undefined;
  if (direction > 0) {
    focusNextVirtualLatexInput(binding.input);
  }
  return true;
}

function runVirtualSnippetFallback(
  binding: VirtualLatexInputBinding,
  fallback: PendingVirtualSnippetRequest["fallback"],
): void {
  if (fallback === "tab") {
    focusNextVirtualLatexInput(binding.input);
  } else if (fallback === "space") {
    const input = binding.input;
    const from = input.selectionStart ?? input.value.length;
    const to = input.selectionEnd ?? from;
    const before = virtualInputSnapshot(input);
    input.value = `${input.value.slice(0, from)} ${input.value.slice(to)}`;
    recordVirtualInputMutation(binding, before);
    binding.beforeValue = input.value;
    binding.commit(input.value);
    input.setSelectionRange(from + 1, from + 1);
    binding.beforeSelectionStart = from + 1;
    binding.beforeSelectionEnd = from + 1;
    scheduleVirtualMathPreview(binding, true);
  }
}

function focusNextVirtualLatexInput(input: HTMLInputElement): void {
  const container = input.closest(".texleaf-visual-structure-editor");
  const inputs = container === null
    ? []
    : Array.from(container.querySelectorAll<HTMLInputElement>(
        ".texleaf-virtual-latex-input:not(:disabled)",
      ));
  const current = inputs.indexOf(input);
  const target = current >= 0 ? inputs[current + 1] : undefined;
  if (target === undefined) {
    input.blur();
    return;
  }
  target.focus();
  target.select();
}

function scheduleVirtualCompletion(binding: VirtualLatexInputBinding): void {
  if (binding.completionTimer !== undefined) {
    clearTimeout(binding.completionTimer);
  }
  if (!inputFeatures.internalCompletions) {
    return;
  }
  binding.completionTimer = setTimeout(() => {
    binding.completionTimer = undefined;
    const input = binding.input;
    const cursor = input.selectionStart ?? input.value.length;
    const query = /\\?[\p{L}\p{N}_:@.-]*$/u.exec(input.value.slice(0, cursor))?.[0] ?? "";
    if (document.activeElement === input && query.length >= 2) {
      requestVirtualCompletion(binding, false);
    }
  }, 160);
}

function requestVirtualCompletion(
  binding: VirtualLatexInputBinding,
  explicit: boolean,
): void {
  const input = binding.input;
  const selectionStart = input.selectionStart ?? input.value.length;
  const selectionEnd = input.selectionEnd ?? selectionStart;
  const anchor = binding.getAnchor();
  if (!input.isConnected || !Number.isSafeInteger(anchor) || anchor < 0) {
    return;
  }
  virtualInputRequestSequence = virtualInputRequestSequence >= 1_000_000_000
    ? 1
    : virtualInputRequestSequence + 1;
  const requestId = virtualInputRequestSequence;
  const expectedValue = input.value;
  const timer = setTimeout(() => {
    pendingVirtualCompletionRequests.delete(requestId);
  }, 2_500);
  pendingVirtualCompletionRequests.set(requestId, {
    binding,
    expectedValue,
    selectionStart,
    selectionEnd,
    timer,
  });
  post({
    protocol: VISUAL_EDITOR_PROTOCOL,
    type: "virtualCompletionRequest",
    requestId,
    revision: clientRevision,
    value: expectedValue,
    selectionStart,
    selectionEnd,
    anchor,
    context: binding.context,
    explicit,
  });
}

function resolveVirtualCompletionResult(
  message: Extract<VisualEditorHostMessage, { readonly type: "virtualCompletionResult" }>,
): void {
  const pending = pendingVirtualCompletionRequests.get(message.requestId);
  if (pending === undefined) {
    return;
  }
  clearTimeout(pending.timer);
  pendingVirtualCompletionRequests.delete(message.requestId);
  const { binding } = pending;
  const input = binding.input;
  if (
    message.revision !== clientRevision ||
    message.expectedValue !== pending.expectedValue ||
    message.selectionStart !== pending.selectionStart ||
    message.selectionEnd !== pending.selectionEnd ||
    !input.isConnected ||
    document.activeElement !== input ||
    input.value !== pending.expectedValue
  ) {
    return;
  }
  showVirtualCompletion(binding, message.items);
}

function showVirtualCompletion(
  binding: VirtualLatexInputBinding,
  items: readonly VisualEditorVirtualCompletionItem[],
): void {
  closeVirtualCompletion();
  if (items.length === 0) {
    return;
  }
  const panel = binding.input.closest<HTMLElement>(".texleaf-visual-structure-editor");
  if (panel === null) {
    return;
  }
  const popup = document.createElement("div");
  popup.className = "texleaf-virtual-completion";
  popup.setAttribute("role", "listbox");
  const panelRect = panel.getBoundingClientRect();
  const inputRect = binding.input.getBoundingClientRect();
  popup.style.left = `${Math.max(4, inputRect.left - panelRect.left)}px`;
  popup.style.top = `${Math.max(4, inputRect.bottom - panelRect.top + 3)}px`;
  virtualCompletionPopup = popup;
  virtualCompletionItems = items;
  virtualCompletionSelection = 0;
  virtualCompletionBinding = binding;
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "texleaf-virtual-completion-item";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === 0));
    const label = document.createElement("span");
    label.className = "texleaf-virtual-completion-label";
    label.textContent = item.label;
    const detail = document.createElement("span");
    detail.className = "texleaf-virtual-completion-detail";
    detail.textContent = item.detail ?? "";
    const source = document.createElement("span");
    source.className = "texleaf-virtual-completion-source";
    source.textContent = item.source;
    button.append(label, detail, source);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyVirtualCompletion(binding, item);
    });
    popup.append(button);
  });
  panel.append(popup);
}

function renderVirtualCompletionSelection(): void {
  const buttons = virtualCompletionPopup?.querySelectorAll<HTMLElement>(
    ".texleaf-virtual-completion-item",
  );
  if (buttons === undefined) {
    return;
  }
  Array.from(buttons).forEach((button, index) => {
    button.setAttribute("aria-selected", String(index === virtualCompletionSelection));
    if (index === virtualCompletionSelection) {
      button.scrollIntoView({ block: "nearest" });
    }
  });
}

function applyVirtualCompletion(
  binding: VirtualLatexInputBinding,
  item: VisualEditorVirtualCompletionItem,
): void {
  const input = binding.input;
  if (
    !validRange(item.from, item.to, input.value.length) ||
    input.value.slice(item.from, item.to) !== item.expectedText
  ) {
    closeVirtualCompletion(binding);
    return;
  }
  applyVirtualSnippet(binding, item.from, item.to, item.snippet);
}

function closeVirtualCompletion(binding?: VirtualLatexInputBinding): void {
  if (binding !== undefined && virtualCompletionBinding !== binding) {
    return;
  }
  virtualCompletionPopup?.remove();
  virtualCompletionPopup = undefined;
  virtualCompletionItems = [];
  virtualCompletionSelection = 0;
  virtualCompletionBinding = undefined;
}

function validVisualCompletionItem(
  item: VisualEditorCompletionItem,
  source: string,
  position: number,
): boolean {
  return item.label.length > 0 &&
    item.template.length <= 100_000 &&
    item.insertedText.length <= 100_000 &&
    item.openBraceMarker.length === 1 &&
    item.closeBraceMarker.length === 1 &&
    item.openBraceMarker !== item.closeBraceMarker &&
    (
      item.completionActionId === undefined ||
      /^[A-Za-z0-9_-]{16,64}$/u.test(item.completionActionId)
    ) &&
    validRange(item.from, item.to, source.length) &&
    item.from <= position &&
    item.to >= position &&
    source.slice(item.from, item.to) === item.expectedText;
}

function applyVisualProviderCompletion(
  view: EditorView,
  completion: Completion,
  item: VisualEditorCompletionItem,
  revision: number,
): void {
  const sourceBefore = view.state.doc.toString();
  const selectionBefore = currentSelection(view.state);
  const completionActionPending = item.completionActionId !== undefined;
  const completedArgumentCursor = visualCompletedArgumentCursor(
    sourceBefore,
    item.from,
    item.to,
    item.insertedText,
    {
      citationCommands: inputFeatures.citationCommands,
      completionActionPending,
    },
  );
  if (
    revision !== clientRevision ||
    !validVisualCompletionItem(item, sourceBefore, view.state.selection.main.head)
  ) {
    // Project-wide labels and bibliography metadata may be re-indexed while a
    // completion menu is already visible.  That changes projectContextKey but
    // not this document edit.  The revision plus exact range/original-text
    // check above is the authoritative stale-edit guard and keeps the first
    // Enter from being discarded merely because background indexing finished.
    setStatus("warning", "补全文档已经变化，请重新触发补全。", 3_000);
    startCompletion(view);
    return;
  }

  applyingHostOperation = true;
  suppressHostEditMessages = true;
  try {
    const applied = applyAtomicCodeMirrorSnippet(view, {
      template: item.template,
      completion,
      from: item.from,
      to: item.to,
      openBraceMarker: item.openBraceMarker,
      closeBraceMarker: item.closeBraceMarker,
      retainLoneFinalCursor:
        item.hasSnippetFields !== false && !completionActionPending,
    });
    if (completionActionPending) {
      // Existing-bibliography and Zotero candidates both carry an opaque
      // follow-up. Keep the snippet's natural caret before `}` until the host
      // has marked/imported the citation; moving out first makes the host lose
      // the citation context shared by Enter and mouse acceptance.
      closeCompletion(view);
      clearSnippet(view);
    } else if (completedArgumentCursor === undefined) {
      registerVisualSnippetFields(view, applied.fields, applied.exit);
    } else {
      closeCompletion(view);
      clearSnippet(view);
      view.dispatch({
        selection: EditorSelection.cursor(completedArgumentCursor),
        scrollIntoView: true,
        annotations: Transaction.addToHistory.of(false),
      });
    }
    clientRevision += 1;
    post({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "edit",
      revision: clientRevision,
      changes: applied.changes,
      selection: currentSelection(view.state),
      composing: false,
      source: "user",
    });
    if (item.completionActionId !== undefined) {
      post({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "completionAccepted",
        revision: clientRevision,
        actionId: item.completionActionId,
      });
    }
    view.focus();
    if (!completionActionPending && completedArgumentCursor === undefined) {
      scheduleArgumentCompletionAfterSnippet(view, clientRevision);
    }
  } catch (error: unknown) {
    if (view.state.doc.toString() !== sourceBefore) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: sourceBefore },
        selection: EditorSelection.single(selectionBefore.anchor, selectionBefore.head),
        annotations: hostSyncAnnotations,
      });
    }
    setStatus(
      "error",
      error instanceof Error ? error.message : "无法应用原生补全候选。",
      4_000,
    );
    post({ protocol: VISUAL_EDITOR_PROTOCOL, type: "ready" });
  } finally {
    suppressHostEditMessages = false;
    applyingHostOperation = false;
  }
}

/**
 * Accepting a command snippet is one atomic CodeMirror completion, so the
 * autocomplete extension intentionally closes its list and does not regard
 * the resulting placeholder selection as newly typed text. Native VS Code
 * immediately opens bibliography or label completion for `\\cite{…}` and
 * `\\eqref{…}`. Re-open it only when the accepted snippet actually left an
 * unchanged caret in one of those arguments, after the mirrored TextDocument
 * edit has reached the extension host. The revision/selection checks make the
 * delayed callback a no-op as soon as the user continues typing or moves.
 */
function scheduleArgumentCompletionAfterSnippet(
  view: EditorView,
  revision: number,
): void {
  const expectedPosition = view.state.selection.main.head;
  if (
    view.state.selection.main.from !== expectedPosition ||
    !isStructuredArgumentCompletionPosition(
      view.state.doc.toString(),
      expectedPosition,
    )
  ) {
    return;
  }
  const attempt = (): void => {
    if (
      editor !== view ||
      clientRevision !== revision ||
      !view.hasFocus ||
      view.state.selection.main.from !== expectedPosition ||
      view.state.selection.main.to !== expectedPosition ||
      !isStructuredArgumentCompletionPosition(
        view.state.doc.toString(),
        expectedPosition,
      )
    ) {
      return;
    }
    if (completionStatus(view.state) === null) {
      startCompletion(view);
    }
  };
  // The first attempt normally follows the mirrored TextDocument edit. A
  // second guarded attempt covers a slow project-index acknowledgement: it is
  // a no-op while a valid picker is open and only retries when the first
  // asynchronous provider request closed without candidates.
  setTimeout(attempt, 220);
  setTimeout(attempt, 700);
}

function isStructuredArgumentCompletionPosition(
  source: string,
  position: number,
): boolean {
  const kind = visualLatexCompletionContextAt(
    source,
    position,
    inputFeatures.citationCommands,
  ).kind;
  return kind === "citation" ||
    kind === "reference" ||
    kind === "label-definition" ||
    kind === "environment" ||
    kind === "argument";
}

function visualCompletionInfo(markdown: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "texleaf-completion-info";
  const normalized = decodeVisualCompletionMarkdownEntities(
    markdown.replace(/  \r?\n/gu, "\n"),
  ).trim();
  for (const rawBlock of normalized.split(/\r?\n\s*\r?\n/gu)) {
    const block = rawBlock.trim();
    if (block.length === 0) {
      continue;
    }
    if (/^-{3,}$/u.test(block)) {
      root.append(document.createElement("hr"));
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/u.exec(block);
    if (heading !== null) {
      const element = document.createElement("h3");
      appendVisualCompletionMarkdown(element, heading[1] ?? "");
      root.append(element);
      continue;
    }
    const paragraph = document.createElement("p");
    appendVisualCompletionMarkdown(paragraph, block.replace(/\r?\n/gu, " "));
    root.append(paragraph);
  }
  if (!root.hasChildNodes()) {
    root.textContent = markdown;
  }
  return root;
}

/** Decode only textual Markdown entities into text nodes. Never use
 * innerHTML here: completion documentation can be contributed by extensions. */
function decodeVisualCompletionMarkdownEntities(value: string): string {
  return value.replace(
    /&(?:nbsp|amp|lt|gt|quot|apos|#39|#x[0-9a-f]+|#[0-9]+);/giu,
    (entity) => {
      switch (entity.toLowerCase()) {
        case "&nbsp;":
          return " ";
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return "\"";
        case "&apos;":
        case "&#39;":
          return "'";
        default: {
          const hexadecimal = /^&#x([0-9a-f]+);$/iu.exec(entity);
          const decimal = /^&#([0-9]+);$/u.exec(entity);
          const digits = hexadecimal?.[1] ?? decimal?.[1];
          if (digits === undefined) {
            return entity;
          }
          const codePoint = Number.parseInt(digits, hexadecimal === null ? 10 : 16);
          return Number.isSafeInteger(codePoint) &&
              codePoint >= 0 &&
              codePoint <= 0x10ffff &&
              !(codePoint >= 0xd800 && codePoint <= 0xdfff)
            ? String.fromCodePoint(codePoint)
            : entity;
        }
      }
    },
  );
}

function appendVisualCompletionMarkdown(parent: HTMLElement, value: string): void {
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/gu;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? cursor;
    if (index > cursor) {
      parent.append(document.createTextNode(value.slice(cursor, index)));
    }
    const strongText = match[1];
    const codeText = match[2];
    const element = document.createElement(strongText === undefined ? "code" : "strong");
    element.textContent = strongText ?? codeText ?? "";
    parent.append(element);
    cursor = index + match[0].length;
  }
  if (cursor < value.length) {
    parent.append(document.createTextNode(value.slice(cursor)));
  }
}

function firstLine(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.split(/\r?\n/u, 1)[0]?.trim() || undefined;
}

function discardCompletionRequest(requestId: number): void {
  const pending = pendingCompletionRequests.get(requestId);
  if (pending === undefined) {
    return;
  }
  clearTimeout(pending.timer);
  pendingCompletionRequests.delete(requestId);
  pending.resolve(null);
}

function cancelPendingCompletionRequests(): void {
  for (const requestId of [...pendingCompletionRequests.keys()]) {
    discardCompletionRequest(requestId);
  }
}

function cancelPendingCompletionReferencePreviewRequests(): void {
  for (const [requestId, pending] of pendingCompletionReferencePreviewRequests) {
    clearTimeout(pending.timer);
    pendingCompletionReferencePreviewRequests.delete(requestId);
    pending.resolve(completionReferencePreviewFallback("引用目标已发生变化。"));
  }
}

/** Move by physical LaTeX source lines rather than browser soft-wrapped rows. */
function handleVisualLogicalLineArrow(
  view: EditorView,
  direction: -1 | 1,
): boolean {
  if (
    editorMode !== "visual" ||
    visualImeOwnsKeyboardInput(view) ||
    completionStatus(view.state) !== null
  ) {
    return false;
  }
  const selection = view.state.selection.main;
  if (!selection.empty) {
    visualLogicalLineGoalColumn = undefined;
    return false;
  }

  const currentLine = view.state.doc.lineAt(selection.head);
  const targetLineNumber = currentLine.number + direction;
  if (targetLineNumber < 1 || targetLineNumber > view.state.doc.lines) {
    return true;
  }
  const goalColumn = visualLogicalLineGoalColumn ??
    Math.max(0, selection.head - currentLine.from);
  const targetLine = view.state.doc.line(targetLineNumber);
  const formula = view.state.field(formulaField, false);
  const plan = planVisualLogicalLineNavigation(
    view.state.doc.toString(),
    { from: targetLine.from, to: targetLine.to },
    goalColumn,
    formula?.records ?? [],
  );
  if (plan === undefined) {
    visualLogicalLineGoalColumn = undefined;
    return false;
  }
  visualLogicalLineGoalColumn = plan.goalColumn;
  const sourceReveal: StructureSourceReveal | undefined =
    plan.reveal.kind === "formula"
      ? undefined
      : {
          ranges: plan.reveal.ranges,
          scopeFrom: plan.reveal.scopeFrom,
          scopeTo: plan.reveal.scopeTo,
          retention: "boundary-lines",
        };
  view.dispatch({
    selection: EditorSelection.cursor(plan.cursorOffset),
    effects: setStructureSourceReveal.of(sourceReveal),
    scrollIntoView: true,
    annotations: [
      visualLogicalLineNavigation.of(true),
      Transaction.addToHistory.of(false),
      Transaction.userEvent.of("select.keyboard"),
    ],
  });
  return true;
}

/**
 * Reveal collapsed source when a pointer lands on the logical boundary line
 * of either a display formula or a paired visual structure. Ordinary source
 * lines and formula widgets retain their existing pointer behaviour.
 */
function revealVisualCollapsedSourceAtPointer(
  view: EditorView,
  position: number,
  clickedLine?: { readonly from: number; readonly to: number },
): boolean {
  if (editorMode !== "visual" || visualImeOwnsKeyboardInput(view)) {
    return false;
  }
  const structure = view.state.field(structureField, false);
  const hiddenBoundaries = hiddenPairedEnvironmentBoundaries(structure);
  const document = view.state.doc;
  const safePosition = clampInteger(position, 0, document.length);
  const pointerLine = clickedLine === undefined
    ? document.lineAt(safePosition)
    : document.lineAt(clampInteger(clickedLine.from, 0, document.length));
  const source = document.toString();
  const formula = view.state.field(formulaField, false);

  // Display formulas use their own replacement layer instead of the structure
  // field. When a browser coordinate lands inside a collapsed card, use the
  // same reveal rule as logical Up/Down navigation. A physical source line is
  // accepted as a begin/end boundary only when the formula owns that complete
  // line; prose beside an inline display delimiter must keep the click.
  if (formula?.enabled === true && formula.visual) {
    const formulaPlans = formula.records
      .filter((record) =>
        record.display &&
        formula.rendered.has(record.id) &&
        !selectionIntersectsFormula(view.state, record)
      )
      .flatMap((record) => {
        const replacement = visualFormulaReplacementRange(view.state, record);
        const beginLine = document.lineAt(record.from);
        const endLine = document.lineAt(Math.max(record.from, record.to - 1));
        const ownsCompleteBoundaryLines =
          replacement.from === beginLine.from &&
          replacement.to >= endLine.to;
        if (!visualPointerTargetsCollapsedSource(
          safePosition,
          clickedLine === undefined ? undefined : pointerLine.number,
          ownsCompleteBoundaryLines
            ? [beginLine.number, endLine.number]
            : [],
          replacement,
        )) {
          return [];
        }
        const targetLine = pointerLine.number === endLine.number
          ? endLine
          : beginLine;
        const plan = planVisualLogicalLineNavigation(
          source,
          { from: targetLine.from, to: targetLine.to },
          pointerLine.number === targetLine.number
            ? Math.max(0, safePosition - pointerLine.from)
            : 0,
          formula.records,
        );
        return plan?.reveal.kind === "formula"
          ? [{ plan, span: record.to - record.from }]
          : [];
      })
      .sort((left, right) => left.span - right.span);
    const formulaPlan = formulaPlans[0]?.plan;
    if (formulaPlan !== undefined && formulaPlan.reveal.kind === "formula") {
      visualLogicalLineGoalColumn = undefined;
      view.dispatch({
        selection: EditorSelection.cursor(formulaPlan.cursorOffset),
        scrollIntoView: true,
        annotations: [
          Transaction.addToHistory.of(false),
          Transaction.userEvent.of("select.pointer"),
        ],
      });
      view.focus();
      return true;
    }
  }

  if (hiddenBoundaries.length === 0) {
    return false;
  }

  const candidateLines = new Map<
    number,
    { readonly from: number; readonly to: number }
  >();

  for (const { range } of hiddenBoundaries) {
    const sourceOffset = clampInteger(range.sourceFrom, 0, document.length);
    const boundaryLine = document.lineAt(sourceOffset);
    if (!visualPointerTargetsCollapsedSource(
      safePosition,
      clickedLine === undefined ? undefined : pointerLine.number,
      range.block ? [boundaryLine.number] : [],
      {
        from: Math.min(range.from, range.sourceFrom),
        to: Math.max(range.to, range.sourceTo),
      },
    )) {
      continue;
    }
    candidateLines.set(boundaryLine.number, {
      from: boundaryLine.from,
      to: boundaryLine.to,
    });
  }
  if (candidateLines.size === 0) {
    return false;
  }

  const plans = [...candidateLines.values()]
    .map((targetLine) => planVisualLogicalLineNavigation(
      source,
      targetLine,
      pointerLine.from === targetLine.from
        ? Math.max(0, safePosition - pointerLine.from)
        : 0,
      formula?.records ?? [],
    ))
    .filter((plan): plan is NonNullable<typeof plan> =>
      plan !== undefined && plan.reveal.kind === "environment-boundary"
    )
    .sort((left, right) => {
      if (
        left.reveal.kind !== "environment-boundary" ||
        right.reveal.kind !== "environment-boundary"
      ) {
        return 0;
      }
      return (left.reveal.scopeTo - left.reveal.scopeFrom) -
        (right.reveal.scopeTo - right.reveal.scopeFrom);
    });
  const plan = plans[0];
  if (plan === undefined || plan.reveal.kind !== "environment-boundary") {
    return false;
  }

  visualLogicalLineGoalColumn = undefined;
  view.dispatch({
    selection: EditorSelection.cursor(plan.cursorOffset),
    effects: setStructureSourceReveal.of({
      ranges: plan.reveal.ranges,
      scopeFrom: plan.reveal.scopeFrom,
      scopeTo: plan.reveal.scopeTo,
      retention: "boundary-lines",
    }),
    annotations: [
      Transaction.addToHistory.of(false),
      Transaction.userEvent.of("select.pointer"),
    ],
  });
  return true;
}

/**
 * Resolve the physical source line that the user actually clicked.
 *
 * `EditorView.posAtCoords` is intentionally biased toward a nearby editable
 * position. That is helpful for normal text, but a collapsed replacement can
 * leave an empty painted line for `\\begin{lemma}` while its nearest editable
 * position is already the theorem body on the next source line. Read the
 * managed `.cm-line` node before CodeMirror changes the selection, then map
 * that node back to a stable document line.
 */
function visualPointerLogicalLine(
  view: EditorView,
  event: MouseEvent,
): { readonly from: number; readonly to: number } | undefined {
  const lineElement = event.composedPath().find(
    (value): value is HTMLElement =>
      value instanceof HTMLElement && value.classList.contains("cm-line"),
  );
  if (lineElement === undefined || !view.contentDOM.contains(lineElement)) {
    return undefined;
  }
  try {
    const position = view.posAtDOM(lineElement, 0);
    const line = view.state.doc.lineAt(
      clampInteger(position, 0, view.state.doc.length),
    );
    return { from: line.from, to: line.to };
  } catch {
    return undefined;
  }
}

function handleVisualTab(view: EditorView): boolean {
  if (visualImeOwnsKeyboardInput(view)) {
    return false;
  }
  if (completionStatus(view.state) !== null) {
    // Enter is the only completion-accept key. Closing first prevents a
    // provider suggestion from stealing Tab before local delimiters or nested
    // snippet fields can advance.
    closeCompletion(view);
  }
  if (movePastVisualLatexCloser(view, true)) {
    return true;
  }
  const snippetExitBlocked = visualSnippetTabWouldLeaveEnvironment(view);
  if (!snippetExitBlocked && moveVisualSnippetField(view, 1)) {
    return true;
  }
  if (!snippetExitBlocked && nextSnippetField(view)) {
    return true;
  }
  if (movePastVisualLatexCloser(view, false)) {
    return true;
  }
  if (applyVisualAlignTab(view, 1)) {
    return true;
  }
  if (snippetExitBlocked) {
    // A generated environment may still have a final snippet cursor after
    // \end{...}. Do not let that hidden field bypass the unified Shift+Enter
    // exit rule. Alignment environments have already consumed this Tab above
    // by inserting `&`; ordinary environments simply retain the caret at their
    // last editable field.
    return true;
  }
  return inputFeatures.enabled
    ? requestInput(view, "tab")
    : (indentWithTab.run?.(view) ?? false);
}

function handleVisualShiftTab(view: EditorView): boolean {
  if (visualImeOwnsKeyboardInput(view)) {
    return false;
  }
  if (completionStatus(view.state) !== null) {
    closeCompletion(view);
  }
  return moveVisualSnippetField(view, -1) ||
    prevSnippetField(view) ||
    applyVisualAlignTab(view, -1) ||
    (inputFeatures.enabled
      ? requestInput(view, "shiftTab")
      : indentLess(view));
}

/**
 * Align-cell traversal is deliberately resolved inside CodeMirror.  Sending a
 * Tab request through the extension host leaves a short window in which a fast
 * following keystroke changes the selection and invalidates the response.  A
 * pure plan against the current EditorState is synchronous, preserves nested
 * snippet/closer priority above, and the normal update listener mirrors the
 * resulting edit or selection back to the TextDocument.
 */
function applyVisualAlignTab(view: EditorView, direction: -1 | 1): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }
  const plan = planVisualAlignTab(
    view.state.doc.toString(),
    selection.head,
    direction,
    inputFeatures.matrixEnvironments,
  );
  if (plan === undefined) {
    return false;
  }
  const changes = plan.range.start === plan.range.end && plan.insert.length === 0
    ? undefined
    : { from: plan.range.start, to: plan.range.end, insert: plan.insert };
  // The planner reports its cursor in the post-change document coordinate
  // space (for insertion it already includes `insert.length`).
  const cursor = clampInteger(
    plan.cursorOffset,
    0,
    view.state.doc.length + plan.insert.length,
  );
  if (changes === undefined && cursor === selection.head) {
    // A populated final cell intentionally consumes Tab without mutating the
    // document or escaping the environment.
    return true;
  }
  view.dispatch({
    ...(changes === undefined ? {} : { changes }),
    selection: EditorSelection.cursor(cursor),
    scrollIntoView: true,
    annotations: changes === undefined
      ? Transaction.addToHistory.of(false)
      : Transaction.userEvent.of("input.type"),
  });
  return true;
}

function refreshVisualCitationCompletion(
  message: Extract<VisualEditorHostMessage, { readonly type: "completionRefresh" }>,
): void {
  if (
    editor === undefined ||
    message.revision !== clientRevision ||
    message.projectContextKey !== projectContextKey ||
    editor.state.selection.main.from !== message.position ||
    editor.state.selection.main.to !== message.position ||
    visualLatexCompletionContextAt(
      editor.state.doc.toString(),
      message.position,
      inputFeatures.citationCommands,
    ).kind !== "citation"
  ) {
    return;
  }
  startCompletion(editor);
}

/**
 * CodeMirror can ask its asynchronous completion source before the mirrored
 * TextDocument has accepted the same edit. The host correctly rejects that
 * stale request, but without a later retry a newly typed `\\cite{}` or
 * line-start snippet such as `enu` appears to have no candidates. Retry empty
 * structured arguments on both typing and caret entry. After a document edit,
 * also retry command tokens and line-start snippet triggers; the latter scope
 * deliberately avoids reopening the whole LaTeX catalogue for ordinary prose.
 */
function scheduleCompletionAfterMirroredEdit(
  update: ViewUpdate,
  allowTypedTokenRetry: boolean,
): void {
  for (const timer of mirroredCompletionRetryTimers) {
    clearTimeout(timer);
  }
  mirroredCompletionRetryTimers = [];
  if (
    editor === undefined ||
    update.view.composing ||
    update.state.readOnly ||
    update.state.selection.main.from !== update.state.selection.main.head
  ) {
    return;
  }
  const head = update.state.selection.main.head;
  const completionContext = visualCompletionContextAtState(update.state, head);
  const emptyStructuredArgument = (
    completionContext.kind === "citation" ||
    completionContext.kind === "reference" ||
    completionContext.kind === "label-definition" ||
    completionContext.kind === "environment" ||
    completionContext.kind === "argument"
  ) && completionContext.query.trim().length === 0;
  const line = update.state.doc.lineAt(head);
  const linePrefixBeforeToken = update.state.sliceDoc(
    line.from,
    completionContext.from,
  );
  const characterBefore = update.state.sliceDoc(Math.max(0, head - 1), head);
  const typedCommand = allowTypedTokenRetry &&
    completionContext.kind === "command" &&
    shouldActivateVisualProviderCompletion({
      contextKind: completionContext.kind,
      query: completionContext.query,
      characterBefore,
      explicit: false,
    });
  const lineStartSnippet = allowTypedTokenRetry &&
    completionContext.kind === "snippet" &&
    linePrefixBeforeToken.trim().length === 0 &&
    shouldActivateVisualProviderCompletion({
      contextKind: completionContext.kind,
      query: completionContext.query,
      characterBefore,
      explicit: false,
    });
  if (!emptyStructuredArgument && !typedCommand && !lineStartSnippet) {
    return;
  }
  const revision = clientRevision;
  const documentLength = update.state.doc.length;
  // Let the mirrored TextDocument accept an edit before asking the host for
  // candidates. A selection move has no pending edit, but using the same short
  // delay prevents visible open/close churn while clicking into `\\cite{}`.
  const attempt = (): void => {
    const view = editor;
    if (
      view === undefined ||
      clientRevision !== revision ||
      view.state.doc.length !== documentLength ||
      view.state.selection.main.from !== head ||
      view.state.selection.main.head !== head
    ) {
      return;
    }
    if (completionStatus(view.state) === null) {
      startCompletion(view);
    }
  };
  // The first attempt normally follows the mirrored TextDocument edit. A
  // second guarded attempt covers a slow project-index acknowledgement: it is
  // a no-op while a valid picker is open and only retries when the first
  // asynchronous provider request closed without candidates.
  mirroredCompletionRetryTimers = [
    setTimeout(attempt, 220),
    setTimeout(attempt, 700),
  ];
}

function registerVisualSnippetFields(
  view: EditorView,
  fields: readonly AtomicCodeMirrorSnippetField[],
  exit: number,
): void {
  if (fields.length === 0) {
    return;
  }
  const ranges = fields
    .filter((field) =>
      Number.isSafeInteger(field.field) &&
      Number.isSafeInteger(field.from) &&
      Number.isSafeInteger(field.to) &&
      field.field >= 0 &&
      field.from >= 0 &&
      field.to >= field.from &&
      field.to <= view.state.doc.length
    )
    .map((field) => ({ ...field }));
  if (ranges.length === 0) {
    return;
  }
  // CodeMirror itself stores only one ActiveSnippet. The geometry captured by
  // applyAtomicCodeMirrorSnippet is retained in our stack instead, so a child
  // snippet cannot overwrite its parent's remaining fields.
  clearSnippet(view);
  const active = Math.min(...ranges.map((field) => field.field));
  const frames = view.state.field(visualSnippetFramesField);
  view.dispatch({
    effects: setVisualSnippetFrames.of([
      ...frames,
      {
        active,
        ranges,
        exit: clampInteger(exit, 0, view.state.doc.length),
      },
    ]),
    annotations: Transaction.addToHistory.of(false),
  });
}

function moveVisualSnippetField(
  view: EditorView,
  direction: -1 | 1,
): boolean {
  const original = view.state.field(visualSnippetFramesField);
  if (original.length === 0) {
    return false;
  }
  const frames = [...original];

  while (frames.length > 0) {
    const top = frames.at(-1)!;
    const fields = [...new Set(top.ranges.map((range) => range.field))]
      .sort((left, right) => left - right);
    const activeIndex = fields.indexOf(top.active);
    if (activeIndex < 0) {
      // A host mirror or a nested replacement can delete an empty final field
      // while leaving the rest of the frame mappable.  Such a stale frame has
      // already been consumed.  Never wrap it back to fields[0] -- that would
      // make a later Tab re-enter a subscript or exponent that the user has
      // just left.
      frames.pop();
      continue;
    }
    if (direction > 0) {
      const target = fields[activeIndex + 1];
      if (target !== undefined) {
        const isFinalField = target === fields.at(-1);
        if (isFinalField) {
          // CodeMirror deactivates a snippet as soon as Tab selects its final
          // field.  Mirror that behaviour in our nested stack: text may still
          // be entered at the final cursor, but the next Tab belongs to the
          // enclosing snippet instead of returning to this child's first
          // field.  This is the key invariant for chains such as
          // inline-math -> subscript -> power.
          frames.pop();
        } else {
          frames[frames.length - 1] = { ...top, active: target };
        }
        return selectVisualSnippetFieldRanges(
          view,
          top.ranges,
          frames,
          target,
        );
      }
      frames.pop();
      const selectionAtExit = view.state.selection.ranges.every((range) =>
        range.empty && range.head === top.exit
      );
      view.dispatch({
        ...(!selectionAtExit
          ? { selection: EditorSelection.cursor(top.exit) }
          : {}),
        effects: setVisualSnippetFrames.of(frames),
        scrollIntoView: !selectionAtExit,
        annotations: Transaction.addToHistory.of(false),
      });
      // One Tab consumes at most one valid frame.  Collapsing several frames
      // in one command is what used to skip directly out of an enclosing math
      // or theorem environment.
      return true;
    }

    const target = activeIndex > 0 ? fields[activeIndex - 1] : undefined;
    if (target !== undefined) {
      frames[frames.length - 1] = { ...top, active: target };
      return selectVisualSnippetField(view, frames, target);
    }
    frames.pop();
    const parent = frames.at(-1);
    if (parent !== undefined) {
      return selectVisualSnippetField(view, frames, parent.active);
    }
  }

  view.dispatch({
    effects: setVisualSnippetFrames.of([]),
    annotations: Transaction.addToHistory.of(false),
  });
  return false;
}

function visualSnippetTabWouldLeaveEnvironment(view: EditorView): boolean {
  const frame = view.state.field(visualSnippetFramesField).at(-1);
  if (frame === undefined) {
    return false;
  }
  const fields = [...new Set(frame.ranges.map((range) => range.field))]
    .sort((left, right) => left - right);
  const activeIndex = fields.indexOf(frame.active);
  if (activeIndex < 0) {
    return false;
  }
  const nextField = fields[activeIndex + 1];
  const nextRanges = nextField === undefined
    ? []
    : frame.ranges.filter((range) => range.field === nextField);
  const target = nextRanges.length === 0
    ? frame.exit
    : Math.min(...nextRanges.map((range) => range.from));
  return visualTabTargetLeavesEnvironment(
    view.state.doc.toString(),
    view.state.selection.main.head,
    target,
  );
}

function selectVisualSnippetField(
  view: EditorView,
  frames: readonly VisualSnippetFrame[],
  field: number,
): boolean {
  const frame = frames.at(-1);
  return frame === undefined
    ? false
    : selectVisualSnippetFieldRanges(view, frame.ranges, frames, field);
}

function selectVisualSnippetFieldRanges(
  view: EditorView,
  sourceRanges: readonly VisualSnippetFieldRange[],
  frames: readonly VisualSnippetFrame[],
  field: number,
): boolean {
  const ranges = sourceRanges.filter((range) => range.field === field);
  if (ranges.length === 0) {
    return false;
  }
  view.dispatch({
    selection: EditorSelection.create(ranges.map((range) =>
      EditorSelection.range(range.from, range.to)
    )),
    effects: setVisualSnippetFrames.of(frames),
    scrollIntoView: true,
    annotations: Transaction.addToHistory.of(false),
  });
  return true;
}

function handleVisualSpace(view: EditorView): boolean {
  if (visualImeOwnsKeyboardInput(view)) {
    return false;
  }
  return inputFeatures.enabled && inputFeatures.manualTrigger === "space"
    ? requestInput(view, "space")
    : false;
}

function handleVisualEnter(view: EditorView): boolean {
  if (visualImeOwnsKeyboardInput(view)) {
    return false;
  }
  if (acceptCompletion(view)) {
    return true;
  }
  const range = view.state.selection.main;
  if (!range.empty) {
    return false;
  }
  const source = view.state.doc.toString();
  if (inputFeatures.enabled) {
    const listPlan = planVisualListEnter(source, range.head);
    if (listPlan !== undefined) {
      view.dispatch({
        changes: {
          from: listPlan.range.start,
          to: listPlan.range.end,
          insert: listPlan.insert,
        },
        selection: EditorSelection.cursor(listPlan.cursorOffset),
        scrollIntoView: true,
        annotations: [
          Transaction.userEvent.of("input"),
          isolateHistory.of("full"),
        ],
      });
      return true;
    }
  }
  if (!inputFeatures.enabled || !inputFeatures.matrixShortcuts) {
    return false;
  }

  const region = innermostLatexMathRegion(source, range.head);
  const environmentName = region?.environmentName;
  const inConfiguredMatrix = environmentName !== undefined &&
    inputFeatures.matrixEnvironments.some(
      (configured) =>
        configured === environmentName ||
        configured.replace(/\*$/u, "") === environmentName.replace(/\*$/u, ""),
    );
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const inLeftRightPair = planLeftRightEnter(source, range.head, { eol }) !== undefined;
  if (inConfiguredMatrix || inLeftRightPair) {
    return requestInput(view, "enter");
  }

  // A normal newline must be synchronous. Delegating every Enter to the
  // extension host leaves a short reply window in which the user's next
  // keystroke is inserted on the old line.
  return insertNewlineAndIndent(view);
}

function handleVisualShiftEnter(view: EditorView): boolean {
  if (visualImeOwnsKeyboardInput(view)) {
    return false;
  }
  if (completionStatus(view.state) !== null) {
    closeCompletion(view);
  }
  return applyVisualEnvironmentExit(view, false);
}

const VISUAL_FORMAT_MAX_SOURCE_LENGTH = 5_000_000;
const VISUAL_FORMAT_MAX_LINE_COUNT = 200_000;

/**
 * Normalize only LaTeX leading indentation in one local transaction. The fine
 * plan maps every selection accurately; the coalesced plan stays within the
 * bounded Webview-to-host edit protocol used by long documents.
 */
function runVisualFormatDocument(view: EditorView): boolean {
  if (toolbarBusy) {
    setStatus("warning", "当前任务结束后才能排版源码缩进。", 3_500);
    return true;
  }
  if (view.state.readOnly) {
    setStatus("warning", "当前文档为只读，不能排版源码缩进。", 3_500);
    return true;
  }
  if (
    visualImeCompositionActive ||
    view.composing ||
    visualImeOwnsKeyboardInput(view)
  ) {
    setStatus("warning", "请先完成当前中文输入，再执行一键排版。", 3_500);
    return true;
  }

  const sourceBefore = view.state.doc.toString();
  if (
    sourceBefore.length > VISUAL_FORMAT_MAX_SOURCE_LENGTH ||
    view.state.doc.lines > VISUAL_FORMAT_MAX_LINE_COUNT
  ) {
    setStatus(
      "warning",
      "文档过大，为避免可视化编辑器卡顿，本次没有执行一键排版。",
      5_000,
    );
    return true;
  }
  const plan = planVisualLatexIndentationFormat(sourceBefore, {
    indentUnit: view.state.facet(indentUnit),
  });
  if (plan.exceededChangeLimit) {
    setStatus(
      "warning",
      "需要调整的行数超过安全上限，本次没有执行部分排版。",
      5_000,
    );
    return true;
  }
  if (plan.changes.length === 0) {
    setStatus("info", "源码缩进已经规范，无需调整。", 3_500);
    view.focus();
    return true;
  }

  const fineChanges = plan.changes.map(({ from, to, insert }) => ({
    from,
    to,
    insert,
  }));
  const fineChangeSet = view.state.changes(fineChanges);
  const mappedSelection = view.state.selection.map(fineChangeSet);
  const transport = coalesceVisualLatexIndentationChanges(
    sourceBefore,
    plan.changes,
  );
  if (transport.exceededLimit || transport.changes.length === 0) {
    setStatus(
      "warning",
      "排版结果超过安全同步上限，本次没有修改文档。",
      5_000,
    );
    return true;
  }

  if (completionStatus(view.state) !== null) {
    closeCompletion(view);
  }
  clearSnippet(view);
  hideReferenceHover();
  closeVirtualCompletion();
  closeVirtualMathPreview();
  const beforeCaret = view.state.selection.main.head;
  applyingHostOperation = true;
  try {
    view.dispatch({
      changes: transport.changes.map(({ from, to, insert }) => ({
        from,
        to,
        insert,
      })),
      selection: mappedSelection,
      effects: setVisualSnippetFrames.of([]),
      annotations: [
        Transaction.userEvent.of("input.format"),
        isolateHistory.of("full"),
      ],
    });
  } finally {
    applyingHostOperation = false;
  }
  rememberAtomicVisualHistory({
    beforeText: sourceBefore,
    afterText: view.state.doc.toString(),
    beforeCaret,
    afterCaret: view.state.selection.main.head,
  });
  const opaqueNote = plan.skippedOpaqueLineCount > 0
    ? `；已原样保留 ${plan.skippedOpaqueLineCount} 行 verbatim/minted 等内容`
    : "";
  setStatus(
    "info",
    `已规范 ${plan.changedLineCount} 行源码缩进${opaqueNote}。`,
    5_000,
  );
  view.focus();
  return true;
}

/** Apply environment exit synchronously so the next keystroke cannot race a
 * round-trip through the Extension Host. */
function applyVisualEnvironmentExit(
  view: EditorView,
  displayOnly: boolean,
): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }
  const plan = planVisualEnvironmentExit(
    view.state.doc.toString(),
    selection.head,
    { displayOnly },
  );
  if (plan === undefined) {
    return false;
  }
  // Shift+Enter owns the structural exit. Retire both CodeMirror's native
  // snippet state and TeXLeaf's nested frame stack so a later Tab cannot jump
  // back into, or beyond, the environment that has just been left.
  clearSnippet(view);
  const changes = plan.range.start === plan.range.end && plan.insert.length === 0
    ? undefined
    : { from: plan.range.start, to: plan.range.end, insert: plan.insert };
  view.dispatch({
    ...(changes === undefined ? {} : { changes }),
    selection: EditorSelection.cursor(plan.cursorOffset),
    effects: setVisualSnippetFrames.of([]),
    scrollIntoView: true,
    annotations: changes === undefined
      ? Transaction.addToHistory.of(false)
      : [Transaction.userEvent.of("input"), isolateHistory.of("full")],
  });
  return true;
}

function handleVisualBackspace(view: EditorView): boolean {
  if (visualImeOwnsKeyboardInput(view)) {
    return false;
  }
  const range = view.state.selection.main;
  if (editorMode === "visual") {
    const structure = view.state.field(structureField, false);
    if (structure?.enabled === true) {
      const boundaries = hiddenPairedEnvironmentBoundaries(structure).map(
        ({ range: boundary }) => boundary,
      );
      if (range.empty) {
        // Every atomic source replacement can make CodeMirror's character
        // deletion consume a whole command or preview block. Reveal it first.
        structure.atomic.between(Math.max(0, range.head - 1), range.head, (from, to) => {
          if (to === range.head && from < to) {
            boundaries.push({ from, to, sourceFrom: from, sourceTo: to, block: false });
          }
        });
      }
      const reveal = planVisualHiddenEnvironmentBoundaryBackspace(
        { start: range.from, end: range.to },
        boundaries,
      );
      if (reveal !== undefined) {
        const sourceReveal = pairedEnvironmentSourceReveal(
          structure.records,
          reveal.sourceFrom,
          reveal.sourceTo,
          view.state.doc.toString(),
        );
        if (sourceReveal !== undefined) {
          const expanded: StructureSourceReveal = {
            ...sourceReveal,
            ranges: [{ from: reveal.sourceFrom, to: reveal.sourceTo }, ...sourceReveal.ranges],
            scopeFrom: Math.min(reveal.sourceFrom, sourceReveal.scopeFrom),
            scopeTo: Math.max(reveal.sourceTo, sourceReveal.scopeTo),
            retention: "boundary-lines",
          };
          view.dispatch({
            selection: EditorSelection.cursor(sourceRevealCaretPosition(view.state, expanded, reveal.sourceTo)),
            effects: [setStructureSourceReveal.of(expanded),
              ...(!structure.preambleExpanded && structure.records.some(record =>
                record.kind === "preamble" && reveal.sourceFrom < record.to && reveal.sourceTo > record.from)
                ? [setPreambleExpanded.of(true)] : [])],
            scrollIntoView: true,
            annotations: Transaction.addToHistory.of(false),
          });
          return true;
        }
      }
    }
  }
  if (
    inputFeatures.enabled &&
    inputFeatures.autoDeleteMathDelimiters &&
    range.empty
  ) {
    const pair = emptyMathDelimiterOffsets(view.state.doc.toString(), range.head);
    if (pair !== undefined) {
      view.dispatch({
        changes: { from: pair.start, to: pair.end, insert: "" },
        selection: EditorSelection.cursor(pair.start),
        scrollIntoView: true,
        annotations: [
          Transaction.userEvent.of("delete.backward"),
          isolateHistory.of("before"),
        ],
      });
      return true;
    }
  }
  // CodeMirror normally groups a quickly typed character and the immediately
  // following Backspace into one net-zero history event. In a text-backed
  // custom editor that makes the next Ctrl+Z skip over the deleted character
  // and undo an older host edit (for example the automatically inserted pair).
  // Close the current input group first, then own the deletion so one Undo
  // restores exactly what this Backspace removed.
  view.dispatch({
    annotations: [
      Transaction.addToHistory.of(false),
      isolateHistory.of("before"),
    ],
  });
  return deleteBracketPair(view) || deleteCharBackward(view);
}

function insertVisualMathPairTrigger(
  view: EditorView,
  opener: "(" | "[" | "{",
): boolean {
  if (
    !inputFeatures.enabled ||
    visualImeOwnsKeyboardInput(view)
  ) {
    return false;
  }
  const range = view.state.selection.main;
  const source = view.state.doc.toString();
  const region = innermostLatexMathRegion(source, range.head);
  if (region === undefined) {
    // In prose, retain CodeMirror's ordinary close-bracket behavior. In math,
    // TeXLeaf's automatic bracket snippets own the pair and tab stops.
    return false;
  }
  // Keep the enclosing snippet active. CodeMirror has a single active snippet
  // slot, so applying a second `( ${field} )` snippet here would discard the
  // fraction/environment fields that contain it. Its close-bracket state gives
  // us the same paired delimiter while mapping the outer snippet ranges through
  // the edit. Tab can then leave this tracked pair before advancing the outer
  // snippet (for example numerator -> denominator).
  const pairTransaction = insertBracket(view.state, opener);
  if (pairTransaction !== null) {
    view.dispatch(pairTransaction);
    return true;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: opener },
    selection: EditorSelection.cursor(range.from + opener.length),
    annotations: Transaction.userEvent.of("input.type"),
  });
  return true;
}

function movePastVisualLatexCloser(
  view: EditorView,
  deferToActiveSnippet: boolean,
): boolean {
  const range = view.state.selection.main;
  if (!range.empty) {
    return false;
  }
  const closer = view.state.sliceDoc(range.head, range.head + 1);
  const isSingleCharacterCloser = closer === ")" || closer === "]" || closer === "}";
  if (isSingleCharacterCloser) {
    const transaction = insertBracket(view.state, closer);
    if (transaction !== null) {
      view.dispatch(transaction);
      return true;
    }
  }

  if (
    deferToActiveSnippet &&
    view.state.field(visualSnippetFramesField).length > 0
  ) {
    // A CodeMirror-tracked pair typed *inside* the current field was handled
    // above. Every untracked closer supplied by the snippet itself must wait
    // until moveVisualSnippetField has had its turn, including `)`, `]`, `}`
    // and command-shaped closers separated by whitespace. Otherwise a plan
    // such as `\lim_{ @0 \to @1 } @2` can jump over @1 from @0. The late
    // invocation of this function still handles `\right)` / `\]` when the
    // environment guard intentionally prevents the snippet from leaving.
    return false;
  }

  // A closer supplied by a built-in or user snippet is not registered
  // in CodeMirror's close-bracket state. Structural Tabout still knows that
  // `}` closes the local `_ { ... }` group and also recognizes command-shaped
  // closers such as `\\right)`, `\\)` and `\\]`. Run it even when the next
  // character is a backslash or whitespace, before a display-math snippet's
  // environment guard can consume Tab without moving the caret.
  const plan = planTabout(view.state.doc.toString(), range.head);
  if (plan === undefined || plan.from !== range.head || plan.to <= range.head) {
    if (!isSingleCharacterCloser) {
      return false;
    }
    // `planTabout` intentionally requires a math region. Reference, citation,
    // label and ordinary command arguments also need a local Tab target when
    // their `}` was inserted by a provider rather than CodeMirror's bracket
    // tracker. At this point there is no active snippet field ending here, so
    // crossing exactly this one visible closer cannot skip an inner field or
    // leave the surrounding environment.
    view.dispatch({
      selection: EditorSelection.cursor(range.head + 1),
      scrollIntoView: true,
      annotations: Transaction.addToHistory.of(false),
    });
    return true;
  }
  view.dispatch({
    selection: EditorSelection.cursor(plan.to),
    scrollIntoView: true,
    annotations: Transaction.addToHistory.of(false),
  });
  return true;
}

function requestInput(view: EditorView, action: VisualEditorInputAction): boolean {
  const selection = currentSelection(view.state);
  if (selection.anchor !== selection.head) {
    return false;
  }
  const requestId = ++nextInputRequestId;
  const revision = clientRevision;
  const timer = setTimeout(() => {
    const pending = pendingInputRequests.get(requestId);
    if (pending === undefined) {
      return;
    }
    pendingInputRequests.delete(requestId);
    if (
      editor !== undefined &&
      clientRevision === pending.revision &&
      sameSelection(currentSelection(editor.state), pending.selection)
    ) {
      runInputFallback(editor, pending.action);
    }
  }, action === "auto" ? 2_500 : 450);
  pendingInputRequests.set(requestId, { action, revision, selection, timer });
  post({
    protocol: VISUAL_EDITOR_PROTOCOL,
    type: "inputRequest",
    requestId,
    revision,
    action,
    selection,
  });
  return true;
}

function runInputFallback(view: EditorView, action: VisualEditorInputAction): void {
  applyingHostOperation = true;
  try {
    switch (action) {
      case "auto":
        break;
      case "tab":
        indentWithTab.run?.(view);
        break;
      case "shiftTab":
        indentLess(view);
        break;
      case "space": {
        const range = view.state.selection.main;
        view.dispatch({
          changes: { from: range.from, to: range.to, insert: " " },
          selection: EditorSelection.cursor(range.from + 1),
        });
        break;
      }
      case "enter":
      case "shiftEnter":
        insertNewlineAndIndent(view);
        break;
    }
    view.focus();
  } finally {
    applyingHostOperation = false;
  }
}

function takeInputRequest(requestId: number): PendingInputRequest | undefined {
  const pending = pendingInputRequests.get(requestId);
  if (pending === undefined) {
    return undefined;
  }
  clearTimeout(pending.timer);
  pendingInputRequests.delete(requestId);
  return pending;
}

function discardInputRequest(requestId: number | undefined): void {
  if (requestId !== undefined) {
    takeInputRequest(requestId);
  }
}

function cancelPendingInputRequests(): void {
  for (const requestId of [...pendingInputRequests.keys()]) {
    takeInputRequest(requestId);
  }
}

function validSnippetModifiers(
  modifiers: readonly {
    readonly from: number;
    readonly to: number;
    readonly expectedText: string;
  }[],
  source: string,
  primaryFrom: number,
  primaryTo: number,
): boolean {
  let previousEnd = -1;
  for (const modifier of modifiers) {
    if (
      !validRange(modifier.from, modifier.to, source.length) ||
      modifier.from < previousEnd ||
      (modifier.from < primaryTo && modifier.to > primaryFrom) ||
      source.slice(modifier.from, modifier.to) !== modifier.expectedText
    ) {
      return false;
    }
    previousEnd = modifier.to;
  }
  return true;
}

function validRange(from: number, to: number, length: number): boolean {
  return Number.isSafeInteger(from) && Number.isSafeInteger(to) &&
    from >= 0 && to >= from && to <= length;
}

function sameSelection(
  left: VisualEditorSelection,
  right: VisualEditorSelection,
): boolean {
  return left.anchor === right.anchor && left.head === right.head;
}

function buildAiIssueDecorations(
  issues: readonly VisualEditorAiIssue[],
  documentLength: number,
): DecorationSet {
  const ranges = issues
    .filter((issue) => validRange(issue.from, issue.to, documentLength) && issue.from < issue.to)
    .sort((left, right) => left.from - right.from || left.to - right.to)
    .map((issue) => Decoration.mark({
      class: issue.severity === 0
        ? "texleaf-ai-issue texleaf-ai-issue-error"
        : issue.severity === 1
          ? "texleaf-ai-issue texleaf-ai-issue-warning"
          : "texleaf-ai-issue",
      attributes: {
        "data-texleaf-ai-issue": issue.id,
      },
    }).range(issue.from, issue.to));
  return Decoration.set(ranges, true);
}

function buildDiagnosticDecorations(
  diagnostics: readonly VisualEditorDiagnostic[],
  documentLength: number,
): DecorationSet {
  const ranges = diagnostics.flatMap((diagnostic) => {
    const range = visibleDiagnosticRange(diagnostic, documentLength);
    if (range === undefined) {
      return [];
    }
    const severityClass = diagnostic.severity === 0
      ? "texleaf-diagnostic-error"
      : diagnostic.severity === 1
        ? "texleaf-diagnostic-warning"
        : diagnostic.severity === 2
          ? "texleaf-diagnostic-information"
          : "texleaf-diagnostic-hint";
    return [Decoration.mark({
      class: `texleaf-diagnostic ${severityClass}`,
      attributes: { "data-texleaf-diagnostic": diagnostic.id },
    }).range(range.from, range.to)];
  });
  return Decoration.set(ranges, true);
}

function visibleDiagnosticRange(
  diagnostic: VisualEditorDiagnostic,
  documentLength: number,
): { readonly from: number; readonly to: number } | undefined {
  if (!validRange(diagnostic.from, diagnostic.to, documentLength) || documentLength === 0) {
    return undefined;
  }
  if (diagnostic.from < diagnostic.to) {
    return { from: diagnostic.from, to: diagnostic.to };
  }
  if (diagnostic.from < documentLength) {
    return { from: diagnostic.from, to: diagnostic.from + 1 };
  }
  return { from: documentLength - 1, to: documentLength };
}

function handleIssueMarkerMouseOver(event: MouseEvent): boolean {
  const marker = issueMarker(event.target);
  if (marker === undefined || editor === undefined) {
    return false;
  }
  const aiId = marker.dataset.texleafAiIssue;
  const diagnosticId = marker.dataset.texleafDiagnostic;
  if (aiId !== undefined) {
    hoveredIssueCard = { kind: "ai", id: aiId, anchor: marker };
  } else if (diagnosticId !== undefined) {
    hoveredIssueCard = { kind: "diagnostic", id: diagnosticId, anchor: marker };
  } else {
    return false;
  }
  cancelIssueCardHide();
  updateIssueCard(editor.state);
  return false;
}

function handleIssueMarkerMouseOut(event: MouseEvent): boolean {
  const marker = issueMarker(event.target);
  if (marker === undefined) {
    return false;
  }
  const related = event.relatedTarget;
  if (
    related instanceof Node &&
    (marker.contains(related) || aiSuggestionElement.contains(related))
  ) {
    return false;
  }
  scheduleIssueCardHide();
  return false;
}

function issueMarker(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }
  const marker = target.closest<HTMLElement>(
    "[data-texleaf-ai-issue], [data-texleaf-diagnostic]",
  );
  return marker ?? undefined;
}

function scheduleIssueCardHide(): void {
  cancelIssueCardHide();
  issueCardHideTimer = setTimeout(() => {
    issueCardHideTimer = undefined;
    if (issueCardPointerInside) {
      return;
    }
    hoveredIssueCard = undefined;
    if (editor !== undefined) {
      updateIssueCard(editor.state);
    }
  }, 120);
}

function cancelIssueCardHide(): void {
  if (issueCardHideTimer !== undefined) {
    clearTimeout(issueCardHideTimer);
    issueCardHideTimer = undefined;
  }
}

type IssueCardTarget =
  | { readonly kind: "ai"; readonly issue: VisualEditorAiIssue }
  | { readonly kind: "diagnostic"; readonly diagnostic: VisualEditorDiagnostic };

function updateIssueCard(state: EditorState): void {
  const issues = state.field(aiIssueField, false)?.issues ?? [];
  const diagnostics = state.field(diagnosticField, false)?.diagnostics ?? [];
  setMenuButtonLabel(aiReviewButton, issues.length > 0
    ? `AI 检查 (${issues.length})`
    : "AI 检查");
  setMenuButtonLabel(topAiReviewButton, issues.length > 0
    ? `AI 检查 (${issues.length})`
    : "AI 检查");
  let target: IssueCardTarget | undefined;
  let anchor: HTMLElement | undefined;
  if (hoveredIssueCard?.anchor.isConnected === true) {
    anchor = hoveredIssueCard.anchor;
    if (hoveredIssueCard.kind === "ai") {
      const issue = issues.find((candidate) => candidate.id === hoveredIssueCard?.id);
      if (issue !== undefined) {
        target = { kind: "ai", issue };
      }
    } else {
      const diagnostic = diagnostics.find(
        (candidate) => candidate.id === hoveredIssueCard?.id,
      );
      if (diagnostic !== undefined) {
        target = { kind: "diagnostic", diagnostic };
      }
    }
  }
  const head = state.selection.main.head;
  if (target === undefined) {
    const issue = issues.find((candidate) => offsetInsideProblem(head, candidate));
    if (issue !== undefined) {
      target = { kind: "ai", issue };
    } else {
      const diagnostic = diagnostics.find((candidate) =>
        offsetInsideProblem(head, candidate)
      );
      if (diagnostic !== undefined) {
        target = { kind: "diagnostic", diagnostic };
      }
    }
  }
  if (target === undefined) {
    activeAiIssueId = undefined;
    if (issueCardPointerInside) {
      return;
    }
    aiSuggestionElement.classList.remove("visible");
    aiSuggestionElement.setAttribute("aria-hidden", "true");
    return;
  }
  let from: number;
  if (target.kind === "ai") {
    const issue = target.issue;
    activeAiIssueId = issue.id;
    from = issue.from;
    aiSuggestionElement.dataset.kind = "ai";
    delete aiSuggestionElement.dataset.severity;
    delete aiSuggestionElement.dataset.hasInsight;
    aiSuggestionTitle.textContent = `TeXLeaf AI · ${aiIssueCategoryLabel(issue.category)}`;
    aiSuggestionMessage.textContent = issue.message;
    aiSuggestionExplanation.textContent = issue.explanation;
    aiSuggestionReplacement.textContent = issue.replacement.length > 0
      ? issue.replacement
      : "删除这段文字";
  } else {
    const diagnostic = target.diagnostic;
    const lineDiagnostics = diagnosticsForSameLine(state, diagnostic, diagnostics);
    activeAiIssueId = undefined;
    from = diagnostic.from;
    aiSuggestionElement.dataset.kind = "diagnostic";
    aiSuggestionElement.dataset.severity = diagnosticSeverityKind(
      Math.min(...lineDiagnostics.map((candidate) => candidate.severity)),
    );
    if (lineDiagnostics.length === 1) {
      const source = diagnostic.source?.trim() || "VS Code";
      const code = diagnostic.code === undefined ? "" : ` · ${diagnostic.code}`;
      aiSuggestionTitle.textContent = `${source} · ${diagnosticSeverityLabel(diagnostic.severity)}${code}`;
      aiSuggestionMessage.textContent = compactDiagnosticMessage(
        diagnostic.message,
      );
    } else {
      aiSuggestionTitle.textContent = `本行有 ${lineDiagnostics.length} 个 AI 写作问题`;
      renderDiagnosticCardItems(lineDiagnostics);
    }
    const insight = diagnosticInsights.get(diagnostic.id);
    if (insight?.status === "ready") {
      aiSuggestionElement.dataset.hasInsight = "true";
      aiSuggestionExplanation.textContent = `AI 解释：${insight.explanation}`;
      aiSuggestionReplacement.textContent = insight.suggestion;
    } else {
      delete aiSuggestionElement.dataset.hasInsight;
      aiSuggestionExplanation.textContent = "";
      aiSuggestionReplacement.textContent = "";
      requestDiagnosticInsight(diagnostic);
    }
  }
  aiSuggestionElement.classList.add("visible");
  aiSuggestionElement.setAttribute("aria-hidden", "false");
  positionIssueCard(from, anchor);
}

function diagnosticsForSameLine(
  state: EditorState,
  selected: VisualEditorDiagnostic,
  diagnostics: readonly VisualEditorDiagnostic[],
): readonly VisualEditorDiagnostic[] {
  const selectedLine = diagnosticLineNumber(state, selected);
  return diagnostics
    .filter((diagnostic) => diagnosticLineNumber(state, diagnostic) === selectedLine)
    .sort((left, right) =>
      left.severity - right.severity ||
      left.from - right.from ||
      left.to - right.to ||
      left.message.localeCompare(right.message)
    );
}

function diagnosticLineNumber(
  state: EditorState,
  diagnostic: VisualEditorDiagnostic,
): number {
  const position = Math.max(0, Math.min(diagnostic.from, state.doc.length));
  return state.doc.lineAt(position).number;
}

function renderDiagnosticCardItems(
  diagnostics: readonly VisualEditorDiagnostic[],
): void {
  aiSuggestionMessage.replaceChildren(
    ...diagnostics.map((diagnostic) => {
      const item = document.createElement("div");
      item.className = "texleaf-diagnostic-card-item";
      item.dataset.severity = diagnosticSeverityKind(diagnostic.severity);

      const source = diagnostic.source?.trim() || "VS Code";
      const code = diagnostic.code === undefined ? "" : ` · ${diagnostic.code}`;
      const metadata = document.createElement("div");
      metadata.className = "texleaf-diagnostic-card-meta";
      metadata.textContent = `${source} · ${diagnosticSeverityLabel(diagnostic.severity)}${code}`;

      const message = document.createElement("div");
      message.className = "texleaf-diagnostic-card-message";
      message.textContent = compactDiagnosticMessage(diagnostic.message);
      item.append(metadata, message);
      return item;
    }),
  );
}

function offsetInsideProblem(
  offset: number,
  problem: { readonly from: number; readonly to: number },
): boolean {
  return problem.from === problem.to
    ? offset === problem.from
    : offset >= problem.from && offset <= problem.to;
}

function aiIssueCategoryLabel(category: string): string {
  const normalized = category.trim().toLowerCase();
  if (normalized.includes("punct") || normalized.includes("标点")) return "标点";
  if (normalized.includes("grammar") || normalized.includes("语法")) return "语法";
  if (normalized.includes("spell") || normalized.includes("拼写")) return "拼写";
  if (normalized.includes("style") || normalized.includes("风格")) return "表达";
  if (normalized.includes("word") || normalized.includes("措辞")) return "措辞";
  return category.trim().length > 0 ? category.trim() : "语言建议";
}

function diagnosticSeverityLabel(severity: number): string {
  if (severity === 0) return "错误";
  if (severity === 1) return "警告";
  if (severity === 2) return "信息";
  return "提示";
}

function diagnosticSeverityKind(
  severity: number,
): "error" | "warning" | "info" | "hint" {
  if (severity === 0) return "error";
  if (severity === 1) return "warning";
  if (severity === 2) return "info";
  return "hint";
}

function compactDiagnosticMessage(message: string): string {
  return message
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function requestDiagnosticInsight(diagnostic: VisualEditorDiagnostic): void {
  if (diagnosticInsights.has(diagnostic.id)) {
    return;
  }
  diagnosticInsightRequestSequence += 1;
  const requestId = diagnosticInsightRequestSequence;
  diagnosticInsights.set(diagnostic.id, { status: "pending", requestId });
  post({
    protocol: VISUAL_EDITOR_PROTOCOL,
    type: "diagnosticInsightRequest",
    requestId,
    revision: clientRevision,
    diagnosticId: diagnostic.id,
  });
}

function pruneDiagnosticInsights(
  diagnostics: readonly VisualEditorDiagnostic[],
): void {
  const live = new Set(diagnostics.map((diagnostic) => diagnostic.id));
  for (const id of diagnosticInsights.keys()) {
    if (!live.has(id)) {
      diagnosticInsights.delete(id);
    }
  }
}

function positionIssueCard(from: number, anchor: HTMLElement | undefined): void {
  if (editor === undefined) {
    return;
  }
  const anchorRect = anchor?.getBoundingClientRect() ?? editor.coordsAtPos(from);
  if (anchorRect === null || anchorRect === undefined) {
    return;
  }
  const cardRect = aiSuggestionElement.getBoundingClientRect();
  const editorRect = editor.scrollDOM.getBoundingClientRect();
  const margin = 8;
  const gap = 6;
  const minimumLeft = Math.max(margin, editorRect.left + 2);
  const maximumRight = Math.min(window.innerWidth - margin, editorRect.right - 2);
  const maximumLeft = Math.max(minimumLeft, maximumRight - cardRect.width);
  const left = Math.max(minimumLeft, Math.min(anchorRect.left, maximumLeft));
  const bottomSpace = Math.min(window.innerHeight - margin, editorRect.bottom - 2);
  const topSpace = Math.max(margin, editorRect.top + 2);
  let top = anchorRect.bottom + gap;
  if (top + cardRect.height > bottomSpace) {
    top = anchorRect.top - gap - cardRect.height;
  }
  top = Math.max(topSpace, Math.min(top, bottomSpace - cardRect.height));
  aiSuggestionElement.style.left = `${Math.round(left)}px`;
  aiSuggestionElement.style.top = `${Math.round(top)}px`;
}

function runAiIssueAction(action: "apply" | "ignore"): void {
  if (activeAiIssueId === undefined) {
    return;
  }
  post({
    protocol: VISUAL_EDITOR_PROTOCOL,
    type: "aiIssueAction",
    revision: clientRevision,
    issueId: activeAiIssueId,
    action,
  });
}

interface StructurePresentation {
  readonly decorations: DecorationSet;
  readonly atomic: DecorationSet;
  readonly selectionRanges: VisualSelectionPresentationRangeSet;
}

function emptyStructurePresentation(): StructurePresentation {
  return {
    decorations: Decoration.none,
    atomic: Decoration.none,
    selectionRanges: buildVisualSelectionPresentationRangeSet([]),
  };
}

function buildStructurePresentation(
  records: readonly VisualStructureRecord[],
  formulaRecords: readonly VisualFormulaRecord[],
  preambleExpanded: boolean,
  sourceReveal: StructureSourceReveal | undefined,
  state: EditorState,
): StructurePresentation {
  const decorations: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const selectionRanges: VisualSelectionPresentationRange[] = [];
  const addSelectionRange = (from: number, to: number): void => {
    if (from < to && validRange(from, to, state.doc.length)) {
      selectionRanges.push({ from, to });
    }
  };
  // Materialise the CodeMirror rope once for the presentation passes that
  // genuinely need source text. Reference chips must never rescan every label
  // from inside their per-record loop.
  const sourceText = state.doc.toString();
  const hasReferenceChips = records.some((record) => record.kind === "reference");
  const structureReferenceIndex = hasReferenceChips
    ? indexVisualStructureReferences(sourceText, records)
    : new Map<string, VisualStructureReferencePresentation>();
  const formulaReferenceCounts = new Map<string, number>();
  for (const formula of hasReferenceChips ? formulaRecords : []) {
    for (const label of formula.labels) {
      formulaReferenceCounts.set(
        label.key,
        (formulaReferenceCounts.get(label.key) ?? 0) + 1,
      );
    }
  }
  const manualBibliographies = records.filter(
    (record): record is VisualBibliographyRecord =>
      record.kind === "bibliography" && record.manual,
  );

  const addReplacement = (
    range: VisualReplacementRange,
    widget: WidgetType | undefined,
    force = false,
  ): boolean => {
    if (
      !validRange(range.from, range.to, state.doc.length) ||
      range.from === range.to
    ) {
      return false;
    }
    const revealedBySource = sourceRevealTouchesRange(
      sourceReveal,
      range.sourceFrom,
      range.sourceTo,
    );
    if (!force && !revealedBySource) {
      addSelectionRange(range.sourceFrom, range.sourceTo);
    }
    if (
      !force && (
        selectionTouchesRange(state, range.sourceFrom, range.sourceTo) ||
        revealedBySource
      )
    ) {
      return false;
    }
    const replacementSpec = {
      block: range.block,
      inclusiveStart: range.block,
      // A terminal block must absorb CodeMirror's zero-length EOF text block;
      // otherwise both that native block and this widget render the last line
      // number. Every non-terminal/inline replacement stays end-exclusive.
      inclusiveEnd: visualBlockReplacementInclusiveEnd(
        range.block,
        range.to,
        state.doc.length,
      ),
    } as const;
    const decoration = widget === undefined
      ? Decoration.replace(replacementSpec)
      : Decoration.replace({ widget, ...replacementSpec });
    decorations.push(decoration.range(range.from, range.to));
    atomic.push(decoration.range(range.from, range.to));
    return true;
  };

  const groupedFrontMatter: VisualReplacementRange[] = [];
  for (const record of records) {
    if (record.kind !== "maketitle" || record.frontMatter === undefined) continue;
    const { replacement: range, replacements = [] } = record.frontMatter;
    const ranges = [range, ...replacements];
    if (ranges.some(item => selectionTouchesRange(state, item.sourceFrom, item.sourceTo) ||
      sourceRevealTouchesRange(sourceReveal, item.sourceFrom, item.sourceTo))) continue;
    if (addReplacement(range, new MakeTitleWidget(record, false, true))) {
      groupedFrontMatter.push(range);
      for (const extra of replacements) if (addReplacement(extra, undefined)) groupedFrontMatter.push(extra);
    }
  }

  for (const record of records) {
    if (record.kind !== "maketitle") continue;
    for (const range of record.metadataReplacements ?? []) {
      if (!groupedFrontMatter.some(group => range.from >= group.from && range.to <= group.to) && addReplacement(range, undefined)) groupedFrontMatter.push(range);
    }
  }

  const collapsedFootnotes: VisualFootnoteRecord[] = [];
  for (const record of records) {
    if (record.kind === "footnote" && !groupedFrontMatter.some(range => record.from >= range.from && record.to <= range.to) &&
        addReplacement({ from: record.from, to: record.to, sourceFrom: record.from, sourceTo: record.to, block: false }, new FootnoteWidget(record))) {
      collapsedFootnotes.push(record);
    }
  }
  for (const record of records) {
    const start = visualStructureStart(record);
    if (record.kind === "footnote" || collapsedFootnotes.some(note => start > note.from && start < note.to)) continue;
    if (record.kind !== "preamble" && groupedFrontMatter.some(range => start >= range.from && start < range.to)) {
      continue;
    }
    if (
      record.kind !== "bibliography" &&
      manualBibliographies.some((bibliography) =>
        start > bibliography.replacement.from &&
        start < bibliography.replacement.to
      )
    ) {
      continue;
    }

    switch (record.kind) {
      case "preamble": {
        if (!validRange(record.from, record.to, state.doc.length)) {
          break;
        }
        if (!preambleExpanded) {
          const replacement: VisualReplacementRange = {
            from: record.from,
            to: record.to,
            sourceFrom: record.from,
            sourceTo: record.to,
            block: true,
          };
          addReplacement(
            replacement,
            new PreambleHeaderWidget(record, false),
            true,
          );
          break;
        }
        decorations.push(
          Decoration.widget({
            widget: new PreambleHeaderWidget(record, true),
            block: true,
            side: -1,
          }).range(record.from),
        );
        addPreambleLineDecorations(decorations, record, state);
        break;
      }
      case "maketitle": {
        const insideFrame = frameContainsSourceRange(
          records,
          record.replacement.sourceFrom,
          record.replacement.sourceTo,
        );
        addReplacement(
          insideFrame
            ? { ...record.replacement, block: true }
            : record.replacement,
          new MakeTitleWidget(record, insideFrame),
        );
        break;
      }
      case "heading":
        addHeadingDecorations(
          decorations,
          atomic,
          record,
          sourceReveal,
          state,
          addSelectionRange,
        );
        break;
      case "frame":
        addFrameDecorations(decorations, record, state, addReplacement);
        break;
      case "abstract":
        addAbstractDecorations(
          decorations,
          record,
          sourceReveal,
          state,
          addReplacement,
        );
        break;
      case "keywords":
        addReplacement(
          record.replacement,
          new KeywordsWidget(
            record,
            containingAbstractForKeywords(records, record) !== undefined,
          ),
        );
        break;
      case "theorem":
        addTheoremDecorations(
          decorations,
          atomic,
          record,
          state,
          addReplacement,
          frameContainsSourceRange(
            records,
            record.begin.sourceFrom,
            record.end.sourceTo,
          ),
        );
        break;
      case "list": {
        const containingTheorem = innermostContainingTheorem(records, record);
        addListDecorations(
          decorations,
          atomic,
          record,
          state,
          addReplacement,
          containingTheorem?.style,
          innermostContainingFrame(records, record) !== undefined,
          addSelectionRange,
        );
        break;
      }
      case "label":
        addReplacement(record.replacement, new LabelWidget(record));
        break;
      case "reference": {
        const valid = validRange(record.from, record.to, state.doc.length) &&
          record.from < record.to;
        const revealedBySource = sourceRevealTouchesRange(
          sourceReveal,
          record.from,
          record.to,
        );
        if (valid && !revealedBySource) {
          addSelectionRange(record.from, record.to);
        }
        if (
          valid &&
          !selectionTouchesRange(state, record.from, record.to) &&
          !revealedBySource
        ) {
          const decoration = Decoration.replace({
            widget: new ReferenceWidget(
              record,
              referenceChipPresentations(
                structureReferenceIndex,
                formulaReferenceCounts,
                record.keys,
              ),
            ),
            inclusive: false,
          });
          decorations.push(decoration.range(record.from, record.to));
          atomic.push(decoration.range(record.from, record.to));
        }
        break;
      }
      case "table":
        addReplacement(
          record.replacement,
          new TableWidget(
            record,
            frameContainsSourceRange(
              records,
              record.replacement.sourceFrom,
              record.replacement.sourceTo,
            ),
          ),
        );
        break;
      case "tikzcd":
        addReplacement(
          record.replacement,
          new TikzcdWidget(
            record,
            frameContainsSourceRange(
              records,
              record.replacement.sourceFrom,
              record.replacement.sourceTo,
            ),
          ),
        );
        break;
      case "figure":
      case "tikzpicture":
        addReplacement(
          record.replacement,
          new TikzpictureWidget(
            record,
            frameContainsSourceRange(
              records,
              record.replacement.sourceFrom,
              record.replacement.sourceTo,
            ),
          ),
        );
        break;
      case "image":
        addReplacement(
          record.replacement,
          new ImageWidget(
            record,
            frameContainsSourceRange(
              records,
              record.replacement.sourceFrom,
              record.replacement.sourceTo,
            ),
          ),
        );
        break;
      case "citation": {
        const valid = validRange(record.from, record.to, state.doc.length) &&
          record.from < record.to;
        const revealedBySource = sourceRevealTouchesRange(
          sourceReveal,
          record.from,
          record.to,
        );
        if (valid && !revealedBySource) {
          addSelectionRange(record.from, record.to);
        }
        if (
          valid &&
          !selectionTouchesRange(state, record.from, record.to) &&
          !revealedBySource
        ) {
          const decoration = Decoration.replace({
            widget: new CitationWidget(record),
            inclusive: false,
          });
          decorations.push(decoration.range(record.from, record.to));
          atomic.push(decoration.range(record.from, record.to));
        }
        break;
      }
      case "textStyle":
        addTextStyleDecorations(
          decorations,
          atomic,
          record,
          sourceReveal,
          state,
          addSelectionRange,
        );
        break;
      case "accent": {
        const valid = validRange(record.from, record.to, state.doc.length) &&
          record.from < record.to;
        if (valid) {
          addSelectionRange(record.from, record.to);
        }
        if (
          valid &&
          !selectionTouchesRange(state, record.from, record.to) &&
          !sourceRevealTouchesRange(sourceReveal, record.from, record.to)
        ) {
          const decoration = Decoration.replace({
            widget: new AccentWidget(record),
            inclusive: false,
          });
          decorations.push(decoration.range(record.from, record.to));
          atomic.push(decoration.range(record.from, record.to));
        }
        break;
      }
      case "bibliography":
        addReplacement(
          record.replacement,
          new BibliographyWidget(
            record,
            frameContainsSourceRange(
              records,
              record.replacement.sourceFrom,
              record.replacement.sourceTo,
            ),
          ),
        );
        break;
      case "tableOfContents":
        addReplacement(
          record.replacement,
          new TableOfContentsWidget(
            record,
            frameContainsSourceRange(
              records,
              record.replacement.sourceFrom,
              record.replacement.sourceTo,
            ),
          ),
        );
        break;
      case "comment":
        addReplacement(record.replacement, new CommentWidget(record.replacement));
        break;
      case "documentEnd":
        addReplacement(
          record.replacement,
          new DocumentEndWidget(
            record,
            visualDocumentEndFollowingLinePosition(
                state.doc,
                record.replacement.sourceTo,
              ) !== undefined,
            visualTerminalSyntheticEofLinePosition(
                state.doc,
                record.replacement.sourceTo,
              ) !== undefined,
          ),
        );
        break;
    }
  }
  return {
    decorations: Decoration.set(decorations, true),
    atomic: Decoration.set(atomic, true),
    selectionRanges: buildVisualSelectionPresentationRangeSet(selectionRanges),
  };
}

function addTextStyleDecorations(
  decorations: Range<Decoration>[],
  atomic: Range<Decoration>[],
  record: VisualTextStyleRecord,
  sourceReveal: StructureSourceReveal | undefined,
  state: EditorState,
  addSelectionRange: (from: number, to: number) => void,
): void {
  const transparent = record.transparent === true;
  if (
    !validRange(record.from, record.to, state.doc.length) ||
    !validRange(record.contentFrom, record.contentTo, state.doc.length)
  ) {
    return;
  }
  const revealedBySource = (
    sourceRevealTouchesRange(sourceReveal, record.prefixFrom, record.prefixTo) ||
    sourceRevealTouchesRange(sourceReveal, record.suffixFrom, record.suffixTo)
  );
  if (transparent) {
    if (!revealedBySource) {
      addSelectionRange(record.prefixFrom, record.prefixTo);
      addSelectionRange(record.suffixFrom, record.suffixTo);
    }
  } else {
    addSelectionRange(record.from, record.to);
  }
  const wrapperExposed = transparent
    ? selectionTouchesRange(state, record.prefixFrom, record.prefixTo) ||
      selectionTouchesRange(state, record.suffixFrom, record.suffixTo) ||
      revealedBySource
    : selectionTouchesRange(state, record.from, record.to) || revealedBySource;
  if (wrapperExposed) {
    return;
  }
  for (const [from, to, edge] of [
    [record.prefixFrom, record.prefixTo, "prefix"],
    [record.suffixFrom, record.suffixTo, "suffix"],
  ] as const) {
    if (from >= to || !validRange(from, to, state.doc.length)) {
      continue;
    }
    const hidden = Decoration.replace({
      ...(record.command === "footnote" ? { widget: new AccentWidget({ kind: "accent", from, to, text: edge === "prefix" ? "〔脚注：" : "〕" }) } : {}),
      ...((transparent || record.contentFrom === record.contentTo) && edge === "prefix"
        ? { widget: new TransparentWrapperEditWidget(record) }
        : {}),
      inclusive: false,
    });
    decorations.push(hidden.range(from, to));
    atomic.push(hidden.range(from, to));
  }
  if (record.contentFrom >= record.contentTo || transparent) {
    return;
  }
  const classes = [
    "texleaf-text-style",
    record.bold ? "texleaf-text-style-bold" : "",
    record.italic ? "texleaf-text-style-italic" : "",
    record.underline ? "texleaf-text-style-underline" : "",
    record.strike ? "texleaf-text-style-strike" : "",
    record.smallCaps ? "texleaf-text-style-smallcaps" : "",
  ].filter(Boolean).join(" ");
  const styles: string[] = [];
  if (safeVisualStyleValue(record.foreground)) {
    styles.push(`color:${record.foreground}`);
  }
  if (safeVisualStyleValue(record.background)) {
    styles.push(`background-color:${record.background}`);
    styles.push("padding:0 .08em");
    styles.push("border-radius:2px");
  }
  if (safeVisualStyleValue(record.border)) {
    styles.push(`box-shadow:inset 0 0 0 1px ${record.border}`);
  }
  decorations.push(
    Decoration.mark({
      class: classes,
      attributes: {
        title: `可视化 ${record.command}；点击文字可编辑完整 LaTeX 命令`,
        ...(styles.length === 0 ? {} : { style: styles.join(";") }),
      },
    }).range(record.contentFrom, record.contentTo),
  );
}

class TransparentWrapperEditWidget extends WidgetType {
  public constructor(private readonly record: VisualTextStyleRecord) {
    super();
  }

  public override eq(other: TransparentWrapperEditWidget): boolean {
    return this.record.command === other.record.command &&
      this.record.editLabel === other.record.editLabel;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const chip = createInlineEnvironmentEditChip(
      view,
      this.record.contentFrom === this.record.contentTo ? this.record.from : this.record.prefixFrom,
      this.record.contentFrom === this.record.contentTo ? this.record.to : this.record.prefixTo,
      this.record.editLabel ?? `编辑 \\${this.record.command}`,
      this.record.contentFrom === this.record.contentTo,
    );
    chip.classList.add("texleaf-transparent-wrapper-edit-chip");
    chip.title = `展开并编辑 ${this.record.command} 的完整包装源码`;
    return chip;
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

class CommentWidget extends WidgetType {
  public constructor(private readonly range: VisualReplacementRange) { super(); }
  public override eq(other: CommentWidget): boolean {
    return this.range.sourceFrom === other.range.sourceFrom && this.range.sourceTo === other.range.sourceTo;
  }
  public override toDOM(view: EditorView): HTMLElement {
    const chip = createInlineEnvironmentEditChip(view, this.range.sourceFrom, this.range.sourceTo, "注释 · 点击展开");
    chip.classList.add("texleaf-comment-preview");
    return this.range.block ? createMeasuredBlockShell(chip, "texleaf-comment-shell") : chip;
  }
  public override ignoreEvent(): boolean { return true; }
}

class AccentWidget extends WidgetType {
  public constructor(private readonly record: VisualAccentRecord) {
    super();
  }

  public override eq(other: AccentWidget): boolean {
    return this.record.text.length > 0 && this.record.text === other.record.text;
  }

  public override toDOM(view: EditorView): HTMLElement {
    if (this.record.text.length === 0) {
      const source = view.state.doc.sliceString(this.record.from, this.record.to).replace(/\s+/gu, " ");
      const chip = createInlineEnvironmentEditChip(view, this.record.from, this.record.to, `源码 · ${source.slice(0, 64)}`, true);
      chip.classList.add("texleaf-source-command");
      chip.title = "在可视化中展开并编辑完整原始命令";
      return chip;
    }
    const glyph = document.createElement("span");
    glyph.className = "texleaf-accent-glyph";
    glyph.tabIndex = 0;
    glyph.textContent = this.record.text;
    glyph.title = "LaTeX 文本符号或重音字符；点击编辑原始命令";
    wireSourcePointer(glyph, view, this.record.from, this.record.to);
    return glyph;
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

function safeVisualStyleValue(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && value.length <= 160 &&
    !/[;{}<>]/u.test(value);
}

function addPreambleLineDecorations(
  decorations: Range<Decoration>[],
  record: VisualPreambleRecord,
  state: EditorState,
): void {
  let position = record.from;
  let lineIndex = 0;
  while (position < record.to && position <= state.doc.length) {
    const line = state.doc.lineAt(position);
    const isLast = line.to + 1 >= record.to || line.to >= state.doc.length;
    const classes = [
      "texleaf-preamble-line",
      ...(lineIndex === 0 ? ["texleaf-preamble-first-line"] : []),
      ...(isLast ? ["texleaf-preamble-last-line"] : []),
    ].join(" ");
    decorations.push(Decoration.line({ class: classes }).range(line.from));
    if (isLast) {
      break;
    }
    position = line.to + 1;
    lineIndex += 1;
  }
}

function addHeadingDecorations(
  decorations: Range<Decoration>[],
  atomic: Range<Decoration>[],
  record: VisualHeadingRecord,
  sourceReveal: StructureSourceReveal | undefined,
  state: EditorState,
  addSelectionRange: (from: number, to: number) => void,
): void {
  if (!validRange(record.from, record.to, state.doc.length)) {
    return;
  }
  if (sourceRevealTouchesRange(sourceReveal, record.from, record.to)) {
    return;
  }
  decorations.push(
    Decoration.line({
      class: `texleaf-heading-line texleaf-heading-line-level-${record.level}`,
    }).range(state.doc.lineAt(record.from).from),
  );
  for (const [from, to] of [
    [record.prefixFrom, record.prefixTo],
    [record.suffixFrom, record.suffixTo],
  ] as const) {
    if (from < to) {
      addSelectionRange(from, to);
    }
    if (from < to && !selectionTouchesRange(state, from, to)) {
      const decoration = Decoration.replace({ inclusive: false });
      decorations.push(decoration.range(from, to));
      atomic.push(decoration.range(from, to));
    }
  }
  if (record.generatedTitle && !selectionTouchesRange(state, record.from, record.to)) {
    decorations.push(Decoration.widget({
      widget: new HeadingEditWidget(record, true), side: -1,
    }).range(record.to));
  }
  if (record.contentFrom < record.contentTo) {
    if (record.number !== undefined) {
      decorations.push(
        Decoration.widget({
          widget: new HeadingNumberWidget(record.number, record.level),
          side: -1,
        }).range(record.contentFrom),
      );
    }
    decorations.push(
      Decoration.mark({
        class: `texleaf-heading texleaf-heading-level-${record.level}`,
        attributes: {
          title: `${record.command} 标题；直接编辑文字，或点击“编辑标题”展开完整命令`,
          "data-texleaf-line-number-anchor-id": String(record.from),
        },
      }).range(record.contentFrom, record.contentTo),
    );
  }
  decorations.push(
    Decoration.widget({
      widget: new HeadingEditWidget(record),
      side: 1,
    }).range(record.to),
  );
}

class HeadingNumberWidget extends WidgetType {
  public constructor(
    private readonly number: string,
    private readonly level: number,
  ) {
    super();
  }

  public override eq(other: HeadingNumberWidget): boolean {
    return this.number === other.number && this.level === other.level;
  }

  public override toDOM(): HTMLElement {
    const number = document.createElement("span");
    number.className =
      `texleaf-heading texleaf-heading-level-${this.level} texleaf-heading-number`;
    number.textContent = this.number;
    number.setAttribute("aria-label", `章节编号 ${this.number}`);
    return number;
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

class HeadingEditWidget extends WidgetType {
  public constructor(private readonly record: VisualHeadingRecord, private readonly showTitle = false) {
    super();
  }

  public override eq(other: HeadingEditWidget): boolean {
    return this.record.command === other.record.command &&
      this.record.title === other.record.title && this.showTitle === other.showTitle;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = this.showTitle
      ? `texleaf-heading texleaf-heading-generated texleaf-heading-level-${this.record.level}`
      : "texleaf-environment-edit-chip texleaf-heading-edit-chip";
    button.textContent = this.showTitle ? this.record.title : "编辑标题";
    button.title = `原位展开并编辑完整 \\${this.record.command} 命令`;
    button.setAttribute("aria-label", `编辑完整 \\${this.record.command} 命令`);
    wireSourcePointer(button, view, this.record.from, this.record.to);
    return button;
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

function addTheoremDecorations(
  decorations: Range<Decoration>[],
  _atomic: Range<Decoration>[],
  record: VisualTheoremRecord,
  state: EditorState,
  addReplacement: (
    range: VisualReplacementRange,
    widget: WidgetType | undefined,
    force?: boolean,
  ) => boolean,
  insideFrame: boolean,
): void {
  const beginReplaced = addReplacement(
    record.begin,
    new TheoremBeginWidget(record, insideFrame),
  );
  for (const label of record.labels) {
    const alreadyCoveredByHeader = label.replacement.from >= record.begin.from &&
      label.replacement.to <= record.begin.to;
    if (!alreadyCoveredByHeader) {
      addReplacement(label.replacement, undefined);
    }
  }
  const endReplaced = addReplacement(
    record.end,
    new TheoremEndWidget(record, insideFrame),
  );
  if (!validRange(record.bodyFrom, record.bodyTo, state.doc.length)) {
    return;
  }
  const decoratedLines = new Set<number>();
  const addTheoremLine = (
    position: number,
    sourceBoundary: "begin" | "end" | "widget-end" | undefined = undefined,
  ): void => {
    const line = state.doc.lineAt(
      Math.max(0, Math.min(position, state.doc.length)),
    );
    if (decoratedLines.has(line.from)) {
      return;
    }
    decoratedLines.add(line.from);
    decorations.push(
      Decoration.line({
        class: [
          "texleaf-theorem-line",
          `texleaf-theorem-${record.style}`,
          !record.begin.block && line.from === state.doc.lineAt(record.begin.sourceFrom).from ? "texleaf-theorem-inline-start" : "",
          !record.end.block && line.from === state.doc.lineAt(record.end.sourceFrom).from ? "texleaf-theorem-inline-end" : "",
          sourceBoundary === undefined ? "" : "texleaf-theorem-source-boundary",
          sourceBoundary === undefined ? "" : `texleaf-theorem-source-${sourceBoundary}`,
        ].filter(Boolean).join(" "),
      }).range(line.from),
    );
  };
  if (!beginReplaced && record.begin.block) {
    addTheoremLine(record.begin.sourceFrom, "begin");
  }
  if (!record.begin.block) addTheoremLine(record.begin.sourceFrom);
  let position = record.bodyFrom;
  while (position < record.bodyTo) {
    const line = state.doc.lineAt(position);
    addTheoremLine(line.from);
    if (line.to >= record.bodyTo || line.to >= state.doc.length) {
      break;
    }
    position = line.to + 1;
  }
  if (record.end.block) {
    addTheoremLine(record.end.sourceFrom, endReplaced ? "widget-end" : "end");
  }
  else addTheoremLine(record.end.sourceFrom);
}

function addFrameDecorations(
  decorations: Range<Decoration>[],
  record: VisualFrameRecord,
  state: EditorState,
  addReplacement: (
    range: VisualReplacementRange,
    widget: WidgetType | undefined,
    force?: boolean,
  ) => boolean,
): void {
  addReplacement(record.begin, new FrameBeginWidget(record));
  for (const titleCommand of record.titleCommands) {
    addReplacement(titleCommand, undefined);
  }
  addReplacement(record.end, new FrameEndWidget(record));
  if (!validRange(record.bodyFrom, record.bodyTo, state.doc.length)) {
    return;
  }
  let position = record.bodyFrom;
  while (position < record.bodyTo) {
    const line = state.doc.lineAt(position);
    decorations.push(
      Decoration.line({ class: "texleaf-frame-line" }).range(line.from),
    );
    if (line.to >= record.bodyTo || line.to >= state.doc.length) {
      break;
    }
    position = line.to + 1;
  }
}

function addAbstractDecorations(
  decorations: Range<Decoration>[],
  record: VisualAbstractRecord,
  sourceReveal: StructureSourceReveal | undefined,
  state: EditorState,
  addReplacement: (
    range: VisualReplacementRange,
    widget: WidgetType | undefined,
    force?: boolean,
  ) => boolean,
): void {
  const beginReplaced = addReplacement(record.begin, new AbstractBeginWidget(record));
  const endReplaced = addReplacement(record.end, new AbstractEndWidget(record));
  if (!validRange(record.bodyFrom, record.bodyTo, state.doc.length)) {
    return;
  }
  const decoratedLines = new Set<number>();
  const addAbstractLine = (
    position: number,
    sourceBoundary: "begin" | "end" | "widget-end" | undefined = undefined,
    layoutClass: string | undefined = undefined,
  ): void => {
    const line = state.doc.lineAt(
      Math.max(0, Math.min(position, state.doc.length)),
    );
    if (decoratedLines.has(line.from)) {
      return;
    }
    decoratedLines.add(line.from);
    decorations.push(
      Decoration.line({
        class: [
          "texleaf-abstract-line",
          `texleaf-abstract-${record.role}`,
          sourceBoundary === undefined ? "" : `texleaf-abstract-source-${sourceBoundary}`,
          layoutClass ?? "",
        ].filter(Boolean).join(" "),
      }).range(line.from),
    );
  };
  if (!beginReplaced && record.begin.block) {
    addAbstractLine(record.begin.sourceFrom, "begin");
  }
  const bodyLines: Array<{ readonly from: number; readonly to: number; readonly text: string }> = [];
  let position = record.bodyFrom;
  while (position < record.bodyTo) {
    const line = state.doc.lineAt(position);
    bodyLines.push({ from: line.from, to: line.to, text: line.text });
    if (line.to >= record.bodyTo || line.to >= state.doc.length) {
      break;
    }
    position = line.to + 1;
  }
  const layoutKinds = bodyLines.map((line) => abstractLayoutSpacingKind(line.text));
  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index]!;
    const layoutKind = layoutKinds[index];
    const sourceExposed = sourceRevealTouchesRange(sourceReveal, line.from, line.to);
    if (layoutKind !== undefined && !sourceExposed) {
      addReplacement({
        from: line.from,
        to: line.to,
        sourceFrom: line.from,
        sourceTo: line.to,
        block: false,
      }, undefined);
    }
    const adjacentToLayout = line.text.trim().length === 0 &&
      (layoutKinds[index - 1] !== undefined || layoutKinds[index + 1] !== undefined);
    const layoutClass = sourceExposed
      ? undefined
      : layoutKind === undefined
        ? adjacentToLayout ? "texleaf-abstract-adjacent-blank" : undefined
        : layoutKind === "none"
          ? "texleaf-abstract-layout-line"
          : `texleaf-abstract-layout-line texleaf-abstract-layout-${layoutKind}`;
    addAbstractLine(line.from, undefined, layoutClass);
  }
  if (record.end.block) {
    addAbstractLine(record.end.sourceFrom, endReplaced ? "widget-end" : "end");
  }
}

function isAbstractLayoutOnlyLine(value: string): boolean {
  return abstractLayoutSpacingKind(value) !== undefined;
}

function abstractLayoutSpacingKind(
  value: string,
): "none" | "small" | "medium" | "large" | undefined {
  const source = value.replace(/%[^\r\n]*$/u, "").trim();
  if (/^\\smallskip\b\s*$/u.test(source)) {
    return "small";
  }
  if (/^(?:\\medskip\b|\\vspace\*?\s*\{[^{}]*\})\s*$/u.test(source)) {
    return "medium";
  }
  if (/^\\bigskip\b\s*$/u.test(source)) {
    return "large";
  }
  return /^(?:\\noindent|\\par)\b\s*$/u.test(source) ? "none" : undefined;
}

function addListDecorations(
  decorations: Range<Decoration>[],
  atomic: Range<Decoration>[],
  record: VisualListRecord,
  state: EditorState,
  addReplacement: (
    range: VisualReplacementRange,
    widget: WidgetType | undefined,
    force?: boolean,
  ) => boolean,
  theoremStyle: VisualTheoremRecord["style"] | undefined,
  insideFrame: boolean,
  addSelectionRange: (from: number, to: number) => void,
): void {
  addReplacement(
    record.begin,
    new ListBoundaryWidget(record, "begin", theoremStyle, insideFrame),
  );
  addReplacement(
    record.end,
    new ListBoundaryWidget(record, "end", theoremStyle, insideFrame),
  );
  for (const item of record.items) {
    if (
      !validRange(item.from, item.to, state.doc.length) ||
      item.from === item.to
    ) {
      continue;
    }
    addSelectionRange(item.sourceFrom, item.sourceTo);
    if (selectionTouchesRange(state, item.sourceFrom, item.sourceTo)) {
      continue;
    }
    const decoration = Decoration.replace({
      widget: new ListItemWidget(record.environment, item),
      inclusive: false,
    });
    decorations.push(decoration.range(item.from, item.to));
    atomic.push(decoration.range(item.from, item.to));
  }
}

function innermostContainingTheorem(
  records: readonly VisualStructureRecord[],
  nested: VisualListRecord,
): VisualTheoremRecord | undefined {
  return records
    .filter((record): record is VisualTheoremRecord =>
      record.kind === "theorem" &&
      nested.begin.sourceFrom >= record.bodyFrom &&
      nested.end.sourceTo <= record.bodyTo
    )
    .sort((left, right) =>
      (left.bodyTo - left.bodyFrom) - (right.bodyTo - right.bodyFrom)
    )[0];
}

function innermostContainingFrame(
  records: readonly VisualStructureRecord[],
  nested: VisualListRecord,
): VisualFrameRecord | undefined {
  return records
    .filter((record): record is VisualFrameRecord =>
      record.kind === "frame" &&
      nested.begin.sourceFrom >= record.bodyFrom &&
      nested.end.sourceTo <= record.bodyTo
    )
    .sort((left, right) =>
      (left.bodyTo - left.bodyFrom) - (right.bodyTo - right.bodyFrom)
    )[0];
}

function frameContainsSourceRange(
  records: readonly VisualStructureRecord[],
  sourceFrom: number,
  sourceTo: number,
): boolean {
  return records.some((record) =>
    record.kind === "frame" &&
    sourceFrom >= record.bodyFrom &&
    sourceTo <= record.bodyTo
  );
}

function containingAbstractForKeywords(
  records: readonly VisualStructureRecord[],
  nested: VisualKeywordsRecord,
): VisualAbstractRecord | undefined {
  return records
    .filter((record): record is VisualAbstractRecord =>
      record.kind === "abstract" &&
      nested.replacement.sourceFrom >= record.bodyFrom &&
      nested.replacement.sourceTo <= record.bodyTo
    )
    .sort((left, right) =>
      (left.bodyTo - left.bodyFrom) - (right.bodyTo - right.bodyFrom)
    )[0];
}

function createMeasuredBlockShell(
  content: HTMLElement,
  className: string,
  view?: EditorView,
  sourceFrom?: number,
): HTMLDivElement {
  const shell = document.createElement("div");
  shell.className = `texleaf-measured-block-shell ${className}`;
  shell.append(content);
  if (view !== undefined && sourceFrom !== undefined) {
    installVisualSourceIndentation(shell, view, sourceFrom);
  }
  return shell;
}

function installVisualSourceIndentation(
  element: HTMLElement,
  view: EditorView,
  sourceFrom: number,
): void {
  const bounded = clampInteger(sourceFrom, 0, view.state.doc.length);
  element.classList.add("texleaf-source-indented-block");
  element.dataset.texleafIndentFrom = String(bounded);
  refreshVisualSourceIndentation(element, view.state, bounded);
}

function refreshVisualSourceIndentation(
  element: HTMLElement,
  state: EditorState,
  sourceFrom: number,
): void {
  const bounded = clampInteger(sourceFrom, 0, state.doc.length);
  const line = state.doc.lineAt(bounded);
  const prefix = state.sliceDoc(line.from, bounded);
  const columns = visualSourceIndentationColumns(prefix, state.tabSize);
  const columnText = String(columns);
  if (element.dataset.texleafIndentColumns === columnText) {
    return;
  }
  element.dataset.texleafIndentColumns = columnText;
  element.style.setProperty("--texleaf-source-indent", `${columns}ch`);
}

class PreambleHeaderWidget extends WidgetType {
  public constructor(
    private readonly record: VisualPreambleRecord,
    private readonly expanded: boolean,
  ) {
    super();
  }

  public override eq(other: PreambleHeaderWidget): boolean {
    return this.record.to === other.record.to && this.expanded === other.expanded;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "texleaf-preamble-header";
    button.setAttribute("aria-expanded", String(this.expanded));
    button.title = this.expanded
      ? "收起文档导言区；源码内容不会被删除"
      : "展开并编辑完整文档导言区";
    const main = document.createElement("span");
    main.className = "texleaf-preamble-header-main";
    const label = document.createElement("span");
    label.textContent = this.expanded ? "隐藏文档导言区" : "显示文档导言区";
    const help = document.createElement("span");
    help.className = "texleaf-preamble-help";
    help.textContent = "?";
    help.title = "导言区保持完整 LaTeX 源码和语法高亮，可直接编辑";
    main.append(label, help);
    const chevron = document.createElement("span");
    chevron.className = "texleaf-preamble-chevron";
    chevron.textContent = this.expanded ? "⌃" : "⌄";
    button.append(main, chevron);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePreamble(view, this.record, !this.expanded);
    });
    return createMeasuredBlockShell(
      button,
      "texleaf-preamble-shell",
      view,
      this.record.from,
    );
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

class MakeTitleWidget extends WidgetType {
  public constructor(
    private readonly record: VisualMakeTitleRecord,
    private readonly insideFrame = false,
    private readonly grouped = false,
  ) {
    super();
  }

  public override eq(other: MakeTitleWidget): boolean {
    return visualPresentationKey(this.record) === visualPresentationKey(other.record) &&
      visualMakeTitlePositionKey(this.record) === visualMakeTitlePositionKey(other.record) &&
      this.insideFrame === other.insideFrame && this.grouped === other.grouped;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    const root = document.createElement("section");
    container.append(root);
    root.className = "texleaf-title-card";
    root.tabIndex = 0;
    root.setAttribute("aria-label", this.grouped ? "文章文首预览" : "文章标题、作者、单位与邮箱预览");
    wireSourcePointer(
      root,
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
    );

    const localMetadata = [this.record.title, ...this.record.authors, ...this.record.affiliations,
      ...this.record.emails, this.record.date].filter((field): field is VisualSourceText =>
      field !== undefined && field.navigationId === undefined);
    const sourceRanges = [this.record.replacement,
      ...localMetadata.map(field => ({ sourceFrom: field.from, sourceTo: field.to })),
      ...(this.record.metadataReplacements ?? []),
      ...(this.grouped && this.record.frontMatter !== undefined
        ? [this.record.frontMatter.replacement, ...(this.record.frontMatter.replacements ?? [])] : [])];
    const editTitle = createStructureSourceButton(view,
      Math.min(...sourceRanges.map(range => range.sourceFrom)),
      Math.max(...sourceRanges.map(range => range.sourceTo)), "编辑文首源码", true);
    editTitle.classList.add("texleaf-title-source");
    root.append(editTitle);

    const heading = document.createElement("h1");
    heading.className = "texleaf-document-title";
    heading.append(createInlineContentElement(this.record.title?.segments ?? [], this.record.title?.text || "未设置标题", "texleaf-title-content", view));
    if (this.record.title !== undefined) {
      wireMetadataSourcePointer(heading, view, this.record.title);
    }
    root.append(heading);
    if (this.record.title?.definition !== undefined) {
      const definition = document.createElement("span");
      definition.className = "texleaf-title-definition";
      definition.textContent = "查看标题定义";
      wireMetadataSourcePointer(definition, view, this.record.title.definition);
      root.append(definition);
    }

    if (this.record.authors.length > 0) {
      const authors = document.createElement("div");
      authors.className = "texleaf-document-authors";
      for (const author of this.record.authors) {
        const element = document.createElement("span");
        element.className = "texleaf-document-author";
        element.append(createInlineContentElement(author.segments ?? [], author.text, "texleaf-author-content", view));
        appendTitleMarkers(element, author);
        wireMetadataSourcePointer(element, view, author);
        authors.append(element);
      }
      root.append(authors);
    }
    const affiliations = this.record.affiliations ?? [];
    if (affiliations.length > 0) {
      const list = document.createElement("div");
      list.className = "texleaf-document-affiliations";
      for (const affiliation of affiliations) {
        const element = document.createElement("span");
        element.className = "texleaf-document-affiliation";
        element.append(createInlineContentElement(affiliation.segments ?? [], affiliation.text, "texleaf-affiliation-content", view));
        appendTitleMarkers(element, affiliation);
        wireMetadataSourcePointer(element, view, affiliation);
        list.append(element);
      }
      root.append(list);
    }
    const emails = this.record.emails ?? [];
    if (emails.length > 0) {
      const list = document.createElement("div");
      list.className = "texleaf-document-emails";
      for (const email of emails) {
        const element = document.createElement("span");
        element.className = "texleaf-document-email";
        element.textContent = email.text;
        wireMetadataSourcePointer(element, view, email);
        list.append(element);
      }
      root.append(list);
    }
    if (this.record.date !== undefined && this.record.date.text.length > 0) {
      const date = document.createElement("span");
      date.className = "texleaf-document-date";
      date.textContent = this.record.date.text;
      wireMetadataSourcePointer(date, view, this.record.date);
      root.append(date);
    }
    for (const section of this.grouped ? this.record.frontMatter?.sections ?? [] : []) {
      const element = document.createElement("div");
      element.className = `texleaf-front-matter-section texleaf-front-matter-${section.role}`;
      const abstract = section.role === "abstract";
      const header = document.createElement("div");
      header.className = abstract ? "texleaf-abstract-begin" : "texleaf-keywords-card texleaf-keywords-card-block";
      const label = document.createElement("span");
      label.className = abstract ? "texleaf-abstract-label" : "texleaf-keywords-label";
      label.textContent = section.label;
      const content = createInlineContentElement(section.source.segments ?? [], section.source.text,
        abstract ? "texleaf-front-matter-content texleaf-front-matter-abstract-body" : "texleaf-keywords-value", view);
      const edit = document.createElement("span");
      edit.className = "texleaf-environment-edit-chip";
      edit.textContent = abstract
        ? section.label === "摘要" ? "编辑摘要源码" : "Edit abstract source"
        : "编辑源码";
      const enclosing = section.source.navigationId === undefined
        ? view.state.field(structureField).records.find((record): record is VisualAbstractRecord =>
          record.kind === "abstract" && record.bodyFrom <= section.source.from && record.bodyTo >= section.source.to)
        : undefined;
      wireMetadataSourcePointer(edit, view, enclosing === undefined ? section.source
        : { from: enclosing.begin.sourceFrom, to: enclosing.end.sourceTo });
      wireMetadataSourcePointer(content, view, section.source);
      header.append(label);
      if (!abstract) header.append(content);
      header.append(edit);
      element.append(header);
      if (abstract) element.append(content);
      container.append(element);
    }
    return createMeasuredBlockShell(
      container,
      [
        "texleaf-title-shell",
        this.insideFrame ? "texleaf-frame-content-shell" : "",
      ].filter(Boolean).join(" "),
      view,
      this.record.replacement.sourceFrom,
    );
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

function appendTitleMarkers(element: HTMLElement, source: VisualSourceText): void {
  if (!source.markers?.length) return;
  const marker = document.createElement("sup");
  marker.textContent = source.markers.join(", ");
  element.append(marker);
}

class AbstractBeginWidget extends WidgetType {
  public constructor(private readonly record: VisualAbstractRecord) {
    super();
  }

  public override eq(other: AbstractBeginWidget): boolean {
    return this.record.environment === other.record.environment &&
      this.record.language === other.record.language &&
      this.record.role === other.record.role &&
      this.record.label === other.record.label;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("section");
    root.className = `texleaf-abstract-begin texleaf-abstract-${this.record.role}`;
    root.tabIndex = 0;
    root.title = `点击编辑 \\begin{${this.record.environment}}`;
    const label = document.createElement("span");
    label.className = "texleaf-abstract-label";
    label.dataset.texleafLineNumberAnchorId = String(this.record.begin.from);
    label.textContent = this.record.label;
    root.append(label);
    const edit = createInlineEnvironmentEditChip(
      view,
      this.record.begin.sourceFrom,
      this.record.begin.sourceTo,
      this.record.language === "zh" ? "编辑摘要源码" : "Edit abstract source",
    );
    edit.title = this.record.language === "zh"
      ? "显示并编辑完整的摘要环境边界与隐藏排版命令"
      : "Reveal and edit both abstract boundaries and hidden layout commands";
    root.append(edit);
    wireSourcePointer(
      root,
      view,
      this.record.begin.sourceFrom,
      this.record.begin.sourceTo,
    );
    return createMeasuredBlockShell(
      root,
      "texleaf-abstract-begin-shell",
      view,
      this.record.begin.sourceFrom,
    );
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

class AbstractEndWidget extends WidgetType {
  public constructor(private readonly record: VisualAbstractRecord) {
    super();
  }

  public override eq(other: AbstractEndWidget): boolean {
    return this.record.environment === other.record.environment &&
      this.record.role === other.record.role;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("span");
    root.className = `texleaf-abstract-end texleaf-abstract-${this.record.role}`;
    root.tabIndex = 0;
    root.title = `点击编辑 \\end{${this.record.environment}}`;
    wireSourcePointer(
      root,
      view,
      this.record.end.sourceFrom,
      this.record.end.sourceTo,
    );
    return createMeasuredBlockShell(
      root,
      "texleaf-abstract-end-shell",
      view,
      this.record.end.sourceFrom,
    );
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

class KeywordsWidget extends WidgetType {
  public constructor(
    private readonly record: VisualKeywordsRecord,
    private readonly embeddedInAbstract = false,
  ) {
    super();
  }

  public override eq(other: KeywordsWidget): boolean {
    return this.embeddedInAbstract === other.embeddedInAbstract &&
      visualPresentationKey(this.record) === visualPresentationKey(other.record);
  }

  public override toDOM(view: EditorView): HTMLElement {
    const block = this.record.replacement.block;
    const root = document.createElement(block ? "section" : "span");
    root.className = [
      "texleaf-keywords-card",
      block ? "texleaf-keywords-card-block" : "texleaf-keywords-card-inline",
      this.embeddedInAbstract ? "texleaf-keywords-card-embedded" : "",
      `texleaf-keywords-${this.record.role}`,
    ].filter(Boolean).join(" ");
    root.tabIndex = 0;
    root.setAttribute("aria-label", `${this.record.label}: ${this.record.value}`);
    const label = document.createElement("span");
    label.className = "texleaf-keywords-label";
    label.textContent = this.record.label;
    const value = document.createElement("span");
    value.className = "texleaf-keywords-value";
    value.textContent = this.record.value || (this.record.language === "zh" ? "未设置" : "Not set");
    const edit = createInlineEnvironmentEditChip(
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
      this.record.language === "zh" ? "编辑" : "Edit",
    );
    edit.title = this.record.language === "zh"
      ? "原位展开并编辑关键词或分类命令"
      : "Reveal and edit the keyword or classification source";
    root.append(label, value, edit);
    wireSourcePointer(
      root,
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
    );
    return block
      ? createMeasuredBlockShell(
          root,
          this.embeddedInAbstract
            ? "texleaf-keywords-shell texleaf-keywords-shell-embedded"
            : "texleaf-keywords-shell",
          view,
          this.record.replacement.sourceFrom,
        )
      : root;
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

class FrameBeginWidget extends WidgetType {
  public constructor(private readonly record: VisualFrameRecord) {
    super();
  }

  public override eq(other: FrameBeginWidget): boolean {
    return this.record.title === other.record.title &&
      this.record.subtitle === other.record.subtitle &&
      this.record.syntax === other.record.syntax &&
      this.record.language === other.record.language;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("section");
    root.className = "texleaf-frame-begin";
    root.tabIndex = 0;
    root.title = this.record.syntax === "command"
      ? "点击编辑 \\frame{...} 开始命令"
      : "点击编辑 \\begin{frame}";
    const label = document.createElement("span");
    label.className = "texleaf-frame-label";
    label.textContent = this.record.language === "zh" ? "幻灯片" : "Slide";
    root.append(label);
    const titleText = this.record.title?.trim();
    if (titleText !== undefined && titleText.length > 0) {
      const title = document.createElement("span");
      title.className = "texleaf-frame-title";
      title.textContent = titleText;
      root.append(title);
    } else {
      root.classList.add("texleaf-frame-begin-untitled");
    }
    if (this.record.subtitle !== undefined && this.record.subtitle.length > 0) {
      const subtitle = document.createElement("span");
      subtitle.className = "texleaf-frame-subtitle";
      subtitle.textContent = this.record.subtitle;
      root.append(subtitle);
    }
    root.append(createInlineEnvironmentEditChip(
      view,
      this.record.begin.sourceFrom,
      this.record.begin.sourceTo,
    ));
    wireSourcePointer(
      root,
      view,
      this.record.begin.sourceFrom,
      this.record.begin.sourceTo,
    );
    return createMeasuredBlockShell(
      root,
      "texleaf-frame-begin-shell",
      view,
      this.record.begin.sourceFrom,
    );
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

class FrameEndWidget extends WidgetType {
  public constructor(private readonly record: VisualFrameRecord) {
    super();
  }

  public override eq(other: FrameEndWidget): boolean {
    return this.record.language === other.record.language &&
      this.record.syntax === other.record.syntax;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("span");
    root.className = "texleaf-frame-end";
    root.tabIndex = 0;
    root.title = this.record.syntax === "command"
      ? "点击编辑 \\frame{...} 结束花括号"
      : "点击编辑 \\end{frame}";
    root.append(createInlineEnvironmentEditChip(
      view,
      this.record.end.sourceFrom,
      this.record.end.sourceTo,
      this.record.language === "zh"
        ? this.record.syntax === "command" ? "编辑结束花括号" : "编辑结束命令"
        : this.record.syntax === "command" ? "Edit closing brace" : "Edit frame end",
    ));
    wireSourcePointer(
      root,
      view,
      this.record.end.sourceFrom,
      this.record.end.sourceTo,
    );
    return createMeasuredBlockShell(
      root,
      "texleaf-frame-end-shell",
      view,
      this.record.end.sourceFrom,
    );
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

function visualTheoremHeadingText(
  label: string,
  number: string | undefined,
  optionalTitle: string | undefined,
  style: VisualTheoremRecord["style"],
): string {
  const numberedLabel = number === undefined ? label : `${label} ${number}`;
  if (style !== "proof") {
    return numberedLabel;
  }
  const proofHeading = optionalTitle?.trim() || numberedLabel;
  return /[.!?。！？：:]$/u.test(proofHeading)
    ? proofHeading
    : `${proofHeading}.`;
}

class TheoremBeginWidget extends WidgetType {
  public constructor(
    private readonly record: VisualTheoremRecord,
    private readonly insideFrame: boolean,
  ) {
    super();
  }

  public override eq(other: TheoremBeginWidget): boolean {
    return this.record.label === other.record.label &&
      this.record.number === other.record.number &&
      this.record.optionalTitle === other.record.optionalTitle &&
      this.record.environment === other.record.environment &&
      this.record.style === other.record.style &&
      this.record.begin.block === other.record.begin.block &&
      this.insideFrame === other.insideFrame &&
      visualPresentationKey(this.record.labels) === visualPresentationKey(other.record.labels);
  }

  public override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement(this.record.begin.block ? "div" : "span");
    root.className = [
      "texleaf-theorem-begin",
      this.record.begin.block
        ? "texleaf-theorem-begin-block"
        : "texleaf-theorem-begin-inline",
      `texleaf-theorem-${this.record.style}`,
    ].join(" ");
    root.tabIndex = 0;
    root.title = `点击编辑 \\begin{${this.record.environment}}`;
    const label = document.createElement("span");
    label.className = "texleaf-theorem-label";
    label.dataset.texleafLineNumberAnchorId = String(this.record.begin.from);
    label.textContent = visualTheoremHeadingText(
      this.record.label,
      this.record.number,
      this.record.optionalTitle,
      this.record.style,
    );
    root.append(label);
    if (
      this.record.style !== "proof" &&
      this.record.optionalTitle !== undefined &&
      this.record.optionalTitle.length > 0
    ) {
      const optional = document.createElement("span");
      optional.className = "texleaf-theorem-optional-title";
      optional.append("(", createInlineContentElement(this.record.optionalTitleSegments ?? [], this.record.optionalTitle, "texleaf-theorem-inline-content", view), ")");
      root.append(optional);
    }
    for (const sourceLabel of this.record.labels) {
      root.append(createLabelChip(view, sourceLabel));
    }
    root.append(createInlineEnvironmentEditChip(
      view,
      this.record.begin.sourceFrom,
      this.record.begin.sourceTo,
    ));
    wireSourcePointer(
      root,
      view,
      this.record.begin.sourceFrom,
      this.record.begin.sourceTo,
    );
    return this.record.begin.block
      ? createMeasuredBlockShell(
          root,
          [
            "texleaf-theorem-begin-shell",
            this.insideFrame ? "texleaf-frame-content-shell" : "",
          ].filter(Boolean).join(" "),
          view,
          this.record.begin.sourceFrom,
        )
      : root;
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

class TheoremEndWidget extends WidgetType {
  public constructor(
    private readonly record: VisualTheoremRecord,
    private readonly insideFrame: boolean,
  ) {
    super();
  }

  public override eq(other: TheoremEndWidget): boolean {
    return this.record.style === other.record.style &&
      this.record.environment === other.record.environment &&
      this.record.end.block === other.record.end.block &&
      this.insideFrame === other.insideFrame;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const block = this.record.end.block;
    const root = document.createElement(block ? "div" : "span");
    root.className = [
      "texleaf-theorem-end",
      block ? "texleaf-theorem-end-block" : "texleaf-theorem-end-inline",
      `texleaf-theorem-${this.record.style}`,
    ].join(" ");
    root.tabIndex = 0;
    root.title = `点击编辑 \\end{${this.record.environment}}`;
    root.append(createInlineEnvironmentEditChip(
      view,
      this.record.end.sourceFrom,
      this.record.end.sourceTo,
      "编辑结束环境",
    ));
    if (this.record.style === "proof") {
      const qed = document.createElement("span");
      qed.className = "texleaf-proof-qed";
      qed.textContent = "□";
      root.append(qed);
    }
    wireSourcePointer(
      root,
      view,
      this.record.end.sourceFrom,
      this.record.end.sourceTo,
    );
    return block
      ? createMeasuredBlockShell(
          root,
          [
            "texleaf-theorem-end-shell",
            this.insideFrame ? "texleaf-frame-content-shell" : "",
          ].filter(Boolean).join(" "),
          view,
          this.record.end.sourceFrom,
        )
      : root;
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

class ListItemWidget extends WidgetType {
  public constructor(
    private readonly environment: VisualListRecord["environment"],
    private readonly item: VisualListItemRecord,
  ) {
    super();
  }

  public override eq(other: ListItemWidget): boolean {
    return this.environment === other.environment &&
      this.item.label === other.item.label &&
      this.item.ordinal === other.item.ordinal &&
      this.item.marker === other.item.marker;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "texleaf-list-marker";
    marker.tabIndex = 0;
    marker.textContent = this.item.marker;
    marker.title = "点击编辑这条 \\item 命令";
    wireSourcePointer(
      marker,
      view,
      this.item.sourceFrom,
      this.item.sourceTo,
    );
    return marker;
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

class ListBoundaryWidget extends WidgetType {
  public constructor(
    private readonly record: VisualListRecord,
    private readonly edge: "begin" | "end",
    private readonly theoremStyle: VisualTheoremRecord["style"] | undefined,
    private readonly insideFrame: boolean,
  ) {
    super();
  }

  public override eq(other: ListBoundaryWidget): boolean {
    return this.record.environment === other.record.environment &&
      this.record.labelTemplate === other.record.labelTemplate &&
      this.edge === other.edge &&
      this.theoremStyle === other.theoremStyle &&
      this.insideFrame === other.insideFrame;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = [
      "texleaf-list-boundary",
      this.insideFrame ? "texleaf-frame-list-boundary" : "",
      this.theoremStyle === undefined ? "" : "texleaf-theorem-list-boundary",
      this.theoremStyle === undefined ? "" : `texleaf-theorem-${this.theoremStyle}`,
    ].filter(Boolean).join(" ");
    const range = this.edge === "begin" ? this.record.begin : this.record.end;
    root.append(createInlineEnvironmentEditChip(
      view,
      range.sourceFrom,
      range.sourceTo,
      this.edge === "begin" ? `编辑 ${this.record.environment}` : `编辑结束命令`,
    ));
    installVisualSourceIndentation(root, view, range.sourceFrom);
    return root;
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

class LabelWidget extends WidgetType {
  public constructor(private readonly record: VisualLabelRecord) {
    super();
  }

  public override eq(other: LabelWidget): boolean {
    return this.record.key === other.record.key &&
      this.record.replacement.block === other.record.replacement.block;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const chip = createLabelChip(view, this.record);
    if (!this.record.replacement.block) {
      return chip;
    }
    const root = document.createElement("div");
    root.className = "texleaf-label-block";
    root.append(chip);
    installVisualSourceIndentation(
      root,
      view,
      this.record.replacement.sourceFrom,
    );
    return root;
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

interface ReferenceChipPresentation {
  readonly key: string;
  readonly label: string;
  readonly previewKind: VisualReferenceTargetKind;
}

class ReferenceWidget extends WidgetType {
  public constructor(
    private readonly record: VisualReferenceRecord,
    private readonly targets: readonly ReferenceChipPresentation[],
  ) {
    super();
  }

  public override eq(other: ReferenceWidget): boolean {
    return this.record.command === other.record.command &&
      JSON.stringify(this.record.resolvedLabels) === JSON.stringify(other.record.resolvedLabels) &&
      this.record.label === other.record.label &&
      this.record.keys.join("\u0000") === other.record.keys.join("\u0000") &&
      referenceChipPresentationIdentity(this.targets) ===
        referenceChipPresentationIdentity(other.targets);
  }

  public override toDOM(view: EditorView): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "texleaf-reference-chip";
    chip.setAttribute(
      "aria-label",
      `引用 ${this.record.keys.join(", ")}；悬停预览，点击编辑，Ctrl/Cmd+单击跳转到标签`,
    );
    appendReferenceChipTargets(chip, view, this.record, this.targets.map(target => ({...target, label: this.record.resolvedLabels?.[target.key] ?? target.label})));
    wireSourcePointer(chip, view, this.record.from, this.record.to, (from, to) => {
      hideReferenceHover();
      post({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "navigate",
        revision: clientRevision,
        kind: "reference",
        from,
        to,
      });
    });
    return chip;
  }

  public override ignoreEvent(): boolean {
    return true;
  }

  public override destroy(dom: HTMLElement): void {
    hideReferenceHoverOwnedBy(dom);
  }
}

function createLabelChip(
  view: EditorView,
  record: VisualLabelRecord,
): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "texleaf-label-chip";
  chip.tabIndex = 0;
  chip.textContent = record.key;
  chip.title = `标签 ${record.key}；点击编辑 label 命令`;
  wireSourcePointer(chip, view, record.from, record.to);
  return chip;
}

class FootnoteWidget extends WidgetType {
  private cleanup: (() => void) | undefined;
  public constructor(private readonly record: VisualFootnoteRecord) { super(); }
  public override eq(other: FootnoteWidget): boolean {
    return visualPresentationKey(this.record) === visualPresentationKey(other.record);
  }
  public override toDOM(view: EditorView): HTMLElement {
    const marker = document.createElement("sup");
    marker.className = "texleaf-footnote-marker";
    marker.tabIndex = 0;
    marker.setAttribute("role", "button");
    marker.textContent = this.record.number ?? "*";
    marker.setAttribute("aria-label", `脚注 ${this.record.number ?? ""}；悬浮查看，点击编辑源码`);
    wireSourcePointer(marker, view, this.record.from, this.record.to);
    const card = document.createElement("div");
    card.className = "texleaf-footnote-hover";
    card.setAttribute("role", "note");
    card.hidden = true;
    card.append(createInlineContentElement(this.record.source.segments ?? [], this.record.source.text,
      "texleaf-footnote-content", view));
    card.append(createStructureSourceButton(view, this.record.from, this.record.to, "编辑脚注源码"));
    document.body.append(card);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = (): void => { clearTimeout(timer); };
    const hide = (): void => { cancel(); card.hidden = true; };
    const leave = (): void => { cancel(); timer = setTimeout(hide, 180); };
    const show = (): void => {
      cancel();
      if (!marker.isConnected) return;
      card.hidden = false;
      const anchor = marker.getBoundingClientRect();
      const bounds = view.scrollDOM.getBoundingClientRect();
      card.style.maxWidth = `${Math.max(120, Math.min(460, bounds.width - 16))}px`;
      const box = card.getBoundingClientRect();
      card.style.left = `${Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - box.width - 8))}px`;
      card.style.top = `${Math.max(bounds.top + 8, Math.min(anchor.bottom + 6, bounds.bottom - box.height - 8))}px`;
    };
    marker.addEventListener("pointermove", show);
    marker.addEventListener("focus", show);
    marker.addEventListener("pointerleave", leave);
    marker.addEventListener("blur", leave);
    marker.addEventListener("pointerdown", hide);
    card.addEventListener("pointerenter", cancel);
    card.addEventListener("pointerleave", leave);
    card.addEventListener("focusin", cancel);
    card.addEventListener("focusout", leave);
    card.addEventListener("keydown", event => { if (event.key === "Escape") hide(); });
    view.scrollDOM.addEventListener("scroll", hide);
    this.cleanup = () => { cancel(); card.remove(); view.scrollDOM.removeEventListener("scroll", hide); };
    return marker;
  }
  public override ignoreEvent(): boolean { return true; }
  public override destroy(): void { this.cleanup?.(); }
}

class CitationWidget extends WidgetType {
  public constructor(private readonly record: VisualCitationRecord) {
    super();
  }

  public override eq(other: CitationWidget): boolean {
    return this.record.label === other.record.label &&
      this.record.keys.join("\u0000") === other.record.keys.join("\u0000") &&
      this.record.optionalArguments.join("\u0000") ===
        other.record.optionalArguments.join("\u0000") &&
      citationPreviewIdentity(this.record.previews) ===
        citationPreviewIdentity(other.record.previews);
  }

  public override toDOM(view: EditorView): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "texleaf-citation-chip";
    const visibleNotes = this.record.optionalArguments.filter(
      (value) => value.length > 0,
    );
    chip.setAttribute(
      "aria-label",
      `引用 ${this.record.label}${
        visibleNotes.length === 0 ? "" : `；说明 ${visibleNotes.join("；")}`
      }。悬停预览文献信息；点击编辑引用命令；Ctrl/Cmd+单击跳转到文献条目`,
    );
    appendCitationChipTargets(chip, view, this.record);
    wireSourcePointer(chip, view, this.record.from, this.record.to, (from, to) => {
      hideReferenceHover();
      post({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "navigate",
        revision: clientRevision,
        kind: "citation",
        from,
        to,
      });
    });
    return chip;
  }

  public override ignoreEvent(): boolean {
    return true;
  }

  public override destroy(dom: HTMLElement): void {
    hideReferenceHoverOwnedBy(dom);
  }
}

function appendReferenceChipTargets(
  chip: HTMLElement,
  view: EditorView,
  record: VisualReferenceRecord,
  targets: readonly ReferenceChipPresentation[],
): void {
  if (record.command === "eqref") {
    chip.append(document.createTextNode("("));
  }
  targets.forEach(({ key, label, previewKind }, index) => {
    if (index > 0) {
      chip.append(document.createTextNode(", "));
    }
    const target = createReferenceChipTarget(
      "texleaf-reference-chip-target",
      label,
      previewKind === "formula"
        ? `标签 ${key}；悬停预览对应公式，Ctrl/Cmd+单击直接跳转`
        : previewKind === "theorem"
          ? `标签 ${key}；悬停预览对应定理，Ctrl/Cmd+单击直接跳转`
          : previewKind === "heading"
            ? `标签 ${key}；悬停预览章节标题，Ctrl/Cmd+单击直接跳转`
            : previewKind === "table"
              ? `标签 ${key}；悬停预览对应表格，Ctrl/Cmd+单击直接跳转`
              : previewKind === "image"
                ? `标签 ${key}；悬停预览对应图片，Ctrl/Cmd+单击直接跳转`
                : previewKind === "diagram"
                  ? `标签 ${key}；悬停预览对应交换图，Ctrl/Cmd+单击直接跳转`
            : `标签 ${key}；悬停从项目中查找预览，Ctrl/Cmd+单击直接跳转`,
    );
    target.dataset.referenceKey = key;
    target.dataset.referenceKind = previewKind;
    wireReferenceHover(target, chip, view, record, key, previewKind);
    wirePreciseReferenceNavigation(target, chip, view, "reference", key);
    chip.append(target);
  });
  if (record.command === "eqref") {
    chip.append(document.createTextNode(")"));
  }
}

function referenceChipPresentations(
  structureReferences: ReadonlyMap<string, VisualStructureReferencePresentation>,
  formulaReferenceCounts: ReadonlyMap<string, number>,
  keys: readonly string[],
): readonly ReferenceChipPresentation[] {
  return keys.map((key) => {
    const formulaTarget = formulaReferenceCounts.get(key) === 1;
    const structureTarget = structureReferences.get(key);
    const previewKind: VisualReferenceTargetKind = formulaTarget
      ? "formula"
      : structureTarget?.targetKind ?? "unknown";
    return {
      key,
      previewKind,
      label: formulaTarget ? key : structureTarget?.label ?? key,
    };
  });
}

function referenceChipPresentationIdentity(
  targets: readonly ReferenceChipPresentation[],
): string {
  return targets
    .map(({ key, label, previewKind }) =>
      key + "\u0001" + label + "\u0001" + previewKind
    )
    .join("\u0000");
}

function appendCitationChipTargets(
  chip: HTMLElement,
  view: EditorView,
  record: VisualCitationRecord,
): void {
  const byKey = new Map(record.previews.map((entry) => [entry.key, entry]));
  const textualSingle = record.keys.length === 1 &&
    /^(?:[Cc]itet|[Tt]extcite)$/u.test(record.command);
  const notes = visualCitationNotes(record.optionalArguments);
  if (!textualSingle) {
    chip.append(document.createTextNode("["));
  }
  if (notes.prenote.length > 0) {
    appendCitationNote(chip, notes.prenote);
    chip.append(document.createTextNode(" "));
  }
  record.keys.forEach((key, index) => {
    if (index > 0) {
      chip.append(document.createTextNode("; "));
    }
    const entry = byKey.get(key);
    const target = createReferenceChipTarget(
      "texleaf-citation-chip-target",
      textualSingle ? record.label : visualCitationTargetLabel(key, entry),
      `文献 ${key}；悬停预览该条文献，Ctrl/Cmd+单击直接跳转`,
    );
    target.dataset.citationKey = key;
    wireCitationHover(target, chip, view, record, key, entry);
    wirePreciseReferenceNavigation(target, chip, view, "citation", key);
    chip.append(target);
  });
  if (notes.postnote.length > 0) {
    chip.append(document.createTextNode(", "));
    appendCitationNote(chip, notes.postnote);
  }
  if (!textualSingle) {
    chip.append(document.createTextNode("]"));
  }
}

function visualCitationNotes(
  optionalArguments: readonly string[],
): { readonly prenote: string; readonly postnote: string } {
  if (optionalArguments.length >= 2) {
    return {
      prenote: optionalArguments[0] ?? "",
      postnote: optionalArguments[1] ?? "",
    };
  }
  return {
    prenote: "",
    postnote: optionalArguments[0] ?? "",
  };
}

function appendCitationNote(chip: HTMLElement, text: string): void {
  const note = document.createElement("span");
  note.className = "texleaf-citation-note";
  // Citation notes originate in user-authored LaTeX. Keep them text-only so a
  // note such as `[<img onerror=...>]` can never create Webview markup.
  note.textContent = text;
  chip.append(note);
}

function createReferenceChipTarget(
  className: string,
  label: string,
  ariaLabel: string,
): HTMLSpanElement {
  const target = document.createElement("span");
  target.className = className;
  target.tabIndex = 0;
  target.textContent = label;
  target.setAttribute("aria-label", ariaLabel);
  return target;
}

function visualCitationTargetLabel(
  key: string,
  entry: VisualCitationPreview | undefined,
): string {
  if (entry === undefined) {
    return key;
  }
  const author = visualCitationAuthor(entry.authors);
  const year = compactReferenceHoverText(entry.year, 20);
  return author.length > 0 && year.length > 0
    ? `${author}, ${year}`
    : author || year || key;
}

function visualCitationAuthor(value: string): string {
  const authors = value
    .split(/\s+and\s+/iu)
    .map((author) => author.trim())
    .filter((author) => author.length > 0);
  const first = authors[0] ?? "";
  const surname = first.includes(",")
    ? first.split(",")[0]?.trim() ?? ""
    : first.split(/\s+/u).at(-1) ?? "";
  return authors.length >= 2 && surname.length > 0
    ? `${surname} et al.`
    : surname;
}

function citationPreviewIdentity(
  previews: readonly VisualCitationPreview[],
): string {
  return previews.map((entry) => [
    entry.key,
    entry.title,
    entry.authors,
    entry.container,
    entry.year,
    entry.source,
    entry.titleSegments === undefined ? "" : visualPresentationKey(entry.titleSegments),
  ].join("\u0001")).join("\u0000");
}

function wireCitationHover(
  anchor: HTMLElement,
  rangeElement: HTMLElement,
  view: EditorView,
  record: VisualCitationRecord,
  key: string,
  entry: VisualCitationPreview | undefined,
): void {
  const show = (): void => {
    if (
      activeReferenceHover?.kind === "citation" &&
      activeReferenceHover.anchor === anchor &&
      activeReferenceHover.key === key
    ) {
      cancelReferenceHoverHide();
      return;
    }
    const range = readMappedDatasetRange(
      rangeElement,
      "texleafSourceFrom",
      "texleafSourceTo",
      view.state.doc.length,
    ) ?? { from: record.from, to: record.to };
    cancelReferenceHoverHide();
    activeReferenceHover = {
      kind: "citation",
      anchor,
      from: range.from,
      to: range.to,
      key,
    };
    referenceHoverElement.classList.remove("texleaf-reference-hover-wide");
    referenceHoverContent.replaceChildren(createCitationHoverEntry(key, entry));
    showReferenceHoverCard();
  };
  wireReferenceHoverActivation(anchor, show);
}

function wireReferenceHover(
  anchor: HTMLElement,
  rangeElement: HTMLElement,
  view: EditorView,
  record: VisualReferenceRecord,
  key: string,
  previewKind: VisualReferenceTargetKind,
): void {
  const show = (): void => {
    if (
      activeReferenceHover?.kind === "reference" &&
      activeReferenceHover.anchor === anchor &&
      activeReferenceHover.key === key
    ) {
      cancelReferenceHoverHide();
      return;
    }
    const range = readMappedDatasetRange(
      rangeElement,
      "texleafSourceFrom",
      "texleafSourceTo",
      view.state.doc.length,
    ) ?? { from: record.from, to: record.to };
    cancelReferenceHoverHide();
    const requestId = ++referenceHoverRequestSequence;
    activeReferenceHover = {
      kind: "reference",
      anchor,
      from: range.from,
      to: range.to,
      key,
      requestId,
      previewKind,
    };
    referenceHoverElement.classList.toggle(
      "texleaf-reference-hover-wide",
      previewKind === "table" || previewKind === "image" || previewKind === "diagram",
    );
    const loading = document.createElement("div");
    loading.className = "texleaf-reference-hover-loading";
    loading.textContent = previewKind === "formula"
      ? "正在生成对应公式的 Math Preview…"
      : previewKind === "theorem"
        ? "正在生成对应定理的可视化预览…"
        : previewKind === "heading"
          ? "正在读取章节标题…"
          : previewKind === "table"
            ? "正在准备对应表格的可视化预览…"
            : previewKind === "image"
              ? "正在读取对应图片…"
              : previewKind === "diagram"
                ? "正在生成对应交换图的可视化预览…"
          : "正在从项目中查找引用目标…";
    referenceHoverContent.replaceChildren(loading);
    showReferenceHoverCard();
    post({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "referencePreview",
      requestId,
      version: documentVersion,
      revision: clientRevision,
      from: range.from,
      to: range.to,
      key,
    });
  };
  wireReferenceHoverActivation(anchor, show);
}

/**
 * Open a new reference card only after deliberate pointer motion or keyboard
 * focus. Chromium also dispatches `pointerenter` when CodeMirror inserts a
 * replacement widget underneath a stationary pointer. Treating that event as
 * fresh hover intent can reopen a citation card immediately after its source
 * collapses back to a chip. An enter may still keep the already-active anchor
 * alive while the pointer travels back from the card; the existing 140 ms hide
 * bridge therefore retains its interactive-card behavior.
 */
function wireReferenceHoverActivation(
  anchor: HTMLElement,
  show: () => void,
): void {
  anchor.addEventListener("pointerenter", () => {
    if (activeReferenceHover?.anchor === anchor) {
      cancelReferenceHoverHide();
    }
  });
  anchor.addEventListener("pointermove", show);
  anchor.addEventListener("focus", show);
  anchor.addEventListener("pointerleave", scheduleReferenceHoverHide);
  anchor.addEventListener("blur", scheduleReferenceHoverHide);
}

function wirePreciseReferenceNavigation(
  target: HTMLElement,
  rangeElement: HTMLElement,
  view: EditorView,
  kind: "reference" | "citation",
  key: string,
): void {
  const navigate = (): void => {
    const range = readMappedDatasetRange(
      rangeElement,
      "texleafSourceFrom",
      "texleafSourceTo",
      view.state.doc.length,
    );
    if (range === undefined) {
      return;
    }
    hideReferenceHover();
    post({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "navigate",
      revision: clientRevision,
      kind,
      from: range.from,
      to: range.to,
      key,
    });
  };
  target.addEventListener("pointerdown", (event) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    navigate();
  });
  target.addEventListener("keydown", (event) => {
    if (
      (event.key !== "Enter" && event.key !== " ") ||
      (!event.ctrlKey && !event.metaKey)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    navigate();
  });
}

function createCitationHoverEntry(
  key: string,
  entry: VisualCitationPreview | undefined,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "texleaf-completion-info";
  const heading = document.createElement("h3");
  if (entry?.entryType === "bibitem") {
    heading.textContent = `文献 ${key}`;
  } else {
    heading.append(createInlineContentElement(entry?.titleSegments ?? [],
      compactReferenceHoverText(entry?.title ?? "", 220) || `[未找到 ${key}]`, "texleaf-citation-title"));
  }
  root.append(heading);
  if (entry?.entryType === "bibitem") {
    const citation = document.createElement("p");
    citation.append(createInlineContentElement(entry.titleSegments ?? [], entry.title, "texleaf-citation-title"));
    root.append(citation);
  } else {
    appendCitationHoverField(
      root,
      "作者：",
      entry === undefined ? "未知作者" : fullVisualCitationAuthors(entry.authors),
    );
    appendCitationHoverField(
      root,
      "期刊 / 出版物：",
      compactReferenceHoverText(entry?.container ?? "", 240) || "未知出版物",
    );
    appendCitationHoverField(
      root,
      "年份：",
      compactReferenceHoverText(entry?.year ?? "", 20) || "无年份",
    );
  }
  const keyParagraph = document.createElement("p");
  const keyLabel = document.createElement("strong");
  keyLabel.textContent = "Citation key：";
  const code = document.createElement("code");
  code.textContent = key;
  keyParagraph.append(keyLabel, code);
  root.append(keyParagraph);
  appendCitationHoverField(
    root,
    "来源：",
    entry?.source ?? "当前 bibliography 中未找到已收录条目",
  );
  root.append(document.createElement("hr"));
  const action = document.createElement("p");
  action.textContent = "Ctrl/⌘ 单击跳转到文献条目；普通单击可编辑引用源码。";
  root.append(action);
  return root;
}

function appendCitationHoverField(
  root: HTMLElement,
  label: string,
  value: string,
): void {
  const paragraph = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = label;
  paragraph.append(strong, document.createTextNode(value));
  root.append(paragraph);
}

function fullVisualCitationAuthors(value: string): string {
  const authors = value
    .split(/\s+and\s+/iu)
    .map((author) => compactReferenceHoverText(author, 120))
    .filter((author) => author.length > 0);
  return authors.length > 0 ? authors.join("、") : "未知作者";
}

function compactReferenceHoverText(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, Math.max(1, maximum - 1))}…`;
}

function showReferenceHoverCard(): void {
  referenceHoverElement.classList.add("visible");
  referenceHoverElement.setAttribute("aria-hidden", "false");
  scheduleReferenceHoverPosition();
}

function scheduleReferenceHoverPosition(): void {
  if (referenceHoverPositionFrame !== 0) {
    return;
  }
  referenceHoverPositionFrame = requestAnimationFrame(() => {
    referenceHoverPositionFrame = 0;
    positionReferenceHoverCard();
  });
}

function positionReferenceHoverCard(): void {
  const active = activeReferenceHover;
  if (active === undefined || !active.anchor.isConnected || editor === undefined) {
    hideReferenceHover();
    return;
  }
  const anchor = active.anchor.getBoundingClientRect();
  const editorRect = editor.scrollDOM.getBoundingClientRect();
  const margin = 8;
  const gap = 6;
  const leftBoundary = Math.max(margin, editorRect.left + 2);
  const rightBoundary = Math.min(window.innerWidth - margin, editorRect.right - 2);
  const topBoundary = Math.max(margin, editorRect.top + 2);
  const bottomBoundary = Math.min(window.innerHeight - margin, editorRect.bottom - 2);
  const availableWidth = Math.max(1, rightBoundary - leftBoundary);
  const availableHeight = Math.max(1, bottomBoundary - topBoundary);
  // Size against CodeMirror's real viewport, not the entire Webview. This
  // matters when a PDF occupies the neighbouring editor group.
  const preferredWidth = referenceHoverElement.classList.contains(
      "texleaf-reference-hover-wide",
    )
    ? 720
    : 460;
  referenceHoverElement.style.width = `${Math.min(preferredWidth, availableWidth)}px`;
  referenceHoverElement.style.maxHeight = `${availableHeight}px`;
  referenceHoverContent.style.maxHeight = `${availableHeight}px`;
  let card = referenceHoverElement.getBoundingClientRect();
  const spaces = {
    right: Math.max(0, rightBoundary - anchor.right - gap),
    left: Math.max(0, anchor.left - leftBoundary - gap),
    below: Math.max(0, bottomBoundary - anchor.bottom - gap),
    above: Math.max(0, anchor.top - topBoundary - gap),
  };
  const placement = visualFloatingPreviewPlacement(spaces, {
    width: card.width,
    height: card.height,
  });
  if (placement === "right" || placement === "left") {
    const sideWidth = placement === "right" ? spaces.right : spaces.left;
    if (sideWidth > 0 && sideWidth < card.width) {
      referenceHoverElement.style.width = `${Math.max(1, sideWidth)}px`;
      card = referenceHoverElement.getBoundingClientRect();
    }
  } else if (placement === "below" || placement === "above") {
    const sideHeight = placement === "below" ? spaces.below : spaces.above;
    if (sideHeight > 0 && sideHeight < card.height) {
      referenceHoverElement.style.maxHeight = `${Math.max(1, sideHeight)}px`;
      referenceHoverContent.style.maxHeight = `${Math.max(1, sideHeight)}px`;
      card = referenceHoverElement.getBoundingClientRect();
    }
  }
  const maximumLeft = Math.max(leftBoundary, rightBoundary - card.width);
  const maximumTop = Math.max(topBoundary, bottomBoundary - card.height);
  let left: number;
  let top: number;
  switch (placement) {
    case "right":
      left = anchor.right + gap;
      top = anchor.top;
      break;
    case "left":
      left = anchor.left - gap - card.width;
      top = anchor.top;
      break;
    case "above":
      left = anchor.left;
      top = anchor.top - gap - card.height;
      break;
    case "below":
      left = anchor.left;
      top = anchor.bottom + gap;
      break;
    case "overlay":
      left = anchor.left;
      top = spaces.below >= spaces.above
        ? anchor.bottom + gap
        : anchor.top - gap - card.height;
      break;
  }
  left = Math.max(leftBoundary, Math.min(left, maximumLeft));
  top = Math.max(topBoundary, Math.min(top, maximumTop));
  referenceHoverElement.dataset.side = placement;
  referenceHoverElement.style.left = `${Math.round(left)}px`;
  referenceHoverElement.style.top = `${Math.round(top)}px`;
}

function cancelReferenceHoverHide(): void {
  if (referenceHoverHideTimer !== undefined) {
    clearTimeout(referenceHoverHideTimer);
    referenceHoverHideTimer = undefined;
  }
}

function scheduleReferenceHoverHide(): void {
  cancelReferenceHoverHide();
  referenceHoverHideTimer = setTimeout(() => {
    referenceHoverHideTimer = undefined;
    if (!referenceHoverPointerInside) {
      hideReferenceHover();
    }
  }, 140);
}

function hideReferenceHover(): void {
  cancelReferenceHoverHide();
  if (referenceHoverPositionFrame !== 0) {
    cancelAnimationFrame(referenceHoverPositionFrame);
    referenceHoverPositionFrame = 0;
  }
  activeReferenceHover = undefined;
  referenceHoverPointerInside = false;
  referenceHoverElement.classList.remove("visible");
  referenceHoverElement.classList.remove("texleaf-reference-hover-wide");
  referenceHoverElement.setAttribute("aria-hidden", "true");
  delete referenceHoverElement.dataset.side;
  referenceHoverContent.replaceChildren();
}

function hideReferenceHoverOwnedBy(owner: HTMLElement): void {
  const active = activeReferenceHover;
  if (
    active !== undefined &&
    (active.anchor === owner || owner.contains(active.anchor))
  ) {
    hideReferenceHover();
  }
}

function reconcileReferenceHoverOwner(): void {
  if (
    activeReferenceHover !== undefined &&
    !activeReferenceHover.anchor.isConnected
  ) {
    // CodeMirror can replace a citation/reference widget without Chromium
    // dispatching pointerleave for the removed anchor. Never let the global
    // detail card outlive the visual chip that owns it.
    hideReferenceHover();
  }
}

function createStructureSourceButton(
  view: EditorView,
  from: number,
  to: number,
  label = "编辑环境",
  selectSource = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "texleaf-structure-action";
  button.textContent = label;
  button.title = "原位展开并编辑完整 LaTeX 环境源码";
  wireSourcePointer(button, view, from, to, undefined, selectSource);
  return button;
}

function createInlineEnvironmentEditChip(
  view: EditorView,
  from: number,
  to: number,
  label = "编辑环境",
  selectSource = false,
): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "texleaf-environment-edit-chip";
  chip.tabIndex = 0;
  chip.textContent = label;
  chip.title = "成对展开这一环境的 \\begin / \\end LaTeX 源码";
  wireSourcePointer(chip, view, from, to, undefined, selectSource);
  return chip;
}

function createPlainStructureButton(
  label: string,
  run: () => void,
  primary = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = primary
    ? "texleaf-structure-action texleaf-structure-action-primary"
    : "texleaf-structure-action";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    run();
  });
  return button;
}

class TableWidget extends WidgetType {
  public constructor(
    private readonly record: VisualTableRecord,
    private readonly insideFrame: boolean,
  ) {
    super();
  }

  public override eq(other: TableWidget): boolean {
    return this.insideFrame === other.insideFrame &&
      visualPresentationKey(this.record) === visualPresentationKey(other.record);
  }

  public override toDOM(view: EditorView): HTMLElement {
    const card = document.createElement("section");
    card.className = "texleaf-table-card";
    card.tabIndex = 0;
    card.title = `表格预览（${this.record.environment}）`;
    card.dataset.texleafBodyFrom = String(this.record.bodyFrom);
    card.dataset.texleafBodyTo = String(this.record.bodyTo);
    card.dataset.texleafColumnsFrom = String(this.record.columnSpecFrom);
    card.dataset.texleafColumnsTo = String(this.record.columnSpecTo);
    card.dataset.texleafTableEnvironment = this.record.environment;
    card.dataset.texleafTableContainer = this.record.containerEnvironment ?? "";
    wireSourcePointer(
      card,
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
    );

    const actions = document.createElement("div");
    actions.className = "texleaf-structure-actions";
    if (this.record.visualEditable) {
      const visual = document.createElement("button");
      visual.type = "button";
      visual.className = "texleaf-structure-action texleaf-structure-action-primary";
      visual.textContent = "可视化编辑表格";
      visual.setAttribute("aria-pressed", "false");
      visual.title = "编辑表格类型、浮动体、宽度、表题、标签、行列和单元格；应用时保留所选环境语义";
      visual.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openVisualTableEditor(card, view, this.record, visual);
      });
      actions.append(visual);
    }
    actions.append(createStructureSourceButton(
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
      "编辑环境源码",
    ));
    card.append(actions);

    if (this.record.caption !== undefined || this.record.label !== undefined) {
      const caption = document.createElement("div");
      caption.className = "texleaf-table-caption";
      if (this.record.caption !== undefined) {
        caption.append(createInlineContentElement(
          this.record.captionSegments,
          this.record.caption,
          "texleaf-table-inline-content",
          view,
        ));
      }
      if (this.record.label !== undefined) {
        caption.append(createLabelChip(view, this.record.label));
      }
      card.append(caption);
    }

    const scroll = document.createElement("div");
    scroll.className = "texleaf-table-scroll";
    configureStructureHorizontalScroll(
      scroll,
      "表格预览；超出正文宽度时可横向滚动",
    );
    const table = document.createElement("table");
    table.className = "texleaf-table";
    const [headerRow, ...bodyRows] = this.record.rows;
    if (headerRow !== undefined) {
      const head = document.createElement("thead");
      head.append(createTableRow(headerRow, this.record.columnCount, true, view));
      table.append(head);
    }
    if (bodyRows.length > 0) {
      const body = document.createElement("tbody");
      for (const row of bodyRows) {
        body.append(createTableRow(row, this.record.columnCount, false, view));
      }
      table.append(body);
    }
    scroll.append(table);
    card.append(scroll);
    if (this.record.truncated) {
      const note = document.createElement("div");
      note.className = "texleaf-table-note";
      note.textContent = "表格较大，编辑器预览只显示前 120 行、每行前 32 列；源码保持完整。";
      card.append(note);
    } else if (!this.record.visualEditable && this.record.visualEditReason !== undefined) {
      const note = document.createElement("div");
      note.className = "texleaf-table-note";
      note.textContent = `${this.record.visualEditReason} 源码保持完整。`;
      card.append(note);
    }
    return createMeasuredBlockShell(
      card,
      [
        "texleaf-table-shell",
        this.insideFrame ? "texleaf-frame-content-shell" : "",
      ].filter(Boolean).join(" "),
      view,
      this.record.replacement.sourceFrom,
    );
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

type MutableTableAlignment = "left" | "center" | "right" | "flex";
type MutableTableEnvironment = "tabular" | "tabular*" | "tabularx" | "longtable";
type MutableTableContainer = "table" | "table*" | undefined;

interface MutableVisualTableModel {
  rows: string[][];
  alignments: MutableTableAlignment[];
  ruleStyle: VisualTableRecord["ruleStyle"];
  environment: MutableTableEnvironment;
  containerEnvironment: MutableTableContainer;
  position: string;
  width: string;
  tableAlignment: VisualTableRecord["tableAlignment"];
  caption: string;
  label: string;
  repeatHeader: boolean;
  verticalRules: boolean;
  removeOuterPadding: boolean;
}

function openVisualTableEditor(
  card: HTMLElement,
  view: EditorView,
  record: VisualTableRecord,
  trigger: HTMLButtonElement,
): void {
  const existing = card.querySelector<HTMLElement>(".texleaf-visual-structure-editor");
  if (existing !== null) {
    existing.dispatchEvent(new Event("texleaf-request-close"));
    return;
  }
  const viewportAnchor = structureCardViewportAnchor(card);
  const triggerLabel = trigger.textContent ?? "可视化编辑表格";
  trigger.textContent = "关闭表格编辑";
  trigger.setAttribute("aria-pressed", "true");
  const model: MutableVisualTableModel = {
    rows: record.rows.map((row) =>
      Array.from({ length: record.columnCount }, (_, column) =>
        row[column]?.source ?? ""
      )
    ),
    alignments: [...record.columnAlignments],
    ruleStyle: record.ruleStyle,
    environment: isMutableTableEnvironment(record.environment)
      ? record.environment
      : "tabular",
    containerEnvironment: record.containerEnvironment,
    position: record.position ?? (record.containerEnvironment === undefined ? "c" : "htbp"),
    width: record.width ?? "\\textwidth",
    tableAlignment: record.tableAlignment,
    caption: record.captionLatex ?? "",
    label: record.label?.key ?? "",
    repeatHeader: record.longtableRepeatHeader,
    verticalRules: record.columnSpec.includes("|"),
    removeOuterPadding: record.columnSpec.trim().startsWith("@{}") &&
      record.columnSpec.trim().endsWith("@{}"),
  };
  if (model.rows.length === 0) {
    model.rows.push(Array.from({ length: Math.max(1, model.alignments.length) }, () => ""));
  }
  const panel = document.createElement("section");
  panel.className = "texleaf-visual-structure-editor";
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    const closeAnchor = structureCardViewportAnchor(card);
    panel.remove();
    trigger.textContent = triggerLabel;
    trigger.setAttribute("aria-pressed", "false");
    retainStructureCardViewport(view, card, closeAnchor, trigger);
  };
  panel.addEventListener("texleaf-request-close", close);
  renderVisualTableEditor(panel, card, view, record, model, close);
  card.append(panel);
  retainStructureCardViewport(
    view,
    card,
    viewportAnchor,
    panel.querySelector<HTMLInputElement>(".texleaf-table-cell-input") ?? undefined,
  );
}

interface StructureCardViewportAnchor {
  readonly top: number;
  readonly left: number;
}

function structureCardViewportAnchor(
  card: HTMLElement,
): StructureCardViewportAnchor {
  const rectangle = card.getBoundingClientRect();
  return {
    top: rectangle.top,
    left: rectangle.left,
  };
}

function retainStructureCardViewport(
  view: EditorView,
  card: HTMLElement,
  anchor: StructureCardViewportAnchor,
  focusTarget?: HTMLElement,
): void {
  const restore = (): void => {
    if (!card.isConnected) {
      return;
    }
    const rectangle = card.getBoundingClientRect();
    const verticalDelta = rectangle.top - anchor.top;
    const horizontalDelta = rectangle.left - anchor.left;
    if (Math.abs(verticalDelta) > 0.5) {
      view.scrollDOM.scrollTop += verticalDelta;
    }
    if (Math.abs(horizontalDelta) > 0.5) {
      view.scrollDOM.scrollLeft += horizontalDelta;
    }
    focusTarget?.focus({ preventScroll: true });
  };
  view.requestMeasure();
  // CodeMirror can adjust its scroll anchor one animation frame after a block
  // widget changes height. Restore the clicked card after both that measurement
  // and the browser's focus/layout pass; repeated restoration is idempotent.
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(restore);
  });
}

function renderVisualTableEditor(
  panel: HTMLElement,
  card: HTMLElement,
  view: EditorView,
  record: VisualTableRecord,
  model: MutableVisualTableModel,
  close: () => void,
): void {
  panel.replaceChildren();
  const title = document.createElement("h3");
  title.className = "texleaf-visual-structure-editor-title";
  title.textContent = "表格可视化编辑";
  panel.append(title);

  const parameters = document.createElement("div");
  parameters.className = "texleaf-table-parameter-grid";
  const environmentSelect = createTableEditorSelect(
    [
      ["tabular", "tabular"],
      ["tabularx", "tabularx（指定总宽度）"],
      ["tabular*", "tabular*（指定总宽度）"],
      ["longtable", "longtable（跨页）"],
    ],
    model.environment,
    "数据环境",
  );
  environmentSelect.addEventListener("change", () => {
    const previousEnvironment = model.environment;
    model.environment = environmentSelect.value as MutableTableEnvironment;
    if (model.environment === "longtable") {
      model.containerEnvironment = undefined;
      model.position = /^[clru]$/u.test(model.position) ? model.position : "c";
    } else if (previousEnvironment === "longtable" && model.containerEnvironment === undefined) {
      model.containerEnvironment = "table";
      model.position = "htbp";
    }
    if (model.environment !== "tabularx") {
      model.alignments = model.alignments.map((alignment) =>
        alignment === "flex" ? "left" : alignment
      );
    }
    renderVisualTableEditor(panel, card, view, record, model, close);
  });
  parameters.append(createTableEditorField("数据环境", environmentSelect));

  const containerSelect = createTableEditorSelect(
    [
      ["", "不使用浮动体"],
      ["table", "table"],
      ["table*", "table*（双栏通栏）"],
    ],
    model.containerEnvironment ?? "",
    "外层浮动体",
  );
  containerSelect.disabled = model.environment === "longtable";
  containerSelect.addEventListener("change", () => {
    model.containerEnvironment = containerSelect.value === ""
      ? undefined
      : containerSelect.value as MutableTableContainer;
  });
  parameters.append(createTableEditorField("外层浮动体", containerSelect));

  const positionInput = createTableEditorInput(
    model.position,
    model.containerEnvironment === undefined
      ? "例如 c、t、b"
      : "例如 htbp、H、!ht",
    "位置参数",
  );
  positionInput.addEventListener("input", () => {
    model.position = positionInput.value.trim();
  });
  parameters.append(createTableEditorField("位置参数", positionInput));

  const widthInput = createTableEditorInput(
    model.width,
    "例如 \\textwidth 或 0.9\\linewidth",
    "表格总宽度",
  );
  widthInput.disabled = model.environment !== "tabularx" && model.environment !== "tabular*";
  widthInput.addEventListener("input", () => {
    model.width = widthInput.value.trim();
  });
  attachVirtualLatexInput(widthInput, {
    context: "table",
    getAnchor: () => tableEditorSourceAnchor(card, view, record),
    commit: (value) => {
      model.width = value.trim();
    },
  });
  parameters.append(createTableEditorField("表格总宽度", widthInput));

  const tableAlignment = createTableEditorSelect(
    [
      ["left", "左对齐"],
      ["center", "居中"],
      ["right", "右对齐"],
    ],
    model.tableAlignment,
    "表格整体对齐",
  );
  tableAlignment.addEventListener("change", () => {
    model.tableAlignment = tableAlignment.value as VisualTableRecord["tableAlignment"];
  });
  parameters.append(createTableEditorField("整体对齐", tableAlignment));

  const ruleStyle = createTableEditorSelect(
    [
      ["booktabs", "booktabs 三线表"],
      ["hline", "\\hline 网格线"],
      ["none", "不自动加横线"],
    ],
    model.ruleStyle,
    "横线样式",
  );
  ruleStyle.addEventListener("change", () => {
    model.ruleStyle = ruleStyle.value as VisualTableRecord["ruleStyle"];
  });
  parameters.append(createTableEditorField("横线样式", ruleStyle));

  const captionInput = createTableEditorInput(
    model.caption,
    "可留空；支持 LaTeX 和 TeXLeaf 片段",
    "表题",
  );
  attachVirtualLatexInput(captionInput, {
    context: "table",
    getAnchor: () => tableEditorSourceAnchor(card, view, record),
    commit: (value) => {
      model.caption = value;
    },
  });
  parameters.append(createTableEditorField("表题 caption", captionInput, true));

  const labelInput = createTableEditorInput(model.label, "例如 tab:main-result", "标签");
  labelInput.addEventListener("input", () => {
    model.label = labelInput.value.trim();
  });
  parameters.append(createTableEditorField("标签 label", labelInput, true));

  const options = document.createElement("div");
  options.className = "texleaf-table-option-row";
  options.append(
    createTableEditorCheckbox("列间竖线", model.verticalRules, (checked) => {
      model.verticalRules = checked;
    }),
    createTableEditorCheckbox("去掉两端列间距（@{}）", model.removeOuterPadding, (checked) => {
      model.removeOuterPadding = checked;
    }),
    createTableEditorCheckbox(
      "长表格重复表头",
      model.repeatHeader,
      (checked) => {
        model.repeatHeader = checked;
      },
      model.environment !== "longtable",
    ),
  );
  const optionField = createTableEditorField("列与跨页选项", options, true);
  parameters.append(optionField);
  panel.append(parameters);

  const scroll = document.createElement("div");
  scroll.className = "texleaf-table-editor-scroll";
  const grid = document.createElement("table");
  grid.className = "texleaf-table-editor-grid";
  const alignmentRow = document.createElement("tr");
  alignmentRow.className = "texleaf-table-editor-alignment-row";
  for (let column = 0; column < model.alignments.length; column += 1) {
    const header = document.createElement("th");
    const select = document.createElement("select");
    select.className = "texleaf-table-align-select";
    select.setAttribute("aria-label", `第 ${column + 1} 列对齐方式`);
    for (const [value, label] of [
      ["left", "左对齐"],
      ["center", "居中"],
      ["right", "右对齐"],
      ...(model.environment === "tabularx"
        ? [["flex", "伸缩 X 列"] as const]
        : []),
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = model.alignments[column] === value;
      select.append(option);
    }
    select.addEventListener("change", () => {
      model.alignments[column] = select.value as MutableTableAlignment;
    });
    header.append(select);
    alignmentRow.append(header);
  }
  alignmentRow.append(document.createElement("th"));
  grid.append(alignmentRow);

  for (let rowIndex = 0; rowIndex < model.rows.length; rowIndex += 1) {
    const sourceRow = model.rows[rowIndex] ?? [];
    const row = document.createElement("tr");
    for (let column = 0; column < model.alignments.length; column += 1) {
      const cell = document.createElement("td");
      cell.className = "texleaf-table-editor-cell";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "texleaf-table-cell-input";
      input.value = sourceRow[column] ?? "";
      const originalCell = record.rows[rowIndex]?.[column];
      input.setAttribute("aria-label", `第 ${rowIndex + 1} 行第 ${column + 1} 列 LaTeX`);
      attachVirtualLatexInput(input, {
        context: "table",
        mathPreview: true,
        getAnchor: () => {
          const mappedBody = readMappedDatasetRange(
            card,
            "texleafBodyFrom",
            "texleafBodyTo",
            view.state.doc.length,
          );
          const bodyAnchor = mappedBody?.from ?? record.bodyFrom;
          return originalCell === undefined
            ? bodyAnchor
            : clampNumber(
                bodyAnchor + (originalCell.sourceFrom - record.bodyFrom),
                bodyAnchor,
                mappedBody?.to ?? record.bodyTo,
              );
        },
        commit: (value) => {
          sourceRow[column] = value;
        },
      });
      cell.append(input);
      row.append(cell);
    }
    const removeCell = document.createElement("td");
    removeCell.className = "texleaf-table-editor-remove-cell";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "texleaf-table-row-remove";
    remove.textContent = "×";
    remove.title = "删除这一行";
    remove.disabled = model.rows.length <= 1;
    remove.addEventListener("click", () => {
      if (model.rows.length > 1) {
        model.rows.splice(rowIndex, 1);
        renderVisualTableEditor(panel, card, view, record, model, close);
      }
    });
    removeCell.append(remove);
    row.append(removeCell);
    grid.append(row);
  }
  scroll.append(grid);
  panel.append(scroll);

  const controls = document.createElement("div");
  controls.className = "texleaf-structure-actions";
  const addRow = createPlainStructureButton("添加行", () => {
    model.rows.push(Array.from({ length: model.alignments.length }, () => ""));
    renderVisualTableEditor(panel, card, view, record, model, close);
  });
  addRow.disabled = model.rows.length >= 80;
  const addColumn = createPlainStructureButton("添加列", () => {
    model.alignments.push(model.environment === "tabularx" ? "flex" : "center");
    for (const row of model.rows) {
      row.push("");
    }
    renderVisualTableEditor(panel, card, view, record, model, close);
  });
  addColumn.disabled = model.alignments.length >= 24;
  const removeColumn = createPlainStructureButton("删除末列", () => {
    if (model.alignments.length > 1) {
      model.alignments.pop();
      for (const row of model.rows) {
        row.pop();
      }
      renderVisualTableEditor(panel, card, view, record, model, close);
    }
  });
  removeColumn.disabled = model.alignments.length <= 1;
  const cancel = createPlainStructureButton("取消", close);
  const apply = createPlainStructureButton("应用表格修改", () => {
    applyVisualTableEdit(card, view, record, model);
  }, true);
  controls.append(addRow, addColumn, removeColumn, cancel, apply);
  panel.append(controls);

  const note = document.createElement("div");
  note.className = "texleaf-visual-editor-note";
  note.textContent = "单元格、表题和宽度支持 TeXLeaf 片段与 Ctrl+Space 补全。应用时会把当前可视化模型安全序列化为 tabular / tabularx / tabular* / longtable；不支持的高级列定义仍请用“编辑环境源码”。";
  panel.append(note);
  view.requestMeasure();
}

function isMutableTableEnvironment(value: string): value is MutableTableEnvironment {
  return value === "tabular" || value === "tabular*" ||
    value === "tabularx" || value === "longtable";
}

function createTableEditorField(
  caption: string,
  control: HTMLElement,
  wide = false,
): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = wide
    ? "texleaf-table-parameter texleaf-table-parameter-wide"
    : "texleaf-table-parameter";
  const title = document.createElement("span");
  title.className = "texleaf-table-parameter-label";
  title.textContent = caption;
  label.append(title, control);
  return label;
}

function createTableEditorInput(
  value: string,
  placeholder: string,
  ariaLabel: string,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "texleaf-table-parameter-input";
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", ariaLabel);
  isolateNativeInputHistory(input);
  return input;
}

function createTableEditorSelect<T extends string>(
  values: readonly (readonly [T, string])[],
  selected: string,
  ariaLabel: string,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "texleaf-table-parameter-input";
  select.setAttribute("aria-label", ariaLabel);
  for (const [value, label] of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    select.append(option);
  }
  return select;
}

function createTableEditorCheckbox(
  caption: string,
  checked: boolean,
  update: (checked: boolean) => void,
  disabled = false,
): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "texleaf-table-checkbox";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener("change", () => update(input.checked));
  label.append(input, document.createTextNode(caption));
  return label;
}

function tableEditorSourceAnchor(
  card: HTMLElement,
  view: EditorView,
  record: VisualTableRecord,
): number {
  return readMappedDatasetRange(
    card,
    "texleafSourceFrom",
    "texleafSourceTo",
    view.state.doc.length,
  )?.from ?? record.replacement.sourceFrom;
}

function hasBalancedLatexBraces(value: string): boolean {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "{" && character !== "}") {
      continue;
    }
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 1) {
      continue;
    }
    depth += character === "{" ? 1 : -1;
    if (depth < 0) {
      return false;
    }
  }
  return depth === 0;
}

function applyVisualTableEdit(
  card: HTMLElement,
  view: EditorView,
  record: VisualTableRecord,
  model: MutableVisualTableModel,
): void {
  const sourceRange = readMappedDatasetRange(
    card,
    "texleafSourceFrom",
    "texleafSourceTo",
    view.state.doc.length,
  );
  if (sourceRange === undefined) {
    setStatus("warning", "表格源码位置已经变化，请重新打开可视化编辑器。", 3_500);
    return;
  }
  if (model.rows.some((row) =>
    row.length !== model.alignments.length ||
    row.some((cell) => /[\r\n]/u.test(cell) || hasUnescapedTableSeparator(cell))
  )) {
    setStatus("warning", "单元格不能含换行或未转义的 &；请使用 \\&。", 4_000);
    return;
  }
  if (!/^[A-Za-z!*]*$/u.test(model.position)) {
    setStatus("warning", "位置参数只能包含字母、! 或 *。", 4_000);
    return;
  }
  if (
    /[\r\n\u0000]/u.test(model.caption) ||
    !hasBalancedLatexBraces(model.caption) ||
    /[\r\n\u0000{}]/u.test(model.label) ||
    /[\r\n\u0000]/u.test(model.width) ||
    !hasBalancedLatexBraces(model.width)
  ) {
    setStatus("warning", "caption、label 或宽度参数含有不安全的换行/花括号。", 4_000);
    return;
  }
  if (
    (model.environment === "tabularx" || model.environment === "tabular*") &&
    model.width.trim().length === 0
  ) {
    setStatus("warning", `${model.environment} 必须指定表格总宽度。`, 4_000);
    return;
  }
  if (
    model.environment !== "longtable" &&
    model.containerEnvironment === undefined &&
    (model.caption.trim().length > 0 || model.label.trim().length > 0)
  ) {
    setStatus("warning", "caption 和 label 需要外层 table/table*；请先选择外层浮动体。", 4_500);
    return;
  }
  const source = view.state.doc.toString();
  const original = source.slice(sourceRange.from, sourceRange.to);
  const replacement = serializeVisualTableEnvironment(
    original,
    source,
    sourceRange.from,
    record.columnSpec,
    model,
  );
  applyAtomicVisualDocumentChange(view, {
    from: sourceRange.from,
    to: sourceRange.to,
    insert: replacement,
  });
}

function serializeVisualTableColumns(
  original: string,
  alignments: readonly MutableTableAlignment[],
  verticalRules = original.includes("|"),
  removeOuterPadding = original.trim().startsWith("@{}") &&
    original.trim().endsWith("@{}"),
): string {
  const parts = alignments.map((alignment) =>
    alignment === "left"
      ? "l"
      : alignment === "right"
        ? "r"
        : alignment === "flex"
          ? "X"
          : "c"
  );
  const core = verticalRules ? `|${parts.join("|")}|` : parts.join("");
  return `${removeOuterPadding ? "@{}" : ""}${core}${removeOuterPadding ? "@{}" : ""}`;
}

function serializeVisualTableEnvironment(
  original: string,
  documentSource: string,
  sourceFrom: number,
  originalColumnSpec: string,
  model: MutableVisualTableModel,
): string {
  const eol = original.includes("\r\n") || documentSource.includes("\r\n")
    ? "\r\n"
    : "\n";
  const lineStart = documentSource.lastIndexOf("\n", Math.max(0, sourceFrom - 1)) + 1;
  const baseIndent = documentSource.slice(lineStart, sourceFrom).match(/^[ \t]*/u)?.[0] ?? "";
  const indentUnit = tableIndentUnit(original, baseIndent);
  const columns = serializeVisualTableColumns(
    originalColumnSpec,
    model.alignments,
    model.verticalRules,
    model.removeOuterPadding,
  );
  const lines: string[] = [];
  const line = (level: number, value: string): void => {
    lines.push(`${baseIndent}${indentUnit.repeat(level)}${value}`);
  };
  const first = (value: string): void => {
    lines.push(value);
  };

  if (model.environment === "longtable") {
    const position = model.position.length > 0 ? `[${model.position}]` : "";
    first(`\\begin{longtable}${position}{${columns}}`);
    if (model.caption.trim().length > 0 || model.label.trim().length > 0) {
      const caption = model.caption.trim().length > 0
        ? `\\caption{${model.caption}}`
        : "\\caption{}";
      const label = model.label.trim().length > 0 ? `\\label{${model.label.trim()}}` : "";
      line(1, `${caption}${label} \\\\`);
    }
    appendLongtableRows(lines, baseIndent, indentUnit, model);
    line(0, "\\end{longtable}");
    return lines.join(eol);
  }

  const container = model.containerEnvironment;
  if (container !== undefined) {
    const position = model.position.length > 0 ? `[${model.position}]` : "";
    first(`\\begin{${container}}${position}`);
    line(1, tableAlignmentCommand(model.tableAlignment));
    if (model.caption.trim().length > 0) {
      line(1, `\\caption{${model.caption}}`);
    }
    if (model.label.trim().length > 0) {
      line(1, `\\label{${model.label.trim()}}`);
    }
    line(1, tableEnvironmentBegin(model, columns, false));
    appendOrdinaryTableRows(lines, baseIndent, indentUnit, 2, model);
    line(1, `\\end{${model.environment}}`);
    line(0, `\\end{${container}}`);
    return lines.join(eol);
  }

  first(tableEnvironmentBegin(model, columns, true));
  appendOrdinaryTableRows(lines, baseIndent, indentUnit, 1, model);
  line(0, `\\end{${model.environment}}`);
  return lines.join(eol);
}

function tableEnvironmentBegin(
  model: MutableVisualTableModel,
  columns: string,
  includePosition: boolean,
): string {
  const position = includePosition && model.position.length > 0
    ? `[${model.position}]`
    : "";
  if (model.environment === "tabularx" || model.environment === "tabular*") {
    return `\\begin{${model.environment}}{${model.width.trim()}}${position}{${columns}}`;
  }
  return `\\begin{tabular}${position}{${columns}}`;
}

function appendOrdinaryTableRows(
  lines: string[],
  baseIndent: string,
  indentUnit: string,
  level: number,
  model: MutableVisualTableModel,
): void {
  const prefix = `${baseIndent}${indentUnit.repeat(level)}`;
  const addRule = (kind: "top" | "middle" | "bottom"): void => {
    const rule = tableRule(model.ruleStyle, kind);
    if (rule !== undefined) {
      lines.push(`${prefix}${rule}`);
    }
  };
  addRule("top");
  for (let index = 0; index < model.rows.length; index += 1) {
    lines.push(`${prefix}${(model.rows[index] ?? []).join(" & ")} \\\\`);
    if (index === 0 && model.rows.length > 1) {
      addRule("middle");
    }
  }
  addRule("bottom");
}

function appendLongtableRows(
  lines: string[],
  baseIndent: string,
  indentUnit: string,
  model: MutableVisualTableModel,
): void {
  const prefix = `${baseIndent}${indentUnit}`;
  const header = model.rows[0] ?? Array.from({ length: model.alignments.length }, () => "");
  const body = model.rows.slice(1);
  const pushRule = (kind: "top" | "middle" | "bottom"): void => {
    const rule = tableRule(model.ruleStyle, kind);
    if (rule !== undefined) {
      lines.push(`${prefix}${rule}`);
    }
  };
  if (model.repeatHeader) {
    pushRule("top");
    lines.push(`${prefix}${header.join(" & ")} \\\\`);
    pushRule("middle");
    lines.push(`${prefix}\\endfirsthead`);
    pushRule("top");
    lines.push(`${prefix}${header.join(" & ")} \\\\`);
    pushRule("middle");
    lines.push(`${prefix}\\endhead`);
    pushRule("bottom");
    lines.push(`${prefix}\\endfoot`);
    pushRule("bottom");
    lines.push(`${prefix}\\endlastfoot`);
    for (const row of body) {
      lines.push(`${prefix}${row.join(" & ")} \\\\`);
    }
  } else {
    appendOrdinaryTableRows(lines, baseIndent, indentUnit, 1, model);
  }
}

function tableRule(
  style: VisualTableRecord["ruleStyle"],
  kind: "top" | "middle" | "bottom",
): string | undefined {
  if (style === "booktabs") {
    return kind === "top" ? "\\toprule" : kind === "middle" ? "\\midrule" : "\\bottomrule";
  }
  return style === "hline" ? "\\hline" : undefined;
}

function tableAlignmentCommand(alignment: VisualTableRecord["tableAlignment"]): string {
  return alignment === "left"
    ? "\\raggedright"
    : alignment === "right"
      ? "\\raggedleft"
      : "\\centering";
}

function tableIndentUnit(original: string, baseIndent: string): string {
  const match = /\r?\n([ \t]+)\\(?:centering|raggedright|raggedleft|caption|label|begin|toprule|hline)/u.exec(
    original,
  );
  if (match?.[1] !== undefined) {
    const indentation = match[1];
    const relative = indentation.startsWith(baseIndent)
      ? indentation.slice(baseIndent.length)
      : indentation;
    if (relative.length > 0) {
      return relative;
    }
  }
  return "  ";
}

function serializeVisualTableBody(
  original: string,
  model: MutableVisualTableModel,
): string {
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const firstContent = /(?:^|\r?\n)([ \t]*)\S/u.exec(original);
  const rowIndent = firstContent?.[1] ?? "  ";
  const trailingIndent = /(?:\r?\n)([ \t]*)$/u.exec(original)?.[1] ?? "";
  const lines: string[] = [];
  if (model.ruleStyle === "booktabs") {
    lines.push(`${rowIndent}\\toprule`);
  } else if (model.ruleStyle === "hline") {
    lines.push(`${rowIndent}\\hline`);
  }
  for (let index = 0; index < model.rows.length; index += 1) {
    lines.push(`${rowIndent}${(model.rows[index] ?? []).join(" & ")} \\\\`);
    if (index === 0 && model.rows.length > 1) {
      if (model.ruleStyle === "booktabs") {
        lines.push(`${rowIndent}\\midrule`);
      } else if (model.ruleStyle === "hline") {
        lines.push(`${rowIndent}\\hline`);
      }
    }
  }
  if (model.ruleStyle === "booktabs") {
    lines.push(`${rowIndent}\\bottomrule`);
  } else if (model.ruleStyle === "hline") {
    lines.push(`${rowIndent}\\hline`);
  }
  return `${eol}${lines.join(eol)}${eol}${trailingIndent}`;
}

function hasUnescapedTableSeparator(source: string): boolean {
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "&") {
      continue;
    }
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) {
      return true;
    }
  }
  return false;
}

let tikzcdMarkerSequence = 0;

class TikzcdWidget extends WidgetType {
  private cleanup: (() => void) | undefined;

  public constructor(
    private readonly record: VisualTikzcdRecord,
    private readonly insideFrame: boolean,
  ) {
    super();
  }

  public override eq(other: TikzcdWidget): boolean {
    return this.insideFrame === other.insideFrame &&
      visualPresentationKey(this.record) === visualPresentationKey(other.record);
  }

  public override toDOM(view: EditorView): HTMLElement {
    const card = document.createElement("section");
    card.className = "texleaf-tikzcd-card";
    card.tabIndex = 0;
    card.title = "tikz-cd 交换图预览";
    card.dataset.texleafBodyFrom = String(this.record.bodyFrom);
    card.dataset.texleafBodyTo = String(this.record.bodyTo);
    // Keep the exact model source on the card even when the visible preview is
    // the local-TeX SVG rather than the geometric fallback. This also lets
    // interaction checks distinguish undo/redo states without depending on
    // which preview backend happened to win the render race.
    card.dataset.texleafTikzcdSource = this.record.tex;
    wireSourcePointer(
      card,
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
    );

    const actions = document.createElement("div");
    actions.className = "texleaf-structure-actions";
    if (this.record.visualEditable) {
      const visual = document.createElement("button");
      visual.type = "button";
      visual.className = "texleaf-structure-action texleaf-structure-action-primary";
      visual.textContent = "可视化编辑交换图";
      visual.setAttribute("aria-pressed", "false");
      visual.title = "编辑节点、箭头、标签和常见 tikz-cd 样式";
      visual.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openVisualTikzcdEditor(card, view, this.record, visual);
      });
      actions.append(visual);
    }
    actions.append(createStructureSourceButton(
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
      "编辑 tikzcd 源码",
    ));
    card.append(actions);

    if (this.record.asset !== undefined) {
      card.append(createLocalLatexStructurePreview(
        this.record.asset,
        "tikz-cd 交换图的本地 TeX 精确预览",
      ));
      return createMeasuredBlockShell(
        card,
        [
          "texleaf-tikzcd-shell",
          this.insideFrame ? "texleaf-frame-content-shell" : "",
        ].filter(Boolean).join(" "),
        view,
        this.record.replacement.sourceFrom,
      );
    }

    if (inputFeatures.compatibilityMode !== "maximum" && this.record.simplifiedOptions.length > 0) {
      card.append(createEnhancedVisualizationHint());
    }
    const canvas = document.createElement("div");
    canvas.className = "texleaf-tikzcd-canvas";
    configureStructureHorizontalScroll(
      canvas,
      "交换图预览；超出正文宽度时可横向滚动",
    );
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("texleaf-tikzcd-arrows");
    canvas.append(svg);
    const grid = document.createElement("div");
    grid.className = "texleaf-tikzcd-grid";
    grid.style.gridTemplateColumns = `repeat(${Math.max(1, this.record.columnCount)}, minmax(7.5em, max-content))`;
    const nodeElements = new Map<string, HTMLElement>();
    const nodeRecords = new Map(
      this.record.nodes.map((node) => [`${node.row}:${node.column}`, node]),
    );
    for (let row = 0; row < this.record.rowCount; row += 1) {
      for (let column = 0; column < this.record.columnCount; column += 1) {
        const key = `${row}:${column}`;
        const node = document.createElement("div");
        node.className = "texleaf-tikzcd-node";
        node.dataset.tikzcdRow = String(row);
        node.dataset.tikzcdColumn = String(column);
        const record = nodeRecords.get(key);
        if (record === undefined) {
          node.classList.add("texleaf-tikzcd-node-empty");
        } else {
          node.dataset.tikzcdSource = record.math.tex;
          node.append(createMathFragmentElement(record.math, record.math.fallback));
        }
        nodeElements.set(key, node);
        grid.append(node);
      }
    }
    canvas.append(grid);
    const arrowLabels = this.record.arrows.map((arrow) => {
      if (arrow.label === undefined) {
        return undefined;
      }
      const label = document.createElement("span");
      label.className = "texleaf-tikzcd-arrow-label";
      label.append(createMathFragmentElement(arrow.label, arrow.label.fallback));
      canvas.append(label);
      return label;
    });
    card.append(canvas);

    if (this.record.simplifiedOptions.length > 0 || this.record.truncated) {
      const note = document.createElement("div");
      note.className = "texleaf-tikzcd-note";
      note.textContent = this.record.truncated
        ? "交换图较大或有箭头落在预览网格外；源码保持完整。"
        : `已简化预览：${this.record.simplifiedOptions.join("；")}。源码保持完整。`;
      card.append(note);
    }

    const markerId = `texleaf-tikzcd-marker-${++tikzcdMarkerSequence}`;
    let frame = requestAnimationFrame(() => {
      drawTikzcdArrows(canvas, svg, nodeElements, arrowLabels, this.record, markerId);
      view.requestMeasure();
    });
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            drawTikzcdArrows(canvas, svg, nodeElements, arrowLabels, this.record, markerId);
            view.requestMeasure();
          });
        })
      : undefined;
    observer?.observe(canvas);
    observer?.observe(grid);
    this.cleanup?.();
    this.cleanup = () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
    return createMeasuredBlockShell(
      card,
      [
        "texleaf-tikzcd-shell",
        this.insideFrame ? "texleaf-frame-content-shell" : "",
      ].filter(Boolean).join(" "),
      view,
      this.record.replacement.sourceFrom,
    );
  }

  public override ignoreEvent(): boolean {
    return true;
  }

  public override destroy(_dom: HTMLElement): void {
    this.cleanup?.();
    this.cleanup = undefined;
  }
}

class TikzpictureWidget extends WidgetType {
  public constructor(
    private readonly record: VisualTikzpictureRecord | VisualFigureRecord,
    private readonly insideFrame: boolean,
  ) {
    super();
  }

  public override eq(other: TikzpictureWidget): boolean {
    return this.insideFrame === other.insideFrame &&
      visualPresentationKey(this.record) === visualPresentationKey(other.record);
  }

  public override toDOM(view: EditorView): HTMLElement {
    const card = document.createElement("figure");
    card.className = this.record.kind === "figure" ? "texleaf-tikzpicture-card texleaf-whole-figure-card" : "texleaf-tikzpicture-card";
    card.tabIndex = 0;
    card.title = this.record.kind === "figure" ? "完整图形预览" : "TikZ 图形预览";
    wireSourcePointer(
      card,
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
    );
    const actions = document.createElement("div");
    actions.className = "texleaf-structure-actions";
    actions.append(createStructureSourceButton(
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
      this.record.kind === "figure" ? "编辑完整图形源码" : "编辑 tikzpicture 源码",
    ));
    card.append(actions);
    card.append(this.record.asset === undefined
      ? inputFeatures.compatibilityMode !== "maximum"
        ? createEnhancedVisualizationHint()
        : createLocalPreviewStatus(this.record.previewStatus)
      : createLocalLatexStructurePreview(
          this.record.asset,
          this.record.kind === "figure" ? "完整图形的本地 TeX 预览" : "TikZ 的本地 TeX 预览",
        ));
    if (this.record.kind === "figure") {
      if (this.record.caption !== undefined) {
        const caption = document.createElement("figcaption");
        caption.append(createInlineContentElement(this.record.captionSegments, this.record.caption, "texleaf-figure-caption", view));
        card.append(caption);
      }
      if (this.record.label !== undefined) {
        const label = document.createElement("span");
        label.className = "texleaf-formula-label-chip";
        label.textContent = `↪ ${this.record.label.key}`;
        label.tabIndex = 0;
        wireSourcePointer(label, view, this.record.label.from, this.record.label.to);
        card.append(label);
      }
    }
    return createMeasuredBlockShell(
      card,
      [
        "texleaf-tikzpicture-shell",
        this.insideFrame ? "texleaf-frame-content-shell" : "",
      ].filter(Boolean).join(" "),
      view,
      this.record.replacement.sourceFrom,
    );
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

function createLocalLatexStructurePreview(
  asset: RenderedFormula,
  label: string,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "texleaf-local-latex-preview";
  // Authored white fills and imported PDF artwork need a stable paper canvas.
  // Keep this shared by document cards and reference previews.
  root.style.color = "#010203";
  configureStructureHorizontalScroll(root, label);
  root.style.setProperty(
    "--texleaf-local-preview-width",
    `${safeFormulaDimension(asset.widthEm, 1)}em`,
  );
  root.style.setProperty(
    "--texleaf-local-preview-height",
    `${safeFormulaDimension(asset.heightEm, 1)}em`,
  );
  const svg = createFormulaSvg(asset);
  if (svg === undefined) {
    return createLocalLatexStructureFallback("本地 TeX 已完成，但 SVG 结果无法安全显示。");
  }
  svg.removeAttribute("aria-hidden");
  svg.setAttribute("aria-label", label);
  svg.style.backgroundColor = "#fff";
  svg.style.padding = "4px";
  root.append(svg);
  return root;
}

function createLocalPreviewStatus(status: VisualTikzpictureRecord["previewStatus"]): HTMLElement {
  if (status?.state === "modeRequired") return createEnhancedVisualizationHint();
  const node = createLocalLatexStructureFallback(status?.message ?? "正在生成图形预览…");
  if (status?.state === "error") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "texleaf-structure-action";
    retry.textContent = "重试图形";
    for (const type of ["pointerdown", "mousedown", "keydown"]) retry.addEventListener(type, event => event.stopPropagation());
    retry.addEventListener("click", event => {
      event.stopPropagation();
      post({ protocol: VISUAL_EDITOR_PROTOCOL, type: "command", command: "retryGraphPreviews" });
    });
    node.append(retry);
  }
  return node;
}

function createEnhancedVisualizationHint(): HTMLElement {
  const hint = document.createElement("span");
  hint.className = "texleaf-enhanced-visualization-hint";
  hint.append("此内容需要增强可视化。 ");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "texleaf-structure-action";
  button.textContent = "切换到增强可视化";
  for (const type of ["pointerdown", "mousedown", "keydown"]) {
    button.addEventListener(type, event => event.stopPropagation());
  }
  button.addEventListener("click", event => {
    event.stopPropagation();
    post({ protocol: VISUAL_EDITOR_PROTOCOL, type: "command", command: "visualMaximum" });
  });
  hint.append(button);
  return hint;
}

function createLocalLatexStructureFallback(message: string): HTMLElement {
  const fallback = document.createElement("div");
  fallback.className = "texleaf-local-latex-preview-fallback";
  fallback.textContent = message;
  return fallback;
}

function drawTikzcdArrows(
  canvas: HTMLElement,
  svg: SVGSVGElement,
  nodes: ReadonlyMap<string, HTMLElement>,
  labels: readonly (HTMLElement | undefined)[],
  record: VisualTikzcdRecord,
  markerId: string,
): void {
  svg.replaceChildren();
  const width = Math.max(canvas.clientWidth, canvas.scrollWidth);
  const height = Math.max(canvas.clientHeight, canvas.scrollHeight);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.append(
    createTikzcdMarker(markerId, false),
    createTikzcdMarker(`${markerId}-double`, true),
  );
  svg.append(defs);
  const canvasRect = canvas.getBoundingClientRect();
  for (let index = 0; index < record.arrows.length; index += 1) {
    const arrow = record.arrows[index];
    if (arrow === undefined) {
      continue;
    }
    const fromNode = nodes.get(`${arrow.fromRow}:${arrow.fromColumn}`);
    const toNode = nodes.get(`${arrow.toRow}:${arrow.toColumn}`);
    if (fromNode === undefined || toNode === undefined) {
      continue;
    }
    const fromRect = fromNode.getBoundingClientRect();
    const toRect = toNode.getBoundingClientRect();
    const fromCenter = {
      x: fromRect.left - canvasRect.left + canvas.scrollLeft + fromRect.width / 2,
      y: fromRect.top - canvasRect.top + canvas.scrollTop + fromRect.height / 2,
    };
    const toCenter = {
      x: toRect.left - canvasRect.left + canvas.scrollLeft + toRect.width / 2,
      y: toRect.top - canvasRect.top + canvas.scrollTop + toRect.height / 2,
    };
    const deltaX = toCenter.x - fromCenter.x;
    const deltaY = toCenter.y - fromCenter.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 1) {
      continue;
    }
    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    const startDistance = tikzcdNodeBoundaryDistance(fromRect, unitX, unitY);
    const endDistance = tikzcdNodeBoundaryDistance(toRect, unitX, unitY);
    const start = {
      x: fromCenter.x + unitX * startDistance,
      y: fromCenter.y + unitY * startDistance,
    };
    const end = {
      x: toCenter.x - unitX * endDistance,
      y: toCenter.y - unitY * endDistance,
    };
    const requestedBend = arrow.bendAmount ?? 30;
    const bendAmount = arrow.bend === undefined
      ? 0
      : (arrow.bend === "left" ? 1 : -1) *
        tikzcdBendControlDistance(distance, requestedBend);
    const control = {
      // SVG's positive Y axis points down.  tikz-cd's `bend left` is the
      // geometric left side of the directed arrow, so its screen-space normal
      // is (unitY, -unitX), not (-unitY, unitX).
      x: (start.x + end.x) / 2 + unitY * bendAmount,
      y: (start.y + end.y) / 2 - unitX * bendAmount,
    };
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.dataset.tikzcdArrow = String(index);
    path.dataset.tikzcdBend = arrow.bend ?? "none";
    path.setAttribute(
      "d",
      bendAmount === 0
        ? `M ${start.x} ${start.y} L ${end.x} ${end.y}`
        : `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.45");
    path.setAttribute("stroke-linecap", "round");
    if (arrow.lineStyle === "dotted") {
      path.setAttribute("stroke-dasharray", "1.5 4");
    } else if (arrow.lineStyle === "dashed" || arrow.dashed) {
      path.setAttribute("stroke-dasharray", "5 4");
    }
    if (arrow.head !== "none") {
      path.setAttribute(
        "marker-end",
        `url(#${arrow.head === "twoHeads" ? `${markerId}-double` : markerId})`,
      );
    }
    svg.append(path);
    if (arrow.head === "hook") {
      const hook = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hook.setAttribute(
        "d",
        `M ${start.x - unitY * 5} ${start.y + unitX * 5} Q ${start.x - unitX * 5} ${start.y - unitY * 5} ${start.x + unitY * 5} ${start.y - unitX * 5}`,
      );
      hook.setAttribute("fill", "none");
      hook.setAttribute("stroke", "currentColor");
      hook.setAttribute("stroke-width", "1.3");
      svg.append(hook);
    }
    const label = labels[index];
    if (label !== undefined) {
      const midpoint = bendAmount === 0
        ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
        : {
            x: (start.x + 2 * control.x + end.x) / 4,
            y: (start.y + 2 * control.y + end.y) / 4,
          };
      const side = arrow.swap ? -1 : 1;
      label.style.left = `${midpoint.x + unitY * 13 * side}px`;
      label.style.top = `${midpoint.y - unitX * 13 * side}px`;
    }
  }
}

function createTikzcdMarker(
  id: string,
  double: boolean,
  color = "currentColor",
): SVGMarkerElement {
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.id = id;
  marker.setAttribute("markerWidth", double ? "13" : "10");
  marker.setAttribute("markerHeight", "9");
  marker.setAttribute("refX", double ? "12" : "8.6");
  marker.setAttribute("refY", "4.5");
  marker.setAttribute("orient", "auto");
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    double
      ? "M 0.5 1 L 5 4.5 L 0.5 8 M 5.5 1 L 10 4.5 L 5.5 8"
      : "M 1 0.8 L 8.6 4.5 L 1 8.2",
  );
  // q.uiver uses a light chevron instead of a filled triangular cap.  The
  // open head remains legible inside the transparent endpoint ring while an
  // arrow is selected and also reads better over an editor wallpaper.
  path.style.fill = "none";
  path.style.stroke = color;
  path.setAttribute("stroke-width", double ? "1.2" : "1.35");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  marker.append(path);
  return marker;
}

function tikzcdNodeBoundaryDistance(
  rectangle: DOMRect,
  unitX: number,
  unitY: number,
): number {
  const horizontal = Math.abs(unitX) < 0.0001
    ? Number.POSITIVE_INFINITY
    : (rectangle.width / 2 + 5) / Math.abs(unitX);
  const vertical = Math.abs(unitY) < 0.0001
    ? Number.POSITIVE_INFINITY
    : (rectangle.height / 2 + 4) / Math.abs(unitY);
  return Math.min(horizontal, vertical);
}

type MutableTikzcdLineStyle = "solid" | "dashed" | "dotted";
type MutableTikzcdBend = "none" | "left" | "right";
type MutableTikzcdHead = "normal" | "twoHeads" | "hook" | "noHead";

interface MutableTikzcdArrow {
  fromRow: number;
  fromColumn: number;
  toRow: number;
  toColumn: number;
  label: string;
  swap: boolean;
  lineStyle: MutableTikzcdLineStyle;
  bend: MutableTikzcdBend;
  bendAmount: number;
  head: MutableTikzcdHead;
}

interface MutableTikzcdModel {
  nodes: string[][];
  arrows: MutableTikzcdArrow[];
  rowCount: number;
  columnCount: number;
}

type MutableTikzcdSelection =
  | { readonly kind: "node"; readonly row: number; readonly column: number }
  | { readonly kind: "arrow"; readonly index: number };

interface MutableTikzcdEditorSession {
  model: MutableTikzcdModel;
  selection: MutableTikzcdSelection | undefined;
  focusRow: number;
  focusColumn: number;
  arrowMode: boolean;
  zoom: number;
  history: MutableTikzcdModel[];
  future: MutableTikzcdModel[];
  /** Initial host renders plus renders produced while editing this diagram. */
  readonly fragments: Map<string, VisualMathFragment>;
  readonly record: VisualTikzcdRecord;
  readonly panel: HTMLElement;
  readonly card: HTMLElement;
  readonly view: EditorView;
  readonly close: () => void;
  cancelPointerDrag: (() => void) | undefined;
  disposeCanvas: (() => void) | undefined;
  redrawCanvas: (() => void) | undefined;
}

function openVisualTikzcdEditor(
  card: HTMLElement,
  view: EditorView,
  record: VisualTikzcdRecord,
  trigger: HTMLButtonElement,
): void {
  const existing = card.querySelector<HTMLElement>(".texleaf-visual-structure-editor");
  if (existing !== null) {
    existing.dispatchEvent(new Event("texleaf-request-close"));
    return;
  }
  const viewportAnchor = structureCardViewportAnchor(card);
  const triggerLabel = trigger.textContent ?? "可视化编辑交换图";
  trigger.textContent = "关闭交换图编辑";
  trigger.setAttribute("aria-pressed", "true");
  const nodes = Array.from({ length: record.rowCount }, () =>
    Array.from({ length: record.columnCount }, () => "")
  );
  for (const node of record.nodes) {
    if (nodes[node.row] !== undefined) {
      nodes[node.row]![node.column] = node.math.tex;
    }
  }
  const model: MutableTikzcdModel = {
    nodes,
    arrows: record.arrows.map((arrow) => ({
      fromRow: arrow.fromRow,
      fromColumn: arrow.fromColumn,
      toRow: arrow.toRow,
      toColumn: arrow.toColumn,
      label: arrow.label?.tex ?? "",
      swap: arrow.swap,
      lineStyle: arrow.lineStyle,
      bend: arrow.bend ?? "none",
      bendAmount: arrow.bendAmount ?? 30,
      head: arrow.head === "none" ? "noHead" : arrow.head,
    })),
    rowCount: record.rowCount,
    columnCount: record.columnCount,
  };
  const panel = document.createElement("section");
  panel.className = "texleaf-visual-structure-editor texleaf-tikzcd-visual-editor";
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  const fragments = new Map<string, VisualMathFragment>();
  for (const node of record.nodes) {
    fragments.set(node.math.tex.trim(), node.math);
  }
  for (const arrow of record.arrows) {
    if (arrow.label !== undefined) {
      fragments.set(arrow.label.tex.trim(), arrow.label);
    }
  }
  let session: MutableTikzcdEditorSession;
  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    const closeAnchor = structureCardViewportAnchor(card);
    session.cancelPointerDrag?.();
    session.disposeCanvas?.();
    panel.remove();
    trigger.textContent = triggerLabel;
    trigger.setAttribute("aria-pressed", "false");
    retainStructureCardViewport(view, card, closeAnchor, trigger);
  };
  panel.addEventListener("texleaf-request-close", close);
  session = {
    model,
    selection: undefined,
    focusRow: 0,
    focusColumn: 0,
    arrowMode: true,
    zoom: 1,
    history: [],
    future: [],
    fragments,
    record,
    panel,
    card,
    view,
    close,
    cancelPointerDrag: undefined,
    disposeCanvas: undefined,
    redrawCanvas: undefined,
  };
  panel.addEventListener("keydown", (event) => {
    const target = event.target;
    const nativeTextControl = target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    if (!nativeTextControl && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        redoMutableTikzcdEdit(session);
      } else {
        undoMutableTikzcdEdit(session);
      }
    } else if (!nativeTextControl && event.ctrlKey && event.key.toLowerCase() === "y") {
      event.preventDefault();
      event.stopPropagation();
      redoMutableTikzcdEdit(session);
    } else if (!nativeTextControl && (event.key === "Delete" || event.key === "Backspace")) {
      if (deleteMutableTikzcdSelection(session)) {
        event.preventDefault();
        event.stopPropagation();
      }
    } else if (!nativeTextControl && event.key === "Escape" && session.selection !== undefined) {
      event.preventDefault();
      session.selection = undefined;
      renderVisualTikzcdEditor(session);
    }
  }, true);
  renderVisualTikzcdEditor(session);
  card.append(panel);
  retainStructureCardViewport(
    view,
    card,
    viewportAnchor,
    panel.querySelector<HTMLElement>(".texleaf-tikzcd-editor-cell[tabindex='0']") ?? undefined,
  );
}

function renderVisualTikzcdEditor(session: MutableTikzcdEditorSession): void {
  const { panel, card, view, model } = session;
  session.cancelPointerDrag?.();
  session.disposeCanvas?.();
  session.cancelPointerDrag = undefined;
  session.disposeCanvas = undefined;
  session.redrawCanvas = undefined;
  normalizeMutableTikzcdModel(model);
  normalizeMutableTikzcdSelection(session);
  panel.replaceChildren();
  const title = document.createElement("h3");
  title.className = "texleaf-visual-structure-editor-title";
  title.textContent = "tikzcd 直接操纵编辑器";
  panel.append(title);

  const toolbar = document.createElement("div");
  toolbar.className = "texleaf-tikzcd-direct-toolbar";
  const undo = createTikzcdActionButton("撤销图中操作", "undo", () => {
    undoMutableTikzcdEdit(session);
  });
  undo.disabled = session.history.length === 0;
  const redo = createTikzcdActionButton("重做图中操作", "redo", () => {
    redoMutableTikzcdEdit(session);
  });
  redo.disabled = session.future.length === 0;
  const addRow = createTikzcdActionButton("添加行", "add-row", () => {
    mutateMutableTikzcdModel(session, () => {
      model.rowCount += 1;
      model.nodes.push(Array.from({ length: model.columnCount }, () => ""));
      session.focusRow = model.rowCount - 1;
    });
  });
  addRow.disabled = model.rowCount >= 16;
  const addColumn = createTikzcdActionButton("添加列", "add-column", () => {
    mutateMutableTikzcdModel(session, () => {
      model.columnCount += 1;
      for (const row of model.nodes) {
        row.push("");
      }
      session.focusColumn = model.columnCount - 1;
    });
  });
  addColumn.disabled = model.columnCount >= 16;
  const removeRow = createTikzcdActionButton("删除末行", "remove-row", () => {
    mutateMutableTikzcdModel(session, () => {
      model.rowCount -= 1;
      model.nodes.pop();
      session.focusRow = Math.min(session.focusRow, model.rowCount - 1);
    });
  });
  removeRow.disabled = model.rowCount <= 1;
  const removeColumn = createTikzcdActionButton("删除末列", "remove-column", () => {
    mutateMutableTikzcdModel(session, () => {
      model.columnCount -= 1;
      for (const row of model.nodes) {
        row.pop();
      }
      session.focusColumn = Math.min(session.focusColumn, model.columnCount - 1);
    });
  });
  removeColumn.disabled = model.columnCount <= 1;
  const addArrow = createTikzcdActionButton("添加箭头", "add-arrow", () => {
    const source = session.selection?.kind === "node"
      ? session.selection
      : { kind: "node" as const, row: 0, column: 0 };
    const target = defaultTikzcdTarget(model, source.row, source.column);
    if (target === undefined) {
      return;
    }
    mutateMutableTikzcdModel(session, () => {
      model.arrows.push(createMutableTikzcdArrow(source.row, source.column, target.row, target.column));
      session.selection = { kind: "arrow", index: model.arrows.length - 1 };
    });
  });
  addArrow.disabled = model.arrows.length >= 128 ||
    (model.rowCount === 1 && model.columnCount === 1);
  const arrowMode = createTikzcdActionButton(
    session.arrowMode ? "拖动：画线" : "拖动：移动",
    "arrow-mode",
    () => {
      session.arrowMode = !session.arrowMode;
      renderVisualTikzcdEditor(session);
    },
  );
  arrowMode.classList.toggle("texleaf-tikzcd-mode-active", session.arrowMode);
  arrowMode.setAttribute("aria-pressed", String(session.arrowMode));
  arrowMode.title = session.arrowMode
    ? "默认从节点拖到目标格画箭头；按住 Alt 可临时移动节点"
    : "默认把节点拖到空格；按住 Shift 可临时画箭头";
  const spacer = document.createElement("span");
  spacer.className = "texleaf-tikzcd-direct-toolbar-spacer";
  const zoomOut = createTikzcdActionButton("−", "zoom-out", () => {
    session.zoom = Math.max(0.7, Math.round((session.zoom - 0.1) * 10) / 10);
    renderVisualTikzcdEditor(session);
  });
  zoomOut.title = "缩小交换图画布";
  zoomOut.disabled = session.zoom <= 0.7;
  const zoom = document.createElement("span");
  zoom.className = "texleaf-tikzcd-zoom";
  zoom.textContent = `${Math.round(session.zoom * 100)}%`;
  const zoomIn = createTikzcdActionButton("+", "zoom-in", () => {
    session.zoom = Math.min(1.5, Math.round((session.zoom + 0.1) * 10) / 10);
    renderVisualTikzcdEditor(session);
  });
  zoomIn.title = "放大交换图画布";
  zoomIn.disabled = session.zoom >= 1.5;
  toolbar.append(
    undo,
    redo,
    addRow,
    addColumn,
    removeRow,
    removeColumn,
    addArrow,
    arrowMode,
    spacer,
    zoomOut,
    zoom,
    zoomIn,
  );
  panel.append(toolbar);

  const workspace = document.createElement("div");
  workspace.className = "texleaf-tikzcd-direct-workspace";
  workspace.classList.toggle(
    "texleaf-tikzcd-direct-workspace-arrow-mode",
    session.arrowMode,
  );
  workspace.setAttribute("role", "application");
  workspace.setAttribute(
    "aria-label",
    "交换图画布。点击节点选择；默认从节点拖到目标格创建箭头。切换到移动模式或按住 Alt 可移动节点，Shift 始终临时创建箭头。",
  );
  const canvas = document.createElement("div");
  canvas.className = "texleaf-tikzcd-direct-canvas";
  canvas.style.fontSize = `${session.zoom * 100}%`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("texleaf-tikzcd-editor-arrows");
  const grid = document.createElement("div");
  grid.className = "texleaf-tikzcd-direct-grid";
  grid.setAttribute("role", "grid");
  grid.style.gridTemplateColumns = `repeat(${model.columnCount}, 8em)`;
  const nodeElements = new Map<string, HTMLElement>();
  for (let row = 0; row < model.rowCount; row += 1) {
    for (let column = 0; column < model.columnCount; column += 1) {
      const cell = document.createElement("div");
      cell.className = "texleaf-tikzcd-editor-cell";
      cell.dataset.tikzcdEditorRow = String(row);
      cell.dataset.tikzcdEditorColumn = String(column);
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", `第 ${row + 1} 行第 ${column + 1} 列`);
      cell.tabIndex = row === session.focusRow && column === session.focusColumn ? 0 : -1;
      if (
        session.selection?.kind === "node" &&
        session.selection.row === row &&
        session.selection.column === column
      ) {
        cell.classList.add("texleaf-tikzcd-editor-cell-selected");
      }
      cell.addEventListener("focus", () => {
        session.focusRow = row;
        session.focusColumn = column;
      });
      cell.addEventListener("keydown", (event) => {
        handleTikzcdCellKeydown(event, session, row, column);
      });
      const node = document.createElement("div");
      node.className = "texleaf-tikzcd-editor-node";
      node.dataset.tikzcdEditorNode = `${row}:${column}`;
      const nodeSource = model.nodes[row]?.[column] ?? "";
      if (nodeSource.trim().length === 0) {
        node.classList.add("texleaf-tikzcd-editor-node-empty");
      }
      const nodeLabel = document.createElement("span");
      nodeLabel.className = "texleaf-tikzcd-editor-node-label";
      nodeLabel.dataset.tikzcdEditorNodeLabel = `${row}:${column}`;
      nodeLabel.append(createTikzcdEditorMath(session, nodeSource, "\\bullet"));
      node.append(nodeLabel);
      node.title = session.arrowMode
        ? "从节点中心拖出箭头；拖动格内外围可移动节点"
        : "拖动节点；按住 Shift 从中心拖出箭头";
      node.addEventListener("pointerdown", (event) => {
        if ((session.arrowMode && !event.altKey) || event.shiftKey) {
          startTikzcdArrowPointerDrag(event, session, canvas, svg, {
            kind: "create",
            row,
            column,
          });
        } else {
          startTikzcdNodePointerDrag(event, session, canvas, svg, row, column);
        }
      });
      cell.title = nodeSource.trim().length > 0
        ? "拖动节点外围移动位置；从中间标签区域拖出箭头"
        : "拖到其他空格可同时创建节点与箭头；双击创建节点";
      cell.addEventListener("pointerdown", (event) => {
        if (event.target !== cell) {
          return;
        }
        if (nodeSource.trim().length > 0) {
          startTikzcdNodePointerDrag(event, session, canvas, svg, row, column);
        } else {
          startTikzcdArrowPointerDrag(event, session, canvas, svg, {
            kind: "create",
            row,
            column,
          });
        }
      });
      cell.addEventListener("dblclick", (event) => {
        if (event.button !== 0 || (session.model.nodes[row]?.[column] ?? "").trim().length > 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        mutateMutableTikzcdModel(session, () => {
          session.model.nodes[row]![column] = "\\bullet";
          session.focusRow = row;
          session.focusColumn = column;
          session.selection = { kind: "node", row, column };
        });
      });
      nodeElements.set(`${row}:${column}`, node);
      const connector = document.createElement("button");
      connector.type = "button";
      connector.className = "texleaf-tikzcd-connect-handle";
      connector.tabIndex = -1;
      connector.title = `从 (${row + 1},${column + 1}) 拖出箭头`;
      connector.setAttribute("aria-label", connector.title);
      connector.addEventListener("pointerdown", (event) => {
        startTikzcdArrowPointerDrag(event, session, canvas, svg, {
          kind: "create",
          row,
          column,
        });
      });
      node.append(connector);
      cell.append(node);
      grid.append(cell);
    }
  }
  canvas.append(svg, grid);
  workspace.append(canvas);
  panel.append(workspace);
  scheduleEditableTikzcdDrawing(session, canvas, svg, nodeElements);

  panel.append(createTikzcdSelectionPanel(session));
  panel.append(createTikzcdExactNodeEditor(session));

  const controls = document.createElement("div");
  controls.className = "texleaf-structure-actions";
  const cancel = createPlainStructureButton("取消", session.close);
  const apply = createPlainStructureButton("应用交换图修改", () => {
    applyVisualTikzcdEdit(card, view, model);
  }, true);
  controls.append(cancel, apply);
  panel.append(controls);
  const note = document.createElement("div");
  note.className = "texleaf-visual-editor-note";
  note.textContent = "点击节点后可编辑标签；默认从节点中央拖到目标格就是画箭头，拖动节点所在格的外围可移动节点。切换“拖动：移动”或 Alt+拖动也可换格，Shift+拖动始终画线。选中箭头后可拖动两端重连。标签输入支持 TeXLeaf 片段与 Ctrl+Space 补全；应用时只重写 tikzcd 正文，环境选项保持不变。";
  panel.append(note);
  view.requestMeasure();
}

function createTikzcdActionButton(
  label: string,
  action: string,
  handler: () => void,
): HTMLButtonElement {
  const button = createPlainStructureButton(label, handler);
  button.dataset.texleafTikzcdAction = action;
  return button;
}

function createMutableTikzcdArrow(
  fromRow: number,
  fromColumn: number,
  toRow: number,
  toColumn: number,
): MutableTikzcdArrow {
  return {
    fromRow,
    fromColumn,
    toRow,
    toColumn,
    label: "",
    swap: false,
    lineStyle: "solid",
    bend: "none",
    bendAmount: 30,
    head: "normal",
  };
}

function defaultTikzcdTarget(
  model: MutableTikzcdModel,
  row: number,
  column: number,
): { readonly row: number; readonly column: number } | undefined {
  if (column + 1 < model.columnCount) {
    return { row, column: column + 1 };
  }
  if (row + 1 < model.rowCount) {
    return { row: row + 1, column };
  }
  if (column > 0) {
    return { row, column: column - 1 };
  }
  if (row > 0) {
    return { row: row - 1, column };
  }
  return undefined;
}

function cloneMutableTikzcdModel(model: MutableTikzcdModel): MutableTikzcdModel {
  return {
    nodes: model.nodes.map((row) => [...row]),
    arrows: model.arrows.map((arrow) => ({ ...arrow })),
    rowCount: model.rowCount,
    columnCount: model.columnCount,
  };
}

function mutableTikzcdModelsEqual(
  left: MutableTikzcdModel,
  right: MutableTikzcdModel,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mutateMutableTikzcdModel(
  session: MutableTikzcdEditorSession,
  mutation: () => void,
): void {
  const before = cloneMutableTikzcdModel(session.model);
  mutation();
  normalizeMutableTikzcdModel(session.model);
  if (!mutableTikzcdModelsEqual(before, session.model)) {
    session.history.push(before);
    if (session.history.length > 100) {
      session.history.shift();
    }
    session.future.length = 0;
  }
  renderVisualTikzcdEditor(session);
}

function commitMutableTikzcdTextHistory(
  session: MutableTikzcdEditorSession,
  before: MutableTikzcdModel | undefined,
): void {
  if (before === undefined || mutableTikzcdModelsEqual(before, session.model)) {
    return;
  }
  session.history.push(before);
  if (session.history.length > 100) {
    session.history.shift();
  }
  session.future.length = 0;
}

function undoMutableTikzcdEdit(session: MutableTikzcdEditorSession): void {
  const previous = session.history.pop();
  if (previous === undefined) {
    return;
  }
  session.future.push(cloneMutableTikzcdModel(session.model));
  session.model = previous;
  renderVisualTikzcdEditor(session);
}

function redoMutableTikzcdEdit(session: MutableTikzcdEditorSession): void {
  const next = session.future.pop();
  if (next === undefined) {
    return;
  }
  session.history.push(cloneMutableTikzcdModel(session.model));
  session.model = next;
  renderVisualTikzcdEditor(session);
}

function normalizeMutableTikzcdSelection(session: MutableTikzcdEditorSession): void {
  const selection = session.selection;
  if (selection?.kind === "arrow" && selection.index >= session.model.arrows.length) {
    session.selection = session.model.arrows.length === 0
      ? undefined
      : { kind: "arrow", index: session.model.arrows.length - 1 };
  } else if (selection?.kind === "node") {
    session.selection = {
      kind: "node",
      row: clampInteger(selection.row, 0, session.model.rowCount - 1),
      column: clampInteger(selection.column, 0, session.model.columnCount - 1),
    };
  }
  session.focusRow = clampInteger(session.focusRow, 0, session.model.rowCount - 1);
  session.focusColumn = clampInteger(session.focusColumn, 0, session.model.columnCount - 1);
}

function deleteMutableTikzcdSelection(session: MutableTikzcdEditorSession): boolean {
  const selection = session.selection;
  if (selection === undefined) {
    return false;
  }
  mutateMutableTikzcdModel(session, () => {
    if (selection.kind === "arrow") {
      session.model.arrows.splice(selection.index, 1);
    } else {
      session.model.nodes[selection.row]![selection.column] = "";
      session.model.arrows = session.model.arrows.filter((arrow) =>
        !(arrow.fromRow === selection.row && arrow.fromColumn === selection.column) &&
        !(arrow.toRow === selection.row && arrow.toColumn === selection.column)
      );
    }
    session.selection = undefined;
  });
  return true;
}

function createTikzcdEditorMath(
  session: MutableTikzcdEditorSession,
  source: string,
  emptyFallback: string,
): HTMLElement {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    const empty = document.createElement("span");
    empty.textContent = emptyFallback;
    return empty;
  }
  const fragment = session.fragments.get(trimmed);
  return createMathFragmentElement(fragment, fragment?.fallback ?? trimmed);
}

function createTikzcdSelectionPanel(
  session: MutableTikzcdEditorSession,
): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "texleaf-tikzcd-selection-panel";
  const selection = session.selection;
  if (selection === undefined) {
    const title = document.createElement("h4");
    title.className = "texleaf-tikzcd-selection-title";
    title.textContent = "尚未选择对象";
    const hint = document.createElement("p");
    hint.className = "texleaf-tikzcd-selection-hint";
    hint.textContent = "点击节点或箭头进行精确编辑；也可用方向键移动焦点、Enter 编辑节点、从圆点拖出箭头。";
    panel.append(title, hint);
    if (session.model.arrows.length > 0) {
      const actions = document.createElement("div");
      actions.className = "texleaf-tikzcd-selection-actions";
      for (let index = 0; index < session.model.arrows.length; index += 1) {
        const arrow = session.model.arrows[index]!;
        const button = createTikzcdActionButton(
          `箭头 ${index + 1}: (${arrow.fromRow + 1},${arrow.fromColumn + 1}) → (${arrow.toRow + 1},${arrow.toColumn + 1})`,
          `select-arrow-${index}`,
          () => {
            session.selection = { kind: "arrow", index };
            renderVisualTikzcdEditor(session);
          },
        );
        actions.append(button);
      }
      panel.append(actions);
    }
    return panel;
  }
  if (selection.kind === "node") {
    createTikzcdNodeSelectionPanel(panel, session, selection.row, selection.column);
  } else {
    createTikzcdArrowSelectionPanel(panel, session, selection.index);
  }
  return panel;
}

function createTikzcdNodeSelectionPanel(
  panel: HTMLElement,
  session: MutableTikzcdEditorSession,
  row: number,
  column: number,
): void {
  const title = document.createElement("h4");
  title.className = "texleaf-tikzcd-selection-title";
  title.textContent = `节点 (${row + 1},${column + 1})`;
  panel.append(title);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "texleaf-tikzcd-node-input";
  input.dataset.tikzcdNodeInput = `${row}:${column}`;
  input.value = session.model.nodes[row]?.[column] ?? "";
  input.placeholder = "节点标签 LaTeX";
  input.setAttribute("aria-label", `第 ${row + 1} 行第 ${column + 1} 列节点 LaTeX`);
  const sourceAnchor = session.record.nodes.find(
    (node) => node.row === row && node.column === column,
  )?.math.sourceFrom;
  attachTikzcdVirtualInput(session, input, (value) => {
    session.model.nodes[row]![column] = value;
    syncTikzcdNodeInputsAndDisplay(session, row, column, value, input);
  }, sourceAnchor);
  panel.append(createTikzcdField("节点标签 LaTeX", input));
  const hint = document.createElement("p");
  hint.className = "texleaf-tikzcd-selection-hint";
  hint.textContent = "节点处于数学模式：TeXLeaf 自动片段、Tab/空格展开和 Ctrl+Space 补全均可用。默认从节点中央拖动可画箭头；拖动格内外围、切到移动模式或按住 Alt 可换格。";
  panel.append(hint);
  const actions = document.createElement("div");
  actions.className = "texleaf-tikzcd-selection-actions";
  const snippets = createTikzcdActionButton("片段 / 补全", "node-completions", () => {
    openVirtualLatexCompletion(input);
  });
  const clear = createTikzcdActionButton("删除节点及相连箭头", "delete-node", () => {
    deleteMutableTikzcdSelection(session);
  });
  actions.append(snippets, clear);
  panel.append(actions);
}

function createTikzcdArrowSelectionPanel(
  panel: HTMLElement,
  session: MutableTikzcdEditorSession,
  index: number,
): void {
  const arrow = session.model.arrows[index];
  if (arrow === undefined) {
    return;
  }
  const title = document.createElement("h4");
  title.className = "texleaf-tikzcd-selection-title";
  title.textContent = `箭头 ${index + 1}`;
  panel.append(title);
  const from = createTikzcdPositionSelect(session.model, arrow.fromRow, arrow.fromColumn);
  from.setAttribute("aria-label", `第 ${index + 1} 条箭头起点`);
  from.addEventListener("change", () => {
    mutateMutableTikzcdModel(session, () => {
      [arrow.fromRow, arrow.fromColumn] = decodeTikzcdPosition(from.value, session.model.columnCount);
    });
  });
  const to = createTikzcdPositionSelect(session.model, arrow.toRow, arrow.toColumn);
  to.setAttribute("aria-label", `第 ${index + 1} 条箭头终点`);
  to.addEventListener("change", () => {
    mutateMutableTikzcdModel(session, () => {
      [arrow.toRow, arrow.toColumn] = decodeTikzcdPosition(to.value, session.model.columnCount);
    });
  });
  panel.append(createTikzcdField("起点", from), createTikzcdField("终点", to));
  const label = document.createElement("input");
  label.type = "text";
  label.className = "texleaf-tikzcd-label-input";
  label.dataset.tikzcdArrowLabelInput = String(index);
  label.value = arrow.label;
  label.placeholder = "箭头标签 LaTeX";
  attachTikzcdVirtualInput(session, label, (value) => {
    arrow.label = value;
    syncTikzcdArrowLabel(session, index, value, label);
  }, session.record.arrows[index]?.label?.sourceFrom);
  panel.append(createTikzcdField("箭头标签 LaTeX", label));
  const line = createTikzcdOptionSelect<MutableTikzcdLineStyle>([
    ["solid", "实线"],
    ["dashed", "虚线"],
    ["dotted", "点线"],
  ], arrow.lineStyle);
  line.addEventListener("change", () => {
    mutateMutableTikzcdModel(session, () => {
      arrow.lineStyle = line.value as MutableTikzcdLineStyle;
    });
  });
  const bend = createTikzcdOptionSelect<MutableTikzcdBend>([
    ["none", "直线"],
    ["left", "向左弯"],
    ["right", "向右弯"],
  ], arrow.bend);
  bend.addEventListener("change", () => {
    mutateMutableTikzcdModel(session, () => {
      arrow.bend = bend.value as MutableTikzcdBend;
    });
  });
  const bendAmount = createTikzcdOptionSelect<string>([
    ["15", "15°"],
    ["30", "30°"],
    ["45", "45°"],
    ["60", "60°"],
  ], String(closestTikzcdBendAmount(arrow.bendAmount)));
  bendAmount.disabled = arrow.bend === "none";
  bendAmount.addEventListener("change", () => {
    mutateMutableTikzcdModel(session, () => {
      arrow.bendAmount = Number.parseInt(bendAmount.value, 10) || 30;
    });
  });
  const head = createTikzcdOptionSelect<MutableTikzcdHead>([
    ["normal", "普通箭头"],
    ["twoHeads", "双箭头头"],
    ["hook", "Hook 尾"],
    ["noHead", "无箭头头"],
  ], arrow.head);
  head.addEventListener("change", () => {
    mutateMutableTikzcdModel(session, () => {
      arrow.head = head.value as MutableTikzcdHead;
    });
  });
  panel.append(
    createTikzcdField("线型", line),
    createTikzcdField("弯曲", bend),
    createTikzcdField("弯曲角度", bendAmount),
    createTikzcdField("箭头样式", head),
  );
  const swapLabel = document.createElement("label");
  swapLabel.className = "texleaf-table-checkbox";
  const swap = document.createElement("input");
  swap.type = "checkbox";
  swap.checked = arrow.swap;
  swap.addEventListener("change", () => {
    mutateMutableTikzcdModel(session, () => {
      arrow.swap = swap.checked;
    });
  });
  swapLabel.append(swap, document.createTextNode("标签放在箭头反侧"));
  panel.append(swapLabel);
  const hint = document.createElement("p");
  hint.className = "texleaf-tikzcd-selection-hint";
  hint.textContent = "箭头标签支持 TeXLeaf 片段与 Ctrl+Space 补全；画布端点可拖动重连，线型、弯曲和头型可组合。";
  panel.append(hint);
  const actions = document.createElement("div");
  actions.className = "texleaf-tikzcd-selection-actions";
  const snippets = createTikzcdActionButton("片段 / 补全", "arrow-completions", () => {
    openVirtualLatexCompletion(label);
  });
  const reverse = createTikzcdActionButton("反转方向", "reverse-arrow", () => {
    mutateMutableTikzcdModel(session, () => {
      [arrow.fromRow, arrow.toRow] = [arrow.toRow, arrow.fromRow];
      [arrow.fromColumn, arrow.toColumn] = [arrow.toColumn, arrow.fromColumn];
      arrow.swap = !arrow.swap;
    });
  });
  const remove = createTikzcdActionButton("删除箭头", "delete-arrow", () => {
    deleteMutableTikzcdSelection(session);
  });
  actions.append(snippets, reverse, remove);
  panel.append(actions);
}

function createTikzcdField(label: string, control: HTMLElement): HTMLElement {
  const field = document.createElement("label");
  field.className = "texleaf-tikzcd-field";
  field.append(document.createTextNode(label), control);
  return field;
}

function createTikzcdOptionSelect<T extends string>(
  entries: readonly (readonly [T, string])[],
  selected: T,
): HTMLSelectElement {
  const select = document.createElement("select");
  for (const [value, label] of entries) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    select.append(option);
  }
  return select;
}

function closestTikzcdBendAmount(value: number): 15 | 30 | 45 | 60 {
  return [15, 30, 45, 60].reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  , 30) as 15 | 30 | 45 | 60;
}

function attachTikzcdVirtualInput(
  session: MutableTikzcdEditorSession,
  input: HTMLInputElement,
  commit: (value: string) => void,
  sourceAnchor?: number,
): void {
  let beforeFocus: MutableTikzcdModel | undefined;
  input.addEventListener("focus", () => {
    beforeFocus = cloneMutableTikzcdModel(session.model);
  });
  input.addEventListener("blur", () => {
    commitMutableTikzcdTextHistory(session, beforeFocus);
    beforeFocus = undefined;
  });
  attachVirtualLatexInput(input, {
    context: "tikzcd",
    mathPreview: true,
    getAnchor: () => {
      const mappedBody = readMappedDatasetRange(
        session.card,
        "texleafBodyFrom",
        "texleafBodyTo",
        session.view.state.doc.length,
      );
      const bodyAnchor = mappedBody?.from ?? session.record.bodyFrom;
      return sourceAnchor === undefined
        ? bodyAnchor
        : clampNumber(
            bodyAnchor + (sourceAnchor - session.record.bodyFrom),
            bodyAnchor,
            mappedBody?.to ?? session.record.bodyTo,
          );
    },
    commit,
    onMathRendered: (tex, rendered) => {
      cacheMutableTikzcdMathRender(session, input, tex, rendered);
    },
  });
}

/**
 * The direct editor starts with SVG fragments rendered by the host for the
 * source document.  A newly typed label is absent from that immutable source
 * snapshot, so without extending the cache the canvas falls back to raw TeX
 * even though the input popup has already rendered it.  Promote the validated
 * virtual-input result into the session cache and refresh every matching node
 * or arrow label without replacing the focused inspector input.
 */
function cacheMutableTikzcdMathRender(
  session: MutableTikzcdEditorSession,
  origin: HTMLInputElement,
  tex: string,
  rendered: RenderedFormula,
): void {
  const key = tex.trim();
  if (key.length === 0) {
    return;
  }
  const previous = session.fragments.get(key);
  const sourceFrom = previous?.sourceFrom ?? session.record.bodyFrom;
  session.fragments.set(key, {
    tex: key,
    fallback: key,
    sourceFrom,
    sourceTo: previous?.sourceTo ?? sourceFrom + key.length,
    asset: rendered,
  });
  const nodeTargets = new Set<string>();
  const originNode = origin.dataset.tikzcdNodeInput;
  if (originNode !== undefined && origin.value.trim() === key) {
    nodeTargets.add(originNode);
  }
  for (let row = 0; row < session.model.rowCount; row += 1) {
    for (let column = 0; column < session.model.columnCount; column += 1) {
      if ((session.model.nodes[row]?.[column] ?? "").trim() !== key) {
        continue;
      }
      nodeTargets.add(`${row}:${column}`);
    }
  }
  for (const input of Array.from(session.panel.querySelectorAll<HTMLInputElement>(
    "[data-tikzcd-node-input]",
  ))) {
    const coordinates = input.dataset.tikzcdNodeInput;
    if (coordinates !== undefined && input.value.trim() === key) {
      nodeTargets.add(coordinates);
    }
  }
  let updatedNodes = 0;
  for (const coordinates of nodeTargets) {
    const label = session.panel.querySelector<HTMLElement>(
      `[data-tikzcd-editor-node-label="${coordinates}"]`,
    );
    if (label !== null) {
      label.replaceChildren(createTikzcdEditorMath(session, key, "·"));
      updatedNodes += 1;
    }
  }
  session.panel.dataset.texleafTikzcdLastMathTex = key;
  session.panel.dataset.texleafTikzcdLastMathNodes = String(updatedNodes);
  // Arrow labels are rebuilt by the canvas draw pass. This also recalculates
  // arrow endpoints after a rendered node label changes its measured bounds.
  session.redrawCanvas?.();
}

function openVirtualLatexCompletion(input: HTMLInputElement): void {
  const binding = virtualLatexBindings.get(input);
  if (binding === undefined) {
    return;
  }
  input.focus();
  requestVirtualCompletion(binding, true);
}

function syncTikzcdNodeInputsAndDisplay(
  session: MutableTikzcdEditorSession,
  row: number,
  column: number,
  value: string,
  origin: HTMLInputElement,
): void {
  for (const input of Array.from(session.panel.querySelectorAll<HTMLInputElement>(
    `[data-tikzcd-node-input="${row}:${column}"]`,
  ))) {
    if (input !== origin) {
      input.value = value;
    }
  }
  const label = session.panel.querySelector<HTMLElement>(
    `[data-tikzcd-editor-node-label="${row}:${column}"]`,
  );
  label?.replaceChildren(createTikzcdEditorMath(session, value, "·"));
  const node = session.panel.querySelector<HTMLElement>(
    `[data-tikzcd-editor-node="${row}:${column}"]`,
  );
  node?.classList.toggle("texleaf-tikzcd-editor-node-empty", value.trim().length === 0);
  session.redrawCanvas?.();
}

function syncTikzcdArrowLabel(
  session: MutableTikzcdEditorSession,
  index: number,
  value: string,
  origin: HTMLInputElement,
): void {
  for (const input of Array.from(session.panel.querySelectorAll<HTMLInputElement>(
    `[data-tikzcd-arrow-label-input="${index}"]`,
  ))) {
    if (input !== origin) {
      input.value = value;
    }
  }
  const label = session.panel.querySelector<HTMLElement>(
    `[data-tikzcd-editor-arrow-label="${index}"]`,
  );
  if (label !== null) {
    label.replaceChildren(createTikzcdEditorMath(session, value, ""));
  }
  session.redrawCanvas?.();
}

function createTikzcdExactNodeEditor(session: MutableTikzcdEditorSession): HTMLElement {
  const details = document.createElement("details");
  details.className = "texleaf-tikzcd-exact-editor";
  const summary = document.createElement("summary");
  summary.textContent = "精确编辑节点矩阵";
  summary.title = "展开后可连续输入所有节点；每格同样支持 TeXLeaf 片段与补全";
  details.append(summary);
  const scroll = document.createElement("div");
  scroll.className = "texleaf-table-editor-scroll";
  const grid = document.createElement("div");
  grid.className = "texleaf-tikzcd-editor-grid";
  grid.style.gridTemplateColumns = `repeat(${session.model.columnCount}, minmax(7em, 1fr))`;
  for (let row = 0; row < session.model.rowCount; row += 1) {
    for (let column = 0; column < session.model.columnCount; column += 1) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "texleaf-tikzcd-node-input";
      input.dataset.tikzcdNodeInput = `${row}:${column}`;
      input.value = session.model.nodes[row]?.[column] ?? "";
      input.placeholder = `(${row + 1},${column + 1})`;
      input.setAttribute("aria-label", `第 ${row + 1} 行第 ${column + 1} 列节点 LaTeX`);
      const sourceAnchor = session.record.nodes.find(
        (node) => node.row === row && node.column === column,
      )?.math.sourceFrom;
      attachTikzcdVirtualInput(session, input, (value) => {
        session.model.nodes[row]![column] = value;
        syncTikzcdNodeInputsAndDisplay(session, row, column, value, input);
      }, sourceAnchor);
      grid.append(input);
    }
  }
  scroll.append(grid);
  details.append(scroll);
  return details;
}

function handleTikzcdCellKeydown(
  event: KeyboardEvent,
  session: MutableTikzcdEditorSession,
  row: number,
  column: number,
): void {
  const movement = event.key === "ArrowLeft"
    ? [0, -1]
    : event.key === "ArrowRight"
      ? [0, 1]
      : event.key === "ArrowUp"
        ? [-1, 0]
        : event.key === "ArrowDown"
          ? [1, 0]
          : undefined;
  if (movement !== undefined) {
    event.preventDefault();
    const nextRow = clampInteger(row + movement[0]!, 0, session.model.rowCount - 1);
    const nextColumn = clampInteger(column + movement[1]!, 0, session.model.columnCount - 1);
    session.focusRow = nextRow;
    session.focusColumn = nextColumn;
    session.panel.querySelector<HTMLElement>(
      `[data-tikzcd-editor-row="${nextRow}"][data-tikzcd-editor-column="${nextColumn}"]`,
    )?.focus();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    session.selection = { kind: "node", row, column };
    renderVisualTikzcdEditor(session);
    requestAnimationFrame(() => {
      session.panel.querySelector<HTMLInputElement>(
        `[data-tikzcd-node-input="${row}:${column}"]`,
      )?.focus();
    });
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    const previous = session.selection;
    if (
      previous?.kind === "node" &&
      (previous.row !== row || previous.column !== column)
    ) {
      mutateMutableTikzcdModel(session, () => {
        session.model.arrows.push(createMutableTikzcdArrow(
          previous.row,
          previous.column,
          row,
          column,
        ));
        session.selection = { kind: "arrow", index: session.model.arrows.length - 1 };
      });
    } else {
      session.selection = { kind: "node", row, column };
      renderVisualTikzcdEditor(session);
    }
  }
}

function startTikzcdNodePointerDrag(
  event: PointerEvent,
  session: MutableTikzcdEditorSession,
  _canvas: HTMLElement,
  _svg: SVGSVGElement,
  row: number,
  column: number,
): void {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  session.cancelPointerDrag?.();
  const captureTarget = event.currentTarget instanceof Element
    ? event.currentTarget
    : undefined;
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  let dropCell: HTMLElement | undefined;
  const clearDrop = (): void => {
    dropCell?.classList.remove("texleaf-tikzcd-editor-cell-drop");
    dropCell = undefined;
  };
  const move = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId !== event.pointerId) {
      return;
    }
    moved ||= Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) >= 5;
    if (!moved) {
      return;
    }
    const next = tikzcdCellAtPoint(session.panel, moveEvent.clientX, moveEvent.clientY);
    if (next !== dropCell) {
      clearDrop();
      dropCell = next;
      dropCell?.classList.add("texleaf-tikzcd-editor-cell-drop");
    }
  };
  const finish = (upEvent: PointerEvent): void => {
    if (upEvent.pointerId !== event.pointerId) {
      return;
    }
    const target = readTikzcdCellPosition(dropCell);
    cleanup();
    if (
      moved &&
      target !== undefined &&
      (target.row !== row || target.column !== column)
    ) {
      const source = session.model.nodes[row]?.[column] ?? "";
      const targetSource = session.model.nodes[target.row]?.[target.column] ?? "";
      if (source.trim().length === 0) {
        setStatus("info", "空节点没有可移动的标签；可从蓝色圆点拖出箭头。", 2_500);
      } else if (targetSource.trim().length > 0) {
        setStatus("warning", "目标格已有节点；请拖到空格，或先编辑/删除目标节点。", 3_000);
      } else {
        mutateMutableTikzcdModel(session, () => {
          session.model.nodes[target.row]![target.column] = source;
          session.model.nodes[row]![column] = "";
          for (const arrow of session.model.arrows) {
            if (arrow.fromRow === row && arrow.fromColumn === column) {
              arrow.fromRow = target.row;
              arrow.fromColumn = target.column;
            }
            if (arrow.toRow === row && arrow.toColumn === column) {
              arrow.toRow = target.row;
              arrow.toColumn = target.column;
            }
          }
          session.focusRow = target.row;
          session.focusColumn = target.column;
          session.selection = { kind: "node", row: target.row, column: target.column };
        });
        return;
      }
    }
    session.focusRow = row;
    session.focusColumn = column;
    session.selection = { kind: "node", row, column };
    renderVisualTikzcdEditor(session);
  };
  const cancel = (cancelEvent: PointerEvent): void => {
    if (cancelEvent.pointerId === event.pointerId) {
      cleanup();
    }
  };
  const cleanup = (): void => {
    clearDrop();
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", finish, true);
    window.removeEventListener("pointercancel", cancel, true);
    try {
      if (captureTarget?.hasPointerCapture(event.pointerId)) {
        captureTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    if (session.cancelPointerDrag === cleanup) {
      session.cancelPointerDrag = undefined;
    }
  };
  session.cancelPointerDrag = cleanup;
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", finish, true);
  window.addEventListener("pointercancel", cancel, true);
  try {
    captureTarget?.setPointerCapture(event.pointerId);
  } catch {
    // Window-level listeners remain as the compatibility fallback.
  }
}

type TikzcdArrowPointerOperation =
  | { readonly kind: "create"; readonly row: number; readonly column: number }
  | { readonly kind: "source" | "target"; readonly index: number };

function startTikzcdArrowPointerDrag(
  event: PointerEvent,
  session: MutableTikzcdEditorSession,
  canvas: HTMLElement,
  svg: SVGSVGElement,
  operation: TikzcdArrowPointerOperation,
): void {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  session.cancelPointerDrag?.();
  const captureTarget = event.currentTarget instanceof Element
    ? event.currentTarget
    : undefined;
  const dragMarkerId = `texleaf-tikzcd-drag-marker-${++tikzcdMarkerSequence}`;
  const dragDefs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  dragDefs.append(createTikzcdMarker(
    dragMarkerId,
    false,
    "var(--vscode-focusBorder)",
  ));
  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.classList.add("texleaf-tikzcd-editor-drag-line");
  line.setAttribute("marker-end", `url(#${dragMarkerId})`);
  svg.append(dragDefs, line);
  const origin = tikzcdPointerOperationOrigin(session, operation);
  const originNode: HTMLElement | undefined = origin === undefined
    ? undefined
    : session.panel.querySelector<HTMLElement>(
        `[data-tikzcd-editor-node="${origin.row}:${origin.column}"]`,
      ) ?? undefined;
  const startCenter = originNode === undefined
    ? tikzcdCanvasPoint(canvas, event.clientX, event.clientY)
    : tikzcdElementCenter(canvas, originNode);
  originNode?.classList.add("texleaf-tikzcd-editor-node-source");
  const startClientX = event.clientX;
  const startClientY = event.clientY;
  let moved = false;
  let dropCell: HTMLElement | undefined;
  const clearDrop = (): void => {
    dropCell?.classList.remove("texleaf-tikzcd-editor-cell-drop");
    dropCell = undefined;
  };
  const drawPreview = (
    pointer: { readonly x: number; readonly y: number },
    targetNode: HTMLElement | undefined,
  ): void => {
    const targetCenter = targetNode === undefined
      ? pointer
      : tikzcdElementCenter(canvas, targetNode);
    const deltaX = targetCenter.x - startCenter.x;
    const deltaY = targetCenter.y - startCenter.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 1) {
      line.setAttribute(
        "d",
        `M ${startCenter.x} ${startCenter.y} L ${startCenter.x} ${startCenter.y}`,
      );
      return;
    }
    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    const sourceInset = originNode === undefined
      ? 0
      : tikzcdNodeBoundaryDistance(originNode.getBoundingClientRect(), unitX, unitY);
    const targetInset = targetNode === undefined
      ? 0
      : tikzcdNodeBoundaryDistance(targetNode.getBoundingClientRect(), unitX, unitY);
    const start = {
      x: startCenter.x + unitX * sourceInset,
      y: startCenter.y + unitY * sourceInset,
    };
    const end = {
      x: targetCenter.x - unitX * targetInset,
      y: targetCenter.y - unitY * targetInset,
    };
    line.setAttribute("d", `M ${start.x} ${start.y} L ${end.x} ${end.y}`);
  };
  const move = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId !== event.pointerId) {
      return;
    }
    moved ||= Math.hypot(
      moveEvent.clientX - startClientX,
      moveEvent.clientY - startClientY,
    ) >= 4;
    if (!moved) {
      return;
    }
    const point = tikzcdCanvasPoint(canvas, moveEvent.clientX, moveEvent.clientY);
    const next = tikzcdCellAtPoint(session.panel, moveEvent.clientX, moveEvent.clientY);
    if (next !== dropCell) {
      clearDrop();
      dropCell = next;
      dropCell?.classList.add("texleaf-tikzcd-editor-cell-drop");
    }
    const targetPosition = readTikzcdCellPosition(next);
    const targetNode = targetPosition === undefined
      ? undefined
      : session.panel.querySelector<HTMLElement>(
          `[data-tikzcd-editor-node="${targetPosition.row}:${targetPosition.column}"]`,
        ) ?? undefined;
    drawPreview(point, targetNode);
  };
  const finish = (upEvent: PointerEvent): void => {
    if (upEvent.pointerId !== event.pointerId) {
      return;
    }
    const target = readTikzcdCellPosition(dropCell);
    cleanup();
    if (origin === undefined) {
      return;
    }
    if (!moved) {
      if (operation.kind === "create") {
        session.focusRow = origin.row;
        session.focusColumn = origin.column;
        session.selection = { kind: "node", row: origin.row, column: origin.column };
        renderVisualTikzcdEditor(session);
      }
      return;
    }
    if (target === undefined) {
      setStatus("info", "请把箭头拖到目标网格内再松开鼠标。", 2_500);
      return;
    }
    if (operation.kind === "create") {
      if (target.row === origin.row && target.column === origin.column) {
        session.selection = { kind: "node", row: origin.row, column: origin.column };
        renderVisualTikzcdEditor(session);
        return;
      }
      if (session.model.arrows.length >= 128) {
        setStatus("warning", "交换图已达到 128 条箭头的可视化编辑上限。", 3_000);
        return;
      }
      mutateMutableTikzcdModel(session, () => {
        if ((session.model.nodes[origin.row]?.[origin.column] ?? "").trim().length === 0) {
          session.model.nodes[origin.row]![origin.column] = "\\bullet";
        }
        if ((session.model.nodes[target.row]?.[target.column] ?? "").trim().length === 0) {
          session.model.nodes[target.row]![target.column] = "\\bullet";
        }
        const arrow = createMutableTikzcdArrow(origin.row, origin.column, target.row, target.column);
        const parallels = session.model.arrows.filter((candidate) =>
          candidate.fromRow === origin.row &&
          candidate.fromColumn === origin.column &&
          candidate.toRow === target.row &&
          candidate.toColumn === target.column
        ).length;
        if (parallels > 0) {
          arrow.bend = parallels % 2 === 1 ? "left" : "right";
          arrow.bendAmount = Math.min(60, 15 + parallels * 15);
        }
        session.model.arrows.push(arrow);
        session.selection = { kind: "arrow", index: session.model.arrows.length - 1 };
      });
      return;
    }
    const arrow = session.model.arrows[operation.index];
    if (arrow === undefined) {
      return;
    }
    const other = operation.kind === "source"
      ? { row: arrow.toRow, column: arrow.toColumn }
      : { row: arrow.fromRow, column: arrow.fromColumn };
    if (target.row === other.row && target.column === other.column) {
      setStatus("warning", "箭头起点与终点不能是同一格。", 2_500);
      return;
    }
    mutateMutableTikzcdModel(session, () => {
      if ((session.model.nodes[target.row]?.[target.column] ?? "").trim().length === 0) {
        session.model.nodes[target.row]![target.column] = "\\bullet";
      }
      if (operation.kind === "source") {
        arrow.fromRow = target.row;
        arrow.fromColumn = target.column;
      } else {
        arrow.toRow = target.row;
        arrow.toColumn = target.column;
      }
      session.selection = { kind: "arrow", index: operation.index };
    });
  };
  const cancel = (cancelEvent: PointerEvent): void => {
    if (cancelEvent.pointerId === event.pointerId) {
      cleanup();
    }
  };
  const cleanup = (): void => {
    clearDrop();
    originNode?.classList.remove("texleaf-tikzcd-editor-node-source");
    dragDefs.remove();
    line.remove();
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", finish, true);
    window.removeEventListener("pointercancel", cancel, true);
    try {
      if (captureTarget?.hasPointerCapture(event.pointerId)) {
        captureTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    if (session.cancelPointerDrag === cleanup) {
      session.cancelPointerDrag = undefined;
    }
  };
  session.cancelPointerDrag = cleanup;
  drawPreview(startCenter, undefined);
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", finish, true);
  window.addEventListener("pointercancel", cancel, true);
  try {
    captureTarget?.setPointerCapture(event.pointerId);
  } catch {
    // Window-level listeners remain as the compatibility fallback.
  }
}

function tikzcdPointerOperationOrigin(
  session: MutableTikzcdEditorSession,
  operation: TikzcdArrowPointerOperation,
): { readonly row: number; readonly column: number } | undefined {
  if (operation.kind === "create") {
    return { row: operation.row, column: operation.column };
  }
  const arrow = session.model.arrows[operation.index];
  if (arrow === undefined) {
    return undefined;
  }
  return operation.kind === "source"
    ? { row: arrow.fromRow, column: arrow.fromColumn }
    : { row: arrow.toRow, column: arrow.toColumn };
}

function tikzcdCellAtPoint(
  panel: HTMLElement,
  clientX: number,
  clientY: number,
): HTMLElement | undefined {
  for (const cell of Array.from(
    panel.querySelectorAll<HTMLElement>(".texleaf-tikzcd-editor-cell"),
  )) {
    const rectangle = cell.getBoundingClientRect();
    if (
      clientX >= rectangle.left && clientX <= rectangle.right &&
      clientY >= rectangle.top && clientY <= rectangle.bottom
    ) {
      return cell;
    }
  }
  return undefined;
}

function readTikzcdCellPosition(
  cell: HTMLElement | undefined,
): { readonly row: number; readonly column: number } | undefined {
  if (cell === undefined) {
    return undefined;
  }
  const row = Number.parseInt(cell.dataset.tikzcdEditorRow ?? "", 10);
  const column = Number.parseInt(cell.dataset.tikzcdEditorColumn ?? "", 10);
  return Number.isSafeInteger(row) && Number.isSafeInteger(column)
    ? { row, column }
    : undefined;
}

function tikzcdCanvasPoint(
  canvas: HTMLElement,
  clientX: number,
  clientY: number,
): { readonly x: number; readonly y: number } {
  const rectangle = canvas.getBoundingClientRect();
  return {
    x: clientX - rectangle.left,
    y: clientY - rectangle.top,
  };
}

function tikzcdElementCenter(
  canvas: HTMLElement,
  element: HTMLElement,
): { readonly x: number; readonly y: number } {
  const canvasRectangle = canvas.getBoundingClientRect();
  const rectangle = element.getBoundingClientRect();
  return {
    x: rectangle.left - canvasRectangle.left + rectangle.width / 2,
    y: rectangle.top - canvasRectangle.top + rectangle.height / 2,
  };
}

interface MutableTikzcdArrowGeometry {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  readonly control: { readonly x: number; readonly y: number };
  readonly midpoint: { readonly x: number; readonly y: number };
  readonly unitX: number;
  readonly unitY: number;
  readonly bendAmount: number;
  readonly path: string;
}

function mutableTikzcdArrowGeometry(
  canvas: HTMLElement,
  fromNode: HTMLElement,
  toNode: HTMLElement,
  arrow: MutableTikzcdArrow,
): MutableTikzcdArrowGeometry | undefined {
  const canvasRectangle = canvas.getBoundingClientRect();
  const fromRectangle = fromNode.getBoundingClientRect();
  const toRectangle = toNode.getBoundingClientRect();
  const fromCenter = {
    x: fromRectangle.left - canvasRectangle.left + fromRectangle.width / 2,
    y: fromRectangle.top - canvasRectangle.top + fromRectangle.height / 2,
  };
  const toCenter = {
    x: toRectangle.left - canvasRectangle.left + toRectangle.width / 2,
    y: toRectangle.top - canvasRectangle.top + toRectangle.height / 2,
  };
  const deltaX = toCenter.x - fromCenter.x;
  const deltaY = toCenter.y - fromCenter.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < 1) {
    return undefined;
  }
  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const startDistance = tikzcdNodeBoundaryDistance(fromRectangle, unitX, unitY);
  const endDistance = tikzcdNodeBoundaryDistance(toRectangle, unitX, unitY);
  const start = {
    x: fromCenter.x + unitX * startDistance,
    y: fromCenter.y + unitY * startDistance,
  };
  const end = {
    x: toCenter.x - unitX * endDistance,
    y: toCenter.y - unitY * endDistance,
  };
  const bendAmount = arrow.bend === "none"
    ? 0
    : (arrow.bend === "left" ? 1 : -1) *
      tikzcdBendControlDistance(distance, arrow.bendAmount);
  const control = {
    x: (start.x + end.x) / 2 + unitY * bendAmount,
    y: (start.y + end.y) / 2 - unitX * bendAmount,
  };
  const midpoint = bendAmount === 0
    ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    : {
        x: (start.x + 2 * control.x + end.x) / 4,
        y: (start.y + 2 * control.y + end.y) / 4,
      };
  return {
    start,
    end,
    control,
    midpoint,
    unitX,
    unitY,
    bendAmount,
    path: bendAmount === 0
      ? `M ${start.x} ${start.y} L ${end.x} ${end.y}`
      : `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
  };
}

/**
 * Approximate tikz-cd's symmetric `bend left/right=<angle>` geometry with a
 * quadratic Bezier control point.  The old linear formula hit a fixed 72 px
 * ceiling, so a long 30 degree arrow and a 45 degree arrow were practically
 * indistinguishable.  Half-chord times tan(angle) preserves the increasingly
 * strong curvature users expect from 15/30/45/60 degrees; the proportional
 * cap only prevents a near-vertical tangent from leaving the canvas entirely.
 */
function tikzcdBendControlDistance(distance: number, angle: number): number {
  const radians = clampInteger(Math.round(angle), 1, 75) * Math.PI / 180;
  return Math.min(
    distance * 0.7,
    Math.max(8, distance * 0.5 * Math.tan(radians)),
  );
}

function scheduleEditableTikzcdDrawing(
  session: MutableTikzcdEditorSession,
  canvas: HTMLElement,
  svg: SVGSVGElement,
  nodes: ReadonlyMap<string, HTMLElement>,
): void {
  const markerId = `texleaf-tikzcd-editor-marker-${++tikzcdMarkerSequence}`;
  let frame = 0;
  const draw = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      drawEditableTikzcdArrows(session, canvas, svg, nodes, markerId);
      session.view.requestMeasure();
    });
  };
  session.redrawCanvas = draw;
  draw();
  const observer = typeof ResizeObserver === "function"
    ? new ResizeObserver(draw)
    : undefined;
  observer?.observe(canvas);
  session.disposeCanvas = () => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    if (session.redrawCanvas === draw) {
      session.redrawCanvas = undefined;
    }
  };
}

function drawEditableTikzcdArrows(
  session: MutableTikzcdEditorSession,
  canvas: HTMLElement,
  svg: SVGSVGElement,
  nodes: ReadonlyMap<string, HTMLElement>,
  markerId: string,
): void {
  svg.replaceChildren();
  for (const label of Array.from(
    canvas.querySelectorAll(".texleaf-tikzcd-editor-arrow-label"),
  )) {
    label.remove();
  }
  const width = Math.max(canvas.clientWidth, canvas.scrollWidth);
  const height = Math.max(canvas.clientHeight, canvas.scrollHeight);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.append(
    createTikzcdMarker(markerId, false),
    createTikzcdMarker(`${markerId}-double`, true),
    createTikzcdMarker(
      `${markerId}-selected`,
      false,
      "var(--vscode-focusBorder)",
    ),
    createTikzcdMarker(
      `${markerId}-double-selected`,
      true,
      "var(--vscode-focusBorder)",
    ),
  );
  svg.append(defs);
  for (let index = 0; index < session.model.arrows.length; index += 1) {
    const arrow = session.model.arrows[index]!;
    const fromNode = nodes.get(`${arrow.fromRow}:${arrow.fromColumn}`);
    const toNode = nodes.get(`${arrow.toRow}:${arrow.toColumn}`);
    if (fromNode === undefined || toNode === undefined) {
      continue;
    }
    const geometry = mutableTikzcdArrowGeometry(canvas, fromNode, toNode, arrow);
    if (geometry === undefined) {
      continue;
    }
    const selected = session.selection?.kind === "arrow" && session.selection.index === index;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.dataset.tikzcdEditorArrow = String(index);
    path.dataset.tikzcdEditorBend = arrow.bend;
    path.setAttribute("d", geometry.path);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", selected ? "var(--vscode-focusBorder)" : "currentColor");
    path.setAttribute("stroke-width", selected ? "2.2" : "1.55");
    path.setAttribute("stroke-linecap", "round");
    if (selected) {
      path.classList.add("texleaf-tikzcd-editor-arrow-selected");
    }
    if (arrow.lineStyle === "dashed") {
      path.setAttribute("stroke-dasharray", "5 4");
    } else if (arrow.lineStyle === "dotted") {
      path.setAttribute("stroke-dasharray", "1.5 4");
    }
    if (arrow.head !== "noHead") {
      const markerBase = selected ? `${markerId}-selected` : markerId;
      path.setAttribute(
        "marker-end",
        `url(#${
          arrow.head === "twoHeads"
            ? selected
              ? `${markerId}-double-selected`
              : `${markerId}-double`
            : markerBase
        })`,
      );
    }
    svg.append(path);
    if (arrow.head === "hook") {
      const hook = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hook.setAttribute(
        "d",
        `M ${geometry.start.x - geometry.unitY * 5} ${geometry.start.y + geometry.unitX * 5} Q ${geometry.start.x - geometry.unitX * 5} ${geometry.start.y - geometry.unitY * 5} ${geometry.start.x + geometry.unitY * 5} ${geometry.start.y - geometry.unitX * 5}`,
      );
      hook.setAttribute("fill", "none");
      hook.setAttribute("stroke", selected ? "var(--vscode-focusBorder)" : "currentColor");
      hook.setAttribute("stroke-width", "1.3");
      svg.append(hook);
    }
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.classList.add("texleaf-tikzcd-editor-arrow-hit");
    hit.dataset.tikzcdEditorArrowHit = String(index);
    hit.setAttribute("d", geometry.path);
    hit.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      session.selection = { kind: "arrow", index };
      renderVisualTikzcdEditor(session);
    });
    svg.append(hit);
    if (arrow.label.trim().length > 0) {
      const label = document.createElement("span");
      label.className = "texleaf-tikzcd-editor-arrow-label";
      label.dataset.tikzcdEditorArrowLabel = String(index);
      if (selected) {
        label.classList.add("texleaf-tikzcd-editor-arrow-label-selected");
      }
      label.append(createTikzcdEditorMath(session, arrow.label, arrow.label));
      const side = arrow.swap ? -1 : 1;
      label.style.left = `${geometry.midpoint.x + geometry.unitY * 14 * side}px`;
      label.style.top = `${geometry.midpoint.y - geometry.unitX * 14 * side}px`;
      canvas.append(label);
    }
    if (selected) {
      for (const [kind, point] of [
        ["source", geometry.start],
        ["target", geometry.end],
      ] as const) {
        const endpoint = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        endpoint.classList.add("texleaf-tikzcd-editor-endpoint");
        endpoint.dataset.tikzcdEditorEndpoint = kind;
        endpoint.setAttribute("cx", String(point.x));
        endpoint.setAttribute("cy", String(point.y));
        endpoint.setAttribute("r", "7");
        endpoint.addEventListener("pointerdown", (event) => {
          startTikzcdArrowPointerDrag(event, session, canvas, svg, { kind, index });
        });
        svg.append(endpoint);
      }
    }
  }
}

function createTikzcdPositionSelect(
  model: MutableTikzcdModel,
  selectedRow: number,
  selectedColumn: number,
): HTMLSelectElement {
  const select = document.createElement("select");
  for (let row = 0; row < model.rowCount; row += 1) {
    for (let column = 0; column < model.columnCount; column += 1) {
      const option = document.createElement("option");
      option.value = String(row * model.columnCount + column);
      const source = model.nodes[row]?.[column]?.trim();
      option.textContent = `(${row + 1},${column + 1})${source ? ` ${source.slice(0, 30)}` : ""}`;
      option.selected = row === selectedRow && column === selectedColumn;
      select.append(option);
    }
  }
  return select;
}

function decodeTikzcdPosition(value: string, columnCount: number): [number, number] {
  const position = Math.max(0, Number.parseInt(value, 10) || 0);
  return [Math.floor(position / columnCount), position % columnCount];
}

function normalizeMutableTikzcdModel(model: MutableTikzcdModel): void {
  model.rowCount = clampInteger(model.rowCount, 1, 16);
  model.columnCount = clampInteger(model.columnCount, 1, 16);
  while (model.nodes.length < model.rowCount) {
    model.nodes.push(Array.from({ length: model.columnCount }, () => ""));
  }
  model.nodes.length = model.rowCount;
  for (const row of model.nodes) {
    while (row.length < model.columnCount) {
      row.push("");
    }
    row.length = model.columnCount;
  }
  model.arrows = model.arrows.filter((arrow) =>
    arrow.fromRow >= 0 && arrow.fromRow < model.rowCount &&
    arrow.toRow >= 0 && arrow.toRow < model.rowCount &&
    arrow.fromColumn >= 0 && arrow.fromColumn < model.columnCount &&
    arrow.toColumn >= 0 && arrow.toColumn < model.columnCount &&
    (arrow.fromRow !== arrow.toRow || arrow.fromColumn !== arrow.toColumn)
  ).slice(0, 128);
}

function applyVisualTikzcdEdit(
  card: HTMLElement,
  view: EditorView,
  model: MutableTikzcdModel,
): void {
  normalizeMutableTikzcdModel(model);
  const bodyRange = readMappedDatasetRange(
    card,
    "texleafBodyFrom",
    "texleafBodyTo",
    view.state.doc.length,
  );
  if (bodyRange === undefined) {
    setStatus("warning", "tikzcd 源码位置已经变化，请重新打开可视化编辑器。", 3_500);
    return;
  }
  if (model.nodes.some((row) => row.some((node) =>
    /[\r\n]/u.test(node) || hasUnescapedTableSeparator(node) || /\\arrow\b/u.test(node)
  ))) {
    setStatus("warning", "节点不能含换行、未转义的 & 或手写 \\arrow；请用箭头编辑区。", 4_000);
    return;
  }
  if (model.arrows.some((arrow) =>
    /[\r\n"]/u.test(arrow.label)
  )) {
    setStatus("warning", "箭头标签不能含换行或双引号。", 4_000);
    return;
  }
  const original = view.state.sliceDoc(bodyRange.from, bodyRange.to);
  const body = serializeVisualTikzcdBody(original, model);
  const sourceRange = readMappedDatasetRange(
    card,
    "texleafSourceFrom",
    "texleafSourceTo",
    view.state.doc.length,
  );
  applyAtomicVisualDocumentChange(view, {
    from: bodyRange.from,
    to: bodyRange.to,
    insert: body,
  }, sourceRange === undefined ? undefined : {
    before: sourceRange.to,
    after: sourceRange.to + body.length - original.length,
  });
}

function serializeVisualTikzcdBody(
  original: string,
  model: MutableTikzcdModel,
): string {
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const firstContent = /(?:^|\r?\n)([ \t]*)\S/u.exec(original);
  const rowIndent = firstContent?.[1] ?? "  ";
  const trailingIndent = /(?:\r?\n)([ \t]*)$/u.exec(original)?.[1] ?? "";
  const arrowsByNode = new Map<string, MutableTikzcdArrow[]>();
  for (const arrow of model.arrows) {
    const key = `${arrow.fromRow}:${arrow.fromColumn}`;
    const values = arrowsByNode.get(key) ?? [];
    values.push(arrow);
    arrowsByNode.set(key, values);
  }
  const rows: string[] = [];
  for (let row = 0; row < model.rowCount; row += 1) {
    const cells: string[] = [];
    for (let column = 0; column < model.columnCount; column += 1) {
      let source = model.nodes[row]?.[column]?.trim() ?? "";
      for (const arrow of arrowsByNode.get(`${row}:${column}`) ?? []) {
        source += `${source.length === 0 ? "" : " "}\\arrow[${serializeTikzcdArrowOptions(arrow)}]`;
      }
      cells.push(source);
    }
    rows.push(`${rowIndent}${cells.join(" & ")}${row < model.rowCount - 1 ? " \\\\" : ""}`);
  }
  return `${eol}${rows.join(eol)}${eol}${trailingIndent}`;
}

function serializeTikzcdArrowOptions(arrow: MutableTikzcdArrow): string {
  const deltaRow = arrow.toRow - arrow.fromRow;
  const deltaColumn = arrow.toColumn - arrow.fromColumn;
  const direction = [
    deltaColumn > 0 ? "r".repeat(deltaColumn) : "l".repeat(-deltaColumn),
    deltaRow > 0 ? "d".repeat(deltaRow) : "u".repeat(-deltaRow),
  ].join("");
  const options = [direction];
  if (arrow.label.trim().length > 0) {
    options.push(`"${arrow.label.trim()}"${arrow.swap ? "'" : ""}`);
  } else if (arrow.swap) {
    options.push("swap");
  }
  if (arrow.lineStyle !== "solid") {
    options.push(arrow.lineStyle);
  }
  if (arrow.bend !== "none") {
    options.push(`bend ${arrow.bend}=${clampInteger(arrow.bendAmount, 1, 90)}`);
  }
  switch (arrow.head) {
    case "twoHeads":
      options.push("two heads");
      break;
    case "hook":
      options.push("hook");
      break;
    case "noHead":
      options.push("no head");
      break;
    case "normal":
      break;
  }
  return options.join(", ");
}

const visualPdfImageCache = new Map<string, string>();
let visualPdfImageQueue = Promise.resolve();
let visualPdfWorkerUrl: string | undefined;

function loadVisualImagePreview(image: HTMLImageElement, uri: string): void {
  if (!new URL(uri, document.baseURI).pathname.toLowerCase().endsWith(".pdf")) {
    image.src = uri;
    return;
  }
  image.dataset.pdfPreview = "loading";
  image.setAttribute("aria-busy", "true");
  image.title = "PDF 插图预览（第 1 页）";
  // CodeMirror mounts nearby image widgets only. Serialize their work so a
  // document with many PDF figures never starts many parsers at once.
  visualPdfImageQueue = visualPdfImageQueue.then(async () => {
    if (!image.isConnected) return;
    try {
      const preview = visualPdfImageCache.get(uri) ?? await renderVisualPdfImage(uri);
      if (!visualPdfImageCache.has(uri) && preview.length <= 8 * 1024 * 1024) {
        let bytes = preview.length;
        for (const value of visualPdfImageCache.values()) bytes += value.length;
        for (const [key, value] of visualPdfImageCache) {
          if (bytes <= 8 * 1024 * 1024) break;
          visualPdfImageCache.delete(key);
          bytes -= value.length;
        }
        visualPdfImageCache.set(uri, preview);
      }
      if (image.isConnected) {
        image.dataset.pdfPreview = "ready";
        image.removeAttribute("aria-busy");
        image.src = preview;
      }
    } catch {
      if (image.isConnected) image.dispatchEvent(new Event("error"));
    }
  });
}

async function readVisualPdfResource(uri: string, signal: AbortSignal, limit: number): Promise<Uint8Array> {
  const response = await fetch(uri, { signal });
  if (!response.ok || response.body === null || Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("PDF preview resource is unavailable or too large.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("PDF preview resource exceeds its byte limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function renderVisualPdfImage(uri: string): Promise<string> {
  const assets = document.getElementById("editor")?.dataset.pdfAssets;
  if (assets === undefined) throw new Error("PDF preview assets are unavailable.");
  const abort = new AbortController();
  let worker: PDFWorker | undefined;
  let loading: PDFDocumentLoadingTask | undefined;
  let rendering: RenderTask | undefined;
  const canvas = document.createElement("canvas");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error("PDF image preview timed out."));
    }, 20_000);
  });
  try {
    return await Promise.race([timeout, (async () => {
      if (visualPdfWorkerUrl === undefined) {
        const source = await readVisualPdfResource(`${assets}pdf.worker.bundle.mjs`, abort.signal, 8 * 1024 * 1024);
        abort.signal.throwIfAborted();
        visualPdfWorkerUrl = URL.createObjectURL(new Blob([source as Uint8Array<ArrayBuffer>], { type: "text/javascript" }));
      }
      const data = await readVisualPdfResource(uri, abort.signal, 16 * 1024 * 1024);
      abort.signal.throwIfAborted();
      // Match the PDF viewer's supported LoopbackPort setup: Electron Webview
      // dedicated workers can defer Promise continuations beyond our deadline.
      GlobalWorkerOptions.workerSrc = visualPdfWorkerUrl;
      await import(/* @vite-ignore */ visualPdfWorkerUrl);
      abort.signal.throwIfAborted();
      worker = PDFWorker.create({});
      loading = getDocument({
        data, worker, enableXfa: false, useSystemFonts: false,
        cMapPacked: true, cMapUrl: `${assets}cmaps/`, standardFontDataUrl: `${assets}standard_fonts/`,
        wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/`,
        // Scientific figures often embed 300-dpi bitmaps larger than 16 MP.
        // Reject the whole preview above the ceiling; never silently omit a panel.
        stopAtErrors: true, maxImageSize: 64 * 1024 * 1024, canvasMaxAreaInBytes: 16 * 1024 * 1024,
      });
      // Password-protected figures are a placeholder, never an editor prompt.
      loading.onPassword = () => { void loading?.destroy().catch(() => undefined); };
      const pdf = await loading.promise;
      abort.signal.throwIfAborted();
      const page = await pdf.getPage(1);
      abort.signal.throwIfAborted();
      const base = page.getViewport({ scale: 1 });
      if (![base.width, base.height].every(value => Number.isFinite(value) && value > 0)) {
        throw new Error("PDF image has invalid page dimensions.");
      }
      const scale = Math.min(2, 1600 / base.width, 1600 / base.height, Math.sqrt(2_000_000 / base.width / base.height));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (context === null) throw new Error("PDF image needs Canvas 2D.");
      rendering = page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" });
      // Pinned PDF.js 6.2 resolves a partial render before rejecting an operator
      // stream. Observe that rejection too, so oversized panels cannot disappear
      // silently even with stopAtErrors enabled.
      let complete = true;
      const intents = (page as unknown as {
        _intentStates: Map<string, { displayReadyCapability?: { reject: (reason: unknown) => void } }>;
      })._intentStates;
      const capability = intents.values().next().value?.displayReadyCapability;
      if (capability === undefined) throw new Error("PDF image runtime is incompatible.");
      const reject = capability.reject;
      capability.reject = reason => { complete = false; reject(reason); };
      await rendering.promise;
      if (!complete) throw new Error("PDF image could not be fully decoded.");
      abort.signal.throwIfAborted();
      return canvas.toDataURL("image/png");
    })()]);
  } finally {
    clearTimeout(timer);
    const timedOut = abort.signal.aborted;
    abort.abort();
    rendering?.cancel();
    const cleanup = loading?.destroy().catch(() => undefined);
    if (!timedOut && cleanup !== undefined) {
      // Let PDF.js receive Terminate and release fonts before killing its port.
      await Promise.race([cleanup, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
      clearTimeout(timer);
    }
    worker?.destroy();
    canvas.width = canvas.height = 0;
  }
}

class ImageWidget extends WidgetType {
  public constructor(
    private readonly record: VisualImageRecord,
    private readonly insideFrame: boolean,
  ) {
    super();
  }

  public override eq(other: ImageWidget): boolean {
    return this.insideFrame === other.insideFrame &&
      visualPresentationKey(this.record) === visualPresentationKey(other.record);
  }

  public override toDOM(view: EditorView): HTMLElement {
    const card = document.createElement("figure");
    card.className = "texleaf-image-card";
    card.tabIndex = 0;
    card.title = `图片预览：${this.record.path}；点击编辑 includegraphics 源码`;
    wireSourcePointer(
      card,
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
    );

    const actions = document.createElement("div");
    actions.className = "texleaf-structure-actions";
    actions.append(createStructureSourceButton(
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
      "编辑图片环境",
    ));
    card.append(actions);

    const scroll = document.createElement("div");
    scroll.className = "texleaf-image-scroll";
    configureStructureHorizontalScroll(
      scroll,
      "图片预览；超出正文宽度时可横向滚动",
    );
    const canvas = document.createElement("div");
    canvas.className = "texleaf-image-canvas";
    if (this.record.previewUri === undefined) {
      canvas.append(createImagePlaceholder(this.record.path));
    } else {
      const image = document.createElement("img");
      image.className = "texleaf-image-preview";
      image.alt = this.record.caption ?? this.record.path;
      image.loading = "lazy";
      image.draggable = false;
      image.addEventListener("error", () => {
        image.replaceWith(createImagePlaceholder(this.record.path));
        view.requestMeasure();
      }, { once: true });
      canvas.append(image);
      loadVisualImagePreview(image, this.record.previewUri);
    }
    scroll.append(canvas);
    card.append(scroll);
    if (this.record.caption !== undefined || this.record.label !== undefined) {
      const caption = document.createElement("figcaption");
      caption.className = "texleaf-image-caption";
      if (this.record.caption !== undefined) {
        caption.append(createInlineContentElement(this.record.captionSegments ?? [], this.record.caption, "texleaf-image-inline-content", view));
      }
      if (this.record.label !== undefined) {
        caption.append(createLabelChip(view, this.record.label));
      }
      card.append(caption);
    }
    return createMeasuredBlockShell(
      card,
      [
        "texleaf-image-shell",
        this.insideFrame ? "texleaf-frame-content-shell" : "",
      ].filter(Boolean).join(" "),
      view,
      this.record.replacement.sourceFrom,
    );
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

function createTableRow(
  cells: readonly VisualTableCell[],
  columnCount: number,
  header: boolean,
  view?: EditorView,
): HTMLTableRowElement {
  const row = document.createElement("tr");
  for (let index = 0; index < columnCount; index += 1) {
    const cell = document.createElement(header ? "th" : "td");
    const value = cells[index];
    if (value !== undefined) {
      cell.append(createInlineContentElement(
        value.segments,
        value.text,
        "texleaf-table-inline-content",
        view,
      ));
    }
    row.append(cell);
  }
  return row;
}

function configureStructureHorizontalScroll(
  viewport: HTMLElement,
  label: string,
): void {
  viewport.classList.add("texleaf-structure-horizontal-scroll");
  viewport.tabIndex = 0;
  viewport.setAttribute("role", "region");
  viewport.setAttribute("aria-label", label);

  // Structure cards reveal their LaTeX source on pointerdown. A scrollbar
  // thumb is a pseudo-element of this viewport, so without an explicit event
  // boundary the same pointerdown bubbles to the card and replaces the preview
  // before a drag can begin. Preserve every native scrolling default while
  // keeping scrolling gestures inside the local viewport.
  viewport.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  viewport.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });
  viewport.addEventListener("wheel", (event) => {
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      event.stopPropagation();
    }
  }, { passive: true });
}

function createInlineContentElement(
  segments: readonly VisualInlineContentSegment[],
  fallback: string,
  className: string,
  view?: EditorView,
): HTMLElement {
  const root = document.createElement("span");
  root.className = className;
  if (segments.length === 0) {
    root.textContent = fallback;
    return root;
  }
  for (const segment of segments) {
    if (segment.kind === "text") {
      root.append(document.createTextNode(segment.text));
    } else if (segment.kind === "math") {
      root.append(createMathFragmentElement(segment.math, segment.math.fallback));
    } else if (segment.kind === "citation") {
      root.append(view === undefined ? document.createTextNode(segment.citation.label) : new CitationWidget(segment.citation).toDOM(view));
    } else {
      root.append(view === undefined ? document.createTextNode(segment.reference.label) : new ReferenceWidget(segment.reference,
        segment.reference.keys.map(key => ({ key, label: key, previewKind: "unknown" }))).toDOM(view));
    }
  }
  return root;
}

function createMathFragmentElement(
  fragment: VisualMathFragment | undefined,
  fallback: string,
): HTMLElement {
  const root = document.createElement("span");
  root.className = "texleaf-structure-math";
  if (fragment?.previewStatus?.state === "error") {
    root.textContent = fallback;
    root.dataset.texleafRenderError = fragment.previewStatus.message;
    root.style.color = "var(--vscode-errorForeground, #f14c4c)";
    return root;
  }
  if (fragment?.asset === undefined) {
    root.textContent = fallback;
    return root;
  }
  const svg = createFormulaSvg(fragment.asset);
  if (svg === undefined) {
    root.textContent = fallback;
    return root;
  }
  applyStructureMathGeometry(root, fragment.asset);
  root.append(svg);
  return root;
}

function applyStructureMathGeometry(
  element: HTMLElement,
  formula: RenderedFormula,
): void {
  element.style.setProperty(
    "--texleaf-structure-math-width",
    `${safeFormulaDimension(formula.widthEm, 1)}em`,
  );
  element.style.setProperty(
    "--texleaf-structure-math-height",
    `${safeFormulaDimension(formula.heightEm, 1)}em`,
  );
}

function createImagePlaceholder(path: string): HTMLDivElement {
  const placeholder = document.createElement("div");
  placeholder.className = "texleaf-image-placeholder";
  placeholder.textContent = `图片文件：${path}（当前格式或路径无法在 Webview 中安全预览）`;
  return placeholder;
}

class TableOfContentsWidget extends WidgetType {
  public constructor(
    private readonly record: VisualTableOfContentsRecord,
    private readonly insideFrame: boolean,
  ) {
    super();
  }

  public override eq(other: TableOfContentsWidget): boolean {
    return this.insideFrame === other.insideFrame &&
      visualPresentationKey(this.record) === visualPresentationKey(other.record);
  }

  public override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("section");
    root.className = "texleaf-table-of-contents-card";
    root.tabIndex = 0;
    root.setAttribute(
      "aria-label",
      this.record.language === "zh" ? "文档目录" : "Table of contents",
    );
    root.title = this.record.language === "zh"
      ? "目录预览；点击空白处编辑 \\tableofcontents 命令"
      : "Table of contents preview; click empty space to edit the \\tableofcontents command";
    wireSourcePointer(
      root,
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
    );

    const header = document.createElement("header");
    header.className = "texleaf-table-of-contents-header";
    const heading = document.createElement("div");
    heading.className = "texleaf-table-of-contents-heading";
    const title = document.createElement("h2");
    title.className = "texleaf-table-of-contents-title";
    title.textContent = this.record.template
      ? this.record.language === "zh" ? "章节目录模板" : "Section outline template"
      : this.record.scope === "currentSection"
        ? this.record.language === "zh" ? "当前节目录" : "Current section"
        : this.record.scope === "currentSubsection"
          ? this.record.language === "zh" ? "当前小节目录" : "Current subsection"
          : this.record.language === "zh" ? "目录" : "Contents";
    title.dataset.texleafLineNumberAnchorId = String(this.record.replacement.from);
    const count = document.createElement("span");
    count.className = "texleaf-table-of-contents-count";
    const entryCount = this.record.entries.length;
    count.textContent = this.record.template
      ? this.record.language === "zh" ? "运行时" : "runtime"
      : this.record.language === "zh"
        ? `${entryCount} 项`
        : `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`;
    heading.append(title, count);
    const actions = document.createElement("div");
    actions.className = "texleaf-structure-actions";
    actions.append(createStructureSourceButton(
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
      this.record.language === "zh" ? "编辑目录命令" : "Edit contents command",
    ));
    header.append(heading, actions);
    root.append(header);

    if (entryCount === 0) {
      const empty = document.createElement("div");
      empty.className = "texleaf-table-of-contents-empty";
      empty.textContent = this.record.template
        ? this.record.language === "zh"
          ? "这是 Beamer 的运行时 Frame 模板；编译时会在每一节开始处显示对应章节目录。"
          : "This is a runtime Beamer frame template; compilation fills it with the matching section outline."
        : this.record.scope === "currentSection" ||
            this.record.scope === "currentSubsection"
          ? this.record.language === "zh"
            ? "此命令之前尚未解析到对应章节；保留原命令并等待编译时上下文。"
            : "No matching section precedes this command; the source is preserved for compile-time context."
          : this.record.language === "zh"
            ? "当前项目中没有可显示的章节标题。"
            : "No section headings are available in the current project.";
      root.append(empty);
    } else {
      const tree = document.createElement("ol");
      tree.className = "texleaf-table-of-contents-tree";
      tree.setAttribute("role", "tree");
      tree.setAttribute(
        "aria-label",
        this.record.language === "zh" ? "章节树" : "Document outline",
      );
      const baseLevel = Math.min(
        ...this.record.entries.map((entry) =>
          Number.isSafeInteger(entry.level) ? entry.level : 0
        ),
      );
      for (const entry of this.record.entries) {
        const visibleTitle = entry.title.trim().length === 0
          ? this.record.language === "zh" ? "（空标题）" : "(untitled)"
          : entry.title;
        const item = document.createElement("li");
        item.className = "texleaf-table-of-contents-item";
        item.setAttribute("role", "treeitem");
        const level = Number.isSafeInteger(entry.level) ? entry.level : baseLevel;
        const depth = clampInteger(level - baseLevel, 0, 6);
        item.setAttribute("aria-level", String(depth + 1));
        const button = document.createElement("button");
        button.type = "button";
        button.className = "texleaf-table-of-contents-entry";
        button.style.setProperty("--texleaf-toc-indent", `${depth * 18}px`);
        button.dataset.tocEntryId = entry.id;
        button.dataset.tocCommand = entry.command;
        const spokenNumber = entry.number === undefined ? "" : ` ${entry.number}`;
        button.setAttribute(
          "aria-label",
          this.record.language === "zh"
            ? `跳转到${spokenNumber} ${visibleTitle}`
            : `Go to${spokenNumber} ${visibleTitle}`,
        );
        button.title = this.record.language === "zh"
          ? `跳转到 ${entry.command}：${visibleTitle}`
          : `Go to ${entry.command}: ${visibleTitle}`;
        const number = document.createElement("span");
        number.className = "texleaf-table-of-contents-number";
        number.textContent = entry.number ?? "";
        number.setAttribute("aria-hidden", "true");
        const entryTitle = document.createElement("span");
        entryTitle.className = "texleaf-table-of-contents-entry-title";
        entryTitle.textContent = visibleTitle;
        button.append(number, entryTitle);
        wireTableOfContentsNavigation(button, root, view, entry.id);
        item.append(button);
        tree.append(item);
      }
      root.append(tree);
    }

    if (this.record.incomplete) {
      const incomplete = document.createElement("div");
      incomplete.className = "texleaf-table-of-contents-incomplete";
      incomplete.textContent = visualTableOfContentsIncompleteText(
        this.record.notices,
      );
      root.append(incomplete);
    }

    if (this.record.numberingApproximate) {
      const numberingNote = document.createElement("div");
      numberingNote.className = "texleaf-table-of-contents-numbering-note";
      numberingNote.textContent = visualTableOfContentsNumberingText(
        this.record.notices,
      );
      root.append(numberingNote);
    }

    return createMeasuredBlockShell(
      root,
      [
        "texleaf-table-of-contents-shell",
        this.insideFrame ? "texleaf-frame-content-shell" : "",
      ].filter(Boolean).join(" "),
      view,
      this.record.replacement.sourceFrom,
    );
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

function visualTableOfContentsIncompleteText(
  notices: readonly VisualTableOfContentsNotice[],
): string {
  const reasons = notices
    .map(visualTableOfContentsNoticePresentation)
    .filter((notice) => notice.kind === "incomplete")
    .map((notice) => notice.label);
  return reasons.length === 0
    ? "目录预览可能缺少或多出条目；当前只显示已安全解析的章节。"
    : `目录预览可能缺少或多出条目（原因：${reasons.join("；")}）；当前只显示已安全解析的章节。`;
}

function visualTableOfContentsNumberingText(
  notices: readonly VisualTableOfContentsNotice[],
): string {
  const reasons = notices
    .map(visualTableOfContentsNoticePresentation)
    .filter((notice) => notice.kind === "numbering")
    .map((notice) => notice.label);
  return reasons.length === 0
    ? "章节标题与跳转可用，但预览编号可能与编译后的目录不同。"
    : `检测到 ${reasons.join("、")}；章节标题与跳转可用，但预览编号可能与编译后的目录不同。`;
}

function visualTableOfContentsNoticePresentation(
  notice: VisualTableOfContentsNotice,
): { readonly kind: "incomplete" | "numbering"; readonly label: string } {
  switch (notice) {
    case "projectGraph":
      return { kind: "incomplete", label: "项目包含关系未完全解析" };
    case "conditionalHeadings":
      return { kind: "incomplete", label: "章节位于无法静态判断的条件分支" };
    case "sourceLimit":
      return { kind: "incomplete", label: "项目规模超过安全扫描上限" };
    case "includeOnly":
      return { kind: "incomplete", label: "使用了 \\includeonly" };
    case "manualContents":
      return {
        kind: "incomplete",
        label: "使用了 \\addcontentsline 或 \\addtocontents",
      };
    case "tocDepth":
      return { kind: "incomplete", label: "修改了 tocdepth" };
    case "counterControl":
      return { kind: "numbering", label: "手动修改了章节计数器" };
    case "frontMatter":
      return { kind: "numbering", label: "\\frontmatter" };
    case "mainMatter":
      return { kind: "numbering", label: "\\mainmatter" };
    case "backMatter":
      return { kind: "numbering", label: "\\backmatter" };
    case "appendix":
      return { kind: "numbering", label: "\\appendix" };
  }
}

function wireTableOfContentsNavigation(
  target: HTMLElement,
  rangeElement: HTMLElement,
  view: EditorView,
  entryId: string,
  kind: "tableOfContents" | "frontMatter" = "tableOfContents",
): void {
  const navigate = (): void => {
    const range = readMappedDatasetRange(
      rangeElement,
      "texleafSourceFrom",
      "texleafSourceTo",
      view.state.doc.length,
    );
    if (range === undefined || entryId.length === 0) {
      return;
    }
    post({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "navigate",
      revision: clientRevision,
      kind,
      from: range.from,
      to: range.to,
      key: entryId,
    });
  };
  target.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    navigate();
  });
  target.addEventListener("click", (event) => {
    // Suppress the synthetic click which follows pointerdown and would bubble
    // into the card's source-reveal affordance.
    event.preventDefault();
    event.stopPropagation();
  });
  target.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    navigate();
  });
}

class BibliographyWidget extends WidgetType {
  public constructor(
    private readonly record: VisualBibliographyRecord,
    private readonly insideFrame: boolean,
  ) {
    super();
  }

  public override eq(other: BibliographyWidget): boolean {
    return this.insideFrame === other.insideFrame &&
      visualPresentationKey(this.record) === visualPresentationKey(other.record);
  }

  public override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("section");
    root.className = "texleaf-bibliography-card";
    root.title = "点击查看参考文献 LaTeX 命令";
    // The bibliography preview is substantially larger than its heading.
    // Restricting source reveal to the header made clicks on an entry or on
    // the empty body appear to do nothing.  Make the complete preview card a
    // source target; the real action buttons below stop propagation and keep
    // their own behaviour.
    wireSourcePointer(
      root,
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
    );
    const header = document.createElement("header");
    header.className = "texleaf-bibliography-header";
    header.title = "点击查看参考文献 LaTeX 命令";
    wireSourcePointer(
      header,
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
    );
    const heading = document.createElement("div");
    heading.className = "texleaf-bibliography-heading";
    const titleRow = document.createElement("div");
    titleRow.className = "texleaf-bibliography-title-row";
    const title = document.createElement("h2");
    title.className = "texleaf-bibliography-title";
    title.textContent = this.record.language === "zh" ? "参考文献" : "References";
    title.tabIndex = 0;
    title.title = "点击查看参考文献 LaTeX 命令";
    wireSourcePointer(
      title,
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
    );
    const count = document.createElement("span");
    count.className = "texleaf-bibliography-count";
    const totalEntries = Math.max(this.record.totalEntries, this.record.entries.length);
    count.textContent = this.record.language === "zh"
      ? `${totalEntries} 条`
      : `${totalEntries} ${totalEntries === 1 ? "entry" : "entries"}`;
    titleRow.append(title, count);
    const actions = document.createElement("div");
    actions.className = "texleaf-bibliography-actions";
    if (!this.record.manual) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "texleaf-bibliography-open";
      open.textContent = this.record.language === "zh" ? "打开 .bib" : "Open .bib";
      open.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        post({
          protocol: VISUAL_EDITOR_PROTOCOL,
          type: "command",
          command: "openBibliography",
        });
      });
      actions.append(open);
    }
    actions.append(createStructureSourceButton(
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
      this.record.manual ? "编辑 thebibliography" : "编辑引用命令",
    ));
    titleRow.append(actions);
    heading.append(titleRow, createBibliographySettingsElement(this.record));
    header.append(heading);
    root.append(header);

    if (this.record.entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "texleaf-bibliography-empty";
      empty.textContent = this.record.manual
        ? this.record.language === "zh"
          ? "当前 thebibliography 环境中没有可预览的 \\bibitem。"
          : "No previewable \\bibitem was found in this thebibliography environment."
        : this.record.language === "zh"
          ? "尚未读取到参考文献条目；可打开 .bib 文件继续编辑。"
          : "No bibliography entries were found; open the .bib file to continue editing.";
      root.append(empty);
      return createMeasuredBlockShell(
        root,
        [
          "texleaf-bibliography-shell",
          this.insideFrame ? "texleaf-frame-content-shell" : "",
        ].filter(Boolean).join(" "),
        view,
        this.record.replacement.sourceFrom,
      );
    }

    const list = document.createElement("ol");
    list.className = "texleaf-bibliography-list";
    const visibleEntries = this.record.entries.slice(0, 120);
    visibleEntries.forEach((entry, index) => {
      list.append(createBibliographyEntryElement(entry, index));
    });
    root.append(list);
    if (this.record.totalEntries > visibleEntries.length) {
      const more = document.createElement("div");
      more.className = "texleaf-bibliography-more";
      more.textContent = `另有 ${this.record.totalEntries - visibleEntries.length} 条未在编辑器中展开。`;
      root.append(more);
    }
    return createMeasuredBlockShell(
      root,
      [
        "texleaf-bibliography-shell",
        this.insideFrame ? "texleaf-frame-content-shell" : "",
      ].filter(Boolean).join(" "),
      view,
      this.record.replacement.sourceFrom,
    );
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

class DocumentEndWidget extends WidgetType {
  public constructor(
    private readonly record: Extract<VisualStructureRecord, { readonly kind: "documentEnd" }>,
    private readonly lineTerminated: boolean,
    private readonly terminalSyntheticEof: boolean,
  ) {
    super();
  }

  public override eq(other: DocumentEndWidget): boolean {
    return this.record.language === other.record.language &&
      this.lineTerminated === other.lineTerminated &&
      this.terminalSyntheticEof === other.terminalSyntheticEof;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("span");
    root.className = "texleaf-document-end";
    root.tabIndex = 0;
    root.textContent = this.record.language === "zh" ? "文档结束" : "End of document";
    root.title = "点击编辑 \\end{document}";
    wireSourcePointer(
      root,
      view,
      this.record.replacement.sourceFrom,
      this.record.replacement.sourceTo,
    );
    const shell = createMeasuredBlockShell(
      root,
      "texleaf-document-end-shell",
      view,
      this.record.replacement.sourceFrom,
    );
    if (this.lineTerminated) {
      shell.classList.add("texleaf-document-end-shell-line-terminated");
    }
    if (this.terminalSyntheticEof) {
      shell.classList.add("texleaf-document-end-shell-terminal");
    }
    return shell;
  }

  public override ignoreEvent(): boolean {
    return true;
  }
}

function createBibliographySettingsElement(
  record: VisualBibliographyRecord,
): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "texleaf-bibliography-settings";
  const settings = [...record.settings];
  const knownResources = new Set(
    settings
      .filter((setting) => setting.kind === "resource")
      .map((setting) => setting.value.replaceAll("\\", "/").toLowerCase()),
  );
  for (const path of record.requestedPaths) {
    const normalized = path.replaceAll("\\", "/").trim();
    if (normalized.length === 0 || knownResources.has(normalized.toLowerCase())) {
      continue;
    }
    settings.push({
      kind: "resource",
      name: "resource",
      value: normalized,
      sourceFrom: record.replacement.sourceFrom,
      sourceTo: record.replacement.sourceTo,
    });
  }
  if (settings.length === 0) {
    settings.push({
      kind: record.manual ? "option" : "resource",
      name: record.manual ? "source" : "resource",
      value: record.manual
        ? record.language === "zh"
          ? "文档内 thebibliography"
          : "In-document thebibliography"
        : record.language === "zh"
          ? "当前配置的 .bib 文件"
          : "Configured .bib file",
      sourceFrom: record.replacement.sourceFrom,
      sourceTo: record.replacement.sourceTo,
    });
  }
  for (const setting of settings) {
    const item = document.createElement("span");
    item.className = "texleaf-bibliography-setting";
    item.dataset.settingKind = setting.kind;
    item.dataset.settingName = setting.name;
    item.title = `\\${setting.name}: ${setting.value}`;
    const label = document.createElement("span");
    label.className = "texleaf-bibliography-setting-label";
    label.textContent = `${visualBibliographySettingLabel(setting, record.language)}:`;
    const value = document.createElement("span");
    value.className = "texleaf-bibliography-setting-value";
    value.textContent = setting.value;
    item.append(label, value);
    root.append(item);
  }
  return root;
}

function visualBibliographySettingLabel(
  setting: VisualBibliographySetting,
  language: VisualBibliographyRecord["language"],
): string {
  const zh = language === "zh";
  switch (setting.kind) {
    case "resource":
      return zh ? "文献库" : "Library";
    case "style":
      return zh ? "参考文献样式" : "Bibliography style";
    case "citationStyle":
      return zh ? "引用样式" : "Citation style";
    case "backend":
      return zh ? "处理器" : "Backend";
    case "sorting":
      return zh ? "排序" : "Sorting";
    case "toc":
      return zh ? `目录（${setting.name}）` : `TOC (${setting.name})`;
    case "title":
      return zh ? "标题" : "Title";
    case "heading":
      return zh ? "标题形式" : "Heading";
    case "filter":
      return zh ? `筛选（${setting.name}）` : `Filter (${setting.name})`;
    case "scope":
      return zh ? `范围（${setting.name}）` : `Scope (${setting.name})`;
    case "inclusion":
      return zh ? "额外收录" : "Include";
    case "widestLabel":
      return zh ? "标号宽度" : "Widest label";
    case "option":
      if (setting.name === "package") {
        return zh ? "方案" : "Package";
      }
      if (setting.name === "source") {
        return zh ? "来源" : "Source";
      }
      return setting.name;
  }
}

function createBibliographyEntryElement(
  entry: VisualBibliographyEntry,
  index: number,
): HTMLElement {
  const item = document.createElement("li");
  item.className = "texleaf-bibliography-entry";
  item.dataset.citationKey = entry.key;
  const ordinal = document.createElement("span");
  ordinal.className = "texleaf-bibliography-entry-index";
  ordinal.textContent = `${index + 1}.`;
  const body = document.createElement("div");
  body.className = "texleaf-bibliography-entry-body";
  const heading = document.createElement("div");
  heading.className = "texleaf-bibliography-entry-heading";
  const title = document.createElement("span");
  title.className = "texleaf-bibliography-entry-title";
  title.textContent = entry.title || entry.key;
  const key = document.createElement("code");
  key.className = "texleaf-bibliography-key";
  key.textContent = entry.key;
  heading.append(title, key);
  if (entry.entryType.trim().length > 0) {
    const type = document.createElement("span");
    type.className = "texleaf-bibliography-type";
    type.textContent = entry.entryType;
    heading.append(type);
  }
  body.append(heading);
  const metadata = document.createElement("div");
  metadata.className = "texleaf-bibliography-entry-meta";
  for (const value of [entry.authors, entry.container, entry.year]) {
    if (value.trim().length === 0) {
      continue;
    }
    const meta = document.createElement("span");
    meta.className = "texleaf-bibliography-meta";
    meta.textContent = value;
    metadata.append(meta);
  }
  if (metadata.childElementCount > 0) {
    body.append(metadata);
  }
  item.append(ordinal, body);
  return item;
}

const visualPresentationKeyCache = new WeakMap<object, string>();
const visualPositionPropertyNames = new Set([
  "from",
  "to",
  "sourceFrom",
  "sourceTo",
  "bodyFrom",
  "bodyTo",
  "prefixFrom",
  "prefixTo",
  "contentFrom",
  "contentTo",
  "suffixFrom",
  "suffixTo",
  "columnSpecFrom",
  "columnSpecTo",
]);

function visualPresentationKey(value: object): string {
  const cached = visualPresentationKeyCache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const key = JSON.stringify(value, (property, nested) =>
    visualPositionPropertyNames.has(property) ? undefined : nested
  );
  visualPresentationKeyCache.set(value, key);
  return key;
}

function visualMakeTitlePositionKey(record: VisualMakeTitleRecord): string {
  const source = (value: VisualSourceText | undefined): string =>
    value === undefined ? "" : `${value.from}:${value.to}`;
  return [
    record.replacement.from,
    record.replacement.to,
    record.replacement.sourceFrom,
    record.replacement.sourceTo,
    source(record.title),
    ...record.authors.map(source),
    ...record.affiliations.map(source),
    ...record.emails.map(source),
    source(record.date),
    JSON.stringify(record.frontMatter),
    JSON.stringify(record.title?.definition),
  ].join("|");
}

function wireSourcePointer(
  element: HTMLElement,
  view: EditorView,
  from: number,
  to: number,
  navigate?: (from: number, to: number) => void,
  selectSource = false,
): void {
  element.dataset.texleafSourceFrom = String(from);
  element.dataset.texleafSourceTo = String(to);
  const open = (navigateRequested: boolean): void => {
    const range = readMappedDatasetRange(
      element,
      "texleafSourceFrom",
      "texleafSourceTo",
      view.state.doc.length,
    );
    if (range === undefined) {
      return;
    }
    if (navigate !== undefined && navigateRequested) {
      navigate(range.from, range.to);
      return;
    }
    hideReferenceHoverOwnedBy(element);
    openStructureSource(view, range.from, range.to, selectSource);
  };
  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    open(event.ctrlKey || event.metaKey);
  });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      open(event.ctrlKey || event.metaKey);
    }
  });
}

function wireMetadataSourcePointer(
  element: HTMLElement,
  view: EditorView,
  source: { readonly from: number; readonly to: number; readonly navigationId?: string },
): void {
  element.tabIndex = 0;
  element.setAttribute("role", "button");
  element.title = "点击编辑对应源码";
  if (source.navigationId !== undefined) {
    element.dataset.texleafSourceFrom = String(source.from);
    element.dataset.texleafSourceTo = String(source.to);
    wireTableOfContentsNavigation(element, element, view, source.navigationId, "frontMatter");
  } else {
    wireSourcePointer(element, view, source.from, source.to, undefined, true);
  }
}

function readMappedDatasetRange(
  element: HTMLElement,
  fromKey: keyof DOMStringMap,
  toKey: keyof DOMStringMap,
  documentLength: number,
): { readonly from: number; readonly to: number } | undefined {
  const from = Number(element.dataset[fromKey]);
  const to = Number(element.dataset[toKey]);
  return Number.isSafeInteger(from) &&
      Number.isSafeInteger(to) &&
      from >= 0 &&
      to >= from &&
      to <= documentLength
    ? { from, to }
    : undefined;
}

function openStructureSource(
  view: EditorView,
  from: number,
  to: number,
  selectSource = false,
): void {
  const safeFrom = clampInteger(from, 0, view.state.doc.length);
  const safeTo = clampInteger(to, safeFrom, view.state.doc.length);
  const structure = view.state.field(structureField, false);
  const preamble = structure?.records.find(
    (record): record is VisualPreambleRecord => record.kind === "preamble",
  );
  const reveal = pairedEnvironmentSourceReveal(
    structure?.records ?? [],
    safeFrom,
    safeTo,
    view.state.doc.toString(),
  );
  const effects: StateEffect<unknown>[] = [];
  const expandsPreamble =
    preamble !== undefined &&
    structure?.enabled === true &&
    !structure.preambleExpanded &&
    safeFrom < preamble.to;
  if (expandsPreamble) {
    effects.push(setPreambleExpanded.of(true));
  }
  effects.push(setStructureSourceReveal.of(reveal));
  const caret = sourceRevealCaretPosition(view.state, reveal, safeTo);
  const selection = selectSource && safeFrom < safeTo
    ? EditorSelection.range(safeFrom, safeTo)
    : EditorSelection.cursor(caret);
  view.dispatch({
    // A replacement widget has no meaningful glyph position for CodeMirror to
    // map the click back into. `safeFrom + 1` placed the caret immediately
    // after the leading backslash (for example `\\|end{proof}`), so the next
    // typed character silently corrupted source that had been hidden a moment
    // earlier. Reveal the command but land immediately after its complete
    // source range. Keep the caret on an actually revealed physical source
    // line: bibliography replacements often include a trailing newline, and a
    // caret at that following line made the next selection transaction
    // immediately collapse the source again.
    selection,
    effects,
    scrollIntoView: true,
  });
  view.focus();
  if (expandsPreamble) {
    const revealAfterPreambleLayout = (): void => {
      if (
        !view.dom.isConnected ||
        view.state.selection.main.anchor !== selection.anchor ||
        view.state.selection.main.head !== selection.head
      ) {
        return;
      }
      view.dispatch({
        effects: EditorView.scrollIntoView(caret, {
          y: "center",
          yMargin: 32,
        }),
      });
    };
    // Expanding the preamble replaces one compact block widget with all of its
    // physical source lines.  The first dispatch still sees the old geometry,
    // so wait for CodeMirror and the browser to finish that layout before
    // centering the requested title/author/affiliation/email source range.
    requestAnimationFrame(() => requestAnimationFrame(revealAfterPreambleLayout));
    setTimeout(revealAfterPreambleLayout, 140);
  }
}

function pairedEnvironmentSourceReveal(
  records: readonly VisualStructureRecord[],
  from: number,
  to: number,
  source: string,
): StructureSourceReveal | undefined {
  const textWrapper = records
    .filter((record): record is VisualTextStyleRecord =>
      record.kind === "textStyle" &&
      (
        rangesOverlap(record.prefixFrom, record.prefixTo, from, to) ||
        rangesOverlap(record.suffixFrom, record.suffixTo, from, to)
      )
    )
    .sort((left, right) => (left.to - left.from) - (right.to - right.from))[0];
  if (textWrapper !== undefined) {
    return {
      ranges: [
        {
          from: textWrapper.prefixFrom,
          to: textWrapper.prefixTo,
        },
        {
          from: textWrapper.suffixFrom,
          to: textWrapper.suffixTo,
        },
      ],
      scopeFrom: textWrapper.from,
      scopeTo: textWrapper.to,
      retention: "boundary-lines",
    };
  }
  const candidates = records
    .filter((record): record is
      VisualTheoremRecord | VisualFrameRecord | VisualListRecord | VisualAbstractRecord =>
      record.kind === "theorem" ||
      record.kind === "frame" ||
      record.kind === "list" ||
      record.kind === "abstract"
    )
    .filter((record) =>
      rangesOverlap(record.begin.sourceFrom, record.begin.sourceTo, from, to) ||
      rangesOverlap(record.end.sourceFrom, record.end.sourceTo, from, to)
    )
    .sort((left, right) =>
      (left.end.sourceTo - left.begin.sourceFrom) -
      (right.end.sourceTo - right.begin.sourceFrom)
    );
  const record = candidates[0];
  if (record?.kind === "abstract") {
    return {
      ranges: [
        { from: record.begin.sourceFrom, to: record.begin.sourceTo },
        ...abstractLayoutSourceRanges(source, record.bodyFrom, record.bodyTo),
        { from: record.end.sourceFrom, to: record.end.sourceTo },
      ],
      scopeFrom: record.begin.sourceFrom,
      scopeTo: record.end.sourceTo,
      retention: "boundary-lines",
    };
  }
  if (record?.kind === "frame") {
    const reveal = pairedVisualEnvironmentBoundaryReveal(record, from, to);
    return reveal === undefined ? undefined : {
      ...reveal,
      ranges: [...reveal.ranges, ...record.titleCommands.map(range => ({
        from: range.sourceFrom, to: range.sourceTo,
      }))],
    };
  }
  return record === undefined
    ? (from < to
      ? {
          ranges: [{ from, to }],
          scopeFrom: from,
          scopeTo: to,
          retention: "exact-range",
        }
      : undefined)
    : pairedVisualEnvironmentBoundaryReveal(record, from, to);
}

function abstractLayoutSourceRanges(
  source: string,
  from: number,
  to: number,
): StructureSourceRange[] {
  const ranges: StructureSourceRange[] = [];
  let lineFrom = Math.max(0, Math.min(from, source.length));
  const safeTo = Math.max(lineFrom, Math.min(to, source.length));
  while (lineFrom < safeTo) {
    const newline = source.indexOf("\n", lineFrom);
    const rawLineTo = newline < 0 || newline > safeTo ? safeTo : newline;
    const lineTo = rawLineTo > lineFrom && source[rawLineTo - 1] === "\r"
      ? rawLineTo - 1
      : rawLineTo;
    if (
      lineFrom < lineTo &&
      isAbstractLayoutOnlyLine(source.slice(lineFrom, lineTo))
    ) {
      ranges.push({ from: lineFrom, to: lineTo });
    }
    if (newline < 0 || newline >= safeTo) {
      break;
    }
    lineFrom = newline + 1;
  }
  return ranges;
}

function rangesOverlap(
  leftFrom: number,
  leftTo: number,
  rightFrom: number,
  rightTo: number,
): boolean {
  return leftFrom < rightTo && rightFrom < leftTo;
}

function togglePreamble(
  view: EditorView,
  preamble: VisualPreambleRecord,
  expanded: boolean,
): void {
  const current = currentSelection(view.state);
  const hiddenSelection = !expanded &&
    (current.anchor < preamble.to || current.head < preamble.to);
  view.dispatch({
    ...(hiddenSelection
      ? { selection: EditorSelection.cursor(preamble.bodyFrom) }
      : {}),
    effects: setPreambleExpanded.of(expanded),
    scrollIntoView: hiddenSelection,
  });
  view.focus();
}

function selectionTouchesRange(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((range) =>
    range.empty
      ? range.head > from && range.head < to
      : range.from < to && range.to > from,
  );
}

function sourceRevealTouchesRange(
  reveal: StructureSourceReveal | undefined,
  from: number,
  to: number,
): boolean {
  return reveal?.ranges.some((range) => range.from < to && range.to > from) === true;
}

function mapStructureSourceReveal(
  reveal: StructureSourceReveal | undefined,
  changes: ChangeDesc,
): StructureSourceReveal | undefined {
  if (reveal === undefined) {
    return undefined;
  }
  const ranges = reveal.ranges
    .map((range) => ({
      from: changes.mapPos(range.from, 1),
      to: changes.mapPos(range.to, -1),
    }))
    .filter((range) => range.from < range.to);
  const scopeFrom = changes.mapPos(reveal.scopeFrom, 1);
  const scopeTo = changes.mapPos(reveal.scopeTo, -1);
  return ranges.length > 0 && scopeFrom < scopeTo
    ? { ranges, scopeFrom, scopeTo, retention: reveal.retention }
    : undefined;
}

function mapVisualStructureRecords(
  records: readonly VisualStructureRecord[],
  changes: ChangeDesc,
): readonly VisualStructureRecord[] {
  const start = (position: number): number => changes.mapPos(position, 1);
  const end = (position: number): number => changes.mapPos(position, -1);
  const segment = (value: VisualInlineContentSegment): VisualInlineContentSegment => {
    if (value.kind === "math") return { ...value, math: { ...value.math, sourceFrom: start(value.math.sourceFrom), sourceTo: end(value.math.sourceTo) } };
    if (value.kind === "citation") return { ...value, citation: { ...value.citation, from: start(value.citation.from), to: end(value.citation.to) } };
    if (value.kind === "reference") return { ...value, reference: { ...value.reference, from: start(value.reference.from), to: end(value.reference.to) } };
    return value;
  };
  const source = (value: VisualSourceText | undefined): VisualSourceText | undefined =>
    value === undefined
      ? undefined
      : { ...value, from: start(value.from), to: end(value.to),
          ...(value.definition === undefined ? {} : { definition: {
            ...value.definition, from: start(value.definition.from), to: end(value.definition.to),
          } }),
          ...(value.segments === undefined ? {} : { segments: value.segments.map(segment) }),
        };
  const replacement = (value: VisualReplacementRange): VisualReplacementRange => ({
    ...value,
    from: start(value.from),
    to: end(value.to),
    sourceFrom: start(value.sourceFrom),
    sourceTo: end(value.sourceTo),
  });
  const label = (value: VisualLabelRecord | undefined): VisualLabelRecord | undefined =>
    value === undefined
      ? undefined
      : {
          ...value,
          from: start(value.from),
          to: end(value.to),
          replacement: replacement(value.replacement),
        };

  return records.map((record): VisualStructureRecord => {
    switch (record.kind) {
      case "preamble":
        return {
          ...record,
          from: start(record.from),
          to: end(record.to),
          bodyFrom: start(record.bodyFrom),
        };
      case "maketitle":
        return {
          ...record,
          replacement: replacement(record.replacement),
          metadataReplacements: (record.metadataReplacements ?? []).map(replacement),
          title: source(record.title),
          authors: record.authors.map((author) => source(author) ?? author),
          affiliations: record.affiliations.map((item) => source(item) ?? item),
          emails: record.emails.map((item) => source(item) ?? item),
          date: source(record.date),
          ...(record.frontMatter === undefined ? {} : { frontMatter: {
            replacement: replacement(record.frontMatter.replacement),
            ...(record.frontMatter.replacements === undefined ? {} : { replacements: record.frontMatter.replacements.map(replacement) }),
            sections: record.frontMatter.sections.map(section => ({ ...section, source: source(section.source)! })),
          } }),
        };
      case "heading":
      case "textStyle":
        return {
          ...record,
          from: start(record.from),
          to: end(record.to),
          prefixFrom: start(record.prefixFrom),
          prefixTo: end(record.prefixTo),
          contentFrom: start(record.contentFrom),
          contentTo: end(record.contentTo),
          suffixFrom: start(record.suffixFrom),
          suffixTo: end(record.suffixTo),
        };
      case "footnote":
        return { ...record, from: start(record.from), to: end(record.to),
          contentFrom: start(record.contentFrom), contentTo: end(record.contentTo), source: source(record.source)! };
      case "accent":
        return {
          ...record,
          from: start(record.from),
          to: end(record.to),
        };
      case "frame":
        return {
          ...record,
          begin: replacement(record.begin),
          end: replacement(record.end),
          titleCommands: record.titleCommands.map(replacement),
          bodyFrom: start(record.bodyFrom),
          bodyTo: end(record.bodyTo),
        };
      case "abstract":
        return {
          ...record,
          begin: replacement(record.begin),
          end: replacement(record.end),
          bodyFrom: start(record.bodyFrom),
          bodyTo: end(record.bodyTo),
        };
      case "keywords":
        return { ...record, replacement: replacement(record.replacement) };
      case "theorem":
        return {
          ...record,
          labels: record.labels.map((item) => label(item) ?? item),
          optionalTitleSegments: (record.optionalTitleSegments ?? []).map(segment),
          begin: replacement(record.begin),
          end: replacement(record.end),
          bodyFrom: start(record.bodyFrom),
          bodyTo: end(record.bodyTo),
        };
      case "list":
        return {
          ...record,
          begin: replacement(record.begin),
          end: replacement(record.end),
          items: record.items.map((item) => ({
            ...item,
            from: start(item.from),
            to: end(item.to),
            sourceFrom: start(item.sourceFrom),
            sourceTo: end(item.sourceTo),
          })),
        };
      case "label":
        return label(record) ?? record;
      case "reference":
      case "citation":
        return {
          ...record,
          from: start(record.from),
          to: end(record.to),
        };
      case "table":
        return {
          ...record,
          replacement: replacement(record.replacement),
          bodyFrom: start(record.bodyFrom),
          bodyTo: end(record.bodyTo),
          captionSegments: record.captionSegments.map(segment),
          rows: record.rows.map(row => row.map(cell => ({ ...cell, sourceFrom: start(cell.sourceFrom), sourceTo: end(cell.sourceTo), segments: cell.segments.map(segment) }))),
          columnSpecFrom: start(record.columnSpecFrom),
          columnSpecTo: end(record.columnSpecTo),
          label: label(record.label),
        };
      case "tikzcd":
        return {
          ...record,
          replacement: replacement(record.replacement),
          bodyFrom: start(record.bodyFrom),
          bodyTo: end(record.bodyTo),
        };
      case "figure":
        return { ...record, replacement: replacement(record.replacement), bodyFrom: start(record.bodyFrom), bodyTo: end(record.bodyTo),
          label: label(record.label), captionSegments: record.captionSegments.map(segment) };
      case "tikzpicture":
        return {
          ...record,
          replacement: replacement(record.replacement),
          bodyFrom: start(record.bodyFrom),
          bodyTo: end(record.bodyTo),
        };
      case "image":
        return {
          ...record,
          captionSegments: (record.captionSegments ?? []).map(segment),
          replacement: replacement(record.replacement),
          label: label(record.label),
        };
      case "bibliography":
        return {
          ...record,
          replacement: replacement(record.replacement),
          entries: record.entries.map((entry) => {
            if (entry.sourceFrom === undefined || entry.sourceTo === undefined) {
              return entry;
            }
            return {
              ...entry,
              sourceFrom: start(entry.sourceFrom),
              sourceTo: end(entry.sourceTo),
            };
          }),
        };
      case "tableOfContents":
        return { ...record, replacement: replacement(record.replacement) };
      case "documentEnd":
      case "comment":
        return { ...record, replacement: replacement(record.replacement) };
    }
  });
}

function visualStructureIdentity(record: VisualStructureRecord): string {
  return `${record.kind}:${visualStructureStart(record)}`;
}

function visualStructureStart(record: VisualStructureRecord): number {
  switch (record.kind) {
    case "preamble":
    case "heading":
    case "label":
    case "reference":
    case "citation":
    case "footnote":
    case "textStyle":
    case "accent":
      return record.from;
    case "maketitle":
    case "keywords":
    case "table":
    case "tikzcd":
    case "figure":
    case "tikzpicture":
    case "image":
    case "tableOfContents":
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

function adjustSelectionForCollapsedPreamble(
  selection: VisualEditorSelection,
  records: readonly VisualStructureRecord[],
  expanded: boolean,
): VisualEditorSelection {
  if (expanded) {
    return selection;
  }
  const preamble = records.find(
    (record): record is VisualPreambleRecord => record.kind === "preamble",
  );
  return preamble !== undefined &&
      (selection.anchor < preamble.to || selection.head < preamble.to)
    ? { anchor: preamble.bodyFrom, head: preamble.bodyFrom }
    : selection;
}

interface FormulaPresentation {
  readonly decorations: DecorationSet;
  readonly tooltip: FormulaSourceTooltip | null;
  readonly sourceFormulaKey: string;
}

const MAX_RENDERED_FORMULAS = 512;
const MAX_INACTIVE_RENDERED_FORMULAS = 64;
const MAX_RENDERED_FORMULA_CACHE_BYTES = 48 * 1024 * 1024;

interface RenderedFormulaCacheRetention {
  readonly rendered: Map<string, RenderedFormula>;
  readonly evictedFormulaIds: readonly string[];
}

function retainRenderedFormulaCache(
  rendered: ReadonlyMap<string, RenderedFormula>,
  activeFormulaIds: ReadonlySet<string>,
): RenderedFormulaCacheRetention {
  const active: [string, RenderedFormula][] = [];
  const inactive: [string, RenderedFormula][] = [];
  for (const entry of rendered) {
    (activeFormulaIds.has(entry[0]) ? active : inactive).push(entry);
  }

  // Entries are stored oldest-to-newest. Walk them backwards so the formulas
  // most recently delivered for the current viewport survive both the count
  // and byte budgets. Always retain one active entry, even if it is unusually
  // large, to avoid an evict/request loop for a single visible formula.
  const retainedActive: [string, RenderedFormula][] = [];
  let retainedBytes = 0;
  for (let index = active.length - 1; index >= 0; index -= 1) {
    const entry = active[index]!;
    const entryBytes = renderedFormulaCacheBytes(entry[1]);
    if (
      retainedActive.length >= MAX_RENDERED_FORMULAS ||
      (retainedBytes + entryBytes > MAX_RENDERED_FORMULA_CACHE_BYTES &&
        retainedActive.length > 0)
    ) {
      continue;
    }
    retainedActive.push(entry);
    retainedBytes += entryBytes;
  }

  const retainedInactive: [string, RenderedFormula][] = [];
  const remainingItems = Math.max(0, MAX_RENDERED_FORMULAS - retainedActive.length);
  const inactiveLimit = Math.min(MAX_INACTIVE_RENDERED_FORMULAS, remainingItems);
  for (let index = inactive.length - 1; index >= 0; index -= 1) {
    if (retainedInactive.length >= inactiveLimit) {
      break;
    }
    const entry = inactive[index]!;
    const entryBytes = renderedFormulaCacheBytes(entry[1]);
    if (retainedBytes + entryBytes > MAX_RENDERED_FORMULA_CACHE_BYTES) {
      continue;
    }
    retainedInactive.push(entry);
    retainedBytes += entryBytes;
  }

  const nextRendered = new Map<string, RenderedFormula>([
    ...retainedInactive.reverse(),
    ...retainedActive.reverse(),
  ]);
  const evictedFormulaIds = [...rendered.keys()].filter((id) => !nextRendered.has(id));
  return { rendered: nextRendered, evictedFormulaIds };
}

function renderedFormulaCacheBytes(formula: RenderedFormula): number {
  // Chromium stores JS strings as one- or two-byte representations depending
  // on their contents. Use the conservative UTF-16 size plus a small object
  // overhead so the cache remains bounded on every platform.
  return 256 + 2 * (
    formula.svg.length +
    (formula.source?.length ?? 0) +
    (formula.errorMessage?.length ?? 0)
  );
}

function migrateCommittedFormulaRenders(
  previousRecords: readonly VisualFormulaRecord[],
  nextRecords: readonly VisualFormulaRecord[],
  rendered: ReadonlyMap<string, RenderedFormula>,
  state: EditorState,
): Map<string, RenderedFormula> {
  const nextRendered = new Map(rendered);
  const previousByRange = new Map<string, VisualFormulaRecord>();
  for (const record of previousRecords) {
    previousByRange.set(formulaGeometryKey(record), record);
  }
  for (const record of nextRecords) {
    const exactSource = state.sliceDoc(record.from, record.to);
    const existing = nextRendered.get(record.id);
    if (existing !== undefined) {
      // The formula ID covers normalized render input, macro environment,
      // display mode and scale. An indentation-only format may therefore keep
      // the ID while changing the outer delimiter source used by the Webview's
      // stale-asset guard. Rebind that exact source instead of waiting for a
      // render the Host correctly considers redundant.
      nextRendered.set(
        record.id,
        exactSourceFormulaAsset(record, existing, exactSource),
      );
      continue;
    }
    const previous = previousByRange.get(formulaGeometryKey(record));
    const candidate = previous === undefined
      ? undefined
      : nextRendered.get(previous.id);
    // Geometry alone is not enough: a same-length edit can keep every range
    // unchanged while representing different mathematics. Static viewport and
    // fast commit renders both carry their exact source, so either can be
    // migrated safely across a content-derived formula ID change.
    if (
      candidate?.source !== undefined &&
      candidate.source === exactSource
    ) {
      nextRendered.set(record.id, candidate);
    }
  }
  return nextRendered;
}

function formulaGeometryKey(record: VisualFormulaRecord): string {
  return `${record.from}:${record.to}:${record.bodyFrom}:${record.bodyTo}:` +
    `${record.display ? "1" : "0"}:${record.environmentName ?? ""}`;
}

function buildFormulaPresentation(
  records: readonly VisualFormulaRecord[],
  rendered: ReadonlyMap<string, RenderedFormula>,
  cursorRendered: CursorRenderedFormula | undefined,
  enabled: boolean,
  visual: boolean,
  placement: VisualMathPreviewPlacement,
  state: EditorState,
  previousTooltip: FormulaSourceTooltip | null,
): FormulaPresentation {
  if (!enabled || records.length === 0) {
    return {
      decorations: Decoration.none,
      tooltip: null,
      sourceFormulaKey: "",
    };
  }
  const ranges = [];
  let tooltip: FormulaSourceTooltip | null = null;
  const sorted = formulaRecordsAreSorted(records)
    ? records
    : [...records].sort(compareFormulaRecords);
  const previewTarget = activeFormulaPreviewTarget(state, sorted);
  const sourceRecords = selectedFormulaRecords(state, sorted);
  const sourceFormulaIds = new Set(sourceRecords.map((record) => record.id));
  const theoremRecords = state.field(structureField, false)?.records.filter(
    (record): record is VisualTheoremRecord => record.kind === "theorem",
  ) ?? [];
  let theoremCursor = 0;
  let previousEnd = -1;
  for (const record of sorted) {
    if (
      record.from < previousEnd ||
      record.from < 0 ||
      record.to <= record.from ||
      record.to > state.doc.length
    ) {
      continue;
    }
    const selected = sourceFormulaIds.has(record.id);
    if (!visual || selected) {
      if (!selected) {
        previousEnd = record.to;
        continue;
      }
      previousEnd = record.to;
      continue;
    }
    const formula = rendered.get(record.id);
    if (
      formula === undefined ||
      !isSafeSvg(formula.svg) ||
      (formula.source !== undefined &&
        formula.source !== state.sliceDoc(record.from, record.to))
    ) {
      continue;
    }
    while (
      theoremCursor < theoremRecords.length &&
      theoremRecords[theoremCursor]!.bodyTo < record.from
    ) {
      theoremCursor += 1;
    }
    const theorem = theoremRecords[theoremCursor];
    const containingTheorem = theorem !== undefined &&
        record.from >= theorem.bodyFrom &&
        record.to <= theorem.bodyTo
      ? theorem
      : undefined;
    const structureRecords = state.field(structureField, false)?.records ?? [];
    const widget = new FormulaWidget(
      record,
      formula,
      containingTheorem?.style,
      record.display && frameContainsSourceRange(
        structureRecords,
        record.from,
        record.to,
      ),
    );
    const replacement = visualFormulaReplacementRange(state, record);
    ranges.push(
      Decoration.replace({
        widget,
        block: record.display,
        inclusiveStart: record.display,
        inclusiveEnd: visualBlockReplacementInclusiveEnd(
          record.display,
          replacement.to,
          state.doc.length,
        ),
        texleafFormulaId: record.id,
      }).range(replacement.from, replacement.to),
    );
    previousEnd = record.to;
  }
  tooltip = buildActiveFormulaTooltip(
    previewTarget,
    rendered,
    cursorRendered,
    placement,
    state,
    previousTooltip,
  );
  return {
    decorations: Decoration.set(ranges, true),
    tooltip,
    sourceFormulaKey: formulaSourceRecordKey(sourceRecords),
  };
}

/**
 * Replace only decorations whose formula assets changed. Static viewport
 * results arrive while the document and selection are otherwise unchanged;
 * rebuilding every formula in the document here turned a 48-result viewport
 * into 48 complete DecorationSet constructions and repeated SVG scans.
 */
function patchFormulaRenderDecorations(
  decorations: DecorationSet,
  recordById: ReadonlyMap<string, VisualFormulaRecord>,
  rendered: ReadonlyMap<string, RenderedFormula>,
  changedIds: ReadonlySet<string>,
  enabled: boolean,
  visual: boolean,
  state: EditorState,
): DecorationSet {
  if (changedIds.size === 0) {
    return decorations;
  }
  const changedRecords: VisualFormulaRecord[] = [];
  for (const formulaId of changedIds) {
    const record = recordById.get(formulaId);
    if (record !== undefined) {
      changedRecords.push(record);
    }
  }
  if (changedRecords.length === 0) {
    return decorations;
  }
  const theoremRecords = state.field(structureField, false)?.records.filter(
    (record): record is VisualTheoremRecord => record.kind === "theorem",
  ) ?? [];
  const add: Range<Decoration>[] = [];
  let filterFrom = Number.POSITIVE_INFINITY;
  let filterTo = Number.NEGATIVE_INFINITY;
  for (const record of changedRecords) {
    const replacement = visualFormulaReplacementRange(state, record);
    filterFrom = Math.min(filterFrom, record.from, replacement.from);
    filterTo = Math.max(filterTo, record.to, replacement.to);
    const selected = selectionIntersectsFormula(state, record);
    if (enabled && (!visual || selected)) {
      // Revealed formula source marks are supplied by nativeSyntaxField as a
      // single flat layer. Adding a second outer mark here would recreate the
      // nested Chromium DOM that breaks Microsoft Pinyin composition.
    } else if (enabled) {
      const formula = rendered.get(record.id);
      if (
        formula !== undefined &&
        isSafeSvg(formula.svg) &&
        (formula.source === undefined ||
          formula.source === state.sliceDoc(record.from, record.to))
      ) {
        const theorem = theoremRecords.find((candidate) =>
          record.from >= candidate.bodyFrom && record.to <= candidate.bodyTo
        );
        const widget = new FormulaWidget(
          record,
          formula,
          theorem?.style,
          record.display && frameContainsSourceRange(
            state.field(structureField, false)?.records ?? [],
            record.from,
            record.to,
          ),
        );
        add.push(Decoration.replace({
          widget,
          block: record.display,
          inclusiveStart: record.display,
          inclusiveEnd: visualBlockReplacementInclusiveEnd(
            record.display,
            replacement.to,
            state.doc.length,
          ),
          texleafFormulaId: record.id,
        }).range(replacement.from, replacement.to));
      }
    }
  }
  return decorations.update({
    filterFrom,
    filterTo,
    filter: (_from, _to, decoration) => {
      const formulaId = decoration.spec.texleafFormulaId;
      return typeof formulaId !== "string" || !changedIds.has(formulaId);
    },
    add,
    sort: true,
  });
}

function formulaSourceAttributes(
  record: VisualFormulaRecord,
): Readonly<Record<string, string>> {
  return {
    title: "当前公式源码；Math Preview 会跟随光标显示",
    "data-texleaf-formula-from": String(record.from),
    "data-texleaf-formula-to": String(record.to),
  };
}

function formulaSourceRecordKey(
  records: readonly VisualFormulaRecord[],
): string {
  return records.map((record) => record.id).join("\u0000");
}

function buildActiveFormulaTooltip(
  previewTarget: FormulaPreviewTarget | undefined,
  rendered: ReadonlyMap<string, RenderedFormula>,
  cursorRendered: CursorRenderedFormula | undefined,
  placement: VisualMathPreviewPlacement,
  state: EditorState,
  previousTooltip: FormulaSourceTooltip | null,
): FormulaSourceTooltip | null {
  if (previewTarget === undefined) {
    return null;
  }
  const { record, cursorOffset } = previewTarget;
  const cursorFormula = cursorRendered?.formulaId === record.id &&
      cursorRendered.cursorOffset === cursorOffset
    ? cursorRendered.rendered
    : undefined;
  const continuedTooltip = previousTooltip !== null &&
      formulaSourceTooltipContinues(previousTooltip, record, state)
    ? previousTooltip
    : undefined;
  // Keep the last complete caret SVG mounted while the newest worker request
  // is running. This both avoids flicker and makes the incremental hot path
  // independent from background base-formula rendering.
  const committedFormula = rendered.get(record.id);
  // A definitive error for the current source must replace a retained success
  // frame. Before that response arrives, retaining the old frame avoids flicker.
  const activeFormula = committedFormula?.errorMessage !== undefined
    ? committedFormula
    : cursorFormula ?? continuedTooltip?.texleafFormula ?? committedFormula;
  if (activeFormula === undefined || !isSafeSvg(activeFormula.svg)) {
    return null;
  }
  return createFormulaSourceTooltip(
    record,
    activeFormula,
    placement,
    cursorOffset,
    cursorFormula === undefined
      ? continuedTooltip?.texleafRenderedCursorOffset
      : cursorOffset,
    continuedTooltip?.create,
  );
}

function compareFormulaRecords(
  left: VisualFormulaRecord,
  right: VisualFormulaRecord,
): number {
  return left.from - right.from || left.to - right.to;
}

function formulaRecordsAreSorted(records: readonly VisualFormulaRecord[]): boolean {
  for (let index = 1; index < records.length; index += 1) {
    if (compareFormulaRecords(records[index - 1]!, records[index]!) > 0) {
      return false;
    }
  }
  return true;
}

function formulaSourceTooltipContinues(
  previous: FormulaSourceTooltip,
  record: VisualFormulaRecord,
  state: EditorState,
): boolean {
  if (!selectionIntersectsFormula(state, record)) {
    return false;
  }
  return previous.texleafRecord.id === record.id ||
    Math.max(previous.texleafRecord.from, record.from) <=
      Math.min(previous.texleafRecord.to, record.to);
}

function visualFormulaReplacementRange(
  state: EditorState,
  record: VisualFormulaRecord,
): { readonly from: number; readonly to: number } {
  if (!record.display) {
    return { from: record.from, to: record.to };
  }
  const startLine = state.doc.lineAt(record.from);
  const endLine = state.doc.lineAt(Math.max(record.from, record.to - 1));
  const prefix = state.doc.sliceString(startLine.from, record.from);
  const suffix = state.doc
    .sliceString(record.to, endLine.to)
    .replace(/%.*$/u, "");
  if (prefix.trim().length > 0 || suffix.trim().length > 0) {
    return { from: record.from, to: record.to };
  }
  const afterEndLine = endLine.number < state.doc.lines
    ? state.doc.line(endLine.number + 1).from
    : endLine.to;
  return { from: startLine.from, to: afterEndLine };
}

class FormulaWidget extends WidgetType {
  public constructor(
    private readonly record: VisualFormulaRecord,
    private readonly formula: RenderedFormula,
    private readonly theoremStyle: VisualTheoremRecord["style"] | undefined,
    private readonly insideFrame: boolean,
  ) {
    super();
  }

  public override get estimatedHeight(): number {
    if (!this.record.display) {
      return -1;
    }
    // CodeMirror otherwise estimates every off-screen block widget as one text
    // line. The worker already supplied a stable em height, so include the
    // formula/root/shell padding and keep cold scrolling close to final layout.
    const formulaBoxEm = Math.max(
      2.2,
      safeFormulaDimension(this.formula.heightEm, 1) + 0.75,
    );
    return Math.ceil((formulaBoxEm + 0.5) * 16 + 2);
  }

  public override eq(other: FormulaWidget): boolean {
    return this.record.id === other.record.id &&
      this.formula.svg === other.formula.svg &&
      this.formula.widthEm === other.formula.widthEm &&
      this.formula.heightEm === other.formula.heightEm &&
      this.theoremStyle === other.theoremStyle &&
      this.insideFrame === other.insideFrame;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement(this.record.display ? "div" : "span");
    root.className = this.record.display
      ? "texleaf-formula-widget texleaf-formula-widget-block"
      : "texleaf-formula-widget texleaf-formula-widget-inline";
    if (this.formula.errorMessage !== undefined) {
      root.classList.add("texleaf-formula-widget-error");
      root.dataset.texleafRenderError = this.formula.errorMessage;
    }
    root.tabIndex = 0;
    root.setAttribute("role", "button");
    root.dataset.formulaId = this.record.id;
    root.dataset.formulaFrom = String(this.record.from);
    root.dataset.formulaTo = String(this.record.to);
    root.dataset.formulaBodyFrom = String(this.record.bodyFrom);
    root.dataset.formulaBodyTo = String(this.record.bodyTo);
    if (this.formula.source !== undefined) {
      // This also gives frame-level regression checks a way to distinguish a
      // newly committed SVG from the stale pre-edit widget without inspecting
      // MathJax's path-only output.
      root.dataset.formulaSource = this.formula.source;
    }
    root.setAttribute(
      "aria-label",
      this.formula.errorMessage === undefined
        ? "点击编辑这条公式的 LaTeX 源码"
        : "公式渲染失败：" + this.formula.errorMessage + "；点击编辑源码",
    );
    root.title = this.formula.errorMessage === undefined
      ? "点击编辑公式源码；光标移出公式后重新渲染"
      : "公式渲染失败：" + this.formula.errorMessage;
    applyFormulaGeometry(root, this.formula);
    let layout: HTMLDivElement | undefined;
    const svg = createFormulaSvg(this.formula);
    if (svg !== undefined) {
      if (this.record.display) {
        layout = document.createElement("div");
        layout.className = "texleaf-formula-layout";
        const scroll = document.createElement("div");
        scroll.className = "texleaf-formula-scroll";
        scroll.tabIndex = 0;
        scroll.setAttribute("role", "region");
        scroll.setAttribute("aria-label", "公式预览；超出正文宽度时可横向滚动");
        scroll.append(svg);
        const protectFormulaScrollbar = (event: Event): void => {
          const pointerEvent = event as MouseEvent;
          const scrollbarHeight = scroll.offsetHeight - scroll.clientHeight;
          const box = scroll.getBoundingClientRect();
          if (
            scrollbarHeight > 0 &&
            pointerEvent.clientY >= box.bottom - scrollbarHeight
          ) {
            event.stopPropagation();
          }
        };
        scroll.addEventListener("pointerdown", protectFormulaScrollbar);
        scroll.addEventListener("mousedown", protectFormulaScrollbar);
        layout.append(scroll);
        root.append(layout);
      } else {
        root.append(svg);
      }
    } else {
      root.textContent = "公式预览不可用";
    }
    if (this.formula.errorMessage === "此内容需要增强可视化。") {
      root.classList.remove("texleaf-formula-widget-error");
      delete root.dataset.texleafRenderError;
      root.title = "此内容需要增强可视化；点击编辑源码";
      root.setAttribute("aria-label", root.title);
      root.replaceChildren(createEnhancedVisualizationHint());
      layout = undefined;
    }
    if (this.record.display && this.record.labels.length > 0) {
      const labels = document.createElement("span");
      labels.className = "texleaf-formula-labels";
      const rowCount = Math.max(
        1,
        ...this.record.labels.map((label) => label.rowCount),
      );
      labels.style.gridTemplateRows = `repeat(${rowCount}, minmax(0, 1fr))`;
      const labelsByRow = new Map<number, typeof this.record.labels[number][]>();
      for (const label of this.record.labels) {
        const rowIndex = clampInteger(label.rowIndex, 0, rowCount - 1);
        const row = labelsByRow.get(rowIndex) ?? [];
        row.push(label);
        labelsByRow.set(rowIndex, row);
      }
      for (const [rowIndex, rowLabels] of labelsByRow) {
        const row = document.createElement("span");
        row.className = "texleaf-formula-label-row";
        row.dataset.texleafFormulaRow = String(rowIndex + 1);
        row.style.gridRow = String(rowIndex + 1);
        for (const label of rowLabels) {
          const chip = document.createElement("span");
          chip.className = "texleaf-formula-label-chip";
          chip.tabIndex = 0;
          chip.textContent = `↪ ${label.key}`;
          chip.title = `标签 ${label.key}；点击编辑 \\label 命令`;
          wireSourcePointer(chip, view, label.from, label.to);
          row.append(chip);
        }
        labels.append(row);
      }
      if (layout !== undefined) {
        layout.classList.add("texleaf-formula-layout-has-labels");
        layout.append(labels);
      } else {
        root.append(labels);
      }
    }
    if ((this.record.references?.length ?? 0) > 0) {
      const references = document.createElement("span");
      references.className = "texleaf-formula-references";
      references.setAttribute("aria-label", "公式中的引用；悬停预览，Ctrl/Cmd+单击跳转");
      const index = indexVisualStructureReferences(view.state.doc.toString(), view.state.field(structureField, false)?.records ?? []);
      for (const reference of this.record.references ?? []) {
        const chip = new ReferenceWidget(reference, referenceChipPresentations(index, new Map(), reference.keys)).toDOM(view);
        references.append(chip);
      }
      root.append(references);
    }
    const open = (event: Event): void => {
      const liveRecord = view.state
        .field(formulaField, false)
        ?.recordById.get(this.record.id);
      const outerRange = readMappedDatasetRange(
        root,
        "formulaFrom",
        "formulaTo",
        view.state.doc.length,
      );
      const bodyRange = readMappedDatasetRange(
        root,
        "formulaBodyFrom",
        "formulaBodyTo",
        view.state.doc.length,
      );
      const target = resolveVisualFormulaActivationTarget(
        view.state.doc.length,
        liveRecord,
        outerRange,
        bodyRange,
      );
      if (target === undefined) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const position = visibleFormulaSourceCursor(view.state, {
        ...this.record,
        ...target,
      });
      view.dispatch({
        selection: EditorSelection.cursor(position),
        scrollIntoView: true,
      });
      view.focus();
    };
    root.addEventListener("mousedown", (event: Event) => {
      const mouseEvent = event as MouseEvent;
      if (mouseEvent.button === 0) {
        open(mouseEvent);
      }
    });
    root.addEventListener("pointerdown", (event: Event) => {
      const pointerEvent = event as PointerEvent;
      if (
        pointerEvent.button === 0 &&
        (pointerEvent.pointerType === "touch" || pointerEvent.pointerType === "pen")
      ) {
        open(pointerEvent);
      }
    });
    root.addEventListener("keydown", (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        open(keyboardEvent);
      }
    });
    const dom = this.record.display
      ? createMeasuredBlockShell(
          root,
          [
            "texleaf-formula-shell",
            this.theoremStyle === undefined
              ? ""
              : `texleaf-theorem-formula-shell texleaf-theorem-${this.theoremStyle}`,
            this.insideFrame ? "texleaf-frame-content-shell" : "",
          ].filter(Boolean).join(" "),
          view,
          this.record.from,
        )
      : root;
    return dom;
  }

  public override ignoreEvent(): boolean {
    return true;
  }

  public override destroy(dom: HTMLElement): void { hideReferenceHoverOwnedBy(dom); }

}

function createFormulaSourceTooltip(
  record: VisualFormulaRecord,
  formula: RenderedFormula,
  placement: VisualMathPreviewPlacement,
  cursorOffset: number,
  renderedCursorOffset: number | undefined,
  retainedCreate?: (view: EditorView) => TooltipView,
): FormulaSourceTooltip {
  const above = placement === "above" || placement === "autoAbove";
  const strictSide = placement === "above" || placement === "below";
  const anchor = clampNumber(cursorOffset, record.from, record.to);
  return {
    // Anchor to the source caret, not to the complete display-environment
    // range. A tall align/aligned/gathered formula may span dozens of source
    // lines; using its outer range forces an `above` tooltip before \begin or a
    // `below` tooltip after \end. The caret anchor keeps the automatic-above
    // behavior used by the native editor while allowing the card to occupy
    // otherwise unused space inside that multi-line source environment.
    pos: anchor,
    above,
    strictSide,
    // The card's border, rather than a displaced tooltip arrow, is the visual
    // alignment edge requested by the editor. This keeps the left border
    // exactly on the delimiter/indentation coordinate returned by getCoords.
    arrow: false,
    clip: true,
    // CodeMirror reuses one TooltipView (and its internal measured-height
    // cache) whenever the create-function identity is unchanged. Reuse that
    // identity while editing one formula to avoid caret/preview flicker, but
    // allocate a fresh identity when moving to another formula so a previous
    // tall preview cannot leave a giant blank height on a small cases/inline
    // preview.
    create: retainedCreate ?? ((view) => createFormulaSourceTooltipView(view)),
    texleafRecord: record,
    texleafFormula: formula,
    texleafCursorOffset: cursorOffset,
    texleafRenderedCursorOffset: renderedCursorOffset,
  };
}

/**
 * One stable Tooltip.create function lets CodeMirror retain the mounted DOM
 * while a source edit, host reparse, base render, and caret render arrive in
 * separate transactions. The view swaps only a fully parsed SVG, so there is
 * no blank frame and the native scroll position is not discarded.
 */
function createFormulaSourceTooltipView(view: EditorView): TooltipView {
  const root = document.createElement("div");
  root.className = "texleaf-math-preview-tooltip";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "当前公式的可滚动 Math Preview");
  root.title = "Math Preview：显示精确光标；可滚动查看超长公式";
  const scroll = document.createElement("div");
  scroll.className = "texleaf-math-preview-scroll";
  scroll.tabIndex = 0;
  const canvas = document.createElement("div");
  canvas.className = "texleaf-math-preview-canvas";
  scroll.append(canvas);
  root.append(scroll);
  const scrollbarOverlay = createMathPreviewScrollbarOverlay(root, scroll);

  let current = view.state.field(formulaField, false)?.tooltip ?? undefined;
  let currentFormula = current?.texleafFormula;
  let currentRecord = current?.texleafRecord;
  let currentCursorOffset = current?.texleafCursorOffset;
  let cleanup: (() => void) | undefined;
  let followFrame: number | undefined;
  let previewGapPx = currentRecord?.display === false
    ? VISUAL_MATH_PREVIEW_INLINE_GAP_PX
    : VISUAL_MATH_PREVIEW_NORMAL_GAP_PX;
  const previewOffset = {
    x: 0,
    get y(): number {
      return previewGapPx;
    },
  };

  const replaceFormula = (formula: RenderedFormula): void => {
    const previousLeft = scroll.scrollLeft;
    const previousTop = scroll.scrollTop;
    const modeRequired = formula.errorMessage === "此内容需要增强可视化。";
    applyFormulaGeometry(canvas, modeRequired ? { ...formula, widthEm: 28, heightEm: 3 } : formula);
    root.classList.toggle(
      "texleaf-math-preview-tooltip-error",
      formula.errorMessage !== undefined && !modeRequired,
    );
    root.setAttribute(
      "aria-label",
      modeRequired ? "此内容需要增强可视化"
        : formula.errorMessage === undefined
        ? "当前公式的可滚动 Math Preview"
        : "Math Preview 渲染失败：" + formula.errorMessage,
    );
    if (modeRequired) {
      canvas.replaceChildren(createEnhancedVisualizationHint());
    } else {
      const svg = createFormulaSvg(formula);
      canvas.replaceChildren(svg ?? document.createTextNode("公式预览不可用"));
    }
    scroll.scrollLeft = previousLeft;
    scroll.scrollTop = previousTop;
  };
  const followCaret = (options: {
    readonly refreshGeometry: boolean;
    readonly scrollToRenderedCaret: boolean;
    readonly settle: boolean;
  }): void => {
    if (followFrame !== undefined) {
      cancelAnimationFrame(followFrame);
    }
    followFrame = requestAnimationFrame(() => {
      if (options.refreshGeometry) {
        scrollbarOverlay.update();
      }
      repositionTooltips(view);
      if (options.scrollToRenderedCaret) {
        scrollMathPreviewToCaret(scroll);
      }
      if (!options.settle) {
        followFrame = undefined;
        return;
      }
      // A replacement SVG can acquire its final height one frame later. Only
      // that geometry-changing path needs a settling pass; ordinary source
      // caret motion must not pay two forced-layout cycles per keystroke.
      followFrame = requestAnimationFrame(() => {
        followFrame = undefined;
        scrollbarOverlay.update();
        repositionTooltips(view);
        if (options.scrollToRenderedCaret) {
          scrollMathPreviewToCaret(scroll);
        }
      });
    });
  };
  const synchronize = (state: EditorState): void => {
    const next = state.field(formulaField, false)?.tooltip ?? undefined;
    if (next === undefined) {
      return;
    }
    const formulaChanged = next.texleafFormula !== currentFormula;
    const cursorChanged = next.texleafCursorOffset !== current?.texleafCursorOffset;
    const renderedCursorMatchesSource =
      next.texleafRenderedCursorOffset !== undefined &&
      next.texleafRenderedCursorOffset === next.texleafCursorOffset;
    current = next;
    currentRecord = next.texleafRecord;
    currentCursorOffset = next.texleafCursorOffset;
    root.dataset.texleafCursorOffset = String(next.texleafCursorOffset);
    if (next.texleafRenderedCursorOffset === undefined) {
      delete root.dataset.texleafRenderedCursorOffset;
    } else {
      root.dataset.texleafRenderedCursorOffset = String(
        next.texleafRenderedCursorOffset,
      );
    }
    root.dataset.texleafFormulaFrom = String(next.texleafRecord.from);
    if (formulaChanged) {
      currentFormula = next.texleafFormula;
      replaceFormula(next.texleafFormula);
    }
    if (formulaChanged || cursorChanged) {
      followCaret({
        refreshGeometry: formulaChanged,
        scrollToRenderedCaret: formulaChanged && renderedCursorMatchesSource,
        settle: formulaChanged,
      });
    }
  };

  if (currentFormula !== undefined) {
    replaceFormula(currentFormula);
  }
  if (currentCursorOffset !== undefined) {
    root.dataset.texleafCursorOffset = String(currentCursorOffset);
  }
  if (current?.texleafRenderedCursorOffset !== undefined) {
    root.dataset.texleafRenderedCursorOffset = String(
      current.texleafRenderedCursorOffset,
    );
  }
  if (currentRecord !== undefined) {
    root.dataset.texleafFormulaFrom = String(currentRecord.from);
  }

  root.dataset.texleafGapPx = String(previewGapPx);

  return {
    dom: root,
    // Completion, hover, and citation-detail tooltips have their own placement
    // rules. They must not participate in CodeMirror's collision resolver for
    // Math Preview, otherwise opening the completion list visibly pushes the
    // formula card away from its caret/environment anchor.
    overlap: true,
    offset: previewOffset,
    getCoords() {
      if (currentRecord === undefined || currentCursorOffset === undefined) {
        return { left: 0, right: 0, top: 0, bottom: 0 };
      }
      const anchor = clampNumber(
        currentCursorOffset,
        currentRecord.from,
        currentRecord.to,
      );
      const caret = visualSourceCoordsAtPos(view, anchor);
      if (caret === undefined) {
        return { left: 0, right: 0, top: 0, bottom: 0 };
      }
      const normalGapPx = currentRecord.display
        ? VISUAL_MATH_PREVIEW_NORMAL_GAP_PX
        : VISUAL_MATH_PREVIEW_INLINE_GAP_PX;
      const vertical = currentFormula === undefined
        ? { top: caret.top, bottom: caret.bottom, bothSidesOverflow: false }
        : visualMathPreviewVerticalLayout(
            view,
            root,
            currentFormula,
            currentRecord,
            caret,
            normalGapPx,
          );
      previewGapPx = vertical.bothSidesOverflow
        ? VISUAL_MATH_PREVIEW_OVERFLOW_GAP_PX
        : normalGapPx;
      root.dataset.texleafGapPx = String(previewGapPx);
      const horizontal = visualMathPreviewHorizontalCoords(
        view,
        currentRecord,
        anchor,
        vertical.bothSidesOverflow,
      ) ?? caret;
      fitVisualMathPreviewWidth(view, root, scroll, horizontal.left);
      root.dataset.texleafAnchorLeft = String(horizontal.left);
      root.dataset.texleafAnchorRight = String(horizontal.right);
      root.dataset.texleafAnchorTop = String(vertical.top);
      root.dataset.texleafAnchorBottom = String(vertical.bottom);
      root.dataset.texleafCaretTop = String(caret.top);
      root.dataset.texleafCaretBottom = String(caret.bottom);
      return {
        left: horizontal.left,
        right: Math.max(horizontal.right, horizontal.left + 1),
        top: vertical.top,
        bottom: vertical.bottom,
      };
    },
    mount() {
      cleanup = observeFormulaGeometry(view, root);
      scrollbarOverlay.update();
      followCaret({
        refreshGeometry: true,
        scrollToRenderedCaret:
          current?.texleafRenderedCursorOffset !== undefined &&
          current.texleafRenderedCursorOffset === current.texleafCursorOffset,
        settle: true,
      });
    },
    update(update) {
      synchronize(update.state);
    },
    destroy() {
      if (followFrame !== undefined) {
        cancelAnimationFrame(followFrame);
      }
      scrollbarOverlay.destroy();
      cleanup?.();
    },
  };
}

const VISUAL_MATH_PREVIEW_NORMAL_GAP_PX = 12;
const VISUAL_MATH_PREVIEW_INLINE_GAP_PX = 6;
const VISUAL_MATH_PREVIEW_OVERFLOW_GAP_PX = 50;
const VISUAL_MATH_PREVIEW_HEIGHT_FRACTION = 0.58;
const VISUAL_MATH_PREVIEW_MAX_HEIGHT_EM = 32;
const VISUAL_MATH_PREVIEW_MAX_WIDTH_FRACTION = 0.84;
const VISUAL_MATH_PREVIEW_MAX_WIDTH_EM = 72;
// CodeMirror's tooltip space excludes its native vertical scrollbar and a
// small internal edge. Reserve both here, otherwise it moves an otherwise
// correctly anchored card roughly eight pixels to the left to make it fit.
const VISUAL_MATH_PREVIEW_RIGHT_INSET_PX = 18;

/**
 * Keep the tooltip's vertical anchor on the exact source caret while giving
 * its left edge a stable typographic origin.  On the opening line this is the
 * actual delimiter; on later lines it is the first non-whitespace source
 * character.  If neither side can fit a tall card, use the outer opening
 * delimiter even when that line has scrolled out of CodeMirror's DOM.
 */
function visualMathPreviewHorizontalCoords(
  view: EditorView,
  record: VisualFormulaRecord,
  cursorOffset: number,
  bothSidesOverflow: boolean,
): { readonly left: number; readonly right: number } | undefined {
  const activeSourceRects = visualActiveFormulaSourceRects(view, record);
  if (!record.display && !bothSidesOverflow && activeSourceRects.length > 0) {
    const openingRect = activeSourceRects[0]!;
    const caret = visualSourceCoordsAtPos(view, cursorOffset);
    const caretMiddle = caret === undefined
      ? (openingRect.top + openingRect.bottom) / 2
      : (caret.top + caret.bottom) / 2;
    const cursorRow = [...activeSourceRects].sort((left, right) => {
      const leftMiddle = (left.top + left.bottom) / 2;
      const rightMiddle = (right.top + right.bottom) / 2;
      return Math.abs(leftMiddle - caretMiddle) - Math.abs(rightMiddle - caretMiddle);
    })[0] ?? openingRect;
    const sameVisualRow = Math.abs(
      (openingRect.top + openingRect.bottom) / 2 -
        (cursorRow.top + cursorRow.bottom) / 2,
    ) <= 2;
    const row = sameVisualRow ? openingRect : cursorRow;
    return clampVisualMathPreviewAnchor(view, {
      left: row.left,
      right: row.left + Math.max(1, view.defaultCharacterWidth),
    });
  }
  const openingLine = view.state.doc.lineAt(record.from);
  const cursorLine = view.state.doc.lineAt(cursorOffset);
  const openingCoords = visualSourceCoordsAtPos(view, record.from);
  if (record.display && openingCoords !== undefined) {
    return clampVisualMathPreviewAnchor(view, openingCoords);
  }
  if (!record.display && !bothSidesOverflow && openingLine.number === cursorLine.number) {
    return openingCoords === undefined
      ? undefined
      : clampVisualMathPreviewAnchor(view, openingCoords);
  }
  const cursorLineStart = firstNonWhitespaceOffset(view.state, cursorLine.from, cursorLine.to);
  const cursorLineCoords = visualSourceCoordsAtPos(view, cursorLineStart);
  if (cursorLineCoords === undefined) {
    return undefined;
  }
  if (!record.display && !bothSidesOverflow) {
    return clampVisualMathPreviewAnchor(view, cursorLineCoords);
  }
  const openingText = view.state.sliceDoc(openingLine.from, record.from);
  const cursorPrefix = view.state.sliceDoc(cursorLine.from, cursorLineStart);
  const openingColumn = visualSourceColumn(openingText, view.state.tabSize);
  const cursorColumn = visualSourceColumn(cursorPrefix, view.state.tabSize);
  const left = cursorLineCoords.left +
    (openingColumn - cursorColumn) * view.defaultCharacterWidth;
  return clampVisualMathPreviewAnchor(view, {
    left,
    right: left + Math.max(1, view.defaultCharacterWidth),
  });
}

/**
 * Horizontal source scrolling can move the real `\\begin` delimiter outside
 * the visible text viewport. CodeMirror clips a tooltip whose custom anchor is
 * outside that viewport, which made a correctly rendered Math Preview appear
 * to vanish. Preserve exact delimiter alignment while it is visible; once it
 * scrolls away, pin the anchor to the nearest visible text edge. The left edge
 * starts after the sticky line-number gutter so the preview never covers line
 * numbers.
 */
function clampVisualMathPreviewAnchor(
  view: EditorView,
  coords: { readonly left: number; readonly right: number },
): { readonly left: number; readonly right: number } {
  const scroller = view.scrollDOM.getBoundingClientRect();
  const gutters = view.dom.querySelector<HTMLElement>(".cm-gutters")
    ?.getBoundingClientRect();
  const visibleLeft = Math.max(
    scroller.left,
    gutters === undefined ? scroller.left : gutters.right,
  );
  const visibleRight = Math.max(visibleLeft + 1, scroller.right - 1);
  const width = Math.max(1, coords.right - coords.left, view.defaultCharacterWidth);
  const left = clampNumber(coords.left, visibleLeft, visibleRight - 1);
  return {
    left,
    right: Math.min(visibleRight, left + width),
  };
}

/**
 * Keep CodeMirror from moving the whole card left merely to fit its right
 * edge. The floating preview already has a horizontal scrollbar, so reducing
 * its viewport to the exact space after the requested source anchor preserves
 * delimiter/indentation alignment without shrinking the SVG itself.
 */
function fitVisualMathPreviewWidth(
  view: EditorView,
  root: HTMLElement,
  scroll: HTMLElement,
  requestedLeft: number,
): void {
  const editor = view.scrollDOM.getBoundingClientRect();
  const fontSize = finiteCssPixels(
    getComputedStyle(view.contentDOM).fontSize,
    16,
  );
  const width = Math.max(
    1,
    Math.min(
      window.innerWidth * VISUAL_MATH_PREVIEW_MAX_WIDTH_FRACTION,
      fontSize * VISUAL_MATH_PREVIEW_MAX_WIDTH_EM,
      editor.right - requestedLeft - VISUAL_MATH_PREVIEW_RIGHT_INSET_PX,
    ),
  );
  const value = `${Math.floor(width)}px`;
  if (root.style.maxWidth !== value) {
    root.style.maxWidth = value;
    scroll.style.maxWidth = value;
  }
}

/**
 * CodeMirror may briefly return null from coordsAtPos while a long source
 * environment scrolls through its viewport virtualization boundary. The
 * active line is already mounted at that point, so derive the same monospace
 * coordinate from its measured DOM rectangle instead of sending the tooltip
 * to CodeMirror's off-screen sentinel and waiting for another transaction.
 */
function visualSourceCoordsAtPos(
  view: EditorView,
  position: number,
  side: -1 | 1 = 1,
): { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } | undefined {
  if (position === view.state.selection.main.head) {
    const primaryCursor = view.dom.querySelector<HTMLElement>(
      ".cm-cursor-primary",
    ) ?? view.dom.querySelector<HTMLElement>(".cm-cursor");
    if (primaryCursor !== null) {
      const cursorBox = primaryCursor.getBoundingClientRect();
      const viewport = view.scrollDOM.getBoundingClientRect();
      if (
        cursorBox.height > 0 &&
        cursorBox.bottom > Math.max(viewport.top, 0) - 1 &&
        cursorBox.top < Math.min(viewport.bottom, window.innerHeight) + 1
      ) {
        return {
          left: cursorBox.left,
          right: cursorBox.left + Math.max(1, view.defaultCharacterWidth),
          top: cursorBox.top,
          bottom: cursorBox.bottom,
        };
      }
    }
  }
  const nativeCoords = view.coordsAtPos(position, side) ?? undefined;
  const targetLine = view.state.doc.lineAt(position);
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head);
  if (targetLine.number === activeLine.number) {
    const activeElement = visualSourceLineElementAtPos(view, position);
    if (activeElement !== null) {
      const box = activeElement.getBoundingClientRect();
      if (box.height > 0 && box.bottom > box.top) {
        // A logical CodeMirror line may occupy several visual rows after soft
        // wrapping. Its element rectangle covers every row, so deriving the
        // caret from `box.top` and a source column anchors both wrapped rows to
        // the first row. Prefer CodeMirror's exact character rectangle whenever
        // it lies in the mounted line and visible editor viewport.
        const viewport = view.scrollDOM.getBoundingClientRect();
        if (
          nativeCoords !== undefined &&
          nativeCoords.bottom > Math.max(box.top, viewport.top) - 1 &&
          nativeCoords.top < Math.min(box.bottom, viewport.bottom) + 1
        ) {
          return nativeCoords;
        }
        const domCoords = visualDomCaretCoordsAtPos(view, position, side);
        if (domCoords !== undefined) {
          return domCoords;
        }
        // During a long scroll, coordsAtPos can return a stale rectangle or no
        // rectangle while the active (single-row) source line is already
        // mounted. Keep the old monospace estimate only for that unwrapped
        // fallback; using it for a soft-wrapped line recreates the row-offset
        // bug fixed above.
        const computed = getComputedStyle(activeElement);
        const lineHeight = finiteCssPixels(
          computed.lineHeight,
          finiteCssPixels(computed.fontSize, 16) * 1.5,
        );
        if (box.height > lineHeight * 1.5) {
          return nativeCoords;
        }
        const parsedPaddingLeft = Number.parseFloat(
          computed.paddingLeft,
        );
        const textLeft = box.left +
          (Number.isFinite(parsedPaddingLeft) ? parsedPaddingLeft : 0);
        const prefix = view.state.sliceDoc(targetLine.from, position);
        const left = textLeft +
          visualSourceColumn(prefix, view.state.tabSize) *
            view.defaultCharacterWidth;
        return {
          left,
          right: left + Math.max(1, view.defaultCharacterWidth),
          top: box.top,
          bottom: box.bottom,
        };
      }
    }
  }
  return nativeCoords;
}

function visualDomCaretCoordsAtPos(
  view: EditorView,
  position: number,
  side: -1 | 1,
): { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } | undefined {
  try {
    const mapped = view.domAtPos(position);
    const range = document.createRange();
    range.setStart(mapped.node, mapped.offset);
    range.collapse(true);
    const collapsed = Array.from(range.getClientRects()).find((rect) => rect.height > 0);
    if (collapsed !== undefined) {
      const left = side < 0 ? collapsed.right : collapsed.left;
      return {
        left,
        right: left + Math.max(1, view.defaultCharacterWidth),
        top: collapsed.top,
        bottom: collapsed.bottom,
      };
    }
    if (mapped.node instanceof Text) {
      const length = mapped.node.data.length;
      const from = side < 0
        ? Math.max(0, mapped.offset - 1)
        : Math.min(length, mapped.offset);
      const to = side < 0
        ? Math.max(0, mapped.offset)
        : Math.min(length, mapped.offset + 1);
      if (from < to) {
        range.setStart(mapped.node, from);
        range.setEnd(mapped.node, to);
        const rects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0);
        const character = side < 0 ? rects.at(-1) : rects[0];
        if (character !== undefined) {
          const left = side < 0 ? character.right : character.left;
          return {
            left,
            right: left + Math.max(1, view.defaultCharacterWidth),
            top: character.top,
            bottom: character.bottom,
          };
        }
      }
    }
  } catch {
    // A replaced decoration can briefly have no direct DOM mapping. The caller
    // retains CodeMirror's coordinate or its single-line measured fallback.
  }
  return undefined;
}

/**
 * Structural decorations can leave more than one `.cm-activeLine` in the DOM
 * for a single logical theorem line. The first one may be an empty boundary
 * line above the source that actually owns the caret, which made an inline
 * Math Preview appear a whole theorem row away. Resolve the DOM node from the
 * exact document offset first; only use active-line geometry as a measured
 * fallback when CodeMirror cannot map that offset directly.
 */
function visualSourceLineElementAtPos(
  view: EditorView,
  position: number,
): HTMLElement | null {
  try {
    const mapped = view.domAtPos(position);
    const element = mapped.node instanceof Element
      ? mapped.node
      : mapped.node.parentElement;
    const line = element?.closest<HTMLElement>(".cm-line") ?? null;
    if (line !== null) {
      const box = line.getBoundingClientRect();
      if (box.height > 0 && box.bottom > box.top) {
        return line;
      }
    }
  } catch {
    // A position crossing a temporarily replaced decoration may not have a DOM
    // mapping during one frame. The coordinate-ranked fallback below still
    // selects the visible line nearest that exact source offset.
  }

  const coords = view.coordsAtPos(position, 1);
  const candidates = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(
    ".cm-line.cm-activeLine",
  )).filter((line) => {
    const box = line.getBoundingClientRect();
    return box.height > 0 && box.bottom > box.top;
  });
  if (candidates.length === 0) {
    return null;
  }
  if (coords === null) {
    return candidates.length === 1 ? candidates[0] ?? null : null;
  }
  const target = (coords.top + coords.bottom) / 2;
  return candidates.sort((left, right) => {
    const leftBox = left.getBoundingClientRect();
    const rightBox = right.getBoundingClientRect();
    const leftDistance = Math.abs((leftBox.top + leftBox.bottom) / 2 - target);
    const rightDistance = Math.abs((rightBox.top + rightBox.bottom) / 2 - target);
    return leftDistance - rightDistance;
  })[0] ?? null;
}

function visualMathPreviewVerticalLayout(
  view: EditorView,
  root: HTMLElement,
  formula: RenderedFormula,
  record: VisualFormulaRecord,
  caret: { readonly top: number; readonly bottom: number },
  normalGapPx: number,
): {
  readonly top: number;
  readonly bottom: number;
  readonly bothSidesOverflow: boolean;
} {
  const editorViewport = view.scrollDOM.getBoundingClientRect();
  const viewportTop = Math.max(0, editorViewport.top);
  const viewportBottom = Math.min(window.innerHeight, editorViewport.bottom);
  const activeSourceRects = visualActiveFormulaSourceRects(view, record);
  const caretMiddle = (caret.top + caret.bottom) / 2;
  const activeCursorRow = record.display
    ? undefined
    : [...activeSourceRects].sort((left, right) => {
        const leftMiddle = (left.top + left.bottom) / 2;
        const rightMiddle = (right.top + right.bottom) / 2;
        return Math.abs(leftMiddle - caretMiddle) - Math.abs(rightMiddle - caretMiddle);
      })[0];
  // Inline source can itself straddle a browser soft-wrap boundary: the `\`
  // of `\(` may remain on the previous row while the rest starts on the next.
  // Anchor both vertical edges to the row containing the caret, otherwise the
  // tooltip reserves the preceding row and appears roughly one line too far
  // away. Display environments intentionally retain their outer boundaries.
  const activeOpening = activeCursorRow ?? activeSourceRects[0];
  const activeClosing = activeCursorRow ?? activeSourceRects.at(-1);
  const opening = activeOpening === undefined
    ? visualSourceCoordsAtPos(view, record.from)
    : {
        left: activeOpening.left,
        right: activeOpening.right,
        top: activeOpening.top,
        bottom: activeOpening.bottom,
      };
  const closingPosition = Math.max(record.from, record.to - 1);
  const closing = activeClosing === undefined
    ? visualSourceCoordsAtPos(view, closingPosition, -1)
    : {
        left: activeClosing.left,
        right: activeClosing.right,
        top: activeClosing.top,
        bottom: activeClosing.bottom,
      };
  const fontSize = finiteCssPixels(
    getComputedStyle(view.contentDOM).fontSize,
    16,
  );
  const maximumHeight = Math.min(
    window.innerHeight * VISUAL_MATH_PREVIEW_HEIGHT_FRACTION,
    fontSize * VISUAL_MATH_PREVIEW_MAX_HEIGHT_EM,
  );
  const estimatedHeight = Math.min(
    maximumHeight,
    Math.max(fontSize, formula.heightEm * fontSize + 17),
  );
  const tooltipHeight = Math.max(
    root.getBoundingClientRect().height,
    estimatedHeight,
  );
  const availableAbove = Math.max(
    0,
    (opening?.top ?? viewportTop) - viewportTop -
      normalGapPx,
  );
  const availableBelow = Math.max(
    0,
    viewportBottom - (closing?.bottom ?? viewportBottom) -
      normalGapPx,
  );
  const bothSidesOverflow = availableAbove < tooltipHeight &&
    availableBelow < tooltipHeight;
  if (bothSidesOverflow) {
    return { top: caret.top, bottom: caret.bottom, bothSidesOverflow: true };
  }
  return {
    // When only one outer boundary is mounted, pin the missing side to the
    // corresponding viewport edge. This gives CodeMirror an environment-wide
    // rectangle, so its normal above/below flip selects the side that actually
    // has room outside the environment rather than an arbitrary caret side.
    top: opening?.top ?? viewportTop + 1,
    bottom: closing?.bottom ?? viewportBottom - 1,
    bothSidesOverflow: false,
  };
}

function sourceRevealCaretPosition(
  state: EditorState,
  reveal: StructureSourceReveal | undefined,
  preferred: number,
): number {
  const documentLength = state.doc.length;
  const safePreferred = clampInteger(preferred, 0, documentLength);
  if (reveal === undefined || reveal.ranges.length === 0) {
    return safePreferred;
  }
  const containing = reveal.ranges.find((range) =>
    safePreferred >= range.from && safePreferred <= range.to
  );
  const range = containing ?? reveal.ranges.reduce((best, candidate) =>
    Math.abs(candidate.to - safePreferred) < Math.abs(best.to - safePreferred)
      ? candidate
      : best
  );
  let caret = clampInteger(safePreferred, range.from, range.to);
  if (containing === undefined) {
    caret = range.to;
  }
  while (caret > range.from) {
    const previous = state.doc.sliceString(caret - 1, caret);
    if (previous !== "\n" && previous !== "\r") {
      break;
    }
    caret -= 1;
  }
  return caret;
}

/**
 * Return the painted fragments of the active formula source. An inline mark at
 * a soft-wrap boundary can have an opening offset whose native CodeMirror
 * coordinate belongs to the preceding visual row. The mark fragments are the
 * browser's exact layout result, so they keep both axes on the row the user can
 * actually see and click.
 */
function visualActiveFormulaSourceRects(
  view: EditorView,
  record: VisualFormulaRecord,
): readonly DOMRect[] {
  const selector =
    `[data-texleaf-formula-from="${record.from}"]` +
    `[data-texleaf-formula-to="${record.to}"]`;
  const markedRects = Array.from(
    view.contentDOM.querySelectorAll<HTMLElement>(selector),
  )
    .flatMap((element) => Array.from(element.getClientRects()))
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => left.top - right.top || left.left - right.left);
  if (markedRects.length > 0) {
    return markedRects;
  }

  // A tooltip can be measured in the same update that replaces its formula
  // widget with editable source. In that first measurement the mark above may
  // not have reached the DOM yet, although CodeMirror can already map both
  // source offsets. A DOM Range gives the browser's exact soft-wrap fragments
  // without waiting for a second editor transaction.
  try {
    const from = view.domAtPos(record.from);
    const to = view.domAtPos(record.to);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .sort((left, right) => left.top - right.top || left.left - right.left);
  } catch {
    return [];
  }
}

function firstNonWhitespaceOffset(
  state: EditorState,
  from: number,
  to: number,
): number {
  let position = from;
  while (position < to && /\s/u.test(state.sliceDoc(position, position + 1))) {
    position += 1;
  }
  return position;
}

function visualSourceColumn(value: string, tabSize: number): number {
  const safeTabSize = Number.isFinite(tabSize)
    ? Math.min(16, Math.max(1, Math.trunc(tabSize)))
    : 4;
  let column = 0;
  for (const character of value) {
    column = character === "\t"
      ? column + safeTabSize - (column % safeTabSize)
      : column + 1;
  }
  return column;
}

function finiteCssPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function scrollMathPreviewToCaret(scroll: HTMLElement): void {
  const caret = scroll.querySelector<SVGGraphicsElement>(
    '[data-texleaf-preview-caret="true"]',
  );
  if (caret === null) {
    return;
  }
  const viewport = scroll.getBoundingClientRect();
  const marker = caret.getBoundingClientRect();
  const targetLeft = scroll.scrollLeft +
    marker.left - viewport.left + marker.width / 2 - scroll.clientWidth / 2;
  const targetTop = scroll.scrollTop +
    marker.top - viewport.top + marker.height / 2 - scroll.clientHeight / 2;
  scroll.scrollLeft = clampNumber(
    targetLeft,
    0,
    Math.max(0, scroll.scrollWidth - scroll.clientWidth),
  );
  scroll.scrollTop = clampNumber(
    targetTop,
    0,
    Math.max(0, scroll.scrollHeight - scroll.clientHeight),
  );
}

interface MathPreviewScrollbarOverlay {
  readonly update: () => void;
  readonly destroy: () => void;
}

/**
 * Electron's Windows scrollbar can remain 15px wide even when WebKit sizing
 * rules request 6px. Hide that native paint (the element remains genuinely
 * scrollable) and mirror both axes with lightweight overlay tracks. Because
 * the tracks occupy the existing 8px padding instead of layout space, the
 * formula keeps equal apparent whitespace at all four card edges.
 */
function createMathPreviewScrollbarOverlay(
  root: HTMLElement,
  scroll: HTMLElement,
): MathPreviewScrollbarOverlay {
  const horizontal = createMathPreviewScrollbar("horizontal");
  const vertical = createMathPreviewScrollbar("vertical");
  root.append(horizontal.track, vertical.track);
  const controller = new AbortController();
  const signal = controller.signal;
  let resizeFrame: number | undefined;

  const updateAxis = (
    bar: ReturnType<typeof createMathPreviewScrollbar>,
    horizontalAxis: boolean,
  ): void => {
    const viewportLength = horizontalAxis ? scroll.clientWidth : scroll.clientHeight;
    const contentLength = horizontalAxis ? scroll.scrollWidth : scroll.scrollHeight;
    const maximum = Math.max(0, contentLength - viewportLength);
    const visible = maximum > 1;
    bar.track.classList.toggle("visible", visible);
    bar.track.setAttribute("aria-hidden", visible ? "false" : "true");
    if (!visible) {
      return;
    }
    const trackLength = horizontalAxis ? bar.track.clientWidth : bar.track.clientHeight;
    if (trackLength <= 0 || contentLength <= 0) {
      return;
    }
    const thumbLength = Math.min(
      trackLength,
      Math.max(Math.min(24, trackLength), trackLength * viewportLength / contentLength),
    );
    const movable = Math.max(0, trackLength - thumbLength);
    const position = horizontalAxis ? scroll.scrollLeft : scroll.scrollTop;
    const offset = maximum <= 0 ? 0 : movable * position / maximum;
    if (horizontalAxis) {
      bar.thumb.style.width = `${thumbLength}px`;
      bar.thumb.style.transform = `translateX(${offset}px)`;
    } else {
      bar.thumb.style.height = `${thumbLength}px`;
      bar.thumb.style.transform = `translateY(${offset}px)`;
    }
    bar.track.setAttribute("aria-valuemax", String(Math.round(maximum)));
    bar.track.setAttribute("aria-valuenow", String(Math.round(position)));
  };

  const update = (): void => {
    updateAxis(horizontal, true);
    updateAxis(vertical, false);
  };

  const wireAxis = (
    bar: ReturnType<typeof createMathPreviewScrollbar>,
    horizontalAxis: boolean,
  ): void => {
    let drag: {
      readonly pointerId: number;
      readonly startCoordinate: number;
      readonly startScroll: number;
      readonly maximum: number;
      readonly movable: number;
    } | undefined;
    const coordinate = (event: PointerEvent): number =>
      horizontalAxis ? event.clientX : event.clientY;
    const scrollPosition = (): number =>
      horizontalAxis ? scroll.scrollLeft : scroll.scrollTop;
    const setScrollPosition = (value: number): void => {
      if (horizontalAxis) {
        scroll.scrollLeft = value;
      } else {
        scroll.scrollTop = value;
      }
    };
    bar.track.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const trackBox = bar.track.getBoundingClientRect();
      const thumbBox = bar.thumb.getBoundingClientRect();
      const viewportLength = horizontalAxis ? scroll.clientWidth : scroll.clientHeight;
      const contentLength = horizontalAxis ? scroll.scrollWidth : scroll.scrollHeight;
      const maximum = Math.max(0, contentLength - viewportLength);
      const trackLength = horizontalAxis ? trackBox.width : trackBox.height;
      const thumbLength = horizontalAxis ? thumbBox.width : thumbBox.height;
      const movable = Math.max(0, trackLength - thumbLength);
      if (event.target === bar.thumb) {
        drag = {
          pointerId: event.pointerId,
          startCoordinate: coordinate(event),
          startScroll: scrollPosition(),
          maximum,
          movable,
        };
        bar.track.setPointerCapture(event.pointerId);
        return;
      }
      const trackStart = horizontalAxis ? trackBox.left : trackBox.top;
      const desired = coordinate(event) - trackStart - thumbLength / 2;
      setScrollPosition(
        movable <= 0 ? 0 : clampNumber(desired / movable * maximum, 0, maximum),
      );
      update();
    }, { signal });
    bar.track.addEventListener("pointermove", (event) => {
      if (drag === undefined || drag.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      const delta = coordinate(event) - drag.startCoordinate;
      setScrollPosition(
        drag.movable <= 0
          ? 0
          : clampNumber(
              drag.startScroll + delta / drag.movable * drag.maximum,
              0,
              drag.maximum,
            ),
      );
      update();
    }, { signal });
    const stopDrag = (event: PointerEvent): void => {
      if (drag === undefined || drag.pointerId !== event.pointerId) {
        return;
      }
      if (bar.track.hasPointerCapture(event.pointerId)) {
        bar.track.releasePointerCapture(event.pointerId);
      }
      drag = undefined;
    };
    bar.track.addEventListener("pointerup", stopDrag, { signal });
    bar.track.addEventListener("pointercancel", stopDrag, { signal });
  };

  wireAxis(horizontal, true);
  wireAxis(vertical, false);
  scroll.addEventListener("scroll", update, { passive: true, signal });
  const observer = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
        if (resizeFrame !== undefined) {
          cancelAnimationFrame(resizeFrame);
        }
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined;
          update();
        });
      })
    : undefined;
  observer?.observe(root);
  observer?.observe(scroll);

  return {
    update,
    destroy: () => {
      controller.abort();
      if (resizeFrame !== undefined) {
        cancelAnimationFrame(resizeFrame);
      }
      observer?.disconnect();
    },
  };
}

function createMathPreviewScrollbar(
  axis: "horizontal" | "vertical",
): { readonly track: HTMLElement; readonly thumb: HTMLElement } {
  const track = document.createElement("div");
  track.className = `texleaf-math-preview-scrollbar texleaf-math-preview-scrollbar-${axis === "horizontal" ? "x" : "y"}`;
  track.setAttribute("role", "scrollbar");
  track.setAttribute("aria-label", axis === "horizontal" ? "公式预览横向滚动" : "公式预览纵向滚动");
  track.setAttribute("aria-orientation", axis);
  track.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("div");
  thumb.className = "texleaf-math-preview-scrollbar-thumb";
  track.append(thumb);
  return { track, thumb };
}

function visibleFormulaSourceCursor(
  state: EditorState,
  record: VisualFormulaRecord,
): number {
  const start = Math.min(
    Math.max(record.from, record.bodyFrom),
    Math.max(record.from, record.to - 1),
  );
  const end = Math.min(
    Math.max(start, record.bodyTo),
    Math.max(start, record.to - 1),
  );
  let position = start;
  while (position < end && /\s/u.test(state.sliceDoc(position, position + 1))) {
    position += 1;
  }
  return position;
}

function currentFormulaRenderError(
  state: EditorState,
  formulaId: string,
  message: string,
): RenderedFormula | undefined {
  const record = state.field(formulaField, false)?.records.find(
    (candidate) => candidate.id === formulaId,
  );
  if (
    record === undefined ||
    !validRange(record.from, record.to, state.doc.length)
  ) {
    return undefined;
  }
  const source = state.sliceDoc(record.from, record.to);
  return exactSourceFormulaErrorAsset(record, message, source);
}

function exactSourceFormulaAsset(
  record: VisualFormulaRecord,
  formula: RenderedFormula,
  source: string,
): RenderedFormula {
  if (formula.source === source) {
    return formula;
  }
  if (formula.errorMessage === undefined) {
    return rebindVisualFormulaAssetSource(formula, source);
  }
  // Failure cards embed a source excerpt in the SVG itself. Rebinding only the
  // guard would display the old pre-format excerpt, so regenerate this cheap
  // local card while preserving the worker's normalized error message.
  return exactSourceFormulaErrorAsset(record, formula.errorMessage, source);
}

function exactSourceFormulaErrorAsset(
  record: VisualFormulaRecord,
  message: string,
  source: string,
): RenderedFormula {
  const bodyClasses = document.body.classList;
  const dark = bodyClasses.contains("vscode-dark") ||
    bodyClasses.contains("vscode-high-contrast");
  const card = createMathPreviewErrorCard(
    message,
    source,
    resolveMathPreviewAppearance(dark),
    record.display ? 42 : 28,
  );
  return {
    ...card,
    source,
    errorMessage: message.replace(/\s+/gu, " ").trim() || "公式渲染失败",
  };
}

function applyFormulaGeometry(
  element: HTMLElement,
  formula: RenderedFormula,
): void {
  element.style.setProperty(
    "--texleaf-formula-width",
    `${safeFormulaDimension(formula.widthEm, 1)}em`,
  );
  element.style.setProperty(
    "--texleaf-formula-height",
    `${safeFormulaDimension(formula.heightEm, 1)}em`,
  );
}

function createFormulaSvg(formula: RenderedFormula): SVGElement | undefined {
  const svg = parseSvg(formula.svg);
  if (svg === undefined) {
    return undefined;
  }
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.style.removeProperty("vertical-align");
  // MathJax normally supplies this rule through its mjx-container wrapper.
  // We intentionally embed the bare SVG in CodeMirror, so restore it here:
  // several NewCM glyphs (notably U+2265/U+2264) touch the viewBox edge and
  // Chromium can otherwise clip their sub-pixel boundary stroke at text size.
  svg.style.overflow = "visible";
  svg.style.minWidth = "1px";
  svg.style.minHeight = "1px";
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg;
}

/** Tooltip previews live outside the measured editor content tree. */
function observeFormulaGeometry(
  view: EditorView,
  element: HTMLElement,
): () => void {
  let frame = requestAnimationFrame(() => view.requestMeasure());
  const observer = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => view.requestMeasure());
      })
    : undefined;
  observer?.observe(element);
  return () => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
  };
}

function safeFormulaDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0
    ? Math.round(value * 10_000) / 10_000
    : fallback;
}

function selectionIntersectsFormula(
  state: EditorState,
  record: VisualFormulaRecord,
): boolean {
  return state.selection.ranges.some((range) =>
    range.empty
      ? range.head >= record.from && range.head <= record.to
      : range.from < record.to && range.to > record.from,
  );
}

/**
 * Return only the formula records touched by the current selections.
 *
 * Formula records arrive ordered and non-overlapping in normal documents. A
 * lower-bound lookup therefore avoids rescanning every formula on each cursor
 * movement or keystroke while the one-record look-behind preserves inclusive
 * formula-end selection semantics.
 */
function selectedFormulaRecords(
  state: EditorState,
  records: readonly VisualFormulaRecord[],
): VisualFormulaRecord[] {
  if (records.length === 0) {
    return [];
  }
  const selected = new Map<string, VisualFormulaRecord>();
  for (const range of state.selection.ranges) {
    for (const record of formulaRecordsIntersectingRange(
      records,
      range.from,
      range.to,
      range.empty,
    )) {
      selected.set(record.id, record);
    }
  }
  return [...selected.values()].sort(compareFormulaRecords);
}

function formulaRecordsIntersectingRange(
  records: readonly VisualFormulaRecord[],
  from: number,
  to: number,
  empty: boolean,
): VisualFormulaRecord[] {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (records[middle]!.from < from) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  let index = Math.max(0, low - 1);
  const result: VisualFormulaRecord[] = [];
  const point = from;
  for (; index < records.length; index += 1) {
    const record = records[index]!;
    if (empty ? record.from > point : record.from >= to) {
      break;
    }
    if (
      empty
        ? point >= record.from && point <= record.to
        : from < record.to && to > record.from
    ) {
      result.push(record);
    }
  }
  return result;
}

interface FormulaPreviewTarget {
  readonly record: VisualFormulaRecord;
  readonly cursorOffset: number;
}

/**
 * Resolve the formula that owns Math Preview for the current selection.
 *
 * A non-empty selection can cover a formula while both its anchor and head
 * sit in surrounding prose. The old head-only lookup therefore exposed the
 * valid formula source but cancelled its preview request. Prefer the formula
 * under the head, then the anchor, and finally the intersected formula nearest
 * the head. The render marker itself is clamped to the formula body so the
 * host always receives a safe insertion point.
 */
function activeFormulaPreviewTarget(
  state: EditorState,
  records: readonly VisualFormulaRecord[],
): FormulaPreviewTarget | undefined {
  const ranges = [state.selection.main, ...state.selection.ranges.filter(
    (range) => range !== state.selection.main,
  )];
  for (const range of ranges) {
    const intersecting = formulaRecordsIntersectingRange(
      records,
      range.from,
      range.to,
      range.empty,
    );
    if (intersecting.length === 0) {
      continue;
    }
    const record = intersecting.find(
      (candidate) =>
        range.head >= candidate.from && range.head <= candidate.to,
    ) ?? intersecting.find(
      (candidate) =>
        range.anchor >= candidate.from && range.anchor <= candidate.to,
    ) ?? [...intersecting].sort((left, right) =>
      distanceFromRange(range.head, left.from, left.to) -
        distanceFromRange(range.head, right.from, right.to) ||
      left.from - right.from
    )[0];
    if (record === undefined) {
      continue;
    }
    const sourceOffset = range.head >= record.from && range.head <= record.to
      ? range.head
      : range.anchor >= record.from && range.anchor <= record.to
        ? range.anchor
        : range.head < record.from
          ? record.bodyFrom
          : record.bodyTo;
    return {
      record,
      cursorOffset: clampNumber(sourceOffset, record.bodyFrom, record.bodyTo),
    };
  }
  return undefined;
}

function distanceFromRange(value: number, from: number, to: number): number {
  return value < from ? from - value : value > to ? value - to : 0;
}

function formulaPreviewTargetMatches(
  target: FormulaPreviewTarget | undefined,
  formulaId: string,
  cursorOffset: number,
): boolean {
  return target?.record.id === formulaId && target.cursorOffset === cursorOffset;
}

function requestCommittedFormulaAfterSelectionLeave(update: ViewUpdate): void {
  if (!inputFeatures.mathPreviewEnabled) {
    return;
  }
  const previousField = update.startState.field(formulaField, false);
  const nextField = update.state.field(formulaField, false);
  const previous = activeFormulaPreviewTarget(
    update.startState,
    previousField?.records ?? [],
  );
  const next = activeFormulaPreviewTarget(
    update.state,
    nextField?.records ?? [],
  );
  if (previous === undefined || previous.record.id === next?.record.id) {
    return;
  }
  const record = nextField?.records.find(
    (candidate) => candidate.id === previous.record.id,
  ) ?? previous.record;
  if (record.from < 0 || record.to > update.state.doc.length || record.from >= record.to) {
    return;
  }
  const formulaSource = update.state.sliceDoc(record.from, record.to);
  if (nextField?.rendered.get(record.id)?.source === formulaSource) {
    return;
  }
  const requestId = ++formulaCommitPreviewRequestSequence;
  latestFormulaCommitPreviewRequests.set(record.id, requestId);
  while (latestFormulaCommitPreviewRequests.size > 64) {
    const oldest = latestFormulaCommitPreviewRequests.keys().next().value as
      | string
      | undefined;
    if (oldest === undefined) {
      break;
    }
    latestFormulaCommitPreviewRequests.delete(oldest);
  }
  post({
    protocol: VISUAL_EDITOR_PROTOCOL,
    type: "formulaCommitPreview",
    requestId,
    version: documentVersion,
    revision: clientRevision,
    formulaId: record.id,
    formulaFrom: record.from,
    formulaSource,
    bodyFrom: record.bodyFrom - record.from,
    bodyTo: record.bodyTo - record.from,
    display: record.display,
    ...(record.environmentName === undefined
      ? {}
      : { environmentName: record.environmentName }),
  });
}

function scheduleFormulaCacheEvictionNotice(formulaIds: readonly string[]): void {
  for (const formulaId of formulaIds) {
    if (formulaId.length > 0) {
      pendingFormulaCacheEvictions.add(formulaId);
    }
  }
  if (pendingFormulaCacheEvictions.size === 0 || formulaCacheEvictionNoticeScheduled) {
    return;
  }
  formulaCacheEvictionNoticeScheduled = true;
  queueMicrotask(() => {
    formulaCacheEvictionNoticeScheduled = false;
    const evicted = [...pendingFormulaCacheEvictions];
    pendingFormulaCacheEvictions.clear();
    const refillViewport = formulaCacheEvictionsTouchViewport(evicted);
    for (let index = 0; index < evicted.length; index += 512) {
      post({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "formulaCacheEvicted",
        formulaIds: evicted.slice(index, index + 512),
        refillViewport: refillViewport && index === 0,
      });
    }
    if (refillViewport) {
      // The viewport may not have moved, but an asset inside it was just
      // released. Clear the geometry de-duplication key so the host can refill
      // only the now-missing visible formulas on the next animation frame.
      lastViewportRequestKey = undefined;
      scheduleViewportRequest();
    }
  });
}

function formulaCacheEvictionsTouchViewport(formulaIds: readonly string[]): boolean {
  if (editor === undefined || formulaIds.length === 0) {
    return false;
  }
  const field = editor.state.field(formulaField, false);
  if (field === undefined || editor.visibleRanges.length === 0) {
    return false;
  }
  const visibleFrom = Math.min(...editor.visibleRanges.map((range) => range.from));
  const visibleTo = Math.max(...editor.visibleRanges.map((range) => range.to));
  const viewportKey = `${documentVersion}:${assetGeneration ?? 0}:${visibleFrom}:${visibleTo}`;
  if (lastFormulaCacheRefillViewportKey === viewportKey) {
    // One refill is enough for an unchanged viewport. If the visible SVGs
    // themselves exceed the byte budget, repeated refill/eviction would
    // otherwise ping-pong forever. Scrolling or editing creates a fresh key.
    return false;
  }
  for (const formulaId of formulaIds) {
    const record = field.recordById.get(formulaId);
    if (
      record !== undefined &&
      editor.visibleRanges.some((range) => range.from < record.to && range.to > record.from)
    ) {
      lastFormulaCacheRefillViewportKey = viewportKey;
      return true;
    }
  }
  return false;
}

const VIEWPORT_REQUEST_MINIMUM_INTERVAL_MS = 32;
const VIEWPORT_SETTLE_DELAY_MS = 160;

function scheduleViewportRequest(settled = false): void {
  if (!inputFeatures.mathPreviewEnabled) {
    cancelViewportRequestSchedule();
    lastViewportRequestKey = undefined;
    lastSettledViewportRequestKey = undefined;
    return;
  }
  if (settled) {
    // A trailing request must be able to upgrade an already queued live frame;
    // otherwise the final scroll event can be swallowed by the 32 ms throttle.
    viewportRequestSettledPending = true;
  }
  if (viewportTimer !== undefined || viewportFrame !== undefined) {
    return;
  }
  const remaining = VIEWPORT_REQUEST_MINIMUM_INTERVAL_MS -
    (performance.now() - lastViewportRequestAt);
  if (remaining > 0) {
    viewportTimer = setTimeout(() => {
      viewportTimer = undefined;
      queueViewportRequestFrame();
    }, remaining);
    return;
  }
  queueViewportRequestFrame();
}

function queueViewportRequestFrame(): void {
  if (viewportFrame !== undefined) {
    return;
  }
  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = undefined;
    const settled = viewportRequestSettledPending;
    viewportRequestSettledPending = false;
    if (!inputFeatures.mathPreviewEnabled || editor === undefined) {
      return;
    }
    const ranges = editor.visibleRanges;
    if (ranges.length === 0) {
      return;
    }
    const from = Math.min(...ranges.map((range) => range.from));
    const to = Math.max(...ranges.map((range) => range.to));
    const key = `${documentVersion}:${assetGeneration ?? 0}:${from}:${to}`;
    if (key !== lastViewportGeometryKey) {
      lastViewportGeometryKey = key;
      lastFormulaCacheRefillViewportKey = undefined;
      lastSettledViewportRequestKey = undefined;
    }
    if (
      settled
        ? key === lastSettledViewportRequestKey
        : key === lastViewportRequestKey
    ) {
      return;
    }
    if (settled) {
      lastSettledViewportRequestKey = key;
    }
    lastViewportRequestKey = key;
    lastViewportRequestAt = performance.now();
    post({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "viewport",
      version: documentVersion,
      from,
      to,
      ...(settled ? { settled: true } : {}),
    });
  });
}

function scheduleSettledViewportRequest(): void {
  if (viewportSettleTimer !== undefined) {
    clearTimeout(viewportSettleTimer);
    viewportSettleTimer = undefined;
  }
  if (!inputFeatures.mathPreviewEnabled) {
    return;
  }
  viewportSettleTimer = setTimeout(() => {
    viewportSettleTimer = undefined;
    scheduleViewportRequest(true);
  }, VIEWPORT_SETTLE_DELAY_MS);
}

function cancelViewportRequestSchedule(): void {
  if (viewportTimer !== undefined) {
    clearTimeout(viewportTimer);
    viewportTimer = undefined;
  }
  if (viewportFrame !== undefined) {
    cancelAnimationFrame(viewportFrame);
    viewportFrame = undefined;
  }
  if (viewportSettleTimer !== undefined) {
    clearTimeout(viewportSettleTimer);
    viewportSettleTimer = undefined;
  }
  viewportRequestSettledPending = false;
}

function scheduleCursorPreviewRequest(view: EditorView | undefined = editor): void {
  cursorPreviewScheduledView = view;
  if (cursorPreviewTimer !== undefined) {
    clearTimeout(cursorPreviewTimer);
    cursorPreviewTimer = undefined;
  }
  if (cursorPreviewFrame !== undefined) {
    cancelAnimationFrame(cursorPreviewFrame);
    cursorPreviewFrame = undefined;
  }
  if (!inputFeatures.mathPreviewEnabled || view === undefined) {
    cursorPreviewScheduledView = undefined;
    invalidateCursorPreviewRequest();
    return;
  }
  const configuredDelay = Math.max(50, inputFeatures.mathPreviewDebounceMs);
  const delay = view.state.doc.length >= 200_000
    ? Math.max(300, configuredDelay)
    : configuredDelay;
  cursorPreviewTimer = setTimeout(() => {
    cursorPreviewTimer = undefined;
    cursorPreviewFrame = requestAnimationFrame(() => {
      cursorPreviewFrame = undefined;
      const scheduledView = cursorPreviewScheduledView;
      cursorPreviewScheduledView = undefined;
      if (scheduledView === undefined || scheduledView !== editor) {
        invalidateCursorPreviewRequest();
        return;
      }
      const field = scheduledView.state.field(formulaField, false);
      const target = activeFormulaPreviewTarget(
        scheduledView.state,
        field?.records ?? [],
      );
      if (target === undefined) {
        invalidateCursorPreviewRequest();
        return;
      }
      const { record, cursorOffset } = target;
      const key = `${documentVersion}:${clientRevision}:${record.id}:${cursorOffset}`;
      if (
        key === lastCursorPreviewRequestKey &&
        (field?.cursorRendered === undefined ||
          (field.cursorRendered.formulaId === record.id &&
            field.cursorRendered.cursorOffset === cursorOffset))
      ) {
        return;
      }
      const requestId = ++cursorPreviewRequestSequence;
      latestCursorPreviewRequestId = requestId;
      lastCursorPreviewRequestKey = key;
      post({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "cursorPreview",
        requestId,
        version: documentVersion,
        revision: clientRevision,
        formulaId: record.id,
        formulaFrom: record.from,
        formulaSource: scheduledView.state.sliceDoc(record.from, record.to),
        bodyFrom: record.bodyFrom - record.from,
        bodyTo: record.bodyTo - record.from,
        display: record.display,
        ...(record.environmentName === undefined
          ? {}
          : { environmentName: record.environmentName }),
        cursorOffset,
      });
    });
  }, delay);
}

function invalidateCursorPreviewRequest(): void {
  lastCursorPreviewRequestKey = undefined;
  latestCursorPreviewRequestId = ++cursorPreviewRequestSequence;
}

function clearReverseSyncWidgetFlash(sequence?: number): void {
  const element = reverseSyncWidgetFlashElement;
  if (
    element === undefined ||
    (sequence !== undefined &&
      element.dataset.texleafReverseSyncSequence !== String(sequence))
  ) {
    return;
  }
  element.classList.remove("texleaf-reverse-sync-widget-flash");
  delete element.dataset.texleafReverseSyncSequence;
  delete element.dataset.texleafReverseSyncTarget;
  reverseSyncWidgetFlashElement = undefined;
}

function scheduleReverseSyncWidgetFlash(position: number, sequence: number): void {
  clearReverseSyncWidgetFlash();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const currentEditor = editor;
    if (
      currentEditor === undefined ||
      editor !== currentEditor ||
      reverseSyncFlashSequence !== sequence
    ) {
      return;
    }
    const lineHighlight = currentEditor.dom.querySelector<HTMLElement>(
      `.texleaf-reverse-sync-flash-line[data-texleaf-reverse-sync-sequence="${sequence}"]`,
    );
    if (lineHighlight !== null && lineHighlight.getClientRects().length > 0) {
      return;
    }
    const elements = currentEditor.dom.querySelectorAll<HTMLElement>([
      "[data-texleaf-source-from]",
      "[data-formula-from]",
      "[data-formula-body-from]",
      "[data-texleaf-body-from]",
      "[data-texleaf-columns-from]",
    ].join(","));
    const rangeKeys = [
      ["texleafSourceFrom", "texleafSourceTo"],
      ["formulaFrom", "formulaTo"],
      ["formulaBodyFrom", "formulaBodyTo"],
      ["texleafBodyFrom", "texleafBodyTo"],
      ["texleafColumnsFrom", "texleafColumnsTo"],
    ] as const;
    let best: { readonly element: HTMLElement; readonly length: number } | undefined;
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]!;
      for (const [fromKey, toKey] of rangeKeys) {
        const range = readMappedDatasetRange(
          element,
          fromKey,
          toKey,
          currentEditor.state.doc.length,
        );
        if (range === undefined || position < range.from || position > range.to) {
          continue;
        }
        const length = Math.max(1, range.to - range.from);
        if (best === undefined || length < best.length) {
          best = { element, length };
        }
      }
    }
    if (best === undefined) {
      return;
    }
    // Mapped descendants identify the most precise semantic target, but a
    // token-sized title, label or button would recreate the old one-word
    // flash. Promote that target to its visual row/block whenever possible.
    const flashTarget = best.element.closest<HTMLElement>(
      ".texleaf-measured-block-shell, .texleaf-formula-widget-block",
    ) ?? best.element.closest<HTMLElement>(".cm-line") ?? best.element;
    flashTarget.classList.add("texleaf-reverse-sync-widget-flash");
    flashTarget.dataset.texleafReverseSyncSequence = String(sequence);
    flashTarget.dataset.texleafReverseSyncTarget = "visual";
    reverseSyncWidgetFlashElement = flashTarget;
  }));
}

function revealSelection(
  selection: VisualEditorSelection,
  options?: VisualEditorFocusOptions,
): void {
  if (editor === undefined) {
    return;
  }
  const clamped = clampSelection(selection, editor.state.doc.length);
  const structure = editor.state.field(structureField, false);
  const preamble = structure?.records.find(
    (record): record is VisualPreambleRecord => record.kind === "preamble",
  );
  const effects: StateEffect<unknown>[] = [];
  if (
    preamble !== undefined &&
    structure?.enabled === true &&
    !structure?.preambleExpanded &&
    (clamped.anchor < preamble.to || clamped.head < preamble.to)
  ) {
    effects.push(setPreambleExpanded.of(true));
  }
  if (options?.center === true) {
    effects.push(EditorView.scrollIntoView(clamped.head, {
      y: "center",
      yMargin: 32,
    }));
  }
  const flashSequence = options?.flash === true
    ? ++reverseSyncFlashSequence
    : undefined;
  if (flashSequence !== undefined) {
    effects.push(setReverseSyncFlash.of({
      position: clamped.head,
      sequence: flashSequence,
    }));
  }
  editor.dispatch({
    selection: EditorSelection.single(clamped.anchor, clamped.head),
    effects,
    scrollIntoView: options?.center !== true,
    annotations: hostSyncAnnotations,
  });
  editor.focus();
  if (flashSequence !== undefined) {
    scheduleReverseSyncWidgetFlash(clamped.head, flashSequence);
  }

  if (options?.center === true) {
    const recenterCurrentSelection = (): void => {
      if (
        editor === undefined ||
        (flashSequence !== undefined && flashSequence !== reverseSyncFlashSequence) ||
        editor.state.selection.main.anchor !== clamped.anchor ||
        editor.state.selection.main.head !== clamped.head
      ) {
        return;
      }
      editor.dispatch({
        effects: EditorView.scrollIntoView(clamped.head, {
          y: "center",
          yMargin: 32,
        }),
        annotations: hostSyncAnnotations,
      });
    };
    // Structure decorations (especially a newly expanded preamble) can change
    // block geometry in the same frame. Re-center after layout settles so a
    // reverse SyncTeX target lands near the middle instead of at an edge.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      recenterCurrentSelection();
    }));
    // A PDF webview hands focus back to VS Code after its double-click handler
    // completes. That outer focus transfer can run after the two animation
    // frames above and make CodeMirror reveal the caret at an edge again. A
    // guarded delayed pass wins that race without moving the document if the
    // user has already placed the caret somewhere else.
    setTimeout(recenterCurrentSelection, 140);
  }

  if (flashSequence !== undefined) {
    if (reverseSyncFlashTimer !== undefined) {
      clearTimeout(reverseSyncFlashTimer);
    }
    reverseSyncFlashTimer = setTimeout(() => {
      if (editor === undefined || flashSequence !== reverseSyncFlashSequence) {
        return;
      }
      editor.dispatch({
        effects: setReverseSyncFlash.of(undefined),
        annotations: hostSyncAnnotations,
      });
      clearReverseSyncWidgetFlash(flashSequence);
      reverseSyncFlashTimer = undefined;
    }, 1_250);
  }
}

function updateCapabilities(capabilities: VisualEditorCapabilities): void {
  editorCapabilities = capabilities;
  setToolbarBusy(toolbarBusy);
  const suffix = capabilities.latexWorkshopInstalled
    ? capabilities.latexWorkshopCompatibility
      ? ""
      : "（TeXLeaf 的保存兼容桥已在设置中关闭）"
    : "（需要安装 LaTeX Workshop）";
  buildMenuButton.title = `选择 LaTeX 编译方式${suffix}`;
  buildPdfLaTexButton.title = `使用 pdfLaTeX 编译${suffix}`;
  buildXeLaTexButton.title = `使用 XeLaTeX 编译${suffix}`;
  buildLuaLaTexButton.title = `使用 LuaLaTeX 编译${suffix}`;
  buildBibTexButton.title = `使用 BibTeX 编译参考文献${suffix}`;
  buildBibLaTexButton.title = `使用 BibLaTeX（Biber）编译参考文献${suffix}`;
  viewPdfButton.title = `使用 LaTeX Workshop 查看 PDF${suffix}`;
  topViewPdfButton.title = `使用 LaTeX Workshop 查看 PDF${suffix}`;
  synctexButton.title = `从当前光标正向定位到 PDF${suffix}`;
}

function toggleEditorMode(): void {
  editorMode = editorMode === "visual" ? "source" : "visual";
  updateEditorModeButton();
  const view = editor;
  if (view !== undefined) {
    view.dispatch({
      effects: [
        setEditorPresentationMode.of(editorMode),
        setStructureEnabled.of(editorMode === "visual"),
        setFormulaVisualMode.of(editorMode === "visual"),
        bracketMatchingCompartment.reconfigure(
          editorMode === "source" && inputFeatures.highlightActiveBracketPair
            ? bracketMatching()
            : [],
        ),
        syntaxHighlightingCompartment.reconfigure(
          editorMode === "source"
            ? syntaxHighlighting(classHighlighter, { fallback: true })
            : [],
        ),
      ],
      scrollIntoView: true,
    });
    persistEditorState(view);
    requestAnimationFrame(() => {
      if (editor !== view) {
        return;
      }
      view.dispatch({
        selection: view.state.selection,
        scrollIntoView: true,
        annotations: hostSyncAnnotations,
      });
      view.focus();
      view.requestMeasure();
      scheduleViewportRequest();
      scheduleCursorPreviewRequest(view);
    });
  }
  setStatus(
    "info",
    editorMode === "source"
      ? "已在当前标签页显示完整 LaTeX 源码；再次点击可返回可视化模式。"
      : "已在当前标签页返回可视化模式。",
    4_500,
  );
}

function updateEditorModeButton(): void {
  const source = editorMode === "source";
  openSourceButton.setAttribute("aria-pressed", String(source));
  topOpenSourceButton.setAttribute("aria-pressed", String(source));
  setMenuButtonLabel(openSourceButton, source ? "可视化模式" : "源码模式");
  setMenuButtonLabel(topOpenSourceButton, source ? "可视化" : "源码");
  openSourceButton.title = source
    ? "在当前标签页返回 TeXLeaf 可视化编辑"
    : "在当前标签页显示完整 LaTeX 源码";
  topOpenSourceButton.title = openSourceButton.title;
  openNativeSourceButton.title = "在 VS Code 原生 LaTeX 编辑器中打开同一文档";
  topOpenNativeSourceButton.title = openNativeSourceButton.title;
  editorHost.dataset.editorMode = editorMode;
  if (editor !== undefined) {
    syncEditorModeClass(editor);
  }
}

function syncEditorModeClass(view: EditorView): void {
  const source = editorMode === "source";
  view.dom.classList.toggle("texleaf-source-mode", source);
  view.dom.classList.toggle("texleaf-visual-mode", !source);
}

function updateTemplateMenu(items: readonly VisualEditorTemplateMenuItem[]): void {
  const fragment = document.createDocumentFragment();
  if (items.length === 0) {
    const empty = document.createElement("button");
    empty.type = "button";
    empty.disabled = true;
    empty.setAttribute("role", "menuitem");
    empty.className = "toolbar-menu-placeholder";
    const icon = document.createElement("span");
    icon.className = "toolbar-menu-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "▤";
    const label = document.createElement("span");
    label.className = "toolbar-menu-label";
    label.textContent = "当前没有可用模板";
    empty.append(icon, label);
    fragment.append(empty);
  } else {
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = toolbarBusy;
      button.setAttribute("role", "menuitem");
      button.dataset.templateId = item.id;
      button.title = item.description.length > 0
        ? `${item.name} — ${item.description}`
        : item.name;
      const icon = document.createElement("span");
      icon.className = "toolbar-menu-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = item.isFactory ? "TeX" : "▤";
      const label = document.createElement("span");
      label.className = "toolbar-menu-label";
      // Template names are user-controlled profile data; textContent keeps the
      // Webview menu inert even when a name contains markup-like characters.
      label.textContent = item.name;
      button.append(icon, label);
      fragment.append(button);
    }
  }
  templateMenuItems.replaceChildren(fragment);
}

function setToolbarBusy(busy: boolean): void {
  toolbarBusy = busy;
  buildMenuButton.disabled = busy || !editorCapabilities.latexWorkshopInstalled || !editorCapabilities.buildEnabled;
  buildPdfLaTexButton.disabled = busy || !editorCapabilities.latexWorkshopInstalled || !editorCapabilities.buildEnabled;
  buildXeLaTexButton.disabled = busy || !editorCapabilities.latexWorkshopInstalled || !editorCapabilities.buildEnabled;
  buildLuaLaTexButton.disabled = busy || !editorCapabilities.latexWorkshopInstalled || !editorCapabilities.buildEnabled;
  buildBibTexButton.disabled = busy || !editorCapabilities.latexWorkshopInstalled || !editorCapabilities.buildEnabled;
  buildBibLaTexButton.disabled = busy || !editorCapabilities.latexWorkshopInstalled || !editorCapabilities.buildEnabled;
  viewPdfButton.disabled = busy || !editorCapabilities.latexWorkshopInstalled || !editorCapabilities.pdfViewerEnabled;
  topViewPdfButton.disabled = busy || !editorCapabilities.latexWorkshopInstalled || !editorCapabilities.pdfViewerEnabled;
  synctexButton.disabled = busy || !editorCapabilities.latexWorkshopInstalled || !editorCapabilities.synctexEnabled;
  openSourceButton.disabled = busy;
  openNativeSourceButton.disabled = busy;
  topOpenSourceButton.disabled = busy;
  topOpenNativeSourceButton.disabled = busy;
  topSaveDocumentButton.disabled = busy;
  topPickSnippetButton.disabled = busy;
  topPickCitationButton.disabled = busy;
  topOpenSnippetManagerButton.disabled = busy;
  topOpenTemplateManagerButton.disabled = busy;
  for (const button of Array.from(
    templateMenuItems.querySelectorAll<HTMLButtonElement>("button[data-template-id]"),
  )) {
    button.disabled = busy;
  }
  aiReviewButton.disabled = busy;
  topAiReviewButton.disabled = busy;
  aiRewriteButton.disabled = busy;
  topAiRewriteButton.disabled = busy;
  aiCompletionButton.disabled = busy;
  topAiCompletionButton.disabled = busy;
  aiReviewDocumentButton.disabled = busy;
  topAiReviewDocumentButton.disabled = busy;
  updateFormatDocumentButtonState();
}

function updateFormatDocumentButtonState(): void {
  topFormatDocumentButton.disabled = toolbarBusy ||
    editor === undefined ||
    editor.state.readOnly;
}

function setStatus(
  level: "info" | "warning" | "error",
  message: string,
  clearAfterMs?: number,
): void {
  if (statusTimer !== undefined) {
    clearTimeout(statusTimer);
    statusTimer = undefined;
  }
  statusElement.dataset.level = level;
  statusElement.textContent = message;
  statusElement.title = message;
  if (clearAfterMs !== undefined) {
    statusTimer = setTimeout(() => {
      statusTimer = undefined;
      statusElement.dataset.level = "info";
      statusElement.textContent = "";
      statusElement.title = "";
    }, clearAfterMs);
  }
}

const editingToolbarTextStyles: Readonly<Record<string, {
  readonly canonical: string;
  readonly aliases: readonly string[];
}>> = {
  bold: { canonical: "textbf", aliases: ["textbf"] },
  italic: { canonical: "emph", aliases: ["emph", "textit", "textsl"] },
  underline: { canonical: "underline", aliases: ["underline", "uline"] },
  strike: { canonical: "sout", aliases: ["sout", "st"] },
};

function runEditingToolbarInsertion(
  command: string,
  preservedSelection?: VisualEditorSelection,
): void {
  const view = editor;
  if (view === undefined || view.state.readOnly) {
    return;
  }
  const selection = preservedSelection === undefined
    ? view.state.selection.main
    : EditorSelection.range(
        clampNumber(preservedSelection.anchor, 0, view.state.doc.length),
        clampNumber(preservedSelection.head, 0, view.state.doc.length),
      );
  const selected = view.state.sliceDoc(selection.from, selection.to);
  const textStyle = editingToolbarTextStyles[command];
  if (textStyle !== undefined) {
    const plan = planVisualInlineStyleToggle(
      view.state.doc.toString(),
      { start: selection.from, end: selection.to },
      textStyle.canonical,
      textStyle.aliases,
    );
    if (plan === undefined) {
      setStatus("warning", "当前选区无法安全应用文字样式。", 3_000);
      return;
    }
    applyEditingToolbarAtomicPlan(view, plan);
    return;
  }
  const eol = view.state.lineBreak;
  const line = view.state.doc.lineAt(selection.from);
  const indentation = /^\s*/u.exec(view.state.sliceDoc(line.from, line.to))?.[0] ?? "";
  const field = (index: number, placeholder: string): ReplacementPart => ({
    kind: "tabstop",
    index,
    placeholder,
  });
  const text = (value: string): ReplacementPart => ({ kind: "text", value });
  let parts: readonly ReplacementPart[] | undefined;
  switch (command) {
    case "section":
      parts = [text("\\section{"), field(0, selected || "章节标题"), text("}")];
      break;
    case "inlineMath":
      parts = [text("\\("), field(0, selected || "x"), text("\\)")];
      break;
    case "displayMath":
      parts = [
        text(`\\[${eol}${indentation}  `),
        field(0, selected || "E=mc^2"),
        text(`${eol}${indentation}\\]`),
      ];
      break;
    case "equation":
      parts = [
        text(`\\begin{equation}${eol}${indentation}  `),
        field(0, selected || "E=mc^2"),
        text(`\\label{eq:`),
        field(1, "label"),
        text(`}${eol}${indentation}\\end{equation}`),
      ];
      break;
    case "align":
      parts = [
        text(`\\begin{align}${eol}${indentation}  `),
        field(0, selected || "f(x)"), text(" &= "), field(1, "g(x)"),
        text(` \\\\${eol}${indentation}  `),
        field(2, "h(x)"), text(" &= "), field(3, "k(x)"),
        text(`${eol}${indentation}\\end{align}`),
      ];
      break;
    case "cases":
      parts = [
        text(`\\[${eol}${indentation}  `), field(0, "f(x)"),
        text(`=\\begin{cases}${eol}${indentation}    `),
        field(1, "x^2"), text(" & \\text{if } "), field(2, "x \\ge 0"),
        text(` \\\\${eol}${indentation}    `),
        field(3, "-x"), text(" & \\text{if } "), field(4, "x < 0"),
        text(`${eol}${indentation}  \\end{cases}${eol}${indentation}\\]`),
      ];
      break;
    case "matrix":
      parts = [
        text(`\\[${eol}${indentation}  \\begin{pmatrix}${eol}${indentation}    `),
        field(0, "a"), text(" & "), field(1, "b"),
        text(` \\\\${eol}${indentation}    `),
        field(2, "c"), text(" & "), field(3, "d"),
        text(`${eol}${indentation}  \\end{pmatrix}${eol}${indentation}\\]`),
      ];
      break;
    case "theorem":
    case "lemma":
    case "proposition":
    case "corollary": {
      const labelPrefix = command === "theorem"
        ? "thm"
        : command === "lemma"
        ? "lem"
        : command === "proposition"
        ? "prp"
        : "cor";
      parts = [
        text(`\\begin{${command}}\\label{${labelPrefix}:`),
        field(0, "label"),
        text(`}${eol}${indentation}  `),
        field(1, selected || "环境内容"),
        text(`${eol}${indentation}\\end{${command}}`),
      ];
      break;
    }
    case "proof":
      parts = [
        text(`\\begin{proof}${eol}${indentation}  `),
        field(0, selected || "证明"),
        text(`${eol}${indentation}\\end{proof}`),
      ];
      break;
    case "itemize":
      parts = [
        text(`\\begin{itemize}${eol}${indentation}  \\item `),
        field(0, selected || "第一项"),
        text(`${eol}${indentation}  \\item `),
        field(1, "第二项"),
        text(`${eol}${indentation}\\end{itemize}`),
      ];
      break;
    case "enumerate":
      parts = [
        text(`\\begin{enumerate}${eol}${indentation}  \\item `),
        field(0, selected || "第一项"),
        text(`${eol}${indentation}  \\item `),
        field(1, "第二项"),
        text(`${eol}${indentation}\\end{enumerate}`),
      ];
      break;
    case "description":
      parts = [
        text(`\\begin{description}${eol}${indentation}  \\item[`),
        field(0, "术语"), text("] "), field(1, selected || "说明"),
        text(`${eol}${indentation}  \\item[`),
        field(2, "另一术语"), text("] "), field(3, "说明"),
        text(`${eol}${indentation}\\end{description}`),
      ];
      break;
    case "table":
      parts = [
        text(`\\begin{table}[htbp]${eol}${indentation}  \\centering${eol}${indentation}  \\caption{`),
        field(0, "表格标题"),
        text(`}${eol}${indentation}  \\label{tab:`),
        field(1, "label"),
        text(`}${eol}${indentation}  \\begin{tabular}{ccc}${eol}${indentation}    \\hline${eol}${indentation}    `),
        field(2, "列一"), text(" & "), field(3, "列二"), text(" & "), field(4, "列三"),
        text(` \\\\${eol}${indentation}    \\hline${eol}${indentation}    `),
        field(5, "A"), text(" & "), field(6, "B"), text(" & "), field(7, "C"),
        text(` \\\\${eol}${indentation}    \\hline${eol}${indentation}  \\end{tabular}${eol}${indentation}\\end{table}`),
      ];
      break;
    case "longtable":
      parts = [
        text(`\\begin{longtable}[c]{ccc}${eol}${indentation}  \\caption{`),
        field(0, "长表格标题"),
        text(`}\\label{tab:`), field(1, "long"),
        text(`}\\\\${eol}${indentation}  \\hline${eol}${indentation}  `),
        field(2, "列一"), text(" & "), field(3, "列二"), text(" & "), field(4, "列三"),
        text(` \\\\${eol}${indentation}  \\hline${eol}${indentation}  \\endfirsthead${eol}${indentation}  \\multicolumn{3}{c}{\\tablename\\ \\thetable{} -- continued} \\\\${eol}${indentation}  \\hline${eol}${indentation}  `),
        field(5, "列一"), text(" & "), field(6, "列二"), text(" & "), field(7, "列三"),
        text(` \\\\${eol}${indentation}  \\hline${eol}${indentation}  \\endhead${eol}${indentation}  \\hline${eol}${indentation}  \\multicolumn{3}{r}{Continued on next page} \\\\${eol}${indentation}  \\endfoot${eol}${indentation}  \\hline${eol}${indentation}  \\endlastfoot${eol}${indentation}  `),
        field(8, "A"), text(" & "), field(9, "B"), text(" & "), field(10, "C"),
        text(` \\\\${eol}${indentation}\\end{longtable}`),
      ];
      break;
    case "tabular":
      parts = [
        text(`\\begin{tabular}{ccc}${eol}${indentation}  \\hline${eol}${indentation}  `),
        field(0, "列一"), text(" & "), field(1, "列二"), text(" & "), field(2, "列三"),
        text(` \\\\${eol}${indentation}  \\hline${eol}${indentation}  `),
        field(3, "A"), text(" & "), field(4, "B"), text(" & "), field(5, "C"),
        text(` \\\\${eol}${indentation}  \\hline${eol}${indentation}\\end{tabular}`),
      ];
      break;
    case "tabularx":
      parts = [
        text(`\\begin{tabularx}{\\linewidth}{lXX}${eol}${indentation}  \\hline${eol}${indentation}  `),
        field(0, "项目"), text(" & "), field(1, "说明"), text(" & "), field(2, "备注"),
        text(` \\\\${eol}${indentation}  \\hline${eol}${indentation}  `),
        field(3, "A"), text(" & "), field(4, "内容"), text(" & "), field(5, "备注"),
        text(` \\\\${eol}${indentation}  \\hline${eol}${indentation}\\end{tabularx}`),
      ];
      break;
    case "figure":
      parts = [
        text(`\\begin{figure}[htbp]${eol}${indentation}  \\centering${eol}${indentation}  \\includegraphics[width=`),
        field(0, "0.8\\linewidth"), text("]{"), field(1, "figure.pdf"),
        text(`}${eol}${indentation}  \\caption{`), field(2, "图片标题"),
        text(`}${eol}${indentation}  \\label{fig:`), field(3, "label"),
        text(`}${eol}${indentation}\\end{figure}`),
      ];
      break;
    case "includeGraphics":
      parts = [
        text("\\includegraphics[width="), field(0, "0.8\\linewidth"),
        text("]{"), field(1, "figure.pdf"), text("}"),
      ];
      break;
    case "tikzcd":
      parts = [
        text(`\\begin{tikzcd}${eol}${indentation}  `),
        field(0, "A"), text(` \\arrow[r, "`), field(1, "f"), text(`"] & `),
        field(2, "B"), text(`${eol}${indentation}\\end{tikzcd}`),
      ];
      break;
    case "tikzpicture":
      parts = [
        text(`\\begin{tikzpicture}[node distance=2cm]${eol}${indentation}  \\node (`),
        field(0, "A"), text(") {$"), field(1, "A"),
        text(`$};${eol}${indentation}  \\node (`), field(2, "B"),
        text(") [right of="), field(3, "A"), text("] {$"), field(4, "B"),
        text(`$};${eol}${indentation}  \\draw[->] (`), field(5, "A"),
        text(") -- node[above] {$"), field(6, "f"), text("$} ("), field(7, "B"),
        text(`);${eol}${indentation}\\end{tikzpicture}`),
      ];
      break;
    case "label":
      parts = [text("\\label{"), field(0, "key"), text("}")];
      break;
    case "reference":
      parts = [text("\\eqref{"), field(0, "eq:key"), text("}")];
      break;
    case "plainReference":
      parts = [text("\\ref{"), field(0, "key"), text("}")];
      break;
    case "citation":
      parts = [text("\\cite{"), field(0, "key"), text("}")];
      break;
  }
  if (parts === undefined) {
    return;
  }
  applyEditingToolbarSnippet(view, selection.from, selection.to, parts);
}

function applyEditingToolbarAtomicPlan(
  view: EditorView,
  plan: VisualInlineStyleTogglePlan,
): void {
  const sourceBefore = view.state.doc.toString();
  applyingHostOperation = true;
  suppressHostEditMessages = true;
  try {
    view.dispatch({
      changes: {
        from: plan.range.start,
        to: plan.range.end,
        insert: plan.insert,
      },
      selection: EditorSelection.range(plan.selection.start, plan.selection.end),
      scrollIntoView: true,
      annotations: [
        Transaction.userEvent.of("input.complete"),
        isolateHistory.of("full"),
      ],
    });
    const change = visualSingleTextDifference(sourceBefore, view.state.doc.toString());
    if (change !== undefined) {
      clientRevision += 1;
      post({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "edit",
        revision: clientRevision,
        changes: [change],
        selection: currentSelection(view.state),
        composing: false,
        source: "host",
      });
    }
    view.focus();
  } finally {
    suppressHostEditMessages = false;
    applyingHostOperation = false;
  }
}

function applyAtomicVisualDocumentChange(
  view: EditorView,
  change: { readonly from: number; readonly to: number; readonly insert: string },
  outsideCaret?: { readonly before: number; readonly after: number },
): void {
  const sourceBefore = view.state.doc.toString();
  const sourceAfterLength = sourceBefore.length - (change.to - change.from) + change.insert.length;
  const beforeCaret = clampInteger(outsideCaret?.before ?? change.to, 0, sourceBefore.length);
  const afterCaret = clampInteger(
    outsideCaret?.after ?? change.from + change.insert.length,
    0,
    sourceAfterLength,
  );
  applyingHostOperation = true;
  suppressHostEditMessages = true;
  try {
    // A table/tikzcd editor is a block widget, so the retained CodeMirror
    // selection can still sit inside the source range even though the user is
    // typing in a nested HTML input. Move that selection just past the
    // environment before creating the history event. The apply result and a
    // later Ctrl+Z then both land outside the environment, allowing its visual
    // card to reappear instead of leaving the restored source expanded.
    view.dispatch({
      selection: EditorSelection.single(beforeCaret),
      annotations: hostSyncAnnotations,
    });
    view.dispatch({
      changes: change,
      selection: EditorSelection.single(afterCaret),
      scrollIntoView: true,
      annotations: [
        Transaction.userEvent.of("input.complete"),
        isolateHistory.of("full"),
      ],
    });
    const applied = visualSingleTextDifference(sourceBefore, view.state.doc.toString());
    if (applied !== undefined) {
      rememberAtomicVisualHistory({
        beforeText: sourceBefore,
        afterText: view.state.doc.toString(),
        beforeCaret,
        afterCaret,
      });
      clientRevision += 1;
      post({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "edit",
        revision: clientRevision,
        changes: [applied],
        selection: currentSelection(view.state),
        composing: false,
        source: "host",
      });
    }
    view.focus();
  } finally {
    suppressHostEditMessages = false;
    applyingHostOperation = false;
  }
}

function captureTextColorSelection(): void {
  const view = editor;
  if (view === undefined || view.state.readOnly) {
    pendingTextColorSelection = undefined;
    return;
  }
  const selection = currentSelection(view.state);
  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  pendingTextColorSelection = {
    selection,
    revision: clientRevision,
    selectedSource: view.state.sliceDoc(from, to),
  };
}

function openTextColorPopover(): void {
  if (pendingTextColorSelection === undefined) {
    captureTextColorSelection();
  }
  if (pendingTextColorSelection === undefined) {
    return;
  }
  closeToolbarPopupMenu(false);
  closeEditingContextMenu(false);
  setTextColorPanelValue(textColorPicker.value);
  textColorPopover.hidden = false;
  textColorButton.setAttribute("aria-expanded", "true");
  const button = textColorButton.getBoundingClientRect();
  const width = 260;
  const left = Math.max(8, Math.min(button.left, window.innerWidth - width - 8));
  const estimatedHeight = 142;
  const top = button.bottom + 6 + estimatedHeight <= window.innerHeight
    ? button.bottom + 6
    : Math.max(8, button.top - estimatedHeight - 6);
  textColorPopover.style.left = `${left}px`;
  textColorPopover.style.top = `${top}px`;
  textColorHex.focus();
  textColorHex.select();
}

function closeTextColorPopover(restoreEditorSelection: boolean): void {
  const pending = pendingTextColorSelection;
  textColorPopover.hidden = true;
  textColorButton.setAttribute("aria-expanded", "false");
  pendingTextColorSelection = undefined;
  if (
    restoreEditorSelection &&
    pending !== undefined &&
    editor !== undefined &&
    pending.revision === clientRevision
  ) {
    const selection = clampSelection(pending.selection, editor.state.doc.length);
    editor.dispatch({
      selection: EditorSelection.single(selection.anchor, selection.head),
      annotations: Transaction.addToHistory.of(false),
    });
    editor.focus();
  }
}

function setTextColorPanelValue(value: string): void {
  const normalized = normalizedHtmlColor(value) ?? "D73A49";
  const html = `#${normalized}`;
  textColorPicker.value = html;
  textColorHex.value = html;
  textColorHex.classList.remove("invalid");
  textColorApplyButton.disabled = false;
  textColorSwatch.style.backgroundColor = html;
}

function normalizedHtmlColor(value: string): string | undefined {
  const normalized = value.trim().replace(/^#/u, "").toUpperCase();
  return /^[0-9A-F]{6}$/u.test(normalized) ? normalized : undefined;
}

function applyPendingTextColor(): void {
  const view = editor;
  const pending = pendingTextColorSelection;
  const color = normalizedHtmlColor(textColorHex.value);
  if (view === undefined || pending === undefined || color === undefined) {
    setStatus("warning", "请输入有效的六位 HEX 颜色。", 3_000);
    return;
  }
  const from = Math.min(pending.selection.anchor, pending.selection.head);
  const to = Math.max(pending.selection.anchor, pending.selection.head);
  if (
    pending.revision !== clientRevision ||
    from < 0 ||
    to > view.state.doc.length ||
    view.state.sliceDoc(from, to) !== pending.selectedSource
  ) {
    closeTextColorPopover(false);
    setStatus("warning", "文档或选区已经变化，请重新选择文字后应用颜色。", 4_000);
    view.focus();
    return;
  }
  const plan = planVisualTextColorApply(
    view.state.doc.toString(),
    { start: from, end: to },
    color,
  );
  if (plan === undefined) {
    setStatus("warning", "当前选区无法安全应用颜色。", 3_000);
    return;
  }
  closeTextColorPopover(false);
  applyEditingToolbarAtomicPlan(view, plan);
}

function applyEditingToolbarSnippet(
  view: EditorView,
  from: number,
  to: number,
  parts: readonly ReplacementPart[],
): void {
  const sourceBefore = view.state.doc.toString();
  const encoding = replacementPartsToCodeMirrorSnippet(parts);
  const insertedText = parts.map((part) =>
    part.kind === "text" ? part.value : part.placeholder ?? ""
  ).join("");
  applyingHostOperation = true;
  suppressHostEditMessages = true;
  try {
    const applied = applyAtomicCodeMirrorSnippet(view, {
      template: encoding.template,
      completion: syntheticSnippetCompletion,
      from,
      to,
      openBraceMarker: encoding.openBraceMarker,
      closeBraceMarker: encoding.closeBraceMarker,
    });
    registerVisualSnippetFields(view, applied.fields, applied.exit);
    if (view.state.sliceDoc(from, from + insertedText.length) !== insertedText) {
      throw new Error("工具栏片段文本与预期内容不一致。");
    }
    if (applied.changes.length > 0) {
      clientRevision += 1;
      post({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "edit",
        revision: clientRevision,
        changes: applied.changes,
        selection: currentSelection(view.state),
        composing: false,
        source: "host",
      });
    }
    view.focus();
  } finally {
    suppressHostEditMessages = false;
    applyingHostOperation = false;
  }
}

function wireButton(
  button: HTMLButtonElement,
  command: VisualEditorWebviewCommand,
): void {
  button.addEventListener("click", () => {
    if (!button.disabled) {
      post({ protocol: VISUAL_EDITOR_PROTOCOL, type: "command", command });
    }
  });
}

function setMenuButtonLabel(button: HTMLButtonElement, label: string): void {
  const labelElement = button.querySelector<HTMLElement>(
    ".context-menu-label, .toolbar-menu-label, .toolbar-button-label",
  );
  if (labelElement !== null) {
    labelElement.textContent = label;
    return;
  }
  button.textContent = label;
}

function runCommand(command: VisualEditorWebviewCommand): boolean {
  post({ protocol: VISUAL_EDITOR_PROTOCOL, type: "command", command });
  return true;
}

function currentSelection(state: EditorState): VisualEditorSelection {
  return {
    anchor: state.selection.main.anchor,
    head: state.selection.main.head,
  };
}

function persistEditorState(view: EditorView): void {
  if (persistEditorStateTimer !== undefined) {
    clearTimeout(persistEditorStateTimer);
    persistEditorStateTimer = undefined;
  }
  const structure = view.state.field(structureField, false);
  vscode.setState({
    selection: currentSelection(view.state),
    scrollTop: view.scrollDOM.scrollTop,
    preambleExpanded: structure?.preambleExpanded === true,
    editorMode,
  } satisfies PersistedState);
}

function schedulePersistEditorState(view: EditorView): void {
  if (persistEditorStateTimer !== undefined) {
    clearTimeout(persistEditorStateTimer);
  }
  persistEditorStateTimer = setTimeout(() => {
    persistEditorStateTimer = undefined;
    if (editor === view) {
      persistEditorState(view);
    }
  }, 180);
}

function parsePersistedState(value: unknown): PersistedState {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const candidate = value as Partial<PersistedState>;
  return {
    ...(isSelection(candidate.selection) ? { selection: candidate.selection } : {}),
    ...(typeof candidate.scrollTop === "number" && Number.isFinite(candidate.scrollTop)
      ? { scrollTop: candidate.scrollTop }
      : {}),
    ...(typeof candidate.preambleExpanded === "boolean"
      ? { preambleExpanded: candidate.preambleExpanded }
      : {}),
    ...(candidate.editorMode === "visual" || candidate.editorMode === "source"
      ? { editorMode: candidate.editorMode }
      : {}),
  };
}

function parseHostMessage(value: unknown): VisualEditorHostMessage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Partial<VisualEditorHostMessage> & {
    readonly protocol?: unknown;
    readonly type?: unknown;
  };
  if (candidate.protocol !== VISUAL_EDITOR_PROTOCOL || typeof candidate.type !== "string") {
    return undefined;
  }
  return value as VisualEditorHostMessage;
}

function parseSvg(source: string): SVGElement | undefined {
  if (!isSafeSvg(source)) {
    return undefined;
  }
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    root.localName.toLowerCase() !== "svg" ||
    parsed.querySelector("parsererror, script, foreignObject") !== null
  ) {
    return undefined;
  }
  return document.importNode(root, true) as unknown as SVGElement;
}

function isSafeSvg(source: string): boolean {
  return source.length > 0 && source.length <= 4_000_000 &&
    /^\s*<svg(?:\s|>)/iu.test(source) &&
    !/<(?:script|foreignObject|iframe|object|embed)(?:\s|>)/iu.test(source);
}

function isSelection(value: unknown): value is VisualEditorSelection {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<VisualEditorSelection>;
  return Number.isSafeInteger(candidate.anchor) && Number.isSafeInteger(candidate.head);
}

function clampSelection(
  selection: VisualEditorSelection,
  documentLength: number,
): VisualEditorSelection {
  return {
    anchor: clampInteger(selection.anchor, 0, documentLength),
    head: clampInteger(selection.head, 0, documentLength),
  };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : minimum;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing visual editor element #${id}.`);
  }
  return element as T;
}

function post(message: VisualEditorWebviewMessage): void {
  vscode.postMessage(message);
}
