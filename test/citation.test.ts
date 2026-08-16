import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CitationReference,
  appendBibTeXEntry,
  bibTeXValueToText,
  detectLineEnding,
  filterReferences,
  findCitationContext,
  findIncompleteBibTeXEntry,
  formatBibTeXAppendBlock,
  getCitationCompletionEdit,
  indexBibTeX,
  normalizeReferenceSearchText,
  parseBibTeX,
  referenceMatchesQuery,
  splitCitationKeys,
} from '../src/core';

function markedCursor(marked: string): { readonly text: string; readonly cursor: number } {
  const cursor = marked.indexOf('\u00a6');
  assert.notEqual(cursor, -1, 'test input must contain a cursor marker');
  return {
    text: marked.slice(0, cursor) + marked.slice(cursor + 1),
    cursor,
  };
}

test('citation context returns the full current token and all sibling keys', () => {
  const { text, cursor } = markedCursor(String.raw`Before \cite{ alpha, gar¦cía2024 , omega } after`);
  const context = findCitationContext(text, cursor);
  assert.ok(context);
  assert.equal(context.command, 'cite');
  assert.equal(context.closed, true);
  assert.equal(text.slice(context.replacementRange.start, context.replacementRange.end), 'garcía2024');
  assert.equal(context.query, 'garcía2024');
  assert.deepEqual(context.keys, ['alpha', 'garcía2024', 'omega']);
  assert.deepEqual(context.otherKeys, ['alpha', 'omega']);
  assert.equal(text.slice(context.argumentRange.start, context.argumentRange.end), ' alpha, garcía2024 , omega ');
});

test('citation context supports optional arguments, comments, stars, and multiline syntax', () => {
  const { text, cursor } = markedCursor([
    String.raw`\parencite*% explanation of the command`,
    String.raw`[see {Appendix ] A}]`,
    String.raw`[p. 42]`,
    '{first,',
    '  sec¦ond}',
  ].join('\n'));
  const context = findCitationContext(text, cursor, [String.raw`\parencite`]);
  assert.ok(context);
  assert.equal(context.command, 'parencite*');
  assert.equal(context.query, 'second');
  assert.deepEqual(context.otherKeys, ['first']);
});

test('citation context accepts EOF-unclosed braces and inserts into an empty token', () => {
  const { text, cursor } = markedCursor(String.raw`\mycite[pre]{one,   ¦`);
  const context = findCitationContext(text, cursor, ['mycite']);
  assert.ok(context);
  assert.equal(context.closed, false);
  assert.equal(context.closingBrace, undefined);
  assert.deepEqual(context.argumentRange, {
    start: text.indexOf('{') + 1,
    end: text.length,
  });
  assert.deepEqual(context.replacementRange, { start: cursor, end: cursor });
  assert.equal(context.query, '');
  assert.deepEqual(context.otherKeys, ['one']);
});

test('citation grouping ignores escaped braces, escaped commas, and nested commas', () => {
  const { text, cursor } = markedCursor(String.raw`\cite{one, \{literal\,comma\}, group{a,b}¦, four\}}`);
  const context = findCitationContext(text, cursor);
  assert.ok(context);
  assert.equal(context.query, 'group{a,b}');
  assert.deepEqual(context.otherKeys, ['one', String.raw`\{literal\,comma\}`, String.raw`four\}`]);
  assert.deepEqual(
    splitCitationKeys(String.raw`one, \{literal\,comma\}, group{a,b}, four\}`),
    ['one', String.raw`\{literal\,comma\}`, 'group{a,b}', String.raw`four\}`],
  );
});

test('citation lookup ignores commented and verbatim command text', () => {
  const commented = markedCursor('% \\cite{ignored¦}\nplain');
  assert.equal(findCitationContext(commented.text, commented.cursor), undefined);

  const trailingComment = markedCursor('\\cite{kept% \\cite{ignored¦}\n, second}');
  assert.equal(findCitationContext(trailingComment.text, trailingComment.cursor), undefined);

  const verbatim = markedCursor(String.raw`\verb|\cite{ignored¦}|`);
  assert.equal(findCitationContext(verbatim.text, verbatim.cursor), undefined);

  const escapedPercent = markedCursor(String.raw`\cite{rate\%¦2024}`);
  assert.equal(findCitationContext(escapedPercent.text, escapedPercent.cursor)?.query, String.raw`rate\%2024`);
});

test('citation lookup requires the cursor to be inside the mandatory braces', () => {
  const before = markedCursor(String.raw`\cite[¦note]{key}`);
  assert.equal(findCitationContext(before.text, before.cursor), undefined);

  const after = markedCursor(String.raw`\cite{key}¦ tail`);
  assert.equal(findCitationContext(after.text, after.cursor), undefined);

  const otherCommand = markedCursor(String.raw`\unknown{ke¦y}`);
  assert.equal(findCitationContext(otherCommand.text, otherCommand.cursor, ['cite']), undefined);
});

test('citation completion uses the cursor prefix while replacing the full token', () => {
  const { text, cursor } = markedCursor(
    String.raw`\cite{first, García${'\u00a6'}2024Graph, third}`,
  );
  const context = findCitationContext(text, cursor);
  assert.ok(context);
  const edit = getCitationCompletionEdit(text, cursor, context);
  assert.ok(edit);
  assert.equal(edit.mode, 'replace-token');
  assert.equal(edit.prefixQuery, 'García');
  assert.equal(text.slice(edit.insertingRange.start, edit.insertingRange.end), 'García');
  assert.equal(
    text.slice(edit.replacingRange.start, edit.replacingRange.end),
    'García2024Graph',
  );
  assert.equal(edit.insertingRange.start, edit.replacingRange.start);
  assert.equal(edit.insertingRange.end, cursor);
  assert.equal(edit.replacingRange.end > cursor, true);
  // QuickPick continues to use the full token, independently of this prefix.
  assert.equal(context.query, 'García2024Graph');
});

test('citation completion supports empty tokens and token-surrounding whitespace', () => {
  const empty = markedCursor(String.raw`\cite{first,   ${'\u00a6'}}`);
  const emptyContext = findCitationContext(empty.text, empty.cursor);
  assert.ok(emptyContext);
  assert.deepEqual(getCitationCompletionEdit(empty.text, empty.cursor, emptyContext), {
    mode: 'insert-at-cursor',
    insertingRange: { start: empty.cursor, end: empty.cursor },
    replacingRange: { start: empty.cursor, end: empty.cursor },
    prefixQuery: '',
  });

  const beforeToken = markedCursor(String.raw`\cite{first, ${'\u00a6'} second}`);
  const beforeContext = findCitationContext(beforeToken.text, beforeToken.cursor);
  assert.ok(beforeContext);
  assert.equal(beforeContext.query, 'second');
  assert.equal(
    beforeContext.replacementRange.start > beforeToken.cursor,
    true,
    'the full trimmed token range intentionally remains unchanged',
  );
  assert.deepEqual(
    getCitationCompletionEdit(beforeToken.text, beforeToken.cursor, beforeContext),
    {
      mode: 'insert-at-cursor',
      insertingRange: { start: beforeToken.cursor, end: beforeToken.cursor },
      replacingRange: { start: beforeToken.cursor, end: beforeToken.cursor },
      prefixQuery: '',
    },
  );

  const afterToken = markedCursor(String.raw`\cite{first, second ${'\u00a6'}, third}`);
  const afterContext = findCitationContext(afterToken.text, afterToken.cursor);
  assert.ok(afterContext);
  assert.equal(afterContext.replacementRange.end < afterToken.cursor, true);
  assert.equal(
    getCitationCompletionEdit(afterToken.text, afterToken.cursor, afterContext)?.mode,
    'insert-at-cursor',
  );
});

test('citation completion enforces VS Code single-line replacement ranges', () => {
  const formatted = markedCursor('\\cite{first,\n  sec\u00a6ond}');
  const formattedContext = findCitationContext(formatted.text, formatted.cursor);
  assert.ok(formattedContext);
  const formattedEdit = getCitationCompletionEdit(
    formatted.text,
    formatted.cursor,
    formattedContext,
  );
  assert.ok(formattedEdit);
  assert.equal(formattedEdit.mode, 'replace-token');
  assert.equal(formattedEdit.prefixQuery, 'sec');

  const multilineToken = markedCursor('\\cite{first, multi\nline\u00a6Key}');
  const multilineContext = findCitationContext(multilineToken.text, multilineToken.cursor);
  assert.ok(multilineContext);
  assert.equal(
    multilineToken.text.slice(
      multilineContext.replacementRange.start,
      multilineContext.replacementRange.end,
    ),
    'multi\nlineKey',
  );
  assert.equal(
    getCitationCompletionEdit(multilineToken.text, multilineToken.cursor, multilineContext),
    undefined,
  );
});

test('BibTeX parser handles nested braces, quoted values, concatenation, and parentheses', () => {
  const source = [
    '% @article{CommentedOut, title={No}}',
    '@string{journalName = "Ignored macro"}',
    '@Article{García2024,',
    '  title = {A {Nested, Braced} Title},',
    '  author = "José García and Zoë Müller",',
    '  journal = {Journal of {API} Studies},',
    '  year = 2024,',
    '  note = "a literal } and a {balanced} group",',
    '}',
    '@InProceedings(SecondKey,',
    '  title = {Part } # "Two",',
    '  author = {Ada Lovelace},',
    '  booktitle = "Proceedings, Volume 2",',
    '  date = {2023-05},',
    ')',
    '@comment{also ignored}',
  ].join('\r\n');

  const entries = parseBibTeX(source);
  assert.equal(entries.length, 2);
  const first = entries[0];
  assert.ok(first);
  assert.equal(first.type, 'article');
  assert.equal(first.entryType, 'article');
  assert.equal(first.key, 'García2024');
  assert.equal(first.title, 'A Nested, Braced Title');
  assert.equal(first.authors, 'José García and Zoë Müller');
  assert.equal(first.author, first.authors);
  assert.equal(first.journal, 'Journal of API Studies');
  assert.equal(first.container, first.journal);
  assert.equal(first.year, '2024');
  assert.equal(source.slice(first.range.start, first.range.end), first.raw);
  assert.match(first.raw, /^@Article\{García2024,/u);

  const second = entries[1];
  assert.ok(second);
  assert.equal(second.type, 'inproceedings');
  assert.equal(second.title, 'Part Two');
  assert.equal(second.container, 'Proceedings, Volume 2');
  assert.equal(second.journal, '');
  assert.equal(second.year, '2023');
  assert.match(second.raw, /^@InProceedings\(SecondKey,/u);
});

test('BibTeX parser skips malformed and non-entry directives and indexes first duplicate key', () => {
  const source = [
    '@preamble{"prefix"}',
    '@book{same, title={First}}',
    '@book{same, title={Second}}',
    '@article{incomplete, title={Never closed}',
  ].join('\n');
  const index = indexBibTeX(source);
  assert.equal(index.entries.length, 2);
  assert.equal(index.byKey.size, 1);
  assert.equal(index.byKey.get('same')?.title, 'First');
});

test('BibTeX append validation finds an unclosed outer entry delimiter', () => {
  const complete = '@article{ok, title={Done}}\n% @article{ignored\nplain@example.org';
  assert.equal(findIncompleteBibTeXEntry(complete), undefined);

  const malformed = `${complete}\n@book{broken,\n  title = {Still open}`;
  assert.equal(findIncompleteBibTeXEntry(malformed), complete.length + 1);
});

test('BibTeX display values remove grouping and common TeX presentation commands', () => {
  assert.equal(
    bibTeXValueToText(String.raw`{An \emph{API} by M{\"u}ller \& Co.}`),
    'An API by Muller & Co.',
  );
});

test('BibTeX append blocks preserve LF or CRLF and guarantee a blank separator', () => {
  const rawLf = '@article{x,\n  title={X}\n}';
  assert.equal(detectLineEnding('', rawLf), '\n');
  assert.equal(formatBibTeXAppendBlock('', rawLf), `${rawLf}\n`);

  const existingLf = '@book{a}\n';
  assert.equal(formatBibTeXAppendBlock(existingLf, '@book{b}'), '\n@book{b}\n');
  assert.equal(appendBibTeXEntry(existingLf, '@book{b}'), '@book{a}\n\n@book{b}\n');

  const existingCrLf = '@book{a}\r\n\r\n';
  const block = formatBibTeXAppendBlock(existingCrLf, '@article{x,\n title={X}\n}');
  assert.equal(block, '@article{x,\r\n title={X}\r\n}\r\n');
  assert.equal(block.includes('\n') && !block.includes('\r\n'), false);
  assert.equal(formatBibTeXAppendBlock(existingCrLf, '  \r\n '), '');
});

test('reference search folds Unicode accents and filters key, title, author, and year', () => {
  const references: readonly CitationReference[] = [
    {
      key: 'Garcia2024Graph',
      title: 'Crème-Brûlée Graph Methods',
      authors: 'José García and Zoë Müller',
      container: 'Journal of Examples',
      year: '2024',
    },
    {
      key: 'LodzPaper',
      title: 'Analysis in Łódź',
      authors: 'Jane Doe',
      container: 'Special Proceedings',
      year: '2020',
    },
  ];

  assert.equal(normalizeReferenceSearchText('  Crème—Brûlée  '), 'creme brulee');
  assert.deepEqual(filterReferences(references, 'garcía graph'), [references[0]]);
  assert.deepEqual(filterReferences(references, 'MULLER creme'), [references[0]]);
  assert.deepEqual(filterReferences(references, 'lodz'), [references[1]]);
  assert.deepEqual(filterReferences(references, 'special proceedings'), []);
  assert.deepEqual(filterReferences(references, ''), references);
  assert.equal(referenceMatchesQuery(references[0]!, 'garcia2024'), true);
  assert.equal(
    referenceMatchesQuery(references[1]!, '2020'),
    true,
    'a year must remain searchable even when it is absent from the citation key',
  );
});
