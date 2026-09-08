import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm, lstat, symlink, copyFile, utimes, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as vscode from "vscode";
import { LocalLatexPreviewRenderer, prepareLocalLatexPreviewFiles } from "../src/localLatexPreviewRenderer";
import { VisualEditorRenderer } from "../src/visualEditorRenderer";

const graph = {
  tex: String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}`,
  display: true, macros: {}, macroFingerprint: "empty",
  compatibilityMode: "maximum" as const,
};

test("lowering graph cache capacity evicts older artwork and preserves recent files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "texleaf-cache-limit-"));
  const renderer = new LocalLatexPreviewRenderer({ cacheDirectory: directory });
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1pt" height="1pt"><!--' + "x".repeat(3 * 1024 * 1024) + '--></svg>';
    const names = Array.from({length: 6}, (_, n) => `${String(n).padStart(64, "0")}.svg`);
    for (const [n, name] of names.entries()) {
      await writeFile(path.join(directory, name), svg);
      await utimes(path.join(directory, name), 100 + n, 100 + n);
    }
    await utimes(path.join(directory, names[0]!), 200, 200);
    await writeFile(path.join(directory, "paper.pdf"), "original");
    await renderer.setCacheLimitMB(16);
    const remaining = await readdir(directory);
    assert.equal(remaining.includes(names[1]!), false);
    assert.equal(remaining.includes(names[0]!), true);
    assert.equal(remaining.filter(name => name.endsWith(".svg")).length, 5);
    assert.equal(await readFile(path.join(directory, "paper.pdf"), "utf8"), "original");
  } finally { renderer.dispose(); await rm(directory, {recursive: true, force: true}); }
});

// The real renderer/queue/filesystem are exercised; only the external TeX tools
// are small local executables so launch counts and failures are deterministic.
async function fixture(fail = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "texleaf-local-cache-test-"));
  const launches = path.join(directory, "launches");
  const interpreter = `#!${process.execPath}\n`;
  await writeFile(path.join(directory, "latex"), interpreter + `
const fs=require('node:fs');
fs.appendFileSync(${JSON.stringify(launches)},'latex\\n');
setTimeout(()=>{${fail ? "console.error('! fixture compilation failed');process.exit(1);" : "fs.writeFileSync('preview.dvi','fixture');"}},80);
`, { mode: 0o755 });
  await writeFile(path.join(directory, "dvisvgm"), interpreter + `
require('node:fs').writeFileSync('preview.svg','<svg xmlns="http://www.w3.org/2000/svg" width="12pt" height="12pt"><path d="M0 0L12 12"/></svg>');
`, { mode: 0o755 });
  const cacheDirectory = path.join(directory, "cache");
  const renderer = () => Reflect.construct(LocalLatexPreviewRenderer, [{ cacheDirectory }]) as LocalLatexPreviewRenderer;
  return {
    directory, renderer,
    count: async () => (await readFile(launches, "utf8").catch(() => "")).split("\n").filter(Boolean).length,
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

test("basic mode never starts local TeX, even for an otherwise supported graph", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(); const renderer = f.renderer();
  try {
    await assert.rejects(renderer.render({ ...graph, compatibilityMode: "basic" } as Parameters<LocalLatexPreviewRenderer["render"]>[0], 1, undefined, f.directory), /增强可视化/);
    assert.equal(await f.count(), 0);
  } finally { renderer.dispose(); await f.close(); }
});

test("concurrent consumers and a new renderer reuse one compiled graph", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(); let renderer = f.renderer();
  try {
    const [a,b] = await Promise.all([
      renderer.render(graph, 1, undefined, f.directory),
      renderer.render(graph, 1, undefined, f.directory),
    ]);
    assert.equal(a.svg,b.svg);
    assert.equal(await f.count(), 1, "a pending graph is shared by every consumer");
    renderer.dispose(); renderer = f.renderer();
    const reopened = await renderer.render(graph, 1, undefined, f.directory);
    assert.equal(reopened.svg,a.svg);
    assert.equal(await f.count(), 1, "reopening reuses the validated disk asset");
    await renderer.render({ ...graph, tex: graph.tex.replace('(1,1)', '(2,2)') }, 1, undefined, f.directory);
    assert.equal(await f.count(), 2, "a changed graph is compiled once again");
  } finally { renderer.dispose(); await f.close(); }
});

test("an unchanged compilation failure is not retried by scrolling or hovering", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(true); const renderer = f.renderer();
  try {
    await assert.rejects(renderer.render(graph, 1, undefined, f.directory), /failed/);
    await assert.rejects(renderer.render(graph, 1, undefined, f.directory), /failed/);
    assert.equal(await f.count(), 1);
  } finally { renderer.dispose(); await f.close(); }
});

test("mode toggles, scale changes and unrelated macro edits retain graph artwork", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(); const renderer = f.renderer();
  try {
    const original = await renderer.render(graph, 1, undefined, f.directory);
    await assert.rejects(renderer.render({ ...graph, compatibilityMode: "basic" }, 1, undefined, f.directory), /增强可视化/);
    const scaled = await renderer.render({ ...graph, macroFingerprint: "unrelated-edited",
      macros: { unused: { name: "unused", argumentCount: 0, replacement: "changed" } } }, 1.2, undefined, f.directory);
    assert.ok(scaled.widthEm > original.widthEm);
    assert.equal(await f.count(), 1, "only effective drawing dependencies affect compilation");
  } finally { renderer.dispose(); await f.close(); }
});

test("cancelling one subscriber does not cancel another, and failed work can be retried explicitly", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(); const renderer = f.renderer();
  try {
    const abort = new AbortController();
    const cancelled = renderer.render(graph, 1, undefined, f.directory, { signal: abort.signal });
    const other = renderer.render(graph, 1, undefined, f.directory);
    abort.abort();
    await assert.rejects(cancelled, /取消/);
    assert.ok((await other).svg.includes("<svg"));
    assert.equal(await f.count(), 1);
  } finally { renderer.dispose(); await f.close(); }
  const failed = await fixture(true); const failing = failed.renderer();
  try {
    await assert.rejects(failing.render(graph, 1, undefined, failed.directory), /failed/);
    await assert.rejects(failing.render(graph, 1, undefined, failed.directory, { retry: true }), /failed/);
    assert.equal(await failed.count(), 2);
  } finally { failing.dispose(); await failed.close(); }
});

test("document and hover share local compilation while an ordinary formula remains independent", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  const worker = path.join(f.directory, "worker.cjs");
  await writeFile(worker, `const {parentPort}=require('node:worker_threads');parentPort.on('message',r=>parentPort.postMessage({type:'result',id:r.id,svg:'<svg width="1em" height="1em"/>',widthEm:1,heightEm:1}));`);
  const renderer = Reflect.construct(VisualEditorRenderer, [{ asAbsolutePath: () => worker,
    globalStorageUri: { scheme: "file", fsPath: f.directory } }]) as VisualEditorRenderer;
  try {
    const document = renderer.render(graph, 1, f.directory);
    const hover = renderer.renderInteractive(graph, 1, f.directory);
    const ordinary = renderer.render({ tex: "x", display: false, macros: {}, macroFingerprint: "empty" }, 1);
    const first = await Promise.race([document.then(() => "graph"), ordinary.then(() => "ordinary")]);
    assert.equal(first, "ordinary");
    await Promise.all([document, hover]);
    assert.equal(await f.count(), 1, "all callers route through one local job");
    renderer.clear();
    await renderer.renderInteractive(graph, 1, f.directory);
    assert.equal(await f.count(), 1, "mode/view cache reset keeps completed local artwork");
  } finally { renderer.dispose(); await f.close(); }
});

test("explicit cache clearing removes graph assets without touching other files", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(); const renderer = f.renderer();
  try {
    await renderer.render(graph, 1, undefined, f.directory);
    const retained = path.join(f.directory, "cache", "paper.pdf");
    await writeFile(retained, "original document");
    const clear = (renderer as unknown as { clearCache?: () => Promise<void> }).clearCache;
    assert.equal(typeof clear, "function", "the cache has an explicit cleanup operation");
    await clear!.call(renderer);
    assert.equal(await readFile(retained, "utf8"), "original document");
    await renderer.render(graph, 1, undefined, f.directory);
    assert.equal(await f.count(), 2);
  } finally { renderer.dispose(); await f.close(); }
});


test("background queue overflow preserves an interactive request", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(); const renderer = f.renderer();
  try {
    const input = (n: number) => ({...graph, tex: graph.tex.replace("(1,1)", `(${n},1)`)});
    const active = renderer.render(input(0), 1, undefined, f.directory);
    const priority = renderer.render(input(1), 1, undefined, f.directory, {priority: true}).then(() => true, () => false);
    const background = Array.from({length: 13}, (_, n) => renderer.render(input(n+2), 1, undefined, f.directory).then(() => true, () => false));
    await active;
    assert.equal(await priority, true);
    assert.ok((await Promise.all(background)).some(success => !success), "overflow is bounded");
  } finally { renderer.dispose(); await f.close(); }
});


class TestUri {
  readonly scheme = "file"; readonly authority = ""; readonly query = ""; readonly fragment = "";
  constructor(readonly fsPath: string) {}
  toString() { return `file://${this.fsPath}`; }
}
const filesystemApi = {
  Uri: { joinPath: (base: TestUri, ...parts: string[]) => new TestUri(path.join(base.fsPath, ...parts)) },
  FileType: {File: 1, Directory: 2, SymbolicLink: 64},
  workspace: {fs: {stat: async (uri: TestUri) => {
    const value = await lstat(uri.fsPath);
    return {type: value.isSymbolicLink() ? 64 : value.isDirectory() ? 2 : value.isFile() ? 1 : 0, size: value.size};
  }}},
} as unknown as typeof vscode;

test("local graphics stage only project files and changes to their bytes invalidate artwork", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(); const renderer = f.renderer();
  const outside = await mkdtemp(path.join(tmpdir(), "texleaf-outside-image-"));
  try {
    await copyFile(path.join(f.directory, "latex"), path.join(f.directory, "pdflatex"));
    await writeFile(path.join(f.directory, "picture.png"), "first bytes");
    await writeFile(path.join(outside, "secret.png"), "private");
    await symlink(path.join(outside, "secret.png"), path.join(f.directory, "escape.png"));
    const input = {...graph, tex: String.raw`\begin{figure}\includegraphics[width=.3\textwidth]{picture.png}\end{figure}`, localFigure: true};
    const prepare = (source = input) => prepareLocalLatexPreviewFiles(filesystemApi, source,
      new TestUri(f.directory) as unknown as vscode.Uri, [f.directory]);
    const first = await prepare();
    assert.match(first.tex, /asset-[a-f0-9]{64}\.png/u);
    assert.equal(Buffer.from(first.localFiles![0]!.contents).toString(), "first bytes");
    assert.match(input.tex, /\{picture\.png\}/u, "original source is untouched");
    await renderer.render(first, 1, undefined, f.directory);
    await renderer.render(await prepare(), 1, undefined, f.directory);
    assert.equal(await f.count(), 1);
    await writeFile(path.join(f.directory, "picture.png"), "different bytes");
    await renderer.render(await prepare(), 1, undefined, f.directory);
    assert.equal(await f.count(), 2);
    for (const name of ["escape.png", "missing.png", `../${path.basename(outside)}/secret.png`]) {
      await assert.rejects(prepare({...input, tex: input.tex.replace("picture.png", name)}), /安全读取/);
    }
  } finally { renderer.dispose(); await f.close(); await rm(outside, {recursive: true, force: true}); }
});
