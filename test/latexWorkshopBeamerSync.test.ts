/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { beamerForwardSynctexLine, beamerReverseSynctexOffset } from "../src/core/beamerSynctex";
import { scanLatexProjectSource } from "../src/core/latexProject";
import { normalizeVisualText, visualOffsetFromDocumentOffset } from "../src/core/visualTextCoordinates";

const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{First}
First body.
\end{frame}
\begin{frame}{Second}
Second body.
\end{frame} % deferred title
\end{document}`;

// Extract complete declarations through the TypeScript AST, so CRLF checkout
// and unrelated bridge imports cannot change the runtime exercised here.
const bridgeSource = ts.createSourceFile("bridge.ts", readFileSync("src/latexWorkshopBridge.ts", "utf8"), ts.ScriptTarget.Latest, true);
const names = new Set(["locatePdf", "isBeamerRoot", "installVisualReverseSync", "reverseSyncPosition",
  "rowAndColumnFromSurroundingText", "columnFromSurroundingText", "substringIndexes",
  "normalizedUri", "markVisualPdf", "viewColumnBeside", "clampInteger"]);
const declarations = bridgeSource.statements.filter((statement): statement is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(statement) && names.has(statement.name?.text ?? ""));
const implementation = ts.transpileModule(declarations.map(statement => statement.getText(bridgeSource)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(text = source, rootText = text) {
  class Position { constructor(readonly line: number, readonly character: number) {} }
  const uri = (file: string) => ({ scheme: "file", fsPath: path.resolve(file), toString() { return this.fsPath; } });
  const documentOf = (file: string, contents: string) => {
    const lines = contents.split(/\r\n|\n/u), eol = contents.includes("\r\n") ? "\r\n" : "\n";
    return { fileName: path.resolve(file), uri: uri(file), lineCount: lines.length, getText: () => contents,
      lineAt: (line: number) => ({ text: lines[line]! }),
      offsetAt: (position: Position) => lines.slice(0, position.line).reduce((length, line) => length + line.length + eol.length, 0) + position.character };
  };
  const document = documentOf("/tmp/beamer-slides.tex", text);
  const root = documentOf("/tmp/beamer-root.tex", rootText);
  const pdfUri = uri("/tmp/beamer-root.pdf");
  const commands: { name: string; args: any[] }[] = [], queries: number[] = [], shown: any[] = [], fallback: any[] = [];
  let reverse: any = { input: document.fileName, line: 5, column: 0 };
  const precise = { page: 1, x: 25, y: 50, h: 20, v: 55, W: 100, H: 10, indicator: true };
  const frame = { ...precise, page: 2 };
  const lw: any = { root: { file: { path: root.fileName }, subfiles: {} }, previousActive: undefined,
    file: { toUri: uri, getPdfPath: () => pdfUri.fsPath },
    viewer: { locate: async (_uri: unknown, record: unknown) => { shown.push(record); } },
    locate: { synctex: {
      toPDF: (_uri: unknown, args: unknown) => { fallback.push(args); },
      toTeX: async () => { fallback.push("reverse"); },
      components: {
        synctexToPDFCombined: async (line: number) => { queries.push(line); return line === 8 ? [frame, { ...frame, page: 3 }] : [precise]; },
        computeToTeX: async () => reverse,
      },
    } },
  };
  const api = runInNewContext(implementation + "\n({ locatePdf, installVisualReverseSync })", {
    path, process, beamerForwardSynctexLine, beamerReverseSynctexOffset, scanLatexProjectSource,
    normalizeVisualText, visualOffsetFromDocumentOffset,
    patchedSyncTeXStates: new WeakSet(), visualPdfUris: new Set(), LATEX_WORKSHOP_PDF_VIEW_TYPE: "latex-workshop-pdf",
    VISUAL_EDITOR_REVEAL_RANGE_COMMAND: "reveal", VISUAL_EDITOR_REVEAL_OPEN_RANGE_COMMAND: "revealOpen",
    ensureRoot: async () => root.fileName, preferredRootFile: async () => root.fileName,
    vscode: { Position, ViewColumn: { Beside: 2 },
      workspace: { openTextDocument: async (target: { fsPath: string }) => target.fsPath === root.fileName ? root : document,
        getConfiguration: () => ({ get: (key: string, value: unknown) => key === "synctex.indicator" ? "rectangle" : value }) },
      commands: { executeCommand: async (name: string, ...args: unknown[]) => { commands.push({ name, args }); return true; } },
    },
  });
  return { lw, document, queries, shown, fallback, commands, precise, frame,
    setReverse: (value: unknown) => { reverse = value; },
    locate: () => api.locatePdf({ lw }, document, { active: new Position(6, 3) }, 1),
    reverse: async () => { api.installVisualReverseSync(lw); await lw.locate.synctex.toTeX({ page: 2, pos: [25, 50], textBeforeSelection: "Second body." }, pdfUri); } };
}

test("ordinary Beamer frames choose their first frame-end hit instead of the preceding page", async () => {
  const f = fixture();
  await f.locate();
  assert.ok(f.queries.includes(7) && f.queries.includes(8));
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0][0].page, 2);
  assert.equal(f.shown[0].length, 1, "later overlay hits must not move the viewer again");
  assert.equal(f.fallback.length, 0);
});

test("verified original lines survive globally direct frames but another file cannot validate them", async () => {
  for (const sameFile of [true, false]) {
    const f = fixture(source, source.replace("{beamer}", "{ctexbeamer}") + "\n\\setkeys{beamerframe}{fragile=singleslide}");
    f.setReverse({ input: sameFile ? f.document.fileName : "/tmp/different.tex", line: 7, column: 0 });
    await f.locate();
    assert.equal(f.shown[0][0].page, sameFile ? 1 : 2);
  }
});

test("explicit fragile frames and missing optional Workshop components keep the existing forward path", async () => {
  for (const mode of ["fragile", "forward", "reverse", "viewer", "failure"]) {
    const f = fixture(mode === "fragile" ? source.replace("{Second}", "[fragile=singleslide]{Second}") : source);
    if (mode === "forward") delete f.lw.locate.synctex.components.synctexToPDFCombined;
    if (mode === "reverse") delete f.lw.locate.synctex.components.computeToTeX;
    if (mode === "viewer") delete f.lw.viewer.locate;
    if (mode === "failure") f.lw.locate.synctex.components.synctexToPDFCombined = async () => { throw new Error("missing SyncTeX"); };
    await f.locate();
    assert.equal(f.fallback[0].line, 7, mode);
    assert.equal(f.shown.length, 0, mode);
  }
});

test("article roots with frame environments or commented Beamer classes are unchanged", async () => {
  const root = "% \\documentclass{beamer}\n" + source.replace("{beamer}", "{article}");
  const f = fixture(source, root);
  await f.locate();
  assert.equal(f.fallback[0].line, 7);
  assert.equal(f.queries.length, 0);
});

test("reverse frame-end hits precede text refinement and use LF offsets with either checkout EOL", async () => {
  for (const eol of ["\n", "\r\n"]) {
    const text = source.replaceAll("\n", eol), f = fixture(text);
    f.setReverse({ input: f.document.fileName, line: 8, column: 0 });
    await f.reverse();
    const revealed = f.commands.find(command => command.name === "revealOpen")!;
    assert.equal(revealed.args[1], source.indexOf(String.raw`\begin{frame}{Second}`));
    assert.equal(revealed.args[2], revealed.args[1]);
    assert.equal(f.fallback.length, 0);
  }
});

test("precise reverse body hits retain their position and CRLF does not add line-width drift", async () => {
  const f = fixture(source.replaceAll("\n", "\r\n"));
  f.setReverse({ input: f.document.fileName, line: 7, column: 3 });
  await f.reverse();
  assert.equal(f.commands.find(command => command.name === "revealOpen")!.args[1], source.indexOf("Second body.") + 3);
});
