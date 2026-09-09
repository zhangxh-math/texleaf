import assert from "node:assert/strict";
import test from "node:test";
import { scanVisualDocumentStructure } from "../src/core/visualStructure";

const source = String.raw`\documentclass[12pt]{beamer}
\definecolor{accent}{HTML}{087F8C}
\definecolor{muted}{HTML}{617080}
\setbeamercolor{alerted text}{fg=accent}
\newcommand{\source}[1]{\par\vfill{\fontsize{8}{10}\selectfont\color{muted}#1\par}}
\begin{document}
\begin{frame}[plain]
\vspace{5mm}
{\small\color{muted}Research presentation\par}
{\fontsize{25}{30}\selectfont\bfseries A title\\with two lines\par}
\begin{columns}[T,onlytextwidth]
\begin{column}{0.47\textwidth}{\color{accent}\bfseries Geometry\par} $x$\end{column}
\begin{column}[T]{0.47\textwidth}Analysis \textcolor{accent}{Result}\end{column}
\end{columns}
\alert{Highlighted claim}
\source{See \emph{Reference} and \ref{sec:one}.}
\end{frame}\end{document}`;

test("Beamer groups, linear columns and static source wrappers keep editable physical ranges", () => {
  const result = scanVisualDocumentStructure(source);
  const styles = result.records.filter(r => r.kind === "textStyle");
  const title = styles.find(r => source.slice(r.contentFrom, r.contentTo).startsWith("A title"));
  assert.ok(title, "fontsize declaration wraps the visible title");
  assert.equal(title.bold, true);
  assert.equal((title as typeof title & {fontSize?: number}).fontSize, 25 / 12);
  assert.equal(source.slice(title.suffixFrom, title.suffixTo), String.raw`\par}`);
  assert.equal(styles.find(r => r.command === "small")?.foreground, "#617080");
  assert.equal(styles.find(r => r.command === "color")?.foreground, "#087F8C");
  assert.equal(styles.find(r => r.command === "textcolor")?.foreground, "#087F8C");
  assert.equal(styles.find(r => r.command === "alert")?.foreground, "#087F8C");
  assert.deepEqual(styles.filter(r => ["columns", "column"].includes(r.command)).map(r => r.command), ["columns", "column", "column"]);
  const note = styles.find(r => r.command === "source");
  assert.ok(note);
  assert.equal(note.foreground, "#617080");
  assert.equal(source.slice(note.contentFrom, note.contentTo), String.raw`See \emph{Reference} and \ref{sec:one}.`);
  assert.ok(styles.some(r => r.command === "emph" && r.from > note.contentFrom));
  assert.ok(result.records.some(r => r.kind === "reference"));
});

test("dynamic columns and unsupported source definitions remain visible", () => {
  const source = String.raw`\documentclass{beamer}
\newcommand{\source}[1]{\par\vfill{\fontsize{8}{10}\selectfont\unknown#1\par}}
\begin{document}\begin{frame}\begin{columns}[unknown]\begin{column}{\dynamicwidth}Body\end{column}\end{columns}
\source{Reference}{\fontsize{999}{1}\selectfont Body}\end{frame}\end{document}`;
  assert.equal(scanVisualDocumentStructure(source).records.filter(r => r.kind === "textStyle" && ["source", "columns", "column", "fontsize"].includes(r.command)).length, 0);
});


test("local color and wrapper definitions restore their enclosing scope and providecommand preserves definitions", () => {
  const source = String.raw`\definecolor{brand}{HTML}{112233}
\newcommand{\tag}[1]{{\bfseries #1}}
\providecommand{\tag}[1]{{\itshape #1}}
\newcommand{\opaque}[1]{\unknown{#1}}
\providecommand{\opaque}[1]{{\bfseries #1}}
\begin{document}
{\definecolor{brand}{HTML}{AABBCC}\textcolor{brand}{inner}}
\textcolor{brand}{outer}\tag{bold}\opaque{source}
\begin{center}\definecolor{brand}{HTML}{FFEEDD}\textcolor{brand}{center}\end{center}
\textcolor{brand}{outer again}
{\renewcommand{\tag}[1]{{\itshape #1}}\tag{italic}}\tag{bold again}
{\small Literal \\par}
\end{document}`;
  const styles = scanVisualDocumentStructure(source).records.filter(r => r.kind === "textStyle");
  assert.deepEqual(styles.filter(r => r.command === "textcolor").map(r => r.foreground), ["#AABBCC", "#112233", "#FFEEDD", "#112233"]);
  assert.deepEqual(styles.filter(r => r.command === "tag").map(r => [r.bold, r.italic]), [[true, false], [false, true], [true, false]]);
  assert.equal(styles.some(r => r.command === "opaque"), false);
  const literal = styles.find(r => r.command === "small")!;
  assert.equal(source.slice(literal.contentFrom, literal.contentTo), String.raw`Literal \\par`);
});


test("global definitions do not resurrect stale wrappers or colors at group end", () => {
  for (const definition of [String.raw`\gdef\tag#1{\unknown{#1}}`, String.raw`\global\def\tag#1{\unknown{#1}}`, String.raw`\xdef\tag#1{\unknown{#1}}`]) {
    const source = String.raw`\newcommand{\tag}[1]{{\bfseries #1}}\begin{document}{${definition}}\tag{After}\end{document}`;
    assert.equal(scanVisualDocumentStructure(source).records.some(r => r.kind === "textStyle" && r.command === "tag"), false);
  }
  const source = String.raw`\definecolor{brand}{HTML}{112233}\begin{document}
{\definecolor{brand}{HTML}{AABBCC}{\globalcolorstrue\definecolor{brand}{HTML}{FFEEDD}}}
\textcolor{brand}{After}\end{document}`;
  assert.equal(scanVisualDocumentStructure(source).records.filter(r => r.kind === "textStyle").find(r => r.command === "textcolor")?.foreground, "#FFEEDD");
});
