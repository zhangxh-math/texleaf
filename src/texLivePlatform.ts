/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { readdir } from "node:fs/promises";
import * as path from "node:path";

const DEFAULT_UNIX_TEX_LIVE_ROOT = "/usr/local/texlive";
const MAX_RELEASE_DIRECTORIES = 24;

export interface TexLivePlatformOptions {
  readonly platform?: NodeJS.Platform;
  readonly architecture?: NodeJS.Architecture;
  readonly installationRoot?: string;
  readonly releaseNames?: readonly string[];
  readonly currentYear?: number;
}

/**
 * Return the standard TeX Live binary locations for one desktop platform.
 *
 * PATH remains authoritative: callers append these candidates after PATH.
 * MacTeX's stable active-distribution symlink is checked first on macOS. The
 * versioned Unix tree candidates cover a stock install-tl installation when a
 * GUI-launched VS Code did not inherit the user's login-shell PATH.
 */
export function texLiveBinDirectoryCandidates(
  options: TexLivePlatformOptions = {},
): readonly string[] {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  if (platform !== "darwin" && platform !== "linux") {
    return Object.freeze([]);
  }

  const installationRoot = normalizePosixAbsoluteRoot(
    options.installationRoot ?? DEFAULT_UNIX_TEX_LIVE_ROOT,
  );
  const currentYear = normalizeReleaseYear(
    options.currentYear ?? new Date().getUTCFullYear(),
  );
  const releases = normalizeReleaseNames(
    options.releaseNames ?? ["current", String(currentYear)],
  );
  const platformTags = texLivePlatformTags(platform, architecture);
  const versioned = releases.flatMap((release) =>
    platformTags.map((tag) => path.posix.join(
      installationRoot,
      release,
      "bin",
      tag,
    ))
  );

  return Object.freeze(uniquePathEntries(
    platform === "darwin"
      ? [
          "/Library/TeX/texbin",
          "/opt/homebrew/bin",
          "/usr/local/bin",
          ...versioned,
        ]
      : [
          "/usr/local/bin",
          "/usr/bin",
          ...versioned,
        ],
    platform,
  ));
}

/** Discover numeric TeX Live releases without following arbitrary trees. */
export async function discoverTexLiveBinDirectories(
  options: TexLivePlatformOptions = {},
): Promise<readonly string[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") {
    return Object.freeze([]);
  }
  if (options.releaseNames !== undefined) {
    return texLiveBinDirectoryCandidates(options);
  }

  const installationRoot = normalizePosixAbsoluteRoot(
    options.installationRoot ?? DEFAULT_UNIX_TEX_LIVE_ROOT,
  );
  const currentYear = normalizeReleaseYear(
    options.currentYear ?? new Date().getUTCFullYear(),
  );
  const discovered: string[] = [];
  try {
    const entries = await readdir(installationRoot, { withFileTypes: true });
    for (const entry of entries.slice(0, 512)) {
      if (
        (entry.isDirectory() || entry.isSymbolicLink()) &&
        /^\d{4}$/u.test(entry.name)
      ) {
        discovered.push(entry.name);
      }
    }
  } catch {
    // A missing or unreadable default installation root is normal. PATH,
    // MacTeX's stable symlink and an explicit binPath remain available.
  }
  discovered.sort((left, right) => Number(right) - Number(left));
  const releases = [
    "current",
    String(currentYear),
    ...discovered,
  ].filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, MAX_RELEASE_DIRECTORIES);
  return texLiveBinDirectoryCandidates({
    ...options,
    installationRoot,
    currentYear,
    releaseNames: releases,
  });
}

/** Prepend a resolved TeX executable directory for latexmk child tools. */
export function prependPathDirectories(
  source: Readonly<NodeJS.ProcessEnv>,
  directories: readonly string[],
  platform: NodeJS.Platform = process.platform,
): Readonly<NodeJS.ProcessEnv> {
  return mergePathDirectories(source, directories, "prepend", platform);
}

/** Append fallback locations while preserving the user's PATH selection. */
export function appendPathDirectories(
  source: Readonly<NodeJS.ProcessEnv>,
  directories: readonly string[],
  platform: NodeJS.Platform = process.platform,
): Readonly<NodeJS.ProcessEnv> {
  return mergePathDirectories(source, directories, "append", platform);
}

/** Normalize the single directory accepted by the VS Code build setting. */
export function normalizeConfiguredTexBinPath(value: string): string | undefined {
  let entry = value.trim();
  if (entry.startsWith('"') && entry.endsWith('"') && entry.length >= 2) {
    entry = entry.slice(1, -1).trim();
  }
  if (entry.length === 0 || entry.includes("\0") || /[\r\n]/u.test(entry)) {
    return undefined;
  }
  return path.resolve(entry);
}

function mergePathDirectories(
  source: Readonly<NodeJS.ProcessEnv>,
  directories: readonly string[],
  position: "prepend" | "append",
  platform: NodeJS.Platform,
): Readonly<NodeJS.ProcessEnv> {
  const result: NodeJS.ProcessEnv = { ...source };
  const windows = platform === "win32";
  const pathKeys = Object.keys(result).filter((key) =>
    windows ? key.toLocaleUpperCase("en-US") === "PATH" : key === "PATH"
  );
  const key = pathKeys[0] ?? "PATH";
  const delimiter = windows ? ";" : ":";
  const existing = pathKeys
    .map((candidate) => result[candidate] ?? "")
    .filter((value) => value.length > 0)
    .join(delimiter);
  if (windows) {
    for (const candidate of pathKeys) {
      if (candidate !== key) {
        delete result[candidate];
      }
    }
  }

  const requested = directories.map((value) => normalizePathEntry(value, platform))
    .filter(isPresent);
  const inherited = existing.split(delimiter)
    .map((value) => normalizePathEntry(value, platform))
    .filter(isPresent);
  const entries = uniquePathEntries(
    position === "prepend"
      ? [...requested, ...inherited]
      : [...inherited, ...requested],
    platform,
  );
  if (entries.length > 0 || pathKeys.length > 0) {
    result[key] = entries.join(delimiter);
  }
  return Object.freeze(result);
}

function texLivePlatformTags(
  platform: "darwin" | "linux",
  architecture: NodeJS.Architecture,
): readonly string[] {
  if (platform === "darwin") {
    return ["universal-darwin"];
  }
  switch (architecture) {
    case "x64":
      return ["x86_64-linux", "x86_64-linuxmusl"];
    case "arm64":
      return ["aarch64-linux", "aarch64-linuxmusl"];
    case "arm":
      return ["armhf-linux"];
    case "ia32":
      return ["i386-linux"];
    case "ppc64":
      return ["powerpc64le-linux"];
    case "riscv64":
      return ["riscv64-linux"];
    case "s390x":
      return ["s390x-linux"];
    default:
      return [];
  }
}

function normalizeReleaseNames(values: readonly string[]): string[] {
  return values
    .filter((value) => value === "current" || /^\d{4}$/u.test(value))
    .filter((value, index, entries) => entries.indexOf(value) === index)
    .slice(0, MAX_RELEASE_DIRECTORIES);
}

function normalizeReleaseYear(value: number): number {
  return Number.isSafeInteger(value) && value >= 2000 && value <= 9999
    ? value
    : new Date().getUTCFullYear();
}

function normalizePosixAbsoluteRoot(value: string): string {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    /[\r\n]/u.test(value) ||
    !path.posix.isAbsolute(value)
  ) {
    return DEFAULT_UNIX_TEX_LIVE_ROOT;
  }
  return path.posix.normalize(value);
}

function normalizePathEntry(
  value: string,
  platform: NodeJS.Platform,
): string | undefined {
  let entry = value.trim();
  if (entry.startsWith('"') && entry.endsWith('"') && entry.length >= 2) {
    entry = entry.slice(1, -1).trim();
  }
  if (entry.length === 0 || entry.includes("\0") || /[\r\n]/u.test(entry)) {
    return undefined;
  }
  return platform === "win32"
    ? path.win32.normalize(entry)
    : path.posix.normalize(entry);
}

function uniquePathEntries(
  entries: readonly string[],
  platform: NodeJS.Platform,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    const key = platform === "win32"
      ? entry.toLocaleLowerCase("en-US")
      : entry;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
