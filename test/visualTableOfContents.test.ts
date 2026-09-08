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
import { findVisualHeadingForLabel, indexVisualStructureReferences } from "../src/core/visualStructure";

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

test("appendices entry, exit and reentry replay in include order with inherited package state", () => {
  const root = String.raw`\documentclass{article}\usepackage{appendix}\begin{document}\tableofcontents
\section{Main}\input{details}\section{Resumed}\begin{appendices}\section{More}\end{appendices}\end{document}`;
  const child = String.raw`\begin{appendices}\section{Extra}\subsection{Proof}\end{appendices}`;
  const main = projectFile(new FakeUri("memfs:/paper/main.tex"), root, "standalone", 0);
  const details = projectFile(new FakeUri("memfs:/paper/details.tex"), child, "body", 1);
  const include = main.sourceScan.includes[0]!;
  const context = {
    contextId: "appendices-include", revision: 1, requestedUri: main.uri, requestedRole: "standalone",
    workspaceUri: undefined, rootUri: main.uri, rootResolution: "self",
    rootLanguage: "en", numberingRoot: "section", documentClass: "article", preambleSource: root.slice(0, main.sourceScan.beginDocument!.start),
    files: [main, details],
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
  assert.deepEqual(toc.entries.map(e => [e.number, e.title]), [["1", "Main"], ["A", "Extra"], ["A.1", "Proof"], ["2", "Resumed"], ["B", "More"]]);
  const target = [...resolved.targetsById.values()].find(t => t.entry.title === "Extra")!;
  assert.equal(target.uri, details.uri);
  assert.equal(child.slice(target.from, target.to), String.raw`\section{Extra}`);
  assert.equal(toc.incomplete, false);
});

function numberingFixture(childText: string, options: { before?: string; after?: string; preamble?: string; repeated?: boolean; book?: boolean } = {}) {
  const rootText = String.raw`\documentclass{${options.book ? "book" : "article"}}${options.preamble ?? ""}\begin{document}
${options.before ?? String.raw`\section{Main}\footnote{Root}`}
\input{child}
${options.repeated ? String.raw`\input{child}` : ""}
${options.after ?? String.raw`\section{Last}\footnote{After}`}
\end{document}`;
  const root = projectFile(new FakeUri("memfs:/paper/main.tex"), rootText, "standalone", 0);
  const child = projectFile(new FakeUri("memfs:/paper/child.tex"), childText, "body", 1);
  const slices: LatexProjectContext["bodyExecution"]["slices"][number][] = [];
  let cursor = root.sourceScan.beginDocument!.end;
  for (const [index, include] of root.sourceScan.includes.entries()) {
    slices.push({ uri: root.uri, role: "standalone", from: cursor, to: include.range.start, executionIndex: 0 });
    slices.push({ uri: child.uri, role: "body", from: 0, to: child.text.length, executionIndex: index + 1 });
    cursor = include.range.end;
  }
  slices.push({ uri: root.uri, role: "standalone", from: cursor, to: root.sourceScan.endDocument!.start, executionIndex: 0 });
  const context: LatexProjectContext = {
    contextId: "project-counters", revision: 1, requestedUri: root.uri, requestedRole: "standalone",
    workspaceUri: undefined, rootUri: root.uri, rootResolution: "self",
    rootLanguage: "en", numberingRoot: options.book ? "chapter" : "section", documentClass: options.book ? "book" : "article",
    preambleSource: rootText.slice(0, root.sourceScan.beginDocument!.start),
    files: [root, child],
    labels: [], labelsByKey: new Map(), diagnostics: [], graphIncomplete: false,
    bodyExecution: { incomplete: false, slices },
  };
  return { root, child, context };
}

test("project heading and footnote numbering follows includes without a tableofcontents command", () => {
  const { root, child, context } = numberingFixture(String.raw`\section{Child}\footnote{Child}\footnote[8]{Explicit}\footnote{Next}`);
  const main = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
  assert.deepEqual(main.structure.records.filter(r => r.kind === "heading").map(r => r.number), ["1", "3"]);
  assert.deepEqual(main.structure.records.filter(r => r.kind === "footnote").map(r => r.number), ["1", "4"]);
  assert.equal(main.targetsById.size, 0, "no ToC means no unused navigation target table");
  const included = resolveVisualTableOfContents(scanVisualDocumentStructure(child.text, { fragmentKind: "body", numberingMode: "unknown" }),
    { ...context, requestedUri: child.uri, requestedRole: "body" });
  assert.deepEqual(included.structure.records.filter(r => r.kind === "heading").map(r => r.number), ["2"]);
  assert.deepEqual(included.structure.records.filter(r => r.kind === "footnote").map(r => r.number), ["2", "8", "3"]);
});

test("local headings inherit appendices entry and exit across files without a ToC", () => {
  const { root, child, context } = numberingFixture(String.raw`\section{Extra}\subsection{Detail}\end{appendices}`, {
    preamble: String.raw`\usepackage{appendix}`, before: String.raw`\section{Main}\begin{appendices}`,
    after: String.raw`\section{Resumed}\begin{appendices}\section{More}\end{appendices}`,
  });
  const main = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
  assert.deepEqual(main.structure.records.filter(r => r.kind === "heading").map(r => r.number), ["1", "2", "B"]);
  const included = resolveVisualTableOfContents(scanVisualDocumentStructure(child.text, { fragmentKind: "body", numberingMode: "unknown" }),
    { ...context, requestedUri: child.uri, requestedRole: "body" });
  assert.deepEqual(included.structure.records.filter(r => r.kind === "heading").map(r => r.number), ["A", "A.1"]);
});

test("repeated include conflicts leave physical-file counters unknown", () => {
  const { child, context } = numberingFixture(String.raw`\section{Child}\footnote{Child}`, { repeated: true });
  const result = resolveVisualTableOfContents(scanVisualDocumentStructure(child.text, { fragmentKind: "body" }),
    { ...context, requestedUri: child.uri, requestedRole: "body" });
  assert.deepEqual(result.structure.records.filter(r => r.kind === "heading" || r.kind === "footnote").map(r => r.number), [undefined, undefined]);
});

test("project footnotes reset by chapter and retain equal repeated-include values", () => {
  const { root, child, context } = numberingFixture(String.raw`\chapter{Child}\footnote{Child}`, {
    book: true, repeated: true, before: String.raw`\chapter{Main}\footnote{Root}`, after: String.raw`\chapter{Last}\footnote{After}`,
  });
  const result = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
  assert.deepEqual(result.structure.records.filter(r => r.kind === "heading").map(r => r.number), ["1", "4"]);
  assert.deepEqual(result.structure.records.filter(r => r.kind === "footnote").map(r => r.number), ["1", "1"]);
  const included = resolveVisualTableOfContents(scanVisualDocumentStructure(child.text, { fragmentKind: "body" }),
    { ...context, requestedUri: child.uri, requestedRole: "body" });
  assert.equal(included.structure.records.find(r => r.kind === "footnote")?.number, "1");
});

test("unverified graphs and arbitrary counter controls cannot publish guessed local numbers", () => {
  const fixture = numberingFixture(String.raw`\section{Child}\footnote{Child}`);
  for (const context of [{ ...fixture.context, rootUri: undefined }, { ...fixture.context, graphIncomplete: true }, { ...fixture.context, bodyExecution: { ...fixture.context.bodyExecution, incomplete: true } }]) {
    const result = resolveVisualTableOfContents(scanVisualDocumentStructure(fixture.root.text), context);
    assert.ok(result.structure.records.filter(r => r.kind === "heading" || r.kind === "footnote").every(r => r.number === undefined));
  }
  for (const preamble of [String.raw`\setcounter{section}{\value{chapter}}`, String.raw`\renewcommand{\thesection}{\Roman{section}}`]) {
    const { root, context } = numberingFixture("", { preamble });
    const result = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
    assert.ok(result.structure.records.filter(r => r.kind === "heading").every(r => r.number === undefined));
  }
  for (const preamble of [String.raw`\setcounter{footnote}{9}`, String.raw`\renewcommand{\thefootnote}{\fnsymbol{footnote}}`]) {
    const { root, context } = numberingFixture("", { preamble });
    const result = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
    assert.ok(result.structure.records.filter(r => r.kind === "footnote").every(r => r.number === undefined));
  }
});

test("literal preamble and cross-file counter assignments update headings and ToC without uncertainty", () => {
  const { root, child, context } = numberingFixture(String.raw`\addtocounter{section}{2}\section{Child}\label{sec:child}\subsection{Detail}`, {
    preamble: String.raw`\setcounter{section}{3}`,
    before: String.raw`\tableofcontents\section{Main}`,
    after: String.raw`\setcounter{section}{9}\section{Last}`,
  });
  assert.deepEqual(scanVisualDocumentStructure(root.text).records.filter(r => r.kind === "heading").map(r => r.number), ["4", "10"]);
  const result = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
  assert.deepEqual(result.structure.records.filter(r => r.kind === "heading").map(r => r.number), ["4", "10"]);
  const toc = result.structure.records.find(r => r.kind === "tableOfContents")!;
  assert.deepEqual(toc.entries.map(e => e.number), ["4", "7", "7.1", "10"]);
  assert.equal(toc.numberingApproximate, false);
  assert.equal(toc.incomplete, false);
  assert.deepEqual(toc.notices, []);
  const included = resolveVisualTableOfContents(scanVisualDocumentStructure(child.text, { fragmentKind: "body", numberingMode: "unknown" }),
    { ...context, requestedUri: child.uri, requestedRole: "body" });
  assert.deepEqual(included.structure.records.filter(r => r.kind === "heading").map(r => r.number), ["7", "7.1"]);
  assert.equal(findVisualHeadingForLabel(child.text, included.structure.records, "sec:child")?.number, "7");
  assert.equal(indexVisualStructureReferences(child.text, included.structure.records).get("sec:child")?.label, "7");
});

test("chapter assignments preserve theorem and footnote descendants, while explicit steps reset them", () => {
  const source = String.raw`\documentclass{book}\newtheorem{lemma}{Lemma}[chapter]\begin{document}
\chapter{One}\begin{lemma}First\end{lemma}\footnote{First}
\setcounter{chapter}{3}\begin{lemma}Preserved\end{lemma}\footnote{Preserved}
\refstepcounter{chapter}\begin{lemma}Reset\end{lemma}\footnote{Reset}\end{document}`;
  const scanned = scanVisualDocumentStructure(source);
  assert.deepEqual(scanned.records.filter(r => r.kind === "theorem").map(r => r.number), ["1.1", "3.2", "4.1"]);
  assert.deepEqual(scanned.records.filter(r => r.kind === "footnote").map(r => r.number), ["1", "2", "1"]);
  const f = numberingFixture(String.raw`\setcounter{chapter}{3}\footnote{Preserved}\refstepcounter{chapter}\footnote{Reset}`, {
    book: true, before: String.raw`\chapter{One}\footnote{First}`, after: String.raw`\footnote{After include}`,
  });
  const child = resolveVisualTableOfContents(scanVisualDocumentStructure(f.child.text, { fragmentKind: "body", numberingMode: "unknown" }),
    { ...f.context, requestedUri: f.child.uri, requestedRole: "body" });
  assert.deepEqual(child.structure.records.filter(r => r.kind === "footnote").map(r => r.number), ["2", "1"]);
  const root = resolveVisualTableOfContents(scanVisualDocumentStructure(f.root.text), f.context);
  assert.deepEqual(root.structure.records.filter(r => r.kind === "footnote").map(r => r.number), ["1", "2"]);
});

test("literal signed integers and starred headings keep the actual counter value", () => {
  const { root, context } = numberingFixture(String.raw`\addtocounter{section}{ +2 }\section*{Unnumbered}\section{Child}`, {
    preamble: String.raw`\setcounter{section}{ -2 }`, before: String.raw`\tableofcontents\section{Negative}`, after: String.raw`\section{Next}`,
  });
  const result = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
  assert.deepEqual(result.structure.records.find(r => r.kind === "tableOfContents")!.entries.map(e => e.number), ["-1", "2", "3"]);
  const part = scanVisualDocumentStructure(String.raw`\begin{document}\setcounter{part}{3999}\part{Large}\end{document}`);
  assert.equal(part.records.find(r => r.kind === "heading")?.number, "MMMM");
});

test("counter set and add preserve descendants while heading and explicit steps reset them", () => {
  const source = String.raw`\documentclass{book}\begin{document}
\chapter{First}\section{One}\subsection{Detail}
\setcounter{section}{3}\subsection{Preserved}
\addtocounter{section}{-2}\subsection{Still preserved}
\stepcounter{section}\subsection{Reset}
\refstepcounter{chapter}\section{New chapter section}
\setcounter{subsubsection}{-2}\subsubsection{Negative}\subsubsection{Zero}
\setcounter{part}{2}\part{Part three}\section{Part preserves section}
\end{document}`;
  const expected = ["1", "1.1", "1.1.1", "1.3.2", "1.1.3", "1.2.1", "2.1", "2.1.0.-1", "2.1.0.0", "III", "2.2"];
  assert.deepEqual(scanVisualDocumentStructure(source).records.filter(r => r.kind === "heading").map(r => r.number), expected);
  const f = numberingFixture(source.slice(source.indexOf("\\chapter"), source.indexOf("\\end{document}")), {
    book: true, before: String.raw`\tableofcontents`, after: "",
  });
  const result = resolveVisualTableOfContents(scanVisualDocumentStructure(f.root.text), f.context);
  assert.deepEqual(result.structure.records.find(r => r.kind === "tableOfContents")!.entries.map(e => e.number), expected);
});

test("counter mutations share exact lexical order with appendix entry and exit", () => {
  const { root, context } = numberingFixture(String.raw`\setcounter{section}{2}\section{Appendix C}\end{appendices}\addtocounter{section}{2}`, {
    preamble: String.raw`\usepackage{appendix}\setcounter{section}{3}`,
    before: String.raw`\tableofcontents\section{Main}\begin{appendices}`,
    after: String.raw`\section{Resumed}\begin{appendices}\addtocounter{section}{1}\section{Appendix E}\end{appendices}`,
  });
  const result = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
  assert.deepEqual(result.structure.records.find(r => r.kind === "tableOfContents")!.entries.map(e => e.number), ["4", "C", "7", "E"]);
});

test("counter examples in definitions, comments and literal environments remain inert", () => {
  const { root, context } = numberingFixture(String.raw`\section{Child}`, {
    preamble: String.raw`\newcommand{\example}{\setcounter{section}{99}}`,
    before: String.raw`\tableofcontents
% \setcounter{section}{77}
\verb|\setcounter{section}{88}|
\begin{Verbatim}\setcounter{section}{66}\end{Verbatim}
\newcommand{\anotherExample}{\addtocounter{section}{55}}
\section{Main}`,
    after: String.raw`\section{Last}`,
  });
  const result = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
  const toc = result.structure.records.find(r => r.kind === "tableOfContents")!;
  assert.deepEqual(toc.entries.map(e => e.number), ["1", "2", "3"]);
  assert.deepEqual(result.structure.records.filter(r => r.kind === "heading").map(r => r.number), ["1", "3"]);
  assert.deepEqual(toc.notices, []);
});

test("dynamic or oversized heading counter values keep local headings and ToC numbers unknown", () => {
  for (const preamble of [String.raw`\setcounter{section}{\value{chapter}}`, String.raw`\addtocounter{section}{100000000000}`, String.raw`\renewcommand{\thesection}{\Roman{section}}`]) {
    const { root, context } = numberingFixture(String.raw`\section{Child}`, { preamble, before: String.raw`\tableofcontents\section{Main}` });
    const result = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
    assert.ok(result.structure.records.filter(r => r.kind === "heading").every(r => r.number === undefined));
    const toc = result.structure.records.find(r => r.kind === "tableOfContents")!;
    assert.ok(toc.entries.every(e => e.number === undefined));
    assert.ok(toc.notices.includes("counterControl"));
  }
});

test("preamble conditional counter mutations cannot publish guessed heading or ToC numbers", () => {
  for (const preamble of [
    String.raw`\iftrue\setcounter{section}{4}\fi`,
    String.raw`\ifnum1=1\addtocounter{section}{2}\fi`,
    String.raw`\ifthenelse{true}{\setcounter{section}{4}}{}`,
    String.raw`\IfFileExists{optional.tex}{\refstepcounter{section}}{}`,
    String.raw`\IfBooleanTF{true}{\stepcounter{section}}{}`,
  ]) {
    const { root, context } = numberingFixture(String.raw`\section{Child}`, { preamble, before: String.raw`\tableofcontents\section{Main}` });
    const scanned = scanVisualDocumentStructure(root.text);
    assert.equal(scanned.headingCountersAmbiguous, true, preamble);
    assert.ok(scanned.records.filter(r => r.kind === "heading").every(r => r.number === undefined), preamble);
    const result = resolveVisualTableOfContents(scanned, context);
    assert.ok(result.structure.records.filter(r => r.kind === "heading").every(r => r.number === undefined), preamble);
    const toc = result.structure.records.find(r => r.kind === "tableOfContents")!;
    assert.ok(toc.entries.every(e => e.number === undefined), preamble);
    assert.ok(toc.notices.includes("counterControl"), preamble);
  }
});

test("conditional counter ambiguity ignores quoted examples and unrelated counters", () => {
  for (const preamble of [
    String.raw`\iftrue\newcommand{\example}{\setcounter{section}{4}}\fi`,
    "\\iftrue% \\setcounter{section}{4}\n\\fi",
    String.raw`\ifthenelse{true}{\verb|\setcounter{section}{4}|}{}`,
    String.raw`\ifthenelse{true}{\begin{Verbatim}\setcounter{section}{4}\end{Verbatim}}{}`,
    String.raw`\iftrue\setcounter{page}{4}\fi`,
  ]) {
    const { root, context } = numberingFixture(String.raw`\section{Child}`, { preamble, before: String.raw`\tableofcontents\section{Main}` });
    const scanned = scanVisualDocumentStructure(root.text);
    assert.notEqual(scanned.headingCountersAmbiguous, true, preamble);
    const result = resolveVisualTableOfContents(scanned, context);
    assert.deepEqual(result.structure.records.filter(r => r.kind === "heading").map(r => r.number), ["1", "3"], preamble);
    assert.ok(!result.structure.records.find(r => r.kind === "tableOfContents")!.notices.includes("counterControl"), preamble);
  }
});


test("ToC depth, page and equation controls do not invalidate structural and footnote counters", () => {
  const { root, context } = numberingFixture(String.raw`\section{Child}\footnote{Child}`, {
    preamble: String.raw`\setcounter{tocdepth}{0}\setcounter{page}{7}\setcounter{equation}{9}`,
  });
  const result = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
  assert.deepEqual(result.structure.records.filter(r => r.kind === "heading").map(r => r.number), ["1", "3"]);
  assert.deepEqual(result.structure.records.filter(r => r.kind === "footnote").map(r => r.number), ["1", "3"]);
});

test("minipage footnotes stay unknown without advancing the document footnote counter", () => {
  const { root, child, context } = numberingFixture(String.raw`\footnote{Local to the minipage}`, {
    before: String.raw`\section{Main}\footnote{Root}\begin{minipage}{.5\textwidth}`,
    after: String.raw`\end{minipage}\footnote{After}`,
  });
  const main = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
  assert.deepEqual(main.structure.records.filter(r => r.kind === "footnote").map(r => r.number), ["1", "2"]);
  const included = resolveVisualTableOfContents(scanVisualDocumentStructure(child.text, { fragmentKind: "body" }),
    { ...context, requestedUri: child.uri, requestedRole: "body" });
  assert.equal(included.structure.records.find(r => r.kind === "footnote")?.number, undefined);
});

test("literal minipage examples cannot divert ordinary footnote counters", () => {
  for (const literal of [String.raw`\verb|\begin{minipage}|`, String.raw`\detokenize{\begin{minipage}}`, String.raw`\begin{Verbatim}\begin{minipage}\end{Verbatim}`]) {
    const { root, context } = numberingFixture(literal + String.raw`\footnote{Child}`);
    const result = resolveVisualTableOfContents(scanVisualDocumentStructure(root.text), context);
    assert.deepEqual(result.structure.records.filter(r => r.kind === "footnote").map(r => r.number), ["1", "3"]);
  }
});
