import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";
import {
  scanLatexProjectSource,
  scanVisualDocumentStructure,
} from "../src/core";
import type {
  LatexProjectContext,
  LatexProjectFile,
} from "../src/latexProjectContext";
import { resolveVisualTableOfContents } from "../src/visualTableOfContents";

class FakeUri {
  public constructor(public readonly value: string) {}

  public toString(_skipEncoding?: boolean): string {
    return this.value;
  }
}

function projectFile(
  uri: FakeUri,
  text: string,
  role: LatexProjectFile["role"],
  texOrder: number,
): LatexProjectFile {
  return {
    uri: uri as unknown as vscode.Uri,
    text,
    contentRevision: `${texOrder}:${text.length}`,
    documentVersion: 1,
    dirty: false,
    sourceKind: "open-document",
    reachableFromRoot: true,
    role,
    roles: [role],
    occurrenceCount: 1,
    texOrder,
    sourceScan: scanLatexProjectSource(text),
    includes: [],
  };
}

test("visual table of contents follows interleaved execution slices and short titles", () => {
  const rootUri = new FakeUri("memfs:/paper/main.tex");
  const childUri = new FakeUri("memfs:/paper/child.tex");
  const root = String.raw`\documentclass{book}
\begin{document}
\tableofcontents
\chapter{Before include}
\input{child}
\chapter{After include}
\end{document}`;
  const child = String.raw`\section[Short Kähler]{Long Kähler heading}
\section*{Unnumbered interlude}
\subsection{Nested result}`;
  const rootFile = projectFile(rootUri, root, "standalone", 0);
  const childFile = projectFile(childUri, child, "body", 1);
  const include = rootFile.sourceScan.includes[0]!;
  const bodyFrom = rootFile.sourceScan.beginDocument!.end;
  const bodyTo = rootFile.sourceScan.endDocument!.start;
  const context = {
    contextId: "toc-project",
    revision: 17,
    requestedUri: rootFile.uri,
    requestedRole: "standalone",
    workspaceUri: undefined,
    rootUri: rootFile.uri,
    rootResolution: "self",
    rootLanguage: "en",
    numberingRoot: "chapter",
    documentClass: "book",
    preambleSource: root.slice(0, bodyFrom),
    bodyExecution: {
      slices: [
        {
          uri: rootFile.uri,
          role: "standalone",
          from: bodyFrom,
          to: include.range.start,
          executionIndex: 0,
        },
        {
          uri: childFile.uri,
          role: "body",
          from: 0,
          to: child.length,
          executionIndex: 1,
        },
        {
          uri: rootFile.uri,
          role: "standalone",
          from: include.range.end,
          to: bodyTo,
          executionIndex: 0,
        },
      ],
      incomplete: false,
    },
    files: [rootFile, childFile],
    labels: [],
    labelsByKey: new Map(),
    diagnostics: [],
    graphIncomplete: false,
  } as const satisfies LatexProjectContext;

  const scanned = scanVisualDocumentStructure(root);
  const resolved = resolveVisualTableOfContents(scanned, context);
  const toc = resolved.structure.records.find(
    (record) => record.kind === "tableOfContents",
  );
  assert.ok(toc !== undefined && toc.kind === "tableOfContents");
  assert.deepEqual(
    toc.entries.map((entry) => ({ number: entry.number, title: entry.title })),
    [
      { number: "1", title: "Before include" },
      { number: "1.1", title: "Short Kähler" },
      { number: "1.1.1", title: "Nested result" },
      { number: "2", title: "After include" },
    ],
  );
  assert.equal(toc.incomplete, false);
  assert.equal(toc.numberingApproximate, false);
  assert.deepEqual(toc.notices, []);
  assert.equal(resolved.targetsById.size, 4);
  for (const entry of toc.entries) {
    assert.match(entry.id, /^[a-f0-9]{32}$/u);
    const target = resolved.targetsById.get(entry.id);
    assert.ok(target !== undefined);
    assert.equal(target.expectedText.startsWith("\\"), true);
    assert.equal("uri" in entry, false, "Webview entries must not expose a source URI");
    assert.equal("from" in entry, false, "Webview entries must not expose a source offset");
  }
  const refreshed = resolveVisualTableOfContents(scanned, {
    ...context,
    revision: context.revision + 1,
  });
  const refreshedToc = refreshed.structure.records.find(
    (record) => record.kind === "tableOfContents",
  );
  assert.ok(refreshedToc !== undefined && refreshedToc.kind === "tableOfContents");
  assert.deepEqual(
    refreshedToc.entries.map((entry) => entry.id),
    toc.entries.map((entry) => entry.id),
    "an unrelated project-generation refresh must not make every visible ToC entry stale",
  );
});

test("visual table of contents ignores preamble templates and keeps body scope", () => {
  const uri = new FakeUri("memfs:/slides/talk.tex");
  const source = String.raw`\documentclass{beamer}
\AtBeginSection{
  \begin{frame}
    \frametitle{Outline}
    \tableofcontents[currentsection]
  \end{frame}
}
\begin{document}
\section{First}
\subsection{Before}
\tableofcontents[currentsection]
\subsection{After}
\section{Second}
\subsection{Later}
\end{document}`;
  const file = projectFile(uri, source, "standalone", 0);
  const context = {
    contextId: "beamer-current-section",
    revision: 1,
    requestedUri: file.uri,
    requestedRole: "standalone",
    workspaceUri: undefined,
    rootUri: file.uri,
    rootResolution: "self",
    rootLanguage: "en",
    numberingRoot: "section",
    documentClass: "beamer",
    preambleSource: source.slice(0, file.sourceScan.beginDocument!.end),
    bodyExecution: {
      slices: [{
        uri: file.uri,
        role: "standalone",
        from: file.sourceScan.beginDocument!.end,
        to: file.sourceScan.endDocument!.start,
        executionIndex: 0,
      }],
      incomplete: false,
    },
    files: [file],
    labels: [],
    labelsByKey: new Map(),
    diagnostics: [],
    graphIncomplete: false,
  } as const satisfies LatexProjectContext;

  const resolved = resolveVisualTableOfContents(
    scanVisualDocumentStructure(source),
    context,
  );
  const tables = resolved.structure.records.filter(
    (record) => record.kind === "tableOfContents",
  );
  assert.equal(tables.length, 1);
  const current = tables[0];
  assert.ok(current !== undefined && current.kind === "tableOfContents");
  assert.equal(current.template, false);
  assert.equal(current.scope, "currentSection");
  assert.deepEqual(
    current.entries.map((entry) => entry.title),
    ["First", "Before", "After"],
  );
});

test("visual table of contents separates entry uncertainty from approximate numbering", () => {
  const uri = new FakeUri("memfs:/paper/main.tex");
  const source = String.raw`\documentclass{article}
\includeonly{one}
\begin{document}
\tableofcontents
\section{One}
\appendix
\section{Appendix}
\end{document}`;
  const file = projectFile(uri, source, "standalone", 0);
  const context = {
    contextId: "conservative-toc",
    revision: 3,
    requestedUri: file.uri,
    requestedRole: "standalone",
    workspaceUri: undefined,
    rootUri: file.uri,
    rootResolution: "self",
    rootLanguage: "en",
    numberingRoot: "section",
    documentClass: "article",
    preambleSource: source.slice(0, file.sourceScan.beginDocument!.end),
    bodyExecution: {
      slices: [{
        uri: file.uri,
        role: "standalone",
        from: file.sourceScan.beginDocument!.end,
        to: file.sourceScan.endDocument!.start,
        executionIndex: 0,
      }],
      incomplete: false,
    },
    files: [file],
    labels: [],
    labelsByKey: new Map(),
    diagnostics: [],
    graphIncomplete: false,
  } as const satisfies LatexProjectContext;
  const resolved = resolveVisualTableOfContents(
    scanVisualDocumentStructure(source),
    context,
  );
  const toc = resolved.structure.records.find(
    (record) => record.kind === "tableOfContents",
  );
  assert.ok(toc !== undefined && toc.kind === "tableOfContents");
  assert.equal(toc.entries.length, 2);
  assert.equal(toc.incomplete, true);
  assert.equal(toc.numberingApproximate, true);
  assert.deepEqual(toc.notices, ["includeOnly", "appendix"]);
});

test("visual table of contents keeps matter and appendix headings complete", () => {
  const uri = new FakeUri("memfs:/paper/thesis.tex");
  const source = String.raw`\documentclass{book}
\begin{document}
\tableofcontents
\frontmatter
\chapter{Abstract}
\mainmatter
\chapter{Results}
\backmatter
\chapter{Acknowledgements}
\appendix
\chapter{Details}
\end{document}`;
  const file = projectFile(uri, source, "standalone", 0);
  const context = {
    contextId: "numbering-only-toc",
    revision: 4,
    requestedUri: file.uri,
    requestedRole: "standalone",
    workspaceUri: undefined,
    rootUri: file.uri,
    rootResolution: "self",
    rootLanguage: "en",
    numberingRoot: "chapter",
    documentClass: "book",
    preambleSource: source.slice(0, file.sourceScan.beginDocument!.end),
    bodyExecution: {
      slices: [{
        uri: file.uri,
        role: "standalone",
        from: file.sourceScan.beginDocument!.end,
        to: file.sourceScan.endDocument!.start,
        executionIndex: 0,
      }],
      incomplete: false,
    },
    files: [file],
    labels: [],
    labelsByKey: new Map(),
    diagnostics: [],
    graphIncomplete: false,
  } as const satisfies LatexProjectContext;
  const resolved = resolveVisualTableOfContents(
    scanVisualDocumentStructure(source),
    context,
  );
  const toc = resolved.structure.records.find(
    (record) => record.kind === "tableOfContents",
  );
  assert.ok(toc !== undefined && toc.kind === "tableOfContents");
  assert.equal(toc.entries.length, 4);
  assert.equal(toc.incomplete, false);
  assert.equal(toc.numberingApproximate, true);
  assert.deepEqual(toc.notices, [
    "frontMatter",
    "mainMatter",
    "backMatter",
    "appendix",
  ]);
});

test("visual table of contents does not mistake the mathematical iff relation for a condition", () => {
  const uri = new FakeUri("memfs:/paper/math.tex");
  const source = String.raw`\documentclass{article}
\begin{document}
\tableofcontents
$P \iff Q$
\section{Result}
\end{document}`;
  const file = projectFile(uri, source, "standalone", 0);
  const context = {
    contextId: "iff-toc",
    revision: 5,
    requestedUri: file.uri,
    requestedRole: "standalone",
    workspaceUri: undefined,
    rootUri: file.uri,
    rootResolution: "self",
    rootLanguage: "en",
    numberingRoot: "section",
    documentClass: "article",
    preambleSource: source.slice(0, file.sourceScan.beginDocument!.end),
    bodyExecution: {
      slices: [{
        uri: file.uri,
        role: "standalone",
        from: file.sourceScan.beginDocument!.end,
        to: file.sourceScan.endDocument!.start,
        executionIndex: 0,
      }],
      incomplete: false,
    },
    files: [file],
    labels: [],
    labelsByKey: new Map(),
    diagnostics: [],
    graphIncomplete: false,
  } as const satisfies LatexProjectContext;
  const resolved = resolveVisualTableOfContents(
    scanVisualDocumentStructure(source),
    context,
  );
  const toc = resolved.structure.records.find(
    (record) => record.kind === "tableOfContents",
  );
  assert.ok(toc !== undefined && toc.kind === "tableOfContents");
  assert.equal(toc.incomplete, false);
  assert.deepEqual(toc.notices, []);
});

test("appendix counter switches cross include boundaries", () => {
  const root = String.raw`\documentclass{book}\begin{document}\tableofcontents
\chapter{Main}\appendix\input{details}\chapter{More}\end{document}`;
  const child = String.raw`\chapter*{Interlude}\chapter{Details}\section{Proof}`;
  const main = projectFile(new FakeUri("memfs:/paper/main.tex"), root, "standalone", 0);
  const details = projectFile(new FakeUri("memfs:/paper/details.tex"), child, "body", 1);
  const include = main.sourceScan.includes[0]!;
  const context = {
    contextId: "appendix-include", revision: 1, requestedUri: main.uri, requestedRole: "standalone",
    workspaceUri: undefined, rootUri: main.uri, rootResolution: "self",
    rootLanguage: "en", numberingRoot: "chapter", documentClass: "book", preambleSource: "", files: [main, details],
    labels: [], labelsByKey: new Map(), diagnostics: [], graphIncomplete: false,
    bodyExecution: { incomplete: false, slices: [
      { uri: main.uri, role: "standalone", from: main.sourceScan.beginDocument!.end, to: include.range.start, executionIndex: 0 },
      { uri: details.uri, role: "body", from: 0, to: child.length, executionIndex: 1 },
      { uri: main.uri, role: "standalone", from: include.range.end, to: main.sourceScan.endDocument!.start, executionIndex: 0 },
    ] },
  } as const satisfies LatexProjectContext;
  const resolved = resolveVisualTableOfContents(scanVisualDocumentStructure(root), context);
  const toc = resolved.structure.records.find(r => r.kind === "tableOfContents");
  assert.ok(toc?.kind === "tableOfContents");
  assert.deepEqual(toc.entries.map(e => [e.number, e.title]), [["1", "Main"], ["A", "Details"], ["A.1", "Proof"], ["B", "More"]]);
  assert.equal(toc.incomplete, false);
});
