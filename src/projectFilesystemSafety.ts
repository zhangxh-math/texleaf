/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { lstat, mkdir, realpath } from "node:fs/promises";
import * as path from "node:path";
import type * as vscode from "vscode";

export interface RealProjectRootIdentity {
  readonly realPath: string;
  readonly device: number;
  readonly inode: number;
  readonly birthtimeMs: number;
}

export interface RealProjectRoot extends RealProjectRootIdentity {
  readonly uri: vscode.Uri;
}

export interface RealProjectResource {
  readonly uri: vscode.Uri;
  readonly rootRealPath: string;
  readonly resourceRealPath: string;
}

export function isExtensionHostFilesystemUri(uri: vscode.Uri): boolean {
  // TeXLeaf runs with extensionKind=workspace. On Remote SSH/WSL/Dev
  // Containers, vscode-remote fsPath therefore belongs to this Node host.
  return (uri.scheme === "file" || uri.scheme === "vscode-remote") &&
    uri.query.length === 0 && uri.fragment.length === 0;
}

export function isProtectedProjectPathSegment(value: string): boolean {
  const identity = value.normalize("NFC").toLocaleLowerCase("en-US");
  return identity === ".git" || identity === ".texleaf";
}

/**
 * Resolve an existing project root without following a symlink/junction at the
 * root entry itself. Operating systems may expose a real directory below a
 * benign aliased ancestor (for example macOS /var -> /private/var), so the
 * canonical path and native file identity are used instead of requiring the
 * lexical and canonical paths to be equal. Callers may retain realPath as the
 * lease identity and re-run this function before committing a mutation.
 */
export async function validateExistingRealProjectRoot(
  api: typeof vscode,
  root: vscode.Uri,
  expectedIdentity?: RealProjectRootIdentity,
): Promise<RealProjectRoot> {
  if (!isExtensionHostFilesystemUri(root)) {
    throw new Error(
      "项目写入只支持当前扩展宿主上的本地文件夹或 VS Code 远程工作区",
    );
  }
  const lexicalRootPath = path.resolve(root.fsPath);
  const [reported, native] = await Promise.all([
    api.workspace.fs.stat(root),
    lstat(lexicalRootPath),
  ]);
  if (
    (reported.type & api.FileType.Directory) === 0 ||
    (reported.type & api.FileType.SymbolicLink) !== 0 ||
    !native.isDirectory() ||
    native.isSymbolicLink()
  ) {
    throw new Error("项目根目录必须是现存的真实普通文件夹，不能是符号链接或目录联接");
  }
  const resolved = await realpath(lexicalRootPath);
  const [nativeAfterResolution, resolvedNative] = await Promise.all([
    lstat(lexicalRootPath),
    lstat(resolved),
  ]);
  if (
    !nativeAfterResolution.isDirectory() ||
    nativeAfterResolution.isSymbolicLink() ||
    !resolvedNative.isDirectory() ||
    resolvedNative.isSymbolicLink() ||
    !sameNativeFileIdentity(native, nativeAfterResolution) ||
    !sameNativeFileIdentity(nativeAfterResolution, resolvedNative)
  ) {
    throw new Error("项目根目录的真实文件系统身份在路径解析期间发生变化");
  }
  if (expectedIdentity !== undefined && (
    !sameNativePath(resolved, expectedIdentity.realPath) ||
    resolvedNative.dev !== expectedIdentity.device ||
    resolvedNative.ino !== expectedIdentity.inode ||
    resolvedNative.birthtimeMs !== expectedIdentity.birthtimeMs
  )) {
    throw new Error("项目根目录的真实文件系统身份在操作期间发生变化");
  }
  return Object.freeze({
    uri: root,
    realPath: resolved,
    device: resolvedNative.dev,
    inode: resolvedNative.ino,
    birthtimeMs: resolvedNative.birthtimeMs,
  });
}

export async function validateExistingRealProjectFile(
  api: typeof vscode,
  root: vscode.Uri,
  relativePath: string,
): Promise<RealProjectResource> {
  return validateExistingRealProjectResource(api, root, relativePath, "file", false);
}

export async function validateExistingRealProjectDirectory(
  api: typeof vscode,
  root: vscode.Uri,
  relativePath: string,
): Promise<RealProjectResource> {
  return validateExistingRealProjectResource(api, root, relativePath, "directory", false);
}

/** The one protected resource that project-metadata mutations may address. */
export async function validateExistingRealProjectManifestFile(
  api: typeof vscode,
  root: vscode.Uri,
): Promise<RealProjectResource> {
  return validateExistingRealProjectResource(
    api,
    root,
    ".texleaf/project.json",
    "file",
    true,
  );
}

/**
 * Create exactly the metadata directory entry, never its parent, then prove it
 * is a real direct child of the already validated project root.
 */
export async function ensureRealProjectMetadataDirectory(
  api: typeof vscode,
  root: vscode.Uri,
  expectedRootIdentity: RealProjectRootIdentity,
): Promise<RealProjectResource> {
  await validateExistingRealProjectRoot(api, root, expectedRootIdentity);
  const directory = api.Uri.joinPath(root, ".texleaf");
  try {
    await mkdir(directory.fsPath, { recursive: false });
  } catch (error: unknown) {
    if (!isAlreadyExists(error)) throw error;
  }
  return validateExistingRealProjectResource(
    api,
    root,
    ".texleaf",
    "directory",
    true,
    expectedRootIdentity,
  );
}

/**
 * Resolve a manifest-owned output directory. Missing tail segments are valid,
 * but every existing ancestor must be a real directory inside the project.
 */
export async function validateSafeProjectOutputDirectory(
  api: typeof vscode,
  root: vscode.Uri,
  relativePath: string,
): Promise<string> {
  const segments = safeRelativeSegments(relativePath, false);
  const validatedRoot = await validateExistingRealProjectRoot(api, root);
  let current = root;
  let currentRealPath = validatedRoot.realPath;
  for (const [index, segment] of segments.entries()) {
    current = api.Uri.joinPath(current, segment);
    let native;
    try {
      native = await lstat(current.fsPath);
    } catch (error: unknown) {
      if (!isFileNotFound(error)) throw error;
      const unresolved = path.join(currentRealPath, ...segments.slice(index));
      assertStrictlyContained(validatedRoot.realPath, unresolved);
      return unresolved;
    }
    if (native.isSymbolicLink() || !native.isDirectory()) {
      throw new Error("构建输出目录的既有路径不能包含链接或非目录资源");
    }
    const reported = await api.workspace.fs.stat(current);
    if (
      (reported.type & api.FileType.SymbolicLink) !== 0 ||
      (reported.type & api.FileType.Directory) === 0
    ) {
      throw new Error("构建输出目录的既有路径必须是普通真实文件夹");
    }
    const resolved = await realpath(current.fsPath);
    assertStrictlyContained(validatedRoot.realPath, resolved);
    currentRealPath = resolved;
  }
  return currentRealPath;
}

async function validateExistingRealProjectResource(
  api: typeof vscode,
  root: vscode.Uri,
  relativePath: string,
  expectedKind: "file" | "directory",
  allowProtectedInternal: boolean,
  expectedRootIdentity?: RealProjectRootIdentity,
): Promise<RealProjectResource> {
  const segments = safeRelativeSegments(relativePath, allowProtectedInternal);
  const validatedRoot = await validateExistingRealProjectRoot(
    api,
    root,
    expectedRootIdentity,
  );
  let candidate = root;
  for (const [index, segment] of segments.entries()) {
    candidate = api.Uri.joinPath(candidate, segment);
    const [reported, native] = await Promise.all([
      api.workspace.fs.stat(candidate),
      lstat(candidate.fsPath),
    ]);
    if (
      (reported.type & api.FileType.SymbolicLink) !== 0 ||
      native.isSymbolicLink()
    ) {
      throw new Error("项目资源路径不能经过符号链接或目录联接");
    }
    const final = index === segments.length - 1;
    const requireDirectory = !final || expectedKind === "directory";
    if (requireDirectory) {
      if ((reported.type & api.FileType.Directory) === 0 || !native.isDirectory()) {
        throw new Error("项目资源的上级路径必须是普通真实文件夹");
      }
    } else if ((reported.type & api.FileType.File) === 0 || !native.isFile()) {
      throw new Error("项目资源必须是普通真实文件");
    }
  }
  const resolved = await realpath(candidate.fsPath);
  assertStrictlyContained(validatedRoot.realPath, resolved);
  return Object.freeze({
    uri: candidate,
    rootRealPath: validatedRoot.realPath,
    resourceRealPath: resolved,
  });
}

function safeRelativeSegments(
  relativePath: string,
  allowProtectedInternal: boolean,
): readonly string[] {
  const normalized = relativePath.normalize("NFC");
  if (
    normalized.length === 0 ||
    normalized.length > 4_096 ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(normalized) ||
    normalized.startsWith("/") ||
    normalized.startsWith("\\") ||
    normalized.endsWith("/") ||
    normalized.includes("\\") ||
    normalized.includes("%") ||
    /^[a-z]:/iu.test(normalized) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(normalized)
  ) {
    throw new Error("项目资源路径无效");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) =>
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    /[<>:"|?*]/u.test(segment) ||
    segment.endsWith(".") ||
    segment.endsWith(" ") ||
    isWindowsReservedName(segment) ||
    (!allowProtectedInternal && isProtectedProjectPathSegment(segment))
  )) {
    throw new Error("项目资源路径包含保留或不安全的路径段");
  }
  if (
    allowProtectedInternal &&
    !(segments.length === 1 && isProtectedProjectPathSegment(segments[0]!) ||
      segments.length === 2 &&
        segments[0]!.normalize("NFC").toLocaleLowerCase("en-US") === ".texleaf" &&
        segments[1] === "project.json")
  ) {
    throw new Error("受保护项目资源路径不在允许范围内");
  }
  return segments;
}

function isWindowsReservedName(segment: string): boolean {
  const baseName = (segment.split(".", 1)[0] ?? segment).replace(/[ .]+$/u, "");
  return /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/iu.test(
    baseName,
  );
}

function sameNativePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value).normalize("NFC");
    return process.platform === "win32"
      ? resolved.toLocaleLowerCase("en-US")
      : resolved;
  };
  return normalize(left) === normalize(right);
}

interface NativeFileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly birthtimeMs: number;
}

function sameNativeFileIdentity(
  left: NativeFileIdentity,
  right: NativeFileIdentity,
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtimeMs === right.birthtimeMs;
}

function assertStrictlyContained(rootRealPath: string, candidatePath: string): void {
  const relative = path.relative(rootRealPath, candidatePath);
  if (
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error("项目资源的真实路径不在项目根目录内");
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { readonly code?: unknown }).code === "EEXIST";
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT";
}
