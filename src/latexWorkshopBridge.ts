/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { createRequire } from "node:module";
import * as path from "node:path";
import * as vscode from "vscode";
import type { VisualCompiledBuild } from "./visualCompiledReferences";
import {
  VISUAL_EDITOR_REVEAL_OPEN_RANGE_COMMAND,
  VISUAL_EDITOR_REVEAL_RANGE_COMMAND,
} from "./visualEditorProtocol";

export type LatexWorkshopBackgroundCommand =
  | "latex-workshop.build"
  | "texleaf.build.pdflatex"
  | "texleaf.build.xelatex"
  | "texleaf.build.lualatex"
  | "texleaf.build.bibtex"
  | "texleaf.build.biber"
  | "latex-workshop.view"
  | "latex-workshop.synctex";

type LatexEngine = "pdflatex" | "xelatex" | "lualatex" | "bibtex" | "biber";

interface LatexWorkshopRootState {
  file: { path: string | undefined; langId: string | undefined };
  dir: { path: string | undefined };
  subfiles: { path: string | undefined; langId: string | undefined };
  find(): Promise<void>;
}

interface LatexWorkshopState {
  previousActive: vscode.TextEditor | LatexWorkshopEditorContext | undefined;
  root: LatexWorkshopRootState;
  file: {
    getLangId(filePath: string): string | undefined;
    getPdfPath(filePath: string): string;
    getAuxDir?(filePath: string): string;
    getJobname?(filePath: string): string;
    toUri(filePath: string): vscode.Uri;
  };
  compile: {
    isFileExcludedFromBuildOnSave?(filePath: string): boolean;
    preventAutoBuild?(): void;
  };
  viewer: {
    view(uri: vscode.Uri, mode?: string): Promise<unknown> | unknown;
  };
  locate: {
    synctex: {
      toPDF(
        pdfUri: vscode.Uri | undefined,
        args: { line: number; filePath: string },
        forcedViewer?: "auto" | "tabOrBrowser" | "external",
      ): unknown;
      toTeX?(
        data: LatexWorkshopReverseSyncData,
        pdfUri: vscode.Uri,
      ): Promise<unknown> | unknown;
      components?: {
        computeToTeX(
          data: LatexWorkshopReverseSyncData,
          pdfUri: vscode.Uri,
        ): Promise<LatexWorkshopReverseSyncRecord | undefined>;
      };
    };
  };
  cache: {
    add?(filePath: string): unknown;
    refreshCache?(filePath: string): Promise<unknown> | unknown;
  };
  event: {
    RootFileChanged?: string;
    RootFileSearched?: string;
    AutoBuildInitiated?: string;
    fire?(eventName: string, value?: unknown): unknown;
  };
}

interface LatexWorkshopExecutor {
  preparePlan: (request: LatexWorkshopBuildRequest) => Promise<unknown>;
  run(request: LatexWorkshopBuildRequest): Promise<void>;
}

interface LatexWorkshopBuildRequest {
  readonly recipeName?: string;
  readonly isAuto: boolean;
  readonly isBibChanged: boolean;
}

interface LatexWorkshopRecipeClass {
  create(
    rootFile: string,
    languageId: string,
    recipeName?: string,
  ): Promise<unknown>;
  createExternal(
    uri: vscode.Uri,
    fallbackCwd: string,
    rootFile: string | undefined,
  ): unknown;
}

interface LatexWorkshopPlanClass {
  create(recipe: unknown): unknown;
}

interface LatexWorkshopCompletionProvider {
  provide(args: {
    readonly uri: vscode.Uri;
    readonly langId: string;
    readonly line: string;
    readonly position: vscode.Position;
  }): readonly vscode.CompletionItem[] | undefined;
}

interface LatexWorkshopCompletionState {
  readonly provider: LatexWorkshopCompletionProvider;
}

interface LatexWorkshopRuntime {
  readonly lw: LatexWorkshopState;
  readonly executor: LatexWorkshopExecutor;
  readonly Recipe: LatexWorkshopRecipeClass;
  readonly Plan: LatexWorkshopPlanClass;
  readonly completion?: LatexWorkshopCompletionState;
}

interface LatexWorkshopEditorContext {
  readonly document: vscode.TextDocument;
  readonly selection: vscode.Selection;
}

interface LatexWorkshopReverseSyncData {
  readonly page: number;
  readonly pos: readonly number[];
  readonly textBeforeSelection?: string;
  readonly textAfterSelection?: string;
}

interface LatexWorkshopReverseSyncRecord {
  readonly input: string;
  readonly line: number;
  readonly column: number;
}

interface LatexWorkshopModule<T> {
  readonly [name: string]: T;
}

const runtimeCache = new Map<string, Promise<LatexWorkshopRuntime>>();
const completedBuild = new vscode.EventEmitter<VisualCompiledBuild>();
export const onDidCompleteLatexWorkshopBuild = completedBuild.event;
const visualPdfUris = new Set<string>();
const patchedSyncTeXStates = new WeakSet<object>();
const LATEX_WORKSHOP_PDF_VIEW_TYPE = "latex-workshop-pdf-hook";

/**
 * Run the LaTeX Workshop implementation without opening a native source tab.
 *
 * LaTeX Workshop's public build/view/synctex commands intentionally read
 * `window.activeTextEditor`. A VS Code custom editor has no TextEditor, so the
 * old bridge briefly displayed the source document just to satisfy that check.
 * The modules below are the same already-loaded LaTeX Workshop singletons; the
 * bridge supplies the current document and selection directly while retaining
 * its recipe runner, viewer and SyncTeX implementation.
 */
export async function runLatexWorkshopInBackground(
  extension: vscode.Extension<unknown>,
  command: LatexWorkshopBackgroundCommand,
  document: vscode.TextDocument,
  selection: vscode.Selection,
  visualViewColumn?: vscode.ViewColumn,
): Promise<void> {
  await extension.activate();
  const runtime = await loadLatexWorkshopRuntime(extension);
  switch (command) {
    case "latex-workshop.build":
      await runBuild(runtime, document, false);
      return;
    case "texleaf.build.pdflatex":
      await runBuild(runtime, document, false, "pdflatex");
      return;
    case "texleaf.build.xelatex":
      await runBuild(runtime, document, false, "xelatex");
      return;
    case "texleaf.build.lualatex":
      await runBuild(runtime, document, false, "lualatex");
      return;
    case "texleaf.build.bibtex":
      await runBuild(runtime, document, false, "bibtex");
      return;
    case "texleaf.build.biber":
      await runBuild(runtime, document, false, "biber");
      return;
    case "latex-workshop.view":
      await viewPdf(runtime, document, visualViewColumn);
      return;
    case "latex-workshop.synctex":
      await locatePdf(runtime, document, selection, visualViewColumn);
      return;
  }
}

/**
 * Reproduce LaTeX Workshop's on-save/on-file-change build while the visual
 * custom editor remains visible. Returns false when automatic building is not
 * configured for this save.
 */
export async function runLatexWorkshopAutoBuildAfterVisualSave(
  extension: vscode.Extension<unknown>,
  document: vscode.TextDocument,
): Promise<boolean> {
  const mode = vscode.workspace
    .getConfiguration("latex-workshop", document.uri)
    .get<string>("latex.autoBuild.run", "onFileChange");
  if (mode !== "onSave" && mode !== "onFileChange") {
    return false;
  }

  await extension.activate();
  const runtime = await loadLatexWorkshopRuntime(extension);
  if (
    mode === "onSave" &&
    runtime.lw.compile.isFileExcludedFromBuildOnSave?.(document.fileName) === true
  ) {
    return false;
  }
  runtime.lw.event.fire?.(
    runtime.lw.event.AutoBuildInitiated ?? "AUTO_BUILD_INITIATED",
    { type: mode, file: document.fileName },
  );
  await runBuild(runtime, document, true);
  return true;
}

/**
 * Activate the Workshop before the save event is emitted and suppress its
 * native active-editor auto-build attempt. TeXLeaf submits the equivalent
 * background build from onDidSave, so this only prevents a duplicate request
 * that would otherwise fail because a custom editor has no active TextEditor.
 */
export async function prepareLatexWorkshopVisualSave(
  extension: vscode.Extension<unknown>,
): Promise<void> {
  await extension.activate();
  const runtime = await loadLatexWorkshopRuntime(extension);
  runtime.lw.compile.preventAutoBuild?.();
}

/**
 * Install the reverse-SyncTeX bridge as soon as a visual editor is resolved.
 *
 * Previously this happened only after the user compiled/viewed/located a PDF
 * through a TeXLeaf button.  A restored LaTeX Workshop PDF tab therefore used
 * its native source opener until another TeXLeaf build happened.  Preparing
 * the shared Workshop runtime here makes the routing independent of PDF age.
 */
export async function prepareLatexWorkshopVisualEditor(
  extension: vscode.Extension<unknown>,
): Promise<void> {
  await extension.activate();
  await loadLatexWorkshopRuntime(extension);
}

/**
 * Ask LaTeX Workshop's already-activated provider for the same context-aware
 * candidates used by a native source editor. `executeCompletionItemProvider`
 * remains useful for other extensions, but it is not sufficient on its own:
 * several Workshop completers consult internal project caches and can be
 * skipped while a custom editor owns focus.
 */
export async function provideLatexWorkshopVisualCompletionItems(
  extension: vscode.Extension<unknown>,
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<readonly vscode.CompletionItem[]> {
  await extension.activate();
  const runtime = await loadLatexWorkshopRuntime(extension);
  return runtime.completion?.provider.provide({
    uri: document.uri,
    langId: document.languageId,
    line: document.lineAt(position.line).text,
    position,
  }) ?? [];
}

async function loadLatexWorkshopRuntime(
  extension: vscode.Extension<unknown>,
): Promise<LatexWorkshopRuntime> {
  const key = extension.extensionPath;
  const cached = runtimeCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const loading = Promise.resolve().then(() => {
    const packageJson = extension.packageJSON as { main?: unknown };
    const relativeMain = typeof packageJson.main === "string"
      ? packageJson.main
      : "./out/src/main.js";
    const mainPath = path.resolve(extension.extensionPath, relativeMain);
    const sourceDirectory = path.dirname(mainPath);
    const requireFromWorkshop = createRequire(
      path.join(extension.extensionPath, "package.json"),
    );
    // VS Code 1.134 may preserve the drive-letter spelling used by each
    // extension when it keys Node's module cache. On Windows that made
    // `C:\\...\\lw.js` and `c:\\...\\lw.js` two different cache entries, even
    // though they name the same file. Requiring the former created a fresh,
    // uninitialized LaTeX Workshop singleton (`lw.log` was still `{}`). Read
    // the already-activated module by a filesystem-aware cache match instead.
    const lwModule = activatedWorkshopModule<LatexWorkshopState>(
      requireFromWorkshop,
      path.join(sourceDirectory, "lw.js"),
    );
    const executorModule = activatedWorkshopModule<LatexWorkshopExecutor>(
      requireFromWorkshop,
      path.join(sourceDirectory, "compile", "executor.js"),
    );
    const recipeModule = activatedWorkshopModule<LatexWorkshopRecipeClass>(
      requireFromWorkshop,
      path.join(sourceDirectory, "compile", "recipe.js"),
    );
    const planModule = activatedWorkshopModule<LatexWorkshopPlanClass>(
      requireFromWorkshop,
      path.join(sourceDirectory, "compile", "plan.js"),
    );
    const completionModule = activatedWorkshopModuleOptional<
      LatexWorkshopCompletionState
    >(
      requireFromWorkshop,
      path.join(sourceDirectory, "completion", "index.js"),
    );
    const lw = lwModule["lw"];
    const executor = executorModule["executor"];
    const Recipe = recipeModule["Recipe"];
    const Plan = planModule["Plan"];
    const completion = completionModule?.["completion"];
    if (lw === undefined || executor === undefined || Recipe === undefined || Plan === undefined) {
      throw new Error("当前 LaTeX Workshop 版本未提供可用的后台模块接口。");
    }
    installVisualReverseSync(lw);
    return {
      lw,
      executor,
      Recipe,
      Plan,
      ...(completion === undefined ? {} : { completion }),
    };
  });
  runtimeCache.set(key, loading);
  try {
    return await loading;
  } catch (error: unknown) {
    runtimeCache.delete(key);
    throw error;
  }
}

function activatedWorkshopModule<T>(
  requireFromWorkshop: NodeJS.Require,
  requestedPath: string,
): LatexWorkshopModule<T> {
  const requestedKey = comparableModulePath(requestedPath);
  const entry = Object.entries(requireFromWorkshop.cache).find(
    ([cachePath]) => comparableModulePath(cachePath) === requestedKey,
  )?.[1];
  if (entry === undefined) {
    throw new Error(
      `LaTeX Workshop 已激活，但后台模块尚未载入：${path.basename(requestedPath)}`,
    );
  }
  return entry.exports as LatexWorkshopModule<T>;
}

function activatedWorkshopModuleOptional<T>(
  requireFromWorkshop: NodeJS.Require,
  requestedPath: string,
): LatexWorkshopModule<T> | undefined {
  const requestedKey = comparableModulePath(requestedPath);
  const entry = Object.entries(requireFromWorkshop.cache).find(
    ([cachePath]) => comparableModulePath(cachePath) === requestedKey,
  )?.[1];
  return entry?.exports as LatexWorkshopModule<T> | undefined;
}

function comparableModulePath(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}

async function runBuild(
  runtime: LatexWorkshopRuntime,
  document: vscode.TextDocument,
  isAuto: boolean,
  engine?: LatexEngine,
): Promise<void> {
  const rootFile = await ensureRoot(runtime.lw, document);
  const languageId = runtime.lw.root.file.langId ??
    runtime.lw.file.getLangId(rootFile) ?? document.languageId;
  const executor = runtime.executor;
  const originalPreparePlan = executor.preparePlan;
  const request: LatexWorkshopBuildRequest = {
    isAuto,
    isBibChanged: false,
  };

  // Executor.run calls preparePlan synchronously before its first await. Swap
  // only for that call, then restore immediately so unrelated Workshop builds
  // cannot observe the visual-editor context adapter.
  executor.preparePlan = async (pendingRequest) => {
    await vscode.workspace.saveAll();
    if (engine === undefined) {
      const external = runtime.Recipe.createExternal(
        document.uri,
        path.dirname(document.fileName),
        rootFile,
      );
      if (external !== undefined && external !== null) {
        return observeBuildPlan(runtime, runtime.Plan.create(external));
      }
    }
    const recipe = engine === undefined
      ? await runtime.Recipe.create(
          rootFile,
          languageId,
          pendingRequest.recipeName,
        )
      : explicitEngineRecipe(document.uri, rootFile, engine);
    return recipe === undefined || recipe === null
      ? undefined
      : observeBuildPlan(runtime, runtime.Plan.create(recipe));
  };

  let operation: Promise<void>;
  try {
    operation = executor.run(request);
  } finally {
    executor.preparePlan = originalPreparePlan;
  }
  await operation;
}

interface ObservedBuildPlan {
  readonly rootFile: string;
  readonly isExternal: boolean;
  readonly steps: readonly { readonly command: string; readonly cwd: string; readonly args: readonly string[] }[];
  run(): Promise<unknown>;
}

/** Observe only our own Plan instance: executor.run may return while it is still queued. */
function observeBuildPlan(runtime: LatexWorkshopRuntime, value: unknown): unknown {
  if (value === null || typeof value !== "object" || typeof (value as ObservedBuildPlan).run !== "function") return value;
  const plan = value as ObservedBuildPlan;
  const run = plan.run;
  plan.run = async function () {
    const evidence = compiledPlanEvidence(runtime, plan);
    const startedAt = Date.now();
    const result = await run.call(this);
    if (evidence !== undefined && result !== null && typeof result === "object" &&
        (result as { status?: unknown }).status === "succeeded") {
      completedBuild.fire({ ...evidence, status: "success", startedAt, finishedAt: Date.now() });
    }
    return result;
  };
  return value;
}

function compiledPlanEvidence(
  runtime: LatexWorkshopRuntime,
  plan: ObservedBuildPlan,
): Pick<VisualCompiledBuild, "rootFile" | "tool" | "artifacts"> | undefined {
  try {
    const file = runtime.lw.file;
    if (plan.isExternal !== false || typeof plan.rootFile !== "string" || !path.isAbsolute(plan.rootFile) ||
        !Array.isArray(plan.steps) || plan.steps.length === 0 ||
        typeof file.getAuxDir !== "function" || typeof file.getJobname !== "function") return undefined;
    const rootFile = plan.rootFile;
    const configuredAux = path.resolve(path.dirname(rootFile), file.getAuxDir(rootFile),
      path.basename(file.getJobname(rootFile)) + ".aux");
    let tool: VisualCompiledBuild["tool"] | undefined;
    for (const step of plan.steps) {
      tool = undefined;
      if (typeof step.command !== "string") return undefined;
      const command = path.basename(step.command).replace(/\.exe$/iu, "");
      if (command === "bibtex" || command === "biber") continue;
      if (command !== "latexmk" && command !== "pdflatex" && command !== "xelatex" && command !== "lualatex") return undefined;
      if (typeof step.cwd !== "string" || !path.isAbsolute(step.cwd) || !Array.isArray(step.args)) return undefined;
      // ponytail: custom recipes/config scripts have unbounded output rules; keep unknown until a public artifact API exists.
      if (command === "latexmk" && !step.args.includes("-norc")) return undefined;
      let outDir = step.cwd;
      let auxDir: string | undefined;
      let jobname = path.parse(rootFile).name;
      let input: string | undefined;
      const options = new Set<string>();
      for (const arg of step.args) {
        if (typeof arg !== "string" || /[\x00-\x1f]/u.test(arg)) return undefined;
        const output = /^--?(out(?:put-directory|dir|-directory)|aux(?:dir|-directory)|jobname)=(.+)$/u.exec(arg);
        if (output !== null) {
          const option = output[1]!.startsWith("out") ? "out" : output[1]!.startsWith("aux") ? "aux" : "job";
          if (options.has(option)) return undefined;
          options.add(option);
          if (option === "job") {
            if (!/^[A-Za-z0-9_.-]+$/u.test(output[2]!)) return undefined;
            jobname = output[2]!;
          } else if (option === "out") outDir = path.resolve(step.cwd, output[2]!);
          else auxDir = path.resolve(step.cwd, output[2]!);
        } else if (/^-(?:norc|pdf|xelatex|lualatex|pdflua|pdfxe|file-line-error|halt-on-error|recorder|shell-escape|no-shell-escape|synctex=[01]|interaction=(?:batchmode|nonstopmode|scrollmode|errorstopmode))$/u.test(arg)) {
          continue;
        } else if (!arg.startsWith("-") && input === undefined &&
            [arg, arg + ".tex"].some(candidate =>
              comparableModulePath(path.resolve(step.cwd, candidate)) === comparableModulePath(rootFile))) input = arg;
        else return undefined;
      }
      const auxFile = path.resolve(auxDir ?? outDir, jobname + ".aux");
      if (input === undefined || comparableModulePath(auxFile) !== comparableModulePath(configuredAux)) return undefined;
      tool = command;
    }
    return tool === undefined ? undefined : { rootFile, tool, artifacts: { auxFile: configuredAux } };
  } catch {
    // Unsupported Workshop runtime shapes must not change the existing build behavior.
    return undefined;
  }
}

function explicitEngineRecipe(
  scope: vscode.Uri,
  rootFile: string,
  engine: LatexEngine,
): object {
  const configuredTools = vscode.workspace
    .getConfiguration("latex-workshop", scope)
    .get<readonly { readonly name?: unknown }[]>("latex.tools", []);
  const configured = configuredTools.some((tool) => tool.name === engine);
  const bibliographyEngine = engine === "bibtex" || engine === "biber";
  const tool = configured
    ? engine
    : {
        name: engine,
        command: engine,
        args: bibliographyEngine
          ? ["%DOCFILE%"]
          : [
              "-synctex=1",
              "-interaction=nonstopmode",
              "-file-line-error",
              "%DOC%",
            ],
      };
  return {
    name: `TeXLeaf ${engine}`,
    tools: [tool],
    rootFile,
    cwd: path.dirname(rootFile),
    isExternal: false,
  };
}

async function viewPdf(
  runtime: LatexWorkshopRuntime,
  document: vscode.TextDocument,
  visualViewColumn?: vscode.ViewColumn,
): Promise<void> {
  const rootFile = await ensureRoot(runtime.lw, document);
  const pdfUri = runtime.lw.file.toUri(runtime.lw.file.getPdfPath(rootFile));
  markVisualPdf(pdfUri);
  const viewerMode = vscode.workspace
    .getConfiguration("latex-workshop", document.uri)
    .get<string>("view.pdf.viewer", "tab");
  if (viewerMode === "browser" || viewerMode === "external") {
    await runtime.lw.viewer.view(pdfUri, viewerMode);
    return;
  }
  await vscode.commands.executeCommand(
    "vscode.openWith",
    pdfUri,
    LATEX_WORKSHOP_PDF_VIEW_TYPE,
    {
      viewColumn: viewColumnBeside(visualViewColumn),
      preserveFocus: false,
      preview: false,
    },
  );
}

async function locatePdf(
  runtime: LatexWorkshopRuntime,
  document: vscode.TextDocument,
  selection: vscode.Selection,
  visualViewColumn?: vscode.ViewColumn,
): Promise<void> {
  const rootFile = await ensureRoot(runtime.lw, document);
  const configuration = vscode.workspace.getConfiguration(
    "latex-workshop",
    document.uri,
  );
  const subfile = runtime.lw.root.subfiles.path;
  const pdfRoot = subfile !== undefined &&
      configuration.get<boolean>("latex.rootFile.useSubFile", false)
    ? subfile
    : rootFile;
  const pdfUri = runtime.lw.file.toUri(runtime.lw.file.getPdfPath(pdfRoot));
  markVisualPdf(pdfUri);
  const viewerMode = vscode.workspace
    .getConfiguration("latex-workshop", document.uri)
    .get<string>("view.pdf.viewer", "tab");
  if (viewerMode !== "browser" && viewerMode !== "external") {
    await vscode.commands.executeCommand(
      "vscode.openWith",
      pdfUri,
      LATEX_WORKSHOP_PDF_VIEW_TYPE,
      {
        viewColumn: viewColumnBeside(visualViewColumn),
        preserveFocus: false,
        preview: false,
      },
    );
  }
  const previousActive = runtime.lw.previousActive;
  runtime.lw.previousActive = { document, selection };
  try {
    runtime.lw.locate.synctex.toPDF(pdfUri, {
      line: selection.active.line + 1,
      filePath: document.fileName,
    });
  } finally {
    runtime.lw.previousActive = previousActive;
  }
}

function installVisualReverseSync(lw: LatexWorkshopState): void {
  if (patchedSyncTeXStates.has(lw)) {
    return;
  }
  const synctex = lw.locate.synctex;
  const originalToTeX = synctex.toTeX?.bind(synctex);
  const computeToTeX = synctex.components?.computeToTeX.bind(
    synctex.components,
  );
  if (originalToTeX === undefined || computeToTeX === undefined) {
    return;
  }
  patchedSyncTeXStates.add(lw);
  synctex.toTeX = async (data, pdfUri) => {
    const registeredVisualPdf = visualPdfUris.has(normalizedUri(pdfUri));
    try {
      const record = await computeToTeX(data, pdfUri);
      if (record !== undefined) {
        const uri = lw.file.toUri(record.input);
        const document = await vscode.workspace.openTextDocument(uri);
        const position = reverseSyncPosition(document, record, data);
        const offset = document.offsetAt(position);
        const handled = await vscode.commands.executeCommand<boolean>(
          registeredVisualPdf
            ? VISUAL_EDITOR_REVEAL_RANGE_COMMAND
            : VISUAL_EDITOR_REVEAL_OPEN_RANGE_COMMAND,
          document.uri,
          offset,
          offset,
          { center: true, flash: true },
        );
        if (handled === true) {
          return;
        }
      }
    } catch {
      // Preserve LaTeX Workshop's native fallback for unsupported files or a
      // transient SyncTeX parse failure.
    }
    return originalToTeX(data, pdfUri);
  };
}

function reverseSyncPosition(
  document: vscode.TextDocument,
  record: LatexWorkshopReverseSyncRecord,
  data: LatexWorkshopReverseSyncData,
): vscode.Position {
  let row = clampInteger(record.line - 1, 0, Math.max(0, document.lineCount - 1));
  let column = record.column < 0 ? 0 : record.column;
  if (column === 0) {
    [row, column] = rowAndColumnFromSurroundingText(
      document,
      row,
      data.textBeforeSelection ?? "",
      data.textAfterSelection ?? "",
    );
  }
  const line = document.lineAt(row);
  return new vscode.Position(row, clampInteger(column, 0, line.text.length));
}

function rowAndColumnFromSurroundingText(
  document: vscode.TextDocument,
  row: number,
  before: string,
  after: string,
): [number, number] {
  for (const candidateRow of [row, row - 1, row + 1]) {
    if (candidateRow < 0 || candidateRow >= document.lineCount) {
      continue;
    }
    const column = columnFromSurroundingText(
      document.lineAt(candidateRow).text,
      before,
      after,
    );
    if (column !== undefined) {
      return [candidateRow, column];
    }
  }
  return [row, 0];
}

function columnFromSurroundingText(
  line: string,
  before: string,
  after: string,
): number | undefined {
  let previousMatches = new Map<number, number>();
  const maximum = Math.max(before.length, after.length);
  for (let length = 5; length <= maximum; length += 1) {
    const candidates: number[] = [];
    const left = before.slice(Math.max(0, before.length - length));
    const right = after.slice(0, length);
    if (left.length > 0) {
      candidates.push(...substringIndexes(line, left).map(
        (index) => index + left.length,
      ));
    }
    if (right.length > 0) {
      candidates.push(...substringIndexes(line, right));
    }
    const matches = new Map<number, number>();
    for (const candidate of candidates) {
      matches.set(candidate, (matches.get(candidate) ?? 0) + 1);
    }
    const ranked = [...matches.entries()].sort((leftEntry, rightEntry) =>
      rightEntry[1] - leftEntry[1]);
    if (
      ranked.length > 1 &&
      ranked[0]?.[1] === ranked[1]?.[1]
    ) {
      previousMatches = matches;
      continue;
    }
    if (ranked[0] !== undefined) {
      return ranked[0][0];
    }
    const previousRanked = [...previousMatches.entries()].sort(
      (leftEntry, rightEntry) => rightEntry[1] - leftEntry[1],
    );
    return previousRanked[0]?.[0];
  }
  return undefined;
}

function substringIndexes(source: string, find: string): number[] {
  const indexes: number[] = [];
  for (let index = 0; index <= source.length - find.length; index += 1) {
    if (source.slice(index, index + find.length) === find) {
      indexes.push(index);
    }
  }
  return indexes;
}

function markVisualPdf(pdfUri: vscode.Uri): void {
  visualPdfUris.add(normalizedUri(pdfUri));
}

function normalizedUri(uri: vscode.Uri): string {
  if (uri.scheme === "file") {
    const normalized = path.normalize(uri.fsPath);
    return process.platform === "win32"
      ? normalized.toLocaleLowerCase()
      : normalized;
  }
  return uri.with({ query: "", fragment: "" }).toString(true).toLocaleLowerCase();
}

function viewColumnBeside(
  visualViewColumn: vscode.ViewColumn | undefined,
): vscode.ViewColumn {
  return typeof visualViewColumn === "number" && visualViewColumn >= 1
    ? visualViewColumn + 1 as vscode.ViewColumn
    : vscode.ViewColumn.Beside;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

async function ensureRoot(
  lw: LatexWorkshopState,
  document: vscode.TextDocument,
): Promise<string> {
  const preferred = await preferredRootFile(document);
  if (preferred !== undefined) {
    setRoot(lw, preferred, document);
    return preferred;
  }

  const existing = lw.root.file.path;
  if (existing !== undefined && sameWorkspace(existing, document.uri)) {
    return existing;
  }

  await lw.root.find();
  const discovered = lw.root.file.path;
  if (discovered !== undefined) {
    return discovered;
  }

  // A standalone TeX fragment may not contain a root indicator. Falling back
  // to the current file matches the native command's manual-root behaviour
  // without opening a QuickPick behind the custom editor.
  setRoot(lw, document.fileName, document);
  return document.fileName;
}

async function preferredRootFile(
  document: vscode.TextDocument,
): Promise<string | undefined> {
  const text = document.getText();
  const magic = /^[ \t]*%[ \t]*![ \t]*T[Ee]X[ \t]+root[ \t]*=[ \t]*(.+?)[ \t]*$/mu
    .exec(text)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/gu, "");
  if (magic !== undefined && magic.length > 0) {
    const candidate = path.resolve(path.dirname(document.fileName), magic);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
      return candidate;
    } catch {
      // Let LaTeX Workshop's workspace root search handle an invalid directive.
    }
  }
  if (
    /\\documentclass(?:[ \t\r\n]*\[[^\]]*\])?[ \t\r\n]*\{/u.test(text) ||
    /\\begin[ \t\r\n]*\{document\}/u.test(text) ||
    /\\starttext\b/u.test(text)
  ) {
    return document.fileName;
  }
  return undefined;
}

function setRoot(
  lw: LatexWorkshopState,
  rootFile: string,
  document: vscode.TextDocument,
): void {
  if (lw.root.file.path === rootFile) {
    return;
  }
  lw.root.file.path = rootFile;
  lw.root.file.langId = lw.file.getLangId(rootFile) ?? document.languageId;
  lw.root.dir.path = path.dirname(rootFile);
  lw.event.fire?.(
    lw.event.RootFileChanged ?? "ROOT_FILE_CHANGED",
    rootFile,
  );
  lw.cache.add?.(rootFile);
  void Promise.resolve(lw.cache.refreshCache?.(rootFile));
}

function sameWorkspace(filePath: string, document: vscode.Uri): boolean {
  const documentWorkspace = vscode.workspace.getWorkspaceFolder(document);
  if (documentWorkspace === undefined) {
    return true;
  }
  const fileWorkspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
  return fileWorkspace?.uri.toString() === documentWorkspace.uri.toString();
}
