import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import * as vscode from "vscode";
import { isSupportedDocument, readConfig, type TeXLeafConfig } from "./config";
import {
  createMathPreviewCursorRenderInput,
  createMathPreviewRenderInput,
  findMathPreviewFormulaAt,
  scanMathPreviewDocument,
  toMathJaxMacroOptions,
  type MathPreviewFormula,
  type MathPreviewSnapshot,
} from "./core";
import type {
  MathPreviewWorkerRequest,
  MathPreviewWorkerResponse,
  MathPreviewWorkerSuccess,
} from "./mathPreviewProtocol";
import {
  createMathPreviewCursorMarker,
  resolveMathPreviewAppearance,
} from "./mathPreviewAppearance";
import {
  fitMathPreviewSvgForCursor,
  frameMathPreviewSvg,
} from "./mathPreviewCard";
import { createMathPreviewSvgDataUri } from "./mathPreviewDataUri";
import {
  calculateMathPreviewHorizontalOffsetColumns,
  createMathPreviewAttachmentTextDecoration,
  planMathPreviewLayout,
} from "./mathPreviewLayout";

const TOGGLE_MATH_PREVIEW_COMMAND = "texleaf.toggleMathPreview";
const REFRESH_MATH_PREVIEW_COMMAND = "texleaf.refreshMathPreview";
const DISMISS_MATH_PREVIEW_COMMAND = "texleaf.dismissMathPreview";
const PREVIEW_VISIBLE_CONTEXT = "texleaf.mathPreviewVisible";
const WORKER_TIMEOUT_MS = 5_000;
const WORKER_QUEUE_SIZE = 32;
const RENDER_CACHE_SIZE = 64;
const ASSET_CACHE_SIZE = 64;
const ERROR_RETRY_DELAY_MS = 5_000;
const ERROR_RETRY_CACHE_SIZE = 128;
const FAILED_RENDER_GRACE_MS = 750;
const STALE_LEGACY_ASSET_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_PREVIEW_WIDTH_EM = 40;
const SAFETY_MAX_PREVIEW_HEIGHT_EM = 256;
const CURSOR_MARKER_COMMANDS = ["color", "rule", "mathord"] as const;

interface DocumentSnapshot {
  readonly version: number;
  readonly optionFingerprint: string;
  readonly text: string;
  readonly preview: MathPreviewSnapshot;
}

interface RenderedAsset {
  readonly hoverUri: () => Promise<vscode.Uri>;
  readonly decorationUri: vscode.Uri;
  readonly widthEm: number;
  readonly heightEm: number;
}

interface PendingRender {
  readonly resolve: (value: MathPreviewWorkerSuccess) => void;
  readonly reject: (reason: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface QueuedRender {
  readonly id: number;
  readonly request: MathPreviewWorkerRequest;
  readonly resolve: (value: MathPreviewWorkerSuccess) => void;
  readonly reject: (reason: Error) => void;
}

/**
 * Cursor-driven MathJax SVG preview built entirely on TeXLeaf's own scanner.
 * MathJax is lazy-loaded in a worker, keeping the extension host responsive.
 */
export class MathPreviewController implements vscode.Disposable, vscode.HoverProvider {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly worker: MathPreviewWorkerClient;
  private readonly assets: MathPreviewAssetStore;
  private readonly renderCache = new Map<string, Promise<RenderedAsset>>();
  private readonly retryAfter = new Map<string, number>();
  private snapshots = new WeakMap<vscode.TextDocument, DocumentSnapshot>();

  private timer: ReturnType<typeof setTimeout> | undefined;
  private failedRenderClearTimer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private readonly decoration: vscode.TextEditorDecorationType;
  private decorationEditor: vscode.TextEditor | undefined;
  private previewVisible = false;
  private disposed = false;

  public constructor(
    context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {
    this.worker = new MathPreviewWorkerClient(
      context.asAbsolutePath("dist/mathPreviewWorker.js"),
    );
    this.assets = new MathPreviewAssetStore(context.globalStorageUri);
    // Keep one stable Monaco decoration class for the controller lifetime.
    // Per-frame SVG/layout data is supplied through DecorationOptions below,
    // so refreshing a preview never has to tear down its pseudo-element first.
    this.decoration = vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      textDecoration: "none",
    });
  }

  public register(): void {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.schedule(event.textEditor);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document === event.document) {
          // Keep the last complete frame visible while the debounced scan and
          // worker render prepare its successor. Clearing here made every
          // keystroke produce a visible blank interval, even when the next
          // formula was valid and rendered successfully a moment later.
          this.schedule(editor);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.clearDecoration();
        this.schedule(editor);
      }),
      vscode.window.onDidChangeActiveColorTheme(() => {
        this.clearDecoration();
        this.schedule(vscode.window.activeTextEditor);
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        if (
          event.textEditor === vscode.window.activeTextEditor &&
          this.previewVisible
        ) {
          this.schedule(event.textEditor, true);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        const texleafChanged =
          event.affectsConfiguration("texleaf.mathPreview") ||
          event.affectsConfiguration("texleaf.enabled") ||
          event.affectsConfiguration("texleaf.languageIds");
        const editorLayoutChanged =
          event.affectsConfiguration("editor.fontSize") ||
          event.affectsConfiguration("editor.lineHeight");
        if (!texleafChanged && !editorLayoutChanged) {
          return;
        }
        if (!texleafChanged) {
          this.clearDecoration();
          this.schedule(vscode.window.activeTextEditor, true);
          return;
        }
        this.clearAllCaches();
        this.schedule(vscode.window.activeTextEditor, true);
      }),
      vscode.commands.registerCommand(TOGGLE_MATH_PREVIEW_COMMAND, () =>
        this.toggleEnabled(),
      ),
      vscode.commands.registerCommand(REFRESH_MATH_PREVIEW_COMMAND, () => {
        this.clearAllCaches();
        this.schedule(vscode.window.activeTextEditor, true);
      }),
      vscode.commands.registerCommand(DISMISS_MATH_PREVIEW_COMMAND, () => {
        this.cancelScheduled();
        this.generation += 1;
        this.clearDecoration();
      }),
      vscode.languages.registerHoverProvider(
        [{ language: "latex" }, { language: "tex" }],
        this,
      ),
    );
    this.schedule(vscode.window.activeTextEditor, true);
  }

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    const config = readConfig(document.uri);
    if (
      !this.supportsPreview(document, config) ||
      (config.mathPreviewPresentation !== "hover" &&
        config.mathPreviewPresentation !== "both")
    ) {
      return undefined;
    }

    const snapshot = this.snapshotFor(document, config);
    const offset = document.offsetAt(position);
    const formula = findMathPreviewFormulaAt(snapshot.preview, offset);
    if (formula === undefined || token.isCancellationRequested) {
      return undefined;
    }
    const input = createMathPreviewRenderInput(
      snapshot.text,
      formula,
      snapshot.preview,
      offset,
    );
    if (input === undefined) {
      return undefined;
    }

    try {
      const asset = await this.render(input, config);
      if (token.isCancellationRequested) {
        return undefined;
      }
      const hoverUri = await asset.hoverUri();
      if (
        token.isCancellationRequested ||
        document.version !== snapshot.version
      ) {
        return undefined;
      }
      const markdown = new vscode.MarkdownString();
      markdown.isTrusted = false;
      markdown.supportHtml = false;
      markdown.appendMarkdown(
        `![TeXLeaf Math Preview](${hoverUri.toString()})`,
      );
      return new vscode.Hover(
        markdown,
        new vscode.Range(
          document.positionAt(formula.outerRange.start),
          document.positionAt(formula.outerRange.end),
        ),
      );
    } catch {
      return undefined;
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelScheduled();
    this.generation += 1;
    this.clearDecoration();
    this.decoration.dispose();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.renderCache.clear();
    this.retryAfter.clear();
    this.worker.dispose();
    this.assets.dispose();
  }

  private schedule(
    editor: vscode.TextEditor | undefined,
    immediate = false,
  ): void {
    if (this.disposed) {
      return;
    }
    this.cancelScheduled();
    this.cancelFailedRenderClear();
    const requestGeneration = ++this.generation;
    if (editor === undefined || editor !== vscode.window.activeTextEditor) {
      this.clearDecoration();
      return;
    }
    const config = readConfig(editor.document.uri);
    if (
      !this.supportsPreview(editor.document, config) ||
      (config.mathPreviewPresentation !== "cursor" &&
        config.mathPreviewPresentation !== "both")
    ) {
      this.clearDecoration();
      return;
    }

    const delay = immediate ? 0 : this.debounceFor(editor.document, config);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refreshCursorPreview(editor, requestGeneration);
    }, delay);
  }

  private async refreshCursorPreview(
    editor: vscode.TextEditor,
    requestGeneration: number,
  ): Promise<void> {
    if (
      this.disposed ||
      requestGeneration !== this.generation ||
      editor !== vscode.window.activeTextEditor
    ) {
      return;
    }
    const document = editor.document;
    const config = readConfig(document.uri);
    if (!this.supportsPreview(document, config)) {
      this.clearDecoration();
      return;
    }

    const snapshot = this.snapshotFor(document, config);
    const cursorOffset = document.offsetAt(editor.selection.active);
    const formula = findMathPreviewFormulaAt(snapshot.preview, cursorOffset);
    if (formula === undefined) {
      this.clearDecoration();
      return;
    }
    const input = createMathPreviewRenderInput(
      snapshot.text,
      formula,
      snapshot.preview,
      cursorOffset,
    );
    if (input === undefined) {
      this.clearDecoration();
      return;
    }

    const appearance = resolveMathPreviewAppearance(
      isDarkPreviewTheme(vscode.window.activeColorTheme.kind),
    );
    const markerIsShadowed = CURSOR_MARKER_COMMANDS.some((name) =>
      Object.hasOwn(input.macros, name),
    );
    let cursorInput: ReturnType<typeof createMathPreviewCursorRenderInput>;
    try {
      cursorInput = markerIsShadowed
        ? undefined
        : createMathPreviewCursorRenderInput(
            snapshot.text,
            formula,
            snapshot.preview,
            cursorOffset,
            createMathPreviewCursorMarker(appearance.cursor),
          );
    } catch (cursorPlanningError: unknown) {
      cursorInput = undefined;
      this.output.debug(
        `Math Preview cursor planning fell back to the plain formula: ${
          cursorPlanningError instanceof Error
            ? cursorPlanningError.message
            : String(cursorPlanningError)
        }`,
      );
    }

    try {
      let asset: RenderedAsset;
      try {
        asset = await this.render(cursorInput ?? input, config);
      } catch (cursorError: unknown) {
        if (
          cursorInput === undefined ||
          this.disposed ||
          requestGeneration !== this.generation
        ) {
          throw cursorError;
        }
        this.output.debug(
          `Math Preview cursor marker fell back to the plain formula: ${
            cursorError instanceof Error
              ? cursorError.message
              : String(cursorError)
          }`,
        );
        asset = await this.render(input, config);
      }
      if (
        this.disposed ||
        requestGeneration !== this.generation ||
        editor !== vscode.window.activeTextEditor ||
        editor.document !== document ||
        document.version !== snapshot.version
      ) {
        return;
      }
      this.applyDecoration(editor, formula, cursorOffset, asset, config);
    } catch (error: unknown) {
      if (requestGeneration === this.generation) {
        // A partially typed command can be temporarily invalid. Keep the last
        // complete frame during a short editing grace period instead of
        // flashing blank, but clear it if the user stops on that invalid state.
        this.scheduleFailedRenderClear(
          editor,
          document,
          snapshot.version,
          requestGeneration,
        );
      }
      this.output.debug(
        `Math Preview 渲染未完成：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async render(
    input: NonNullable<ReturnType<typeof createMathPreviewRenderInput>>,
    config: TeXLeafConfig,
  ): Promise<RenderedAsset> {
    const appearance = resolveMathPreviewAppearance(
      isDarkPreviewTheme(vscode.window.activeColorTheme.kind),
    );
    const foreground = appearance.foreground;
    const macroOptions = toMathJaxMacroOptions(input.macros);
    const key = JSON.stringify([
      "mathjax-4.1.3-floating-card-caret-v4",
      input.tex,
      input.display,
      input.macroFingerprint,
      appearance,
      config.mathPreviewScale,
    ]);
    const cached = this.renderCache.get(key);
    if (cached !== undefined) {
      this.renderCache.delete(key);
      this.renderCache.set(key, cached);
      return cached;
    }
    const retryAt = this.retryAfter.get(key);
    if (retryAt !== undefined) {
      if (retryAt > Date.now()) {
        throw new Error("This formula is waiting before a safe render retry.");
      }
      this.retryAfter.delete(key);
    }

    let promise: Promise<RenderedAsset>;
    promise = this.worker
      .render({
        tex: input.tex,
        display: input.display,
        macros: macroOptions,
        macroFingerprint: input.macroFingerprint,
        foreground,
        scale: config.mathPreviewScale,
      })
      .then(async (result) => {
        const framed = frameMathPreviewSvg(result, appearance);
        const decoration = fitMathPreviewSvgForCursor(
          framed,
          MAX_PREVIEW_WIDTH_EM,
          SAFETY_MAX_PREVIEW_HEIGHT_EM,
        );
        const asset = {
          // Cursor previews use an in-memory data URI. Persist the larger
          // hover SVG only if a Hover is actually requested, rather than
          // adding filesystem latency to every cursor refresh.
          hoverUri: this.assets.deferredWrite(key, framed.svg),
          decorationUri: vscode.Uri.parse(
            createMathPreviewSvgDataUri(decoration.svg),
            true,
          ),
          widthEm: decoration.widthEm,
          heightEm: decoration.heightEm,
        };
        if (this.renderCache.get(key) === promise) {
          this.retryAfter.delete(key);
        }
        return asset;
      })
      .catch((error: unknown) => {
        if (this.renderCache.get(key) === promise) {
          this.renderCache.delete(key);
          this.rememberRenderFailure(key);
        }
        throw error;
      });
    this.renderCache.set(key, promise);
    this.trimRenderCache();
    return promise;
  }

  private applyDecoration(
    editor: vscode.TextEditor,
    formula: MathPreviewFormula,
    cursorOffset: number,
    asset: RenderedAsset,
    config: TeXLeafConfig,
  ): void {
    const width = asset.widthEm;
    const height = asset.heightEm;
    const document = editor.document;
    const formulaStart = document.positionAt(formula.outerRange.start);
    const formulaEnd = document.positionAt(
      formula.closed
        ? formula.outerRange.end
        : Math.min(
            formula.outerRange.end,
            Math.max(formula.bodyRange.start, cursorOffset),
          ),
    );
    const cursor = document.positionAt(cursorOffset);
    const editorConfig = vscode.workspace.getConfiguration(
      "editor",
      document.uri,
    );
    const fontSize = editorConfig.get<number>("fontSize", 14);
    const configuredLineHeight = editorConfig.get<number>("lineHeight", 0);
    const lineHeight = configuredLineHeight > 0
      ? configuredLineHeight
      : fontSize * 1.5;
    const plan = planMathPreviewLayout({
      mode: formula.mode,
      formulaStart,
      formulaEnd,
      cursorLine: cursor.line,
      cursorLineStartCharacter:
        document.lineAt(cursor.line).firstNonWhitespaceCharacterIndex,
      visibleRanges: editor.visibleRanges.map((range) => ({
        startLine: range.start.line,
        endLine: range.end.line,
      })),
      previewHeightEm: height,
      fontSizePx: fontSize,
      lineHeightPx: lineHeight,
      placement: config.mathPreviewPlacement,
    });
    const anchor = clampPositionToDocument(document, plan.anchor);
    const horizontalStrategy = formula.mode === "inline"
      ? { kind: "static" as const }
      : {
          kind: "static" as const,
          offsetColumns: calculateMathPreviewHorizontalOffsetColumns(
            document.lineAt(formulaStart.line).text,
            formulaStart.character,
            document.lineAt(anchor.line).text,
            anchor.character,
            resolveEditorTabSize(editor),
          ),
        };

    const previousEditor = this.decorationEditor;
    editor.setDecorations(this.decoration, [{
      range: new vscode.Range(anchor, anchor),
      renderOptions: {
        before: {
          contentIconPath: asset.decorationUri,
          width: `${roundCss(width)}em`,
          height: `${roundCss(height)}em`,
          margin: "0",
          textDecoration: createMathPreviewAttachmentTextDecoration(
            plan.side,
            horizontalStrategy,
          ),
        },
      },
    }]);
    this.decorationEditor = editor;
    if (previousEditor !== undefined && previousEditor !== editor) {
      try {
        previousEditor.setDecorations(this.decoration, []);
      } catch {
        // The previous editor can close between a successful frame install
        // and this best-effort cleanup.
      }
    }
    this.cancelFailedRenderClear();
    this.setPreviewVisible(true);
  }

  private snapshotFor(
    document: vscode.TextDocument,
    config: TeXLeafConfig,
  ): DocumentSnapshot {
    const optionFingerprint = JSON.stringify([
      config.mathPreviewMaxSourceLength,
      config.mathPreviewMacros,
    ]);
    const cached = this.snapshots.get(document);
    if (
      cached !== undefined &&
      cached.version === document.version &&
      cached.optionFingerprint === optionFingerprint
    ) {
      return cached;
    }
    const text = document.getText();
    const snapshot: DocumentSnapshot = {
      version: document.version,
      optionFingerprint,
      text,
      preview: scanMathPreviewDocument(text, {
        maxSourceLength: config.mathPreviewMaxSourceLength,
        configuredMacros: config.mathPreviewMacros,
      }),
    };
    this.snapshots.set(document, snapshot);
    return snapshot;
  }

  private supportsPreview(
    document: vscode.TextDocument,
    config: TeXLeafConfig,
  ): boolean {
    return (
      config.mathPreviewEnabled &&
      isSupportedDocument(document, config) &&
      (document.languageId === "latex" || document.languageId === "tex") &&
      document.uri.path.toLowerCase().endsWith(".tex")
    );
  }

  private debounceFor(document: vscode.TextDocument, config: TeXLeafConfig): number {
    const largeDocumentDelay =
      document.lineCount >= 4_000 || documentLength(document) >= 1_048_576
        ? 300
        : 0;
    return Math.max(config.mathPreviewDebounceMs, largeDocumentDelay);
  }

  private async toggleEnabled(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const uri = editor?.document.uri;
    const configuration = vscode.workspace.getConfiguration("texleaf", uri);
    const enabled = configuration.get<boolean>("mathPreview.enabled", true);
    const target =
      uri !== undefined && vscode.workspace.getWorkspaceFolder(uri) !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : vscode.ConfigurationTarget.Global;
    await configuration.update("mathPreview.enabled", !enabled, target);
  }

  private clearAllCaches(): void {
    this.cancelScheduled();
    this.generation += 1;
    this.clearDecoration();
    this.snapshots = new WeakMap<vscode.TextDocument, DocumentSnapshot>();
    this.renderCache.clear();
    this.retryAfter.clear();
    this.assets.clear();
  }

  private trimRenderCache(): void {
    while (this.renderCache.size > RENDER_CACHE_SIZE) {
      const oldest = this.renderCache.keys().next().value as string | undefined;
      if (oldest === undefined) {
        return;
      }
      this.renderCache.delete(oldest);
      this.assets.remove(oldest);
    }
  }

  private rememberRenderFailure(key: string): void {
    const now = Date.now();
    for (const [cachedKey, retryAt] of this.retryAfter) {
      if (retryAt <= now) {
        this.retryAfter.delete(cachedKey);
      }
    }
    this.retryAfter.delete(key);
    this.retryAfter.set(key, now + ERROR_RETRY_DELAY_MS);
    while (this.retryAfter.size > ERROR_RETRY_CACHE_SIZE) {
      const oldest = this.retryAfter.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.retryAfter.delete(oldest);
    }
  }

  private cancelScheduled(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private cancelFailedRenderClear(): void {
    if (this.failedRenderClearTimer !== undefined) {
      clearTimeout(this.failedRenderClearTimer);
      this.failedRenderClearTimer = undefined;
    }
  }

  private scheduleFailedRenderClear(
    editor: vscode.TextEditor,
    document: vscode.TextDocument,
    documentVersion: number,
    requestGeneration: number,
  ): void {
    this.cancelFailedRenderClear();
    this.failedRenderClearTimer = setTimeout(() => {
      this.failedRenderClearTimer = undefined;
      if (
        this.disposed ||
        requestGeneration !== this.generation ||
        editor !== vscode.window.activeTextEditor ||
        editor.document !== document ||
        document.version !== documentVersion
      ) {
        return;
      }
      this.clearDecoration();
    }, FAILED_RENDER_GRACE_MS);
  }

  private clearDecoration(): void {
    this.cancelFailedRenderClear();
    const editor = this.decorationEditor;
    this.decorationEditor = undefined;
    if (editor !== undefined) {
      try {
        editor.setDecorations(this.decoration, []);
      } catch {
        // The editor can disappear while the extension host is disposing.
      }
    }
    this.setPreviewVisible(false);
  }

  private setPreviewVisible(visible: boolean): void {
    if (this.previewVisible === visible) {
      return;
    }
    this.previewVisible = visible;
    void vscode.commands.executeCommand("setContext", PREVIEW_VISIBLE_CONTEXT, visible);
  }
}

class MathPreviewWorkerClient implements vscode.Disposable {
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRender>();
  private readonly queued: QueuedRender[] = [];
  private activeId: number | undefined;
  private disposed = false;

  public constructor(private readonly workerPath: string) {}

  public render(
    request: Omit<MathPreviewWorkerRequest, "type" | "id">,
  ): Promise<MathPreviewWorkerSuccess> {
    if (this.disposed) {
      return Promise.reject(new Error("Math Preview renderer is disposed."));
    }
    const id = this.nextId++;
    return new Promise<MathPreviewWorkerSuccess>((resolve, reject) => {
      this.queued.push({
        id,
        request: { type: "render", id, ...request },
        resolve,
        reject,
      });
      while (this.queued.length > WORKER_QUEUE_SIZE) {
        this.queued.shift()?.reject(
          new Error("Math Preview dropped an obsolete queued render."),
        );
      }
      this.pump();
    });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.failAll(new Error("Math Preview renderer stopped."));
    void this.worker?.terminate();
    this.worker = undefined;
  }

  /** Keep at most one request inside MathJax; queued work stays bounded here. */
  private pump(): void {
    if (this.disposed || this.activeId !== undefined) {
      return;
    }
    const queued = this.queued.shift();
    if (queued === undefined) {
      return;
    }

    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (error: unknown) {
      queued.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
      this.pump();
      return;
    }

    const timeout = setTimeout(() => {
      const pending = this.pending.get(queued.id);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(queued.id);
      this.activeId = undefined;
      pending.reject(new Error("MathJax render timed out."));
      this.restartWorker();
    }, WORKER_TIMEOUT_MS);
    this.activeId = queued.id;
    this.pending.set(queued.id, {
      resolve: queued.resolve,
      reject: queued.reject,
      timeout,
    });
    worker.postMessage(queued.request);
  }

  private ensureWorker(): Worker {
    if (this.worker !== undefined) {
      return this.worker;
    }
    const worker = new Worker(this.workerPath, { name: "TeXLeaf Math Preview" });
    worker.unref();
    worker.on("message", (value: unknown) => this.handleMessage(value));
    worker.on("error", (error) => {
      if (worker === this.worker) {
        this.worker = undefined;
        this.failAll(error);
      }
    });
    worker.on("exit", (code) => {
      if (worker === this.worker) {
        this.worker = undefined;
        if (code !== 0 && !this.disposed) {
          this.failAll(new Error(`Math Preview worker exited with code ${code}.`));
        }
      }
    });
    this.worker = worker;
    return worker;
  }

  private handleMessage(value: unknown): void {
    if (!isWorkerResponse(value)) {
      return;
    }
    const pending = this.pending.get(value.id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(value.id);
    if (this.activeId === value.id) {
      this.activeId = undefined;
    }
    clearTimeout(pending.timeout);
    if (value.type === "result") {
      pending.resolve(value);
    } else {
      pending.reject(new Error(value.message));
    }
    this.pump();
  }

  private restartWorker(): void {
    const worker = this.worker;
    this.worker = undefined;
    void worker?.terminate();
    this.failAll(new Error("Math Preview worker restarted after a timeout."));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.activeId = undefined;
    for (const queued of this.queued.splice(0)) {
      queued.reject(error);
    }
  }
}

class MathPreviewAssetStore implements vscode.Disposable {
  private readonly baseDirectory: vscode.Uri;
  private readonly directory: vscode.Uri;
  private readonly fileByKey = new Map<string, vscode.Uri>();
  private readonly pendingByKey = new Map<string, Promise<vscode.Uri>>();
  private readonly ready: Promise<void>;
  private assetSequence = 0;
  private generation = 0;
  private disposed = false;

  public constructor(globalStorageUri: vscode.Uri) {
    this.baseDirectory = vscode.Uri.joinPath(globalStorageUri, "math-preview");
    this.directory = vscode.Uri.joinPath(
      this.baseDirectory,
      `session-${Date.now()}-pid-${process.pid}-${randomUUID()}`,
    );
    this.ready = this.initialize();
  }

  public deferredWrite(
    key: string,
    svg: string,
  ): () => Promise<vscode.Uri> {
    const generation = this.generation;
    return () => this.write(key, svg, generation);
  }

  private async write(
    key: string,
    svg: string,
    generation: number,
  ): Promise<vscode.Uri> {
    if (this.disposed || generation !== this.generation) {
      throw new Error("Math Preview asset write was superseded.");
    }
    const existing = this.fileByKey.get(key);
    if (existing !== undefined) {
      this.fileByKey.delete(key);
      this.fileByKey.set(key, existing);
      return existing;
    }
    const pending = this.pendingByKey.get(key);
    if (pending !== undefined) {
      return pending;
    }

    const write = this.writeNew(key, svg, generation);
    this.pendingByKey.set(key, write);
    try {
      return await write;
    } finally {
      if (this.pendingByKey.get(key) === write) {
        this.pendingByKey.delete(key);
      }
    }
  }

  private async writeNew(
    key: string,
    svg: string,
    generation: number,
  ): Promise<vscode.Uri> {
    await this.ready;
    if (this.disposed || generation !== this.generation) {
      throw new Error("Math Preview asset write was superseded.");
    }
    // Keep this deliberately short.  The VS Code global-storage prefix and
    // session directory can already be long on Windows; the former
    // hash-plus-UUID filename pushed real paths to MAX_PATH (260), leaving a
    // visible decoration box whose SVG image could not be loaded.  A session-
    // local monotonic ID is unique and still prevents stale deletes from
    // racing a same-key rewrite after a refresh.
    const filename = `p-${(++this.assetSequence).toString(36)}.svg`;
    const uri = vscode.Uri.joinPath(this.directory, filename);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(svg, "utf8"));
    if (this.disposed || generation !== this.generation) {
      await vscode.workspace.fs.delete(uri, {
        recursive: false,
        useTrash: false,
      }).then(undefined, () => undefined);
      throw new Error("Math Preview asset write was superseded.");
    }
    this.fileByKey.set(key, uri);
    this.trim();
    return uri;
  }

  public remove(key: string): void {
    const uri = this.fileByKey.get(key);
    if (uri === undefined) {
      return;
    }
    this.fileByKey.delete(key);
    void vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false }).then(
      undefined,
      () => undefined,
    );
  }

  public clear(): void {
    this.generation += 1;
    this.pendingByKey.clear();
    for (const key of [...this.fileByKey.keys()]) {
      this.remove(key);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    this.fileByKey.clear();
    this.pendingByKey.clear();
    void this.ready.then(() =>
      vscode.workspace.fs.delete(this.directory, {
        recursive: true,
        useTrash: false,
      }),
    ).catch(() => undefined);
  }

  private async initialize(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.baseDirectory);
    const now = Date.now();
    const entries = await vscode.workspace.fs.readDirectory(this.baseDirectory);
    await Promise.all(
      entries.map(async ([name, type]) => {
        if (name === this.directory.path.split("/").at(-1)) {
          return;
        }
        const currentFormat = /^session-(\d+)-pid-(\d+)-/u.exec(name);
        const legacyFormat = /^session-(\d+)-/u.exec(name);
        const created = (currentFormat?.[1] ?? legacyFormat?.[1]) === undefined
          ? Number.NaN
          : Number.parseInt((currentFormat?.[1] ?? legacyFormat?.[1])!, 10);
        const ownerPid = currentFormat?.[2] === undefined
          ? undefined
          : Number.parseInt(currentFormat[2], 10);
        const stale = ownerPid === undefined
          ? Number.isFinite(created) && now - created >= STALE_LEGACY_ASSET_SESSION_AGE_MS
          : !processIsProbablyAlive(ownerPid);
        if (
          type !== vscode.FileType.Directory ||
          !stale
        ) {
          return;
        }
        await vscode.workspace.fs.delete(
          vscode.Uri.joinPath(this.baseDirectory, name),
          { recursive: true, useTrash: false },
        ).then(undefined, () => undefined);
      }),
    );
    await vscode.workspace.fs.createDirectory(this.directory);
  }

  private trim(): void {
    while (this.fileByKey.size > ASSET_CACHE_SIZE) {
      const oldest = this.fileByKey.keys().next().value as string | undefined;
      if (oldest === undefined) {
        return;
      }
      this.remove(oldest);
    }
  }
}

function isWorkerResponse(value: unknown): value is MathPreviewWorkerResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<MathPreviewWorkerResponse>;
  return (
    Number.isSafeInteger(candidate.id) &&
    (candidate.type === "result" || candidate.type === "error")
  );
}

function isDarkPreviewTheme(kind: vscode.ColorThemeKind): boolean {
  return kind === vscode.ColorThemeKind.Dark ||
    kind === vscode.ColorThemeKind.HighContrast;
}

function roundCss(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function clampPositionToDocument(
  document: vscode.TextDocument,
  point: { readonly line: number; readonly character: number },
): vscode.Position {
  const line = Math.min(
    Math.max(0, Math.trunc(point.line)),
    Math.max(0, document.lineCount - 1),
  );
  const character = Math.min(
    Math.max(0, Math.trunc(point.character)),
    document.lineAt(line).text.length,
  );
  return new vscode.Position(line, character);
}

function resolveEditorTabSize(editor: vscode.TextEditor): number {
  const configured = editor.options.tabSize;
  if (typeof configured === "number" && Number.isFinite(configured)) {
    return Math.min(16, Math.max(1, Math.trunc(configured)));
  }
  return 4;
}

function documentLength(document: vscode.TextDocument): number {
  const lastLine = document.lineAt(Math.max(0, document.lineCount - 1));
  return document.offsetAt(lastLine.rangeIncludingLineBreak.end);
}

function processIsProbablyAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM means the process exists but this extension host cannot signal it.
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}
