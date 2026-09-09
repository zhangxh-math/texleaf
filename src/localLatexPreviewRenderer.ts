/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import type * as vscode from "vscode";
import { validateExistingRealProjectFile } from "./projectFilesystemSafety";
import { visualImageSourcePaths } from "./core/visualStructure";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir, rename, readdir, lstat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { terminateTexProcessTree } from "./build/processRunner";
import { createLocalLatexPreviewDocument, localLatexPreviewKind, sanitizeLocalLatexSvg,
  LocalLatexPreviewModeRequiredError, localLatexPreviewEngine } from "./core/localLatexPreview";
import { VISUAL_FORMULA_FOREGROUND } from "./core/visualFormula";
import type { MathPreviewRenderInput } from "./core/mathPreview";
import type { MathPreviewWorkerSuccess } from "./mathPreviewProtocol";
import { appendPathDirectories, discoverTexLiveBinDirectories, normalizeConfiguredTexBinPath,
  prependPathDirectories } from "./texLivePlatform";

const LOCAL_PREVIEW_QUEUE_SIZE = 12;
const LOCAL_PREVIEW_TIMEOUT_MS = 15_000;
const LOCAL_PREVIEW_MAX_OUTPUT_BYTES = 1_000_000;
const LOCAL_PREVIEW_CACHE_BYTES = 48 * 1024 * 1024;
const LOCAL_PREVIEW_DISK_BYTES = 128 * 1024 * 1024;
const LOCAL_PREVIEW_MAX_SVG_BYTES = 4_000_000;

export interface LocalPreviewRenderOptions {
  readonly priority?: boolean;
  readonly signal?: AbortSignal | undefined;
  readonly retry?: boolean;
}
class LocalPreviewCancelledError extends Error {
  constructor() { super("图形预览已取消。"); }
}
interface LocalPreviewRequest {
  readonly key: string;
  readonly input: MathPreviewRenderInput;
  readonly document: string;
  readonly binPath: string | undefined;
  readonly resolve: (value: string) => void;
  readonly reject: (reason: Error) => void;
  readonly promise: Promise<string>;
  readonly controller: AbortController;
  consumers: number;
  priority: boolean;
}

/** One bounded local-TeX queue, shared by document, hover and editing consumers.
 * No shell/shell escape; outputs are sanitized before caching and on disk reads.
 */
export class LocalLatexPreviewRenderer {
  private readonly queued: LocalPreviewRequest[] = [];
  private readonly children = new Set<ChildProcess>();
  private readonly terminations = new Map<ChildProcess, Promise<void>>();
  private readonly texLiveBinDirectories = discoverTexLiveBinDirectories();
  private readonly jobs = new Map<string, LocalPreviewRequest>();
  private readonly completed = new Map<string, string>();
  private readonly failures = new Map<string, Error>();
  private cacheBytes = 0;
  private maximumDiskBytes = LOCAL_PREVIEW_DISK_BYTES;
  private readonly diskAccess = new Map<string, number>();
  private current: LocalPreviewRequest | undefined;
  private disposed = false;
  private clearing = false;

  public constructor(private readonly options: { readonly cacheDirectory?: string | undefined; readonly quiverPackagePath?: string | undefined } = {}) {}

  public supports(input: MathPreviewRenderInput): boolean {
    return localLatexPreviewKind(input) !== undefined;
  }

  public render(input: MathPreviewRenderInput, scale: number, cursorMarkerColor?: string,
    binPath?: string, options: LocalPreviewRenderOptions = {}): Promise<MathPreviewWorkerSuccess> {
    if (this.disposed) return Promise.reject(new Error("Local LaTeX preview renderer is disposed."));
    if (this.clearing) return Promise.reject(new LocalPreviewCancelledError());
    if (input.compatibilityMode !== "maximum") return Promise.reject(new LocalLatexPreviewModeRequiredError());
    if (options.signal?.aborted) return Promise.reject(new LocalPreviewCancelledError());
    const document = createLocalLatexPreviewDocument(input, VISUAL_FORMULA_FOREGROUND);
    if (document === undefined) return Promise.reject(new Error("此内容暂不支持增强预览，请编辑源码或查看 PDF。"));
    const normalizedBinPath = binPath === undefined ? undefined : normalizeConfiguredTexBinPath(binPath);
    // Effective TeX document, not document revision/position or UI scale, owns identity.
    const hash = createHash("sha256").update("local-preview-v3\0").update(document)
      .update("\0").update(localLatexPreviewEngine(input)).update("\0").update(normalizedBinPath ?? "PATH");
    for (const file of [...(input.localFiles ?? [])].sort((a,b) => a.name.localeCompare(b.name))) {
      hash.update("\0").update(file.name).update("\0").update(file.contents);
    }
    const key = hash.digest("hex");
    if (options.retry) this.failures.delete(key);
    const failure = this.failures.get(key);
    if (failure !== undefined) return Promise.reject(failure);
    const cached = this.completed.get(key);
    if (cached !== undefined) {
      this.completed.delete(key); this.completed.set(key, cached);
      this.touchCache(key);
      return Promise.resolve(this.asset(cached, input, key, scale, cursorMarkerColor));
    }
    let job = this.jobs.get(key);
    if (job?.controller.signal.aborted) job = undefined;
    if (job === undefined) {
      let resolve!: (value: string) => void, reject!: (error: Error) => void;
      const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
      job = { key, input, document, binPath: normalizedBinPath, resolve, reject,
        promise, controller: new AbortController(), consumers: 0, priority: options.priority === true };
      this.jobs.set(key, job); this.queued.push(job);
      while (this.queued.length > LOCAL_PREVIEW_QUEUE_SIZE) {
        const ordinary = this.queued.findIndex(candidate => !candidate.priority);
        const dropped = this.queued.splice(ordinary < 0 ? this.queued.length - 1 : ordinary, 1)[0]!;
        this.jobs.delete(dropped.key); dropped.controller.abort(); dropped.reject(new LocalPreviewCancelledError());
      }
    }
    if (options.priority) {
      job.priority = true;
      const index = this.queued.indexOf(job);
      if (index > 0) { this.queued.splice(index, 1); this.queued.unshift(job); }
    }
    const result = this.subscribe(job, options.signal).then(raw => this.asset(raw, input, key, scale, cursorMarkerColor));
    void this.pump();
    return result;
  }

  private asset(raw: string, input: MathPreviewRenderInput, key: string, scale: number,
    cursorMarkerColor?: string): MathPreviewWorkerSuccess {
    const asset = sanitizeLocalLatexSvg(raw, scale, VISUAL_FORMULA_FOREGROUND,
      `texleaf-local-${key.slice(0, 16)}`, localLatexPreviewKind(input), cursorMarkerColor);
    return { type: "result", id: 0, svg: asset.svg, widthEm: asset.widthEm, heightEm: asset.heightEm,
      ...(asset.cursorMarked ? { cursor: { x: 0, y: 0, width: 0.09, height: 1.2 } } : {}) };
  }

  private subscribe(job: LocalPreviewRequest, signal?: AbortSignal): Promise<string> {
    job.consumers += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = (): boolean => {
        if (settled) return false;
        settled = true; signal?.removeEventListener("abort", abort); job.consumers -= 1;
        return true;
      };
      const abort = (): void => {
        if (!release()) return;
        reject(new LocalPreviewCancelledError());
        if (job.consumers !== 0) return;
        job.controller.abort();
        const index = this.queued.indexOf(job);
        if (index >= 0) {
          this.queued.splice(index, 1); this.jobs.delete(job.key); job.reject(new LocalPreviewCancelledError());
        }
        if (this.current === job) for (const child of this.children) void this.terminateChild(child);
      };
      signal?.addEventListener("abort", abort, { once: true });
      job.promise.then(value => { if (release()) resolve(value); }, error => { if (release()) reject(error); });
      if (signal?.aborted) abort();
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of this.queued.splice(0)) { job.controller.abort(); job.reject(new LocalPreviewCancelledError()); }
    this.current?.controller.abort(); this.jobs.clear();
    for (const child of this.children) void this.terminateChild(child);
  }

  public retryFailures(): void { this.failures.clear(); }

  public async clearCache(): Promise<void> {
    if (this.clearing) return;
    this.clearing = true;
    try {
      for (const job of this.queued.splice(0)) {
        job.controller.abort(); job.reject(new LocalPreviewCancelledError());
      }
      const current = this.current;
      current?.controller.abort();
      for (const child of this.children) void this.terminateChild(child);
      await current?.promise.catch(() => undefined);
      this.jobs.clear(); this.completed.clear(); this.failures.clear();
      this.cacheBytes = 0; this.diskAccess.clear();
      const directory = this.options.cacheDirectory;
      if (directory !== undefined) {
        for (const name of await readdir(directory).catch(() => [] as string[])) {
          if (/^[a-f0-9]{64}\.svg$/u.test(name)) await rm(path.join(directory, name), { force: true });
        }
      }
    } finally { this.clearing = false; }
  }

  public async setCacheLimitMB(mebibytes: number): Promise<void> {
    const limit = Number.isFinite(mebibytes) ? Math.max(16, Math.min(2048, Math.floor(mebibytes))) : 128;
    const bytes = limit * 1024 * 1024;
    if (this.maximumDiskBytes === bytes) return;
    this.maximumDiskBytes = bytes;
    await this.pruneCache().catch(() => undefined);
  }

  private async pump(): Promise<void> {
    if (this.disposed || this.clearing || this.current !== undefined) return;
    const request = this.queued.shift();
    if (request === undefined) return;
    this.current = request;
    try {
      let raw = await this.readCache(request.key);
      if (request.controller.signal.aborted) throw new LocalPreviewCancelledError();
      if (raw === undefined) {
        raw = await this.renderNow(request);
        if (request.controller.signal.aborted) throw new LocalPreviewCancelledError();
        this.asset(raw, request.input, request.key, 1);
        await this.writeCache(request.key, raw);
      }
      this.completed.set(request.key, raw); this.cacheBytes += Buffer.byteLength(raw);
      while (this.completed.size > 256 || this.cacheBytes > LOCAL_PREVIEW_CACHE_BYTES) {
        const oldest = this.completed.entries().next().value;
        if (oldest === undefined) break;
        this.completed.delete(oldest[0]); this.cacheBytes -= Buffer.byteLength(oldest[1]);
      }
      request.resolve(raw);
    } catch (error: unknown) {
      const failure = request.controller.signal.aborted ? new LocalPreviewCancelledError()
        : error instanceof Error ? error : new Error(String(error));
      if (!(failure instanceof LocalPreviewCancelledError) && !this.disposed) {
        this.failures.set(request.key, failure);
        if (this.failures.size > 256) this.failures.delete(this.failures.keys().next().value!);
      }
      request.reject(failure);
    } finally {
      if (this.jobs.get(request.key) === request) this.jobs.delete(request.key);
      this.current = undefined; void this.pump();
    }
  }

  private async renderNow(request: LocalPreviewRequest): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "texleaf-local-preview-"));
    try {
      await writeFile(path.join(directory, "preview.tex"), request.document, { encoding: "utf8", flag: "wx" });
      if (this.options.quiverPackagePath && /% texleaf-quiver-v1:/u.test(request.input.tex)) {
        await writeFile(path.join(directory, "quiver.sty"), await readFile(this.options.quiverPackagePath), {flag: "wx"});
      }
      for (const file of request.input.localFiles ?? []) await writeFile(path.join(directory, file.name), file.contents, { flag: "wx" });
      const inherited = appendPathDirectories(process.env, await this.texLiveBinDirectories);
      const environment: NodeJS.ProcessEnv = {
        ...(request.binPath === undefined ? inherited : prependPathDirectories(inherited, [request.binPath])),
        openin_any: "p", openout_any: "p", shell_escape: "f", TEXMFOUTPUT: directory, max_print_line: "512",
      };
      if (request.controller.signal.aborted) throw new LocalPreviewCancelledError();
      const engine = localLatexPreviewEngine(request.input);
      const pdfOutput = engine === "pdflatex" || (request.input.localFiles?.length ?? 0) > 0;
      await this.run(engine, [...(engine === "xelatex" && !pdfOutput ? ["-no-pdf"] : []), "-interaction=nonstopmode", "-halt-on-error", "-file-line-error",
        "-no-shell-escape", "preview.tex"], directory, environment);
      if (request.controller.signal.aborted) throw new LocalPreviewCancelledError();
      try {
        await this.run("dvisvgm", ["--no-fonts", "--exact-bbox", "--bbox=min", "--embed-bitmaps", "--output=preview.svg",
          ...(pdfOutput ? ["--pdf", "preview.pdf"] : [engine === "xelatex" ? "preview.xdv" : "preview.dvi"])], directory, environment);
      } catch (error: unknown) {
        if (!pdfOutput || request.controller.signal.aborted) throw error;
        // Poppler is an existing native PDF converter on many systems. dvisvgm
        // remains first choice; current Ghostscript alone cannot convert PDFs.
        try { await this.run("pdftocairo", ["-svg", "preview.pdf", "preview.svg"], directory, environment); }
        catch { throw new Error(`PDF 图形转换失败；需要 dvisvgm 的 mutool 支持或 pdftocairo。${error instanceof Error ? error.message : String(error)}`); }
      }
      const file = path.join(directory, "preview.svg");
      if ((await lstat(file)).size > LOCAL_PREVIEW_MAX_SVG_BYTES) throw new Error("图形预览输出过大。");
      return await readFile(file, "utf8");
    } finally { await rm(directory, { recursive: true, force: true }).catch(() => undefined); }
  }

  private async readCache(key: string): Promise<string | undefined> {
    if (this.options.cacheDirectory === undefined) return undefined;
    try {
      const file = path.join(this.options.cacheDirectory, `${key}.svg`), info = await lstat(file);
      if (!info.isFile() || info.size > LOCAL_PREVIEW_MAX_SVG_BYTES) return undefined;
      const raw = await readFile(file, "utf8");
      sanitizeLocalLatexSvg(raw, 1);
      this.touchCache(key);
      return raw;
    } catch { return undefined; }
  }

  private async writeCache(key: string, raw: string): Promise<void> {
    const directory = this.options.cacheDirectory;
    if (directory === undefined || this.disposed) return;
    const temporary = path.join(directory, `${key}.${process.pid}.tmp`);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporary, raw, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path.join(directory, `${key}.svg`));
      this.diskAccess.set(key, Date.now());
      await this.pruneCache();
    } catch { /* A full/read-only cache must not make a valid preview fail. */ }
    finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }

  private touchCache(key: string): void {
    const directory = this.options.cacheDirectory, now = Date.now();
    if (directory === undefined || now - (this.diskAccess.get(key) ?? 0) < 30_000) return;
    this.diskAccess.set(key, now);
    if (this.diskAccess.size > 512) this.diskAccess.delete(this.diskAccess.keys().next().value!);
    const date = new Date(now);
    void utimes(path.join(directory, `${key}.svg`), date, date).catch(() => undefined);
  }

  private async pruneCache(): Promise<void> {
    const directory = this.options.cacheDirectory;
    if (directory === undefined) return;
    const entries = [];
    for (const name of await readdir(directory)) {
      if (!/^[a-f0-9]{64}\.svg$/u.test(name)) continue;
      const file = path.join(directory, name), info = await lstat(file);
      if (info.isFile()) entries.push({ file, size: info.size,
        time: Math.max(info.mtimeMs, this.diskAccess.get(name.slice(0, -4)) ?? 0) });
    }
    entries.sort((a,b) => a.time - b.time);
    let bytes = entries.reduce((sum,entry) => sum + entry.size, 0);
    while (entries.length > 256 || bytes > this.maximumDiskBytes) {
      const oldest = entries.shift(); if (oldest === undefined) break;
      await rm(oldest.file, { force: true }); bytes -= oldest.size;
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

/** Resolve paths at the host boundary, then pass bytes under generated names. */
export async function prepareLocalLatexPreviewFiles(api: typeof vscode, input: MathPreviewRenderInput,
  boundary: vscode.Uri, searchRoots: readonly string[]): Promise<MathPreviewRenderInput> {
  const requests = visualImageSourcePaths(input.tex);
  if (requests.length === 0) return input;
  if (requests.length > 16) throw new Error("单幅图形包含的外部图片超过 16 个，请查看 PDF。");
  const files = new Map<string, NonNullable<MathPreviewRenderInput["localFiles"]>[number]>();
  const replacements: { from: number; to: number; name: string }[] = [];
  let total = 0;
  for (const request of requests) {
    const extension = path.extname(request.path).toLowerCase();
    const suffixes = extension === "" ? [".pdf", ".png", ".jpg", ".jpeg"] : [""];
    if (extension !== "" && ![".pdf", ".png", ".jpg", ".jpeg"].includes(extension)) throw new Error(`图形格式暂不支持：${request.path}`);
    let found: NonNullable<MathPreviewRenderInput["localFiles"]>[number] | undefined;
    for (const root of searchRoots) {
      for (const suffix of suffixes) {
        const candidate = path.resolve(root, request.path + suffix);
        const relative = path.relative(boundary.fsPath, candidate).split(path.sep).join("/");
        try {
          const resource = await validateExistingRealProjectFile(api, boundary, relative);
          const before = await lstat(resource.resourceRealPath);
          if (!before.isFile() || before.size > 16 * 1024 * 1024) continue;
          const contents = await readFile(resource.resourceRealPath);
          const after = await lstat(resource.resourceRealPath);
          if (contents.byteLength > 16 * 1024 * 1024 || before.ino !== after.ino || before.dev !== after.dev ||
              before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
          await validateExistingRealProjectFile(api, boundary, relative);
          const name = `asset-${createHash("sha256").update(contents).digest("hex")}${path.extname(candidate).toLowerCase()}`;
          found = files.get(name) ?? { name, contents, sourcePath: resource.resourceRealPath };
          if (!files.has(name)) { total += contents.byteLength; files.set(name, found); }
          break;
        } catch { /* Missing or escaping candidates never reach the TeX directory. */ }
      }
      if (found !== undefined) break;
    }
    if (found === undefined) throw new Error(`找不到项目内可安全读取的图形文件：${request.path}`);
    if (total > 32 * 1024 * 1024) throw new Error("单幅图形的外部文件超过 32 MB，请查看 PDF。");
    replacements.push({ from: request.from, to: request.to, name: found.name });
  }
  let tex = input.tex;
  for (const replacement of replacements.reverse()) tex = tex.slice(0, replacement.from) + replacement.name + tex.slice(replacement.to);
  return { ...input, tex, localFiles: [...files.values()] };
}
