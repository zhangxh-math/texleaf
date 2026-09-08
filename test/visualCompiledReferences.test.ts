/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test, { type TestContext } from "node:test";
import type * as vscode from "vscode";
import type { LatexProjectContext, LatexProjectFile } from "../src/latexProjectContext";
import type { VisualCompiledBuild } from "../src/visualCompiledReferences";
import { loadVisualCompiledReferences } from "../src/visualCompiledReferences";

class TestUri {
  readonly scheme = "file";
  readonly authority = "";
  readonly query = "";
  readonly fragment = "";
  constructor(readonly fsPath: string) {}
  toString(): string { return `file://${this.fsPath}`; }
}
const uri = (value: string): vscode.Uri => new TestUri(value) as unknown as vscode.Uri;
const api = {
  Uri: { joinPath: (base: TestUri, ...parts: string[]) => uri(path.join(base.fsPath, ...parts)) },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  workspace: {
    isTrusted: true,
    textDocuments: [],
    fs: { stat: async (resource: TestUri) => {
      const info = await lstat(resource.fsPath);
      return { type: info.isSymbolicLink() ? 64 : info.isDirectory() ? 2 : info.isFile() ? 1 : 0, size: info.size };
    } },
  },
} as unknown as typeof vscode;

async function fixture(t: TestContext, aux = "\\newlabel{eq:one}{{2.1}{8}}\n") {
  const base = await mkdtemp(path.join(tmpdir(), "texleaf-compiled-refs-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const project = path.join(base, "project");
  await mkdir(project);
  const rootFile = path.join(project, "main.tex");
  const auxFile = path.join(project, "main.aux");
  const text = "\\documentclass{article}\n\\begin{document}x\\end{document}\n";
  const now = Math.floor(Date.now() / 1000) * 1000;
  await writeFile(rootFile, text);
  await utimes(rootFile, new Date(now - 5000), new Date(now - 5000));
  await writeFile(auxFile, aux);
  await utimes(auxFile, new Date(now - 2000), new Date(now - 2000));
  const source = { uri: uri(rootFile), text, dirty: false, reachableFromRoot: true } as LatexProjectFile;
  const context = { rootUri: uri(rootFile), workspaceUri: uri(project), files: [source], graphIncomplete: false,
    bodyExecution: { slices: [], incomplete: false } } as unknown as LatexProjectContext;
  const result = { status: "success", rootFile, startedAt: now - 3000, finishedAt: now - 1000,
    artifacts: { auxFile }, tool: "latexmk" } as VisualCompiledBuild;
  return { base, project, rootFile, auxFile, now, context, result, source };
}

test("compiled references read only the literal first group, including hyperref records", async (t) => {
  const f = await fixture(t, String.raw`\newlabel{eq:one}{{2.1}{8}{A title}{equation.2.1}{}}
\newlabel{eq:appendix}{{A.2}{9}}
\newlabel{eq:roman}{{iv}{10}}
\newlabel{eq:macro}{{\theequation}{10}}
\newlabel{eq:nested}{{{3}}{10}}
\newlabel{eq:empty}{{}{10}}
% \newlabel{eq:comment}{{7}{10}}
\def\x{\newlabel{eq:definition}{{7}{10}}}
`);
  assert.deepEqual([...await loadVisualCompiledReferences(api, f.context, f.result)], [["eq:one", "2.1"], ["eq:appendix", "A.2"], ["eq:roman", "iv"]]);
});

test("compiled references reject unavailable, failed, mismatched, and incomplete builds", async (t) => {
  const f = await fixture(t);
  for (const result of [undefined, { ...f.result, status: "failure" as const }, { ...f.result, startedAt: null },
    { ...f.result, rootFile: path.join(f.project, "other.tex") }]) {
    assert.equal((await loadVisualCompiledReferences(api, f.context, result as VisualCompiledBuild | undefined)).size, 0);
  }
  assert.equal((await loadVisualCompiledReferences(api, { ...f.context, graphIncomplete: true }, f.result)).size, 0);
  assert.equal((await loadVisualCompiledReferences(api, { ...f.context, bodyExecution: { slices: [], incomplete: true } }, f.result)).size, 0);
});

test("compiled references reject dirty buffers and disk text that differs from the source snapshot", async (t) => {
  const f = await fixture(t);
  assert.equal((await loadVisualCompiledReferences(api, { ...f.context, files: [{ ...f.source, dirty: true }] }, f.result)).size, 0);
  await writeFile(f.rootFile, "changed on disk");
  await utimes(f.rootFile, new Date(f.now - 5000), new Date(f.now - 5000));
  assert.equal((await loadVisualCompiledReferences(api, f.context, f.result)).size, 0);
});

test("compiled references require source-before-build and aux-after-source timestamps", async (t) => {
  const f = await fixture(t);
  await utimes(f.rootFile, new Date(f.now - 2000), new Date(f.now - 2000));
  assert.equal((await loadVisualCompiledReferences(api, f.context, f.result)).size, 0);
  await utimes(f.rootFile, new Date(f.now - 5000), new Date(f.now - 5000));
  await utimes(f.auxFile, new Date(f.now - 6000), new Date(f.now - 6000));
  assert.equal((await loadVisualCompiledReferences(api, f.context, f.result)).size, 0);
  await utimes(f.auxFile, new Date(f.now), new Date(f.now));
  assert.equal((await loadVisualCompiledReferences(api, f.context, f.result)).size, 0);
});

test("compiled references accept unchanged aux from a successful no-op build", async (t) => {
  const f = await fixture(t);
  await utimes(f.auxFile, new Date(f.now - 4000), new Date(f.now - 4000));
  assert.equal((await loadVisualCompiledReferences(api, f.context, f.result)).get("eq:one"), "2.1");
});

test("compiled references reject aux symlinks or paths outside the project", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.base, "outside.aux");
  await writeFile(outside, "\\newlabel{outside}{{9}{1}}\n");
  const outsideResult = { ...f.result, artifacts: { ...f.result.artifacts, auxFile: outside } };
  assert.equal((await loadVisualCompiledReferences(api, f.context, outsideResult)).size, 0);
  await rm(f.auxFile);
  await symlink(outside, f.auxFile);
  assert.equal((await loadVisualCompiledReferences(api, f.context, f.result)).size, 0);
});

test("compiled references validate every reachable source and reject linked sources", async (t) => {
  const f = await fixture(t);
  const child = path.join(f.project, "chapter.tex");
  await writeFile(child, "child text");
  await utimes(child, new Date(f.now - 5000), new Date(f.now - 5000));
  const context = { ...f.context, files: [f.source, { ...f.source, uri: uri(child), text: "child text" }] };
  assert.equal((await loadVisualCompiledReferences(api, context, f.result)).get("eq:one"), "2.1");
  await writeFile(child, "changed child");
  await utimes(child, new Date(f.now - 5000), new Date(f.now - 5000));
  assert.equal((await loadVisualCompiledReferences(api, context, f.result)).size, 0);
  await rm(child);
  const outside = path.join(f.base, "outside.tex");
  await writeFile(outside, "child text");
  await utimes(outside, new Date(f.now - 5000), new Date(f.now - 5000));
  await symlink(outside, child);
  assert.equal((await loadVisualCompiledReferences(api, context, f.result)).size, 0);
});

test("compiled references reject current dirty documents even with a clean earlier snapshot", async (t) => {
  const f = await fixture(t);
  const dirtyApi = { ...api, workspace: { ...api.workspace, textDocuments: [
    { uri: uri(f.rootFile), isDirty: true, getText: () => f.source.text },
  ] } } as unknown as typeof vscode;
  assert.equal((await loadVisualCompiledReferences(dirtyApi, f.context, f.result)).size, 0);
});

test("compiled references discard a label if another record supplies an unexpanded value", async (t) => {
  const f = await fixture(t, "\\newlabel{eq:one}{{2.1}{8}}\n\\newlabel{eq:one}{{\\theequation}{8}}\n");
  assert.equal((await loadVisualCompiledReferences(api, f.context, f.result)).size, 0);
});

test("compiled references traverse bounded literal aux inputs and discard duplicate keys", async (t) => {
  const f = await fixture(t, "\\newlabel{eq:one}{{2.1}{8}}\n\\@input{chapter.aux}\n");
  const child = path.join(f.project, "chapter.aux");
  await writeFile(child, "\\newlabel{eq:one}{{2.1}{8}}\n\\newlabel{eq:two}{{3}{9}}\n");
  await utimes(child, new Date(f.now - 2000), new Date(f.now - 2000));
  assert.deepEqual([...await loadVisualCompiledReferences(api, f.context, f.result)], [["eq:two", "3"]]);
});

test("compiled references fail closed for unresolved, escaping, or cyclic aux inputs", async (t) => {
  const f = await fixture(t);
  for (const target of ["missing.aux", "../outside.aux", "main.aux", "\\dynamic.aux"]) {
    await writeFile(f.auxFile, `\\newlabel{eq:one}{{2.1}{8}}\n\\@input{${target}}\n`);
    await utimes(f.auxFile, new Date(f.now - 2000), new Date(f.now - 2000));
    assert.equal((await loadVisualCompiledReferences(api, f.context, f.result)).size, 0, target);
  }
});

test("compiled references reject oversized aux files and untrusted workspaces", async (t) => {
  const f = await fixture(t);
  const untrusted = { ...api, workspace: { ...api.workspace, isTrusted: false } } as typeof vscode;
  assert.equal((await loadVisualCompiledReferences(untrusted, f.context, f.result)).size, 0);
  await writeFile(f.auxFile, "x".repeat(1024 * 1024 + 1));
  await utimes(f.auxFile, new Date(f.now - 2000), new Date(f.now - 2000));
  assert.equal((await loadVisualCompiledReferences(api, f.context, f.result)).size, 0);
});
