/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import type * as vscode from "vscode";
import path from "node:path";
import {
  prepareVisualFormulaAsset,
  toMathJaxMacroOptions,
  VISUAL_FORMULA_FOREGROUND,
  type MathPreviewRenderInput,
} from "./core";
import { MathPreviewWorkerClient } from "./mathPreviewWorkerClient";
import type { MathPreviewWorkerSuccess } from "./mathPreviewProtocol";
import { LocalLatexPreviewRenderer, type LocalPreviewRenderOptions } from "./localLatexPreviewRenderer";

const COMPLETED_RENDER_CACHE_ITEMS = 512;
const COMPLETED_RENDER_CACHE_BYTES = 48 * 1024 * 1024;
const CURSOR_RENDER_CACHE_ITEMS = 8;
const CURSOR_RENDER_CACHE_BYTES = 8 * 1024 * 1024;
const CURSOR_WORKER_WARMUP_COLOR = "#ff2d95";

type RenderLane = "static" | "structure" | "cursor" | "interactive";

interface CompletedRenderEntry {
  readonly result: MathPreviewWorkerSuccess;
  readonly bytes: number;
}

class CompletedRenderCache {
  private readonly entries = new Map<string, CompletedRenderEntry>();
  private bytes = 0;

  public constructor(
    private readonly maximumItems: number,
    private readonly maximumBytes: number,
  ) {}

  public get(key: string): MathPreviewWorkerSuccess | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.result;
  }

  public set(key: string, result: MathPreviewWorkerSuccess): void {
    const bytes = Math.max(64, result.svg.length * 2 + 64);
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.entries.delete(key);
      this.bytes -= previous.bytes;
    }
    if (bytes > this.maximumBytes) {
      return;
    }
    this.entries.set(key, { result, bytes });
    this.bytes += bytes;
    while (
      this.entries.size > this.maximumItems ||
      this.bytes > this.maximumBytes
    ) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        break;
      }
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.bytes -= oldest?.bytes ?? 0;
    }
  }

  public clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

/**
 * Math renderers for the visual editor. Background document rendering and the
 * interactive cursor preview deliberately use separate serial workers. A
 * large document can enqueue many static formula renders at once; sharing that
 * queue made an otherwise tiny cursor update wait behind unrelated formulas.
 * The Webview still receives only sanitized SVG output.
 */
export class VisualEditorRenderer implements vscode.Disposable {
  public retryGraphPreviews(): void { this.local.retryFailures(); }
  public clearGraphCache(): Promise<void> { return this.local.clearCache(); }
  public setGraphCacheLimitMB(limit: number): Promise<void> { return this.local.setCacheLimitMB(limit); }
  private readonly worker: MathPreviewWorkerClient;
  private readonly cursorWorker: MathPreviewWorkerClient;
  private readonly interactiveWorker: MathPreviewWorkerClient;
  private readonly local: LocalLatexPreviewRenderer;
  /** Static, structure, and interactive lanes share only completed assets. */
  private readonly completedCache = new CompletedRenderCache(
    COMPLETED_RENDER_CACHE_ITEMS,
    COMPLETED_RENDER_CACHE_BYTES,
  );
  /** Cursor states are short-lived and must never evict document formulae. */
  private readonly cursorCache = new CompletedRenderCache(
    CURSOR_RENDER_CACHE_ITEMS,
    CURSOR_RENDER_CACHE_BYTES,
  );
  /** Pending work stays outside the completed LRU and cannot be evicted. */
  private readonly inFlight = new Map<string, Promise<MathPreviewWorkerSuccess>>();
  private readonly cursorReady: Promise<void>;
  private cacheEpoch = 0;
  private disposed = false;

  public constructor(context: vscode.ExtensionContext) {
    const workerPath = context.asAbsolutePath("dist/mathPreviewWorker.js");
    this.local = new LocalLatexPreviewRenderer({
      quiverPackagePath: context.asAbsolutePath("dist/quiver/quiver.sty"),
      cacheDirectory: context.globalStorageUri?.scheme === "file"
        ? path.join(context.globalStorageUri.fsPath, "visual-tex-cache") : undefined,
    });
    // Macro environments are comparatively numerous in document rendering but
    // tiny in the cursor lane. Per-lane bounds avoid retaining 36 heavyweight
    // MathJax documents across three workers and reduce long-session GC pauses.
    this.worker = new MathPreviewWorkerClient(workerPath, 8);
    this.cursorWorker = new MathPreviewWorkerClient(workerPath, 2);
    this.interactiveWorker = new MathPreviewWorkerClient(workerPath, 4);
    // The first MathJax request pays the worker startup/module initialization
    // cost (commonly 1–2 seconds on Windows). Start that work when the visual
    // renderer is constructed, while the initial document is being prepared,
    // so the first typed character never becomes the warm-up request.
    this.cursorReady = this.cursorWorker.render({
      tex: "x",
      display: false,
      macros: {},
      macroFingerprint: "texleaf-cursor-worker-warmup",
      foreground: VISUAL_FORMULA_FOREGROUND,
      scale: 1,
      cursorMarkerColor: CURSOR_WORKER_WARMUP_COLOR,
    }).then(() => undefined, () => undefined);
  }

  public render(
    input: MathPreviewRenderInput,
    scale: number,
    texBinPath?: string,
    options: LocalPreviewRenderOptions = {},
  ): Promise<MathPreviewWorkerSuccess> {
    return this.renderInternal("static", input, scale, this.worker, this.local, texBinPath, undefined, false, options);
  }

  /** Low-priority document-structure asset, isolated from viewport cache keys. */
  public renderStructure(
    input: MathPreviewRenderInput,
    scale: number,
    texBinPath?: string,
    options: LocalPreviewRenderOptions = {},
  ): Promise<MathPreviewWorkerSuccess> {
    return this.renderInternal(
      "structure",
      input,
      scale,
      this.worker,
      this.local,
      texBinPath, undefined, false, options,
    );
  }

  /** Render the active-source formula without the normal presentation cap. */
  public renderCursor(
    input: MathPreviewRenderInput,
    scale: number,
    cursorMarkerColor: string,
    texBinPath?: string,
    options: LocalPreviewRenderOptions = {},
  ): Promise<MathPreviewWorkerSuccess> {
    return this.cursorReady.then(() => this.renderInternal(
      "cursor",
      input,
      scale,
      this.cursorWorker,
      this.local,
      texBinPath,
      cursorMarkerColor,
      false,
      options,
    ));
  }

  /**
   * Render the current formula as soon as its source caret leaves it.
   *
   * Use the interactive lane so this request cannot wait behind a formula-dense
   * viewport and cannot delay the next live cursor frame. Completed assets are
   * shared with the static lane, so an unchanged formula still resolves at once.
   */
  public renderCommittedFormula(
    input: MathPreviewRenderInput,
    scale: number,
    texBinPath?: string,
    options: LocalPreviewRenderOptions = {},
  ): Promise<MathPreviewWorkerSuccess> {
    return this.renderInternal(
      "interactive",
      input,
      scale,
      this.interactiveWorker,
      this.local,
      texBinPath, undefined, false, options,
    );
  }

  /**
   * Render a user-requested preview (completion details, reference hover, or
   * a visual table/diagram input) without waiting behind whole-document work.
   */
  public renderInteractive(
    input: MathPreviewRenderInput,
    scale: number,
    texBinPath?: string,
    options: LocalPreviewRenderOptions = {},
  ): Promise<MathPreviewWorkerSuccess> {
    return this.renderInternal(
      "interactive",
      input,
      scale,
      this.interactiveWorker,
      this.local,
      texBinPath, undefined, false, options,
    );
  }

  private renderInternal(
    lane: RenderLane,
    input: MathPreviewRenderInput,
    scale: number,
    worker: MathPreviewWorkerClient,
    local: LocalLatexPreviewRenderer,
    texBinPath?: string,
    cursorMarkerColor?: string,
    latestOnly = false,
    localOptions: LocalPreviewRenderOptions = {},
  ): Promise<MathPreviewWorkerSuccess> {
    if (this.disposed) {
      return Promise.reject(new Error("Visual editor renderer is disposed."));
    }
    const usesLocalRenderer = local.supports(input);
    if (usesLocalRenderer) {
      return local.render(input, scale, cursorMarkerColor, texBinPath, {
        priority: lane === "interactive" || lane === "cursor",
        ...localOptions,
      }).then(result => ({ ...result, ...prepareVisualFormulaAsset(result, { display: input.display }) }));
    }
    const key = JSON.stringify([
      "texleaf-visual-editor-v4",
      "mathjax",
      input.tex,
      input.display,
      input.macroFingerprint,
      scale,
      undefined,
      cursorMarkerColor,
    ]);
    const completed = lane === "cursor" ? this.cursorCache : this.completedCache;
    const cached = completed.get(key);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    // Keep pending work lane-specific. A user-requested interactive render may
    // duplicate one currently waiting in a background lane instead of inheriting
    // that queue's latency; once either completes, all lanes share the result.
    const inFlightKey = `${lane}\u0000${key}`;
    const existing = this.inFlight.get(inFlightKey);
    if (existing !== undefined) {
      return existing;
    }

    const epoch = this.cacheEpoch;
    const rendered = worker[latestOnly ? "renderLatest" : "render"]({
          tex: input.tex,
          display: input.display,
          macros: toMathJaxMacroOptions(input.macros),
          macroFingerprint: input.macroFingerprint,
          foreground: VISUAL_FORMULA_FOREGROUND,
          scale,
          ...(cursorMarkerColor === undefined ? {} : { cursorMarkerColor }),
        });
    let request: Promise<MathPreviewWorkerSuccess>;
    request = rendered.then((result) => ({
      ...result,
      ...prepareVisualFormulaAsset(result, {
        display: input.display,
        ...(cursorMarkerColor === undefined
          ? {}
          : { maximumWidthEm: 512, maximumHeightEm: 256 }),
      }),
    })).then((result) => {
      if (!this.disposed && this.cacheEpoch === epoch) {
        completed.set(key, result);
      }
      return result;
    }).catch((error: unknown) => {
      throw error;
    }).finally(() => {
      if (this.inFlight.get(inFlightKey) === request) {
        this.inFlight.delete(inFlightKey);
      }
    });
    this.inFlight.set(inFlightKey, request);
    return request;
  }

  public usesLocalTeX(input: MathPreviewRenderInput): boolean {
    return this.local.supports(input);
  }

  public clear(): void {
    this.cacheEpoch += 1;
    this.completedCache.clear();
    this.cursorCache.clear();
    this.inFlight.clear();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clear();
    this.worker.dispose();
    this.cursorWorker.dispose();
    this.interactiveWorker.dispose();
    this.local.dispose();
  }

}
