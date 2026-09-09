import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// The controller and its core parsers are real; VS Code documents/atomic edits
// and the pending Zotero transport are the unavailable host boundaries.
function fixture(onBibliographyRead?: (count: number, bib: { text: string; replace(text: string): void }) => void) {
  const errors: string[] = [];
  const uri = (name: string) => ({ scheme: "file", path: "/project/" + name, fsPath: "/project/" + name, toString: () => "file:///project/" + name });
  type Uri = ReturnType<typeof uri>;
  class Position { constructor(readonly line: number, readonly character: number) {} }
  class Range { constructor(readonly start: Position, readonly end: Position) {} }
  class Document {
    version = 1; isDirty = false; isClosed = false; languageId = "latex";
    constructor(readonly uri: Uri, public text: string) {}
    getText() { return this.text; }
    positionAt(offset: number) { const lines = this.text.slice(0, offset).split("\n"); return new Position(lines.length - 1, lines.at(-1)!.length); }
    offsetAt(p: Position) { return this.text.split("\n").slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character; }
    replace(text: string) { this.text = text; this.version++; this.isDirty = true; }
    async save() { this.isDirty = false; return true; }
  }
  const tex = new Document(uri("main.tex"), String.raw`\cite{RoundLocal}` + "\n" + String.raw`\bibliography{reference}`);
  const bib = new Document(uri("reference.bib"), "% reference\n"), other = new Document(uri("other.bib"), "% other\n");
  const docs = [tex, bib, other];
  let edits = 0;
  class WorkspaceEdit {
    operations: { uri: Uri; start: Position; end: Position; text: string }[] = [];
    replace(uri: Uri, r: Range, text: string) { this.operations.push({ uri, start: r.start, end: r.end, text }); }
    insert(uri: Uri, p: Position, text: string) { this.operations.push({ uri, start: p, end: p, text }); }
  }
  const api = { Position, Range, WorkspaceEdit,
    window: { showErrorMessage: (s: string) => errors.push(s), showInformationMessage() {} },
    workspace: { isTrusted: true, async applyEdit(edit: WorkspaceEdit) {
      edits++; for (const op of edit.operations) { const d = docs.find(d => d.uri.toString() === op.uri.toString())!;
        d.replace(d.text.slice(0, d.offsetAt(op.start)) + op.text + d.text.slice(d.offsetAt(op.end))); }
      return true;
    } },
  };
  const config = { enabled: true, zoteroCitations: true, languageIds: ["latex"], excludedEnvironments: [],
    citationCommands: ["cite"], bibliographyFile: "reference.bib", bibliographyFormat: "bibtex",
    zoteroPort: 23119, zoteroLibrary: "", zoteroRequestTimeoutMs: 1000 };
  const exported: Record<string, any> = {};
  const file = path.join(process.cwd(), "src/citationController.ts");
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(compiled + "\nexports.keys = c => [zoteroCacheKey(c), zoteroCompletionContextKey(c)];", {
    exports: exported, require: (name: string) => name === "vscode" ? api
      : name === "./config" ? { readConfig: () => ({ ...config }) }
      : name === "./citationRepository" ? { CitationRepository: class {} }
      : name.startsWith(".") ? require(path.join(__dirname, "../src", name)) : require(name),
    TextEncoder, TextDecoder, setTimeout, clearTimeout, console,
  });
  const controller = new exported.CitationController({ contextAt: () => ({ inComment: false, inVerbatim: false, environments: [] }) }, { error() {}, warn() {} });
  controller.repository = { resolveBibliographyUri: async (_: unknown, name: string) => uri(name),
    read: async (u: Uri) => { const d = docs.find(d => d.uri.toString() === u.toString())!;
      return { uri: u, text: d.text, exists: true, document: d, wasDirty: d.isDirty }; },
    openForEditing: async (s: any) => s.document };
  let release!: (text: string) => void, started!: () => void;
  const exporting = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<string>(resolve => { release = resolve; });
  const reference = { citekey: "RoundLocal2026", libraryID: 1, title: "Round paper", authors: ["Author"], container: "", year: "2026", doi: "", isbn: "" };
  const [snapshotKey, contextKey] = exported.keys(config);
  controller.zoteroCache = { cacheKey: snapshotKey, snapshotId: "fixture", duplicateCitekeys: new Set(), references: [reference],
    client: { exportBibTeX: async () => { started(); return pending; } } };
  let bibliographies = [bib.uri], bibliographyReads = 0;
  const accept = () => controller.acceptVisualCompletion(tex, tex.positionAt(tex.text.indexOf("}")), {
    command: "texleaf.commitCitationCompletion", arguments: [{ documentUri: tex.uri.toString(), bibliographyUri: bib.uri.toString(),
      bibliographyPath: "reference.bib", snapshotKey, contextKey, snapshotId: "fixture", reference }],
  }, async () => { onBibliographyRead?.(++bibliographyReads, bib); return bibliographies; });
  return { tex, bib, other, config, errors, exporting, accept, edits: () => edits,
    changeBibliographies: () => { bibliographies = [other.uri]; },
    finish: () => release('@article{RoundLocal2026, title={Round paper}, author={Author}, year={2026}}\n') };
}

for (const change of ["document declaration", "root bibliography set", "bibliography configuration"] as const) {
  test(`pending Zotero export cannot commit after the ${change} changes`, async () => {
    const f = fixture(), accepted = f.accept(); await f.exporting;
    if (change === "document declaration") f.tex.replace(f.tex.text.replace("bibliography{reference}", "bibliography{other}"));
    else if (change === "root bibliography set") f.changeBibliographies();
    else f.config.bibliographyFile = "other.bib";
    const draft = f.tex.text; f.finish();
    assert.equal(await accepted, undefined);
    assert.equal(f.edits(), 0);
    assert.equal(f.tex.text, draft);
    assert.equal(f.bib.text, "% reference\n");
    assert.equal(f.other.text, "% other\n");
    assert.match(f.errors.join("\n"), /变化|改变/u);
  });
}

test("unchanged Zotero export still imports atomically and preserves a dirty bibliography", async () => {
  const f = fixture(); f.bib.isDirty = true;
  const accepted = f.accept(); await f.exporting; f.finish();
  assert.ok(await accepted);
  assert.equal(f.edits(), 1);
  assert.match(f.tex.text, /\\cite\{RoundLocal2026\}/u);
  assert.match(f.bib.text, /@article\{RoundLocal2026/u);
  assert.equal(f.bib.isDirty, true);
  assert.equal(f.other.text, "% other\n");
  assert.deepEqual(f.errors, []);
});

test("bibliography edits during final project revalidation are preserved", async () => {
  const f = fixture((count, bib) => { if (count === 4) bib.replace(bib.text + "% latest unsaved draft\n"); });
  const accepted = f.accept(); await f.exporting; f.finish();
  assert.equal(await accepted, undefined);
  assert.equal(f.edits(), 0);
  assert.equal(f.bib.text, "% reference\n% latest unsaved draft\n");
});
