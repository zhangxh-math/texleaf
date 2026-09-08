/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { execFile, type ChildProcess } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import {
  appendPathDirectories, discoverTexLiveBinDirectories,
  normalizeConfiguredTexBinPath, prependPathDirectories,
} from "./texLivePlatform";

export interface TexSystemInputRequest {
  readonly projectDirectory: string;
  readonly workingDirectory?: string;
  readonly binPath?: string;
}

export interface TexSystemInputCommandOptions {
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly timeout: number;
  readonly maxBuffer: number;
}

export interface TexSystemInputResolverOptions {
  readonly platformDirectories?: readonly string[];
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly run?: (
    args: readonly string[], options: TexSystemInputCommandOptions,
  ) => Promise<string>;
}

export class TexSystemInputResolver {
  private readonly directories: Promise<readonly string[]>;
  private readonly cache = new Map<string, Promise<boolean>>();
  private readonly roots = new Map<string, Promise<readonly string[]>>();
  private readonly children = new Set<ChildProcess>();
  private pending: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private disposed = false;

  public constructor(private readonly options: TexSystemInputResolverOptions = {}) {
    this.directories = options.platformDirectories === undefined
      ? discoverTexLiveBinDirectories() : Promise.resolve(options.platformDirectories);
  }

  public isSystemInput(name: string, request: TexSystemInputRequest): Promise<boolean> {
    if (this.disposed || !isSimpleTexSystemInputName(name)) return Promise.resolve(false);
    const binPath = normalizeConfiguredTexBinPath(request.binPath ?? "");
    const configurationKey = JSON.stringify([
      request.projectDirectory, request.workingDirectory, binPath,
    ]);
    const key = JSON.stringify([configurationKey, name]);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    // Bound both retained results and native work until configuration invalidation.
    if (this.cache.size >= 128) return Promise.resolve(false);
    const generation = this.generation;
    const pending = this.pending.then(async () => {
      if (this.disposed || generation !== this.generation) return false;
      try {
        const env = prependPathDirectories(
          appendPathDirectories(this.options.environment ?? process.env, await this.directories),
          binPath === undefined ? [] : [binPath],
        );
        const commandOptions: TexSystemInputCommandOptions = {
          cwd: request.workingDirectory ?? request.projectDirectory,
          env, timeout: 2_000, maxBuffer: 16_384,
        };
        let roots = this.roots.get(configurationKey);
        if (roots === undefined) {
          roots = this.libraryRoots(commandOptions);
          this.roots.set(configurationKey, roots);
        }
        const libraryRoots = await roots;
        if (libraryRoots.length === 0) return false;
        const output = singleAbsolutePath(await this.run([
          "--no-mktex=tex", "--format=tex", "--must-exist", name,
        ], commandOptions));
        if (output === undefined) return false;
        const file = await realpath(output);
        const project = await realpath(request.projectDirectory);
        return !containsPath(project, file) &&
          libraryRoots.some(root => containsPath(root, file)) && (await stat(file)).isFile();
      } catch {
        return false;
      }
    });
    this.cache.set(key, pending);
    this.pending = pending;
    return pending;
  }

  public invalidate(): void {
    this.generation += 1;
    this.cache.clear();
    this.roots.clear();
  }

  public dispose(): void {
    this.disposed = true;
    this.invalidate();
    for (const child of this.children) child.kill();
  }

  private async libraryRoots(options: TexSystemInputCommandOptions): Promise<readonly string[]> {
    const roots: string[] = [];
    for (const variable of ["TEXMFDIST", "TEXMFLOCAL"]) {
      try {
        const output = singleAbsolutePath(await this.run([`--var-value=${variable}`], options));
        if (output !== undefined) {
          const root = await realpath(output);
          if ((await stat(root)).isDirectory()) roots.push(root);
        }
      } catch {
        // Missing tools, unavailable roots and timeouts cannot establish a library.
      }
    }
    return roots;
  }

  private run(args: readonly string[], options: TexSystemInputCommandOptions): Promise<string> {
    if (this.options.run !== undefined) return this.options.run(args, options);
    return new Promise((resolve, reject) => {
      const child = execFile(process.platform === "win32" ? "kpsewhich.exe" : "kpsewhich", args, {
        ...options, encoding: "utf8", windowsHide: true,
      }, (error, stdout) => {
        this.children.delete(child);
        if (error !== null) reject(error); else resolve(stdout);
      });
      this.children.add(child);
    });
  }
}

export function isSimpleTexSystemInputName(name: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_-]*(?:\.tex)?$/u.test(name);
}

function singleAbsolutePath(output: string): string | undefined {
  const value = output.trim();
  return value.length > 0 && !/[\r\n\0]/u.test(value) && path.isAbsolute(value) ? value : undefined;
}

function containsPath(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
