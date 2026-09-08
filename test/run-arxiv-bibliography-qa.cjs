// Read-only corpus check. Run after test:compile with a directory of extracted papers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Module = require('node:module');
const compiled = path.join(__dirname, '..', '.test-dist', 'src');
const corpus = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2], 'Pass the extracted-paper corpus directory.');
class Uri {
  constructor(fsPath) { this.fsPath = fsPath; this.path = fsPath; this.scheme = 'file'; this.authority = ''; this.query = ''; this.fragment = ''; }
  toString() { return pathToFileURL(this.fsPath).toString(); }
}
class FileSystemError extends Error {}
const api = {
  Uri: { file: value => new Uri(value), joinPath: (base, ...parts) => new Uri(path.join(base.fsPath, ...parts)) },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  FileSystemError,
  workspace: { textDocuments: [], fs: {
    readFile: async uri => fs.promises.readFile(uri.fsPath),
    stat: async uri => { const s = await fs.promises.lstat(uri.fsPath); return { type: s.isSymbolicLink() ? 64 : s.isDirectory() ? 2 : s.isFile() ? 1 : 0, size: s.size }; },
  } },
};
const original = Module._load;
let CitationController;
try {
  Module._load = function(id, parent, main) { return id === 'vscode' ? api : original.call(this, id, parent, main); };
  ({ CitationController } = require(path.join(compiled, 'citationController.js')));
} finally { Module._load = original; }
const { scanVisualDocumentStructure, resolveVisualBibliography, visualInlineReferenceRecords } = require(path.join(compiled, 'core', 'visualStructure.js'));
const { resolveProjectBibliographyPath } = require(path.join(compiled, 'pdf', 'bibliographyMapping.js'));
const { validateExistingRealProjectFile } = require(path.join(compiled, 'projectFilesystemSafety.js'));

// An independent literal-cite oracle for this corpus; masking preserves offsets.
function executableSource(source) {
  const characters = source.split('');
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '%') continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && source[j] === '\\'; j--) slashes++;
    if (slashes % 2) continue;
    while (i < source.length && source[i] !== '\n') characters[i++] = ' ';
  }
  return characters.join('').replace(/\\begin\s*\{comment\}[\s\S]*?\\end\s*\{comment\}/gu, value => value.replace(/[^\n]/gu, ' '));
}

(async () => {
  const report = [];
  for (const directory of fs.readdirSync(corpus).filter(name => /^arXiv-/u.test(name)).sort()) {
    const folder = path.join(corpus, directory);
    if (!fs.statSync(folder).isDirectory()) continue;
    const mains = fs.readdirSync(folder).filter(name => name.endsWith('.tex') && /\\documentclass\b/u.test(executableSource(fs.readFileSync(path.join(folder, name), 'utf8'))));
    assert.equal(mains.length, 1, `${directory}: expected one standalone source`);
    const main = path.join(folder, mains[0]);
    const source = fs.readFileSync(main, 'utf8');
    const activeSource = executableSource(source);
    const oracle = [...activeSource.matchAll(/\\cite\b(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]+)\}/gu)];
    const structure = scanVisualDocumentStructure(source);
    const boundary = api.Uri.file(folder);
    const uris = [];
    for (const requested of structure.bibliographyPaths) {
      const candidate = resolveProjectBibliographyPath(main, requested, folder);
      if (!candidate || !fs.existsSync(candidate)) continue;
      uris.push((await validateExistingRealProjectFile(api, boundary, path.relative(folder, candidate))).uri);
    }
    if (uris.length === 0 && structure.hasBibliographyDeclaration) {
      const generated = main.replace(/\.tex$/u, '.bbl');
      if (fs.existsSync(generated)) uris.push((await validateExistingRealProjectFile(api, boundary, path.relative(folder, generated))).uri);
    }
    const controller = new CitationController(undefined, { warn: console.warn, error: console.error });
    const bibliography = await controller.readProjectBibliographyPreview(uris);
    const resolved = resolveVisualBibliography(structure, bibliography.entries);
    const citations = visualInlineReferenceRecords(resolved).filter(record => record.kind === 'citation');
    const recordsByOffset = new Map(citations.map(record => [record.from, record]));
    const missingOccurrences = oracle.filter(match => !recordsByOffset.has(match.index)).map(match => ({ line: source.slice(0, match.index).split('\n').length, keys: match[1] }));
    const unresolvedKeys = [...new Set(oracle.flatMap(match => {
      const previews = recordsByOffset.get(match.index)?.previews ?? [];
      return match[1].split(',').map(key => key.trim()).filter(key => !previews.some(preview => preview.key === key));
    }))];
    const availableKeys = new Set([...bibliography.entries.map(entry => entry.key), ...structure.records.flatMap(record =>
      record.kind === 'bibliography' && record.manual ? record.entries.map(entry => entry.key) : [])]);
    const missingBibliographyKeys = [...new Set(oracle.flatMap(match => match[1].split(',').map(key => key.trim())))]
      .filter(key => !availableKeys.has(key));
    const item = {
      paper: directory, main: mains[0], sourceCitationOccurrences: oracle.length,
      visualCitationOccurrences: citations.length, uniqueCitedKeys: new Set(oracle.flatMap(match => match[1].split(',').map(key => key.trim()))).size,
      declaredBibliography: structure.bibliographyPaths, resolvedFiles: uris.map(uri => path.basename(uri.fsPath)),
      externalEntries: bibliography.entries.length,
      manualEntries: structure.records.filter(record => record.kind === 'bibliography' && record.manual).reduce((sum, record) => sum + record.totalEntries, 0),
      duplicateKeys: [...bibliography.duplicateKeys], missingOccurrences, unresolvedKeys, missingBibliographyKeys,
    };
    report.push(item);
    if (missingOccurrences.length || unresolvedKeys.length) process.exitCode = 1;
    controller.dispose();
  }
  assert.equal(report.length, Number(process.argv[4] || 5), 'Expected every requested arXiv source project.');
  const output = JSON.stringify({ checkedAt: new Date().toISOString(), corpus, papers: report, passed: !process.exitCode }, null, 2);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], output + '\n');
  console.log(output);
})().catch(error => { console.error(error); process.exitCode = 1; });
