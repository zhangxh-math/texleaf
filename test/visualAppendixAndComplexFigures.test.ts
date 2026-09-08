import assert from "node:assert/strict";
import test from "node:test";
import { findVisualHeadingForLabel, numberVisualHeadingSequence, scanVisualDocumentStructure } from "../src/core/visualStructure";

test("standard appendix resets the root counter and propagates letters to subsections and theorems", () => {
  for (const [documentClass, root] of [["article", "section"], ["book", "chapter"]] as const) {
    const source = String.raw`\documentclass{${documentClass}}\newtheorem{lemma}{Lemma}[${root}]
\begin{document}${"\\" + root}{Main}\label{main}
\appendix${"\\" + root}*{Interlude}${"\\" + root}{Details}\label{app:details}
${"\\" + (root === "chapter" ? "section" : "subsection")}{Proof}\begin{lemma}Claim\end{lemma}
${"\\" + root}{More}\end{document}`;
    const structure = scanVisualDocumentStructure(source);
    assert.deepEqual(structure.records.filter(r => r.kind === "heading").map(r => r.number), ["1", undefined, "A", "A.1", "B"]);
    assert.equal(findVisualHeadingForLabel(source, structure.records, "app:details")?.number, "A");
    assert.equal(structure.records.find(r => r.kind === "theorem")?.number, "A.1");
    assert.deepEqual((structure as typeof structure & { appendixOffsets?: readonly number[] }).appendixOffsets, [source.indexOf("\\appendix")]);
  }
  const headings = [
    { command: "section", starred: false },
    { command: "section", starred: true, appendixStart: true },
    { command: "section", starred: false },
    { command: "subsection", starred: false },
  ] as const;
  assert.deepEqual(numberVisualHeadingSequence(headings, "section"), ["1", undefined, "A", "A.1"]);
});

test("image cards never conceal the rest of a composite figure", () => {
  for (const body of [
    String.raw`\includegraphics{one.pdf}\includegraphics{two.pdf}`,
    String.raw`\begin{tikzpicture}\node{\includegraphics{one.pdf}};\end{tikzpicture}`,
  ]) {
    const source = String.raw`\begin{document}
\begin{figure}
${body}
\caption{Both parts matter}\label{fig:composite}
\end{figure}
\end{document}`;
    const structure = scanVisualDocumentStructure(source);
    assert.ok(!structure.records.some(r => r.kind === "image" && source.slice(r.replacement.sourceFrom, r.replacement.sourceTo).includes("\\begin{figure}")), "a partial image must not replace the complete figure");
  }
});
