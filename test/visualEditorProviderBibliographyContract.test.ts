import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const provider = readFileSync(
  join(process.cwd(), "src", "visualEditorProvider.ts"),
  "utf8",
).replace(/\r\n/gu, "\n");

function sourceSection(startMarker: string, endMarker: string): string {
  const start = provider.indexOf(startMarker);
  const end = provider.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return provider.slice(start, end);
}

function assertOrdered(source: string, markers: readonly string[]): void {
  let previous = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker, previous + 1);
    assert.ok(current > previous, `missing or out of order: ${marker}`);
    previous = current;
  }
}

test("bibliography cache publication is fenced by the owning document generation", () => {
  const postDocument = sourceSection(
    "  private async postDocument(",
    "  private async postAiIssues(",
  );
  assertOrdered(postDocument, [
    "bibliographyUris = await resolveTemplateBibliographyUris(projectContext)",
    "session.documentGeneration !== documentGeneration",
    "await this.citations.read",
    "session.documentGeneration !== documentGeneration",
    "session.bibliographyRequest = requestedPath",
    "session.bibliographyUris = bibliographyUris",
    "session.bibliographySetKey = bibliographySetKey",
    "session.bibliographyEntries = bibliography.entries",
  ]);
  assert.match(
    postDocument,
    /session\.disposed \|\| session\.documentGeneration !== documentGeneration \|\|[\s\S]*?session\.document\.version !== version \|\| visualDocumentText\(session\.document\) !== text/u,
  );
});

test("bibliography failures remain retryable and are warned only once per unchanged error", () => {
  const postDocument = sourceSection(
    "  private async postDocument(",
    "  private async postAiIssues(",
  );
  const catchStart = postDocument.indexOf("} catch (error: unknown) {");
  const catchEnd = postDocument.indexOf("      if (\n        session.disposed", catchStart);
  assert.ok(catchStart >= 0 && catchEnd > catchStart);
  const failure = postDocument.slice(catchStart, catchEnd);
  assert.match(failure, /session\.bibliographyEntries = undefined/u);
  assert.doesNotMatch(failure, /session\.bibliographyEntries = \[\]/u);
  assert.match(
    failure,
    /if \(session\.bibliographyError !== message\)[\s\S]*?showWarningMessage[\s\S]*?session\.bibliographyError = message/u,
  );
});

test("external bibliography changes invalidate previews for bib and bbl files", () => {
  const register = sourceSection("  public register(): void {", "  public async resolveCustomTextEditor(");
  assert.match(register, /createFileSystemWatcher\("\*\*\/\*\.\{bib,bbl\}"\)/u);
  for (const event of ["onDidCreate", "onDidChange", "onDidDelete"]) {
    assert.ok(register.includes(`bibliographyWatcher.${event}(() => this.invalidateBibliographyPreviews())`));
  }
});

test("more than 64 target bibliography files fail instead of silently truncating", () => {
  const resolver = sourceSection(
    "async function resolveTemplateBibliographyUris(",
    "function uniqueResolvedPaths(",
  );
  assertOrdered(resolver, [
    "const candidates = uniqueResolvedPaths(paths)",
    "if (candidates.length > 64)",
    "throw new Error(",
    "for (const candidate of candidates)",
  ]);
  assert.doesNotMatch(resolver, /candidates\.slice\(0,\s*64\)/u);
});

test("unsaved bibliography buffers invalidate previews for both BIB and BBL", () => {
  const declaration = sourceSection("function isBibliographyDocument(", "function isInputAction(");
  const compiled = ts.transpileModule(declaration + "\nisBibliographyDocument;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const accepts = runInNewContext(compiled) as (document: unknown) => boolean;
  for (const path of ["/refs.bib", "/main.bbl", "/MAIN.BBL"]) {
    assert.equal(accepts({ languageId: "plaintext", uri: { path } }), true, path);
  }
  assert.equal(accepts({ languageId: "latex", uri: { path: "/main.tex" } }), false);
});
