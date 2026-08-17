import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EnlargeBracketPlan,
  LatexContext,
  SnippetDefinitionInput,
  SnippetMatcher,
  SnippetMatcherOptions,
  advanceAiDirtyReviewProgress,
  aiIssueRangesOverlap,
  aiIssueMatchesCapturedIdentity,
  aiWritingLanguageLabel,
  aiProseSentenceSegments,
  compileSnippetFile,
  captureAiIssueIdentity,
  chooseAiIssueRetentionPreparation,
  choosePendingAiAutomaticReviewTarget,
  createAiIssueActionId,
  createLatexScanState,
  extractAiProseDocument,
  expandSnippetVariables,
  findFractionNumerator,
  isTeXLeafSourceUri,
  isAIWritingSourceUri,
  latexContextFromState,
  materializeReplacement,
  optimisticRevisionStatus,
  parseReplacementTemplate,
  parseSnippetOptions,
  planAiIssueRetention,
  planAutoEnlarge,
  planLeftRightEnter,
  planTabout,
  remapAiIssueOffsetRange,
  remapTabstopsForVsCode,
  replacementPartsToText,
  scanLatexContext,
  scanLatexRegions,
  scanLatexSegment,
  selectAiProseSentenceSegmentsForRanges,
  selectScopedResources,
  SerialTaskQueue,
  shouldReplaceAiIssueAfterReview,
  toPortableSnippetObject,
  tryReserveAiAutomaticReviewKey,
  validateMigratableSnippetLibraryText,
  validateSnippetFile,
} from '../src/core';
import {
  createSyncedSnippetEnvelope,
  decideSnippetSync,
  decodeSyncedSnippetEnvelope,
  hashSnippetContent,
} from '../src/snippetSync';

test('AI writing language preferences stay within the client protocol label', () => {
  assert.equal(aiWritingLanguageLabel('auto'), 'auto');
  assert.equal(aiWritingLanguageLabel('english'), 'English');
  assert.equal(aiWritingLanguageLabel('chinese'), 'Chinese');
  for (const preference of ['auto', 'english', 'chinese'] as const) {
    const label = aiWritingLanguageLabel(preference);
    assert.ok(label.length <= 64);
    assert.doesNotMatch(label, /[\r\n\u0000]/u);
  }
});

test('oversized AI retention buffers discard without entering fallback extraction', () => {
  const maximum = 1_000_000;
  assert.equal(
    chooseAiIssueRetentionPreparation(maximum, maximum + 1, 1, maximum),
    'discard',
  );
  assert.equal(
    chooseAiIssueRetentionPreparation(maximum + 1, maximum, 1, maximum),
    'discard',
  );
  assert.equal(
    chooseAiIssueRetentionPreparation(undefined, maximum + 1, 1, maximum),
    'discard',
  );
  assert.equal(
    chooseAiIssueRetentionPreparation(undefined, maximum, 1, maximum),
    'fallback',
  );
  assert.equal(
    chooseAiIssueRetentionPreparation(maximum, maximum, 0, maximum),
    'fallback',
  );
  assert.equal(
    chooseAiIssueRetentionPreparation(maximum, maximum, 1, maximum),
    'retain',
  );
});

test('AI issue retention invalidates only the edited issue neighborhood', () => {
  const oldSource = 'First bad sentence. Second wrong sentence.\n\nThird poor sentence.';
  const changeStart = oldSource.indexOf('bad');
  const newSource = oldSource.slice(0, changeStart) + 'weak' +
    oldSource.slice(changeStart + 'bad'.length);
  const issues = [
    { key: 'bad', start: changeStart, end: changeStart + 3, original: 'bad' },
    {
      key: 'wrong',
      start: oldSource.indexOf('wrong'),
      end: oldSource.indexOf('wrong') + 5,
      original: 'wrong',
    },
    {
      key: 'poor',
      start: oldSource.indexOf('poor'),
      end: oldSource.indexOf('poor') + 4,
      original: 'poor',
    },
  ];
  const plan = planAiIssueRetention(
    oldSource,
    newSource,
    [{ rangeOffset: changeStart, rangeLength: 3, text: 'weak' }],
    issues,
  );
  assert.ok(plan);
  assert.deepEqual(
    plan.retained.map((issue) => ({ key: issue.key, start: issue.start, end: issue.end })),
    [
      {
        key: 'wrong',
        start: newSource.indexOf('wrong'),
        end: newSource.indexOf('wrong') + 5,
      },
      {
        key: 'poor',
        start: newSource.indexOf('poor'),
        end: newSource.indexOf('poor') + 4,
      },
    ],
  );
  assert.deepEqual(
    plan.dirtySegments.map((segment) => segment.text),
    ['First weak sentence.'],
  );
  assert.deepEqual(plan.dirtyRanges, [{
    start: newSource.indexOf('weak'),
    end: newSource.indexOf('weak') + 4,
  }]);
});

test('AI issue retention invalidates a target fixed by a right-endpoint insertion', () => {
  const oldSource =
    'Note that if one take the operator, another poor phrase remains.';
  const targetStart = oldSource.indexOf('one take');
  const targetEnd = targetStart + 'one take'.length;
  const remoteStart = oldSource.indexOf('poor');
  const newSource = oldSource.slice(0, targetEnd) + 's' + oldSource.slice(targetEnd);
  const plan = planAiIssueRetention(
    oldSource,
    newSource,
    [{ rangeOffset: targetEnd, rangeLength: 0, text: 's' }],
    [
      {
        key: 'applied-target',
        start: targetStart,
        end: targetEnd,
        original: 'one take',
      },
      {
        key: 'same-sentence-remote',
        start: remoteStart,
        end: remoteStart + 'poor'.length,
        original: 'poor',
      },
    ],
  );

  assert.ok(plan);
  assert.deepEqual(plan.retained, [{
    key: 'same-sentence-remote',
    start: remoteStart + 1,
    end: remoteStart + 1 + 'poor'.length,
  }]);
  assert.deepEqual(plan.dirtyRanges, [{ start: targetEnd, end: targetEnd + 1 }]);
  assert.deepEqual(
    plan.dirtySegments.map((segment) => segment.text),
    [newSource],
  );
});

test('retained AI action lineage cannot rebind to a fresh issue at its historical offset', () => {
  const original = 'one take';
  const replacement = 'one takes';
  const category = 'grammar';
  const oldSource = 'Lead. one take remains.';
  const oldOffset = oldSource.indexOf(original);
  const insertedPrefix = 'Fresh one take. ';
  const newSource = insertedPrefix + oldSource;
  assert.equal(
    newSource.indexOf(original),
    oldOffset,
    'the inserted fresh occurrence must occupy A\'s historical offset',
  );

  const historicalFingerprint = `fixture:${oldOffset}:${original}:${replacement}:${category}`;
  const retainedActionId = createAiIssueActionId(
    historicalFingerprint,
    1,
    'retained-a-lineage',
  );
  const retention = planAiIssueRetention(
    oldSource,
    newSource,
    [{ rangeOffset: 0, rangeLength: 0, text: insertedPrefix }],
    [{
      key: retainedActionId,
      start: oldOffset,
      end: oldOffset + original.length,
      original,
    }],
  );
  assert.ok(retention);
  assert.equal(retention.retained.length, 1);
  const retainedRange = retention.retained[0];
  assert.ok(retainedRange);
  assert.equal(retainedRange.key, retainedActionId);
  assert.deepEqual(
    { start: retainedRange.start, end: retainedRange.end },
    {
      start: oldOffset + insertedPrefix.length,
      end: oldOffset + insertedPrefix.length + original.length,
    },
    'safe retention must move A while preserving its opaque action lineage',
  );

  const retained = {
    id: retainedActionId,
    fingerprint:
      `fixture:${retainedRange.start}:${original}:${replacement}:${category}`,
    documentVersion: 2,
    sourceStart: retainedRange.start,
    sourceEnd: retainedRange.end,
    original,
    replacement,
    category,
  };
  const fresh = {
    id: createAiIssueActionId(
      historicalFingerprint,
      2,
      'fresh-b-lineage',
    ),
    fingerprint: historicalFingerprint,
    documentVersion: 2,
    sourceStart: oldOffset,
    sourceEnd: oldOffset + original.length,
    original,
    replacement,
    category,
  };
  assert.notEqual(
    fresh.id,
    retainedActionId,
    'a fresh issue at the same historical location and with the same suggestion must get a new action ID',
  );
  assert.deepEqual(
    [retained, fresh]
      .filter((issue) => issue.id === retainedActionId)
      .map((issue) => [issue.sourceStart, issue.sourceEnd]),
    [[retained.sourceStart, retained.sourceEnd]],
    'an old Tree action ID may resolve only the safely retained occurrence',
  );

  const batchCapture = captureAiIssueIdentity(retained);
  assert.equal(aiIssueMatchesCapturedIdentity(retained, batchCapture), true);
  assert.equal(
    aiIssueMatchesCapturedIdentity(fresh, batchCapture),
    false,
    'Apply All must not substitute a fresh issue for the issue captured before its modal prompt',
  );
  assert.equal(
    aiIssueMatchesCapturedIdentity({
      ...fresh,
      id: retainedActionId,
    }, batchCapture),
    false,
    'even an injected duplicate action ID must fail the full captured-identity check',
  );
  assert.equal(
    aiIssueMatchesCapturedIdentity({
      ...retained,
      documentVersion: retained.documentVersion + 1,
    }, batchCapture),
    false,
    'Apply All must reject an identity that advanced while its modal prompt was open',
  );
});

test('AI issue retention follows sentence splits and merges', () => {
  const splitOld = 'First bad clause and second wrong clause.';
  const splitAt = splitOld.indexOf(' and ');
  const splitNew = `${splitOld.slice(0, splitAt)}. ${splitOld.slice(splitAt + 1)}`;
  const splitPlan = planAiIssueRetention(
    splitOld,
    splitNew,
    [{ rangeOffset: splitAt, rangeLength: 1, text: '. ' }],
    [
      {
        key: 'bad',
        start: splitOld.indexOf('bad'),
        end: splitOld.indexOf('bad') + 3,
        original: 'bad',
      },
      {
        key: 'wrong',
        start: splitOld.indexOf('wrong'),
        end: splitOld.indexOf('wrong') + 5,
        original: 'wrong',
      },
    ],
  );
  assert.ok(splitPlan);
  assert.deepEqual(splitPlan.retained.map((issue) => issue.key), ['bad', 'wrong']);
  assert.equal(splitPlan.dirtySegments.length, 2);

  const mergeOld = 'First bad. Second wrong.';
  const mergeAt = mergeOld.indexOf('. ');
  const mergeNew = mergeOld.slice(0, mergeAt) + mergeOld.slice(mergeAt + 2);
  const mergePlan = planAiIssueRetention(
    mergeOld,
    mergeNew,
    [{ rangeOffset: mergeAt, rangeLength: 2, text: '' }],
    [
      {
        key: 'bad',
        start: mergeOld.indexOf('bad'),
        end: mergeOld.indexOf('bad') + 3,
        original: 'bad',
      },
      {
        key: 'wrong',
        start: mergeOld.indexOf('wrong'),
        end: mergeOld.indexOf('wrong') + 5,
        original: 'wrong',
      },
    ],
  );
  assert.ok(mergePlan);
  assert.deepEqual(mergePlan.retained.map((issue) => issue.key), ['bad', 'wrong']);
  assert.deepEqual(
    mergePlan.dirtySegments.map((segment) => segment.text),
    ['First badSecond wrong.'],
  );
});

test('dirty review progress survives a partial failure and a later retry', () => {
  const prose = extractAiProseDocument('第一句。第二句。');
  const sentences = aiProseSentenceSegments(prose);
  assert.equal(sentences.length, 2);
  const first = sentences[0];
  const second = sentences[1];
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.sourceEnd, second.sourceStart);
  const dirty = [{ start: second.sourceStart, end: second.sourceStart }];

  const afterFirst = advanceAiDirtyReviewProgress(
    prose,
    dirty,
    new Set(),
    [first],
  );
  assert.deepEqual(afterFirst.remainingRanges, dirty);
  assert.equal(afterFirst.reviewedSentenceKeys.size, 1);

  // Model the second request failing before commit, then succeeding in a new
  // request. The first request's progress must still satisfy half the boundary.
  const afterRetry = advanceAiDirtyReviewProgress(
    prose,
    afterFirst.remainingRanges,
    afterFirst.reviewedSentenceKeys,
    [second],
  );
  assert.deepEqual(afterRetry.remainingRanges, []);
  assert.equal(afterRetry.reviewedSentenceKeys.size, 0);
});

test('dirty review progress accumulates across bounded batches', () => {
  const source = Array.from({ length: 12 }, (_unused, index) => `第${index}句。`).join('');
  const prose = extractAiProseDocument(source);
  const sentences = aiProseSentenceSegments(prose);
  assert.equal(sentences.length, 12);
  const dirty = [{ start: 0, end: source.length }];
  const firstBatch = advanceAiDirtyReviewProgress(
    prose,
    dirty,
    new Set(),
    sentences.slice(0, 8),
  );
  assert.deepEqual(firstBatch.remainingRanges, dirty);
  assert.equal(firstBatch.reviewedSentenceKeys.size, 8);
  const secondBatch = advanceAiDirtyReviewProgress(
    prose,
    firstBatch.remainingRanges,
    firstBatch.reviewedSentenceKeys,
    sentences.slice(8),
  );
  assert.deepEqual(secondBatch.remainingRanges, []);
});

test('a manual paragraph review covers its pending sentence contexts', () => {
  const source = 'First sentence. Second sentence.';
  const prose = extractAiProseDocument(source);
  const paragraph = prose.segments[0];
  assert.ok(paragraph);
  const dirtyStart = source.indexOf('Second');
  const progress = advanceAiDirtyReviewProgress(
    prose,
    [{ start: dirtyStart, end: dirtyStart + 'Second'.length }],
    new Set(),
    [paragraph],
  );
  assert.deepEqual(progress.remainingRanges, []);
});

test('a right-endpoint zero-width dirty range keeps its next-sentence affinity', () => {
  const original = 'One bad. XTwo wrong.';
  const deletedAt = original.indexOf('X');
  const afterDeletion = original.slice(0, deletedAt) + original.slice(deletedAt + 1);
  const firstPlan = planAiIssueRetention(
    original,
    afterDeletion,
    [{ rangeOffset: deletedAt, rangeLength: 1, text: '' }],
    [],
  );
  assert.ok(firstPlan);
  assert.deepEqual(firstPlan.dirtyRanges, [{ start: 9, end: 9 }]);

  const punctuationStart = afterDeletion.indexOf('. ');
  const afterPunctuation = afterDeletion.slice(0, punctuationStart) + '! ' +
    afterDeletion.slice(punctuationStart + 2);
  const secondPlan = planAiIssueRetention(
    afterDeletion,
    afterPunctuation,
    [{ rangeOffset: punctuationStart, rangeLength: 2, text: '! ' }],
    [],
    firstPlan.dirtyRanges,
  );
  assert.ok(secondPlan);
  assert.deepEqual(secondPlan.dirtyRanges, [
    { start: 7, end: 9 },
    { start: 9, end: 9 },
  ]);
  assert.deepEqual(
    selectAiProseSentenceSegmentsForRanges(secondPlan.prose, secondPlan.dirtyRanges)
      .map((sentence) => sentence.text),
    ['One bad!', 'Two wrong.'],
  );
});

test('AI issue review replaces only dirty or intersecting suggestions in one sentence', () => {
  const existing = [
    { key: 'left', start: 2, end: 6 },
    { key: 'edited', start: 12, end: 16 },
    { key: 'rediscovered', start: 24, end: 29 },
    { key: 'insertion', start: 34, end: 34 },
  ];
  const dirty = [{ start: 11, end: 17 }];
  const returned = [
    { start: 23, end: 28 },
    { start: 34, end: 34 },
  ];
  assert.deepEqual(
    existing
      .filter((issue) => shouldReplaceAiIssueAfterReview(issue, dirty, returned))
      .map((issue) => issue.key),
    ['edited', 'rediscovered', 'insertion'],
  );
});

test('AI issue retention handles multiple edits and carries pending dirty sentences', () => {
  const oldSource = 'A bad one. B wrong two. C poor three. D weak four.';
  const bad = oldSource.indexOf('bad');
  const weak = oldSource.indexOf('weak');
  const changes = [
    { rangeOffset: bad, rangeLength: 3, text: 'good' },
    { rangeOffset: weak, rangeLength: 4, text: 'strong' },
  ];
  const newSource = 'A good one. B wrong two. C poor three. D strong four.';
  const plan = planAiIssueRetention(
    oldSource,
    newSource,
    changes,
    [
      {
        key: 'wrong',
        start: oldSource.indexOf('wrong'),
        end: oldSource.indexOf('wrong') + 5,
        original: 'wrong',
      },
      {
        key: 'poor',
        start: oldSource.indexOf('poor'),
        end: oldSource.indexOf('poor') + 4,
        original: 'poor',
      },
    ],
    [{ start: oldSource.indexOf('B wrong'), end: oldSource.indexOf('two.') + 4 }],
  );
  assert.ok(plan);
  assert.deepEqual(plan.retained.map((issue) => issue.key), ['poor']);
  assert.deepEqual(
    plan.dirtySegments.map((segment) => segment.text),
    ['A good one.', 'B wrong two.', 'D strong four.'],
  );
});

test('AI issue retention isolates adjacent CJK sentences without whitespace', () => {
  const oldSource = '第一处有错。第二处错误！第三处正常？';
  const changedStart = oldSource.indexOf('有错');
  const newSource = oldSource.slice(0, changedStart) + '正确' +
    oldSource.slice(changedStart + '有错'.length);
  const secondStart = oldSource.indexOf('错误');
  const plan = planAiIssueRetention(
    oldSource,
    newSource,
    [{ rangeOffset: changedStart, rangeLength: '有错'.length, text: '正确' }],
    [
      {
        key: 'first',
        start: changedStart,
        end: changedStart + '有错'.length,
        original: '有错',
      },
      {
        key: 'second',
        start: secondStart,
        end: secondStart + '错误'.length,
        original: '错误',
      },
    ],
  );
  assert.ok(plan);
  assert.deepEqual(plan.retained, [{
    key: 'second',
    start: newSource.indexOf('错误'),
    end: newSource.indexOf('错误') + '错误'.length,
  }]);
  assert.deepEqual(
    plan.dirtySegments.map((segment) => segment.text),
    ['第一处正确。'],
  );
});

test('AI issue retention handles many sparse edits without scanning every sentence per edit', () => {
  const sentenceCount = 12_000;
  const oldSource = Array.from(
    { length: sentenceCount },
    (_unused, index) => `S${index} bad.`,
  ).join(' ');
  const changes: Array<{ rangeOffset: number; rangeLength: number; text: string }> = [];
  let searchFrom = 0;
  for (let sentence = 0; sentence < sentenceCount - 1; sentence += 97) {
    const marker = `S${sentence} bad.`;
    const markerStart = oldSource.indexOf(marker, searchFrom);
    assert.notEqual(markerStart, -1);
    changes.push({
      rangeOffset: markerStart + marker.indexOf('bad'),
      rangeLength: 3,
      text: 'good',
    });
    searchFrom = markerStart + marker.length;
  }
  const chunks: string[] = [];
  let oldCursor = 0;
  for (const change of changes) {
    chunks.push(oldSource.slice(oldCursor, change.rangeOffset), change.text);
    oldCursor = change.rangeOffset + change.rangeLength;
  }
  chunks.push(oldSource.slice(oldCursor));
  const newSource = chunks.join('');
  const lastIssueStart = oldSource.lastIndexOf('bad');
  const plan = planAiIssueRetention(
    oldSource,
    newSource,
    changes,
    [{
      key: 'last-unaffected',
      start: lastIssueStart,
      end: lastIssueStart + 3,
      original: 'bad',
    }],
  );
  assert.ok(plan);
  assert.equal(plan.dirtySegments.length, changes.length);
  const mappedLast = newSource.lastIndexOf('bad');
  assert.deepEqual(plan.retained, [{
    key: 'last-unaffected',
    start: mappedLast,
    end: mappedLast + 3,
  }]);
});

test('AI issue retention fails closed for pathological change transactions', () => {
  const source = 'a'.repeat(1025);
  const changes = Array.from({ length: 1025 }, (_unused, index) => ({
    rangeOffset: index,
    rangeLength: 1,
    text: 'a',
  }));
  assert.equal(planAiIssueRetention(source, source, changes, []), undefined);
  assert.equal(
    planAiIssueRetention(
      'Safe sentence.',
      'Safe sentence!',
      [{ rangeOffset: 13, rangeLength: 1, text: '!' }],
      [],
      [{ start: 0, end: 99 }],
    ),
    undefined,
  );
});

test('AI issue ranges survive only exact non-overlapping single edits', () => {
  assert.deepEqual(
    remapAiIssueOffsetRange(
      { start: 20, end: 25 },
      { rangeOffset: 5, rangeLength: 0, insertedLength: 3 },
    ),
    { start: 23, end: 28 },
  );
  assert.deepEqual(
    remapAiIssueOffsetRange(
      { start: 2, end: 7 },
      { rangeOffset: 10, rangeLength: 2, insertedLength: 5 },
    ),
    { start: 2, end: 7 },
  );
  assert.deepEqual(
    remapAiIssueOffsetRange(
      { start: 20, end: 25 },
      { rangeOffset: 5, rangeLength: 4, insertedLength: 1 },
    ),
    { start: 17, end: 22 },
  );
  assert.equal(
    remapAiIssueOffsetRange(
      { start: 20, end: 25 },
      { rangeOffset: 22, rangeLength: 0, insertedLength: 1 },
    ),
    undefined,
  );
  assert.equal(
    remapAiIssueOffsetRange(
      { start: 20, end: 25 },
      { rangeOffset: 18, rangeLength: 4, insertedLength: 1 },
    ),
    undefined,
  );
});

test('AI issue offsets retain unaffected document-review results across common edits', () => {
  const original = { start: 80, end: 85 };
  const scenarios = [
    {
      name: 'insertion',
      change: { rangeOffset: 10, rangeLength: 0, insertedLength: 4 },
      expected: { start: 84, end: 89 },
    },
    {
      name: 'deletion',
      change: { rangeOffset: 10, rangeLength: 6, insertedLength: 0 },
      expected: { start: 74, end: 79 },
    },
    {
      name: 'replacement',
      change: { rangeOffset: 10, rangeLength: 3, insertedLength: 8 },
      expected: { start: 85, end: 90 },
    },
    {
      name: 'blank-line insertion',
      change: { rangeOffset: 10, rangeLength: 0, insertedLength: 2 },
      expected: { start: 82, end: 87 },
    },
  ] as const;

  for (const scenario of scenarios) {
    assert.deepEqual(
      remapAiIssueOffsetRange(original, scenario.change),
      scenario.expected,
      `${scenario.name} must move an unrelated later issue by the exact UTF-16 delta`,
    );
  }
});

test('zero-width AI insertion suggestions survive unrelated edits', () => {
  assert.deepEqual(
    remapAiIssueOffsetRange(
      { start: 80, end: 80 },
      { rangeOffset: 10, rangeLength: 0, insertedLength: 4 },
    ),
    { start: 84, end: 84 },
    'a punctuation-insertion suggestion after the edit must move with the text',
  );
  assert.deepEqual(
    remapAiIssueOffsetRange(
      { start: 10, end: 10 },
      { rangeOffset: 80, rangeLength: 3, insertedLength: 1 },
    ),
    { start: 10, end: 10 },
    'a punctuation-insertion suggestion before the edit must remain valid',
  );
});

test('AI issue batch ranges fail closed for zero-width boundary conflicts', () => {
  assert.equal(
    aiIssueRangesOverlap(
      { start: 12, end: 12 },
      { start: 12, end: 12 },
    ),
    true,
    'two insertion suggestions at the same point cannot both be applied',
  );
  assert.equal(
    aiIssueRangesOverlap(
      { start: 12, end: 12 },
      { start: 12, end: 18 },
    ),
    true,
    'an insertion touching the left edge of a replacement must conflict',
  );
  assert.equal(
    aiIssueRangesOverlap(
      { start: 18, end: 18 },
      { start: 12, end: 18 },
    ),
    true,
    'an insertion touching the right edge of a replacement must conflict',
  );
  assert.equal(
    aiIssueRangesOverlap(
      { start: 12, end: 18 },
      { start: 18, end: 24 },
    ),
    false,
    'adjacent non-empty half-open replacements remain safe',
  );
  assert.equal(
    aiIssueRangesOverlap(
      { start: 11, end: 11 },
      { start: 12, end: 18 },
    ),
    false,
    'a separated insertion remains safe',
  );
});

test('an unchecked AI edit target cannot be stolen by cursor navigation', () => {
  const edit = { offset: 42, reason: 'edit' as const };
  const navigation = { offset: 200, reason: 'navigation' as const };
  assert.equal(choosePendingAiAutomaticReviewTarget(edit, navigation), edit);
  assert.deepEqual(
    choosePendingAiAutomaticReviewTarget(navigation, edit),
    edit,
  );
  assert.deepEqual(
    choosePendingAiAutomaticReviewTarget(edit, { offset: 50, reason: 'edit' }),
    { offset: 50, reason: 'edit' },
  );
  assert.deepEqual(
    choosePendingAiAutomaticReviewTarget(navigation, {
      offset: 220,
      reason: 'navigation',
    }),
    { offset: 220, reason: 'navigation' },
  );
});

test('automatic AI review keys use a hard per-version request cap', () => {
  const keys = new Set<string>();
  assert.equal(tryReserveAiAutomaticReviewKey(keys, 'a', 2), true);
  assert.equal(tryReserveAiAutomaticReviewKey(keys, 'a', 2), false);
  assert.equal(tryReserveAiAutomaticReviewKey(keys, 'b', 2), true);
  assert.equal(tryReserveAiAutomaticReviewKey(keys, 'c', 2), false);
  assert.deepEqual([...keys], ['a', 'b']);
  keys.delete('b');
  assert.equal(tryReserveAiAutomaticReviewKey(keys, 'c', 2), true);
  assert.equal(tryReserveAiAutomaticReviewKey(new Set(), 'a', 0), false);
});

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

  assert.equal(isAIWritingSourceUri('file', '/paper/main.tex'), true);
  assert.equal(
    isAIWritingSourceUri('vscode-remote', '/home/me/chapter.TeX'),
    true,
  );
  assert.equal(isAIWritingSourceUri('file', '/paper/references.bib'), false);
  assert.equal(isAIWritingSourceUri('untitled', 'Untitled-1.tex'), false);
  assert.equal(isAIWritingSourceUri('git', '/paper/main.tex'), false);
  assert.equal(isAIWritingSourceUri('vscode-vfs', '/paper/main.tex'), false);
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

test('optimistic save acknowledgement requires the exact desired revision', () => {
  const desiredA = 'a'.repeat(64);
  const overwrittenB = 'b'.repeat(64);
  assert.equal(
    optimisticRevisionStatus(desiredA, desiredA),
    'committed',
  );
  assert.equal(
    optimisticRevisionStatus(desiredA, overwrittenB),
    'changed',
    'a later B write must not be acknowledged as the successful A save',
  );
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

test('publisher-storage migration accepts complete JSONC without normalizing it', () => {
  const text = `{
    // Comments and trailing commas must survive the byte-for-byte copy.
    "version": 1,
    "defaultsRevision": 3,
    "variables": { "GREEK": "alpha|beta" },
    "snippets": [
      {
        "id": "user.regex",
        "trigger": "([A-Z])hat",
        "replacement": "\\\\hat{@[0]}",
        "options": "mAr",
      },
    ],
  }\n`;
  assert.deepEqual(validateMigratableSnippetLibraryText(text), {
    ok: true,
    snippetCount: 1,
  });

  const legacyString = JSON.stringify({
    snippets: JSON.stringify([
      { trigger: 'old', replacement: '\\operatorname{Old}', options: 'tA' },
    ]),
  });
  assert.deepEqual(validateMigratableSnippetLibraryText(legacyString), {
    ok: true,
    snippetCount: 1,
  });
});

test('publisher-storage migration rejects malformed or partly unusable libraries', () => {
  const invalidCases = [
    '{ not JSONC',
    '{}',
    JSON.stringify({ snippets: [null] }),
    JSON.stringify({ snippets: [{ trigger: 'x', replacement: 1 }] }),
    JSON.stringify({ snippets: [{ trigger: 'x', replacement: 'x', options: 'q' }] }),
    JSON.stringify({
      snippets: [{ trigger: 'a*', replacement: 'x', options: 'r' }],
    }),
    JSON.stringify({
      variables: { unsafe: 42 },
      snippets: [],
    }),
    JSON.stringify({
      snippets: [
        { id: 'duplicate', trigger: 'a', replacement: 'a' },
        { id: 'duplicate', trigger: 'b', replacement: 'b' },
      ],
    }),
  ];
  for (const text of invalidCases) {
    assert.equal(
      validateMigratableSnippetLibraryText(text).ok,
      false,
      text,
    );
  }
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
    inSnippetSuppressedArgument: false,
    snippetSuppressionCommand: undefined,
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

test('LaTeX context suppresses snippets only inside label and tag arguments', () => {
  const equationLabel = scanLatexContext(String.raw`\begin{equation}\label{;a`);
  assert.equal(equationLabel.mathMode, 'block');
  assert.equal(equationLabel.inSnippetSuppressedArgument, true);
  assert.equal(equationLabel.snippetSuppressionCommand, 'label');

  const afterLabel = scanLatexContext(String.raw`\begin{equation}\label{eq:a};a`);
  assert.equal(afterLabel.mathMode, 'block');
  assert.equal(afterLabel.inSnippetSuppressedArgument, false);
  assert.equal(afterLabel.snippetSuppressionCommand, undefined);

  const starredTag = scanLatexContext(String.raw`\begin{equation}\tag* {row {;a`);
  assert.equal(starredTag.mathMode, 'block');
  assert.equal(starredTag.inSnippetSuppressedArgument, true);
  assert.equal(starredTag.snippetSuppressionCommand, 'tag');

  // Escaped braces are label content, not structure; the unescaped brace closes it.
  assert.equal(
    scanLatexContext(String.raw`\begin{equation}\label{eq\};a`).inSnippetSuppressedArgument,
    true,
  );
  assert.equal(
    scanLatexContext(String.raw`\begin{equation}\label{eq\}};a`).inSnippetSuppressedArgument,
    false,
  );

  // An escaped slash does not introduce a real `\\label` command.
  assert.equal(scanLatexContext(String.raw`\\label{;a`).inSnippetSuppressedArgument, false);
  assert.equal(scanLatexContext(String.raw`\label*{;a`).inSnippetSuppressedArgument, false);
});

test('segment scanner carries pending and multiline label/tag argument state', () => {
  const pending = scanLatexSegment(String.raw`\tag* % explanation` + '\n');
  assert.equal(pending.pendingSnippetSuppression?.command, 'tag');
  assert.equal(pending.pendingSnippetSuppression?.starConsumed, true);

  const nested = scanLatexSegment('  {row {;a', pending, 20);
  const nestedContext = latexContextFromState(nested);
  assert.equal(nestedContext.mathMode, 'text');
  assert.equal(nestedContext.inSnippetSuppressedArgument, true);
  assert.equal(nested.snippetSuppression?.braceDepth, 2);

  const stillInside = scanLatexSegment('}\n', nested, 30);
  assert.equal(latexContextFromState(stillInside).inSnippetSuppressedArgument, true);
  const closed = scanLatexSegment('} trailing', stillInside, 32);
  assert.equal(latexContextFromState(closed).inSnippetSuppressedArgument, false);
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

test('matcher blocks automatic and manual snippets in label/tag arguments only', () => {
  const matcher = matcherFor([
    { id: 'alpha', trigger: ';a', replacement: '\\alpha', options: 'mA' },
  ]);

  for (const source of [
    String.raw`\begin{equation}\label{;a`,
    String.raw`\begin{equation}\tag{;a`,
    String.raw`\begin{equation}\tag*{nested{;a`,
  ]) {
    const context = scanLatexContext(source);
    assert.equal(context.mathMode, 'block');
    assert.equal(context.inSnippetSuppressedArgument, true);
    assert.equal(
      matcher.match({ textBefore: ';a', context, activation: 'auto' }),
      undefined,
    );
    assert.equal(
      matcher.match({ textBefore: ';a', context, activation: 'manual' }),
      undefined,
    );
  }

  const surroundingEquation = scanLatexContext(
    String.raw`\begin{equation}\label{eq:alpha};a`,
  );
  assert.equal(surroundingEquation.mathMode, 'block');
  assert.equal(surroundingEquation.inSnippetSuppressedArgument, false);
  assert.equal(
    matcher.match({
      textBefore: ';a',
      context: surroundingEquation,
      activation: 'auto',
    })?.snippet.id,
    'alpha',
  );
  assert.equal(
    matcher.match({
      textBefore: ';a',
      context: surroundingEquation,
      activation: 'manual',
    })?.snippet.id,
    'alpha',
  );
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

function cursorMarked(value: string): { text: string; offset: number } {
  const marker = '<CURSOR>';
  const offset = value.indexOf(marker);
  assert.notEqual(offset, -1, 'test fixture must contain a cursor marker');
  return {
    text: `${value.slice(0, offset)}${value.slice(offset + marker.length)}`,
    offset,
  };
}

function applyLeftRightEnterPlan(
  text: string,
  plan: NonNullable<ReturnType<typeof planLeftRightEnter>>,
): string {
  return `${text.slice(0, plan.insertionOffset)}${plan.insertionText}${text.slice(plan.insertionOffset)}`;
}

test('left/right Enter splits a top-level scalable pair with the current row indentation', () => {
  const fixture = cursorMarked(String.raw`\begin{align}
  x &= \left(a + <CURSOR>b\right)
\end{align}`);
  const plan = planLeftRightEnter(fixture.text, fixture.offset);
  assert.ok(plan);
  assert.equal(plan.environmentName, 'align');
  assert.equal(plan.openingDelimiter, '(');
  assert.equal(plan.closingDelimiter, ')');
  assert.equal(plan.insertionOffset, fixture.offset);
  assert.equal(
    plan.insertionText,
    `${String.raw`\right.\\`}\n  ${String.raw`\left.`}`,
  );
  assert.equal(plan.cursorOffset, fixture.offset + plan.insertionText.length);
  assert.equal(
    applyLeftRightEnterPlan(fixture.text, plan),
    String.raw`\begin{align}
  x &= \left(a + \right.\\
  \left.b\right)
\end{align}`,
  );
});

test('left/right Enter preserves CRLF and supports starred and command delimiters', () => {
  const fixture = cursorMarked(
    String.raw`\begin{align*}
	F &= \left\langle u,<CURSOR>v \right\rangle
\end{align*}`.replaceAll('\n', '\r\n'),
  );
  const plan = planLeftRightEnter(fixture.text, fixture.offset, { eol: '\r\n' });
  assert.ok(plan);
  assert.equal(plan.environmentName, 'align*');
  assert.equal(plan.openingDelimiter, String.raw`\langle`);
  assert.equal(plan.closingDelimiter, String.raw`\rangle`);
  assert.equal(
    plan.insertionText,
    `${String.raw`\right.\\`}\r\n\t${String.raw`\left.`}`,
  );
});

test('left/right Enter works in equation and chooses an innermost aligned environment', () => {
  const equation = cursorMarked(
    String.raw`\begin{equation}\left[x<CURSOR>+y\right]\end{equation}`,
  );
  assert.equal(
    planLeftRightEnter(equation.text, equation.offset)?.environmentName,
    'equation',
  );

  const aligned = cursorMarked(String.raw`\begin{equation}
  \begin{aligned}
    f &= \left(x<CURSOR>+y\right)
  \end{aligned}
\end{equation}`);
  assert.equal(
    planLeftRightEnter(aligned.text, aligned.offset)?.environmentName,
    'aligned',
  );
});

test('left/right Enter allows completed nested pairs on one side of the cursor', () => {
  const fixture = cursorMarked(String.raw`\begin{align}
  x &= \left(\left[a\right] + <CURSOR>b\right)
\end{align}`);
  assert.ok(planLeftRightEnter(fixture.text, fixture.offset));
});

test('left/right Enter declines cursor-crossing nested pairs and unsafe TeX boundaries', () => {
  const unsafeFixtures = [
    // Both the inner and outer pair cross the requested row boundary.
    String.raw`\begin{align}\left(a + \left[b<CURSOR>+c\right]\right)\end{align}`,
    // A braced macro argument may not be split with an alignment row command.
    String.raw`\begin{align}\left(\frac{a<CURSOR>+b}{c}\right)\end{align}`,
    // Alignment tabs and existing row separators already define row structure.
    String.raw`\begin{align}\left(a & <CURSOR>b\right)\end{align}`,
    String.raw`\begin{align}\left(a \\ <CURSOR>b\right)\end{align}`,
    // A nested environment owns its own line structure.
    String.raw`\begin{align}\left(a\begin{split}b<CURSOR>+c\end{split}\right)\end{align}`,
    // The cursor is inside command syntax rather than mathematical content.
    String.raw`\begin{align}\left(a + \fr<CURSOR>ac{b}{c}\right)\end{align}`,
  ];
  for (const source of unsafeFixtures) {
    const fixture = cursorMarked(source);
    assert.equal(planLeftRightEnter(fixture.text, fixture.offset), undefined, source);
  }
});

test('left/right Enter ignores comment tokens and declines ordinary or malformed cases', () => {
  const commentedToken = cursorMarked(String.raw`\begin{align}
  x &= \left(a % fake \right)
    + <CURSOR>b\right)
\end{align}`);
  assert.ok(planLeftRightEnter(commentedToken.text, commentedToken.offset));

  const declined = [
    String.raw`\begin{align}x + <CURSOR>y\end{align}`,
    String.raw`\begin{align}\left(x+y\right) + <CURSOR>z\end{align}`,
    String.raw`\begin{align}\left(x<CURSOR>+y\end{align}`,
    String.raw`\[\left(x<CURSOR>+y\right)\]`,
    String.raw`\begin{matrix}\left(x<CURSOR>+y\right)\end{matrix}`,
    String.raw`\begin{align}\left(x % <CURSOR>comment
      + y\right)\end{align}`,
  ];
  for (const source of declined) {
    const fixture = cursorMarked(source);
    assert.equal(planLeftRightEnter(fixture.text, fixture.offset), undefined, source);
  }
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
