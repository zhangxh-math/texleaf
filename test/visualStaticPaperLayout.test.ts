import assert from "node:assert/strict";
import test from "node:test";
import { scanVisualDocumentStructure } from "../src/core/visualStructure";

test("static paper layout keeps linked prose, nested structures and exact editable source ranges", () => {
  const source = String.raw`\documentclass{article}\usepackage{jheppub}\begin{document}
Text\footnote{See \href{https://example.test/\cite{not-a-reference}}{\emph{Encyclopedia} and \ref{sec:next}}.}
\begin{itemize}\setlength{\itemsep}{6pt}\item First\end{itemize}
\setlength{\itemsep}{6pt}
\setcounter{page}{1}
\begin{multicols}{2}
Column body with \section{Next}\label{sec:next} and $x$.
\end{multicols}
\acknowledgments
We thank the readers.
\end{document}`;
  const records = scanVisualDocumentStructure(source).records;
  const href = records.find(r => r.kind === "textStyle" && r.command === "href");
  assert.ok(href?.kind === "textStyle");
  assert.equal(source.slice(href.from, href.to), String.raw`\href{https://example.test/\cite{not-a-reference}}{\emph{Encyclopedia} and \ref{sec:next}}`);
  assert.equal(source.slice(href.contentFrom, href.contentTo), String.raw`\emph{Encyclopedia} and \ref{sec:next}`);
  assert.ok(records.some(r => r.kind === "textStyle" && r.italic));
  assert.ok(records.some(r => r.kind === "reference" && r.keys[0] === "sec:next"));
  assert.ok(!records.some(r => r.kind === "citation" && r.keys.includes("not-a-reference")));
  const markers = records.filter(r => r.kind === "accent").filter(r => r.text === "");
  assert.deepEqual(markers.map(r => source.slice(r.from, r.to)), [
    String.raw`\setlength{\itemsep}{6pt}`, String.raw`\setlength{\itemsep}{6pt}`, String.raw`\setcounter{page}{1}`,
  ]);
  const columns = records.find(r => r.kind === "textStyle" && r.command === "multicols");
  assert.ok(columns?.kind === "textStyle" && columns.transparent);
  assert.equal(source.slice(columns.prefixFrom, columns.prefixTo), String.raw`\begin{multicols}{2}`);
  assert.equal(source.slice(columns.suffixFrom, columns.suffixTo), String.raw`\end{multicols}`);
  assert.ok(source.slice(columns.contentFrom, columns.contentTo).includes("Column body"));
  const heading = records.find(r => r.kind === "heading" && r.title === "Acknowledgments");
  assert.ok(heading?.kind === "heading");
  assert.equal(source.slice(heading.from, heading.to), String.raw`\acknowledgments`);
  assert.equal(heading.number, undefined);
  assert.equal(heading.contentFrom, heading.contentTo);
  assert.equal((heading as typeof heading & { generatedTitle?: boolean }).generatedTitle, true);
  assert.ok(records.some(r => r.kind === "heading" && r.title === "Next" && r.number === "1"));
});

test("dynamic layout, dynamic counters, custom commands and invalid columns stay visible source", () => {
  const source = String.raw`\documentclass{article}\usepackage{jheppub}
\renewcommand{\acknowledgments}{Custom thanks}\begin{document}
\setlength{\itemsep}{\customLength}\setlength{\customLength}{6pt}
\setcounter{section}{\nextSection}\setcounter{page}{\nextPage}
\begin{multicols}{\columns}Dynamic columns\end{multicols}
\acknowledgments`;
  const records = scanVisualDocumentStructure(source).records;
  assert.ok(!records.some(r => r.kind === "accent" && r.text === ""));
  assert.ok(!records.some(r => r.kind === "textStyle" && r.command === "multicols"));
  assert.ok(!records.some(r => r.kind === "heading" && r.title === "Acknowledgments"));
  assert.ok(!scanVisualDocumentStructure(String.raw`\begin{document}\acknowledgments`).records
    .some(r => r.kind === "heading" && r.title === "Acknowledgments"));
});
