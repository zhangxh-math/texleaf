/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import * as path from "node:path";
import type * as vscode from "vscode";
import type { LatexProjectContext } from "./latexProjectContext";
import { isExtensionHostFilesystemUri, validateExistingRealProjectFile } from "./projectFilesystemSafety";

export interface VisualCompiledBuild {
  readonly status: "success";
  readonly rootFile: string;
  readonly tool: "latexmk" | "pdflatex" | "xelatex" | "lualatex";
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly artifacts: { readonly auxFile: string };
}

const MAX_AUX_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/** Read literal reference numbers from this project's last successful build; never execute aux code. */
export async function loadVisualCompiledReferences(
  api: typeof vscode,
  context: LatexProjectContext,
  result: VisualCompiledBuild | undefined,
): Promise<ReadonlyMap<string, string>> {
  const empty = new Map<string, string>();
  const root = context.rootUri;
  if (!api.workspace.isTrusted || root === undefined || !isExtensionHostFilesystemUri(root) ||
      context.graphIncomplete || context.bodyExecution.incomplete || result?.status !== "success" ||
      result.startedAt === null || !Number.isFinite(result.startedAt) || !Number.isFinite(result.finishedAt) ||
      result.finishedAt < result.startedAt || path.resolve(result.rootFile) !== path.resolve(root.fsPath) ||
      !["latexmk", "pdflatex", "xelatex", "lualatex"].includes(result.tool)) return empty;
  const boundary = context.workspaceUri ?? api.Uri.joinPath(root, "..");
  const startedAt = result.startedAt;
  const sources = context.files.filter((file) => file.reachableFromRoot);
  if (sources.length === 0 || sources.length > 256 || !sources.some((file) => file.uri.toString() === root.toString())) return empty;
  try {
    // Check both the supplied snapshot and current buffers: async disk reads may outlive a document edit.
    const verifySources = async (): Promise<number> => {
      let newest = 0;
      let total = 0;
      for (const source of sources) {
        const live = api.workspace.textDocuments.find((document) => document.uri.toString() === source.uri.toString());
        if (source.dirty || !isExtensionHostFilesystemUri(source.uri) || source.uri.scheme !== root.scheme ||
            source.uri.authority !== root.authority || (live !== undefined && (live.isDirty || live.getText() !== source.text))) {
          throw new Error("Changed source buffer");
        }
        const file = await readVerifiedFile(api, boundary, source.uri.fsPath, MAX_SOURCE_BYTES);
        total += file.bytes.length;
        if (total > 32 * 1024 * 1024 || file.mtimeMs > startedAt ||
            !file.bytes.equals(Buffer.from(source.text, "utf8"))) throw new Error("Changed source file");
        newest = Math.max(newest, file.mtimeMs);
      }
      return newest;
    };
    const newestSource = await verifySources();
    const references = new Map<string, string>();
    const seenLabels = new Set<string>();
    const seenFiles = new Set<string>();
    const auxDirectory = path.dirname(result.artifacts.auxFile);
    let totalAuxBytes = 0;
    const visit = async (filename: string): Promise<void> => {
      const identity = path.resolve(filename);
      if (seenFiles.has(identity) || seenFiles.size >= 64 || path.extname(filename).toLowerCase() !== ".aux") throw new Error("Ambiguous aux graph");
      seenFiles.add(identity);
      const file = await readVerifiedFile(api, boundary, filename, MAX_AUX_BYTES);
      totalAuxBytes += file.bytes.length;
      // An unchanged aux is valid after a successful latexmk no-op, provided it is newer than every source.
      if (totalAuxBytes > 4 * MAX_AUX_BYTES || file.mtimeMs < newestSource || file.mtimeMs > result.finishedAt) throw new Error("Stale aux file");
      for (const line of file.bytes.toString("utf8").split(/\r?\n/u)) {
        const input = /^\s*\\@input\b/u.exec(line);
        if (input !== null) {
          const group = readGroup(line, input[0].length);
          if (group === undefined || !/^\s*(?:%.*)?$/u.test(line.slice(group.end)) ||
              !/^[^\\{}%\x00-\x1f]+\.aux$/u.test(group.text) || path.isAbsolute(group.text) ||
              group.text.split(/[\\/]/u).includes("..")) throw new Error("Unresolved aux input");
          await visit(path.resolve(auxDirectory, group.text));
          continue;
        }
        const command = /^\s*\\newlabel\b/u.exec(line);
        if (command === null) continue;
        const key = readGroup(line, command[0].length);
        const value = key === undefined ? undefined : readGroup(line, key.end);
        if (key === undefined || value === undefined || !/^\s*(?:%.*)?$/u.test(line.slice(value.end)) ||
            !/^[^\\{}%\x00-\x1f]{1,256}$/u.test(key.text)) throw new Error("Malformed aux label");
        if (seenLabels.has(key.text)) { references.delete(key.text); continue; }
        seenLabels.add(key.text);
        const first = readGroup(value.text, 0);
        // Literal counters only: no macro expansion, nested formatting, page guessing, or arbitrary titles.
        if (first !== undefined && first.text.length <= 64 &&
            /^(?:[A-Za-z]?\d+[A-Za-z]?|[A-Za-z]|[ivxlcdmIVXLCDM]+)(?:[.:-](?:[A-Za-z]?\d+[A-Za-z]?|[A-Za-z]|[ivxlcdmIVXLCDM]+))*$/u.test(first.text)) {
          references.set(key.text, first.text);
        }
      }
    };
    await visit(result.artifacts.auxFile);
    if (await verifySources() !== newestSource) return empty;
    return references;
  } catch {
    // Missing, stale, linked, oversized, or otherwise uncertain artifacts leave references unknown.
    return empty;
  }
}

async function readVerifiedFile(api: typeof vscode, boundary: vscode.Uri, filename: string, limit: number) {
  const relative = path.relative(boundary.fsPath, filename).split(path.sep).join("/");
  const resource = await validateExistingRealProjectFile(api, boundary, relative);
  const handle = await open(resource.resourceRealPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit) throw new Error("Oversized project file");
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    const checked = await validateExistingRealProjectFile(api, boundary, relative);
    const current = await lstat(checked.resourceRealPath);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs || checked.resourceRealPath !== resource.resourceRealPath ||
        !current.isFile() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino ||
        current.size !== before.size || current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs) throw new Error("Project file changed during read");
    return { bytes: buffer.subarray(0, length), mtimeMs: before.mtimeMs };
  } finally {
    await handle.close();
  }
}

function readGroup(text: string, offset: number): { text: string; end: number } | undefined {
  while (/\s/u.test(text[offset] ?? "") && offset < text.length) offset++;
  if (text[offset] !== "{") return undefined;
  const start = ++offset;
  let depth = 1;
  for (; offset < text.length; offset++) {
    if (text[offset] === "\\") { offset++; continue; }
    if (text[offset] === "{") depth++;
    if (text[offset] === "}" && --depth === 0) return { text: text.slice(start, offset), end: offset + 1 };
  }
  return undefined;
}
