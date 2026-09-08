import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";

class Uri {
  readonly scheme = "file";
  readonly authority = "";
  readonly query = "";
  readonly fragment = "";
  constructor(readonly path: string) {}
  get fsPath() { return this.path; }
  toString() { return "file://" + this.path; }
}
class Position {
  constructor(readonly line: number, readonly character: number) {}
}
class Range {
  constructor(readonly start: Position, readonly end: Position) {}
}
class CompletionItem {
  constructor(readonly label: unknown, readonly kind: unknown) {}
}
class CompletionList {
  constructor(readonly items: readonly CompletionItem[], readonly isIncomplete: boolean) {}
}
class SnippetString {
  value = "";
  appendText(value: string) { this.value += value; return this; }
}
class MarkdownString {
  value = "";
  appendMarkdown(value: string) { this.value += value; return this; }
  appendText(value: string) { this.value += value; return this; }
}
class FileSystemError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
const contents = new Map<string, string>();
const openDocuments: { uri: Uri; getText(): string; isDirty: boolean }[] = [];
const api = {
  Uri: { file: (value: string) => new Uri(value) },
  Position,
  Range,
  CompletionItem,
  CompletionList,
  SnippetString,
  MarkdownString,
  CompletionItemKind: { Reference: 18 },
  CompletionTriggerKind: { Invoke: 0, TriggerCharacter: 1 },
  FileSystemError,
  workspace: {
    isTrusted: true,
    textDocuments: openDocuments,
    getConfiguration: () => ({
      get: <T>(_section: string, fallback: T) => fallback,
      inspect: () => undefined,
    }),
    fs: { readFile: async (uri: Uri) => {
      const text = contents.get(uri.path);
      if (text === undefined) throw new FileSystemError("missing", "FileNotFound");
      return new TextEncoder().encode(text);
    } },
  },
};
const loader = require("node:module") as { _load: (id: string, parent: unknown, main: boolean) => unknown };
const original = loader._load;
let Controller: typeof import("../src/citationController").CitationController;
try {
  loader._load = function (id, parent, main) { return id === "vscode" ? api : original.call(this, id, parent, main); };
  Controller = (require("../src/citationController") as typeof import("../src/citationController")).CitationController;
} finally { loader._load = original; }

test("multi-file bibliography reads all sources, suppresses ambiguous keys, and preserves origins", async () => {
  const controller = new Controller(undefined as never, {} as vscode.LogOutputChannel);
  const first = new Uri("/project/bib/main.bib");
  const second = new Uri("/project/bib/extra.bib");
  contents.set(first.path, "@book{alpha,title={First}}\n@book{shared,title={A}}");
  contents.set(second.path, "@book{beta,title={Second}}\n@book{shared,title={B}}");
  const result = await controller.readProjectBibliographyPreview([first, second, first] as unknown as vscode.Uri[]);
  assert.deepEqual(result.entries.map((entry) => entry.key), ["alpha", "beta"]);
  assert.deepEqual([...result.duplicateKeys], ["shared"]);
  assert.equal(result.sources.get("beta")?.toString(), second.toString());
});

test("multi-file bibliography honors dirty buffers and limits the source set", async () => {
  const controller = new Controller(undefined as never, {} as vscode.LogOutputChannel);
  const uri = new Uri("/project/bib/dirty.bib");
  contents.set(uri.path, "@book{old,title={On disk}}");
  openDocuments.push({ uri, isDirty: true, getText: () => "@book{new,title={Unsaved}}" });
  try {
    assert.deepEqual((await controller.readProjectBibliographyPreview([uri] as unknown as vscode.Uri[])).entries.map((entry) => entry.key), ["new"]);
    await assert.rejects(controller.readProjectBibliographyPreview(Array.from({ length: 65 }, (_, i) => new Uri(`/project/${i}.bib`)) as unknown as vscode.Uri[]), /64/u);
  } finally { openDocuments.length = 0; }
});

function citationDocument(text: string) {
  const uri = new Uri("/project/main.tex");
  return {
    uri,
    languageId: "latex",
    isClosed: false,
    version: 1,
    lineCount: 1,
    getText: () => text,
    offsetAt: (position: Position) => position.character,
    positionAt: (offset: number) => new Position(0, offset),
    lineAt: () => ({ text }),
  };
}

test("explicit bibliography completions do not read an unrelated default file", async () => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const runtime = { contextAt: () => ({ inComment: false, inVerbatim: false, environments: [] }) };
  const controller = new Controller(runtime as never, {
    error: (message: string) => errors.push(message),
    warn: (message: string) => warnings.push(message),
  } as unknown as vscode.LogOutputChannel);
  const explicit = new Uri("/project/bib/valid.bib");
  contents.set(explicit.path, "@book{alpha,title={Explicit project entry},author={Ada Lovelace},year={1843}}");
  let defaultResolutionCalls = 0;
  const repository = (controller as unknown as {
    repository: { resolveBibliographyUri(): Promise<vscode.Uri> };
  }).repository;
  repository.resolveBibliographyUri = async () => {
    defaultResolutionCalls += 1;
    throw new Error("bad global bibliography default");
  };

  const emptyDocument = citationDocument("\\cite{}");
  const empty = await controller.provideVisualCompletionItems(
    emptyDocument as unknown as vscode.TextDocument,
    new Position(0, 6) as unknown as vscode.Position,
    { isCancellationRequested: false } as vscode.CancellationToken,
    undefined,
    [explicit] as unknown as vscode.Uri[],
  );
  assert.deepEqual(empty?.items.map((item) => (item.insertText as SnippetString).value), ["alpha"]);
  assert.equal(defaultResolutionCalls, 0, "an empty project picker has no Zotero import target to resolve");

  const queryDocument = citationDocument("\\cite{alp}");
  const queried = await controller.provideVisualCompletionItems(
    queryDocument as unknown as vscode.TextDocument,
    new Position(0, 9) as unknown as vscode.Position,
    { isCancellationRequested: false } as vscode.CancellationToken,
    undefined,
    [explicit] as unknown as vscode.Uri[],
  );
  assert.deepEqual(queried?.items.map((item) => (item.insertText as SnippetString).value), ["alpha"]);
  assert.equal(defaultResolutionCalls, 1, "a non-empty query may probe the default only as a Zotero target");
  assert.equal(errors.length, 0, "a bad default must not turn valid project bibliographies into a read failure");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /Zotero 导入目标/u);
});

test("generated BibTeX bibliography supports previews, completion, and exact entry spans", async () => {
  const runtime = { contextAt: () => ({ inComment: false, inVerbatim: false, environments: [] }) };
  const controller = new Controller(runtime as never, {} as vscode.LogOutputChannel);
  const generated = new Uri("/project/main.bbl");
  const source = String.raw`\begin{thebibliography}{9}
\providecommand{\noop}[1]{}
\bibitem[{Ada(1843)}]{ada}
\bibfield{author}{\bibinfo{author}{Ada Lovelace}}.\vspace{0.1cm} \href{https://example.test/notes}{\emph{\bibinfo{title}{Notes on the \hspace*{2em}Analytical Engine}}}. \bibinfo{year}{1843}.\BibitemShut{NoStop}
\bibitem{shared}First copy.
\bibitem{shared}Second copy.
\end{thebibliography}`;
  contents.set(generated.path, source);
  const uris = [generated] as unknown as vscode.Uri[];
  const preview = await controller.readProjectBibliographyPreview(uris);
  assert.deepEqual(preview.entries.map(entry => entry.key), ["ada"]);
  assert.equal(preview.entries[0]!.title, "Ada Lovelace. Notes on the Analytical Engine. 1843.");
  assert.equal(preview.entries[0]!.entryType, "bibitem");
  assert.equal(preview.entries[0]!.range.start, source.indexOf("\\bibitem"));
  assert.equal(preview.entries[0]!.range.end, source.indexOf("\\bibitem{shared}"));
  assert.equal(preview.entries[0]!.raw, source.slice(preview.entries[0]!.range.start, preview.entries[0]!.range.end));
  assert.deepEqual([...preview.duplicateKeys], ["shared"]);
  assert.equal(preview.sources.get("ada")?.toString(), generated.toString());
  const document = citationDocument("\\cite{}");
  const completions = await controller.provideVisualCompletionItems(
    document as unknown as vscode.TextDocument,
    new Position(0, 6) as unknown as vscode.Position,
    { isCancellationRequested: false } as vscode.CancellationToken,
    undefined,
    uris,
  );
  assert.deepEqual(completions?.items.map(item => (item.insertText as SnippetString).value), ["ada"]);
  assert.equal((await controller.revealProjectBibliographyEntry(uris, "shared")).status, "duplicate");
});


test("generated bibliography keeps late entries and detects duplicates beyond the card limit", async () => {
  const controller = new Controller(undefined as never, {} as vscode.LogOutputChannel);
  const generated = new Uri("/project/long.bbl");
  contents.set(generated.path, [
    String.raw`\begin{thebibliography}{999}\bibitem{shared}First.`,
    ...Array.from({ length: 119 }, (_, index) => `\\bibitem{entry${index}}Reference ${index}.`),
    String.raw`\bibitem{shared}Ambiguous late copy.`,
    String.raw`\bibitem{last}Final reference.\end{thebibliography}`,
  ].join("\n"));
  const uris = [generated] as unknown as vscode.Uri[];
  const result = await controller.readProjectBibliographyPreview(uris);
  assert.equal(result.entries.length, 120);
  assert.equal(result.entries.at(-1)?.key, "last");
  assert.equal(result.entries.some(entry => entry.key === "shared"), false);
  assert.deepEqual([...result.duplicateKeys], ["shared"]);
  assert.equal((await controller.revealProjectBibliographyEntry(uris, "shared")).status, "duplicate");
});
