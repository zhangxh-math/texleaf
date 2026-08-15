import * as vscode from "vscode";
import { isSupportedDocument, readConfig } from "./config";
import { scanLatexRegions } from "./core/latexScanner";

const DEPTH_COUNT = 3;
const STANDARD_DEBOUNCE_MS = 45;
const LARGE_DOCUMENT_DEBOUNCE_MS = 180;
const LARGE_DOCUMENT_LINE_COUNT = 4_000;

const OPEN_TO_CLOSE = {
  "(": ")",
  "[": "]",
  "{": "}",
} as const;

type OpenBracket = keyof typeof OPEN_TO_CLOSE;
type CloseBracket = (typeof OPEN_TO_CLOSE)[OpenBracket];

interface BracketFrame {
  readonly character: OpenBracket;
  readonly offset: number;
  readonly depth: number;
}

interface BracketPair {
  readonly openOffset: number;
  readonly closeOffset: number;
  readonly depth: number;
}

interface MutableInterval {
  start: number;
  end: number;
}

interface DecorationSnapshot {
  readonly document: vscode.TextDocument;
  readonly version: number;
  readonly pairs: readonly BracketPair[];
  readonly pairByOffset: ReadonlyMap<number, BracketPair>;
  readonly rangesByDepth: readonly (readonly vscode.Range[])[];
}

const EMPTY_RANGES: readonly vscode.Range[] = [];

const DEPTH_COLORS = [
  { light: "#005fb8", dark: "#4fc1ff" },
  { light: "#9a4d00", dark: "#ffb454" },
  { light: "#8b2aa9", dark: "#d670d6" },
] as const;

/**
 * Owns bracket decoration types and applies them on demand.
 *
 * The extension entry point is responsible for forwarding editor, document,
 * selection, and configuration changes through schedule() or refresh(). This
 * class deliberately does not register global VS Code listeners of its own.
 */
export class BracketDecorationController implements vscode.Disposable {
  private readonly depthDecorations: readonly vscode.TextEditorDecorationType[];
  private readonly activePairDecoration: vscode.TextEditorDecorationType;

  private scheduledRefresh: ReturnType<typeof setTimeout> | undefined;
  private scheduledEditor: vscode.TextEditor | undefined;
  private snapshot: DecorationSnapshot | undefined;
  private disposed = false;

  public constructor() {
    this.depthDecorations = DEPTH_COLORS.map(({ light, dark }) =>
      vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
        light: { color: light },
        dark: { color: dark },
      }),
    );

    this.activePairDecoration = vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
      fontWeight: "bold",
      borderRadius: "2px",
      light: {
        backgroundColor: "rgba(255, 196, 0, 0.22)",
        outline: "1px solid #8a5a00",
      },
      dark: {
        backgroundColor: "rgba(255, 214, 64, 0.20)",
        outline: "1px solid #ffd75e",
      },
    });
  }

  /** Debounce a refresh for the active editor, with extra time for large files. */
  public schedule(editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor): void {
    if (this.disposed || editor === undefined || editor !== vscode.window.activeTextEditor) {
      return;
    }

    this.cancelScheduledRefresh();
    this.scheduledEditor = editor;
    const delay =
      editor.document.lineCount >= LARGE_DOCUMENT_LINE_COUNT
        ? LARGE_DOCUMENT_DEBOUNCE_MS
        : STANDARD_DEBOUNCE_MS;

    this.scheduledRefresh = setTimeout(() => {
      const scheduledEditor = this.scheduledEditor;
      this.scheduledRefresh = undefined;
      this.scheduledEditor = undefined;
      this.refresh(scheduledEditor);
    }, delay);
  }

  /** Immediately recompute and apply decorations to the active editor. */
  public refresh(editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor): void {
    if (this.disposed || editor === undefined || editor !== vscode.window.activeTextEditor) {
      return;
    }

    this.cancelScheduledRefresh();
    const config = readConfig(editor.document.uri);
    if (!isSupportedDocument(editor.document, config)) {
      this.clear(editor);
      return;
    }

    if (!config.colorizeBrackets && !config.highlightActiveBracketPair) {
      this.clear(editor);
      return;
    }

    const snapshot = this.getSnapshot(editor.document);
    for (const [depth, decoration] of this.depthDecorations.entries()) {
      editor.setDecorations(
        decoration,
        config.colorizeBrackets
          ? (snapshot.rangesByDepth[depth] ?? EMPTY_RANGES)
          : EMPTY_RANGES,
      );
    }

    editor.setDecorations(
      this.activePairDecoration,
      config.highlightActiveBracketPair
        ? activePairRanges(editor, snapshot)
        : EMPTY_RANGES,
    );
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelScheduledRefresh();
    this.snapshot = undefined;
    for (const decoration of this.depthDecorations) {
      decoration.dispose();
    }
    this.activePairDecoration.dispose();
  }

  private getSnapshot(document: vscode.TextDocument): DecorationSnapshot {
    if (
      this.snapshot !== undefined &&
      this.snapshot.document === document &&
      this.snapshot.version === document.version
    ) {
      return this.snapshot;
    }

    const text = document.getText();
    const pairs = collectBracketPairs(text);
    const pairByOffset = new Map<number, BracketPair>();
    const rangesByDepth: vscode.Range[][] = Array.from(
      { length: DEPTH_COUNT },
      () => [],
    );

    for (const pair of pairs) {
      pairByOffset.set(pair.openOffset, pair);
      pairByOffset.set(pair.closeOffset, pair);
      const ranges = rangesByDepth[pair.depth % DEPTH_COUNT];
      if (ranges === undefined) {
        continue;
      }
      ranges.push(offsetRange(document, pair.openOffset));
      ranges.push(offsetRange(document, pair.closeOffset));
    }

    this.snapshot = {
      document,
      version: document.version,
      pairs,
      pairByOffset,
      rangesByDepth,
    };
    return this.snapshot;
  }

  private clear(editor: vscode.TextEditor): void {
    for (const decoration of this.depthDecorations) {
      editor.setDecorations(decoration, EMPTY_RANGES);
    }
    editor.setDecorations(this.activePairDecoration, EMPTY_RANGES);
  }

  private cancelScheduledRefresh(): void {
    if (this.scheduledRefresh !== undefined) {
      clearTimeout(this.scheduledRefresh);
      this.scheduledRefresh = undefined;
    }
    this.scheduledEditor = undefined;
  }
}

function collectBracketPairs(text: string): readonly BracketPair[] {
  const pairs: BracketPair[] = [];
  for (const interval of mathIntervals(text)) {
    const stack: BracketFrame[] = [];
    for (let offset = interval.start; offset < interval.end; offset += 1) {
      const character = text[offset];
      if (isOpenBracket(character)) {
        stack.push({
          character,
          offset,
          depth: stack.length,
        });
        continue;
      }

      if (!isCloseBracket(character)) {
        continue;
      }
      const open = stack[stack.length - 1];
      if (open === undefined || OPEN_TO_CLOSE[open.character] !== character) {
        continue;
      }

      stack.pop();
      pairs.push({
        openOffset: open.offset,
        closeOffset: offset,
        depth: open.depth,
      });
    }
  }
  return pairs;
}

/** Merge overlapping math regions so nested math environments are scanned once. */
function mathIntervals(text: string): readonly MutableInterval[] {
  const candidates = scanLatexRegions(text)
    .map((region) => ({
      start: Math.max(0, Math.min(region.innerStart, text.length)),
      end: Math.max(0, Math.min(region.innerEnd, text.length)),
    }))
    .filter((interval) => interval.start < interval.end)
    .sort((left, right) => left.start - right.start || right.end - left.end);

  const merged: MutableInterval[] = [];
  for (const candidate of candidates) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && candidate.start < previous.end) {
      previous.end = Math.max(previous.end, candidate.end);
    } else {
      merged.push({ ...candidate });
    }
  }
  return merged;
}

function activePairRanges(
  editor: vscode.TextEditor,
  snapshot: DecorationSnapshot,
): readonly vscode.Range[] {
  const activePairs = new Map<number, BracketPair>();
  for (const selection of editor.selections) {
    const cursorOffset = editor.document.offsetAt(selection.active);
    const pair = adjacentPair(cursorOffset, snapshot.pairByOffset) ??
      innermostEnclosingPair(cursorOffset, snapshot.pairs);
    if (pair !== undefined) {
      activePairs.set(pair.openOffset, pair);
    }
  }

  const ranges: vscode.Range[] = [];
  for (const pair of activePairs.values()) {
    ranges.push(offsetRange(editor.document, pair.openOffset));
    ranges.push(offsetRange(editor.document, pair.closeOffset));
  }
  return ranges;
}

function adjacentPair(
  cursorOffset: number,
  pairByOffset: ReadonlyMap<number, BracketPair>,
): BracketPair | undefined {
  if (cursorOffset > 0) {
    const preceding = pairByOffset.get(cursorOffset - 1);
    if (preceding !== undefined) {
      return preceding;
    }
  }
  return pairByOffset.get(cursorOffset);
}

function innermostEnclosingPair(
  cursorOffset: number,
  pairs: readonly BracketPair[],
): BracketPair | undefined {
  let result: BracketPair | undefined;
  for (const pair of pairs) {
    if (pair.openOffset >= cursorOffset || cursorOffset > pair.closeOffset) {
      continue;
    }
    if (
      result === undefined ||
      pair.openOffset > result.openOffset ||
      (pair.openOffset === result.openOffset && pair.closeOffset < result.closeOffset)
    ) {
      result = pair;
    }
  }
  return result;
}

function offsetRange(document: vscode.TextDocument, offset: number): vscode.Range {
  return new vscode.Range(document.positionAt(offset), document.positionAt(offset + 1));
}

function isOpenBracket(character: string | undefined): character is OpenBracket {
  return character === "(" || character === "[" || character === "{";
}

function isCloseBracket(character: string | undefined): character is CloseBracket {
  return character === ")" || character === "]" || character === "}";
}
