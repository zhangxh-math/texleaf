import assert from 'node:assert/strict';
import test from 'node:test';
import * as visual from '../src/core/visualStructure';
import { parseBibTeX } from '../src/core/citation';
import type { VisualCitationRecord, VisualReferenceRecord } from '../src/core/visualStructure';

type InlineRecord = VisualCitationRecord | VisualReferenceRecord;
const source = String.raw`\documentclass{article}
\newtheorem{theorem}{Theorem}
\begin{document}
\begin{figure*}
\includegraphics{diagram.pdf}
\caption{See \citep[compare][p. 4]{alpha,beta}, equation \eqref{eq:test}, and $x$.}
\end{figure*}
\begin{theorem}[{\cite[Theorem 5.1]{alpha}} and {\cite[Theorem 1.2]{beta}}]
Body.
\end{theorem}
\begin{table}
\caption{More \cite{alpha}.}
\begin{tabular}{l}
Text \cite{beta} \\
\end{tabular}
\end{table}
\end{document}`;

function allInline(structure: visual.VisualDocumentStructure): readonly InlineRecord[] {
  const collect = (visual as unknown as {
    visualInlineReferenceRecords?: (structure: visual.VisualDocumentStructure) => readonly InlineRecord[];
  }).visualInlineReferenceRecords;
  assert.equal(typeof collect, 'function', 'nested references need the same host validation path as ordinary references');
  return collect!(structure);
}

test('folded figure captions, theorem titles, and tables preserve all nested citation ranges', () => {
  const structure = visual.scanVisualDocumentStructure(source);
  assert.deepEqual(structure.citedKeys, ['alpha', 'beta']);
  const records = allInline(structure);
  const citations = records.filter(record => record.kind === 'citation');
  assert.equal(citations.length, 5);
  assert.deepEqual(citations.map(record => source.slice(record.from, record.to)), [
    String.raw`\citep[compare][p. 4]{alpha,beta}`,
    String.raw`\cite[Theorem 5.1]{alpha}`,
    String.raw`\cite[Theorem 1.2]{beta}`,
    String.raw`\cite{alpha}`,
    String.raw`\cite{beta}`,
  ]);
  assert.deepEqual(citations[0]!.optionalArguments, ['compare', 'p. 4']);
  const reference = records.find(record => record.kind === 'reference');
  assert.ok(reference);
  assert.equal(source.slice(reference.from, reference.to), String.raw`\eqref{eq:test}`);
});

test('nested citations receive bibliography previews and retain missing-key honesty', () => {
  const structure = visual.scanVisualDocumentStructure(source);
  const resolved = visual.resolveVisualBibliography(structure, parseBibTeX('@book{alpha,title={Known reference}}'));
  const citations = allInline(resolved).filter((record): record is VisualCitationRecord => record.kind === 'citation');
  assert.equal(citations.length, 5);
  for (const citation of citations) {
    assert.deepEqual(citation.previews.map(preview => preview.key), citation.keys.filter(key => key === 'alpha'));
    for (const preview of citation.previews) assert.equal(preview.title, 'Known reference');
  }
});

test('longtable assembly reanchors nested citations to the physical source', () => {
  const text = String.raw`\begin{longtable}{l}
Header \\ \endfirsthead
Repeated header \\ \endhead
Text \cite{alpha} \\
\end{longtable}`;
  const references = allInline(visual.scanVisualDocumentStructure(text, { fragmentKind: 'body' }));
  assert.equal(references.length, 1);
  assert.equal(references[0]!.from, text.indexOf(String.raw`\cite{alpha}`));
  assert.equal(text.slice(references[0]!.from, references[0]!.to), String.raw`\cite{alpha}`);
});

test('caption citations skip comments, verbatim text, and conditional branches', () => {
  const text = String.raw`\begin{figure}
\includegraphics{x.pdf}
\caption{\iffalse\cite{hidden}\fi \verb|\cite{literal}| % \cite{commented}
Actual \cite{live}.}
\end{figure}`;
  const structure = visual.scanVisualDocumentStructure(text, { fragmentKind: 'body' });
  assert.deepEqual(allInline(structure).filter(record => record.kind === 'citation').flatMap(record => record.keys), ['live']);
});

test('longtable references use retained body offsets when a discarded repeated head is identical', () => {
  const text = String.raw`\begin{longtable}{l}
\caption{Caption}\label{tab:duplicate}\\
Header \\ \endfirsthead
Text \cite{alpha} and $x$ \\ \endhead
Text \cite{alpha} and $x$ \\
\end{longtable}`;
  const structure = visual.scanVisualDocumentStructure(text, { fragmentKind: 'body' });
  const references = allInline(structure);
  assert.equal(references.length, 1);
  assert.equal(references[0]!.from, text.lastIndexOf(String.raw`\cite{alpha}`));
  const table = structure.records.find(record => record.kind === 'table');
  assert.ok(table && table.kind === 'table');
  const lastCell = table.rows.at(-1)?.[0];
  assert.ok(lastCell);
  assert.equal(lastCell.sourceFrom, text.lastIndexOf(String.raw`Text \cite{alpha}`));
  const math = lastCell.segments.find(segment => segment.kind === 'math');
  assert.ok(math && math.kind === 'math');
  assert.equal(math.math.sourceFrom, text.lastIndexOf('$x$'));
});
