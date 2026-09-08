/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import {
  pickedCompletion,
  snippet,
  type Completion,
} from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { indentService, indentUnit, matchBrackets } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  RangeSet,
  RangeValue,
  Transaction,
  type AnnotationType,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  innermostLatexMathRegion,
  planVisualEnvironmentNameSync,
} from "./core/visualEditing";
import {
  latexDelimiterPairAt,
  latexDelimiterTokenOverlaps,
  scanLatexDelimiterPairs,
  type LatexDelimiterScan,
} from "./core/latexDelimiterMatcher";
import { scanLatexSegment } from "./core/latexScanner";
import type { VisualEditorSelection } from "./visualEditorProtocol";

/**
 * Choose the first CodeMirror selection without letting a stale Webview restore
 * override an explicit external `file.tex:line` request.
 *
 * Ordinary tab restoration still prefers the persisted caret. A forced open is
 * different: its requested selection represents the action that opened this
 * Webview and therefore has to win on the very first frame.
 */
export function visualInitialSelectionCandidate(
  persisted: VisualEditorSelection | undefined,
  requested: VisualEditorSelection | undefined,
  explicitRequest: boolean,
): VisualEditorSelection {
  return explicitRequest
    ? requested ?? persisted ?? { anchor: 0, head: 0 }
    : persisted ?? requested ?? { anchor: 0, head: 0 };
}

export interface CodeMirrorSnippetTarget {
  readonly state: EditorState;
  dispatch(transaction: Transaction): void;
}

export interface AtomicCodeMirrorSnippetOptions {
  readonly template: string;
  readonly completion: Completion | null;
  readonly from: number;
  readonly to: number;
  readonly openBraceMarker: string;
  readonly closeBraceMarker: string;
  /** Changes applied before the snippet. Their offsets use the target's current document. */
  readonly prefixChanges?: readonly {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
  }[];
  /**
   * Preserve CodeMirror's selection as a synthetic field when the template
   * contains only a final cursor. Real snippets need this for nested Tab
   * traversal; literal completion values deliberately opt out so they cannot
   * leave a zero-width snippet frame behind.
   */
  readonly retainLoneFinalCursor?: boolean;
}

export interface AtomicCodeMirrorSnippetResult {
  /** Final changes in the target document's pre-transaction coordinates. */
  readonly changes: readonly {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
  }[];
  /** Absolute post-transaction ranges for every snippet field. */
  readonly fields: readonly AtomicCodeMirrorSnippetField[];
  /** Absolute post-transaction position immediately after the whole snippet. */
  readonly exit: number;
}

export interface AtomicCodeMirrorSnippetField {
  readonly field: number;
  readonly from: number;
  readonly to: number;
}

export interface ChangedDocumentLineRange {
  readonly from: number;
  readonly to: number;
}

export interface ChangedDocumentLineFilter {
  readonly filterFrom: number;
  readonly filterTo: number;
  filter(from: number, to: number): boolean;
}

export interface VisualSelectionPresentationRange {
  readonly from: number;
  readonly to: number;
}

export interface VisualActiveBracketPair {
  readonly first: { readonly from: number; readonly to: number };
  readonly second: { readonly from: number; readonly to: number };
}

const visualLatexDelimiterScanCache = new WeakMap<Text, LatexDelimiterScan>();

function visualLatexDelimiterScan(state: EditorState): LatexDelimiterScan {
  const cached = visualLatexDelimiterScanCache.get(state.doc);
  if (cached !== undefined) {
    return cached;
  }
  const scan = scanLatexDelimiterPairs(state.doc.toString());
  visualLatexDelimiterScanCache.set(state.doc, scan);
  return scan;
}

/**
 * Resolve the LaTeX delimiter or literal bracket pair touching every empty
 * CodeMirror caret.
 *
 * Semantic LaTeX atoms win over the character immediately to their left. This
 * matters at boundaries such as `]\left(`, where a caret on the backslash must
 * select the scalable pair rather than the preceding square bracket. Ordinary
 * `()`, `[]`, and `{}` retain CodeMirror's own lookup order. The Webview paints
 * these ranges without adding mark decorations, keeping the Windows IME DOM
 * flat.
 */
export function visualActiveBracketPairs(
  state: EditorState,
): readonly VisualActiveBracketPair[] {
  const pairs = new Map<string, VisualActiveBracketPair>();
  const latexScan = visualLatexDelimiterScan(state);
  for (const selection of state.selection.ranges) {
    if (!selection.empty) {
      continue;
    }
    const head = selection.head;
    const latexMatch = latexDelimiterPairAt(latexScan, head);
    if (latexMatch.touched) {
      if (latexMatch.pair !== undefined) {
        const pair = latexMatch.pair;
        pairs.set(
          `${pair.first.from}:${pair.first.to}:${pair.second.from}:${pair.second.to}`,
          pair,
        );
      }
      // A malformed semantic token remains authoritative. Falling through to
      // the literal glyph inside `\left(` would claim an unrelated `)` and
      // falsely present half-written LaTeX as a valid structural pair.
      continue;
    }
    const match = matchBrackets(state, head, -1, {
      brackets: "()[]{}",
    }) ??
      (head > 0
        ? matchBrackets(state, head - 1, 1, { brackets: "()[]{}" })
        : null) ??
      matchBrackets(state, head, 1, { brackets: "()[]{}" }) ??
      (head < state.doc.length
        ? matchBrackets(state, head + 1, -1, { brackets: "()[]{}" })
        : null);
    if (!match?.matched || match.end === undefined) {
      continue;
    }
    if (
      latexDelimiterTokenOverlaps(latexScan, match.start.from, match.start.to) ||
      latexDelimiterTokenOverlaps(latexScan, match.end.from, match.end.to)
    ) {
      continue;
    }
    const [first, second] = match.start.from <= match.end.from
      ? [match.start, match.end]
      : [match.end, match.start];
    const pair = { first, second } as const;
    pairs.set(
      `${first.from}:${first.to}:${second.from}:${second.to}`,
      pair,
    );
  }
  return [...pairs.values()];
}

export class VisualSelectionPresentationRangeValue extends RangeValue {
  public override readonly startSide = 1;
  public override readonly endSide = -1;

  public constructor(public readonly identity: number) {
    super();
  }

  public override eq(other: RangeValue): boolean {
    return other instanceof VisualSelectionPresentationRangeValue &&
      other.identity === this.identity;
  }
}

export type VisualSelectionPresentationRangeSet =
  RangeSet<VisualSelectionPresentationRangeValue>;

/** Build a mappable interval index for selection-dependent visual widgets. */
export function buildVisualSelectionPresentationRangeSet(
  ranges: readonly VisualSelectionPresentationRange[],
): VisualSelectionPresentationRangeSet {
  return RangeSet.of(
    ranges
      .filter((range) => range.from >= 0 && range.from < range.to)
      .map((range, identity) =>
        new VisualSelectionPresentationRangeValue(identity).range(
          range.from,
          range.to,
        )
      ),
    true,
  );
}

/**
 * Identify only the hidden/source ranges whose presentation is affected by
 * the current selection. Moving the caret anywhere else keeps the same key and
 * can reuse the existing DecorationSets.
 */
export function visualSelectionPresentationKey(
  state: EditorState,
  ranges: VisualSelectionPresentationRangeSet,
): string {
  if (ranges.size === 0) {
    return "";
  }
  const identities = new Set<number>();
  for (const selection of state.selection.ranges) {
    ranges.between(selection.from, selection.to, (from, to, value) => {
      const touches = selection.empty
        ? selection.head > from && selection.head < to
        : selection.from < to && selection.to > from;
      if (touches) {
        identities.add(value.identity);
      }
    });
  }
  return [...identities].sort((left, right) => left - right).join(",");
}

export interface ProtectedFullwidthImeInsertion {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly cursor: number;
}

export interface VisualImeCompositionUpdatePlan {
  /** Current provisional composition range in the editor document. */
  readonly from: number;
  readonly to: number;
  /** Complete provisional string after this IME update. */
  readonly insert: string;
  readonly cursor: number;
  /** Whether CodeMirror's DOM-derived replacement produces the same document. */
  readonly reportedChangeIsSafe: boolean;
}

export interface VisualImeCompositionRange {
  readonly from: number;
  readonly to: number;
}

export type VisualImeCompositionInputIntent =
  | "deleteBackward"
  | "cancelComposition";

/**
 * Choose the source range owned by a newly starting IME composition.
 *
 * Chromium can broaden the live DOM selection around a replaced/decorated
 * formula immediately before `compositionstart`. CodeMirror may expose that
 * transient range through `state.selection`, even though the user's caret was
 * collapsed inside the formula one key event earlier. The last selection
 * captured against the same immutable document is therefore authoritative.
 *
 * A genuine user selection is preserved as well: the stable snapshot contains
 * that non-empty range, so normal Chinese replacement of selected prose still
 * works. Callers omit the stable range when its document snapshot no longer
 * matches the current document.
 */
export function resolveVisualImeCompositionStartRange(
  documentLength: number,
  currentFrom: number,
  currentTo: number,
  stableFrom?: number,
  stableTo?: number,
  pointerCaret?: number,
  nativeDomCaret?: number,
): VisualImeCompositionRange | undefined {
  const valid = (from: number | undefined, to: number | undefined):
    from is number =>
      Number.isSafeInteger(from) &&
      Number.isSafeInteger(to) &&
      from! >= 0 &&
      to! >= from! &&
      to! <= documentLength;

  // The last non-drag pointer position is captured before Windows IME is
  // allowed to mutate the contenteditable DOM. It is therefore the only
  // trustworthy point when both Chromium's live DOM selection and
  // CodeMirror's state selection temporarily describe the old decorated
  // formula range. Callers invalidate this snapshot on navigation, selection
  // changes, or any document transaction, so a supplied pointer is fresh.
  if (valid(pointerCaret, pointerCaret)) {
    return { from: pointerCaret, to: pointerCaret };
  }

  // The browser selection is sampled synchronously from compositionstart.
  // It is newer than CodeMirror's state selection in the usual source-click
  // race, but on some Chromium/IME combinations the DOM has already been
  // provisionally rewritten before compositionstart. It is consequently a
  // fallback behind the pre-composition pointer snapshot.
  if (valid(nativeDomCaret, nativeDomCaret)) {
    return { from: nativeDomCaret, to: nativeDomCaret };
  }

  if (valid(currentFrom, currentTo) && currentFrom === currentTo) {
    return { from: currentFrom, to: currentTo };
  }
  if (
    valid(stableFrom, stableTo) &&
    valid(currentFrom, currentTo) &&
    (
      (stableFrom === stableTo &&
        stableFrom >= currentFrom && stableFrom <= currentTo) ||
      (stableFrom < stableTo! &&
        stableFrom >= currentFrom && stableTo! <= currentTo)
    )
  ) {
    return { from: stableFrom, to: stableTo! };
  }
  if (valid(currentFrom, currentTo)) {
    // With no trustworthy selection evidence, insertion at the right edge is
    // lossless and matches the ordinary left-to-right caret position.
    return { from: currentTo, to: currentTo };
  }
  return undefined;
}

export function visualImeCompositionInputIntent(
  inputType: string | undefined,
  userEvent: string | undefined,
): VisualImeCompositionInputIntent | undefined {
  if (/^(?:deleteCompositionText|deleteByComposition)$/iu.test(inputType ?? "")) {
    return "cancelComposition";
  }
  if (
    /delete.*backward/iu.test(inputType ?? "") ||
    userEvent?.includes("delete.backward") === true
  ) {
    return "deleteBackward";
  }
  return undefined;
}

/**
 * Preserve a destructive IME intent until the corresponding CodeMirror input
 * transaction consumes it.
 *
 * Windows Pinyin may emit `beforeinput(deleteContentBackward)`, followed by a
 * regular `compositionupdate` / `beforeinput(insertCompositionText)`, before
 * CodeMirror's mutation observer reports the DOM change. The later insertion
 * notification must not erase the earlier Backspace intent, otherwise stale
 * composition text is allowed to reinsert the character that was just
 * deleted. Cancelling the composition is stronger than deleting one code
 * point, so it wins when both are observed in the same browser input cycle.
 */
export function mergeVisualImeCompositionInputIntent(
  pending: VisualImeCompositionInputIntent | undefined,
  inputType: string | undefined,
  userEvent: string | undefined,
): VisualImeCompositionInputIntent | undefined {
  const incoming = visualImeCompositionInputIntent(inputType, userEvent);
  if (pending === "cancelComposition" || incoming === "cancelComposition") {
    return "cancelComposition";
  }
  return incoming ?? pending;
}

function removeLastUnicodeCodePoint(value: string): string {
  if (value.length === 0) {
    return value;
  }
  const last = value.charCodeAt(value.length - 1);
  const remove = last >= 0xdc00 && last <= 0xdfff && value.length >= 2 &&
      value.charCodeAt(value.length - 2) >= 0xd800 &&
      value.charCodeAt(value.length - 2) <= 0xdbff
    ? 2
    : 1;
  return value.slice(0, value.length - remove);
}

const LATEX_STRUCTURE_CHARACTER = /[\\{}_^]/u;
const FULLWIDTH_ASCII_EQUIVALENT = new Map<string, string>([
  ["（", "("],
  ["）", ")"],
  ["［", "["],
  ["］", "]"],
  ["｛", "{"],
  ["｝", "}"],
  ["，", ","],
  ["．", "."],
  ["：", ":"],
  ["；", ";"],
  ["！", "!"],
  ["？", "?"],
]);

/**
 * Narrow a malformed Windows-IME replacement before it can erase LaTeX.
 *
 * A Windows IME commit may occasionally arrive with an input range covering
 * text that predates the active composition. When CodeMirror's real
 * selection is collapsed but that foreign range contains TeX structure, the
 * only safe interpretation is an insertion at the caret. A genuine selected
 * replacement is intentionally left to CodeMirror. If the IME did leave one
 * provisional ASCII punctuation character immediately before the caret, only
 * that character is replaced.
 */
export function planProtectedFullwidthImeInsertion(
  source: string,
  selectionFrom: number,
  selectionTo: number,
  inputFrom: number,
  inputTo: number,
  text: string,
): ProtectedFullwidthImeInsertion | undefined {
  if (
    selectionFrom !== selectionTo ||
    inputFrom < 0 ||
    inputTo <= inputFrom ||
    inputTo > source.length ||
    selectionTo < inputFrom ||
    selectionTo > inputTo ||
    text.length === 0 ||
    /[\r\n]/u.test(text) ||
    !LATEX_STRUCTURE_CHARACTER.test(source.slice(inputFrom, inputTo))
  ) {
    return undefined;
  }

  const caret = selectionTo;
  const provisional = FULLWIDTH_ASCII_EQUIVALENT.get(text);
  const provisionalFrom = provisional === undefined
    ? caret
    : caret - provisional.length;
  const replaceProvisional = provisional !== undefined &&
    provisionalFrom >= inputFrom &&
    source.slice(provisionalFrom, caret) === provisional &&
    !LATEX_STRUCTURE_CHARACTER.test(source.slice(provisionalFrom, caret));
  const from = replaceProvisional ? provisionalFrom : caret;
  return {
    from,
    to: caret,
    insert: text,
    cursor: from + text.length,
  };
}

/**
 * Constrain one native IME update to the range that was selected when the
 * composition started.
 *
 * Chromium normally reports the same local replacement that the IME exposes
 * through `CompositionEvent.data`. Around replaced visual decorations it may
 * instead diff a much larger DOM fragment and report that unrelated TeX
 * braces, environment delimiters, or line breaks disappeared. Applying that
 * broad replacement corrupts the source. The composition event still carries
 * the complete provisional text, so rebuild the one legitimate local edit and
 * let callers use the native transaction only when both documents agree.
 *
 * This does not filter Chinese text. Candidate updates, selection commits, and
 * selected-text replacement all remain ordinary replacements of the original
 * composition range. Only text outside that range is protected.
 */
export function planVisualImeCompositionUpdate(
  source: string,
  compositionFrom: number,
  compositionTo: number,
  inputFrom: number,
  inputTo: number,
  inputText: string,
  compositionText: string | undefined,
  inputIntent?: VisualImeCompositionInputIntent,
  options: { readonly finalCommit?: boolean } = {},
): VisualImeCompositionUpdatePlan | undefined {
  if (
    compositionFrom < 0 ||
    compositionTo < compositionFrom ||
    compositionTo > source.length ||
    inputFrom < 0 ||
    inputTo < inputFrom ||
    inputTo > source.length
  ) {
    return undefined;
  }

  const current = source.slice(compositionFrom, compositionTo);
  const nativeEditIsInsideComposition =
    inputFrom >= compositionFrom && inputTo <= compositionTo;
  const locallyReportedCandidate = nativeEditIsInsideComposition
    ? current.slice(0, inputFrom - compositionFrom) +
      inputText +
      current.slice(inputTo - compositionFrom)
    : undefined;

  let insert: string;
  if (inputIntent === "cancelComposition") {
    insert = "";
  } else if (
    inputIntent === "deleteBackward" &&
    (
      locallyReportedCandidate === undefined ||
      locallyReportedCandidate.length >= current.length
    )
  ) {
    // Microsoft Pinyin can consume Backspace itself while Chromium reports a
    // no-op replacement at the end of the provisional range. A no-op DOM diff
    // must still remove one logical code point from the candidate.
    insert = removeLastUnicodeCodePoint(current);
  } else if (options.finalCommit === true && compositionText !== undefined) {
    // Chromium/CodeMirror can emit one final compose-tagged insertion after
    // `compositionend`, even though the provisional candidate is already in
    // the document. Treat that event as the authoritative replacement for the
    // complete candidate, not as text appended to its end. This keeps a single
    // full-width punctuation commit idempotent and still replaces Pinyin such
    // as `ni` with the selected Chinese candidate `你`.
    insert = compositionText;
  } else if (locallyReportedCandidate !== undefined) {
    // A native edit wholly inside the currently tracked candidate is the most
    // precise signal available. In particular, Windows Pinyin can deliver the
    // Backspace DOM diff before its next `compositionupdate`, so eventText may
    // still contain the previous (longer) candidate. Preferring that stale
    // event text would immediately reinsert the deleted letter and make
    // Backspace appear broken.
    insert = locallyReportedCandidate;
  } else if (inputIntent === "deleteBackward") {
    // With replaced visual decorations Chromium can report Backspace as a
    // broad DOM replacement, while the latest compositionupdate still carries
    // the old (longer) candidate. Trust the deletion intent and the candidate
    // already stored in the document, otherwise the stale event text immediately
    // reinserts the deleted character and Backspace appears to do nothing.
    insert = removeLastUnicodeCodePoint(
      source.slice(compositionFrom, compositionTo),
    );
  } else if (compositionText !== undefined) {
    // Chromium occasionally reports a broad replacement around visual
    // decorations. Only in that malformed/broad case do we rebuild the local
    // candidate from CompositionEvent.data and discard the surrounding DOM
    // diff.
    insert = compositionText;
  } else {
    if (
      inputText.length <= 64 &&
      !/[\r\n]/u.test(inputText) &&
      !LATEX_STRUCTURE_CHARACTER.test(inputText)
    ) {
      // Some Windows IMEs omit compositionupdate for the first ASCII
      // provisional character. A short, structure-free insert is still safe
      // to place at the captured caret; a broad or structural fallback is not.
      insert = inputText;
    } else {
      return undefined;
    }
  }

  const expected = source.slice(0, compositionFrom) +
    insert +
    source.slice(compositionTo);
  const reported = source.slice(0, inputFrom) + inputText + source.slice(inputTo);
  return {
    from: compositionFrom,
    to: compositionTo,
    insert,
    cursor: compositionFrom + insert.length,
    reportedChangeIsSafe: expected === reported,
  };
}

/**
 * Decide whether an input transaction still belongs to an IME composition.
 *
 * CodeMirror's `view.composing` flag can remain true for a short time after the
 * browser has emitted `compositionend`. Ordinary letters and Backspace typed
 * during that settling window must not be routed through the stale candidate
 * range. The one final transaction explicitly marked as a compose event is
 * still protected.
 */
export function shouldProtectVisualImeInput(
  compositionActive: boolean,
  compositionDomEnded: boolean,
  viewComposing: boolean,
  userEvent: string | undefined,
): boolean {
  if (!compositionActive && !viewComposing) {
    return false;
  }
  if (!compositionDomEnded) {
    return true;
  }
  return userEvent?.includes("compose") === true;
}

/**
 * Return the complete post-transaction logical lines touched by a document
 * edit.  Native TextMate decorations describe the old snapshot.  Keeping a
 * mapped, broad prose decoration over newly typed LaTeX would force the new
 * command to inherit that prose colour and hide CodeMirror's live fallback
 * highlighting, so callers can invalidate exactly these lines while retaining
 * the exact native theme tokens everywhere else.
 */
export function changedDocumentLineRanges(
  transaction: Transaction,
): readonly ChangedDocumentLineRange[] {
  if (!transaction.docChanged) {
    return [];
  }

  const document = transaction.state.doc;
  const ranges: ChangedDocumentLineRange[] = [];
  transaction.changes.iterChanges(
    (_fromA, _toA, fromB, toB) => {
      const start = document.lineAt(Math.max(0, Math.min(document.length, fromB)));
      const end = document.lineAt(Math.max(0, Math.min(document.length, toB)));
      ranges.push({ from: start.from, to: end.to });
    },
    true,
  );
  ranges.sort((left, right) => left.from - right.from || left.to - right.to);

  const merged: ChangedDocumentLineRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous === undefined || range.from > previous.to) {
      merged.push(range);
      continue;
    }
    if (range.to > previous.to) {
      merged[merged.length - 1] = { from: previous.from, to: range.to };
    }
  }
  return merged;
}

/**
 * Build a range-bounded filter for stale decorations on edited logical lines.
 *
 * RangeSet.update otherwise invokes its filter for every decoration in the
 * document. A long paper can contain tens of thousands of native TextMate
 * tokens, so doing that on every keystroke blocks the Webview main thread and
 * delays Math Preview even though only one line changed. `filterFrom` and
 * `filterTo` let CodeMirror copy untouched chunks without visiting each token.
 */
export function changedDocumentLineFilter(
  ranges: readonly ChangedDocumentLineRange[],
): ChangedDocumentLineFilter | undefined {
  const first = ranges[0];
  const last = ranges.at(-1);
  if (first === undefined || last === undefined) {
    return undefined;
  }
  return {
    filterFrom: first.from,
    filterTo: last.to,
    filter(from, to) {
      return !ranges.some((line) => line.from === line.to
        ? from <= line.from && to >= line.to
        : from < line.to && to > line.from);
    },
  };
}

/**
 * Insert exactly one apostrophe in mathematical source. CodeMirror's default
 * closeBrackets extension treats a single quote as a prose quote pair; in TeX
 * math it is instead a prime token and each physical key press must contribute
 * exactly one character.
 */
export function insertLiteralMathApostrophe(
  target: CodeMirrorSnippetTarget,
): boolean {
  const state = target.state;
  const source = state.doc.toString();
  if (state.selection.ranges.some((range) => {
    const region = innermostLatexMathRegion(source, range.head);
    return region === undefined ||
      range.from < region.innerStart ||
      range.to > region.innerEnd;
  })) {
    return false;
  }
  const changed = state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: "'" },
    range: EditorSelection.cursor(range.from + 1),
  }));
  target.dispatch(state.update({
    changes: changed.changes,
    selection: changed.selection,
    userEvent: "input.type",
  }));
  return true;
}

/**
 * Keep the names of a structurally paired LaTeX environment in one atomic
 * CodeMirror transaction. Since the mirror is appended by a transaction
 * filter, one Undo/Redo operation always restores both boundaries together.
 */
export function visualEnvironmentNameSyncExtension(
  ignoredAnnotation?: AnnotationType<boolean>,
): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (
      !transaction.docChanged ||
      transaction.isUserEvent("input.type.compose") ||
      (ignoredAnnotation !== undefined &&
        transaction.annotation(ignoredAnnotation) === true)
    ) {
      return transaction;
    }
    const changedRanges: Array<{ start: number; end: number }> = [];
    let mayTouchEnvironmentName = false;
    transaction.changes.iterChanges(
      (fromA, toA, fromB, toB) => {
        changedRanges.push({ start: fromB, end: toB });
        mayTouchEnvironmentName ||=
          visualEnvironmentNameTouchesDocumentRange(
            transaction.startState.doc,
            fromA,
            toA,
          ) ||
          visualEnvironmentNameTouchesDocumentRange(
            transaction.newDoc,
            fromB,
            toB,
          );
      },
      true,
    );
    // Nearly every ordinary keystroke is prose or mathematics, not an edit to
    // a `\\begin{...}`/`\\end{...}` name. Avoid materialising and scanning the
    // complete CodeMirror document unless a bounded old/new window can
    // actually contain such a boundary. The old window is essential for
    // deletions that remove the command itself.
    if (!mayTouchEnvironmentName) {
      return transaction;
    }
    const mirrorChanges = planVisualEnvironmentNameSync(
      transaction.newDoc.toString(),
      changedRanges,
    );
    return mirrorChanges.length === 0
      ? transaction
      : [
          transaction,
          {
            changes: mirrorChanges,
            sequential: true,
          },
        ];
  });
}

const VISUAL_ENVIRONMENT_NAME_MAX_LENGTH = 128;
const VISUAL_ENVIRONMENT_GUARD_MAX_CHANGE_LENGTH = 4_096;
const VISUAL_ENVIRONMENT_NAME_PATTERN = /^[A-Za-z0-9@*:_-]{0,128}$/u;
const VISUAL_ENVIRONMENT_COMMAND_SUFFIX_PATTERN = /\\(?:begin|end)$/u;
const VISUAL_ENVIRONMENT_WHITESPACE_CHUNK_LENGTH = 256;

/**
 * Cheaply decide whether one CodeMirror change can touch a real environment
 * name. A nearby `\\begin`/`\\end` is not enough: short theorem/list bodies
 * often keep both commands within a few hundred characters of every keystroke,
 * and treating proximity as a hit restores the full-document scan this guard
 * is meant to avoid.
 *
 * Environment names are bounded to 128 characters by the structural planner,
 * so only a small window around an ordinary edit needs to be inspected. The
 * command itself is resolved backwards from the opening brace. That backwards
 * walk deliberately accepts arbitrary same-line spaces/tabs, matching
 * `scanVisualEnvironmentTokens` rather than imposing a fixed scan radius.
 */
export function visualEnvironmentNameTouchesDocumentRange(
  document: Text,
  requestedFrom: number,
  requestedTo: number,
): boolean {
  const requestedStart = Math.min(requestedFrom, requestedTo);
  const requestedEnd = Math.max(requestedFrom, requestedTo);
  const rangeFrom = Math.max(
    0,
    Math.min(document.length, Math.trunc(requestedStart)),
  );
  const rangeTo = Math.max(
    rangeFrom,
    Math.min(document.length, Math.trunc(requestedEnd)),
  );
  if (rangeTo - rangeFrom > VISUAL_ENVIRONMENT_GUARD_MAX_CHANGE_LENGTH) {
    // Large replacements are uncommon and may contain several complete
    // commands. Conservatively run the authoritative planner for them.
    return true;
  }

  const scanFrom = Math.max(
    0,
    rangeFrom - VISUAL_ENVIRONMENT_NAME_MAX_LENGTH - 1,
  );
  const scanTo = Math.min(
    document.length,
    rangeTo + VISUAL_ENVIRONMENT_NAME_MAX_LENGTH + 1,
  );
  const local = document.sliceString(scanFrom, scanTo);
  let openingOffset = local.indexOf("{");
  while (openingOffset >= 0) {
    const closingOffset = local.indexOf("}", openingOffset + 1);
    if (
      closingOffset >= 0 &&
      closingOffset - openingOffset - 1 <= VISUAL_ENVIRONMENT_NAME_MAX_LENGTH
    ) {
      const name = local.slice(openingOffset + 1, closingOffset);
      if (VISUAL_ENVIRONMENT_NAME_PATTERN.test(name)) {
        const opening = scanFrom + openingOffset;
        const nameFrom = opening + 1;
        const nameTo = scanFrom + closingOffset;
        const touchesName = rangeFrom === rangeTo
          ? rangeFrom >= nameFrom && rangeFrom <= nameTo
          : rangeFrom <= nameTo && rangeTo >= nameFrom;
        if (
          touchesName &&
          visualEnvironmentCommandPrecedesBrace(document, opening)
        ) {
          return true;
        }
      }
    }
    openingOffset = local.indexOf("{", openingOffset + 1);
  }
  return false;
}

function visualEnvironmentCommandPrecedesBrace(
  document: Text,
  opening: number,
): boolean {
  const lineFrom = document.lineAt(opening).from;
  let cursor = opening;
  while (cursor > lineFrom) {
    const chunkFrom = Math.max(
      lineFrom,
      cursor - VISUAL_ENVIRONMENT_WHITESPACE_CHUNK_LENGTH,
    );
    const chunk = document.sliceString(chunkFrom, cursor);
    let offset = chunk.length;
    while (offset > 0 && /[ \t]/u.test(chunk[offset - 1] ?? "")) {
      offset -= 1;
    }
    cursor = chunkFrom + offset;
    if (offset > 0) {
      break;
    }
  }
  const commandFrom = Math.max(lineFrom, cursor - "\\begin".length);
  return VISUAL_ENVIRONMENT_COMMAND_SUFFIX_PATTERN.test(
    document.sliceString(commandFrom, cursor),
  );
}

/**
 * Reconcile a paired environment once an IME composition has committed.
 *
 * Mirroring a distant `\\end{...}` while Chromium still owns a native
 * composition range can make it rebuild the composing DOM and apply the next
 * candidate replacement to stale offsets.  The transaction filter above
 * therefore leaves composition transactions alone.  This function performs
 * the same structural mirror exactly once after `compositionend`.
 */
export function synchronizeVisualEnvironmentNamesAfterComposition(
  target: CodeMirrorSnippetTarget,
  beforeText: string,
): boolean {
  const source = target.state.doc.toString();
  if (source === beforeText) {
    return false;
  }
  const changedRange = changedRangeBetweenTexts(beforeText, source);
  const mirrorChanges = planVisualEnvironmentNameSync(source, [changedRange]);
  if (mirrorChanges.length === 0) {
    return false;
  }
  target.dispatch(target.state.update({
    changes: mirrorChanges,
    userEvent: "input.type.compose",
  }));
  return true;
}

function changedRangeBetweenTexts(
  beforeText: string,
  afterText: string,
): { readonly start: number; readonly end: number } {
  const prefixLimit = Math.min(beforeText.length, afterText.length);
  let prefix = 0;
  while (prefix < prefixLimit && beforeText[prefix] === afterText[prefix]) {
    prefix += 1;
  }
  const suffixLimit = Math.min(
    beforeText.length - prefix,
    afterText.length - prefix,
  );
  let suffix = 0;
  while (
    suffix < suffixLimit &&
    beforeText[beforeText.length - 1 - suffix] ===
      afterText[afterText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    start: prefix,
    end: Math.max(prefix, afterText.length - suffix),
  };
}

/**
 * Keep environment and display-math bodies one editor indentation unit deeper
 * than their opener, and align a closing boundary with that opener. All other
 * lines defer to CodeMirror's language indentation service.
 */
export function visualLatexEnvironmentIndentationExtension(): Extension {
  return indentService.of((context, pos) => {
    const line = context.lineAt(pos, 1);
    const scanTo = Math.max(0, Math.min(context.state.doc.length, line.from));
    const scanState = scanLatexSegment(
      context.state.doc.sliceString(0, scanTo),
    );
    const trimmedLine = line.text.trimStart();
    const environmentName = /^\\end\s*\{([^{}]+)\}/u.exec(trimmedLine)?.[1]?.trim();

    if (scanState.verbatimEnvironment !== undefined) {
      // Opaque environments own literal whitespace. Preserve the preceding
      // physical line's indentation instead of adding a structural level.
      return line.from > 0
        ? context.lineIndent(context.lineAt(line.from - 1, -1).from)
        : undefined;
    }

    if (environmentName !== undefined) {
      const opener = [...scanState.environments]
        .reverse()
        .find((frame) => frame.name === environmentName);
      if (opener !== undefined) {
        return context.lineIndent(opener.startOffset);
      }
    }

    const delimiter = scanState.delimiter;
    if (delimiter?.kind === "bracket") {
      const openerIndent = context.lineIndent(delimiter.startOffset);
      return /^\\\]/u.test(trimmedLine)
        ? openerIndent
        : openerIndent + context.unit;
    }
    if (delimiter?.kind === "dollar-block") {
      const openerIndent = context.lineIndent(delimiter.startOffset);
      return /^\$\$/u.test(trimmedLine)
        ? openerIndent
        : openerIndent + context.unit;
    }

    const active = [...scanState.environments]
      .reverse()
      .find((frame) => normalizeIndentEnvironmentName(frame.name) !== "document");
    if (active !== undefined) {
      return context.lineIndent(active.startOffset) + context.unit;
    }

    // The document wrapper is structural, not a visible indentation level.
    const document = [...scanState.environments]
      .reverse()
      .find((frame) => normalizeIndentEnvironmentName(frame.name) === "document");
    return document === undefined
      ? undefined
      : context.lineIndent(document.startOffset);
  });
}

function normalizeIndentEnvironmentName(name: string): string {
  return name.endsWith("*") ? name.slice(0, -1) : name;
}

/**
 * Apply a CodeMirror snippet and restore TeX brace markers in one transaction.
 *
 * CodeMirror's snippet parser needs private-use characters in place of literal
 * LaTeX braces so that field ranges remain correct. Restoring those characters
 * in a follow-up transaction creates a second history event: one Ctrl+Z then
 * removes the command but leaves `{}` behind. This adapter intercepts the
 * transaction generated by `snippet()`, replaces markers in its inserted text,
 * and dispatches a single isolated transaction containing the final LaTeX,
 * selection, and active snippet-field effects.
 */
export function applyAtomicCodeMirrorSnippet(
  target: CodeMirrorSnippetTarget,
  options: AtomicCodeMirrorSnippetOptions,
): AtomicCodeMirrorSnippetResult {
  validateMarkerPair(options.openBraceMarker, options.closeBraceMarker);
  const startState = target.state;
  const prefixChanges = startState.changes(options.prefixChanges ?? []);
  const snippetState = prefixChanges.empty
    ? startState
    : startState.update({ changes: prefixChanges }).state;
  const snippetTemplate = locallyIndentedSnippetTemplate(
    snippetState,
    options.from,
    options.template,
    options.openBraceMarker,
    options.closeBraceMarker,
  );
  let dispatched = false;
  let appliedChanges: AtomicCodeMirrorSnippetResult["changes"] | undefined;
  let appliedFields: readonly AtomicCodeMirrorSnippetField[] = [];
  let appliedExit: number | undefined;

  const adapter: CodeMirrorSnippetTarget = {
    state: snippetState,
    dispatch(transaction) {
      if (dispatched) {
        throw new Error("CodeMirror snippet dispatched more than one transaction.");
      }
      if (transaction.startState !== snippetState) {
        throw new Error("CodeMirror snippet transaction used an unexpected state.");
      }
      dispatched = true;

      const restoredSpecs: { from: number; to: number; insert: string }[] = [];
      transaction.changes.iterChanges(
        (fromA, toA, _fromB, toB, inserted) => {
          appliedExit = Math.max(appliedExit ?? 0, toB);
          restoredSpecs.push({
            from: fromA,
            to: toA,
            insert: restoreSnippetBraceMarkers(
              inserted.toString(),
              options.openBraceMarker,
              options.closeBraceMarker,
            ),
          });
        },
        true,
      );
      const restoredSnippetChanges = snippetState.changes(restoredSpecs);
      const combinedChanges = prefixChanges.empty
        ? restoredSnippetChanges
        : prefixChanges.compose(restoredSnippetChanges);
      const picked = transaction.annotation(pickedCompletion);
      const userEvent = transaction.annotation(Transaction.userEvent) ?? "input.complete";
      const annotations = [
        Transaction.userEvent.of(userEvent),
        isolateHistory.of("full"),
        ...(picked === undefined ? [] : [pickedCompletion.of(picked)]),
      ];

      const finalChanges: {
        from: number;
        to: number;
        insert: string;
      }[] = [];
      combinedChanges.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        finalChanges.push({ from: fromA, to: toA, insert: inserted.toString() });
      }, true);
      appliedChanges = finalChanges;
      appliedFields = snippetFieldsFromEffects(transaction.effects);
      if (
        appliedFields.length === 0 &&
        options.retainLoneFinalCursor !== false
      ) {
        // CodeMirror treats a lone final tabstop (`${0}`) as the completion
        // cursor and therefore omits ActiveSnippet state entirely. Retain that
        // selection as one field so a child such as `\(@0\)` can still leave
        // itself before its enclosing theorem/environment advances.
        appliedFields = transaction.newSelection.ranges.map((range) => ({
          field: 0,
          from: range.from,
          to: range.to,
        }));
      }

      target.dispatch(startState.update({
        changes: combinedChanges,
        selection: transaction.newSelection,
        effects: transaction.effects,
        annotations,
        scrollIntoView: transaction.scrollIntoView,
      }));
    },
  };

  snippet(snippetTemplate)(
    adapter,
    options.completion,
    options.from,
    options.to,
  );
  if (!dispatched) {
    throw new Error("CodeMirror snippet did not dispatch its transaction.");
  }
  if (appliedChanges === undefined) {
    throw new Error("CodeMirror snippet did not expose its applied changes.");
  }
  if (appliedExit === undefined) {
    throw new Error("CodeMirror snippet did not expose its exit position.");
  }
  return { changes: appliedChanges, fields: appliedFields, exit: appliedExit };
}

/**
 * Normalize a balanced multiline environment snippet relative to the source
 * line where it is inserted. The transformation happens before CodeMirror
 * computes snippet fields, so field geometry and the complete formatted
 * insertion remain one atomic Undo/Redo event.
 */
export function indentLatexEnvironmentSnippetTemplate(
  template: string,
  unit: string,
  openBraceMarker: string,
  closeBraceMarker: string,
): string {
  validateMarkerPair(openBraceMarker, closeBraceMarker);
  const eol = template.includes("\r\n") ? "\r\n" : "\n";
  if (!template.includes(eol)) {
    return template;
  }
  const lines = template.split(eol);
  const structural = lines.map((line) =>
    latexEnvironmentCommandsInSnippetLine(
      restoreSnippetBraceMarkers(line, openBraceMarker, closeBraceMarker),
    )
  );
  const beginCount = structural.reduce(
    (total, commands) => total + commands.filter((command) => command === "begin").length,
    0,
  );
  const endCount = structural.reduce(
    (total, commands) => total + commands.filter((command) => command === "end").length,
    0,
  );
  if (beginCount === 0 || beginCount !== endCount) {
    return template;
  }

  let depth = 0;
  const normalized = lines.map((line, index) => {
    const content = line.replace(/^[\t ]+/u, "");
    const restored = restoreSnippetBraceMarkers(
      content,
      openBraceMarker,
      closeBraceMarker,
    );
    const closesBeforeContent = /^\\end\s*\{/u.test(restored) ? 1 : 0;
    const lineDepth = Math.max(0, depth - closesBeforeContent);
    // CodeMirror's snippet() adds the insertion line's existing indentation to
    // every continuation line. Emit only the environment-relative part here;
    // including the base indentation would double it in nested environments.
    const prefix = index === 0 || content.length === 0
      ? ""
      : unit.repeat(lineDepth);
    const commands = structural[index] ?? [];
    depth = Math.max(
      0,
      depth + commands.filter((command) => command === "begin").length -
        commands.filter((command) => command === "end").length,
    );
    return `${prefix}${content}`;
  });
  return normalized.join(eol);
}

function locallyIndentedSnippetTemplate(
  state: EditorState,
  from: number,
  template: string,
  openBraceMarker: string,
  closeBraceMarker: string,
): string {
  const safeFrom = Math.max(0, Math.min(from, state.doc.length));
  const line = state.doc.lineAt(safeFrom);
  const prefixBeforeTrigger = line.text.slice(0, safeFrom - line.from);
  if (!/^[\t ]*$/u.test(prefixBeforeTrigger)) {
    return template;
  }
  return indentLatexEnvironmentSnippetTemplate(
    template,
    state.facet(indentUnit),
    openBraceMarker,
    closeBraceMarker,
  );
}

function latexEnvironmentCommandsInSnippetLine(
  value: string,
): readonly ("begin" | "end")[] {
  const comment = unescapedSnippetCommentOffset(value);
  const source = comment < 0 ? value : value.slice(0, comment);
  const commands: ("begin" | "end")[] = [];
  const pattern = /\\(begin|end)\s*\{/gu;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    let precedingBackslashes = 0;
    for (let index = match.index - 1; index >= 0 && source[index] === "\\"; index -= 1) {
      precedingBackslashes += 1;
    }
    if (precedingBackslashes % 2 === 0) {
      commands.push(match[1] as "begin" | "end");
    }
  }
  return commands;
}

function unescapedSnippetCommentOffset(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "%") {
      continue;
    }
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) {
      return index;
    }
  }
  return -1;
}

/**
 * CodeMirror deliberately keeps its active-snippet state private, but the
 * snippet transaction exposes the complete post-insertion field geometry in
 * the `setActive` effect. Capture that geometry structurally so the visual
 * editor can maintain a stack when a snippet is triggered inside another
 * snippet. This does not depend on the private StateField identity or mutate
 * CodeMirror's effect value.
 */
function snippetFieldsFromEffects(
  effects: readonly { readonly value: unknown }[],
): readonly AtomicCodeMirrorSnippetField[] {
  for (const effect of effects) {
    const value = effect.value;
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const candidate = value as {
      readonly active?: unknown;
      readonly ranges?: unknown;
    };
    if (!Number.isSafeInteger(candidate.active) || !Array.isArray(candidate.ranges)) {
      continue;
    }
    const fields: AtomicCodeMirrorSnippetField[] = [];
    let valid = true;
    for (const range of candidate.ranges) {
      if (typeof range !== "object" || range === null) {
        valid = false;
        break;
      }
      const field = (range as { readonly field?: unknown }).field;
      const from = (range as { readonly from?: unknown }).from;
      const to = (range as { readonly to?: unknown }).to;
      if (
        !Number.isSafeInteger(field) ||
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        (field as number) < 0 ||
        (from as number) < 0 ||
        (to as number) < (from as number)
      ) {
        valid = false;
        break;
      }
      fields.push({
        field: field as number,
        from: from as number,
        to: to as number,
      });
    }
    if (valid && fields.length > 0) {
      return fields;
    }
  }
  return [];
}

export function restoreSnippetBraceMarkers(
  value: string,
  openBraceMarker: string,
  closeBraceMarker: string,
): string {
  validateMarkerPair(openBraceMarker, closeBraceMarker);
  return value
    .replaceAll(openBraceMarker, "{")
    .replaceAll(closeBraceMarker, "}");
}

function validateMarkerPair(openBraceMarker: string, closeBraceMarker: string): void {
  if (
    openBraceMarker.length !== 1 ||
    closeBraceMarker.length !== 1 ||
    openBraceMarker === closeBraceMarker
  ) {
    throw new Error("CodeMirror snippet brace markers must be distinct characters.");
  }
}
