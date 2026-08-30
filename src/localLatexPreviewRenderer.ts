/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { execFile, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createLocalLatexPreviewDocument,
  localLatexPreviewKind,
  sanitizeLocalLatexSvg,
  VISUAL_FORMULA_FOREGROUND,
  type MathPreviewRenderInput,
} from "./core";
import type { MathPreviewWorkerSuccess } from "./mathPreviewProtocol";

const LOCAL_PREVIEW_QUEUE_SIZE = 12;
const LOCAL_PREVIEW_TIMEOUT_MS = 15_000;
const LOCAL_PREVIEW_MAX_OUTPUT_BYTES = 1_000_000;

interface LocalPreviewRequest {
  readonly input: MathPreviewRenderInput;
  readonly scale: number;
  readonly cursorMarkerColor?: string;
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
  private active = false;
  private disposed = false;

  public supports(input: MathPreviewRenderInput): boolean {
    return localLatexPreviewKind(input) !== undefined;
  }

  public render(
    input: MathPreviewRenderInput,
    scale: number,
    cursorMarkerColor?: string,
  ): Promise<MathPreviewWorkerSuccess> {
    if (this.disposed) {
      return Promise.reject(new Error("Local LaTeX preview renderer is disposed."));
    }
    if (!this.supports(input)) {
      return Promise.reject(new Error("The source is not a supported local LaTeX preview."));
    }
    return new Promise<MathPreviewWorkerSuccess>((resolve, reject) => {
      this.queued.push({
        input,
        scale,
        ...(cursorMarkerColor === undefined ? {} : { cursorMarkerColor }),
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
      child.kill();
    }
    this.children.clear();
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
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
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
      const child = execFile(
        executable,
        [...args],
        {
          cwd,
          env,
          windowsHide: true,
          timeout: LOCAL_PREVIEW_TIMEOUT_MS,
          maxBuffer: LOCAL_PREVIEW_MAX_OUTPUT_BYTES,
        },
        (error, stdout, stderr) => {
          this.children.delete(child);
          if (error === null) {
            resolve();
            return;
          }
          const details = conciseProcessError(stderr || stdout || error.message);
          reject(new Error(`${executable} failed: ${details}`));
        },
      );
      this.children.add(child);
    });
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
