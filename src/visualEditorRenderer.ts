/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import * as vscode from "vscode";
import {
  prepareVisualFormulaAsset,
  toMathJaxMacroOptions,
  VISUAL_FORMULA_FOREGROUND,
  type MathPreviewRenderInput,
} from "./core";
import { MathPreviewWorkerClient } from "./mathPreviewController";
import type { MathPreviewWorkerSuccess } from "./mathPreviewProtocol";
import { LocalLatexPreviewRenderer } from "./localLatexPreviewRenderer";

const COMPLETED_RENDER_CACHE_ITEMS = 512;
const COMPLETED_RENDER_CACHE_BYTES = 48 * 1024 * 1024;
const CURSOR_RENDER_CACHE_ITEMS = 8;
const CURSOR_RENDER_CACHE_BYTES = 8 * 1024 * 1024;
const CURSOR_WORKER_WARMUP_COLOR = "#ff2d95";

type RenderLane = "static" | "cursor" | "interactive";

interface CompletedRenderEntry {
  readonly result: MathPreviewWorkerSuccess;
  readonly bytes: number;
}

/** A byte- and item-bounded LRU containing only completed SVG assets. */
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
  private readonly worker: MathPreviewWorkerClient;
  private readonly cursorWorker: MathPreviewWorkerClient;
  private readonly interactiveWorker: MathPreviewWorkerClient;
  private readonly local = new LocalLatexPreviewRenderer();
  private readonly cursorLocal = new LocalLatexPreviewRenderer();
  private readonly interactiveLocal = new LocalLatexPreviewRenderer();
  /** Static and interactive lanes share completed assets only. */
  private readonly completedCache = new CompletedRenderCache(
    COMPLETED_RENDER_CACHE_ITEMS,
    COMPLETED_RENDER_CACHE_BYTES,
  );
  /** Short-lived caret states must not evict document formulae. */
  private readonly cursorCache = new CompletedRenderCache(
    CURSOR_RENDER_CACHE_ITEMS,
    CURSOR_RENDER_CACHE_BYTES,
  );
  /** Pending work is kept outside the completed LRU and cannot be evicted. */
  private readonly inFlight = new Map<string, Promise<MathPreviewWorkerSuccess>>();
  private readonly cursorReady: Promise<void>;
  private cacheEpoch = 0;
  private disposed = false;

  public constructor(context: vscode.ExtensionContext) {
    const workerPath = context.asAbsolutePath("dist/mathPreviewWorker.js");
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
  ): Promise<MathPreviewWorkerSuccess> {
    return this.renderInternal("static", input, scale, this.worker, this.local);
  }

  /** Render the active-source formula without the normal presentation cap. */
  public renderCursor(
    input: MathPreviewRenderInput,
    scale: number,
    cursorMarkerColor: string,
  ): Promise<MathPreviewWorkerSuccess> {
    return this.cursorReady.then(() => this.renderInternal(
      "cursor",
      input,
      scale,
      this.cursorWorker,
      this.cursorLocal,
      cursorMarkerColor,
      false,
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
  ): Promise<MathPreviewWorkerSuccess> {
    return this.renderInternal(
      "interactive",
      input,
      scale,
      this.interactiveWorker,
      this.interactiveLocal,
    );
  }

  /**
   * Render a user-requested preview (completion details, reference hover, or
   * a visual table/diagram input) without waiting behind whole-document work.
   */
  public renderInteractive(
    input: MathPreviewRenderInput,
    scale: number,
  ): Promise<MathPreviewWorkerSuccess> {
    return this.renderInternal(
      "interactive",
      input,
      scale,
      this.interactiveWorker,
      this.interactiveLocal,
    );
  }

  private renderInternal(
    lane: RenderLane,
    input: MathPreviewRenderInput,
    scale: number,
    worker: MathPreviewWorkerClient,
    local: LocalLatexPreviewRenderer,
    cursorMarkerColor?: string,
    latestOnly = false,
  ): Promise<MathPreviewWorkerSuccess> {
    if (this.disposed) {
      return Promise.reject(new Error("Visual editor renderer is disposed."));
    }
    const usesLocalRenderer = local.supports(input);
    const key = JSON.stringify([
      "texleaf-visual-editor-v4",
      usesLocalRenderer ? "local" : "mathjax",
      input.tex,
      input.display,
      input.macroFingerprint,
      scale,
      cursorMarkerColor,
    ]);
    const completed = lane === "cursor" ? this.cursorCache : this.completedCache;
    const cached = completed.get(key);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    // Pending work stays lane-specific: an interactive request may duplicate a
    // background render instead of inheriting the background queue's latency.
    const inFlightKey = `${lane}\u0000${key}`;
    const existing = this.inFlight.get(inFlightKey);
    if (existing !== undefined) {
      return existing;
    }

    const epoch = this.cacheEpoch;
    const rendered = usesLocalRenderer
      ? local.render(input, scale, cursorMarkerColor)
      : worker[latestOnly ? "renderLatest" : "render"]({
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
    this.cursorLocal.dispose();
    this.interactiveLocal.dispose();
  }
}
