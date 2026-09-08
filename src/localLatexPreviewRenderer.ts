/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { terminateTexProcessTree } from "./build/processRunner";
import {
  createLocalLatexPreviewDocument,
  localLatexPreviewKind,
  sanitizeLocalLatexSvg,
  VISUAL_FORMULA_FOREGROUND,
  type MathPreviewRenderInput,
} from "./core";
import type { MathPreviewWorkerSuccess } from "./mathPreviewProtocol";
import {
  appendPathDirectories,
  discoverTexLiveBinDirectories,
  normalizeConfiguredTexBinPath,
  prependPathDirectories,
} from "./texLivePlatform";

const LOCAL_PREVIEW_QUEUE_SIZE = 12;
const LOCAL_PREVIEW_TIMEOUT_MS = 15_000;
const LOCAL_PREVIEW_MAX_OUTPUT_BYTES = 1_000_000;

interface LocalPreviewRequest {
  readonly input: MathPreviewRenderInput;
  readonly scale: number;
  readonly cursorMarkerColor?: string;
  readonly binPath?: string;
  readonly resolve: (value: MathPreviewWorkerSuccess) => void;
  readonly reject: (reason: Error) => void;
}

/**
 * A bounded, serial local-TeX renderer for structures that MathJax cannot
 * represent faithfully.  TeX invocations never use a shell, shell escape is
 * disabled, and kpathsea is placed in paranoid read/write mode.
 */
export class LocalLatexPreviewRenderer {
  private readonly queued: LocalPreviewRequest[] = [];
  private readonly children = new Set<ChildProcess>();
  private readonly terminations = new Map<ChildProcess, Promise<void>>();
  private readonly texLiveBinDirectories = discoverTexLiveBinDirectories();
  private active = false;
  private disposed = false;

  public supports(input: MathPreviewRenderInput): boolean {
    return localLatexPreviewKind(input) !== undefined;
  }

  public render(
    input: MathPreviewRenderInput,
    scale: number,
    cursorMarkerColor?: string,
    binPath?: string,
  ): Promise<MathPreviewWorkerSuccess> {
    if (this.disposed) {
      return Promise.reject(new Error("Local LaTeX preview renderer is disposed."));
    }
    if (!this.supports(input)) {
      return Promise.reject(new Error("The source is not a supported local LaTeX preview."));
    }
    const normalizedBinPath = binPath === undefined
      ? undefined
      : normalizeConfiguredTexBinPath(binPath);
    return new Promise<MathPreviewWorkerSuccess>((resolve, reject) => {
      this.queued.push({
        input,
        scale,
        ...(cursorMarkerColor === undefined ? {} : { cursorMarkerColor }),
        ...(normalizedBinPath === undefined ? {} : { binPath: normalizedBinPath }),
        resolve,
        reject,
      });
      while (this.queued.length > LOCAL_PREVIEW_QUEUE_SIZE) {
        this.queued.shift()?.reject(
          new Error("Local LaTeX preview dropped an obsolete queued render."),
        );
      }
      void this.pump();
    });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const request of this.queued.splice(0)) {
      request.reject(new Error("Local LaTeX preview renderer stopped."));
    }
    for (const child of this.children) {
      void this.terminateChild(child);
    }
  }

  private async pump(): Promise<void> {
    if (this.disposed || this.active) {
      return;
    }
    const request = this.queued.shift();
    if (request === undefined) {
      return;
    }
    this.active = true;
    try {
      request.resolve(await this.renderNow(request));
    } catch (error: unknown) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.active = false;
      void this.pump();
    }
  }

  private async renderNow(request: LocalPreviewRequest): Promise<MathPreviewWorkerSuccess> {
    const kind = localLatexPreviewKind(request.input);
    const document = createLocalLatexPreviewDocument(
      request.input,
      VISUAL_FORMULA_FOREGROUND,
    );
    if (kind === undefined || document === undefined) {
      throw new Error("The local LaTeX preview source did not pass validation.");
    }
    const directory = await mkdtemp(path.join(tmpdir(), "texleaf-local-preview-"));
    const sourcePath = path.join(directory, "preview.tex");
    const dviPath = path.join(directory, "preview.dvi");
    const svgPath = path.join(directory, "preview.svg");
    try {
      await writeFile(sourcePath, document, { encoding: "utf8", flag: "wx" });
      const platformDirectories = await this.texLiveBinDirectories;
      const inheritedEnvironment = appendPathDirectories(
        process.env,
        platformDirectories,
      );
      const toolEnvironment = request.binPath === undefined
        ? inheritedEnvironment
        : prependPathDirectories(inheritedEnvironment, [request.binPath]);
      const environment: NodeJS.ProcessEnv = {
        ...toolEnvironment,
        openin_any: "p",
        openout_any: "p",
        shell_escape: "f",
        TEXMFOUTPUT: directory,
        max_print_line: "512",
      };
      await this.run("latex", [
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        "-no-shell-escape",
        path.basename(sourcePath),
      ], directory, environment);
      await this.run("dvisvgm", [
        "--no-fonts",
        "--exact-bbox",
        "--bbox=min",
        `--output=${path.basename(svgPath)}`,
        path.basename(dviPath),
      ], directory, environment);
      const rawSvg = await readFile(svgPath, "utf8");
      const fingerprint = createHash("sha256")
        .update(request.input.tex)
        .update(request.input.macroFingerprint)
        .digest("hex")
        .slice(0, 16);
      const asset = sanitizeLocalLatexSvg(
        rawSvg,
        request.scale,
        VISUAL_FORMULA_FOREGROUND,
        `texleaf-${kind}-${fingerprint}`,
        kind,
        request.cursorMarkerColor,
      );
      return {
        type: "result",
        id: 0,
        svg: asset.svg,
        widthEm: asset.widthEm,
        heightEm: asset.heightEm,
        ...(asset.cursorMarked
          ? { cursor: { x: 0, y: 0, width: 0.09, height: 1.2 } }
          : {}),
      };
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private run(
    executable: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let timedOut = false;
      let settled = false;
      let child: ChildProcess;
      try {
        child = spawn(executable, [...args], {
          cwd,
          env,
          windowsHide: true,
          shell: false,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const stdout = new LocalPreviewOutputBuffer(LOCAL_PREVIEW_MAX_OUTPUT_BYTES);
      const stderr = new LocalPreviewOutputBuffer(LOCAL_PREVIEW_MAX_OUTPUT_BYTES);
      this.children.add(child);
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        timedOut = true;
        void this.terminateChild(child);
      }, LOCAL_PREVIEW_TIMEOUT_MS);
      timeout.unref();

      const finish = (error: Error | undefined): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.children.delete(child);
        this.terminations.delete(child);
        if (error === undefined) {
          resolve();
          return;
        }
        const details = conciseProcessError(
          stderr.text() || stdout.text() || error.message,
        );
        reject(new Error(
          timedOut
            ? `${executable} timed out after ${LOCAL_PREVIEW_TIMEOUT_MS} ms: ${details}`
            : `${executable} failed: ${details}`,
        ));
      };
      child.stdout?.on("data", (chunk: Buffer | string) => stdout.append(chunk));
      child.stderr?.on("data", (chunk: Buffer | string) => stderr.append(chunk));
      const finishAfterTermination = (error: Error | undefined): void => {
        const termination = this.terminations.get(child);
        if (termination === undefined) {
          finish(error);
          return;
        }
        void termination.then(() => finish(error));
      };
      child.once("error", (error: Error) => finishAfterTermination(error));
      child.once("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
        finishAfterTermination(exitCode === 0
          ? undefined
          : new Error(signal === null
            ? `process exited with code ${exitCode ?? "unknown"}`
            : `process was terminated by ${signal}`));
      });
    });
  }

  private terminateChild(child: ChildProcess): Promise<void> {
    const existing = this.terminations.get(child);
    if (existing !== undefined) {
      return existing;
    }
    const termination = terminateTexProcessTree(child);
    this.terminations.set(child, termination);
    return termination;
  }
}

class LocalPreviewOutputBuffer {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  public constructor(private readonly limit: number) {}

  public append(value: Buffer | string): void {
    const source = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const remaining = this.limit - this.size;
    if (remaining <= 0) {
      return;
    }
    const retained = source.length <= remaining ? source : source.subarray(0, remaining);
    this.chunks.push(Buffer.from(retained));
    this.size += retained.length;
  }

  public text(): string {
    return Buffer.concat(this.chunks, this.size).toString("utf8");
  }
}

function conciseProcessError(value: string): string {
  const lines = value
    .replaceAll("\0", "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const latexError = lines.find((line) => line.startsWith("!")) ??
    lines.find((line) => /error|failed|not found/iu.test(line));
  return (latexError ?? lines.at(-1) ?? "unknown local TeX error").slice(0, 400);
}
