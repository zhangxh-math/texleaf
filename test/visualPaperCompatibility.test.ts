import assert from "node:assert/strict";
import test from "node:test";
import { findVisualLabelsInRange, scanVisualDocumentStructure } from "../src/core/visualStructure";
import { scanLatexProjectSource } from "../src/core/latexProject";

test("the mathematical iff relation keeps following project includes and document boundaries", () => {
  const source = String.raw`\documentclass{article}\begin{document}
$a\iff b$\input{appendix}\end{document}`;
  const project = scanLatexProjectSource(source);
  assert.equal(project.graphIncomplete, false);
  assert.equal(project.includes[0]?.rawPath, "appendix");
  assert.ok(project.endDocument);
});

test("the mathematical iff relation does not discard formula or later reference labels", () => {
  const source = String.raw`\begin{equation}a\iff b\label{eq:equivalent}\end{equation}
\ifdraft\label{uncertain}\fi
\section{After}\label{sec:after}`;
  assert.deepEqual(findVisualLabelsInRange(source, 0, source.length).map(label => label.key),
    ["eq:equivalent", "sec:after"]);
});

test("declared math aliases keep conditional-looking math out of the structure scanner", () => {
  const source = String.raw`\newcommand{\startDisplay}{\begin{equation}}
\newcommand{\finishDisplay}{\end{equation}}
\begin{document}\startDisplay a\iff b\label{eq:a}\finishDisplay
\section{After}\bibliography{bib}`;
  const structure = scanVisualDocumentStructure(source);
  assert.deepEqual(structure.bibliographyPaths, ["bib.bib"]);
  assert.equal(structure.records.filter(record => record.kind === "heading").length, 1);
});

test("declared trivlist statements use definitions regardless of the environment name", () => {
  const source = String.raw`\newenvironment{customNotice}[1][Careful.]{\begin{trivlist}
\item[\hskip \labelsep {\bfseries #1}]}{\end{trivlist}}
\newenvironment{customClaim}[1][Claim.]{\begin{trivlist}
\item[\hskip \labelsep {\bfseries #1}]\it}{\end{trivlist}}
\begin{document}
\begin{customNotice}Body.\end{customNotice}
\begin{customClaim}[A stronger claim]Other.\end{customClaim}
\begin{warning}Undeclared stays source.\end{warning}`;
  const records = scanVisualDocumentStructure(source).records.filter(r => r.kind === "theorem");
  assert.deepEqual(records.map(r => [r.environment, r.label, r.number, r.style]), [
    ["customNotice", "Careful.", undefined, "remark"],
    ["customClaim", "A stronger claim", undefined, "plain"],
  ]);
  assert.equal(records[1]!.optionalTitle, undefined);
});

test("comment environments collapse as one source-linked record and preserve following text", () => {
  const source = String.raw`\begin{document}
\begin{comment}
\section{Hidden}\label{hidden}
\end{comment}
\section{Visible}`;
  const records = scanVisualDocumentStructure(source).records;
  const comment = records.find(r => String(r.kind) === "comment") as { kind: string; replacement: { sourceFrom: number; sourceTo: number } } | undefined;
  assert.ok(comment?.kind === "comment");
  assert.equal(source.slice(comment.replacement.sourceFrom, comment.replacement.sourceTo), String.raw`\begin{comment}
\section{Hidden}\label{hidden}
\end{comment}`);
  assert.deepEqual(records.filter(r => r.kind === "heading").map(r => r.title), ["Visible"]);
});

test("noindent is a source-linked layout marker, without consuming the following group", () => {
  const source = String.raw`\begin{document}\noindent{\textbf{Visible} $x$}`;
  const records = scanVisualDocumentStructure(source).records;
  const layout = records.find(r => r.kind === "accent" && r.text === "");
  assert.ok(layout?.kind === "accent");
  assert.equal(source.slice(layout.from, layout.to), String.raw`\noindent`);
  assert.ok(records.some(r => r.kind === "textStyle" && r.bold));
});

test("JHEP front matter preserves abstract, affiliation markers and email source ranges", () => {
  const source = String.raw`\documentclass{article}\usepackage{jheppub}
\title{Paper}\author{Writer}\affiliation[a]{Institute}\emailAdd{writer@example.test}
\abstract{A result with $x^2$.}\begin{document}\maketitle`;
  const title = scanVisualDocumentStructure(source).records.find(r => r.kind === "maketitle");
  assert.equal(title?.frontMatter?.sections[0]?.role, "abstract");
  assert.equal(title?.frontMatter?.sections[0]?.source.text, "A result with $x^2$.");
  assert.deepEqual(title?.affiliations[0]?.markers, ["a"]);
  assert.equal(title?.emails[0]?.text, "writer@example.test");
  assert.equal(source.slice(title!.emails[0]!.from, title!.emails[0]!.to), "writer@example.test");
});

test("common text wrappers and grouped noindent keep styled text editable", () => {
  const source = String.raw`\begin{document}{\noindent Grouped.} \text{\textbf{Text}} \textrm{Roman}`;
  const records = scanVisualDocumentStructure(source).records.filter(r => r.kind === "textStyle");
  assert.ok(records.some(r => r.command === "noindent" && source.slice(r.contentFrom, r.contentTo).trim() === "Grouped."));
  assert.ok(records.some(r => r.command === "text"));
  assert.ok(records.some(r => r.command === "textrm"));
  assert.ok(records.some(r => r.bold));
});

test("mathematical title and author metadata retain renderable fragments and separate source ranges", () => {
  const source = String.raw`\documentclass{revtex4-2}\begin{document}
\title{A $\mathfrak{g}$ symmetry}\author{Writer$^a$}\address{Institute}
\begin{abstract}Abstract text.\end{abstract}
\hfill PREPRINT
\maketitle`;
  const title = scanVisualDocumentStructure(source).records.find(r => r.kind === "maketitle");
  assert.ok(title?.title?.segments?.some(segment => segment.kind === "math"));
  assert.ok(title?.authors[0]?.segments?.some(segment => segment.kind === "math"));
  const ranges = (title as unknown as { metadataReplacements?: {sourceFrom:number; sourceTo:number}[] })?.metadataReplacements;
  assert.equal(ranges?.length, 3);
  assert.ok(ranges?.every(range => !source.slice(range.sourceFrom, range.sourceTo).includes('PREPRINT')));
});

test("unresolved title macros retain a visible source fallback", () => {
  const source = String.raw`\documentclass{article}\title{\UnknownTitle}\begin{document}\maketitle`;
  const title = scanVisualDocumentStructure(source).records.find(r => r.kind === "maketitle");
  assert.equal(title?.title?.text, String.raw`\UnknownTitle`);
  assert.equal(title?.title?.segments?.filter(segment => segment.kind === "text").map(segment => segment.text).join(''), String.raw`\UnknownTitle`);
});

test("footnotes expose their content and nested references without raw wrapper syntax", () => {
  const source = String.raw`\begin{document}Text\footnote[2]{A note with $x$ and \cite{key}.}`;
  const records = scanVisualDocumentStructure(source).records;
  const note = records.find(r => r.kind === "textStyle" && r.command === "footnote");
  assert.ok(note?.kind === "textStyle");
  assert.equal(source.slice(note.contentFrom,note.contentTo), String.raw`A note with $x$ and \cite{key}.`);
  assert.ok(records.some(r => r.kind === "citation" && r.keys[0] === "key"));
});

test("page spacing controls are source-linked without leaking their dimensions into prose", () => {
  const source = String.raw`\begin{document}Text\par\medskip\smallskip\bigskip\hfill\newpage\vspace{-20pt}after`;
  const markers = scanVisualDocumentStructure(source).records.filter(r => r.kind === "accent").filter(r => r.text === "");
  assert.deepEqual(markers.map(r => source.slice(r.from,r.to)), [String.raw`\par`,String.raw`\medskip`,String.raw`\smallskip`,String.raw`\bigskip`,String.raw`\hfill`,String.raw`\newpage`,String.raw`\vspace{-20pt}`]);
});
