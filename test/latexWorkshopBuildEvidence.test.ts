/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Run the complete bridge; only the external VS Code/Workshop runtimes are substituted.
function fixture(filename = "main.tex") {
  const rootFile = path.resolve("/tmp/texleaf-evidence", filename);
  const directory = path.dirname(rootFile);
  const uri = { fsPath: rootFile, scheme: "file", toString: () => rootFile };
  const document = { fileName: rootFile, uri, languageId: "latex", getText: () => "\\documentclass{article}" };
  const listeners = new Set<(value: unknown) => void>();
  const api = {
    EventEmitter: class {
      event = (listener: (value: unknown) => void) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; };
      fire(value: unknown) { for (const listener of listeners) listener(value); }
    },
    workspace: { saveAll: async () => true, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  };
  const lw = {
    root: { file: { path: rootFile, langId: "latex" } },
    file: { getAuxDir: () => directory, getJobname: () => path.basename(rootFile, ".tex"), getLangId: () => "latex" },
    locate: { synctex: {} },
  };
  let result: unknown = { status: "succeeded" };
  const plan: any = { rootFile, isExternal: false, cwd: directory,
    // Workshop's %DOC% placeholder omits .tex.
    steps: [{ command: "pdflatex", cwd: directory, args: ["-interaction=nonstopmode", rootFile.slice(0, -4)] }],
    async run() { return result; } };
  let pending: any;
  const executor: any = { preparePlan: async () => undefined,
    async run(request: unknown) { pending = await this.preparePlan(request); } };
  const extensionPath = path.resolve("/tmp/workshop-evidence");
  const cache = Object.fromEntries(Object.entries({
    "lw.js": { lw }, "compile/executor.js": { executor },
    "compile/recipe.js": { Recipe: { create: async () => ({}), createExternal: () => undefined } },
    "compile/plan.js": { Plan: { create: () => plan } },
  }).map(([name, exports]) => [path.join(extensionPath, "out/src", name), { exports }]));
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync("src/latexWorkshopBridge.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, process, require: (id: string) => id === "vscode" ? api
    : id === "node:module" ? { createRequire: () => ({ cache }) }
    : id === "./visualEditorProtocol" ? {} : require(id) });
  return { bridge: exports, plan, lw, rootFile, setResult: (value: unknown) => { result = value; },
    queue: () => exports.runLatexWorkshopInBackground({ extensionPath, packageJSON: {}, activate: async () => undefined }, "latex-workshop.build", document, {}),
    execute: () => pending.run() };
}

test("Workshop publishes evidence only after the queued plan actually succeeds", async () => {
  const f = fixture();
  assert.equal(typeof f.bridge.onDidCompleteLatexWorkshopBuild, "function");
  const events: any[] = [];
  const subscription = f.bridge.onDidCompleteLatexWorkshopBuild((value: unknown) => events.push(value));
  await f.queue();
  assert.equal(events.length, 0, "queue acceptance is not build success");
  await f.execute();
  assert.equal(events.length, 1);
  assert.equal(events[0].rootFile, f.rootFile);
  assert.equal(events[0].tool, "pdflatex");
  assert.equal(events[0].artifacts.auxFile, path.join(path.dirname(f.rootFile), "main.aux"));
  assert.ok(events[0].startedAt <= events[0].finishedAt);
  subscription.dispose();
  await f.execute();
  assert.equal(events.length, 1);
});

test("Workshop failures, cancellation, unknown tools and conflicting paths publish no evidence", async () => {
  for (const mode of ["failed", "cancelled", "external", "script", "path", "jobname", "legacy", "latexmk-config", "script-option", "wrong-root"]) {
    const f = fixture();
    assert.equal(typeof f.bridge.onDidCompleteLatexWorkshopBuild, "function");
    const events: unknown[] = [];
    f.bridge.onDidCompleteLatexWorkshopBuild((value: unknown) => events.push(value));
    if (mode === "failed" || mode === "cancelled") f.setResult({ status: mode });
    if (mode === "external") f.plan.isExternal = true;
    if (mode === "script") f.plan.steps[0].command = "custom-build";
    if (mode === "path") f.plan.steps[0].args.unshift("-output-directory=elsewhere");
    if (mode === "jobname") f.plan.steps[0].args.unshift("-jobname=other");
    if (mode === "legacy") delete f.plan.run;
    if (mode === "latexmk-config") f.plan.steps[0].command = "latexmk";
    if (mode === "script-option") f.plan.steps[0].args.unshift("-e", "system('custom-build')");
    if (mode === "wrong-root") f.plan.steps[0].args = ["other.tex"];
    await f.queue();
    if (mode !== "legacy") await f.execute();
    assert.equal(events.length, 0, mode);
  }
});

test("Workshop accepts explicit latexmk without rc files and matching output directories", async () => {
  const f = fixture();
  f.plan.steps[0].command = "latexmk";
  f.plan.steps[0].args.unshift("-norc", "-pdf", "-outdir=build");
  f.lw.file.getAuxDir = () => path.join(path.dirname(f.rootFile), "build");
  const events: any[] = [];
  f.bridge.onDidCompleteLatexWorkshopBuild((value: unknown) => events.push(value));
  await f.queue();
  await f.execute();
  assert.equal(events.length, 1);
  assert.equal(events[0].tool, "latexmk");
  assert.equal(events[0].artifacts.auxFile, path.join(path.dirname(f.rootFile), "build/main.aux"));
});

test("Workshop preserves dots in jobnames when locating the compiled aux", async () => {
  const f = fixture("paper.v2.tex");
  const events: any[] = [];
  f.bridge.onDidCompleteLatexWorkshopBuild((value: unknown) => events.push(value));
  await f.queue();
  await f.execute();
  assert.equal(events.length, 1);
  assert.equal(events[0].artifacts.auxFile, path.join(path.dirname(f.rootFile), "paper.v2.aux"));
});
