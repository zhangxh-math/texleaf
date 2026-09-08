// Read-only literal-reference corpus audit. Run after test:compile; no UI is driven.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const compiled = path.join(__dirname, '..', '.test-dist', 'src', 'core');
const {
  scanVisualDocumentStructure, visualInlineReferenceRecords,
  findVisualLabelsInRange, indexVisualStructureReferences,
} = require(path.join(compiled, 'visualStructure.js'));
const {
  scanMathPreviewDocument, createMathPreviewMacroEnvironment,
} = require(path.join(compiled, 'mathPreview.js'));
assert.ok(process.argv[2], 'Pass the extracted-paper corpus directory.');
const corpus = path.resolve(process.argv[2]);

// Independent source oracle: preserve UTF-16 offsets when masking comments.
// Only literal ref/eqref/autoref calls in the document body are in scope;
// preamble macro definitions such as ref{#1} are not executable references.
function executableSource(source) {
  const characters = source.split('');
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '%') continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && source[j] === '\\'; j--) slashes++;
    if (slashes % 2) continue;
    while (i < source.length && source[i] !== '\n') characters[i++] = ' ';
  }
  return characters.join('').replace(/\\begin\s*\{comment\}[\s\S]*?\\end\s*\{comment\}/gu,
    value => value.replace(/[^\n]/gu, ' '));
}

const report = [];
for (const directory of fs.readdirSync(corpus).filter(name => /^arXiv-/u.test(name)).sort()) {
  const folder = path.join(corpus, directory);
  if (!fs.statSync(folder).isDirectory()) continue;
  const mains = fs.readdirSync(folder).filter(name => name.endsWith('.tex') &&
    /\\documentclass\b/u.test(executableSource(fs.readFileSync(path.join(folder, name), 'utf8'))));
  assert.equal(mains.length, 1, `${directory}: expected one standalone source`);
  const source = fs.readFileSync(path.join(folder, mains[0]), 'utf8');
  const active = executableSource(source);
  const begin = /\\begin\s*\{document\}/u.exec(active);
  const end = /\\end\s*\{document\}/u.exec(active);
  assert.ok(begin && end, `${directory}: expected explicit document boundaries`);
  const bodyFrom = begin.index + begin[0].length;
  const bodyTo = end.index;
  const lineAt = offset => source.slice(0, offset).split('\n').length;
  const oracle = [...active.matchAll(/\\(ref|eqref|autoref)\b\*?\s*\{([^{}]+)\}/gu)]
    .filter(match => match.index >= bodyFrom && match.index < bodyTo);
  // Read literal project-local supplemental preambles just as this corpus does.
  // Keep separate files out of the physical source offset space.
  const supplementalMacros = {};
  for (const match of active.slice(0, begin.index).matchAll(/\\(?:input|include)\s*\{([^{}]+)\}/gu)) {
    const requested = match[1].endsWith('.tex') ? match[1] : `${match[1]}.tex`;
    const candidate = path.resolve(folder, requested);
    if (!candidate.startsWith(folder + path.sep) || !fs.existsSync(candidate)) continue;
    const real = fs.realpathSync(candidate);
    if (!real.startsWith(fs.realpathSync(folder) + path.sep)) continue;
    Object.assign(supplementalMacros, scanMathPreviewDocument(fs.readFileSync(real, 'utf8'),
      { fragmentKind: 'preamble' }).macros);
  }
  const structure = scanVisualDocumentStructure(source);
  const formulas = scanMathPreviewDocument(source, {
    maxSourceLength: 32768,
    inheritedMacroEnvironment: createMathPreviewMacroEnvironment(supplementalMacros),
  }).formulas;
  const references = visualInlineReferenceRecords(structure).filter(record => record.kind === 'reference');
  const referencesByOffset = new Map(references.map(record => [record.from, record]));
  const labels = findVisualLabelsInRange(source, 0, source.length);
  const structuresByKey = indexVisualStructureReferences(source, structure.records);
  const labelsByKey = new Map();
  for (const label of labels) {
    if (!labelsByKey.has(label.key)) labelsByKey.set(label.key, []);
    labelsByKey.get(label.key).push(label);
  }
  const targetForKey = key => {
    const matches = labelsByKey.get(key) || [];
    const target = { key, labelLines: matches.map(label => lineAt(label.from)) };
    if (matches.length !== 1) return { ...target, category: matches.length ? 'ambiguous-label' : 'missing-label' };
    const label = matches[0];
    const owners = formulas.filter(formula => label.from >= formula.outerRange.start && label.to <= formula.outerRange.end);
    if (owners.length === 1) return { ...target, category: 'formula', formulaLine: lineAt(owners[0].outerRange.start) };
    if (owners.length > 1) return { ...target, category: 'ambiguous-formula' };
    const wrappers = structure.records.filter(record => record.kind === 'textStyle' &&
      record.transparent === true && record.command === 'subequations' &&
      label.from >= record.contentFrom && label.to <= record.contentTo);
    if (wrappers.length === 1) {
      const wrapper = wrappers[0];
      const children = formulas.filter(formula => formula.mode === 'block' &&
        formula.outerRange.start >= wrapper.contentFrom && formula.outerRange.end <= wrapper.contentTo);
      if (children.length === 1) return { ...target, category: 'formula-wrapper', formulaLine: lineAt(children[0].outerRange.start) };
      return { ...target, category: 'ambiguous-formula-wrapper', childFormulaCount: children.length };
    }
    const presentation = structuresByKey.get(key);
    return { ...target, category: presentation?.targetKind || 'label-without-preview-owner' };
  };
  const occurrences = oracle.map(match => {
    const offset = match.index;
    const keys = match[2].split(',').map(key => key.trim());
    const formula = formulas.find(record => offset >= record.bodyRange.start &&
      offset + match[0].length <= record.bodyRange.end);
    const widget = referencesByOffset.get(offset);
    return {
      line: lineAt(offset), from: offset, command: match[1], keys,
      presentation: formula ? 'math-mtext-key-fallback' : widget ? 'reference-widget' : 'missing-widget',
      ...(formula ? { formulaLine: lineAt(formula.outerRange.start) } : {}),
      ...(widget ? { widgetKeysMatch: keys.every(key => widget.keys.includes(key)) && widget.keys.length === keys.length } : {}),
      targets: keys.map(targetForKey),
    };
  });
  const missingOccurrences = occurrences.filter(item => item.presentation === 'missing-widget' || item.widgetKeysMatch === false);
  const missingTargets = occurrences.flatMap(item => item.targets
    .filter(target => /^(?:missing|ambiguous|label-without)/u.test(target.category))
    .map(target => ({ referenceLine: item.line, ...target })));
  const categories = {};
  for (const item of occurrences) for (const target of item.targets) categories[target.category] = (categories[target.category] || 0) + 1;
  report.push({
    paper: directory, main: mains[0], sourceReferenceOccurrences: oracle.length,
    referenceWidgetOccurrences: occurrences.filter(item => item.presentation === 'reference-widget').length,
    mathMtextFallbackOccurrences: occurrences.filter(item => item.presentation === 'math-mtext-key-fallback').length,
    uniqueReferencedKeys: new Set(occurrences.flatMap(item => item.keys)).size,
    targetCategories: categories, missingOccurrences, missingTargets, occurrences,
  });
}
assert.equal(report.length, Number(process.argv[4] || 5), 'Expected every requested arXiv source project.');
const passed = report.every(item => item.missingOccurrences.length === 0 && item.missingTargets.length === 0);
const output = JSON.stringify({ checkedAt: new Date().toISOString(), corpus,
  scope: 'Literal body ref/eqref/autoref source ranges and local preview ownership; math refs remain mtext keys. No mouse, MathJax rendering, PDF numbering, dynamic macros, or cross-file reference proof.',
  papers: report, passed }, null, 2);
if (process.argv[3]) fs.writeFileSync(process.argv[3], output + '\n');
console.log(output);
if (!passed) process.exitCode = 1;
