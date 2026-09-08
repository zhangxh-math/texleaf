import assert from 'node:assert/strict';
import test from 'node:test';
import { scanVisualDocumentStructure, findVisualLabeledStructureForLabel } from '../src/core/visualStructure';

test('a composite figure and Young pair retain complete source and a single reference target', () => {
 for(const body of [
  String.raw`\begin{minipage}{.3\textwidth}\includegraphics{one.pdf}\\(a)\end{minipage}
\begin{minipage}{.3\textwidth}\includegraphics{two.pdf}\\(b)\end{minipage}
\begin{minipage}{.3\textwidth}\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}\\(c)\end{minipage}`,
  String.raw`\ydiagram{6,4,4,2,1}\qquad\quad\ydiagram{5,4,3,3,1,1}`,
 ]) {
 const source=String.raw`\begin{document}
Before
\begin{figure*}[htbp]
${body}
\caption{All panels, with $x+y$.}\label{fig:all panels}
\end{figure*}
After \ref{fig:all panels}.
\end{document}`;
 const records=scanVisualDocumentStructure(source).records;
 const figure=records.find(r=>r.kind==='figure');
 assert.ok(figure?.kind==='figure');
 assert.equal(source.slice(figure.replacement.sourceFrom,figure.replacement.sourceTo),figure.tex);
 assert.ok(figure.tex.includes(body));
 assert.equal(figure.label?.key,'fig:all panels');
 assert.ok(figure.captionSegments?.some(s=>s.kind==='math'));
 assert.equal(records.filter(r=>r.kind==='image'||r.kind==='tikzpicture').length,0,'subpanels must not become partial replacements');
 assert.equal(findVisualLabeledStructureForLabel(source,records,'fig:all panels')?.record,figure);
 }
});

test('literal figure examples are inert and simple images retain their lightweight path', () => {
 const source=String.raw`\begin{document}
\begin{Verbatim}
\begin{figure}\includegraphics{fake-a.pdf}\includegraphics{fake-b.pdf}\end{figure}
\end{Verbatim}
\begin{figure}
\includegraphics{real.pdf}\caption{Simple image}
\end{figure}
\end{document}`;
 const records=scanVisualDocumentStructure(source).records;
 assert.equal(records.filter(r=>r.kind==='figure').length,0);
 assert.deepEqual(records.filter(r=>r.kind==='image').map(r=>r.path),['real.pdf']);
});
