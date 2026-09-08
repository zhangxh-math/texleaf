import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { parseBibTeX } from '../src/core/citation';
import { resolveVisualBibliography, scanVisualDocumentStructure } from '../src/core/visualStructure';

const longKey = 'SyntheticEntryWithLongButValidCitationKeyForManualRevtexBibliography2025';
const source = String.raw`\documentclass[aps,pra,longbibliography]{revtex4-2}
\begin{document}
A citation \cite{${longKey},second}.
\begin{thebibliography}{2}
\bibitem[{\citenamefont{Writer}\ and\ \citenamefont{Reader}(2025)}]{${longKey}}
\BibitemOpen
\bibfield{author}{\bibinfo{author}{A. Writer} and \bibinfo{author}{B. Reader}}
\bibfield{title}{A synthetic reference about testing}, \bibinfo{year}{2025}.
\BibitemShut{NoStop}
\bibitem{second} Another synthetic reference, 2024.
\end{thebibliography}
\end{document}`;

function citations(text: string, bib = '') {
  return resolveVisualBibliography(scanVisualDocumentStructure(text), parseBibTeX(bib))
    .records.filter(record => record.kind === 'citation');
}

test('REVTeX manual bibitems provide citation previews while keeping the citation key label', () => {
  const result = citations(source);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]!.previews.map(entry => entry.key), [longKey, 'second']);
  assert.equal(result[0]!.label, `[${longKey}; second]`);
  assert.match(result[0]!.previews[0]!.title, /synthetic reference about testing/u);
  assert.equal(result[0]!.previews[0]!.entryType, 'bibitem');
  assert.ok(result[0]!.previews[0]!.sourceFrom !== undefined);
});

test('manual entries take precedence over unrelated external metadata with the same key', () => {
  const result = citations(source, `@article{${longKey},author={Unrelated Author},title={Wrong source},year={1999}}`);
  assert.equal(result[0]!.label, `[${longKey}; second]`);
  assert.match(result[0]!.previews[0]!.title, /synthetic reference about testing/u);
  assert.match(result[0]!.previews[0]!.source, /thebibliography/u);
});

test('duplicate manual keys stay unresolved instead of selecting either entry or an external fallback', () => {
  const text = String.raw`\begin{document}\cite{duplicate}
\begin{thebibliography}{2}\bibitem{duplicate} First.\bibitem{duplicate} Second.\end{thebibliography}\end{document}`;
  const result = citations(text, '@article{duplicate,title={External fallback},author={Some Author},year={2000}}');
  assert.deepEqual(result[0]!.previews, []);
  assert.equal(result[0]!.label, '[duplicate]');
});

test('ordinary BibTeX previews and unresolved keys retain their existing behavior', () => {
  const result = citations(String.raw`\begin{document}\cite{external,missing}\end{document}`,
    '@article{external,title={External title},author={Ada Lovelace},year={1843}}');
  assert.deepEqual(result[0]!.previews.map(entry => entry.key), ['external']);
  assert.equal(result[0]!.previews[0]!.title, 'External title');
  assert.equal(result[0]!.label, '[Lovelace, 1843; missing]');
});

test('the actual host bibliography binding skips external reads for fully resolved manual citations', async () => {
  const provider = readFileSync(path.join(process.cwd(), 'src/visualEditorProvider.ts'), 'utf8');
  const start = provider.indexOf('    const rootFile = projectContext.rootUri', provider.indexOf('  private async postDocument('));
  const end = provider.indexOf('    structure = await resolveVisualImagePreviews(', start);
  assert.ok(start >= 0 && end > start);
  const compiled = transpileModule(`class Binding { async resolve(structure) {
    const projectContext = { rootUri: undefined };
    const documentGeneration = 1, version = 1, text = source;
    const session = { disposed: false, documentGeneration: 1, document: { version: 1, getText: () => source } };
    const config = { bibliographyFile: 'reference.bib' };
    ${provider.slice(start, end)}
    return structure;
  } } module.exports = Binding;`, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const module = { exports: undefined as unknown as new () => { resolve(structure: ReturnType<typeof scanVisualDocumentStructure>): Promise<ReturnType<typeof scanVisualDocumentStructure>> } };
  let reads = 0, warnings = 0;
  runInNewContext(compiled, { module, source, path, resolveVisualBibliography,
    resolveTemplateBibliographyUris: async () => undefined,
    visualDocumentText: (document: { getText(): string }) => document.getText(),
    cardPrompt: { showWarningMessage: () => { warnings += 1; } },
    errorMessage: String,
  });
  const binding = new module.exports();
  Object.assign(binding, {
    citations: { readBibliographyPreview: async () => { reads += 1; return { entries: [] }; } },
    output: { warn: () => {} },
  });
  const result = await binding.resolve(scanVisualDocumentStructure(source));
  assert.equal(reads, 0); assert.equal(warnings, 0);
  assert.equal(result.records.find(record => record.kind === 'citation')?.previews.length, 2);
});
