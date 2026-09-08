import assert from "node:assert/strict";
import test from "node:test";
import { scanVisualDocumentStructure, visualInlineReferenceRecords } from "../src/core/visualStructure";

test("appendices saves main counters, continues appendix letters, and preserves theorem numbering", () => {
  for (const [cls, root, child] of [["amsart", "section", "subsection"], ["book", "chapter", "section"]]) {
    const source = String.raw`\documentclass{${cls}}\usepackage{appendix}
\newtheorem{dummy}{}[${root}]\newtheorem{lemma}[dummy]{Lemma}
\begin{document}${"\\" + root}{Main}
\begin{appendices}${"\\" + root}{Extra}${"\\" + child}{Detail}\begin{lemma}Claim\end{lemma}\end{appendices}
${"\\" + root}{Resumed}\begin{appendices}${"\\" + root}{Second extra}\end{appendices}\end{document}`;
    const result = scanVisualDocumentStructure(source);
    assert.deepEqual(result.records.filter(r => r.kind === "heading").map(r => r.number), ["1", "A", "A.1", "2", "B"]);
    assert.equal(result.records.find(r => r.kind === "theorem")?.number, "A.1");
  }
});

test("appendices detection respects declarations, verbatim, comments, and package availability", () => {
  for (const setup of ["", String.raw`\usepackage{appendix}\renewenvironment{appendices}{}{}`, String.raw`\usepackage{appendix}\def\appendices{}`]) {
    const source = String.raw`\documentclass{article}${setup}\begin{document}\section{One}\begin{appendices}\section{Two}\end{appendices}\end{document}`;
    assert.deepEqual(scanVisualDocumentStructure(source).records.filter(r => r.kind === "heading").map(r => r.number), ["1", "2"]);
  }
  const source = String.raw`\usepackage{appendix}\newcommand{\sample}{\begin{appendices}}
\begin{document}\section{One}
% \begin{appendices}
\begin{Verbatim}\begin{appendices}\section{Fake}\end{appendices}\end{Verbatim}
\section{Two}\end{document}`;
  assert.deepEqual(scanVisualDocumentStructure(source).records.filter(r => r.kind === "heading").map(r => r.number), ["1", "2"]);
});

test("footnotes keep numbered UTF16 source ranges and nested math, citations and label targets", () => {
  const source = String.raw`\begin{document}😀Text\footnote{See $x$ and \cite{key}, \ref{sec:a}.\label{fn:a}}\footnote[7]{Explicit}\footnote{Next}\end{document}`;
  const result = scanVisualDocumentStructure(source);
  const notes = result.records.filter(r => r.kind === "footnote");
  assert.equal(notes.length, 3);
  assert.deepEqual(notes.map(r => r.number), ["1", "7", "2"]);
  const note = notes[0]!;
  assert.equal(source.slice(note.from, note.to), String.raw`\footnote{See $x$ and \cite{key}, \ref{sec:a}.\label{fn:a}}`);
  assert.equal(source.slice(note.contentFrom, note.contentTo), note.source.text);
  assert.deepEqual([note.source.from, note.source.to], [note.contentFrom, note.contentTo]);
  assert.ok(note.source.segments?.some(s => s.kind === "math" && source.slice(s.math.sourceFrom, s.math.sourceTo) === "$x$"));
  assert.equal(result.records.filter(r => r.kind === "textStyle" && r.command === "footnote").length, 0);
  assert.equal(result.records.filter(r => r.kind === "label" && r.key === "fn:a").length, 1);
  assert.deepEqual(visualInlineReferenceRecords(result).map(r => r.keys), [["key"], ["sec:a"]]);
  assert.deepEqual(result.citedKeys, ["key"]);
});

test("footnote hover hides labels and link metadata while retaining visible math and references", () => {
  const source = String.raw`\begin{document}\footnote{See \href{https://example/\cite{hidden}$z$}{Text $x$ and \ref{real}}.\label{fn:a}}\end{document}`;
  const result = scanVisualDocumentStructure(source);
  const note = result.records.find(r => r.kind === "footnote")!;
  assert.ok(note?.kind === "footnote");
  assert.deepEqual(visualInlineReferenceRecords(result).map(r => r.keys), [["real"]]);
  assert.deepEqual(result.citedKeys, []);
  assert.deepEqual(note.source.segments?.filter(s => s.kind === "math").map(s => s.math.tex), ["x"]);
  assert.ok(!note.source.segments?.filter(s => s.kind === "text").some(s => /fn:a|example|hidden/.test(s.text)));
});

test("footnote automatic counters reset by chapter, explicit markers and unknown fragments stay honest", () => {
  const source = String.raw`\documentclass{book}\begin{document}\chapter{One}\footnote{First}\footnote{Second}\chapter*{Unnumbered}\footnote{Third}\chapter{Two}\footnote{Fourth}\end{document}`;
  assert.deepEqual(scanVisualDocumentStructure(source).records.filter(r => r.kind === "footnote").map(r => r.number), ["1", "2", "3", "1"]);
  const fragment = String.raw`\footnote{Unknown}\footnote[9]{Known}`;
  assert.deepEqual(scanVisualDocumentStructure(fragment, { fragmentKind: "body", numberingMode: "unknown" }).records.filter(r => r.kind === "footnote").map(r => r.number), [undefined, "9"]);
});

test("appendices exit restores only the main root counter, leaving descendant counters intact", () => {
  const source = String.raw`\usepackage{appendix}\newtheorem{lemma}{Lemma}[section]\begin{document}
\section{Main}\begin{appendices}\section{Extra}\subsection{Detail}\begin{lemma}First\end{lemma}\end{appendices}
\begin{lemma}Still the next theorem\end{lemma}\subsection{Continued}\section{Resumed}\begin{lemma}Reset\end{lemma}\end{document}`;
  const records = scanVisualDocumentStructure(source).records;
  assert.deepEqual(records.filter(r => r.kind === "heading").map(r => r.number), ["1", "A", "A.1", "1.2", "2"]);
  assert.deepEqual(records.filter(r => r.kind === "theorem").map(r => r.number), ["A.1", "1.2", "2.1"]);
});

test("one-argument detokenize wrappers display literal source without executing nested structure", () => {
  const source = String.raw`\usepackage{appendix}
\newcommand{\literalcode}[1]{\texttt{\detokenize{#1}}}
\begin{document}\section{One}\literalcode{\appendix \begin{appendices}\section{Fake}\end{appendices} $x$}
\section{Two}\end{document}`;
  const result = scanVisualDocumentStructure(source);
  assert.deepEqual(result.records.filter(r => r.kind === "heading").map(r => r.number), ["1", "2"]);
  assert.equal(result.appendixTransitions, undefined);
  const literal = result.records.find(r => r.kind === "accent" && r.text.startsWith("\\appendix"));
  assert.ok(literal?.kind === "accent");
  assert.equal(source.slice(literal.from, literal.to), String.raw`\literalcode{\appendix \begin{appendices}\section{Fake}\end{appendices} $x$}`);
});
