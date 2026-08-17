import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AiProseIssue,
  aiProseSentenceSegments,
  aiProseOffsetToSourceOffset,
  extractAiProseDocument,
  findAiProseParagraphAtOffset,
  findAiProseSegmentForIdleReview,
  findAiProseSentenceSegmentForIdleReview,
  findAiProseSentenceAtOffset,
  isAiIssueOffsetRangeEditable,
  planAiProseIssues,
  selectAiProseSegmentsForDocumentReview,
} from '../src/core';

function proseText(source: string): string {
  return extractAiProseDocument(source).segments
    .map((segment) => segment.text)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function issueIsEditable(source: string, original: string): boolean {
  const start = source.indexOf(original);
  assert.notEqual(start, -1);
  return isAiIssueOffsetRangeEditable(
    { start, end: start + original.length },
    extractAiProseDocument(source).segments,
  );
}

test('retained AI issue ranges must remain editable prose after TeX changes', () => {
  assert.equal(issueIsEditable('Good prose has a bad word.', 'bad'), true);
  assert.equal(issueIsEditable('% Good prose has a bad word.', 'bad'), false);
  assert.equal(issueIsEditable('$Good prose has a bad word.', 'bad'), false);
  assert.equal(
    issueIsEditable('\\begin{verbatim}\nGood prose has a bad word.\n', 'bad'),
    false,
  );
});

test('retained zero-width AI insertions remain valid only at editable prose boundaries', () => {
  const prose = 'Good prose needs punctuation here';
  assert.equal(
    isAiIssueOffsetRangeEditable(
      { start: prose.length, end: prose.length },
      extractAiProseDocument(prose).segments,
    ),
    true,
    'a punctuation insertion at the end of editable prose must be retainable',
  );

  const beforeMath = 'Good prose $x+y$';
  const mathOffset = beforeMath.indexOf('x');
  assert.equal(
    isAiIssueOffsetRangeEditable(
      { start: mathOffset, end: mathOffset },
      extractAiProseDocument(beforeMath).segments,
    ),
    false,
    'an insertion inside protected math must remain invalid',
  );
});

test('idle review keeps the edited paragraph across trailing whitespace only', () => {
  for (const trailing of ['\n', '\r\n', '\n\n  ']) {
    const source = `This sentence needs review.${trailing}`;
    const document = extractAiProseDocument(source);
    assert.equal(
      findAiProseSegmentForIdleReview(source, document, source.length)?.text.trim(),
      'This sentence needs review.',
    );
  }

  for (const source of [
    'This sentence needs review.\n% hidden comment',
    'This sentence needs review.\n$secret$',
    'This sentence needs review.\\par',
    'This sentence needs review.\n\\begin{verbatim}\nsecret',
  ]) {
    const document = extractAiProseDocument(source);
    assert.equal(
      findAiProseSegmentForIdleReview(source, document, source.length),
      undefined,
    );
  }

  const leading = '  \nThis sentence needs review.';
  const leadingDocument = extractAiProseDocument(leading);
  assert.equal(findAiProseSegmentForIdleReview(leading, leadingDocument, 1), undefined);
  assert.equal(
    findAiProseSegmentForIdleReview(`${leading}x`, leadingDocument, leading.length),
    undefined,
  );
  assert.equal(
    findAiProseSegmentForIdleReview(leading, leadingDocument, leading.length + 1),
    undefined,
  );
});

test('incremental AI review selects sentences rather than whole paragraphs', () => {
  const source = 'First sentence. Second sentence has a problem. Third sentence.';
  const document = extractAiProseDocument(source);
  assert.equal(document.segments.length, 1);
  assert.deepEqual(
    aiProseSentenceSegments(document).map((segment) => segment.text),
    ['First sentence.', 'Second sentence has a problem.', 'Third sentence.'],
  );
  const problemEnd = source.indexOf('problem') + 'problem'.length;
  assert.equal(
    findAiProseSentenceSegmentForIdleReview(source, document, problemEnd)?.text,
    'Second sentence has a problem.',
  );
  const afterPeriod = source.indexOf('problem.') + 'problem.'.length;
  assert.equal(
    findAiProseSentenceSegmentForIdleReview(source, document, afterPeriod)?.text,
    'Second sentence has a problem.',
  );
});

test('AI prose sentence splitting handles adjacent CJK sentences and closing punctuation', () => {
  const source = '第一句。第二句！第三句？';
  const segments = aiProseSentenceSegments(extractAiProseDocument(source));
  assert.deepEqual(
    segments.map((segment) => segment.text),
    ['第一句。', '第二句！', '第三句？'],
  );
  assert.deepEqual(
    segments.map((segment) => source.slice(segment.sourceStart, segment.sourceEnd)),
    ['第一句。', '第二句！', '第三句？'],
  );

  const quoted = '“第一句。”（第二句！）「第三句？」';
  const quotedSegments = aiProseSentenceSegments(extractAiProseDocument(quoted));
  assert.deepEqual(
    quotedSegments.map((segment) => segment.text),
    ['“第一句。”', '（第二句！）', '「第三句？」'],
  );

  const english = '"First sentence." (Second sentence!) [Third sentence?]';
  assert.deepEqual(
    aiProseSentenceSegments(extractAiProseDocument(english))
      .map((segment) => segment.text),
    ['"First sentence."', '(Second sentence!)', '[Third sentence?]'],
  );
});

test('CJK sentence splitting preserves UTF-16 offsets across masked TeX', () => {
  const source = '😀第一句。\\emph{第二句！}第三句？';
  const segments = aiProseSentenceSegments(extractAiProseDocument(source));
  assert.deepEqual(
    segments.map((segment) => source.slice(segment.sourceStart, segment.sourceEnd)),
    ['😀第一句。', '第二句！', '第三句？'],
  );
  for (const segment of segments) {
    assert.equal(segment.text.length, segment.sourceEnd - segment.sourceStart);
  }
});

test('whole-document AI review selection has hard request and character bounds', () => {
  const source = Array.from({ length: 10_000 }, () => 'a').join('\n\n');
  const document = extractAiProseDocument(source);
  const selection = selectAiProseSegmentsForDocumentReview(
    document.segments,
    100,
    30_000,
    32,
  );
  assert.equal(selection.segments.length, 32);
  assert.equal(selection.totalCharacters, 32);
  assert.equal(selection.truncated, true);

  const oversizedFirst = extractAiProseDocument(`${'x'.repeat(101)}\n\nok`).segments;
  const afterSkip = selectAiProseSegmentsForDocumentReview(
    oversizedFirst,
    100,
    1_000,
    32,
  );
  assert.equal(afterSkip.segments.length, 1);
  assert.equal(afterSkip.segments[0]?.text, 'ok');
  assert.equal(afterSkip.truncated, true);

  assert.deepEqual(
    selectAiProseSegmentsForDocumentReview(document.segments, 0, 1_000, 32),
    { segments: [], totalCharacters: 0, truncated: true },
  );
});

test('AI prose extraction keeps reviewable command arguments and masks TeX data', () => {
  const source = String.raw`\documentclass{article}
\title{A \textbf{Clear} Study}
\author{PRIVATE_AUTHOR \thanks{PRIVATE_EMAIL}}
\date{PRIVATE_DATE}
\begin{document}
\section*{An Introduction}
This are \emph{ordinary prose} with \citep[see][]{doe2026} and \ref{sec:hidden}.
\label{label:hidden} \url{https://secret.example/a%20path}
Visit \href{https://visible.example/a%20b}{the visible description} today.
Use \textcolor{privateColor}{colored readable words} here.
Use \custom[mode=fast]{private custom payload}, but not \input{private/chapter.tex}.
Inline math $privateToken + y$ and \(anotherSecret\) stay hidden.
% this hidden comment must not be reviewed
\[
  displayedSecret = 42
\]
\begin{align}
  alignedSecret &= 7
\end{align}
\begin{verbatim}
verbatimSecret should stay hidden
\end{verbatim}
\begin{minted}{python}
mintedSecret = true
\end{minted}
\begin{tikzpicture}
\node {diagramSecret};
\end{tikzpicture}
\begin{privatecode}
customEnvironmentSecret = true
\end{privatecode}
\hypersetup{pdfproducer={CompanySecret}}
\def\privateMacro{definitionSecret}
Final readable sentence.
\end{document}`;

  const prose = proseText(source);
  assert.match(prose, /A\s+Clear\s+Study/u);
  assert.match(prose, /An Introduction/u);
  assert.match(prose, /This are\s+ordinary prose\s+with/u);
  assert.match(prose, /the visible description/u);
  assert.match(prose, /colored readable words/u);
  assert.match(prose, /Final readable sentence/u);

  for (const hidden of [
    'article',
    'doe2026',
    'sec:hidden',
    'label:hidden',
    'secret.example',
    'visible.example',
    'privateColor',
    'mode=fast',
    'private custom payload',
    'private/chapter.tex',
    'privateToken',
    'anotherSecret',
    'hidden comment',
    'displayedSecret',
    'alignedSecret',
    'verbatimSecret',
    'mintedSecret',
    'diagramSecret',
    'customEnvironmentSecret',
    'CompanySecret',
    'definitionSecret',
    'PRIVATE_AUTHOR',
    'PRIVATE_EMAIL',
    'PRIVATE_DATE',
    'documentclass',
    'textbf',
    'emph',
    'citep',
  ]) {
    assert.equal(prose.includes(hidden), false, hidden);
  }
});

test('AI prose extraction preserves math as protected grammatical context', () => {
  const displaySecret = 'C_{PRIVATE_OBJECT}=42';
  const source = `Take\n\\[\n  ${displaySecret}\n\\]\nas the starting point.`;
  const document = extractAiProseDocument(source);
  assert.equal(document.segments.length, 1);
  const segment = document.segments[0];
  assert.ok(segment);
  assert.equal(segment.text.length, segment.sourceEnd - segment.sourceStart);
  assert.equal(segment.text.includes(displaySecret), false);
  assert.match(segment.text, /^Take\n⟦DISPLAYED_FORMULA⟧\s+\nas the starting point\.$/u);
  assert.deepEqual(
    aiProseSentenceSegments(document).map((sentence) => sentence.text),
    [segment.text],
    'display math must not split the surrounding grammatical sentence',
  );

  const takeStart = segment.text.indexOf('Take');
  const marker = '⟦DISPLAYED_FORMULA⟧';
  const markerStart = segment.text.indexOf(marker);
  assert.equal(markerStart >= 0, true);
  const plan = planAiProseIssues(source, segment, [
    {
      start: takeStart,
      end: takeStart + 4,
      original: 'Take',
      replacement: 'Use',
    },
    {
      start: markerStart,
      end: markerStart + marker.length,
      original: marker,
      replacement: 'an object',
    },
  ]);
  assert.deepEqual(plan.edits.map((edit) => edit.original), ['Take']);
  assert.deepEqual(plan.rejected, [{ issueIndex: 1, reason: 'protected-source' }]);
});

test('inline math uses a fixed-width protected placeholder without exposing formula data', () => {
  const source = 'The value $PRIVATE_X$ determines the result.';
  const segment = extractAiProseDocument(source).segments[0];
  assert.ok(segment);
  assert.equal(segment.text.length, source.length);
  assert.equal(segment.text.includes('PRIVATE_X'), false);
  assert.match(segment.text, /^The value ⟦FORMULA⟧\s+ determines the result\.$/u);
  assert.equal(extractAiProseDocument('\\[PRIVATE_ONLY\\]').segments.length, 0);
});

test('AI prose masking fails closed across TeX trivia, comments, math, and inline verbatim', () => {
  const source = String.raw`Visible alpha.
\secret{1}{2}{3}{4}{5}{6}{7}{8}{PRIVATE9}{PRIVATE10}
Visible beta \secret
{PRIVATE_NEWLINE} end.
Visible gamma \secret% comment removes this newline
{PRIVATE_COMMENT} end.
Visible delta \secret{public % } must not close the group
PRIVATE_GROUP} end.
\begin
{secret}
PRIVATE_ENV
\verb|\end{secret}|
PRIVATE_TAIL
\end{secret}
Visible epsilon $x % $ is not a closing delimiter
PRIVATE_MATH $ end.
Visible zeta $$x % $$ is not a closing delimiter
PRIVATE_DISPLAY_MATH $$ end.
Visible eta \(x % \) is not a closing delimiter
PRIVATE_PAREN \) end.
Visible theta \[x % \] is not a closing delimiter
PRIVATE_BRACKET \] end.
\mintinline{tex}|PRIVATE_INLINE_CODE|
Visible iota \Verb[showspaces=true]|PRIVATE_FANCY_VERB| end.
\begin{secret}
\url{\end{secret}}
PRIVATE_URL_TAIL
\mintinline{tex}|\end{secret}|
PRIVATE_MINT_TAIL
\end{secret}
\begin{verbatim}
literal \end{verbatim} is not a line-level close
\end {verbatim}
PRIVATE_SPACED_END_TAIL
\end{ verbatim }
PRIVATE_PADDED_END_TAIL
PRIVATE_VERBATIM_TAIL
\end{verbatim}
\begin{Verbatim}
literal \end{Verbatim} is not a line-level close
PRIVATE_CAPITAL_VERBATIM_TAIL
\end{Verbatim}
\begin{lstlisting}[language=TeX]
literal \end{lstlisting} is not a line-level close
PRIVATE_LISTING_TAIL
\end{lstlisting}
\begin{minted}{tex}
literal \end{minted} is not a line-level close
PRIVATE_MINTED_TAIL
\end{minted}
Visible omega.`;

  const prose = proseText(source);
  assert.match(prose, /Visible alpha/u);
  assert.match(prose, /Visible iota\s+end/u);
  assert.match(prose, /Visible omega/u);
  for (const hidden of [
    'PRIVATE9',
    'PRIVATE10',
    'PRIVATE_NEWLINE',
    'PRIVATE_COMMENT',
    'PRIVATE_GROUP',
    'PRIVATE_ENV',
    'PRIVATE_TAIL',
    'PRIVATE_MATH',
    'PRIVATE_DISPLAY_MATH',
    'PRIVATE_PAREN',
    'PRIVATE_BRACKET',
    'PRIVATE_INLINE_CODE',
    'PRIVATE_FANCY_VERB',
    'PRIVATE_URL_TAIL',
    'PRIVATE_MINT_TAIL',
    'PRIVATE_VERBATIM_TAIL',
    'PRIVATE_SPACED_END_TAIL',
    'PRIVATE_PADDED_END_TAIL',
    'PRIVATE_CAPITAL_VERBATIM_TAIL',
    'PRIVATE_LISTING_TAIL',
    'PRIVATE_MINTED_TAIL',
  ]) {
    assert.equal(prose.includes(hidden), false, hidden);
  }
});

test('AI prose segments retain exact UTF-16 source offset mapping', () => {
  const source = '前言 😀 is clear.\n\nSecond paragraph has teh mistake.';
  const document = extractAiProseDocument(source);
  assert.equal(document.segments.length, 2);
  const second = document.segments[1];
  assert.ok(second);
  const relative = second.text.indexOf('teh');
  assert.equal(relative >= 0, true);
  assert.equal(aiProseOffsetToSourceOffset(second, relative), source.indexOf('teh'));
  assert.equal(aiProseOffsetToSourceOffset(second, second.text.length), second.sourceEnd);
  assert.equal(aiProseOffsetToSourceOffset(second, -1), undefined);
  assert.equal(second.text.length, second.sourceEnd - second.sourceStart);
});

test('AI prose cursor helpers return the containing paragraph and sentence', () => {
  const source = 'First sentence. 第二个句子有错！ Third sentence?\nStill the same paragraph.\n\nNext paragraph.';
  const document = extractAiProseDocument(source);
  const cursor = source.indexOf('句子');
  const paragraph = findAiProseParagraphAtOffset(document, cursor);
  const sentence = findAiProseSentenceAtOffset(document, cursor);

  assert.ok(paragraph);
  assert.equal(paragraph.text.includes('Still the same paragraph.'), true);
  assert.ok(sentence);
  assert.equal(sentence.text, '第二个句子有错！');
  assert.equal(source.slice(sentence.sourceStart, sentence.sourceEnd), sentence.text);
  assert.equal(findAiProseParagraphAtOffset(document, source.length + 1), undefined);
});

test('AI prose issue planning maps safe edits and rejects hostile model output', () => {
  const source = 'This is are clear prose and more.';
  const segment = extractAiProseDocument(source).segments[0];
  assert.ok(segment);
  const areStart = segment.text.indexOf('are');
  const clearStart = segment.text.indexOf('clear');
  const issues: AiProseIssue[] = [
    {
      start: areStart,
      end: areStart + 3,
      original: 'are',
      replacement: 'very',
      message: 'Improve wording',
      category: 'style',
      severity: 'information',
    },
    {
      start: areStart + 1,
      end: clearStart + 5,
      original: segment.text.slice(areStart + 1, clearStart + 5),
      replacement: 'conflicting suggestion',
    },
    {
      start: clearStart,
      end: clearStart + 5,
      original: 'wrong',
      replacement: 'plain',
    },
    {
      start: -1,
      end: 2,
      original: '',
      replacement: 'x',
    },
    {
      start: 0,
      end: 4,
      original: 'This',
      replacement: '\\textbf{That}',
    },
    {
      start: 0,
      end: 4,
      original: 'This',
      replacement: 'This',
    },
    {
      start: 0,
      end: 4,
      original: 'This',
      replacement: 'safe\u202e',
    },
  ];

  const plan = planAiProseIssues(source, segment, issues);
  assert.equal(plan.edits.length, 1);
  assert.deepEqual(plan.edits[0], {
    issueIndex: 0,
    segmentId: segment.id,
    start: areStart,
    end: areStart + 3,
    original: 'are',
    replacement: 'very',
    message: 'Improve wording',
    category: 'style',
    severity: 'information',
    sourceStart: source.indexOf('are'),
    sourceEnd: source.indexOf('are') + 3,
  });
  assert.deepEqual(
    plan.rejected.map((entry) => [entry.issueIndex, entry.reason]),
    [
      [1, 'overlap'],
      [2, 'original-mismatch'],
      [3, 'out-of-bounds'],
      [4, 'unsafe-replacement'],
      [5, 'unchanged'],
      [6, 'unsafe-replacement'],
    ],
  );
});

test('AI prose issue planning rejects edits over protected or multiline source', () => {
  const source = 'Readable text with $x+y$ and \cite{privateKey}.\nwrapped line.';
  const segment = extractAiProseDocument(source).segments[0];
  assert.ok(segment);
  const mathStart = segment.text.indexOf('   ');
  const lineStart = segment.text.indexOf('.\n');
  const lineEnd = segment.text.indexOf('wrapped') + 'wrapped'.length;
  assert.equal(mathStart >= 0, true);

  const plan = planAiProseIssues(source, segment, [
    {
      start: mathStart,
      end: mathStart + 3,
      original: segment.text.slice(mathStart, mathStart + 3),
      replacement: 'math',
    },
    {
      start: lineStart,
      end: lineEnd,
      original: segment.text.slice(lineStart, lineEnd),
      replacement: 'one line',
    },
    {
      start: 0,
      end: 8,
      original: 'Readable',
      replacement: 'Bad\nline',
    },
  ]);

  assert.deepEqual(
    plan.rejected.map((entry) => entry.reason),
    ['protected-source', 'multiline-source', 'unsafe-replacement'],
  );
  assert.deepEqual(plan.edits, []);
});

test('AI prose issue planning allows safe zero-width punctuation insertion', () => {
  const source = 'However this works.';
  const segment = extractAiProseDocument(source).segments[0];
  assert.ok(segment);
  const offset = 'However'.length;
  const plan = planAiProseIssues(source, segment, [{
    start: offset,
    end: offset,
    original: '',
    replacement: ',',
  }]);
  assert.equal(plan.rejected.length, 0);
  assert.equal(plan.edits[0]?.sourceStart, offset);
  assert.equal(plan.edits[0]?.sourceEnd, offset);
});

test('AI prose issue planning rejects a replacement already present around a truncated range', () => {
  const source = 'Note that if one takes the object.';
  const segment = extractAiProseDocument(source).segments[0];
  assert.ok(segment);
  const start = segment.text.indexOf('one take');
  const plan = planAiProseIssues(source, segment, [
    {
      start,
      end: start + 'one take'.length,
      original: 'one take',
      replacement: 'one takes',
      message: '第三人称单数',
    },
    {
      start: start + 'one '.length,
      end: start + 'one takes'.length,
      original: 'takes',
      replacement: 'one takes',
      message: '补全主语',
    },
  ]);

  assert.deepEqual(plan.edits, []);
  assert.deepEqual(
    plan.rejected.map((entry) => entry.reason),
    ['replacement-already-present', 'replacement-already-present'],
  );
});

test('AI prose issue planning rejects C1 and Unicode line separators', () => {
  const source = 'Plain text.';
  const segment = extractAiProseDocument(source).segments[0];
  assert.ok(segment);
  for (const replacement of ['bad\u0085text', 'bad\u2028text', 'bad\u2029text']) {
    const plan = planAiProseIssues(source, segment, [{
      start: 0,
      end: 5,
      original: 'Plain',
      replacement,
    }]);
    assert.deepEqual(plan.edits, []);
    assert.equal(plan.rejected[0]?.reason, 'unsafe-replacement');
  }
});
