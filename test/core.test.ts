import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EnlargeBracketPlan,
  LatexContext,
  SnippetDefinitionInput,
  SnippetMatcher,
  SnippetMatcherOptions,
  compileSnippetFile,
  createLatexScanState,
  expandSnippetVariables,
  findFractionNumerator,
  isTeXLeafSourceUri,
  latexContextFromState,
  materializeReplacement,
  parseReplacementTemplate,
  parseSnippetOptions,
  planAutoEnlarge,
  planTabout,
  remapTabstopsForVsCode,
  replacementPartsToText,
  scanLatexContext,
  scanLatexRegions,
  scanLatexSegment,
  selectScopedResources,
  SerialTaskQueue,
  toPortableSnippetObject,
  validateSnippetFile,
} from '../src/core';
import {
  createSyncedSnippetEnvelope,
  decideSnippetSync,
  decodeSyncedSnippetEnvelope,
  hashSnippetContent,
} from '../src/snippetSync';

test('document scope accepts only saved .tex/.bib resources', () => {
  assert.equal(isTeXLeafSourceUri('file', '/paper/main.tex'), true);
  assert.equal(isTeXLeafSourceUri('file', '/paper/REFERENCES.BIB'), true);
  assert.equal(isTeXLeafSourceUri('vscode-remote', '/home/me/chapter.TeX'), true);
  assert.equal(isTeXLeafSourceUri('vscode-vfs', '/project/library.bIb'), true);

  assert.equal(isTeXLeafSourceUri('file', '/paper/main.tex.md'), false);
  assert.equal(isTeXLeafSourceUri('file', '/paper/references.bib.json'), false);
  assert.equal(isTeXLeafSourceUri('file', '/paper/main'), false);
  assert.equal(isTeXLeafSourceUri('untitled', 'Untitled-1.tex'), false);
  assert.equal(isTeXLeafSourceUri('UNTITLED', '/draft.bib'), false);
});

test('resource libraries isolate workspace extras by owning root', () => {
  const resources = [
    { scope: 'user' as const, value: 'global' },
    { scope: 'workspace' as const, ownerKey: 'root-a', value: 'a' },
    { scope: 'workspace' as const, ownerKey: 'root-b', value: 'b' },
  ];

  assert.deepEqual(selectScopedResources(resources, 'root-a'), ['global', 'a']);
  assert.deepEqual(selectScopedResources(resources, 'root-b'), ['global', 'b']);
  assert.deepEqual(selectScopedResources(resources, undefined), ['global']);
  assert.deepEqual(selectScopedResources(resources, undefined, true), [
    'global',
    'a',
    'b',
  ]);
});

test('portable snippet export preserves IDs containing namespace colons', () => {
  const exported = toPortableSnippetObject({
    portableId: 'namespace:item:variant',
    trigger: 'nsx',
    replacement: '\\operatorname{ns}',
    options: 'mA',
    priority: 0,
    category: 'User',
    syntaxVersion: 2,
    enabled: true,
  });

  assert.equal(exported.id, 'namespace:item:variant');
  assert.equal(exported.trigger, 'nsx');
});

test('serial task queue orders reload epochs and recovers after failure', async () => {
  const queue = new SerialTaskQueue();
  const events: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue(async (epoch) => {
    events.push(`start:${epoch}`);
    await firstGate;
    events.push(`end:${epoch}`);
    return epoch;
  });
  const second = queue.enqueue(async (epoch) => {
    events.push(`start:${epoch}`);
    events.push(`end:${epoch}`);
    return epoch;
  });
  await Promise.resolve();
  assert.deepEqual(events, ['start:1']);
  releaseFirst?.();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(events, ['start:1', 'end:1', 'start:2', 'end:2']);

  await assert.rejects(
    queue.enqueue(async () => {
      throw new Error('expected reload failure');
    }),
    /expected reload failure/,
  );
  assert.equal(await queue.enqueue(async (epoch) => epoch), 4);
});

test('snippet sync performs a conservative three-way hash merge', () => {
  const base = 'a'.repeat(64);
  const local = 'b'.repeat(64);
  const remote = 'c'.repeat(64);
  const factory = 'd'.repeat(64);
  const descendant = 'e'.repeat(64);

  assert.deepEqual(decideSnippetSync({
    localHash: local,
    remoteHash: local,
  }), { kind: 'settled' });
  assert.deepEqual(decideSnippetSync({
    localHash: local,
    initializationReady: false,
  }), { kind: 'defer' });
  assert.deepEqual(decideSnippetSync({
    localHash: local,
    initializationReady: true,
  }), { kind: 'publish-local' });

  assert.deepEqual(decideSnippetSync({
    localHash: base,
    remoteHash: remote,
    baseHash: base,
  }), { kind: 'apply-remote' });
  assert.deepEqual(decideSnippetSync({
    localHash: local,
    remoteHash: base,
    baseHash: base,
  }), { kind: 'publish-local' });
  assert.deepEqual(decideSnippetSync({
    localHash: local,
    remoteHash: remote,
    baseHash: base,
  }), { kind: 'conflict' });

  assert.deepEqual(decideSnippetSync({
    localHash: factory,
    remoteHash: remote,
    factoryHash: factory,
  }), { kind: 'apply-remote' });
  assert.deepEqual(decideSnippetSync({
    localHash: local,
    remoteHash: remote,
    factoryHash: factory,
  }), { kind: 'conflict' });

  // Two machines publishing from the same parent are sibling branches. A
  // locally committed Memento is not proof that the cloud accepted our branch.
  assert.deepEqual(decideSnippetSync({
    localHash: local,
    remoteHash: remote,
    remoteAncestorHashes: [base],
    baseHash: local,
    pendingUpload: true,
    pendingParentHash: base,
  }), { kind: 'conflict' });
  assert.deepEqual(decideSnippetSync({
    localHash: local,
    remoteHash: descendant,
    remoteAncestorHashes: [local, base],
    baseHash: local,
    pendingUpload: true,
    pendingParentHash: base,
  }), { kind: 'apply-remote' });
  assert.deepEqual(decideSnippetSync({
    localHash: local,
    remoteHash: base,
    baseHash: local,
    pendingUpload: true,
    pendingParentHash: base,
  }), { kind: 'publish-local' });
  assert.deepEqual(decideSnippetSync({
    localHash: local,
    remoteHash: descendant,
    baseHash: local,
    pendingUpload: true,
    pendingParentHash: base,
  }), { kind: 'conflict' });
});

test('snippet sync envelopes enforce integrity, JSONC validity, and size', () => {
  const content = `{
    // comments and trailing commas remain editable
    "version": 1,
    "snippets": [],
  }\n`;
  const created = createSyncedSnippetEnvelope(content, 4_096);
  assert.equal(created.kind, 'valid');
  if (created.kind !== 'valid') {
    return;
  }

  const decoded = decodeSyncedSnippetEnvelope(created.envelope, 4_096);
  assert.equal(decoded.kind, 'valid');
  if (decoded.kind === 'valid') {
    assert.equal(new TextDecoder().decode(decoded.bytes), content);
    assert.equal(decoded.envelope.contentHash, hashSnippetContent(content));
  }

  assert.equal(decodeSyncedSnippetEnvelope({
    ...created.envelope,
    contentHash: '0'.repeat(64),
  }, 4_096).kind, 'invalid');
  assert.equal(decodeSyncedSnippetEnvelope({
    ...created.envelope,
    content: '{ not valid JSONC',
    contentHash: hashSnippetContent('{ not valid JSONC'),
  }, 4_096).kind, 'invalid');
  const emptyObject = '{}';
  assert.equal(decodeSyncedSnippetEnvelope({
    schemaVersion: 1,
    content: emptyObject,
    contentHash: hashSnippetContent(emptyObject),
  }, 4_096).kind, 'invalid');
  const legacyStringLibrary = JSON.stringify({ snippets: '[{"trigger":"x","replacement":"y"}]' });
  assert.equal(decodeSyncedSnippetEnvelope({
    schemaVersion: 1,
    content: legacyStringLibrary,
    contentHash: hashSnippetContent(legacyStringLibrary),
  }, 4_096).kind, 'valid');
  const ancestor = 'a'.repeat(64);
  const withLineage = createSyncedSnippetEnvelope(content, 4_096, [ancestor]);
  assert.equal(withLineage.kind, 'valid');
  if (withLineage.kind === 'valid') {
    assert.deepEqual(withLineage.envelope.ancestorHashes, [ancestor]);
    assert.equal(decodeSyncedSnippetEnvelope(withLineage.envelope, 4_096).kind, 'valid');
    assert.equal(decodeSyncedSnippetEnvelope({
      ...withLineage.envelope,
      ancestorHashes: ['not-a-hash'],
    }, 4_096).kind, 'invalid');
    assert.equal(decodeSyncedSnippetEnvelope({
      ...withLineage.envelope,
      ancestorHashes: Array.from({ length: 33 }, (_, index) =>
        index.toString(16).padStart(64, '0')),
    }, 100_000).kind, 'invalid');
  }
  assert.equal(createSyncedSnippetEnvelope(content.repeat(8), 100).kind, 'too-large');
  assert.equal(decodeSyncedSnippetEnvelope(undefined).kind, 'none');
});

function latexContext(mathMode: LatexContext['mathMode']): LatexContext {
  return {
    mathMode,
    inComment: false,
    inVerbatim: false,
    environments: [],
    matrixEnvironment: undefined,
  };
}

function matcherFor(
  snippets: readonly SnippetDefinitionInput[],
  variables: Readonly<Record<string, string>> = {},
  options: SnippetMatcherOptions = {},
): SnippetMatcher {
  const validated = validateSnippetFile({ schemaVersion: 1, variables, snippets });
  assert.equal(validated.ok, true, JSON.stringify(validated.issues));
  const compiled = compileSnippetFile(validated.value);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.issues));
  return new SnippetMatcher(compiled.value, options);
}

test('snippet option grammar exposes t/m/M/n/A/r/v/w independently', () => {
  assert.deepEqual(parseSnippetOptions('tmMnArvw'), {
    raw: 'tmMnArvw',
    automatic: true,
    regex: true,
    visual: true,
    wordBoundary: true,
    textMode: true,
    anyMathMode: true,
    blockMathMode: true,
    inlineMathMode: true,
  });
});

test('schema accepts object and legacy-array files and supplies stable defaults', () => {
  const objectResult = validateSnippetFile(
    {
      schemaVersion: 1,
      variables: { greek: 'alpha' },
      snippets: [
        {
          trigger: 'aa',
          replacement: '@0',
          options: 'mAw',
          priority: 7,
        },
        {
          id: 'rx',
          trigger: { kind: 'regex', source: '[a-z]+', flags: 'i' },
          replacement: '@[0]',
        },
      ],
    },
    { sourceId: 'workspace' },
  );

  assert.equal(objectResult.ok, true);
  assert.equal(objectResult.value.schemaVersion, 1);
  assert.deepEqual(objectResult.value.variables, { greek: 'alpha' });
  assert.equal(objectResult.value.snippets[0]?.id, 'workspace:0');
  assert.equal(objectResult.value.snippets[0]?.version, 2);
  assert.equal(objectResult.value.snippets[0]?.priority, 7);
  assert.equal(objectResult.value.snippets[1]?.options.regex, true);

  const legacyResult = validateSnippetFile([
    { trigger: 'x', replacement: 'y' },
  ], { sourceId: 'legacy' });
  assert.equal(legacyResult.ok, true);
  assert.equal(legacyResult.value.snippets[0]?.id, 'legacy:0');
});

test('schema reports unsafe functions, malformed regexes, conflicts, and duplicates', () => {
  const result = validateSnippetFile({
    snippets: [
      { id: 'function', trigger: 'f', replacement: () => 'unsafe' },
      { id: 'empty', trigger: { kind: 'regex', source: 'a*' }, replacement: 'x' },
      { id: 'conflict', trigger: 'x+', replacement: 'x', options: 'rv' },
      { id: 'bad-option', trigger: 'b', replacement: 'b', options: 'q' },
      { id: 'duplicate', trigger: 'd', replacement: 'd' },
      { id: 'duplicate', trigger: 'e', replacement: 'e' },
      {
        id: 'bad-flag',
        trigger: { kind: 'regex', source: 'z+', flags: 'g' },
        replacement: 'z',
      },
    ],
  });

  assert.equal(result.ok, false);
  const codes = new Set(result.issues.map((entry) => entry.code));
  assert.equal(codes.has('unsupported-function'), true);
  assert.equal(codes.has('empty-regex-match'), true);
  assert.equal(codes.has('conflicting-options'), true);
  assert.equal(codes.has('invalid-option'), true);
  assert.equal(codes.has('duplicate-id'), true);
  assert.equal(codes.has('invalid-regex-flag'), true);
  assert.equal(result.value.snippets.some((snippet) => snippet.id === 'function'), false);
  assert.equal(result.value.snippets.some((snippet) => snippet.id === 'empty'), false);
  assert.equal(result.value.snippets.filter((snippet) => snippet.id === 'duplicate').length, 1);
});

test('LaTeX context scanner distinguishes inline, block, environment, and escaped syntax', () => {
  assert.equal(scanLatexContext('plain text').mathMode, 'text');
  assert.equal(scanLatexContext('$x').mathMode, 'inline');
  assert.equal(scanLatexContext('$x$').mathMode, 'text');
  assert.equal(scanLatexContext('\\[x').mathMode, 'block');
  assert.equal(scanLatexContext('\\begin{equation*}x').mathMode, 'block');

  const matrix = scanLatexContext('\\begin{align*}x');
  assert.equal(matrix.mathMode, 'block');
  assert.equal(matrix.matrixEnvironment, 'align*');

  assert.equal(scanLatexContext(String.raw`price \$5`).mathMode, 'text');
  assert.equal(scanLatexContext(String.raw`\verb|$not_math$|`).mathMode, 'text');
  assert.equal(scanLatexContext('% $not_math$').inComment, true);
  assert.equal(scanLatexContext('% $not_math$\n$x').mathMode, 'inline');
  assert.equal(
    scanLatexContext(String.raw`\begin{verbatim}$not_math$\end{verbatim}`).mathMode,
    'text',
  );
});

test('segment scanner carries incremental comment, delimiter, and environment state', () => {
  const initial = createLatexScanState();
  const comment = scanLatexSegment('% ignored', initial);
  assert.equal(comment.inComment, true);

  const inline = scanLatexSegment('\n$x', comment, 9);
  assert.equal(inline.inComment, false);
  assert.equal(latexContextFromState(inline).mathMode, 'inline');

  const closed = scanLatexSegment('$ tail', inline, 12);
  assert.equal(latexContextFromState(closed).mathMode, 'text');

  const environment = scanLatexSegment('\\begin{matrix}a');
  assert.equal(latexContextFromState(environment).matrixEnvironment, 'matrix');
  const environmentClosed = scanLatexSegment('\\end{matrix}', environment, 15);
  assert.equal(latexContextFromState(environmentClosed).mathMode, 'text');
});

test('full-region scanner returns exact closed and EOF-unclosed UTF-16 spans', () => {
  const text = String.raw`a $x$ b $$y$$ c \begin{equation}z\end{equation} d \(u`;
  const regions = scanLatexRegions(text);
  assert.equal(regions.length, 4);

  const inlineStart = text.indexOf('$');
  assert.deepEqual(regions[0], {
    outerStart: inlineStart,
    innerStart: inlineStart + 1,
    innerEnd: inlineStart + 2,
    outerEnd: inlineStart + 3,
    mode: 'inline',
    closed: true,
  });

  const blockStart = text.indexOf('$$');
  assert.deepEqual(regions[1], {
    outerStart: blockStart,
    innerStart: blockStart + 2,
    innerEnd: blockStart + 3,
    outerEnd: blockStart + 5,
    mode: 'block',
    closed: true,
  });

  const environmentOpen = String.raw`\begin{equation}`;
  const environmentClose = String.raw`\end{equation}`;
  const environmentStart = text.indexOf(environmentOpen);
  const environmentEnd = text.indexOf(environmentClose);
  assert.deepEqual(regions[2], {
    outerStart: environmentStart,
    innerStart: environmentStart + environmentOpen.length,
    innerEnd: environmentEnd,
    outerEnd: environmentEnd + environmentClose.length,
    mode: 'block',
    environmentName: 'equation',
    closed: true,
  });

  const unclosedStart = text.lastIndexOf(String.raw`\(`);
  assert.deepEqual(regions[3], {
    outerStart: unclosedStart,
    innerStart: unclosedStart + 2,
    innerEnd: text.length,
    outerEnd: text.length,
    mode: 'inline',
    closed: false,
  });
});

test('full-region scanner ignores comments, verb commands, and verbatim environments', () => {
  const text = [
    '% $comment$',
    String.raw`\verb|$$| $real$`,
    String.raw`\begin{verbatim}$hidden$\end{verbatim}`,
  ].join('\n');
  const regions = scanLatexRegions(text);
  assert.equal(regions.length, 1);
  assert.equal(text.slice(regions[0]!.outerStart, regions[0]!.outerEnd), '$real$');
});

test('replacement v2 parser produces neutral text/tabstop/capture/visual parts', () => {
  const template = parseReplacementTemplate('@@:@0:@{12:name}:@[0]:@[word]:@{VISUAL}', 2);
  assert.deepEqual(template, [
    { kind: 'text', value: '@:' },
    { kind: 'tabstop', index: 0 },
    { kind: 'text', value: ':' },
    { kind: 'tabstop', index: 12, placeholder: 'name' },
    { kind: 'text', value: ':' },
    { kind: 'capture', reference: 0, raw: '@[0]', version: 2 },
    { kind: 'text', value: ':' },
    { kind: 'capture', reference: 'word', raw: '@[word]', version: 2 },
    { kind: 'text', value: ':' },
    { kind: 'visual', raw: '@{VISUAL}' },
  ]);

  const replacement = materializeReplacement(template, {
    captures: ['first'],
    namedCaptures: { word: undefined },
    visualText: 'selected',
  });
  assert.deepEqual(replacement, [
    { kind: 'text', value: '@:' },
    { kind: 'tabstop', index: 0, placeholder: undefined },
    { kind: 'text', value: ':' },
    { kind: 'tabstop', index: 12, placeholder: 'name' },
    { kind: 'text', value: ':first::selected' },
  ]);
  assert.equal(materializeReplacement(parseReplacementTemplate('@[unknown]'))[0]?.kind, 'text');
  assert.equal(
    replacementPartsToText(materializeReplacement(parseReplacementTemplate('@[unknown]'))),
    '@[unknown]',
  );
});

test('replacement v1 preserves legacy undefined captures and one-digit $10 parsing', () => {
  const template = parseReplacementTemplate('[[0]]:${VISUAL}:$10', 1);
  assert.deepEqual(template, [
    { kind: 'capture', reference: 0, raw: '[[0]]', version: 1 },
    { kind: 'text', value: ':' },
    { kind: 'visual', raw: '${VISUAL}' },
    { kind: 'text', value: ':' },
    { kind: 'tabstop', index: 1 },
    { kind: 'text', value: '0' },
  ]);
  assert.deepEqual(materializeReplacement(template, {
    captures: [undefined],
    visualText: 'chosen',
  }), [
    { kind: 'text', value: 'undefined:chosen:' },
    { kind: 'tabstop', index: 1, placeholder: undefined },
    { kind: 'text', value: '0' },
  ]);
});

test('neutral tabstops map the highest explicit stop to VS Code final zero', () => {
  const mapped = remapTabstopsForVsCode([
    { kind: 'text', value: 'x' },
    { kind: 'tabstop', index: 0 },
    { kind: 'tabstop', index: 2, placeholder: 'value' },
  ]);
  assert.deepEqual(mapped, {
    parts: [
      { kind: 'text', value: 'x' },
      { kind: 'tabstop', index: 1 },
      { kind: 'tabstop', index: 0, placeholder: 'value' },
    ],
  });
});

test('matcher resolves priority before literal length and length before source order', () => {
  const priorityMatcher = matcherFor([
    { id: 'short-high', trigger: 'a', replacement: 'high', priority: 10 },
    { id: 'long-low', trigger: 'ba', replacement: 'long', priority: 0 },
  ]);
  assert.deepEqual(
    priorityMatcher.findAll({ textBefore: 'ba', context: latexContext('text') })
      .map((match) => match.snippet.id),
    ['short-high', 'long-low'],
  );

  const lengthMatcher = matcherFor([
    { id: 'short', trigger: 'a', replacement: 'short' },
    { id: 'long', trigger: 'ba', replacement: 'long' },
  ]);
  assert.equal(
    lengthMatcher.match({ textBefore: 'ba', context: latexContext('text') })?.snippet.id,
    'long',
  );
});

test('matcher enforces math modes, activation, visual, disabled, and excluded contexts', () => {
  const modes = matcherFor([
    { id: 'text', trigger: 'z', replacement: 't', options: 't' },
    { id: 'math', trigger: 'z', replacement: 'm', options: 'm' },
    { id: 'block', trigger: 'z', replacement: 'M', options: 'M' },
    { id: 'inline', trigger: 'z', replacement: 'n', options: 'n' },
  ]);
  assert.deepEqual(
    modes.findAll({ textBefore: 'z', context: latexContext('text') }).map((m) => m.snippet.id),
    ['text'],
  );
  assert.deepEqual(
    modes.findAll({ textBefore: 'z', context: latexContext('inline') }).map((m) => m.snippet.id),
    ['math', 'inline'],
  );
  assert.deepEqual(
    modes.findAll({ textBefore: 'z', context: latexContext('block') }).map((m) => m.snippet.id),
    ['math', 'block'],
  );

  const activation = matcherFor([
    { id: 'automatic', trigger: 'q', replacement: 'A', options: 'A' },
    { id: 'manual', trigger: 'q', replacement: 'manual' },
    { id: 'disabled', trigger: 'q', replacement: 'off', options: 'A', disabled: true },
    { id: 'visual', trigger: 'q', replacement: '<@{VISUAL}>', options: 'v' },
  ]);
  assert.deepEqual(
    activation.findAll({ textBefore: 'q', context: latexContext('text'), activation: 'auto' })
      .map((match) => match.snippet.id),
    ['automatic'],
  );
  const visual = activation.match({
    textBefore: 'q',
    context: latexContext('text'),
    activation: 'visual',
    visualText: 'selection',
  });
  assert.equal(visual?.snippet.id, 'visual');
  assert.equal(replacementPartsToText(visual?.replacement ?? []), '<selection>');

  const blockedContext = { ...latexContext('text'), inComment: true };
  assert.equal(activation.match({ textBefore: 'q', context: blockedContext }), undefined);
  const verbatimContext = { ...latexContext('text'), inVerbatim: true };
  assert.equal(activation.match({ textBefore: 'q', context: verbatimContext }), undefined);
});

test('matcher uses configured word-delimiter semantics for option w', () => {
  const defaultMatcher = matcherFor([
    { id: 'word', trigger: 'sin', replacement: '\\sin', options: 'w' },
  ]);
  assert.equal(defaultMatcher.match({ textBefore: 'asin', context: latexContext('text') }), undefined);
  assert.equal(defaultMatcher.match({ textBefore: ' sin', context: latexContext('text') })?.snippet.id, 'word');
  assert.equal(defaultMatcher.match({
    textBefore: 'sin',
    textAfter: 'x',
    context: latexContext('text'),
  }), undefined);
  assert.equal(defaultMatcher.match({ textBefore: '@sin', context: latexContext('text') }), undefined);

  const customMatcher = matcherFor([
    { id: 'word', trigger: 'sin', replacement: '\\sin', options: 'w' },
  ], {}, { wordDelimiters: '@ ' });
  assert.equal(customMatcher.match({ textBefore: '@sin', context: latexContext('text') })?.snippet.id, 'word');
});

test('regex matcher anchors at the cursor and resolves indexed and named captures', () => {
  const matcher = matcherFor([
    {
      id: 'regex',
      trigger: { kind: 'regex', source: '(?<word>[A-Za-z]+)(\\d+)', flags: 'i' },
      replacement: '@[0]-@[1]-@[word]',
      options: 'm',
    },
  ]);
  const match = matcher.match({ textBefore: 'prefix AbC42', context: latexContext('inline') });
  assert.equal(match?.matchedText, 'AbC42');
  assert.deepEqual(match?.captures, ['AbC', '42']);
  assert.deepEqual(match?.namedCaptures, { word: 'AbC' });
  assert.equal(replacementPartsToText(match?.replacement ?? []), 'AbC-42-AbC');
  assert.equal(
    matcher.match({ textBefore: 'prefix AbC42 tail', context: latexContext('inline') }),
    undefined,
  );
});

test('matcher expands variables in triggers while preserving unknown variables', () => {
  assert.equal(expandSnippetVariables('${known}-${unknown}', { known: 'yes' }), 'yes-${unknown}');
  const matcher = matcherFor([
    { id: 'variable', trigger: '${greek}!', replacement: '\\alpha' },
  ], { greek: 'aa' });
  assert.equal(
    matcher.match({ textBefore: 'aa!', context: latexContext('text') })?.snippet.id,
    'variable',
  );
});

test('auto-fraction finder handles boundaries, balanced groups, and outer parentheses', () => {
  assert.deepEqual(findFractionNumerator('x/', 1), {
    numeratorRange: { start: 0, end: 1 },
    numerator: 'x',
    replacementRange: { start: 0, end: 2 },
  });

  const grouped = 'a+(b+c(d))/';
  const groupedPlan = findFractionNumerator(grouped, grouped.length - 1);
  assert.equal(groupedPlan?.numerator, 'b+c(d)');
  assert.deepEqual(groupedPlan?.numeratorRange, { start: 3, end: grouped.length - 2 });
  assert.deepEqual(groupedPlan?.replacementRange, { start: 2, end: grouped.length });

  const nestedCommand = String.raw`\frac{a+b}{c}/`;
  assert.equal(
    findFractionNumerator(nestedCommand, nestedCommand.length - 1)?.numerator,
    String.raw`\frac{a+b}{c}`,
  );
  assert.equal(findFractionNumerator('x)/', 2), undefined);
  assert.equal(findFractionNumerator('/', 0), undefined);
});

test('auto-fraction finder honors configurable breaks and TeX Greek delimiter spaces', () => {
  const multiplication = 'a*b/';
  assert.equal(
    findFractionNumerator(multiplication, multiplication.length - 1)?.numerator,
    'a*b',
  );
  assert.equal(
    findFractionNumerator(multiplication, multiplication.length - 1, {
      breakingCharacters: '+-=,;:&*',
    })?.numerator,
    'b',
  );

  const greek = String.raw`\alpha x/`;
  assert.equal(findFractionNumerator(greek, greek.length - 1)?.numerator, String.raw`\alpha x`);

  const bounded = '$a+b/';
  assert.equal(
    findFractionNumerator(bounded, bounded.length - 1, { lowerBound: 1 })?.numerator,
    'b',
  );
});

test('Tabout jumps past the first right-side closer without nesting analysis', () => {
  const text = '$f(x + y) + z$';
  const cursor = text.indexOf('x') + 1;
  const plan = planTabout(text, cursor);
  assert.deepEqual(plan, {
    kind: 'closing-delimiter',
    from: cursor,
    to: text.indexOf(')') + 1,
    skippedText: text.slice(cursor, text.indexOf(')') + 1),
  });

  const angle = String.raw`$\langle x \rangle$`;
  const angleCursor = angle.indexOf('x') + 1;
  const anglePlan = planTabout(angle, angleCursor);
  const angleEnd = angle.indexOf(String.raw`\rangle`) + String.raw`\rangle`.length;
  assert.equal(anglePlan?.to, angleEnd);

  assert.equal(planTabout('outside ) math', 0), undefined);
});

test('Tabout exits a closed math region only when its remaining content is whitespace', () => {
  const inline = '$x   $';
  assert.deepEqual(planTabout(inline, 2), {
    kind: 'math-delimiter',
    from: 2,
    to: inline.length,
    skippedText: '   $',
  });
  assert.equal(planTabout('$x + y$', 2), undefined);

  const matrix = String.raw`\begin{matrix}x   \end{matrix}`;
  assert.equal(planTabout(matrix, matrix.indexOf('x') + 1), undefined);

  const explicit = planTabout('abc )', 0, { innerEnd: 5, outerEnd: 5 });
  assert.equal(explicit?.to, 5);
});

function applyEnlargePlan(text: string, plan: EnlargeBracketPlan): string {
  const withRight = `${text.slice(0, plan.insertRightAt)}${plan.insertRightText}${text.slice(plan.insertRightAt)}`;
  return `${withRight.slice(0, plan.insertLeftAt)}${plan.insertLeftText}${withRight.slice(plan.insertLeftAt)}`;
}

test('auto-enlarge chooses the smallest matching pair surrounding a trigger', () => {
  const text = String.raw`$[(\frac{x}{y})]$`;
  const commandStart = text.indexOf(String.raw`\frac`);
  const plan = planAutoEnlarge(text, {
    start: commandStart,
    end: commandStart + String.raw`\frac`.length,
  });
  assert.equal(plan?.open, '(');
  assert.equal(plan?.close, ')');
  assert.equal(plan?.openOffset, text.indexOf('('));
  assert.equal(plan?.closeOffset, text.indexOf(')'));
  assert.equal(
    applyEnlargePlan(text, plan!),
    String.raw`$[\left(\frac{x}{y}\right)]$`,
  );
});

test('auto-enlarge supports TeX command brackets and custom triggers', () => {
  const angle = String.raw`$\langle \sum_i x_i \rangle$`;
  const sumStart = angle.indexOf(String.raw`\sum`);
  const anglePlan = planAutoEnlarge(angle, {
    start: sumStart,
    end: sumStart + String.raw`\sum`.length,
  });
  assert.equal(anglePlan?.open, String.raw`\langle`);
  assert.equal(anglePlan?.close, String.raw`\rangle`);

  const custom = String.raw`$(\operatorname{foo})$`;
  const customStart = custom.indexOf(String.raw`\operatorname`);
  assert.equal(planAutoEnlarge(custom, {
    start: customStart,
    end: customStart + String.raw`\operatorname`.length,
  }), undefined);
  assert.equal(planAutoEnlarge(custom, {
    start: customStart,
    end: customStart + String.raw`\operatorname`.length,
  }, { triggers: [String.raw`\operatorname`] })?.open, '(');
});

test('auto-enlarge ignores existing size modifiers and cross-scope malformed pairs', () => {
  const alreadySized = String.raw`$\left(\frac{x}{y}\right)$`;
  const commandStart = alreadySized.indexOf(String.raw`\frac`);
  assert.equal(planAutoEnlarge(alreadySized, {
    start: commandStart,
    end: commandStart + String.raw`\frac`.length,
  }), undefined);

  const bigSized = String.raw`$\Bigl(\sum_i x_i\Bigr)$`;
  const sumStart = bigSized.indexOf(String.raw`\sum`);
  assert.equal(planAutoEnlarge(bigSized, {
    start: sumStart,
    end: sumStart + String.raw`\sum`.length,
  }), undefined);

  const crossedScope = String.raw`{(\frac{x}{y}})`;
  const fractionStart = crossedScope.indexOf(String.raw`\frac`);
  assert.equal(planAutoEnlarge(crossedScope, {
    start: fractionStart,
    end: fractionStart + String.raw`\frac`.length,
  }), undefined);
});
