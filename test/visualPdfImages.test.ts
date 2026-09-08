import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appendFile, lstat, mkdir, mkdtemp, open, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function fileUri(fsPath: string, query = "") {
  return {
    fsPath, query,
    with: (change: { query: string }) => fileUri(fsPath, change.query),
    toString: () => { const url = pathToFileURL(fsPath); url.search = query; return url.href; },
  };
}

function imageResolver() {
  const source = ts.createSourceFile("visualEditorProvider.ts",
    readFileSync(path.join(process.cwd(), "src/visualEditorProvider.ts"), "utf8"),
    ts.ScriptTarget.Latest, true);
  const names = new Set(["VISUAL_IMAGE_EXTENSIONS", "MAX_VISUAL_PDF_IMAGE_BYTES", "resolveVisualImageUri", "isPathInside"]);
  const declarations = source.statements.filter(statement =>
    ts.isFunctionDeclaration(statement) ? names.has(statement.name?.text ?? "")
      : ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
        ts.isIdentifier(declaration.name) && names.has(declaration.name.text)));
  const module = { exports: undefined as unknown as (
    webview: unknown, record: { path: string }, search: string[], allowed: string[], real: string[],
  ) => Promise<string | undefined> };
  const compiled = ts.transpileModule(declarations.map(node => node.getText(source)).join("\n")
    + "\nmodule.exports = resolveVisualImageUri;", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, { module, path, lstat, realpath,
    vscode: { Uri: { file: fileUri }, FileType: { File: 1 }, workspace: { fs: {
      stat: async (uri: ReturnType<typeof fileUri>) => {
        const value = await stat(uri.fsPath);
        return { type: value.isFile() ? 1 : 2, size: value.size, mtime: value.mtimeMs };
      },
    } } },
  });
  return module.exports;
}

test("PDF image URIs preserve path boundaries, size limits and file-version refresh", async t => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "texleaf-pdf-images-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "project"), outside = path.join(directory, "outside");
  await mkdir(root); await mkdir(outside);
  const pdf = path.join(root, "figure #1.pdf");
  await writeFile(pdf, "%PDF-1.4\nsynthetic host URI fixture\n");
  await utimes(pdf, 1_700_000_000, 1_700_000_000);
  await writeFile(path.join(root, "photo.png"), "synthetic raster fixture");
  await writeFile(path.join(root, "photo.pdf"), "%PDF-1.4\n");
  await writeFile(path.join(outside, "escaped.pdf"), "%PDF-1.4\n");
  await symlink(pdf, path.join(root, "file-link.pdf"));
  await symlink(outside, path.join(root, "escape"), "junction");
  await mkdir(path.join(root, "directory.pdf"));
  const oversized = await open(path.join(root, "oversized.pdf"), "w");
  await oversized.truncate(16 * 1024 * 1024 + 1); await oversized.close();
  const resolve = imageResolver();
  // VS Code's remote file conversion can discard the input query. The
  // version must therefore be added to the converted resource URI.
  const webview = { asWebviewUri: (uri: ReturnType<typeof fileUri>) => {
    const converted = (query = "") => ({
      with: (change: { query: string }) => converted(change.query),
      toString: () => `https://file+.vscode-resource.vscode-cdn.net${pathToFileURL(uri.fsPath).pathname}${query ? `?${query}` : ""}`,
    });
    return converted();
  } };
  const image = (source: string) => resolve(webview, { path: source }, [root], [root], [root]);
  const initial = await image("figure #1.pdf");
  assert.ok(initial, "a bounded PDF image needs a Webview resource URI");
  assert.equal(new URL(initial).pathname, pathToFileURL(pdf).pathname);
  assert.ok(new URL(initial).searchParams.get("v"));
  assert.equal(await image("figure #1"), initial);
  await utimes(pdf, 1_700_000_010, 1_700_000_010);
  const modified = await image("figure #1.pdf");
  assert.notEqual(modified, initial, "same-path edits must invalidate the PDF preview");
  await appendFile(pdf, "updated");
  await utimes(pdf, 1_700_000_010, 1_700_000_010);
  assert.notEqual(await image("figure #1.pdf"), modified, "size changes also invalidate a cached preview");
  const raster = await image("photo.png");
  assert.ok(raster); assert.equal(new URL(raster).search, "");
  assert.equal(await image("photo"), raster, "existing raster extension preference stays unchanged");
  for (const source of ["../outside/escaped.pdf", path.join(outside, "escaped.pdf"), "escape/escaped.pdf",
    "file-link.pdf", "directory.pdf", "oversized.pdf", "missing.pdf", "figure.exe"]) {
    assert.equal(await image(source), undefined, source);
  }
});

test("PDF resource streaming enforces the byte limit and releases aborted readers", async () => {
  const source = ts.createSourceFile("visualEditorWebview.ts",
    readFileSync(path.join(process.cwd(), "src/visualEditorWebview.ts"), "utf8"),
    ts.ScriptTarget.Latest, true);
  const reader = source.statements.find(statement =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "readVisualPdfResource");
  assert.ok(reader);
  const compiled = ts.transpileModule(reader.getText(source) + "\nmodule.exports = readVisualPdfResource;", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: undefined as unknown as (uri: string, signal: AbortSignal, limit: number) => Promise<Uint8Array> };
  let stream: ReadableStream<Uint8Array>;
  runInNewContext(compiled, { module, Uint8Array, fetch: async (_uri: string, options: { signal: AbortSignal }) => {
    options.signal.addEventListener("abort", () => controller?.error(options.signal.reason), { once: true });
    return new Response(stream);
  } });
  let cancelled = 0, pulls = 0;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  stream = new ReadableStream<Uint8Array>({
    pull(value) { value.enqueue(new Uint8Array(++pulls <= 2 ? 8 * 1024 * 1024 : 1)); },
    cancel() { cancelled += 1; },
  });
  await assert.rejects(module.exports("https://resource.test/large.pdf", new AbortController().signal, 16 * 1024 * 1024), /byte limit/u);
  assert.equal(cancelled, 1);
  assert.equal(stream.locked, false);

  stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const abort = new AbortController();
  const pending = module.exports("https://resource.test/pending.pdf", abort.signal, 16 * 1024 * 1024);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(stream.locked, true);
  abort.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(stream.locked, false);
});
