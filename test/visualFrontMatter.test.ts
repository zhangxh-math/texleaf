import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";
import { scanLatexProjectSource, scanVisualDocumentStructure } from "../src/core";
import type { LatexProjectContext, LatexProjectFile } from "../src/latexProjectContext";
import { resolveVisualFrontMatter } from "../src/visualFrontMatter";

function file(name: string, text: string, role: LatexProjectFile["role"]): LatexProjectFile {
  return { uri: { toString: () => `memfs:/paper/${name}.tex` } as vscode.Uri,
    text, role, roles: [role], sourceScan: scanLatexProjectSource(text), includes: [],
    contentRevision: text, documentVersion: 1, dirty: false, sourceKind: "open-document",
    reachableFromRoot: true, occurrenceCount: 1, texOrder: 0 };
}
function fixture(metadataText = String.raw`\title{Included title}\author{First Author}`, bodyTitle = "", libraryInput = "") {
  const root = file("main", String.raw`\documentclass{article}
\title{Old title}
${libraryInput}
\input{metadata}
\begin{document}
${bodyTitle}
\maketitle
\section{Body}
\end{document}`, "standalone");
  const metadata = file("metadata", metadataText, "preamble");
  const include = root.sourceScan.includes.find(include => include.rawPath === "metadata")!;
  const edge = { ...include, sourceRole: "standalone", targetRole: "preamble", sourceUri: root.uri,
    targetUri: metadata.uri, status: "resolved" } as const;
  const sourceRoot = { ...root, includes: [edge, ...root.sourceScan.includes.filter(item => item !== include).map(item => ({
    ...item, sourceRole: "standalone" as const, targetRole: "preamble" as const, sourceUri: root.uri,
    targetUri: undefined, status: "library" as const,
  }))] };
  const preamble = root.text.slice(0, include.range.start) + "\n" + metadata.text + "\n" + root.text.slice(include.range.end, root.sourceScan.beginDocument!.start);
  const context: LatexProjectContext = {
    contextId: "front-matter", revision: 1, requestedUri: root.uri, requestedRole: "standalone",
    rootUri: root.uri, rootResolution: "self", workspaceUri: undefined,
    rootLanguage: "en", numberingRoot: "section", documentClass: "article", preambleSource: preamble, graphIncomplete: false,
    bodyExecution: { incomplete: false, slices: [{ uri: root.uri, role: "standalone", executionIndex: 0,
      from: root.sourceScan.beginDocument!.end, to: root.sourceScan.endDocument!.start }] },
    files: [sourceRoot, metadata], labels: [], labelsByKey: new Map(), diagnostics: [],
  };
  return { root: sourceRoot, metadata, context };
}

test("front matter resolves included declarations in order and binds navigation to source snapshots", () => {
  const { root, metadata, context } = fixture();
  const scanned = scanVisualDocumentStructure(root.text);
  const resolved = resolveVisualFrontMatter(scanned, context);
  const title = resolved.structure.records.find(record => record.kind === "maketitle");
  assert.ok(title?.kind === "maketitle");
  assert.equal(title.title?.text, "Included title");
  assert.equal(title.authors[0]?.text, "First Author");
  const target = resolved.targetsById.get(title.title!.navigationId!);
  assert.ok(target);
  assert.equal(target.uri, metadata.uri);
  assert.equal(metadata.text.slice(target.from, target.to), "Included title");
  const changed = { ...metadata, text: metadata.text + "\n% new snapshot", contentRevision: "changed" };
  const stale = resolveVisualFrontMatter(scanned, { ...context, files: [root, changed],
    preambleSource: context.preambleSource.replace(metadata.text, changed.text) });
  assert.equal(stale.targetsById.has(title.title!.navigationId!), false);
  assert.ok(!JSON.stringify(resolved.structure).includes("memfs:"));
});

test("incomplete or ambiguous include graphs do not supply guessed front matter", () => {
  const { root, context } = fixture();
  const scanned = scanVisualDocumentStructure(root.text);
  for (const uncertain of [{ ...context, graphIncomplete: true }, { ...context, preambleSource: "different execution" }]) {
    const result = resolveVisualFrontMatter(scanned, uncertain);
    assert.equal(result.structure, scanned);
    assert.equal(result.targetsById.size, 0);
  }
});


test("included metadata redefinitions cannot retain a wider local front matter fold", () => {
  const { root, context } = fixture(String.raw`\renewcommand{\title}[1]{Visible #1}`, String.raw`\title{Body}`);
  const scanned = scanVisualDocumentStructure(root.text);
  const local = scanned.records.find(record => record.kind === "maketitle");
  assert.ok(local?.frontMatter && local.frontMatter.replacement.sourceFrom < local.replacement.sourceFrom);
  const resolved = resolveVisualFrontMatter(scanned, context).structure.records.find(record => record.kind === "maketitle");
  assert.ok(resolved);
  assert.equal(resolved.frontMatter?.replacement.sourceFrom ?? resolved.replacement.sourceFrom, resolved.replacement.sourceFrom);
  assert.deepEqual(resolved.metadataReplacements ?? [], []);
});

test("confirmed library inputs preserve later included title metadata and source links", () => {
  const { root, context } = fixture(undefined, "", String.raw`\input xy`);
  const resolved = resolveVisualFrontMatter(scanVisualDocumentStructure(root.text), context);
  const title = resolved.structure.records.find(record => record.kind === "maketitle")?.title;
  assert.equal(title?.text, "Included title");
  assert.ok(title?.navigationId && resolved.targetsById.has(title.navigationId));
});
