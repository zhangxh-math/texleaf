/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeBrackets,
  insertBracket,
  nextSnippetField,
} from '@codemirror/autocomplete';
import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import { getIndentation, indentUnit } from '@codemirror/language';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { VisualTextStyleRecord, VisualTheoremRecord } from '../src/core';
import {
  applyAtomicCodeMirrorSnippet,
  changedDocumentLineFilter,
  changedDocumentLineRanges,
  insertLiteralMathApostrophe,
  mergeVisualImeCompositionInputIntent,
  planProtectedFullwidthImeInsertion,
  planVisualImeCompositionUpdate,
  resolveVisualImeCompositionStartRange,
  shouldProtectVisualImeInput,
  synchronizeVisualEnvironmentNamesAfterComposition,
  visualImeCompositionInputIntent,
  visualEnvironmentNameSyncExtension,
  visualLatexEnvironmentIndentationExtension,
} from '../src/visualEditorCodeMirror';

import {
  EnlargeBracketPlan,
  LatexContext,
  SnippetDefinitionInput,
  SnippetMatcher,
  SnippetMatcherOptions,
  advanceAiDirtyReviewProgress,
  alignmentBoundaryLengthAt,
  aiIssueRangesOverlap,
  aiIssueMatchesCapturedIdentity,
  aiWritingLanguageLabel,
  aiProseSentenceSegments,
  compileSnippetFile,
  createLocalLatexPreviewDocument,
  createMathPreviewRenderInput,
  captureAiIssueIdentity,
  chooseAiIssueRetentionPreparation,
  choosePendingAiAutomaticReviewTarget,
  createAiIssueActionId,
  createLatexScanState,
  extractAiProseDocument,
  expandSnippetVariables,
  findVisualHeadingForLabel,
  findVisualLabelsInRange,
  findFractionNumerator,
  emptyMathDelimiterOffsets,
  isTeXLeafSourceUri,
  isAIWritingSourceUri,
  latexContextFromState,
  localLatexPreviewKind,
  materializeReplacement,
  optimisticRevisionStatus,
  parseReplacementTemplate,
  parseSnippetOptions,
  planAiIssueRetention,
  planAutoEnlarge,
  planAutoEnlargeAncestors,
  planLeftRightEnter,
  planTabout,
  planVisualAutoFraction,
  planVisualAlignTab,
  planVisualEnvironmentExit,
  planVisualEnvironmentNameSync,
  planVisualHiddenEnvironmentBoundaryBackspace,
  planVisualInlineStyleToggle,
  planVisualListEnter,
  planVisualLogicalLineNavigation,
  planVisualLeadingIndentation,
  planVisualLatexIndentationFormat,
  planVisualSelectionFraction,
  planVisualTextColorApply,
  prepareVisualFormulaAsset,
  selectVisualFormulaViewportBatch,
  resolveVisualBibliography,
  remapAiIssueOffsetRange,
  remapTabstopsForVsCode,
  replacementPartsToText,
  replacementPartsToCodeMirrorSnippet,
  vscodeSnippetToCodeMirrorSnippet,
  scanLatexContext,
  scanLatexRegions,
  scanLatexSegment,
  scanMathPreviewDocument,
  scanLatexProjectSource,
  scanVisualDocumentStructure,
  sanitizeLocalLatexSvg,
  shouldActivateVisualProviderCompletion,
  shouldRunVisualAutomaticSnippet,
  visualCompletedArgumentCursor,
  visualCompletionFollowUpCursor,
  visualLatexCompletionContextAt,
  visualSelectionTouchesSourceRange,
  visualSingleTextDifference,
  visualSourceRangeRemainsExpanded,
  visualTabTargetLeavesEnvironment,
  parseBibTeX,
  selectAiProseSentenceSegmentsForRanges,
  selectScopedResources,
  SerialTaskQueue,
  shouldReplaceAiIssueAfterReview,
  toPortableSnippetObject,
  tryReserveAiAutomaticReviewKey,
  validateMigratableSnippetLibraryText,
  validateSnippetFile,
  visualFormulaViewportsKeepPriority,
  visualReferenceDisplayLabel,
  visualSourceIndentationColumns,
  coalesceVisualLatexIndentationChanges,
} from '../src/core';
import {
  createSyncedSnippetEnvelope,
  decideSnippetSync,
  decodeSyncedSnippetEnvelope,
  hashSnippetContent,
} from '../src/snippetSync';
import {
  pairedVisualEnvironmentBoundaryReveal,
  selectionRetainsVisualStructureSourceReveal,
} from '../src/visualEditorStructureReveal';

test('visual provider completion treats commas as citation-only triggers', () => {
  assert.equal(shouldActivateVisualProviderCompletion({
    explicit: false,
    query: '',
    characterBefore: ',',
    inCitationContext: false,
  }), false);
  assert.equal(shouldActivateVisualProviderCompletion({
    explicit: false,
    query: '',
    characterBefore: ',',
    inCitationContext: true,
  }), true);
  assert.equal(shouldActivateVisualProviderCompletion({
    explicit: false,
    query: '\\r',
    characterBefore: 'r',
    inCitationContext: false,
  }), true);
  assert.equal(shouldActivateVisualProviderCompletion({
    explicit: false,
    query: '\\',
    characterBefore: '\\',
    inCitationContext: false,
  }), true);
  assert.equal(shouldActivateVisualProviderCompletion({
    explicit: true,
    query: '',
    characterBefore: ',',
    inCitationContext: false,
  }), true);
  assert.equal(shouldActivateVisualProviderCompletion({
    explicit: false,
    query: '',
    characterBefore: ' ',
    inCitationContext: true,
  }), true);
  assert.equal(shouldActivateVisualProviderCompletion({
    explicit: false,
    query: '',
    characterBefore: ' ',
    inCitationContext: false,
  }), false);
});

test('visual LaTeX completion context unifies commands and structured arguments', () => {
  assert.deepEqual(visualLatexCompletionContextAt('\\lab', 4), {
    kind: 'command',
    from: 0,
    to: 4,
    query: '\\lab',
  });

  const label = 'Text \\label{sec:int';
  assert.deepEqual(visualLatexCompletionContextAt(label, label.length), {
    kind: 'label-definition',
    from: label.indexOf('sec:int'),
    to: label.length,
    query: 'sec:int',
    command: 'label',
    argumentIndex: 1,
  });

  const reference = '\\eqref{eq:first,  eq:second';
  assert.deepEqual(visualLatexCompletionContextAt(reference, reference.length), {
    kind: 'reference',
    from: reference.indexOf('eq:second'),
    to: reference.length,
    query: 'eq:second',
    command: 'eqref',
    argumentIndex: 1,
  });

  const citation = '\\parencite[see]{known, zotero';
  assert.deepEqual(visualLatexCompletionContextAt(citation, citation.length), {
    kind: 'citation',
    from: citation.indexOf('zotero'),
    to: citation.length,
    query: 'zotero',
    command: 'parencite',
    argumentIndex: 2,
  });

  const environment = '\\begin{pro';
  assert.deepEqual(visualLatexCompletionContextAt(environment, environment.length), {
    kind: 'environment',
    from: environment.indexOf('pro'),
    to: environment.length,
    query: 'pro',
    command: 'begin',
    argumentIndex: 1,
  });

  const commandArgument = '\\includegraphics[width=.8\\textwidth]{figures/main';
  assert.deepEqual(
    visualLatexCompletionContextAt(commandArgument, commandArgument.length),
    {
      kind: 'argument',
      from: commandArgument.indexOf('figures/main'),
      to: commandArgument.length,
      query: 'figures/main',
      command: 'includegraphics',
      argumentIndex: 2,
    },
  );
});

test('visual LaTeX completion context remains bounded across wrapped arguments', () => {
  const source = [
    '\\eqref{',
    '  eq:first,',
    '  eq:wrapped',
  ].join('\n');
  const context = visualLatexCompletionContextAt(source, source.length);
  assert.equal(context.kind, 'reference');
  assert.equal(context.query, 'eq:wrapped');
  assert.equal(context.from, source.indexOf('eq:wrapped'));

  const ordinary = 'ordinary prose,';
  const ordinaryContext = visualLatexCompletionContextAt(ordinary, ordinary.length);
  assert.equal(ordinaryContext.kind, 'snippet');
  assert.equal(shouldActivateVisualProviderCompletion({
    explicit: false,
    query: ordinaryContext.query,
    characterBefore: ',',
    contextKind: ordinaryContext.kind,
  }), false);
});

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
    inTextCommandArgument: false,
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

test('text command arguments switch snippet modes and nest explicit math delimiters', () => {
  const matcher = matcherFor([
    {
      id: 'math-context-only',
      trigger: 'mctx',
      replacement: 'MATH',
      options: 'mA',
    },
    {
      id: 'text-context-only',
      trigger: 'tctx',
      replacement: 'TEXT',
      options: 'tA',
    },
  ]);
  const automaticMatch = (source: string) => {
    const context = scanLatexContext(source);
    return {
      context,
      match: matcher.match({
        textBefore: source,
        context,
        activation: 'auto',
      }),
    };
  };

  const mathOnlyInsideText = automaticMatch(String.raw`\[\text{mctx`);
  assert.equal(mathOnlyInsideText.context.mathMode, 'text');
  assert.equal(mathOnlyInsideText.context.inTextCommandArgument, true);
  assert.equal(mathOnlyInsideText.match, undefined);

  const textOnlyInsideText = automaticMatch(String.raw`\[\text{tctx`);
  assert.equal(textOnlyInsideText.context.mathMode, 'text');
  assert.equal(textOnlyInsideText.match?.snippet.id, 'text-context-only');

  const nestedText = automaticMatch(String.raw`\[\text{outer {nested {tctx`);
  assert.equal(nestedText.context.mathMode, 'text');
  assert.equal(nestedText.match?.snippet.id, 'text-context-only');

  const restoredOuterMath = automaticMatch(String.raw`\[\text{copy} mctx`);
  assert.equal(restoredOuterMath.context.mathMode, 'block');
  assert.equal(restoredOuterMath.context.inTextCommandArgument, false);
  assert.equal(restoredOuterMath.match?.snippet.id, 'math-context-only');
  const textOnlyAfterText = automaticMatch(String.raw`\[\text{copy} tctx`);
  assert.equal(textOnlyAfterText.context.mathMode, 'block');
  assert.equal(textOnlyAfterText.match, undefined);

  const explicitParenMath = automaticMatch(
    String.raw`\[\text{copy \(mctx`,
  );
  assert.equal(explicitParenMath.context.mathMode, 'inline');
  assert.equal(explicitParenMath.context.inTextCommandArgument, true);
  assert.equal(explicitParenMath.match?.snippet.id, 'math-context-only');
  const textAfterParenMath = automaticMatch(
    String.raw`\[\text{copy \(mctx\) tctx`,
  );
  assert.equal(textAfterParenMath.context.mathMode, 'text');
  assert.equal(textAfterParenMath.match?.snippet.id, 'text-context-only');
  const outerMathAfterParenText = automaticMatch(
    String.raw`\[\text{copy \(mctx\) tctx} mctx`,
  );
  assert.equal(outerMathAfterParenText.context.mathMode, 'block');
  assert.equal(outerMathAfterParenText.match?.snippet.id, 'math-context-only');

  const explicitDollarMath = automaticMatch(
    String.raw`\[\text{copy $mctx`,
  );
  assert.equal(explicitDollarMath.context.mathMode, 'inline');
  assert.equal(explicitDollarMath.match?.snippet.id, 'math-context-only');
  const textAfterDollarMath = automaticMatch(
    String.raw`\[\text{copy $mctx$ tctx`,
  );
  assert.equal(textAfterDollarMath.context.mathMode, 'text');
  assert.equal(textAfterDollarMath.match?.snippet.id, 'text-context-only');
});

test('text-argument command recognition is closed and exact', () => {
  const textArgumentCommands = [
    'text',
    'textrm',
    'textsf',
    'texttt',
    'textnormal',
    'textbf',
    'textmd',
    'textit',
    'textsl',
    'textsc',
    'textup',
    'emph',
    'mbox',
    'hbox',
    'intertext',
    'shortintertext',
  ] as const;
  for (const command of textArgumentCommands) {
    const context = scanLatexContext(`\\begin{align*}\\${command}{copy`);
    assert.equal(context.mathMode, 'text', `\\${command}`);
    assert.equal(context.inTextCommandArgument, true, `\\${command}`);
    assert.equal(context.matrixEnvironment, undefined, `\\${command}`);
  }

  for (const command of ['mathrm', 'operatorname', 'textual', 'unknown']) {
    const context = scanLatexContext(`\\[\\${command}{copy`);
    assert.equal(context.mathMode, 'block', `\\${command}`);
    assert.equal(context.inTextCommandArgument, false, `\\${command}`);
  }
});

test('text-argument frames preserve delimiters, opaque syntax, and incremental state', () => {
  assert.equal(scanLatexContext(String.raw`$outer \text{copy`).mathMode, 'text');
  assert.equal(
    scanLatexContext(String.raw`$outer \text{copy $inner`).mathMode,
    'inline',
  );
  assert.equal(
    scanLatexContext(String.raw`$outer \text{copy $inner$ tail`).mathMode,
    'text',
  );
  assert.equal(
    scanLatexContext(String.raw`$outer \text{copy $inner$ tail} outer`).mathMode,
    'inline',
  );
  assert.equal(
    scanLatexContext(String.raw`$outer \text{copy $inner$ tail} outer$`).mathMode,
    'text',
  );

  assert.equal(
    scanLatexContext(String.raw`\[\text{escaped \} \{ \$ tctx`).mathMode,
    'text',
  );
  assert.equal(
    scanLatexContext(`${String.raw`\[\text{copy % } $ ignored`}
tctx`).mathMode,
    'text',
  );
  assert.equal(
    scanLatexContext(String.raw`\[\text{\verb|}$| tctx`).mathMode,
    'text',
  );

  const labelInsideText = scanLatexContext(
    String.raw`\[\text{\label{eq:{x}} tctx`,
  );
  assert.equal(labelInsideText.mathMode, 'text');
  assert.equal(labelInsideText.inSnippetSuppressedArgument, false);
  const tagInsideText = scanLatexContext(
    String.raw`\[\text{\tag*{{x}} tctx`,
  );
  assert.equal(tagInsideText.mathMode, 'text');
  assert.equal(tagInsideText.inSnippetSuppressedArgument, false);
  const textCommandInsideLabel = scanLatexContext(
    String.raw`\[\label{\text{opaque}} mctx`,
  );
  assert.equal(textCommandInsideLabel.mathMode, 'block');
  assert.equal(textCommandInsideLabel.inSnippetSuppressedArgument, false);

  let state = scanLatexSegment(String.raw`\begin{align*}\text`);
  assert.equal(state.pendingTextArgument?.command, 'text');
  state = scanLatexSegment(' % comment with }\n', state, 20);
  assert.equal(state.pendingTextArgument?.command, 'text');
  state = scanLatexSegment('{outer {', state, 40);
  assert.equal(latexContextFromState(state).mathMode, 'text');
  assert.equal(state.textArguments.at(-1)?.braceDepth, 2);
  state = scanLatexSegment('nested}', state, 50);
  assert.equal(latexContextFromState(state).mathMode, 'text');
  assert.equal(state.textArguments.at(-1)?.braceDepth, 1);
  state = scanLatexSegment('} mctx', state, 60);
  assert.equal(latexContextFromState(state).mathMode, 'block');
  assert.equal(latexContextFromState(state).matrixEnvironment, 'align*');

  const alignText = scanLatexContext(
    String.raw`\begin{align*}\text{copy`,
  );
  assert.equal(alignText.mathMode, 'text');
  assert.equal(alignText.matrixEnvironment, undefined);
  const alignTextInnerMath = scanLatexContext(
    String.raw`\begin{align*}\text{copy \(x`,
  );
  assert.equal(alignTextInnerMath.mathMode, 'inline');
  assert.equal(
    alignTextInnerMath.matrixEnvironment,
    undefined,
    'an explicit inner formula is not an align cell',
  );
  const alignAfterText = scanLatexContext(
    String.raw`\begin{align*}\text{copy} x`,
  );
  assert.equal(alignAfterText.mathMode, 'block');
  assert.equal(alignAfterText.matrixEnvironment, 'align*');
});

test('full-region scanner keeps explicit text-argument math inside one outer region', () => {
  const text = String.raw`$outer \text{copy $inner$ tail} outer$`;
  assert.deepEqual(scanLatexRegions(text), [
    {
      outerStart: 0,
      innerStart: 1,
      innerEnd: text.length - 1,
      outerEnd: text.length,
      mode: 'inline',
      closed: true,
    },
  ]);
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
    String.raw`\begin{comment}$comment-hidden$\end{comment}`,
    String.raw`\begin{filecontents*}{generated.tex}$file-hidden$\end{filecontents*}`,
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

test('CodeMirror snippets preserve TeX braces and Snippet Leaf field order', () => {
  const encoded = replacementPartsToCodeMirrorSnippet([
      { kind: 'text', value: String.raw`\frac{` },
      { kind: 'tabstop', index: 0 },
      { kind: 'text', value: '}{' },
      { kind: 'tabstop', index: 1, placeholder: 'value' },
      { kind: 'text', value: '}' },
    ]);
  assert.equal(
    encoded.template,
    String.raw`\frac` + encoded.openBraceMarker + '${1}' +
      encoded.closeBraceMarker + encoded.openBraceMarker + '${2:value}' +
      encoded.closeBraceMarker,
  );
  const collision = replacementPartsToCodeMirrorSnippet([
      { kind: 'text', value: String.raw`\{x\}` },
      { kind: 'text', value: '\ue000\ue001' },
    ]);
  assert.notEqual(collision.openBraceMarker, '\ue000');
  assert.notEqual(collision.closeBraceMarker, '\ue001');
});

test('CodeMirror reports complete changed lines for incremental syntax invalidation', () => {
  const state = EditorState.create({ doc: 'plain text\nsecond line\nthird' });
  const singleLine = state.update({
    changes: { from: 6, to: 10, insert: String.raw`\binom{N}{2}` },
  });
  assert.deepEqual(changedDocumentLineRanges(singleLine), [
    { from: 0, to: singleLine.state.doc.line(1).to },
  ]);

  const multiline = singleLine.state.update({
    changes: {
      from: singleLine.state.doc.line(2).from + 6,
      insert: '\ninserted',
    },
  });
  assert.deepEqual(changedDocumentLineRanges(multiline), [{
    from: multiline.state.doc.line(2).from,
    to: multiline.state.doc.line(3).to,
  }]);
});

test('incremental syntax invalidation bounds native-token filtering to edited lines', () => {
  const state = EditorState.create({
    doc: 'alpha\nold formula\nomega',
  });
  const transaction = state.update({
    changes: { from: 10, to: 17, insert: String.raw`\binom{N}{2}` },
  });
  const ranges = changedDocumentLineRanges(transaction);
  const changedLine = ranges[0];
  assert.ok(changedLine);
  const filter = changedDocumentLineFilter(ranges);
  assert.ok(filter);
  assert.deepEqual(
    { from: filter.filterFrom, to: filter.filterTo },
    changedLine,
  );
  assert.equal(filter.filter(0, 5), true, 'a token before the edited line is retained');
  assert.equal(
    filter.filter(changedLine.from, changedLine.from + 6),
    false,
    'a stale token on the edited line is removed',
  );
  assert.equal(
    filter.filter(changedLine.to + 1, transaction.state.doc.length),
    true,
    'a token after the edited line is retained',
  );
});

test('CodeMirror applies encoded LaTeX snippets and advances real fields', () => {
  let state = EditorState.create({ doc: 'before xx after' });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  } as unknown as EditorView;
  const encoding = replacementPartsToCodeMirrorSnippet([
    { kind: 'text', value: String.raw`\frac{` },
    { kind: 'tabstop', index: 0, placeholder: 'x' },
    { kind: 'text', value: '}{' },
    { kind: 'tabstop', index: 1, placeholder: 'y' },
    { kind: 'text', value: '}' },
  ]);
  const applied = applyAtomicCodeMirrorSnippet(view, {
    template: encoding.template,
    completion: null,
    from: 7,
    to: 9,
    openBraceMarker: encoding.openBraceMarker,
    closeBraceMarker: encoding.closeBraceMarker,
  });
  assert.equal(state.doc.toString(), String.raw`before \frac{x}{y} after`);
  assert.equal(state.doc.toString().includes(encoding.openBraceMarker), false);
  assert.equal(state.doc.toString().includes(encoding.closeBraceMarker), false);
  assert.equal(state.sliceDoc(applied.exit, applied.exit + 6), ' after');
  assert.equal(state.sliceDoc(state.selection.main.from, state.selection.main.to), 'x');
  assert.equal(nextSnippetField(view), true);
  assert.equal(state.sliceDoc(state.selection.main.from, state.selection.main.to), 'y');
});

test('CodeMirror retains a lone final cursor for nested snippet traversal', () => {
  let state = EditorState.create({ doc: 'lm' });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  } as unknown as EditorView;
  const encoding = replacementPartsToCodeMirrorSnippet([
    { kind: 'text', value: String.raw`\(` },
    { kind: 'tabstop', index: 0 },
    { kind: 'text', value: String.raw`\)` },
  ]);
  const applied = applyAtomicCodeMirrorSnippet(view, {
    template: encoding.template,
    completion: null,
    from: 0,
    to: 2,
    openBraceMarker: encoding.openBraceMarker,
    closeBraceMarker: encoding.closeBraceMarker,
  });

  assert.equal(state.doc.toString(), String.raw`\(\)`);
  assert.deepEqual(applied.fields, [{ field: 0, from: 2, to: 2 }]);
  assert.equal(applied.exit, 4);
});

test('literal CodeMirror completions do not leave a synthetic snippet field', () => {
  let state = EditorState.create({ doc: 'eq:old' });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  } as unknown as EditorView;
  const encoding = replacementPartsToCodeMirrorSnippet([
    { kind: 'text', value: 'eq:new' },
  ]);
  const applied = applyAtomicCodeMirrorSnippet(view, {
    template: encoding.template,
    completion: { label: 'eq:new' },
    from: 0,
    to: state.doc.length,
    openBraceMarker: encoding.openBraceMarker,
    closeBraceMarker: encoding.closeBraceMarker,
    retainLoneFinalCursor: false,
  });

  assert.equal(state.doc.toString(), 'eq:new');
  assert.deepEqual(applied.fields, []);
});

test('structured argument completions preserve pending citation action context', () => {
  const reference = String.raw`\eqref{eq:old}`;
  const referenceFrom = reference.indexOf('eq:old');
  const referenceTo = reference.indexOf('}');
  assert.equal(
    visualCompletedArgumentCursor(
      reference,
      referenceFrom,
      referenceTo,
      'eq:new',
    ),
    referenceFrom + 'eq:new'.length + 1,
  );

  const citation = String.raw`\cite{old}`;
  assert.equal(
    visualCompletedArgumentCursor(
      citation,
      citation.indexOf('old'),
      citation.indexOf('}'),
      'new-key',
    ),
    citation.indexOf('old') + 'new-key'.length + 1,
  );
  assert.equal(
    visualCompletedArgumentCursor(
      citation,
      citation.indexOf('old'),
      citation.indexOf('}'),
      'new-key',
      { completionActionPending: true },
    ),
    undefined,
    'a citation follow-up must retain the natural caret before the closing brace',
  );
  assert.equal(
    visualCompletionFollowUpCursor(
      citation,
      citation.indexOf('old'),
      'old',
    ),
    citation.indexOf('}'),
    'the provider follow-up must use the validated insertion end inside the citation',
  );
  assert.equal(
    visualCompletionFollowUpCursor(
      citation,
      citation.indexOf('old'),
      'tampered',
    ),
    undefined,
    'a stale or tampered action must not recover a caret from unrelated UI selection',
  );

  const label = String.raw`\label{old-label}`;
  assert.equal(
    visualCompletedArgumentCursor(
      label,
      label.indexOf('old-label'),
      label.indexOf('}'),
      'sec:new',
    ),
    label.indexOf('old-label') + 'sec:new'.length + 1,
  );
  assert.equal(
    visualCompletedArgumentCursor(String.raw`\textbf{old}`, 8, 11, 'new'),
    undefined,
  );
});

test('authoritative document sync maps citation carets through the minimal change', () => {
  const before = String.raw`\cite{sato}`;
  const after = String.raw`\cite{satoSolitonEquationsDynamical1981}`;
  const change = visualSingleTextDifference(before, after);
  assert.deepEqual(change, {
    from: before.indexOf('}'),
    to: before.indexOf('}'),
    insert: 'SolitonEquationsDynamical1981',
  });

  const citationCaret = before.indexOf('}');
  const state = EditorState.create({
    doc: before,
    selection: EditorSelection.cursor(citationCaret),
  });
  const citationChanges = state.changes(change!);
  const synchronized = state.update({
    changes: citationChanges,
    selection: state.selection.map(citationChanges, 1),
  }).state;
  assert.equal(synchronized.doc.toString(), after);
  assert.equal(
    synchronized.selection.main.head,
    after.indexOf('}'),
    'a query-end caret must follow a longer imported citation key',
  );

  const moved = EditorState.create({
    doc: before,
    selection: EditorSelection.cursor(0),
  });
  const movedChanges = moved.changes(change!);
  const movedSynchronized = moved.update({
    changes: movedChanges,
    selection: moved.selection.map(movedChanges, 1),
  }).state;
  assert.equal(
    movedSynchronized.selection.main.head,
    0,
    'a caret moved elsewhere during an async import must not be pulled back',
  );
  assert.equal(visualSingleTextDifference(after, after), undefined);
});

test('theorem begin and end controls reveal the same paired source boundaries', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\begin{lemma}
Body.
\end{lemma}
\end{document}`;
  const lemma = scanVisualDocumentStructure(source).records.find(
    (record): record is VisualTheoremRecord =>
      record.kind === 'theorem' && record.environment === 'lemma',
  );
  assert.ok(lemma !== undefined);
  const expected = {
    ranges: [
      { from: lemma.begin.sourceFrom, to: lemma.begin.sourceTo },
      { from: lemma.end.sourceFrom, to: lemma.end.sourceTo },
    ],
    scopeFrom: lemma.begin.sourceFrom,
    scopeTo: lemma.end.sourceTo,
    retention: 'boundary-lines' as const,
  };

  assert.deepEqual(
    pairedVisualEnvironmentBoundaryReveal(
      lemma,
      lemma.begin.sourceFrom,
      lemma.begin.sourceTo,
    ),
    expected,
  );
  assert.deepEqual(
    pairedVisualEnvironmentBoundaryReveal(
      lemma,
      lemma.end.sourceFrom,
      lemma.end.sourceTo,
    ),
    expected,
  );
  assert.equal(
    source.slice(lemma.end.sourceFrom, lemma.end.sourceTo).includes('\\end{lemma}'),
    true,
  );
  assert.equal(
    pairedVisualEnvironmentBoundaryReveal(lemma, lemma.bodyFrom, lemma.bodyTo),
    undefined,
  );
});

test('inline citation source restores on the closing-brace boundary while environment boundaries retain their lines', () => {
  const source = 'Before \\cite{key} and prose.\n\\begin{lemma}[Named]\nBody\n\\end{lemma}';
  const document = EditorState.create({ doc: source }).doc;
  const citeFrom = source.indexOf('\\cite');
  const citeTo = source.indexOf('}', citeFrom) + 1;
  const exactReveal = {
    ranges: [{ from: citeFrom, to: citeTo }],
    scopeFrom: citeFrom,
    scopeTo: citeTo,
    retention: 'exact-range' as const,
  };
  const lineNumberAt = (position: number): number =>
    document.lineAt(Math.max(0, Math.min(document.length, position))).number;

  assert.equal(
    selectionRetainsVisualStructureSourceReveal(
      exactReveal,
      [{ from: citeTo - 1, to: citeTo - 1 }],
      lineNumberAt,
    ),
    true,
    'a caret before the closing brace still edits the citation source',
  );
  assert.equal(
    selectionRetainsVisualStructureSourceReveal(
      exactReveal,
      [{ from: citeTo, to: citeTo }],
      lineNumberAt,
    ),
    false,
    'crossing the closing brace restores the citation on the same physical line',
  );
  assert.equal(
    selectionRetainsVisualStructureSourceReveal(
      exactReveal,
      [{ from: citeTo + 5, to: citeTo + 5 }],
      lineNumberAt,
    ),
    false,
  );

  const beginLine = document.line(2);
  const endLine = document.line(4);
  const boundaryReveal = {
    ranges: [
      { from: beginLine.from, to: source.indexOf('}', beginLine.from) + 1 },
      { from: endLine.from, to: endLine.to },
    ],
    scopeFrom: beginLine.from,
    scopeTo: endLine.to,
    retention: 'boundary-lines' as const,
  };
  assert.equal(
    selectionRetainsVisualStructureSourceReveal(
      boundaryReveal,
      [{ from: beginLine.to, to: beginLine.to }],
      lineNumberAt,
    ),
    true,
    'optional text on the begin boundary line keeps paired source exposed',
  );
  const bodyLine = document.line(3);
  assert.equal(
    selectionRetainsVisualStructureSourceReveal(
      boundaryReveal,
      [{ from: bodyLine.from, to: bodyLine.from }],
      lineNumberAt,
    ),
    false,
    'moving into the environment body restores the paired visual boundary',
  );
});

test('citation detail follows the exact visual source expansion state', () => {
  const from = 12;
  const to = 26;
  const caret = (head: number) => [{ from: head, to: head, head }];

  assert.equal(visualSelectionTouchesSourceRange(caret(from + 1), from, to), true);
  assert.equal(visualSelectionTouchesSourceRange(caret(to - 1), from, to), true);
  assert.equal(
    visualSelectionTouchesSourceRange(caret(from), from, to),
    false,
    'the exact opening boundary is not an interior citation selection',
  );
  assert.equal(
    visualSelectionTouchesSourceRange(caret(to), from, to),
    false,
    'the exact right boundary is not an interior citation selection',
  );
  assert.equal(
    visualSelectionTouchesSourceRange(
      [{ from: from - 2, to: from + 2, head: from + 2 }],
      from,
      to,
    ),
    true,
    'a real selection overlapping citation source keeps it expanded',
  );
  assert.equal(
    visualSelectionTouchesSourceRange(
      [{ from: to, to: to + 4, head: to + 4 }],
      from,
      to,
    ),
    false,
  );
  assert.equal(
    visualSourceRangeRemainsExpanded(caret(to), [{ from, to }], from, to),
    true,
    'a manual reveal keeps the detail while the citation source is still visible',
  );
  assert.equal(
    visualSourceRangeRemainsExpanded(caret(to + 1), [], from, to),
    false,
    'the detail closes exactly when the citation source collapses to its chip',
  );
});

test('full-width IME punctuation cannot replace existing LaTeX structure', () => {
  const source = String.raw`\[\sum_{i=1}^{n-1}`;
  assert.deepEqual(
    planProtectedFullwidthImeInsertion(
      source,
      source.length,
      source.length,
      0,
      source.length,
      '（',
    ),
    {
      from: source.length,
      to: source.length,
      insert: '（',
      cursor: source.length + 1,
    },
  );

  const provisional = `${source}(`;
  assert.deepEqual(
    planProtectedFullwidthImeInsertion(
      provisional,
      provisional.length,
      provisional.length,
      0,
      provisional.length,
      '（',
    ),
    {
      from: provisional.length - 1,
      to: provisional.length,
      insert: '（',
      cursor: provisional.length,
    },
  );
  assert.equal(
    planProtectedFullwidthImeInsertion(source, 0, source.length, 0, source.length, '（'),
    undefined,
    'a real selected replacement must remain under the editor/IME contract',
  );
  assert.deepEqual(
    planProtectedFullwidthImeInsertion(
      source,
      source.length,
      source.length,
      0,
      source.length,
      '中文候选',
    ),
    {
      from: source.length,
      to: source.length,
      insert: '中文候选',
      cursor: source.length + '中文候选'.length,
    },
    'an IME candidate must not erase braces even when Chromium reports a stale broad range',
  );
});

test('native Chinese IME composition remains local while candidates update', () => {
  const source = String.raw`说明：\begin{proof}
正文。
\end{proof}`;
  const caret = source.indexOf('：') + 1;
  const first = planVisualImeCompositionUpdate(
    source,
    caret,
    caret,
    caret,
    caret,
    'n',
    'n',
  );
  assert.deepEqual(first, {
    from: caret,
    to: caret,
    insert: 'n',
    cursor: caret + 1,
    reportedChangeIsSafe: true,
  });

  const provisional = source.slice(0, caret) + 'n' + source.slice(caret);
  const second = planVisualImeCompositionUpdate(
    provisional,
    caret,
    caret + 1,
    caret,
    caret + 1,
    'ni',
    'ni',
  );
  assert.deepEqual(second, {
    from: caret,
    to: caret + 1,
    insert: 'ni',
    cursor: caret + 2,
    reportedChangeIsSafe: true,
  });

  const selected = planVisualImeCompositionUpdate(
    'Replace old text.',
    8,
    11,
    8,
    11,
    '中文',
    '中文',
  );
  assert.equal(selected?.reportedChangeIsSafe, true);
  assert.equal(
    'Replace old text.'.slice(0, selected?.from) +
      selected?.insert +
      'Replace old text.'.slice(selected?.to),
    'Replace 中文 text.',
    'normal IME replacement of a real selection must remain available',
  );
});

test('Chinese IME composition starts from the last stable formula caret', () => {
  const source = String.raw`A concise abstract with \(x^2+y^2\).`;
  const formulaFrom = source.indexOf(String.raw`\(`);
  const formulaTo = source.indexOf(String.raw`\)`) + 2;
  const caret = source.indexOf(String.raw`\)`, formulaFrom);

  const range = resolveVisualImeCompositionStartRange(
    source.length,
    formulaFrom + 1,
    formulaTo - 1,
    caret,
    caret,
  );
  assert.deepEqual(
    range,
    { from: caret, to: caret },
    'a transient formula-wide DOM selection must not replace the source',
  );

  const first = planVisualImeCompositionUpdate(
    source,
    range!.from,
    range!.to,
    formulaFrom + 1,
    formulaTo - 1,
    String.raw`\s)`,
    's',
  );
  assert.deepEqual(first, {
    from: caret,
    to: caret,
    insert: 's',
    cursor: caret + 1,
    reportedChangeIsSafe: false,
  });
  const provisional = source.slice(0, first!.from) + first!.insert +
    source.slice(first!.to);
  assert.equal(
    provisional,
    String.raw`A concise abstract with \(x^2+y^2s\).`,
  );

  const backspace = planVisualImeCompositionUpdate(
    provisional,
    caret,
    caret + 1,
    formulaFrom + 1,
    formulaTo,
    String.raw`\)`,
    's',
    'deleteBackward',
  );
  assert.equal(
    provisional.slice(0, backspace!.from) + backspace!.insert +
      provisional.slice(backspace!.to),
    source,
    'Backspace must restore the exact formula after the protected first letter',
  );
});

test('a clicked formula caret beats a transient broad IME selection', () => {
  const source = String.raw`A concise abstract with \(x^2+y^2\).`;
  const formulaFrom = source.indexOf(String.raw`\(`);
  const formulaTo = source.indexOf(String.raw`\)`) + 2;
  const caret = source.indexOf(String.raw`\)`, formulaFrom);

  assert.deepEqual(
    resolveVisualImeCompositionStartRange(
      source.length,
      formulaFrom,
      formulaTo,
      formulaFrom,
      formulaTo,
      caret,
    ),
    { from: caret, to: caret },
    'the exact pointer-derived source caret must outrank a formula-wide DOM selection',
  );
});

test('an untrusted broad formula selection becomes a lossless right-edge caret', () => {
  const source = String.raw`A concise abstract with \(x^2+y^2\).`;
  const formulaFrom = source.indexOf(String.raw`\(`);
  const formulaEnd = source.indexOf(String.raw`\)`);
  const suffixFrom = source.indexOf('+y^2', formulaFrom);

  const range = resolveVisualImeCompositionStartRange(
    source.length,
    suffixFrom,
    formulaEnd,
    0,
    0,
  );
  assert.deepEqual(range, { from: formulaEnd, to: formulaEnd });

  const first = planVisualImeCompositionUpdate(
    source,
    range!.from,
    range!.to,
    suffixFrom,
    formulaEnd,
    's',
    's',
  );
  assert.ok(first !== undefined);
  assert.equal(first.reportedChangeIsSafe, false);
  assert.equal(
    source.slice(0, first.from) + first.insert + source.slice(first.to),
    String.raw`A concise abstract with \(x^2+y^2s\).`,
    'the first Pinyin letter must append at the caret without replacing +y^2',
  );
});

test('a current collapsed caret is used after navigation invalidates the pointer snapshot', () => {
  assert.deepEqual(
    resolveVisualImeCompositionStartRange(100, 75, 75, 10, 20),
    { from: 75, to: 75 },
  );
});

test('a fresh pre-composition pointer outranks lagging collapsed state and DOM carets', () => {
  assert.deepEqual(
    resolveVisualImeCompositionStartRange(100, 30, 30, 30, 30, 75, 30),
    { from: 75, to: 75 },
  );
});

test('the compositionstart DOM caret outranks a lagging collapsed editor selection', () => {
  const source = String.raw`A concise abstract with \(x^2+y^2\).`;
  const staleEditorCaret = source.indexOf('x^2') + 'x^2'.length;
  const nativeDomCaret = source.indexOf(String.raw`\)`);

  assert.deepEqual(
    resolveVisualImeCompositionStartRange(
      source.length,
      staleEditorCaret,
      staleEditorCaret,
      staleEditorCaret,
      staleEditorCaret,
      undefined,
      nativeDomCaret,
    ),
    { from: nativeDomCaret, to: nativeDomCaret },
    'the first Pinyin letter must start at the visible source caret rather than a stale CodeMirror caret',
  );
});

test('Microsoft Pinyin candidate deletion never crosses the original formula boundary', () => {
  const original = String.raw`A concise abstract with \(x^2+y^2\).`;
  const caret = original.indexOf(String.raw`\)`);
  let source = original;
  let candidate = '';

  for (const next of ['s', "s's", "s's's"]) {
    const plan = planVisualImeCompositionUpdate(
      source,
      caret,
      caret + candidate.length,
      0,
      source.length,
      'malformed formula-wide DOM snapshot',
      next,
    );
    assert.ok(plan !== undefined);
    source = source.slice(0, plan.from) + plan.insert + source.slice(plan.to);
    candidate = next;
    assert.equal(source, original.slice(0, caret) + candidate + original.slice(caret));
  }

  for (const next of ["s's'", "s's", "s'", 's', '']) {
    const plan = planVisualImeCompositionUpdate(
      source,
      caret,
      caret + candidate.length,
      0,
      source.length,
      'malformed formula-wide DOM snapshot',
      candidate,
      'deleteBackward',
    );
    assert.ok(plan !== undefined);
    source = source.slice(0, plan.from) + plan.insert + source.slice(plan.to);
    candidate = next;
    assert.equal(
      source,
      original.slice(0, caret) + candidate + original.slice(caret),
      'each Backspace may shorten only the provisional Pinyin candidate',
    );
  }

  const duplicateEmptyBackspace = planVisualImeCompositionUpdate(
    source,
    caret,
    caret,
    caret - 3,
    caret,
    '',
    '',
    'deleteBackward',
  );
  assert.ok(duplicateEmptyBackspace !== undefined);
  assert.equal(
    source.slice(0, duplicateEmptyBackspace.from) +
      duplicateEmptyBackspace.insert +
      source.slice(duplicateEmptyBackspace.to),
    original,
    'a duplicate Backspace event after the candidate reaches empty must not consume +y^2',
  );
});

test('Chinese IME composition preserves a genuine stable text selection', () => {
  const source = 'Replace old text.';
  assert.deepEqual(
    resolveVisualImeCompositionStartRange(
      source.length,
      0,
      source.length,
      8,
      11,
    ),
    { from: 8, to: 11 },
  );
  assert.deepEqual(
    resolveVisualImeCompositionStartRange(source.length, 8, 11),
    { from: 11, to: 11 },
    'an unverified current range is collapsed instead of replacing existing text',
  );
});

test('Chinese IME candidate Backspace beats stale compositionupdate text', () => {
  const source = '前缀ni后缀';
  const from = source.indexOf('ni');
  const plan = planVisualImeCompositionUpdate(
    source,
    from,
    from + 2,
    from + 1,
    from + 2,
    '',
    'ni',
  );
  assert.deepEqual(plan, {
    from,
    to: from + 2,
    insert: 'n',
    cursor: from + 1,
    reportedChangeIsSafe: true,
  });
  assert.equal(
    source.slice(0, plan?.from) + plan?.insert + source.slice(plan?.to),
    '前缀n后缀',
  );
});

test('Chinese IME Backspace removes a provisional letter when Chromium reports a local no-op', () => {
  const source = String.raw`\(x^2+y^2s\)`;
  const from = source.indexOf('s');
  const plan = planVisualImeCompositionUpdate(
    source,
    from,
    from + 1,
    from + 1,
    from + 1,
    '',
    's',
    'deleteBackward',
  );
  assert.deepEqual(plan, {
    from,
    to: from + 1,
    insert: '',
    cursor: from,
    reportedChangeIsSafe: false,
  });
  assert.equal(
    source.slice(0, plan?.from) + plan?.insert + source.slice(plan?.to),
    String.raw`\(x^2+y^2\)`,
  );
});

test('Chinese IME Backspace still trusts a genuinely shrinking local replacement', () => {
  const source = '前缀ni后缀';
  const from = source.indexOf('ni');
  const plan = planVisualImeCompositionUpdate(
    source,
    from,
    from + 2,
    from + 1,
    from + 2,
    '',
    'ni',
    'deleteBackward',
  );
  assert.equal(plan?.insert, 'n');
  assert.equal(plan?.cursor, from + 1);
  assert.equal(plan?.reportedChangeIsSafe, true);
});

test('Chinese IME deletion intent follows beforeinput before CodeMirror fallback', () => {
  assert.equal(
    visualImeCompositionInputIntent('deleteContentBackward', undefined),
    'deleteBackward',
  );
  assert.equal(
    visualImeCompositionInputIntent('deleteCompositionText', undefined),
    'cancelComposition',
  );
  assert.equal(
    visualImeCompositionInputIntent(undefined, 'delete.backward'),
    'deleteBackward',
  );
  assert.equal(
    visualImeCompositionInputIntent('insertCompositionText', 'input.type.compose'),
    undefined,
  );
});

test('Chinese IME Backspace intent survives a later insertion notification', () => {
  let pending = mergeVisualImeCompositionInputIntent(
    undefined,
    'deleteContentBackward',
    undefined,
  );
  pending = mergeVisualImeCompositionInputIntent(
    pending,
    'insertCompositionText',
    undefined,
  );
  assert.equal(
    pending,
    'deleteBackward',
    'a trailing candidate update must not hide the Backspace that initiated the DOM mutation',
  );
  assert.equal(
    mergeVisualImeCompositionInputIntent(
      pending,
      'deleteCompositionText',
      undefined,
    ),
    'cancelComposition',
    'composition cancellation remains stronger than one backward deletion',
  );
});

test('broad Chinese IME Backspace cannot reinsert a stale candidate', () => {
  const latex = String.raw`\begin{align*}
  & = \frac{1}{2}\sum_{k=0}^{g-2-n}K_{1^{n-1}}(1+k,g-1-n-k)
\end{align*}`;
  const caret = latex.indexOf('\n\\end{align*}');
  const source = latex.slice(0, caret) + 's' + latex.slice(caret);
  const corruptedDomText = source
    .replace(String.raw`\frac{1}{2}`, String.raw`\frac{1}2`)
    .replace('s', '');
  const plan = planVisualImeCompositionUpdate(
    source,
    caret,
    caret + 1,
    0,
    source.length,
    corruptedDomText,
    's',
    'deleteBackward',
  );
  assert.deepEqual(plan, {
    from: caret,
    to: caret + 1,
    insert: '',
    cursor: caret,
    reportedChangeIsSafe: false,
  });
  assert.equal(
    source.slice(0, plan?.from) + plan?.insert + source.slice(plan?.to),
    latex,
    'Backspace must remove the candidate without accepting the broad DOM corruption',
  );
});

test('broad Chinese IME Backspace deletes one Unicode code point at a time', () => {
  const source = '前缀ni后缀';
  const from = source.indexOf('ni');
  const plan = planVisualImeCompositionUpdate(
    source,
    from,
    from + 2,
    0,
    source.length,
    'corrupted DOM snapshot',
    'ni',
    'deleteBackward',
  );
  assert.equal(plan?.insert, 'n');
  assert.equal(plan?.cursor, from + 1);

  const emojiSource = '前缀😀后缀';
  const emojiFrom = emojiSource.indexOf('😀');
  const emojiPlan = planVisualImeCompositionUpdate(
    emojiSource,
    emojiFrom,
    emojiFrom + '😀'.length,
    0,
    emojiSource.length,
    'corrupted DOM snapshot',
    '😀',
    'deleteBackward',
  );
  assert.equal(emojiPlan?.insert, '');
  assert.equal(emojiPlan?.cursor, emojiFrom);
});

test('ordinary input immediately after compositionend bypasses stale IME state', () => {
  assert.equal(
    shouldProtectVisualImeInput(true, true, true, 'delete.backward'),
    false,
    'Backspace after committed Chinese text must remain an ordinary deletion',
  );
  assert.equal(
    shouldProtectVisualImeInput(true, true, true, 'input.type'),
    false,
    'letters typed after compositionend must not extend the stale candidate',
  );
  assert.equal(
    shouldProtectVisualImeInput(true, true, true, 'input.type.compose'),
    true,
    'the browser final compose transaction still needs structural protection',
  );
  assert.equal(
    shouldProtectVisualImeInput(true, false, true, 'delete.backward'),
    true,
    'Backspace while the candidate window is genuinely open remains IME input',
  );
});

test('malformed Chinese IME DOM diffs cannot erase nested LaTeX structure', () => {
  const source = String.raw`\begin{align*}
  \Delta' &= \Delta(1^{n-1};1,g-1-n) \\
  & = \frac{1}{2}\sum_{k=0}^{g-2-n}K_{1^{n-1}}(1+k,g-1-n-k) \\
  & \geq \frac{1}{2}\sum_{k=0}^{g-2-n}\frac{1}{K_{1^{n-1}}(1+k)}
\end{align*}`;
  const caret = source.indexOf('\n\\end{align*}');
  const corruptedDomText = source
    .replace(String.raw`\begin{align*}`, String.raw`\begin
align*}`)
    .replace(String.raw`\frac{1}{K_`, String.raw`\frac{1}K_`) +
    'n';
  const insert = planVisualImeCompositionUpdate(
    source,
    caret,
    caret,
    0,
    source.length,
    corruptedDomText,
    'n',
  );
  assert.equal(insert?.reportedChangeIsSafe, false);
  assert.equal(insert?.from, caret);
  assert.equal(insert?.to, caret);
  assert.equal(insert?.insert, 'n');

  const provisional = source.slice(0, caret) + 'n' + source.slice(caret);
  const cancel = planVisualImeCompositionUpdate(
    provisional,
    caret,
    caret + 1,
    0,
    provisional.length,
    provisional.replace(String.raw`\begin{align*}`, String.raw`\begin
align*}`).replace('n', ''),
    '',
  );
  assert.equal(cancel?.reportedChangeIsSafe, false);
  assert.equal(
    provisional.slice(0, cancel?.from) +
      cancel?.insert +
      provisional.slice(cancel?.to),
    source,
    'Backspace/candidate cancellation must restore the exact pre-composition source',
  );
  assert.equal(
    planVisualImeCompositionUpdate(source, caret, caret, 0, source.length, '{', undefined),
    undefined,
    'a broad structural update without composition text must be rejected',
  );
});

test('tracked math pairs leave a nested fraction numerator before its denominator', () => {
  let state = EditorState.create({
    doc: String.raw`\(//\)`,
    selection: { anchor: 2 },
    extensions: [history(), closeBrackets()],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  } as unknown as EditorView;
  const fraction = replacementPartsToCodeMirrorSnippet([
    { kind: 'text', value: String.raw`\frac{` },
    { kind: 'tabstop', index: 0 },
    { kind: 'text', value: '}{' },
    { kind: 'tabstop', index: 1 },
    { kind: 'text', value: '}' },
    { kind: 'tabstop', index: 2 },
  ]);
  applyAtomicCodeMirrorSnippet(view, {
    template: fraction.template,
    completion: null,
    from: 2,
    to: 4,
    openBraceMarker: fraction.openBraceMarker,
    closeBraceMarker: fraction.closeBraceMarker,
  });

  const openPair = insertBracket(state, '(');
  assert.notEqual(openPair, null);
  view.dispatch(openPair!);
  view.dispatch(state.update({
    changes: { from: state.selection.main.head, insert: '2' },
    selection: EditorSelection.cursor(state.selection.main.head + 1),
    userEvent: 'input.type',
  }));
  assert.equal(state.doc.toString(), String.raw`\(\frac{(2)}{}\)`);

  const closePair = insertBracket(state, ')');
  assert.notEqual(closePair, null);
  view.dispatch(closePair!);
  assert.equal(state.sliceDoc(state.selection.main.head - 3, state.selection.main.head), '(2)');
  assert.equal(nextSnippetField(view), true);
  assert.equal(
    state.selection.main.head,
    state.doc.toString().indexOf('}{') + 2,
    'the second Tab must enter the denominator, not stop before its opening brace',
  );
});

test('math apostrophes are literal primes rather than auto-paired prose quotes', () => {
  let state = EditorState.create({
    doc: String.raw`\(x\)`,
    selection: { anchor: 3 },
    extensions: [history(), closeBrackets()],
  });
  const target = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  };

  assert.equal(insertLiteralMathApostrophe(target), true);
  assert.equal(state.doc.toString(), String.raw`\(x'\)`);
  assert.equal(insertLiteralMathApostrophe(target), true);
  assert.equal(state.doc.toString(), String.raw`\(x''\)`);

  state = EditorState.create({
    doc: 'prose',
    selection: { anchor: 5 },
    extensions: [history(), closeBrackets()],
  });
  assert.equal(insertLiteralMathApostrophe(target), false);
  assert.equal(state.doc.toString(), 'prose');
});

test('CodeMirror snippet undo removes TeX wrappers and braces atomically', () => {
  let state = EditorState.create({
    doc: 'first case',
    extensions: [history()],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  } as unknown as EditorView;
  const encoding = replacementPartsToCodeMirrorSnippet([
    { kind: 'text', value: String.raw`\emph{` },
    { kind: 'tabstop', index: 0, placeholder: 'first case' },
    { kind: 'text', value: '}' },
  ]);

  applyAtomicCodeMirrorSnippet(view, {
    template: encoding.template,
    completion: { label: 'TeXLeaf toolbar' },
    from: 0,
    to: state.doc.length,
    openBraceMarker: encoding.openBraceMarker,
    closeBraceMarker: encoding.closeBraceMarker,
  });
  assert.equal(state.doc.toString(), String.raw`\emph{first case}`);
  assert.equal(undo(view), true);
  assert.equal(state.doc.toString(), 'first case');
});

test('CodeMirror reports its exact normalized multiline snippet transaction', () => {
  const original = String.raw`before
  \thm
after`;
  const originalState = EditorState.create({ doc: original });
  let state = EditorState.create({
    doc: original,
    extensions: [history(), indentUnit.of('  ')],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  } as unknown as EditorView;
  const encoding = replacementPartsToCodeMirrorSnippet([
    { kind: 'text', value: String.raw`\begin{theorem}
  ` },
    { kind: 'tabstop', index: 0, placeholder: 'Statement.' },
    { kind: 'text', value: String.raw`
\end{theorem}` },
  ]);
  const from = original.indexOf(String.raw`\thm`);
  const applied = applyAtomicCodeMirrorSnippet(view, {
    template: encoding.template,
    completion: { label: String.raw`\thm` },
    from,
    to: from + String.raw`\thm`.length,
    openBraceMarker: encoding.openBraceMarker,
    closeBraceMarker: encoding.closeBraceMarker,
  });

  const mirrored = originalState.update({ changes: applied.changes }).state.doc.toString();
  assert.equal(mirrored, state.doc.toString());
  assert.equal(mirrored, String.raw`before
  \begin{theorem}
    Statement.
  \end{theorem}
after`);
  assert.equal(
    state.sliceDoc(state.selection.main.from, state.selection.main.to),
    'Statement.',
  );
  assert.equal(undo(view), true);
  assert.equal(state.doc.toString(), original);
});

test('CodeMirror snippet undo restores its trigger with the caret at trigger end', () => {
  let state = EditorState.create({
    doc: 'lm',
    selection: { anchor: 2 },
    extensions: [history()],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  } as unknown as EditorView;
  const encoding = replacementPartsToCodeMirrorSnippet([
    { kind: 'text', value: String.raw`\(` },
    { kind: 'tabstop', index: 0 },
    { kind: 'text', value: String.raw`\)` },
  ]);

  applyAtomicCodeMirrorSnippet(view, {
    template: encoding.template,
    completion: { label: 'lm' },
    from: 0,
    to: 2,
    openBraceMarker: encoding.openBraceMarker,
    closeBraceMarker: encoding.closeBraceMarker,
  });
  assert.equal(state.doc.toString(), String.raw`\(\)`);
  assert.equal(undo(view), true);
  assert.equal(state.doc.toString(), 'lm');
  assert.equal(state.selection.main.head, 2);
});

test('CodeMirror locally indents nested multiline environment snippets atomically', () => {
  const original = String.raw`\begin{proof}
    nest
\end{proof}`;
  let state = EditorState.create({
    doc: original,
    extensions: [history(), indentUnit.of('  ')],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  } as unknown as EditorView;
  const encoding = replacementPartsToCodeMirrorSnippet([
    { kind: 'text', value: String.raw`\begin{theorem}
body
\begin{align}
x &= y \\
z &= w
\end{align}
\end{theorem}
` },
    { kind: 'tabstop', index: 0 },
  ]);
  const from = original.indexOf('nest');
  applyAtomicCodeMirrorSnippet(view, {
    template: encoding.template,
    completion: { label: 'nested environment' },
    from,
    to: from + 'nest'.length,
    openBraceMarker: encoding.openBraceMarker,
    closeBraceMarker: encoding.closeBraceMarker,
  });

  assert.equal(state.doc.toString(), String.raw`\begin{proof}
    \begin{theorem}
      body
      \begin{align}
        x &= y \\
        z &= w
      \end{align}
    \end{theorem}
${'    '}
\end{proof}`);
  assert.equal(undo(view), true);
  assert.equal(state.doc.toString(), original);
  assert.equal(redo(view), true);
  assert.match(state.doc.toString(), /^    \\end\{theorem\}$/mu);
});

test('visual toolbar styles toggle exact inner and whole command selections', () => {
  const inner = String.raw`The \emph{first case} is immediate.`;
  const innerStart = inner.indexOf('first case');
  assert.deepEqual(
    planVisualInlineStyleToggle(
      inner,
      { start: innerStart, end: innerStart + 'first case'.length },
      'emph',
      ['emph', 'textit'],
    ),
    {
      range: {
        start: inner.indexOf(String.raw`\emph{`),
        end: inner.indexOf(String.raw`\emph{`) + String.raw`\emph{first case}`.length,
      },
      insert: 'first case',
      selection: {
        start: inner.indexOf(String.raw`\emph{`),
        end: inner.indexOf(String.raw`\emph{`) + 'first case'.length,
      },
      action: 'unwrap',
    },
  );

  const whole = String.raw`A \textit{nested {case}} follows.`;
  const wrapperStart = whole.indexOf(String.raw`\textit{`);
  const wrapperEnd = wrapperStart + String.raw`\textit{nested {case}}`.length;
  assert.deepEqual(
    planVisualInlineStyleToggle(
      whole,
      { start: wrapperStart, end: wrapperEnd },
      'emph',
      ['emph', 'textit'],
    ),
    {
      range: { start: wrapperStart, end: wrapperEnd },
      insert: 'nested {case}',
      selection: { start: wrapperStart, end: wrapperStart + 'nested {case}'.length },
      action: 'unwrap',
    },
  );

  const partialStart = inner.indexOf('first');
  assert.equal(
    planVisualInlineStyleToggle(
      inner,
      { start: partialStart, end: partialStart + 'first'.length },
      'emph',
      ['emph', 'textit'],
    )?.action,
    'wrap',
  );
});

test('visual toolbar colors wrap, replace, and toggle exact selections', () => {
  const plain = 'Select this text.';
  const selected = { start: 7, end: 11 };
  assert.deepEqual(planVisualTextColorApply(plain, selected, '#D73A49'), {
    range: selected,
    insert: String.raw`\textcolor[HTML]{D73A49}{this}`,
    selection: { start: 32, end: 36 },
    action: 'wrap',
  });

  const colored = String.raw`A \textcolor[HTML]{D73A49}{first case} follows.`;
  const bodyStart = colored.indexOf('first case');
  const bodySelection = { start: bodyStart, end: bodyStart + 'first case'.length };
  const wrapperStart = colored.indexOf(String.raw`\textcolor`);
  const wrapperEnd = colored.indexOf(' follows.');
  assert.deepEqual(planVisualTextColorApply(colored, bodySelection, 'd73a49'), {
    range: { start: wrapperStart, end: wrapperEnd },
    insert: 'first case',
    selection: { start: wrapperStart, end: wrapperStart + 'first case'.length },
    action: 'unwrap',
  });
  const replacement = planVisualTextColorApply(colored, bodySelection, '3366FF');
  assert.equal(replacement?.action, 'replace');
  assert.equal(replacement?.insert, String.raw`\textcolor[HTML]{3366FF}{first case}`);

  assert.equal(
    planVisualTextColorApply(
      colored,
      { start: wrapperStart, end: wrapperEnd },
      'D73A49',
    )?.action,
    'unwrap',
  );
});

test('visual source keeps environment indentation relative to the outer begin', () => {
  const source = [
    '    ordinary prose',
    String.raw`    \begin{theorem}`,
    '      theorem body',
    String.raw`      \begin{equation}`,
    '        x=y',
    String.raw`      \end{equation}`,
    String.raw`    \end{theorem}`,
    '    trailing prose',
  ].join('\n');
  const visibleIndentation = planVisualLeadingIndentation(source).map(
    (plan) => plan.indentationLength - plan.hideLength,
  );
  assert.deepEqual(visibleIndentation, [0, 0, 2, 2, 4, 2, 0, 0]);
});

function applyVisualIndentationChanges(
  source: string,
  changes: readonly { readonly from: number; readonly to: number; readonly insert: string }[],
): string {
  let result = source;
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index]!;
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}

test('visual indentation columns handle mixed tabs safely', () => {
  assert.equal(visualSourceIndentationColumns('    ', 4), 4);
  assert.equal(visualSourceIndentationColumns('\t', 4), 4);
  assert.equal(visualSourceIndentationColumns(' \t', 4), 4);
  assert.equal(visualSourceIndentationColumns('\t  ', 4), 6);
  assert.equal(visualSourceIndentationColumns('  text', 4), 0);
  assert.equal(visualSourceIndentationColumns(' '.repeat(400), 4), 256);
});

test('safe LaTeX indentation formats nested structures and is idempotent', () => {
  const source = [
    String.raw`\documentclass{article}`,
    String.raw`\begin{document}`,
    '    Top level.',
    String.raw`   \begin{theorem}`,
    'Body.',
    String.raw`\[`,
    ' x=y',
    String.raw`   \]`,
    String.raw`\begin{equation}`,
    '      y=z',
    String.raw` \end{equation}`,
    String.raw`\begin{itemize}`,
    String.raw`\item First`,
    ' continuation',
    String.raw`  \end{itemize}`,
    '   ',
    String.raw` \end{theorem}`,
    String.raw`  \end{document}`,
  ].join('\n');
  const expected = [
    String.raw`\documentclass{article}`,
    String.raw`\begin{document}`,
    'Top level.',
    String.raw`\begin{theorem}`,
    '  Body.',
    String.raw`  \[`,
    '    x=y',
    String.raw`  \]`,
    String.raw`  \begin{equation}`,
    '    y=z',
    String.raw`  \end{equation}`,
    String.raw`  \begin{itemize}`,
    String.raw`    \item First`,
    '    continuation',
    String.raw`  \end{itemize}`,
    '',
    String.raw`\end{theorem}`,
    String.raw`\end{document}`,
  ].join('\n');
  const plan = planVisualLatexIndentationFormat(source);
  assert.equal(plan.exceededChangeLimit, false);
  assert.equal(applyVisualIndentationChanges(source, plan.changes), expected);
  assert.equal(planVisualLatexIndentationFormat(expected).changes.length, 0);
});

test('safe LaTeX indentation preserves opaque bodies and bounds transport edits', () => {
  const source = [
    String.raw`\begin{document}`,
    String.raw`\begin{verbatim}`,
    '      literal { source',
    '  still literal',
    String.raw`\end{verbatim}`,
    String.raw`\begin{theorem}`,
    'body',
    String.raw`\end{theorem}`,
    String.raw`\end{document}`,
  ].join('\r\n');
  const plan = planVisualLatexIndentationFormat(source);
  const formatted = applyVisualIndentationChanges(source, plan.changes);
  assert.match(formatted, /      literal \{ source\r\n  still literal/u);
  assert.equal(plan.skippedOpaqueLineCount >= 2, true);
  assert.equal(formatted.includes('\r\n'), true, 'CRLF endings must remain intact');

  const transport = coalesceVisualLatexIndentationChanges(source, plan.changes, {
    maxChanges: 1,
  });
  assert.equal(transport.exceededLimit, false);
  assert.equal(transport.changes.length <= 1, true);
  assert.equal(applyVisualIndentationChanges(source, transport.changes), formatted);
});

test('visual Enter indents environment bodies and aligns closing boundaries', () => {
  const source = [
    String.raw`\begin{document}`,
    String.raw`\begin{theorem}`,
    '',
    String.raw`  \begin{equation}`,
    '',
    String.raw`  \end{equation}`,
    String.raw`\end{theorem}`,
    String.raw`\end{document}`,
  ].join('\n');
  const state = EditorState.create({
    doc: source,
    extensions: [
      indentUnit.of('  '),
      visualLatexEnvironmentIndentationExtension(),
    ],
  });
  assert.equal(getIndentation(state, state.doc.line(2).from), 0);
  assert.equal(getIndentation(state, state.doc.line(3).from), 2);
  assert.equal(getIndentation(state, state.doc.line(5).from), 4);
  assert.equal(getIndentation(state, state.doc.line(6).from), 2);
  assert.equal(getIndentation(state, state.doc.line(7).from), 0);
  assert.equal(getIndentation(state, state.doc.line(8).from), 0);
});

test('visual list Enter inserts and removes items in the innermost list', () => {
  const nestedMarked = String.raw`\begin{enumerate}
  \item Outer
  \begin{itemize}
    \item Inner<CURSOR>
  \end{itemize}
\end{enumerate}`;
  const nestedCursor = nestedMarked.indexOf('<CURSOR>');
  const nested = nestedMarked.replace('<CURSOR>', '');
  assert.deepEqual(planVisualListEnter(nested, nestedCursor), {
    range: { start: nestedCursor, end: nestedCursor },
    insert: '\n    \\item ',
    cursorOffset: nestedCursor + '\n    \\item '.length,
    action: 'insert-item',
  });

  const descriptionMarked = String.raw`\begin{description}
  \item[Term]   <CURSOR>
\end{description}`;
  const descriptionCursor = descriptionMarked.indexOf('<CURSOR>');
  const description = descriptionMarked.replace('<CURSOR>', '');
  const descriptionClear = planVisualListEnter(description, descriptionCursor);
  assert.equal(descriptionClear?.action, 'remove-empty-item');
  assert.ok(descriptionClear);
  const descriptionAfterClear = description.slice(0, descriptionClear.range.start) +
    descriptionClear.insert + description.slice(descriptionClear.range.end);
  assert.equal(descriptionAfterClear, String.raw`\begin{description}
${'  '}
\end{description}`);
  assert.equal(
    descriptionClear.cursorOffset,
    descriptionAfterClear.indexOf('\n\\end{description}'),
    'a second Enter must stay on the blank line inside the list',
  );

  const collapsedMarkerMarked = String.raw`\begin{enumerate}[(1)]
  \item<CURSOR>${'   '}
\end{enumerate}`;
  const collapsedMarkerCursor = collapsedMarkerMarked.indexOf('<CURSOR>');
  const collapsedMarker = collapsedMarkerMarked.replace('<CURSOR>', '');
  const collapsedClear = planVisualListEnter(collapsedMarker, collapsedMarkerCursor);
  assert.equal(
    collapsedClear?.action,
    'remove-empty-item',
    'a caret at the collapsed marker edge must remove the empty item',
  );
  assert.ok(collapsedClear);
  const collapsedAfterClear = collapsedMarker.slice(0, collapsedClear.range.start) +
    collapsedClear.insert + collapsedMarker.slice(collapsedClear.range.end);
  assert.equal(collapsedAfterClear, String.raw`\begin{enumerate}[(1)]
${'  '}
\end{enumerate}`);
  assert.ok(
    collapsedClear.cursorOffset < collapsedAfterClear.indexOf('\\end{enumerate}'),
    'clearing the final empty item must not leave enumerate',
  );

  const optionalMarkerMarked = String.raw`\begin{description}
  \item[(7)]<CURSOR>${'   '}
\end{description}`;
  const optionalMarkerCursor = optionalMarkerMarked.indexOf('<CURSOR>');
  const optionalMarker = optionalMarkerMarked.replace('<CURSOR>', '');
  assert.equal(
    planVisualListEnter(optionalMarker, optionalMarkerCursor)?.action,
    'remove-empty-item',
    'an optional item label remains part of the marker rather than item content',
  );

  const sharedBoundaryMarked = String.raw`\begin{enumerate}
  \item<CURSOR> \end{enumerate}`;
  const sharedBoundaryCursor = sharedBoundaryMarked.indexOf('<CURSOR>');
  const sharedBoundary = sharedBoundaryMarked.replace('<CURSOR>', '');
  const sharedBoundaryClear = planVisualListEnter(
    sharedBoundary,
    sharedBoundaryCursor,
  );
  assert.equal(sharedBoundaryClear?.action, 'remove-empty-item');
  assert.ok(sharedBoundaryClear);
  const sharedBoundaryAfterClear =
    sharedBoundary.slice(0, sharedBoundaryClear.range.start) +
    sharedBoundaryClear.insert +
    sharedBoundary.slice(sharedBoundaryClear.range.end);
  assert.equal(sharedBoundaryAfterClear, String.raw`\begin{enumerate}
${'  '}
\end{enumerate}`);
  assert.equal(
    sharedBoundaryClear.cursorOffset,
    sharedBoundaryAfterClear.indexOf('\n\\end{enumerate}'),
    'a hidden same-line closing command must be moved onto its own line without exiting',
  );

  const equationMarked = String.raw`\begin{enumerate}
  \item Before
  \begin{equation}
    x=<CURSOR>y
  \end{equation}
\end{enumerate}`;
  const equationCursor = equationMarked.indexOf('<CURSOR>');
  const equation = equationMarked.replace('<CURSOR>', '');
  assert.equal(planVisualListEnter(equation, equationCursor), undefined);

  const commentMarked = String.raw`\begin{enumerate}
  \item Before
  % comment<CURSOR>
\end{enumerate}`;
  const commentCursor = commentMarked.indexOf('<CURSOR>');
  const comment = commentMarked.replace('<CURSOR>', '');
  assert.equal(planVisualListEnter(comment, commentCursor), undefined);
});

test('visual list Enter is one undoable transaction for insertion and empty-item clearing', () => {
  const original = String.raw`\begin{enumerate}
  \item First
\end{enumerate}`;
  const originalCursor = original.indexOf('\n', original.indexOf('First'));
  let state = EditorState.create({
    doc: original,
    selection: { anchor: originalCursor },
    extensions: [history()],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  } as unknown as EditorView;
  const applyPlan = (plan: NonNullable<ReturnType<typeof planVisualListEnter>>) => {
    view.dispatch(state.update({
      changes: {
        from: plan.range.start,
        to: plan.range.end,
        insert: plan.insert,
      },
      selection: EditorSelection.cursor(plan.cursorOffset),
      annotations: [
        Transaction.userEvent.of('input'),
        isolateHistory.of('full'),
      ],
    }));
  };

  const insertion = planVisualListEnter(original, originalCursor);
  assert.ok(insertion);
  applyPlan(insertion);
  assert.equal(state.doc.toString(), String.raw`\begin{enumerate}
  \item First
  \item${' '}
\end{enumerate}`);
  const inserted = state.doc.toString();
  const emptyClear = planVisualListEnter(inserted, state.selection.main.head);
  assert.equal(emptyClear?.action, 'remove-empty-item');
  assert.equal(undo(view), true);
  assert.equal(state.doc.toString(), original);
  assert.equal(redo(view), true);
  assert.equal(state.doc.toString(), inserted);
  assert.ok(emptyClear);
  applyPlan(emptyClear);
  assert.equal(state.doc.toString(), String.raw`\begin{enumerate}
  \item First
${'  '}
\end{enumerate}`);
  assert.equal(
    state.selection.main.head,
    state.doc.toString().indexOf('\n\\end{enumerate}'),
    'the cleared-item caret must remain on the blank line before the closing boundary',
  );
  assert.equal(undo(view), true);
  assert.equal(state.doc.toString(), inserted);
});

test('final Chinese IME commit replaces the tracked candidate instead of duplicating it', () => {
  const listSource = String.raw`\begin{enumerate}
  ；
\end{enumerate}`;
  const punctuationFrom = listSource.indexOf('；');
  const punctuationPlan = planVisualImeCompositionUpdate(
    listSource,
    punctuationFrom,
    punctuationFrom + 1,
    punctuationFrom + 1,
    punctuationFrom + 1,
    '；',
    '；',
    undefined,
    { finalCommit: true },
  );
  assert.ok(punctuationPlan);
  assert.equal(
    listSource.slice(0, punctuationPlan.from) +
      punctuationPlan.insert +
      listSource.slice(punctuationPlan.to),
    listSource,
    'the final compose event must not append a second full-width semicolon',
  );

  const pinyinSource = '前缀ni后缀';
  const pinyinFrom = pinyinSource.indexOf('ni');
  const pinyinPlan = planVisualImeCompositionUpdate(
    pinyinSource,
    pinyinFrom,
    pinyinFrom + 2,
    pinyinFrom + 2,
    pinyinFrom + 2,
    '你',
    '你',
    undefined,
    { finalCommit: true },
  );
  assert.ok(pinyinPlan);
  assert.equal(
    pinyinSource.slice(0, pinyinPlan.from) +
      pinyinPlan.insert +
      pinyinSource.slice(pinyinPlan.to),
    '前缀你后缀',
    'a real Pinyin commit must still replace the provisional candidate',
  );
});

test('visual Up and Down use sticky LaTeX logical lines rather than wrapped rows', () => {
  const source = [
    'short source line',
    'one deliberately very long source line that may soft-wrap many times',
    'tiny',
  ].join('\n');
  const document = EditorState.create({ doc: source }).doc;
  const longLine = document.line(2);
  const longPlan = planVisualLogicalLineNavigation(
    source,
    { from: longLine.from, to: longLine.to },
    12,
  );
  assert.deepEqual(longPlan, {
    cursorOffset: longLine.from + 12,
    goalColumn: 12,
    reveal: {
      kind: 'line',
      ranges: [{ from: longLine.from, to: longLine.to }],
      scopeFrom: longLine.from,
      scopeTo: longLine.to,
    },
  });

  const shortLine = document.line(3);
  const clamped = planVisualLogicalLineNavigation(
    source,
    { from: shortLine.from, to: shortLine.to },
    12,
  );
  assert.equal(clamped?.cursorOffset, shortLine.to);
  assert.equal(clamped?.goalColumn, 12, 'the long-line goal column remains sticky');
});

test('visual logical-line navigation exposes only the formula reached at its source column', () => {
  const source = 'Prefix text $x_1+y_1$ and suffix.';
  const document = EditorState.create({ doc: source }).doc;
  const line = document.line(1);
  const formulaFrom = source.indexOf('$');
  const formulaTo = source.lastIndexOf('$') + 1;
  const formula = { from: formulaFrom, to: formulaTo, display: false };

  assert.equal(
    planVisualLogicalLineNavigation(
      source,
      { from: line.from, to: line.to },
      formulaFrom + 3,
      [formula],
    )?.reveal.kind,
    'formula',
  );
  assert.equal(
    planVisualLogicalLineNavigation(
      source,
      { from: line.from, to: line.to },
      2,
      [formula],
    )?.reveal.kind,
    'line',
    'prose on the same logical line must not force the inline formula open',
  );
});

test('visual logical-line navigation keeps a multiline display formula wholly exposed', () => {
  const source = String.raw`Before
\begin{align}
  a &= b \\
  c &= d
\end{align}
After`;
  const document = EditorState.create({ doc: source }).doc;
  const formula = {
    from: source.indexOf(String.raw`\begin{align}`),
    to: source.indexOf(String.raw`\end{align}`) + String.raw`\end{align}`.length,
    display: true,
  };
  const target = document.line(4);
  const plan = planVisualLogicalLineNavigation(
    source,
    { from: target.from, to: target.to },
    1,
    [formula],
  );
  assert.deepEqual(plan?.reveal, {
    kind: 'formula',
    from: formula.from,
    to: formula.to,
  });
  assert.ok(
    plan !== undefined && plan.cursorOffset >= target.from && plan.cursorOffset <= target.to,
  );
});

test('visual logical-line navigation does not capture the line after a formula or environment', () => {
  const source = String.raw`\begin{equation}
x = 1
\end{equation}
\begin{lemma}
Body
\end{lemma}
After`;
  const document = EditorState.create({ doc: source }).doc;
  const equation = {
    from: document.line(1).from,
    to: document.line(3).to,
    display: true,
  };

  const lemmaBegin = document.line(4);
  const lemmaPlan = planVisualLogicalLineNavigation(
    source,
    { from: lemmaBegin.from, to: lemmaBegin.to },
    0,
    [equation],
  );
  assert.equal(lemmaPlan?.reveal.kind, 'environment-boundary');
  assert.equal(
    lemmaPlan?.reveal.kind === 'environment-boundary'
      ? lemmaPlan.reveal.environmentName
      : undefined,
    'lemma',
    'an adjacent lemma begin line must not reopen the preceding equation',
  );

  const after = document.line(7);
  const afterPlan = planVisualLogicalLineNavigation(
    source,
    { from: after.from, to: after.to },
    0,
    [{ from: document.line(4).from, to: document.line(6).to, display: true }],
  );
  assert.deepEqual(afterPlan?.reveal, {
    kind: 'line',
    ranges: [{ from: after.from, to: after.to }],
    scopeFrom: after.from,
    scopeTo: after.to,
  });
});

test('visual logical-line navigation keeps an empty line after end outside the environment', () => {
  const source = String.raw`\begin{example}
Body
\end{example}

Following text`;
  const document = EditorState.create({ doc: source }).doc;
  const emptyAfterEnd = document.line(4);
  const plan = planVisualLogicalLineNavigation(
    source,
    { from: emptyAfterEnd.from, to: emptyAfterEnd.to },
    0,
    [{ from: document.line(1).from, to: document.line(3).to, display: true }],
  );
  assert.deepEqual(plan?.reveal, {
    kind: 'line',
    ranges: [{ from: emptyAfterEnd.from, to: emptyAfterEnd.to }],
    scopeFrom: emptyAfterEnd.from,
    scopeTo: emptyAfterEnd.to,
  });
});

test('visual logical-line navigation reveals paired innermost environment boundaries', () => {
  const source = String.raw`\begin{theorem}[Named]
Body
  \begin{enumerate}[(1)]
    \item Entry
  \end{enumerate}
\end{theorem}`;
  const document = EditorState.create({ doc: source }).doc;
  const innerBegin = document.line(3);
  const innerEnd = document.line(5);
  const beginPlan = planVisualLogicalLineNavigation(
    source,
    { from: innerBegin.from, to: innerBegin.to },
    4,
  );
  assert.deepEqual(beginPlan?.reveal, {
    kind: 'environment-boundary',
    ranges: [
      { from: innerBegin.from, to: innerBegin.to },
      { from: innerEnd.from, to: innerEnd.to },
    ],
    scopeFrom: innerBegin.from,
    scopeTo: innerEnd.to,
    environmentName: 'enumerate',
  });
  assert.deepEqual(
    planVisualLogicalLineNavigation(
      source,
      { from: innerEnd.from, to: innerEnd.to },
      4,
    )?.reveal,
    beginPlan?.reveal,
    'entering either boundary line exposes the same pair',
  );

  const unmatchedSource = String.raw`Before
\begin{proof}[unfinished]
Body`;
  const unmatchedDocument = EditorState.create({ doc: unmatchedSource }).doc;
  const unmatchedLine = unmatchedDocument.line(2);
  assert.equal(
    planVisualLogicalLineNavigation(
      unmatchedSource,
      { from: unmatchedLine.from, to: unmatchedLine.to },
      2,
    )?.reveal.kind,
    'line',
    'an unpaired boundary remains directly editable instead of revealing an outer pair',
  );
});

test('visual environment names stay synchronized while either boundary is edited', () => {
  const beginEdited = String.raw`\begin{proof}
Body.
\end{pr}`;
  const beginName = beginEdited.indexOf('proof');
  const endName = beginEdited.lastIndexOf('pr');
  assert.deepEqual(
    planVisualEnvironmentNameSync(beginEdited, [
      { start: beginName + 2, end: beginName + 'proof'.length },
    ]),
    [{ from: endName, to: endName + 2, insert: 'proof' }],
  );

  const endEdited = String.raw`\begin{pr}
Body.
\end{proposition}`;
  const shortBeginName = endEdited.indexOf('pr');
  const longEndName = endEdited.lastIndexOf('proposition');
  assert.deepEqual(
    planVisualEnvironmentNameSync(endEdited, [
      { start: longEndName, end: longEndName + 'proposition'.length },
    ]),
    [{
      from: shortBeginName,
      to: shortBeginName + 2,
      insert: 'proposition',
    }],
  );
});

test('visual environment synchronization respects nesting and ignored LaTeX regions', () => {
  const source = String.raw`% \begin{ignored}
\begin{verbatim}
\begin{alsoignored}
\end{different}
\end{verbatim}
\begin{theorem}
  \begin{align}
    x &= y
  \end{align}
\end{thm}`;
  const beginName = source.lastIndexOf('theorem');
  const endName = source.lastIndexOf('thm');
  assert.deepEqual(
    planVisualEnvironmentNameSync(source, [
      { start: beginName + 'theorem'.length, end: beginName + 'theorem'.length },
    ]),
    [{ from: endName, to: endName + 3, insert: 'theorem' }],
  );
  assert.deepEqual(
    planVisualEnvironmentNameSync(source, [{ start: 0, end: 1 }]),
    [],
  );
});

test('visual environment synchronization is one atomic Undo and Redo history event', () => {
  const original = String.raw`\begin{pr}
Body.
\end{pr}`;
  const insertAt = original.indexOf('pr') + 2;
  let state = EditorState.create({
    doc: original,
    selection: { anchor: insertAt },
    extensions: [history(), visualEnvironmentNameSyncExtension()],
  });
  state = state.update({
    changes: { from: insertAt, insert: 'oof' },
    selection: { anchor: insertAt + 3 },
    userEvent: 'input.type',
  }).state;
  const synchronized = String.raw`\begin{proof}
Body.
\end{proof}`;
  assert.equal(state.doc.toString(), synchronized);

  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  } as unknown as EditorView;
  assert.equal(undo(view), true);
  assert.equal(state.doc.toString(), original);
  assert.equal(state.selection.main.head, insertAt);
  assert.equal(redo(view), true);
  assert.equal(state.doc.toString(), synchronized);
  assert.equal(state.selection.main.head, insertAt + 3);
});

test('VS Code completion snippets convert to safe CodeMirror fields', () => {
  const encoding = vscodeSnippetToCodeMirrorSnippet(
    '\\begin{${1:align}}\n\t${2:x} &= ${3:y} \\\\\n\\end{$1}$0',
  );
  assert.ok(encoding !== undefined);
  assert.equal(
    encoding.insertedText,
    String.raw`\begin{align}
	x &= y \
\end{align}`,
  );
  assert.match(encoding.template, /\$\{1:align\}/u);
  assert.match(encoding.template, /\$\{2:x\}/u);
  assert.match(encoding.template, /\$\{3:y\}/u);
  assert.match(encoding.template, /\$\{4\}/u);
  assert.equal(encoding.template.includes('{align}'), false);

  const selected = vscodeSnippetToCodeMirrorSnippet(
    '\\textbf{${1:${TM_SELECTED_TEXT:body}}}$0',
    { TM_SELECTED_TEXT: 'chosen' },
  );
  assert.ok(selected !== undefined);
  assert.equal(selected.insertedText, String.raw`\textbf{chosen}`);

  const fallback = vscodeSnippetToCodeMirrorSnippet(
    '${1|equation,align,gather|}: ${UNKNOWN:body}',
  );
  assert.ok(fallback !== undefined);
  assert.equal(fallback.insertedText, 'equation: body');
  assert.equal(
    vscodeSnippetToCodeMirrorSnippet('${TM_FILENAME/(.*)/${1:/upcase}/}'),
    undefined,
  );

  const citation = vscodeSnippetToCodeMirrorSnippet('\\cite{${1}}$0');
  assert.ok(citation !== undefined);
  assert.equal(citation.insertedText, String.raw`\cite{}`);
  assert.match(citation.template, /\$\{1\}/u);
});

test('IME environment-name composition synchronizes only after compositionend', () => {
  const original = String.raw`\begin{pr}
Body.
\end{pr}`;
  const insertAt = original.indexOf('pr') + 2;
  let state = EditorState.create({
    doc: original,
    selection: { anchor: insertAt },
    extensions: [history(), visualEnvironmentNameSyncExtension()],
  });
  state = state.update({
    changes: { from: insertAt, insert: 'oof' },
    selection: { anchor: insertAt + 3 },
    userEvent: 'input.type.compose',
  }).state;
  assert.equal(
    state.doc.toString(),
    String.raw`\begin{proof}
Body.
\end{pr}`,
    'the distant closing boundary must not be rewritten during native composition',
  );
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  } as unknown as EditorView;
  assert.equal(
    synchronizeVisualEnvironmentNamesAfterComposition(view, original),
    true,
  );
  assert.equal(
    state.doc.toString(),
    String.raw`\begin{proof}
Body.
\end{proof}`,
  );
});

test('VS Code eqref completion applies braces and keeps the caret inside atomically', () => {
  const encoding = vscodeSnippetToCodeMirrorSnippet('\\eqref{${1}}$0');
  assert.ok(encoding !== undefined);

  let state = EditorState.create({
    doc: String.raw`\eqre`,
    selection: { anchor: 5 },
    extensions: [history()],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  } as unknown as EditorView;

  const applied = applyAtomicCodeMirrorSnippet(view, {
    template: encoding.template,
    completion: null,
    from: 0,
    to: 5,
    openBraceMarker: encoding.openBraceMarker,
    closeBraceMarker: encoding.closeBraceMarker,
  });

  assert.equal(state.doc.toString(), String.raw`\eqref{}`);
  assert.equal(state.selection.main.head, String.raw`\eqref{`.length);
  assert.equal(state.selection.main.empty, true);
  assert.deepEqual(applied.changes, [
    { from: 0, to: 5, insert: String.raw`\eqref{}` },
  ]);
  assert.equal(undo(view), true);
  assert.equal(state.doc.toString(), String.raw`\eqre`);
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
  assert.equal(
    activation.match({
      textBefore: 'q',
      context: latexContext('text'),
      activation: 'manual',
    })?.snippet.id,
    'automatic',
  );
  assert.equal(
    activation.match({
      textBefore: 'q',
      context: latexContext('text'),
      activation: 'manual-only',
    })?.snippet.id,
    'manual',
    'manual-only filtering must happen before the ranked winner is selected',
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

test('snippets protect TeX control words while allowing explicit postfix punctuation', () => {
  const matcher = matcherFor([
    {
      id: 'literal-command-suffix',
      trigger: 'sum',
      replacement: '\\sum',
      options: 'mA',
    },
    {
      id: 'letter-digit',
      trigger: { kind: 'regex', source: '([A-Za-z])(\\d)', flags: '' },
      replacement: '@[0]_{@[1]}',
      options: 'mA',
    },
    {
      id: 'whole-command',
      trigger: { kind: 'regex', source: '\\\\foo(\\d)', flags: '' },
      replacement: '\\operatorname{foo}_{@[0]}',
      options: 'mA',
    },
    {
      id: 'punctuation-postfix',
      trigger: { kind: 'regex', source: '([A-Za-z]),\\.', flags: '' },
      replacement: '\\mathbf{@[0]}',
      options: 'mA',
    },
  ]);
  for (const command of [String.raw`\leq0`, String.raw`\cdots0`, String.raw`\alpha2`]) {
    assert.equal(
      matcher.findAll({ textBefore: command, context: latexContext('inline'), activation: 'auto' })
        .some((match) => match.snippet.id === 'letter-digit'),
      false,
      command,
    );
  }
  assert.equal(
    matcher.findAll({
      textBefore: String.raw`C\sum`,
      context: latexContext('inline'),
      activation: 'auto',
    }).some((match) => match.snippet.id === 'literal-command-suffix'),
    false,
    'an already typed TeX command must not receive a second backslash from a literal snippet',
  );
  assert.equal(
    matcher.match({ textBefore: 'Csum', context: latexContext('inline'), activation: 'auto' })
      ?.snippet.id,
    'literal-command-suffix',
  );
  assert.equal(
    matcher.match({ textBefore: 'x0', context: latexContext('inline'), activation: 'auto' })
      ?.snippet.id,
    'letter-digit',
  );
  assert.equal(
    matcher.match({ textBefore: String.raw`\foo2`, context: latexContext('inline'), activation: 'auto' })
      ?.snippet.id,
    'whole-command',
    'a regex which starts at the command backslash must remain valid',
  );
  const postfix = matcher.match({
    textBefore: String.raw`\sumt,.`,
    context: latexContext('inline'),
    activation: 'auto',
  });
  assert.equal(postfix?.snippet.id, 'punctuation-postfix');
  assert.equal(postfix?.matchedText, 't,.');
  assert.equal(replacementPartsToText(postfix?.replacement ?? []), String.raw`\mathbf{t}`);
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

  for (const relation of [
    '<',
    '>',
    '≤',
    '≥',
    String.raw`\le`,
    String.raw`\leq`,
    String.raw`\ge`,
    String.raw`\geq`,
  ]) {
    const source = `${relation}1/`;
    const plan = findFractionNumerator(source, source.length - 1);
    assert.equal(plan?.numerator, '1');
    assert.deepEqual(plan?.replacementRange, {
      start: relation.length,
      end: source.length,
    });
  }
});

test('visual auto-fraction keeps comparison symbols outside the numerator', () => {
  const source = '$<1/2$';
  const plan = planVisualAutoFraction(source, source.indexOf('2') + 1, '2', {
    command: String.raw`\frac`,
    breakingCharacters: '+-=,;:&<>',
  });
  assert.deepEqual(plan, {
    range: { start: 2, end: 5 },
    parts: [
      { kind: 'text', value: String.raw`\frac{1}{2` },
      { kind: 'tabstop', index: 0 },
      { kind: 'text', value: '}' },
      { kind: 'tabstop', index: 1 },
    ],
  });
  assert.equal(
    replacementPartsToText(plan?.parts ?? []),
    String.raw`\frac{1}{2}`,
  );

  for (const relation of [String.raw`\le`, String.raw`\leq`, String.raw`\ge`, String.raw`\geq`]) {
    const relationSource = `$${relation}1/2$`;
    const relationPlan = planVisualAutoFraction(
      relationSource,
      relationSource.indexOf('2') + 1,
      '2',
      {
        command: String.raw`\frac`,
        breakingCharacters: '+-=,;:&<>≤≥',
      },
    );
    assert.deepEqual(relationPlan?.range, {
      start: 1 + relation.length,
      end: relationSource.indexOf('2') + 1,
    });
    assert.equal(
      replacementPartsToText(relationPlan?.parts ?? []),
      String.raw`\frac{1}{2}`,
    );
  }
});

test('visual automatic snippets run only for text inserted at the caret', () => {
  assert.equal(
    shouldRunVisualAutomaticSnippet(
      [{ from: 4, to: 4, insert: '(' }],
      5,
    ),
    true,
  );
  assert.equal(
    shouldRunVisualAutomaticSnippet(
      [{ from: 5, to: 6, insert: '' }],
      5,
    ),
    false,
    'backspace/delete must not re-expand a trigger already left of the caret',
  );
  assert.equal(
    shouldRunVisualAutomaticSnippet(
      [{ from: 5, to: 5, insert: 'x' }, { from: 8, to: 8, insert: 'y' }],
      6,
    ),
    false,
    'multi-change edits are not a single trigger insertion',
  );
  assert.equal(
    shouldRunVisualAutomaticSnippet(
      [{ from: 4, to: 4, insert: '(' }],
      4,
    ),
    false,
    'the caret must finish immediately after the inserted text',
  );
  assert.equal(
    shouldRunVisualAutomaticSnippet(
      [{ from: 4, to: 4, insert: '\n' }],
      5,
    ),
    false,
    'newlines use their dedicated indentation path',
  );
});

test('visual selection fractions and empty delimiter deletion mirror source mode', () => {
  assert.deepEqual(
    planVisualSelectionFraction('(x+1)', { start: 4, end: 5 }, String.raw`\frac`),
    {
      range: { start: 4, end: 5 },
      parts: [
        { kind: 'text', value: String.raw`\frac{x+1}{` },
        { kind: 'tabstop', index: 0 },
        { kind: 'text', value: '}' },
        { kind: 'tabstop', index: 1 },
      ],
    },
  );
  assert.deepEqual(emptyMathDelimiterOffsets(String.raw`a \(\) b`, 4), {
    start: 2,
    end: 6,
  });
  assert.deepEqual(emptyMathDelimiterOffsets('a $$$$ b', 4), {
    start: 2,
    end: 6,
  });
  assert.equal(emptyMathDelimiterOffsets('$x$', 2), undefined);
});

test('Tabout jumps past a structurally matching right-side closer', () => {
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

test('line-scoped Tabout can leave a prose parenthesis before a snippet tabstop', () => {
  const text = '  (1)';
  const cursor = text.indexOf('1') + 1;
  assert.deepEqual(
    planTabout(text, cursor, {
      innerStart: 0,
      innerEnd: text.length,
      outerEnd: text.length,
      arrayMode: true,
    }),
    {
      kind: 'closing-delimiter',
      from: cursor,
      to: text.length,
      skippedText: ')',
    },
  );
});

test('Tabout does not claim unrelated braces to the right of an align row prefix', () => {
  for (const source of [
    String.raw`\begin{align*}
  & previous \\
  &<CURSOR>-2z(\Phi_{1,2}(z_{1}; \mathbf{s})-1)(\Phi_{1,2}(z_{2}; \mathbf{s})-1)
\end{align*}`,
    String.raw`\begin{align*}
  & previous \\
<CURSOR>\frac{\tau_{BGW}(\mathbf{s})^{2}}{\tau_{BGW}(\mathbf{s}+z^{-1})}
\end{align*}`,
  ]) {
    const fixture = cursorMarked(source);
    assert.equal(
      planTabout(fixture.text, fixture.offset),
      undefined,
      'a cursor with no unmatched local opener must remain available for matrix column insertion',
    );
  }
});

test('Tabout keeps local nesting, alignment boundaries, scalable pairs, and math exits', () => {
  const positiveClosers = [
    {
      source: String.raw`\begin{align*}& n^{2<CURSOR>} & z\end{align*}`,
      skippedText: '}',
    },
    { source: String.raw`$a + (<CURSOR>)$`, skippedText: ')' },
    {
      source: String.raw`$a + (b + [c<CURSOR>])$`,
      skippedText: ']',
    },
    {
      source: String.raw`\[\left(\frac{x}{y}<CURSOR>\right)\]`,
      skippedText: String.raw`\right)`,
    },
  ] as const;
  for (const { source, skippedText } of positiveClosers) {
    const fixture = cursorMarked(source);
    const plan = planTabout(fixture.text, fixture.offset);
    assert.equal(plan?.kind, 'closing-delimiter', source);
    assert.equal(plan?.skippedText, skippedText, source);
  }

  for (const source of [
    String.raw`\begin{align*}& n<CURSOR> & (z)\end{align*}`,
    String.raw`\begin{align*}& n<CURSOR> \\ & (z)\end{align*}`,
  ]) {
    const fixture = cursorMarked(source);
    assert.equal(planTabout(fixture.text, fixture.offset), undefined, source);
  }

  const mathExit = cursorMarked(String.raw`$x<CURSOR>   $`);
  assert.deepEqual(planTabout(mathExit.text, mathExit.offset), {
    kind: 'math-delimiter',
    from: mathExit.offset,
    to: mathExit.text.length,
    skippedText: '   $',
  });
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

  const explicitText = '(abc )';
  const explicit = planTabout(explicitText, 1, {
    innerStart: 0,
    innerEnd: explicitText.length,
    outerEnd: explicitText.length,
  });
  assert.equal(explicit?.to, explicitText.length);
});

test('Tabout ignores future, orphaned, relational, and command-prefix closers', () => {
  for (const source of [
    String.raw`$x<CURSOR> + \frac{a}{b}$`,
    String.raw`$x<CURSOR> + y)$`,
    String.raw`$x<CURSOR> \right)$`,
    String.raw`$x<CURSOR> \rangle$`,
    String.raw`$x<CURSOR> \}$`,
    String.raw`$a<CURSOR> > b$`,
    String.raw`$a<CURSOR> | b$`,
    String.raw`$\leftarrow x<CURSOR>\right)$`,
    String.raw`$\left(x<CURSOR>\rightleftarrows y)$`,
    String.raw`$\langle x<CURSOR>\ranglefoo$`,
  ]) {
    const fixture = cursorMarked(source);
    assert.equal(
      planTabout(fixture.text, fixture.offset),
      undefined,
      source,
    );
  }
});

test('Tabout fails closed across prior cells and malformed delimiter stacks', () => {
  for (const source of [
    String.raw`\begin{align*}& (a & b<CURSOR>)\end{align*}`,
    String.raw`$([x<CURSOR>) ]$`,
    String.raw`$([x)<CURSOR>]$`,
  ]) {
    const fixture = cursorMarked(source);
    assert.equal(
      planTabout(fixture.text, fixture.offset),
      undefined,
      source,
    );
  }
});

test('Tabout scopes explicit math nested inside text-command arguments', () => {
  const plainText = cursorMarked(String.raw`\[\text{copy<CURSOR>}\]`);
  assert.equal(planTabout(plainText.text, plainText.offset), undefined);

  const innerMath = cursorMarked(
    String.raw`\[\text{copy \(x<CURSOR>\) tail}\]`,
  );
  const plan = planTabout(innerMath.text, innerMath.offset);
  assert.equal(plan?.kind, 'closing-delimiter');
  assert.equal(plan?.skippedText, String.raw`\)`);
  assert.equal(
    plan?.to,
    innerMath.text.indexOf(String.raw`\)`) + String.raw`\)`.length,
  );
});

test('Tabout treats alignment tokens as hard boundaries independent of matrix shortcuts', () => {
  for (const source of [
    String.raw`$(a & b<CURSOR>)$`,
    String.raw`$(a<CURSOR> & b)$`,
    String.raw`$(a<CURSOR> \\ b)$`,
  ]) {
    const fixture = cursorMarked(source);
    assert.equal(
      planTabout(fixture.text, fixture.offset, { arrayMode: false }),
      undefined,
      source,
    );
  }
});

test('Tabout parses left/right delimiters across TeX whitespace and comments', () => {
  const fixture = cursorMarked(String.raw`$\left % opening delimiter
  (x<CURSOR>\right % closing delimiter
  )$`);
  const plan = planTabout(fixture.text, fixture.offset);
  assert.equal(plan?.kind, 'closing-delimiter');
  assert.equal(plan?.to, fixture.text.lastIndexOf(')') + 1);
  assert.equal(plan?.skippedText, fixture.text.slice(fixture.offset, plan?.to));
});

test('alignment boundaries distinguish cells, row commands, escapes, and command prefixes', () => {
  const cell = String.raw`a & b`;
  assert.equal(alignmentBoundaryLengthAt(cell, cell.indexOf('&')), 1);

  const escapedCell = String.raw`a \& b`;
  assert.equal(alignmentBoundaryLengthAt(escapedCell, escapedCell.indexOf('&')), 0);

  for (const command of [
    String.raw`\\`,
    String.raw`\cr`,
    String.raw`\crcr`,
    String.raw`\tabularnewline`,
  ]) {
    const source = `a ${command} b`;
    assert.equal(
      alignmentBoundaryLengthAt(source, source.indexOf('\\')),
      command.length,
      command,
    );
  }

  for (const ordinaryCommand of [String.raw`\cross`, String.raw`\crystal`]) {
    assert.equal(
      alignmentBoundaryLengthAt(ordinaryCommand, 0),
      0,
      ordinaryCommand,
    );
  }
});

test('matrix Tabout leaves a local closer but never searches a later cell or row', () => {
  for (const source of [
    String.raw`\begin{align*}& n^{2<CURSOR>} & z\end{align*}`,
    String.raw`\begin{align*}& (n<CURSOR>) \\ & z\end{align*}`,
  ]) {
    const fixture = cursorMarked(source);
    const plan = planTabout(fixture.text, fixture.offset);
    assert.equal(plan?.kind, 'closing-delimiter', source);
    assert.equal(plan?.skippedText.length, 1, source);
  }

  for (const source of [
    String.raw`\begin{align*}& n<CURSOR> & (z)\end{align*}`,
    String.raw`\begin{align*}& n<CURSOR> \\ & (z)\end{align*}`,
    String.raw`\begin{align*}& n<CURSOR> \cr & (z)\end{align*}`,
    String.raw`\begin{align*}& n<CURSOR> \crcr & (z)\end{align*}`,
    String.raw`\begin{align*}& n<CURSOR> \tabularnewline & (z)\end{align*}`,
  ]) {
    const fixture = cursorMarked(source);
    assert.equal(planTabout(fixture.text, fixture.offset), undefined, source);
  }
});

test('matrix Tabout ignores escaped and commented alignment-looking tokens', () => {
  const escaped = cursorMarked(
    String.raw`\begin{align*}& (n<CURSOR> \& text )\end{align*}`,
  );
  assert.equal(planTabout(escaped.text, escaped.offset)?.skippedText, String.raw` \& text )`);

  const commented = cursorMarked(String.raw`\begin{align*}
  & (n<CURSOR> % ignored & \\ \cr \crcr \tabularnewline )
    + z)
\end{align*}`);
  assert.equal(
    planTabout(commented.text, commented.offset)?.skippedText,
    String.raw` % ignored & \\ \cr \crcr \tabularnewline )
    + z)`,
  );
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
  return applyEnlargePlans(text, [plan]);
}

function applyEnlargePlans(
  text: string,
  plans: readonly EnlargeBracketPlan[],
): string {
  const edits = plans
    .flatMap((plan) => [
      { offset: plan.insertLeftAt, text: plan.insertLeftText },
      { offset: plan.insertRightAt, text: plan.insertRightText },
    ])
    .sort((left, right) => right.offset - left.offset);
  let result = text;
  for (const edit of edits) {
    result = `${result.slice(0, edit.offset)}${edit.text}${result.slice(edit.offset)}`;
  }
  return result;
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

test('auto-enlarge treats binomials like fractions by default', () => {
  const text = String.raw`(\binom{n}{k})`;
  const commandStart = text.indexOf(String.raw`\binom`);
  const plan = planAutoEnlarge(text, {
    start: commandStart,
    end: commandStart + String.raw`\binom`.length,
  });
  assert.ok(plan);
  assert.equal(
    applyEnlargePlan(text, plan),
    String.raw`\left(\binom{n}{k}\right)`,
  );
});

test('auto-enlarge plans every eligible same-delimiter ancestor in one cascade', () => {
  const text = String.raw`(1-(\frac{x}{y}))`;
  const commandStart = text.indexOf(String.raw`\frac`);
  const plans = planAutoEnlargeAncestors(text, {
    start: commandStart,
    end: commandStart + String.raw`\frac`.length,
  });
  const outerOpen = text.indexOf('(');
  const innerOpen = text.indexOf('(', outerOpen + 1);
  const innerClose = text.indexOf(')');
  const outerClose = text.lastIndexOf(')');
  assert.deepEqual(
    plans.map((plan) => [plan.openOffset, plan.closeOffset]),
    [
      [innerOpen, innerClose],
      [outerOpen, outerClose],
    ],
    'one planner call must return innermost-to-outermost original offsets',
  );
  assert.equal(
    applyEnlargePlans(text, plans),
    String.raw`\left(1-\left(\frac{x}{y}\right)\right)`,
  );
});

test('auto-enlarge cascades through three mixed delimiter kinds', () => {
  const text = String.raw`[\langle(\sum_i x_i)\rangle]`;
  const commandStart = text.indexOf(String.raw`\sum`);
  const plans = planAutoEnlargeAncestors(text, {
    start: commandStart,
    end: commandStart + String.raw`\sum`.length,
  });
  assert.deepEqual(
    plans.map((plan) => [plan.open, plan.close]),
    [
      ['(', ')'],
      [String.raw`\langle`, String.raw`\rangle`],
      ['[', ']'],
    ],
  );
  assert.equal(
    applyEnlargePlans(text, plans),
    String.raw`\left[\left\langle\left(\sum_i x_i\right)\right\rangle\right]`,
  );
});

test('auto-enlarge caps one cascade at the innermost 64 ancestors', () => {
  const depth = 65;
  const command = String.raw`\frac{x}{y}`;
  const text = `${'('.repeat(depth)}${command}${')'.repeat(depth)}`;
  const commandStart = text.indexOf(String.raw`\frac`);
  const plans = planAutoEnlargeAncestors(text, {
    start: commandStart,
    end: commandStart + String.raw`\frac`.length,
  });
  assert.equal(plans.length, 64);
  assert.equal(plans[0]?.openOffset, depth - 1);
  assert.equal(plans.at(-1)?.openOffset, 1);
  assert.equal(
    plans.some((plan) => plan.openOffset === 0),
    false,
    'the single omitted ancestor must be the outermost pair',
  );
});

test('auto-enlarge skips an already-sized middle pair and keeps cascading outward', () => {
  const text = String.raw`[\left((\frac{x}{y})\right)]`;
  const commandStart = text.indexOf(String.raw`\frac`);
  const plans = planAutoEnlargeAncestors(text, {
    start: commandStart,
    end: commandStart + String.raw`\frac`.length,
  });
  assert.deepEqual(
    plans.map((plan) => [plan.open, plan.close]),
    [
      ['(', ')'],
      ['[', ']'],
    ],
  );
  assert.equal(
    applyEnlargePlans(text, plans),
    String.raw`\left[\left(\left(\frac{x}{y}\right)\right)\right]`,
  );
});

test('auto-enlarge ignores verbatim and command-prefix delimiter lookalikes', () => {
  for (const text of [
    String.raw`$(\verb|(| + \frac{x}{y})$`,
    String.raw`$(\verb*|)| + \frac{x}{y})$`,
  ]) {
    const commandStart = text.indexOf(String.raw`\frac`);
    const plans = planAutoEnlargeAncestors(text, {
      start: commandStart,
      end: commandStart + String.raw`\frac`.length,
    });
    assert.equal(plans.length, 1, text);
    assert.equal(plans[0]?.openOffset, text.indexOf('('), text);
    assert.equal(plans[0]?.closeOffset, text.lastIndexOf(')'), text);
  }

  for (const text of [
    String.raw`$\langlefoo + \frac{x}{y} \rangle$`,
    String.raw`$\langle \frac{x}{y} \ranglefoo$`,
  ]) {
    const commandStart = text.indexOf(String.raw`\frac`);
    assert.deepEqual(
      planAutoEnlargeAncestors(text, {
        start: commandStart,
        end: commandStart + String.raw`\frac`.length,
      }),
      [],
      text,
    );
  }
});

test('auto-enlarge recognizes sized delimiters separated by a TeX comment', () => {
  const text = String.raw`$\left% sizing note
(\frac{x}{y}\right)$`;
  const commandStart = text.indexOf(String.raw`\frac`);
  assert.deepEqual(
    planAutoEnlargeAncestors(text, {
      start: commandStart,
      end: commandStart + String.raw`\frac`.length,
    }),
    [],
  );
});

test('auto-enlarge cascades only through ancestors inside the same align cell and brace scope', () => {
  for (const text of [
    String.raw`\begin{align*}& [a + (\frac{x}{y}) & z]\end{align*}`,
    String.raw`\begin{align*}& [a + (\frac{x}{y}) \\ & z]\end{align*}`,
  ]) {
    const commandStart = text.indexOf(String.raw`\frac`);
    const plans = planAutoEnlargeAncestors(text, {
      start: commandStart,
      end: commandStart + String.raw`\frac`.length,
    });
    assert.deepEqual(
      plans.map((plan) => [plan.open, plan.close]),
      [['(', ')']],
      text,
    );
    const enlarged = applyEnlargePlans(text, plans);
    assert.equal(enlarged.includes(String.raw`\left(`), true, text);
    assert.equal(enlarged.includes(String.raw`\left[`), false, text);
  }

  const crossedBrace = String.raw`{[(\frac{x}{y})}]`;
  const commandStart = crossedBrace.indexOf(String.raw`\frac`);
  const plans = planAutoEnlargeAncestors(crossedBrace, {
    start: commandStart,
    end: commandStart + String.raw`\frac`.length,
  });
  assert.deepEqual(
    plans.map((plan) => [plan.open, plan.close]),
    [['(', ')']],
  );
  assert.equal(
    applyEnlargePlans(crossedBrace, plans),
    String.raw`{[\left(\frac{x}{y}\right)}]`,
  );

  const alignmentInsideBrace =
    String.raw`\begin{align*}& {[(\frac{x}{y}) & z]}\end{align*}`;
  const bracedCommandStart = alignmentInsideBrace.indexOf(String.raw`\frac`);
  const bracedPlans = planAutoEnlargeAncestors(alignmentInsideBrace, {
    start: bracedCommandStart,
    end: bracedCommandStart + String.raw`\frac`.length,
  });
  assert.deepEqual(
    bracedPlans.map((plan) => [plan.open, plan.close]),
    [['(', ')']],
    'an alignment tab inside braces must still cut off outer bracket ancestors',
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

test('auto-enlarge never pairs delimiters across alignment cells or rows', () => {
  for (const text of [
    String.raw`\begin{align*}& (a + \sum & b)\end{align*}`,
    String.raw`\begin{align*}& (a \\ \sum + b)\end{align*}`,
    String.raw`\begin{align*}& (a \cr \sum + b)\end{align*}`,
    String.raw`\begin{align*}& (a \crcr \sum + b)\end{align*}`,
    String.raw`\begin{align*}& (a \tabularnewline \sum + b)\end{align*}`,
  ]) {
    const commandStart = text.indexOf(String.raw`\sum`);
    assert.equal(
      planAutoEnlarge(text, {
        start: commandStart,
        end: commandStart + String.raw`\sum`.length,
      }),
      undefined,
      text,
    );
  }
});

test('auto-enlarge retains nested same-cell pairs and ignores fake boundaries', () => {
  const nested = String.raw`\begin{align*}& [a + (\sum_i x_i)] & y\end{align*}`;
  const nestedStart = nested.indexOf(String.raw`\sum`);
  const nestedPlan = planAutoEnlarge(nested, {
    start: nestedStart,
    end: nestedStart + String.raw`\sum`.length,
  });
  assert.equal(nestedPlan?.open, '(');
  assert.equal(
    applyEnlargePlan(nested, nestedPlan!),
    String.raw`\begin{align*}& [a + \left(\sum_i x_i\right)] & y\end{align*}`,
  );

  const escaped = String.raw`\begin{align*}& (\sum \& x)\end{align*}`;
  const escapedStart = escaped.indexOf(String.raw`\sum`);
  assert.ok(planAutoEnlarge(escaped, {
    start: escapedStart,
    end: escapedStart + String.raw`\sum`.length,
  }));

  const commented = String.raw`\begin{align*}
  & (\sum % ignored & \\ \cr \crcr \tabularnewline )
    + x)
\end{align*}`;
  const commentedStart = commented.indexOf(String.raw`\sum`);
  const commentedPlan = planAutoEnlarge(commented, {
    start: commentedStart,
    end: commentedStart + String.raw`\sum`.length,
  });
  assert.ok(commentedPlan);
  assert.equal(commentedPlan?.openOffset, commented.indexOf('('));
  assert.equal(commentedPlan?.closeOffset, commented.lastIndexOf(')'));
});

test('formula viewport priority keeps refinements but supersedes distant jumps', () => {
  assert.equal(visualFormulaViewportsKeepPriority(1_000, 2_000, 1_200, 2_200), true);
  assert.equal(visualFormulaViewportsKeepPriority(2_000, 1_000, 2_450, 2_100), true);
  assert.equal(visualFormulaViewportsKeepPriority(1_000, 2_000, 2_512, 3_000), true);
  assert.equal(visualFormulaViewportsKeepPriority(1_000, 2_000, 2_513, 3_000), false);
  assert.equal(visualFormulaViewportsKeepPriority(10_000, 11_000, 1_000, 2_000), false);
  assert.equal(visualFormulaViewportsKeepPriority(0, 100, 612, 712), true);
  assert.equal(visualFormulaViewportsKeepPriority(612, 712, 1_224, 1_324), true);
  assert.equal(
    visualFormulaViewportsKeepPriority(0, 100, 1_224, 1_324),
    false,
    'the immutable lane anchor must supersede chained distant viewport changes',
  );
});

test('formula viewport batches use the source index instead of scanning a large paper', () => {
  const records = Array.from({ length: 100_000 }, (_, index) => ({
    id: `formula-${index}`,
    from: index * 10,
    to: index * 10 + 4,
  }));
  let indexedReads = 0;
  const observed = new Proxy(records, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/u.test(property)) {
        indexedReads += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const center = 500_000;
  const selected = selectVisualFormulaViewportBatch(
    observed,
    new Set(['formula-50000', 'formula-50001']),
    center - 100,
    center + 100,
    8,
  );

  assert.equal(selected.length, 8);
  assert.equal(selected.some((record) => record.id === 'formula-50000'), false);
  assert.equal(selected.some((record) => record.id === 'formula-50001'), false);
  assert.ok(
    indexedReads < 100,
    `viewport lookup touched ${indexedReads} records in a 100,000-formula paper`,
  );
  assert.deepEqual(
    selectVisualFormulaViewportBatch(records.slice(0, 5), new Set(), 34, 14, 3)
      .map((record) => record.id),
    ['formula-2', 'formula-3', 'formula-1'],
  );
});

test('visual formula assets follow currentColor without shrinking normal display geometry', () => {
  const prepared = prepareVisualFormulaAsset(
    {
      svg: '<svg width="200ex" height="100ex" style="vertical-align: -2ex;"><path fill="#010203" stroke="#010203"/></svg>',
      widthEm: 200,
      heightEm: 100,
    },
    { display: true },
  );
  assert.doesNotMatch(prepared.svg, /#010203/iu);
  assert.match(prepared.svg, /currentColor/gu);
  assert.doesNotMatch(prepared.svg, /vertical-align/iu);
  assert.equal(prepared.heightEm, 100);
  assert.equal(prepared.widthEm, 200);

  const explicitlyBounded = prepareVisualFormulaAsset(
    {
      svg: '<svg width="200ex" height="100ex"><path fill="#010203"/></svg>',
      widthEm: 200,
      heightEm: 100,
    },
    { display: true, maximumWidthEm: 160, maximumHeightEm: 36 },
  );
  assert.equal(explicitlyBounded.heightEm, 36);
  assert.equal(explicitlyBounded.widthEm, 72);

  const fallback = prepareVisualFormulaAsset(
    { svg: '<svg><path fill="#010203"/></svg>', widthEm: Number.NaN, heightEm: 0 },
    { display: false },
  );
  assert.equal(fallback.widthEm, 1);
  assert.equal(fallback.heightEm, 1.2);
});

test('visual structure scanner covers preamble, title, headings, theorem, proof, lists and bibliography', () => {
  const source = String.raw`\documentclass{article}
\theoremstyle{definition}
\newtheorem{definition}{Definition}[section]
\title{Flag Manifolds}
\author{Xuhui Zhang \and Ada Lovelace}
\institute{Sun Yat-sen University \and Analytical Engine Institute}
\email{xuhui@example.edu \and ada@example.org}
\date{August 2026}
\begin{document}
\maketitle
\section{Introduction}
\begin{definition}[Stable flag]
Let $G$ be a group.
\end{definition}
\begin{proof}
This follows immediately.
\end{proof}
\begin{enumerate}
\item First case.
\item Second case.
\end{enumerate}
According to \citet{wang2025}, the claim follows.
\bibliography{reference}
\end{document}
`;
  const structure = scanVisualDocumentStructure(source);
  const preamble = structure.records.find((record) => record.kind === 'preamble');
  assert.ok(preamble !== undefined && preamble.kind === 'preamble');
  assert.equal(source.slice(preamble.bodyFrom).startsWith('\\maketitle'), true);

  const makeTitle = structure.records.find((record) => record.kind === 'maketitle');
  assert.ok(makeTitle !== undefined && makeTitle.kind === 'maketitle');
  assert.equal(makeTitle.title?.text, 'Flag Manifolds');
  assert.deepEqual(makeTitle.authors.map((author) => author.text), [
    'Xuhui Zhang',
    'Ada Lovelace',
  ]);
  assert.deepEqual(makeTitle.affiliations.map((item) => item.text), [
    'Sun Yat-sen University',
    'Analytical Engine Institute',
  ]);
  assert.deepEqual(makeTitle.emails.map((item) => item.text), [
    'xuhui@example.edu',
    'ada@example.org',
  ]);

  const heading = structure.records.find((record) => record.kind === 'heading');
  assert.ok(heading !== undefined && heading.kind === 'heading');
  assert.equal(heading.command, 'section');
  assert.equal(source.slice(heading.contentFrom, heading.contentTo), 'Introduction');

  const theorems = structure.records.filter((record) => record.kind === 'theorem');
  assert.equal(theorems.length, 2);
  assert.deepEqual(
    theorems.map((record) => [record.environment, record.label, record.style]),
    [
      ['definition', 'Definition', 'definition'],
      ['proof', 'Proof', 'proof'],
    ],
  );
  assert.equal(theorems[0]?.optionalTitle, 'Stable flag');

  const list = structure.records.find((record) => record.kind === 'list');
  assert.ok(list !== undefined && list.kind === 'list');
  assert.equal(list.environment, 'enumerate');
  assert.deepEqual(list.items.map((item) => item.ordinal), [1, 2]);
  assert.deepEqual(structure.bibliographyPaths, ['reference.bib']);
  assert.deepEqual(structure.citedKeys, ['wang2025']);

  const entries = parseBibTeX(String.raw`@article{wang2025,
  author = {Wang, Xuhui and Yang, Chenglang},
  title = {BKP-affine coordinates},
  journal = {Advances in Mathematics},
  year = {2025}
}`);
  const resolved = resolveVisualBibliography(structure, entries, 'papers.bib');
  const citation = resolved.records.find((record) => record.kind === 'citation');
  assert.ok(citation !== undefined && citation.kind === 'citation');
  assert.equal(citation.label, 'Wang et al. (2025)');
  assert.deepEqual(citation.previews, [{
    key: 'wang2025',
    title: 'BKP-affine coordinates',
    authors: 'Wang, Xuhui and Yang, Chenglang',
    year: '2025',
    container: 'Advances in Mathematics',
    entryType: 'article',
    source: 'papers.bib · 已收录',
  }]);
  const bibliography = resolved.records.find(
    (record) => record.kind === 'bibliography',
  );
  assert.ok(bibliography !== undefined && bibliography.kind === 'bibliography');
  assert.equal(bibliography.totalEntries, 1);
  assert.equal(bibliography.entries[0]?.key, 'wang2025');
  assert.deepEqual(
    bibliography.settings.map((setting) => [setting.kind, setting.name, setting.value]),
    [['resource', 'bibliography', 'reference.bib']],
  );
});

test('visual structure scanner previews abstract, keywords and subject classifications', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\begin{abstract}
A concise abstract with inline mathematics $x^2+y^2$.
\medskip
\noindent{\bf Keywords}: example, \LaTeX, Numerical methods
\medskip
\noindent{\bf 2000 Mathematics Subject Classification: } 65L60, 65L05, 65L70.
\end{abstract}
\keywords{geometry, topology}
\subjclass[2020]{53C20, 57R20}
\begin{IEEEkeywords}
operator theory, numerical analysis
\end{IEEEkeywords}
\end{document}`;
  const records = scanVisualDocumentStructure(source).records;
  const abstracts = records.filter((record) => record.kind === 'abstract');
  assert.deepEqual(
    abstracts.map((record) => [record.environment, record.role, record.label]),
    [
      ['abstract', 'abstract', 'Abstract'],
      ['IEEEkeywords', 'keywords', 'Index Terms'],
    ],
  );
  assert.match(
    source.slice(abstracts[0]?.bodyFrom, abstracts[0]?.bodyTo),
    /concise abstract with inline mathematics/u,
  );

  const keywords = records.filter((record) => record.kind === 'keywords');
  assert.deepEqual(
    keywords.map((record) => [record.role, record.label, record.value]),
    [
      ['keywords', 'Keywords', 'example, LaTeX, Numerical methods'],
      [
        'classification',
        '2000 Mathematics Subject Classification',
        '65L60, 65L05, 65L70.',
      ],
      ['keywords', 'Keywords', 'geometry, topology'],
      ['classification', '2020 Mathematics Subject Classification', '53C20, 57R20'],
    ],
  );
  assert.ok(keywords.every((record) => record.replacement.sourceFrom < record.replacement.sourceTo));
});

test('visual headings and theorem environments receive document-class-aware numbers', () => {
  const source = String.raw`\documentclass{book}
\newtheorem{theorem}{Theorem}[chapter]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem*{remark}{Remark}
\begin{document}
\chapter{First chapter}
\section{Introduction}
\subsection{Background}
\begin{theorem}First.\end{theorem}
\begin{lemma}Shared counter.\end{lemma}
\begin{proof}Unnumbered proof.\end{proof}
\begin{remark}Unnumbered remark.\end{remark}
\chapter{Second chapter}
\section*{Unnumbered interlude}
\section{Results}
\begin{theorem}Reset in chapter.\end{theorem}
\end{document}`;
  const records = scanVisualDocumentStructure(source).records;
  const headings = records.filter((record) => record.kind === 'heading');
  assert.deepEqual(
    headings.map((record) => [record.command, record.title, record.number]),
    [
      ['chapter', 'First chapter', '1'],
      ['section', 'Introduction', '1.1'],
      ['subsection', 'Background', '1.1.1'],
      ['chapter', 'Second chapter', '2'],
      ['section', 'Unnumbered interlude', undefined],
      ['section', 'Results', '2.1'],
    ],
  );
  const theorems = records.filter((record) => record.kind === 'theorem');
  assert.deepEqual(
    theorems.map((record) => [record.environment, record.number]),
    [
      ['theorem', '1.1'],
      ['lemma', '1.2'],
      ['proof', undefined],
      ['remark', undefined],
      ['theorem', '2.1'],
    ],
  );
});

test('visual reference labels use structure numbers but preserve formula keys', () => {
  const source = String.raw`\documentclass{book}
\newtheorem{theorem}{Theorem}[chapter]
\begin{document}
\chapter{First chapter}\label{chap:first}
\section{Introduction}\label{sec:introduction}
\begin{theorem}\label{thm:main}Main result.\end{theorem}
\begin{equation}\label{eq:main}x=1.\end{equation}
\section*{Unnumbered}\label{sec:starred}
\end{document}`;
  const records = scanVisualDocumentStructure(source).records;

  assert.equal(
    visualReferenceDisplayLabel(source, records, 'chap:first', 'heading'),
    '1',
  );
  assert.equal(
    visualReferenceDisplayLabel(source, records, 'sec:introduction', 'heading'),
    '1.1',
  );
  assert.equal(
    visualReferenceDisplayLabel(source, records, 'thm:main', 'theorem'),
    '1.1',
  );
  assert.equal(
    visualReferenceDisplayLabel(source, records, 'eq:main', 'formula'),
    'eq:main',
  );
  assert.equal(
    visualReferenceDisplayLabel(source, records, 'sec:starred', 'heading'),
    'sec:starred',
  );
  assert.equal(
    visualReferenceDisplayLabel(source, records, 'missing', 'unknown'),
    'missing',
  );
});

test('visual align and matrix Tab always insert one alignment point without exiting', () => {
  const first = cursorMarked(String.raw`\begin{align*}
  f(x)=x^2<CURSOR>
\end{align*}`);
  const firstPlan = planVisualAlignTab(first.text, first.offset);
  assert.equal(firstPlan?.action, 'insert-alignment');
  assert.equal(firstPlan?.insert, ' & ');

  const existing = cursorMarked(String.raw`\begin{align*}
  f(x)=x^2<CURSOR> & g(x)=x & h(x)=0
\end{align*}`);
  const existingPlan = planVisualAlignTab(existing.text, existing.offset);
  assert.equal(existingPlan?.action, 'insert-alignment');
  assert.equal(existingPlan?.insert, ' &');

  const matrix = cursorMarked(String.raw`\begin{pmatrix}
  a<CURSOR>
\end{pmatrix}`);
  assert.equal(planVisualAlignTab(matrix.text, matrix.offset)?.insert, ' & ');

  const custom = cursorMarked(String.raw`\begin{custommatrix}
  a<CURSOR>
\end{custommatrix}`);
  assert.equal(
    planVisualAlignTab(custom.text, custom.offset, 1, ['custommatrix'])?.action,
    'insert-alignment',
  );
});

test('visual alignment Tab belongs only to the innermost environment', () => {
  const outerOnly = cursorMarked(String.raw`\begin{align}
  \begin{theorem}x<CURSOR>\end{theorem}
\end{align}`);
  assert.equal(planVisualAlignTab(outerOnly.text, outerOnly.offset), undefined);

  const innerMatrix = cursorMarked(String.raw`\begin{theorem}
  \begin{bmatrix}x<CURSOR>\end{bmatrix}
\end{theorem}`);
  assert.equal(
    planVisualAlignTab(innerMatrix.text, innerMatrix.offset)?.action,
    'insert-alignment',
  );
});

test('visual snippet Tab never crosses an environment or display-math closing boundary', () => {
  const lemma = cursorMarked(String.raw`\begin{lemma}
Body<CURSOR>
\end{lemma}
After.`);
  const lemmaEnd = lemma.text.indexOf(String.raw`\end{lemma}`) +
    String.raw`\end{lemma}`.length;
  assert.equal(
    visualTabTargetLeavesEnvironment(lemma.text, lemma.offset, lemmaEnd),
    true,
  );
  assert.equal(
    visualTabTargetLeavesEnvironment(lemma.text, lemma.offset, lemma.offset),
    false,
  );

  const inline = cursorMarked(String.raw`\begin{lemma}
\(x<CURSOR>\)
\end{lemma}`);
  const inlineCloser = inline.text.indexOf(String.raw`\)`) + 2;
  assert.equal(
    visualTabTargetLeavesEnvironment(inline.text, inline.offset, inlineCloser),
    false,
  );

  const displayBracket = cursorMarked(String.raw`\[
x<CURSOR>
\]`);
  const displayBracketCloser = displayBracket.text.indexOf(String.raw`\]`) + 2;
  assert.equal(
    visualTabTargetLeavesEnvironment(
      displayBracket.text,
      displayBracket.offset,
      displayBracketCloser,
    ),
    true,
  );

  const displayDollar = cursorMarked('$$\nx<CURSOR>\n$$');
  const displayDollarCloser = displayDollar.text.lastIndexOf('$$') + 2;
  assert.equal(
    visualTabTargetLeavesEnvironment(
      displayDollar.text,
      displayDollar.offset,
      displayDollarCloser,
    ),
    true,
  );
});

test('visual alignment Tab yields to innermost brackets and never owns Shift-Tab', () => {
  const fraction = cursorMarked(String.raw`\begin{align*}
  x=\frac{1<CURSOR>}{2}
\end{align*}`);
  assert.equal(planVisualAlignTab(fraction.text, fraction.offset), undefined);
  assert.equal(planTabout(fraction.text, fraction.offset)?.kind, 'closing-delimiter');

  const parentheses = cursorMarked(String.raw`\begin{matrix}
  (x<CURSOR>)
\end{matrix}`);
  assert.equal(planVisualAlignTab(parentheses.text, parentheses.offset), undefined);
  assert.equal(planVisualAlignTab(parentheses.text, parentheses.offset, -1), undefined);
});

test('visual alignment Tab preserves deeply nested formula and snippet boundaries', () => {
  for (const source of [
    String.raw`\begin{align*}
  x=\frac{\binom{n}{k<CURSOR>}}{m}_{i}^{j}
\end{align*}`,
    String.raw`\begin{bmatrix}
  \left(\frac{a}{b_{i<CURSOR>}}\right) & c
\end{bmatrix}`,
    String.raw`\begin{aligned}
  T_{\rho_{\mu<CURSOR>}}=0
\end{aligned}`,
  ]) {
    const fixture = cursorMarked(source);
    assert.equal(
      planVisualAlignTab(fixture.text, fixture.offset),
      undefined,
      'an open innermost delimiter must own Tab before the alignment environment',
    );
    assert.equal(planTabout(fixture.text, fixture.offset)?.kind, 'closing-delimiter');
  }

  const afterNestedFormula = cursorMarked(String.raw`\begin{align*}
  x=\frac{\binom{n}{k}}{m}_{i}^{j}<CURSOR>
\end{align*}`);
  assert.equal(
    planVisualAlignTab(afterNestedFormula.text, afterNestedFormula.offset)?.insert,
    ' & ',
  );
});

test('visual alignment Tab is owned by the nearest environment across mixed nesting', () => {
  const displayInsideTheoremInsideAlign = cursorMarked(String.raw`\begin{align*}
  \begin{theorem}
  \[
  x<CURSOR>
  \]
  \end{theorem}
\end{align*}`);
  assert.equal(
    planVisualAlignTab(
      displayInsideTheoremInsideAlign.text,
      displayInsideTheoremInsideAlign.offset,
    ),
    undefined,
  );

  const matrixInsideProofInsideAlign = cursorMarked(String.raw`\begin{align*}
  \begin{proof}
  \begin{pmatrix}a<CURSOR>\end{pmatrix}
  \end{proof}
\end{align*}`);
  assert.equal(
    planVisualAlignTab(
      matrixInsideProofInsideAlign.text,
      matrixInsideProofInsideAlign.offset,
    )?.action,
    'insert-alignment',
  );

  const proofInsideMatrix = cursorMarked(String.raw`\begin{matrix}
  \begin{proof}a<CURSOR>\end{proof}
\end{matrix}`);
  assert.equal(planVisualAlignTab(proofInsideMatrix.text, proofInsideMatrix.offset), undefined);
});

test('visual Shift+Enter exits the nearest environment to a safe blank line', () => {
  const nested = cursorMarked(String.raw`\begin{theorem}
\begin{proof}
Body<CURSOR>.
\end{proof}
After.
\end{theorem}`);
  const plan = planVisualEnvironmentExit(nested.text, nested.offset);
  assert.equal(plan?.environmentName, 'proof');
  assert.equal(plan?.boundaryKind, 'environment');
  assert.equal(plan?.insert, '\n');
  const changed = nested.text.slice(0, plan!.range.start) + plan!.insert +
    nested.text.slice(plan!.range.end);
  assert.match(changed, /\\end\{proof\}\n\nAfter\./u);
  assert.equal(changed[plan!.cursorOffset], '\n');
});

test('visual environment exit reuses an existing blank line and excludes document', () => {
  const blank = cursorMarked(String.raw`\begin{proof}
Body<CURSOR>.
\end{proof}

After.`);
  const plan = planVisualEnvironmentExit(blank.text, blank.offset);
  assert.equal(plan?.insert, '');
  assert.equal(blank.text.slice(plan?.cursorOffset, (plan?.cursorOffset ?? 0) + 1), '\n');

  const documentOnly = cursorMarked(String.raw`\begin{document}
Text<CURSOR>
\end{document}`);
  assert.equal(planVisualEnvironmentExit(documentOnly.text, documentOnly.offset), undefined);
});

test('display math Shift+Enter exits after the closer on a blank line', () => {
  for (const source of [
    String.raw`Before
\[
x<CURSOR>
\]
After`,
    `Before\n$$\nx<CURSOR>\n$$\nAfter`,
  ]) {
    const fixture = cursorMarked(source);
    const plan = planVisualEnvironmentExit(fixture.text, fixture.offset, {
      displayOnly: true,
    });
    assert.ok(plan?.boundaryKind.startsWith('display-'));
    assert.equal(plan?.insert, '\n');
    const changed = fixture.text.slice(0, plan!.range.start) + plan!.insert +
      fixture.text.slice(plan!.range.end);
    assert.match(changed, /(?:\\\]|\$\$)\n\nAfter/u);
  }
});

test('visual Shift+Enter exits the innermost display boundary before its environment', () => {
  const fixture = cursorMarked(String.raw`\begin{theorem}
Before.
\[
x=\frac{1}{2<CURSOR>}
\]
After display.
\end{theorem}
After theorem.`);
  const plan = planVisualEnvironmentExit(fixture.text, fixture.offset);
  assert.equal(plan?.boundaryKind, 'display-bracket');
  const changed = fixture.text.slice(0, plan!.range.start) + plan!.insert +
    fixture.text.slice(plan!.range.end);
  assert.match(changed, /\\\]\n\nAfter display\./u);
});

test('visual Shift+Enter creates exactly one safe blank line for same-line, EOF, and CRLF closers', () => {
  const sameLine = cursorMarked(String.raw`\begin{proof}Body<CURSOR>\end{proof}After`);
  const sameLinePlan = planVisualEnvironmentExit(sameLine.text, sameLine.offset);
  assert.equal(sameLinePlan?.insert, '\n\n');
  const sameLineChanged = sameLine.text.slice(0, sameLinePlan!.range.start) +
    sameLinePlan!.insert + sameLine.text.slice(sameLinePlan!.range.end);
  assert.match(sameLineChanged, /\\end\{proof\}\n\nAfter/u);
  assert.equal(sameLineChanged[sameLinePlan!.cursorOffset - 1], '\n');
  assert.equal(sameLineChanged[sameLinePlan!.cursorOffset], '\n');

  const atEof = cursorMarked(String.raw`\begin{proof}
Body<CURSOR>
\end{proof}`);
  const eofPlan = planVisualEnvironmentExit(atEof.text, atEof.offset);
  assert.equal(eofPlan?.insert, '\n');
  assert.equal(eofPlan?.cursorOffset, atEof.text.length + 1);

  const crlf = cursorMarked(
    '\\begin{proof}\r\nBody<CURSOR>\r\n\\end{proof}\r\nAfter',
  );
  const crlfPlan = planVisualEnvironmentExit(crlf.text, crlf.offset);
  assert.equal(crlfPlan?.insert, '\r\n');
  const crlfChanged = crlf.text.slice(0, crlfPlan!.range.start) + crlfPlan!.insert +
    crlf.text.slice(crlfPlan!.range.end);
  assert.match(crlfChanged, /\\end\{proof\}\r\n\r\nAfter/u);
});

test('visual Shift+Enter preserves the closing boundary indentation', () => {
  const nested = cursorMarked(String.raw`\begin{theorem}
  \begin{proof}
    Body<CURSOR>.
  \end{proof}
  After.
\end{theorem}`);
  const nestedPlan = planVisualEnvironmentExit(nested.text, nested.offset);
  assert.equal(nestedPlan?.insert, '  \n');
  const nestedChanged = nested.text.slice(0, nestedPlan!.range.start) +
    nestedPlan!.insert + nested.text.slice(nestedPlan!.range.end);
  assert.match(nestedChanged, /  \\end\{proof\}\n  \n  After\./u);
  assert.equal(
    nestedChanged.slice(nestedPlan!.cursorOffset - 2, nestedPlan!.cursorOffset),
    '  ',
  );

  const existingBlank = cursorMarked(String.raw`\begin{theorem}
  \[
    x<CURSOR>
  \]

  After.
\end{theorem}`);
  const existingBlankPlan = planVisualEnvironmentExit(existingBlank.text, existingBlank.offset);
  assert.equal(existingBlankPlan?.boundaryKind, 'display-bracket');
  assert.equal(existingBlankPlan?.insert, '  ');
  assert.equal(existingBlankPlan?.range.start, existingBlankPlan?.range.end);
  const existingBlankChanged = existingBlank.text.slice(0, existingBlankPlan!.range.start) +
    existingBlankPlan!.insert + existingBlank.text.slice(existingBlankPlan!.range.end);
  assert.match(existingBlankChanged, /  \\\]\n  \n  After\./u);
  assert.equal(
    existingBlankChanged.slice(
      existingBlankPlan!.cursorOffset - 2,
      existingBlankPlan!.cursorOffset,
    ),
    '  ',
  );

  const displayDollar = cursorMarked(`\\begin{theorem}\n  $$\n    x<CURSOR>\n  $$\n  After.\n\\end{theorem}`);
  const displayDollarPlan = planVisualEnvironmentExit(displayDollar.text, displayDollar.offset);
  assert.equal(displayDollarPlan?.boundaryKind, 'display-dollar');
  assert.equal(displayDollarPlan?.insert, '  \n');
  const displayDollarChanged = displayDollar.text.slice(0, displayDollarPlan!.range.start) +
    displayDollarPlan!.insert + displayDollar.text.slice(displayDollarPlan!.range.end);
  assert.match(displayDollarChanged, /  \$\$\n  \n  After\./u);
});

test('visual Backspace reveals hidden begin and end lines before source can be deleted', () => {
  const source = String.raw`\begin{proof}
Body.
\end{proof}
After.`;
  const beginSourceFrom = source.indexOf(String.raw`\begin{proof}`);
  const beginSourceTo = beginSourceFrom + String.raw`\begin{proof}`.length;
  const beginTo = source.indexOf('\n', beginSourceTo) + 1;
  const endSourceFrom = source.indexOf(String.raw`\end{proof}`);
  const endSourceTo = endSourceFrom + String.raw`\end{proof}`.length;
  const endTo = source.indexOf('\n', endSourceTo) + 1;
  const boundaries = [
    {
      from: beginSourceFrom,
      to: beginTo,
      sourceFrom: beginSourceFrom,
      sourceTo: beginSourceTo,
    },
    {
      from: endSourceFrom,
      to: endTo,
      sourceFrom: endSourceFrom,
      sourceTo: endSourceTo,
    },
  ];

  assert.deepEqual(
    planVisualHiddenEnvironmentBoundaryBackspace(beginTo, boundaries),
    { sourceFrom: beginSourceFrom, sourceTo: beginSourceTo },
  );
  assert.deepEqual(
    planVisualHiddenEnvironmentBoundaryBackspace(endTo, boundaries),
    { sourceFrom: endSourceFrom, sourceTo: endSourceTo },
  );
  assert.deepEqual(
    planVisualHiddenEnvironmentBoundaryBackspace(
      { start: endSourceFrom, end: endTo },
      boundaries,
    ),
    { sourceFrom: endSourceFrom, sourceTo: endSourceTo },
    'a DOM selection spanning an atomic replacement must reveal instead of deleting it',
  );
  assert.equal(
    planVisualHiddenEnvironmentBoundaryBackspace(endSourceFrom, boundaries),
    undefined,
    'Backspace before a hidden end may edit visible body text but must not target the boundary',
  );
  assert.equal(
    planVisualHiddenEnvironmentBoundaryBackspace(endTo, []),
    undefined,
    'a revealed boundary is excluded by the caller and remains explicitly editable',
  );
});

test('visual structure scans ThuThesis body fragments with inherited project context', () => {
  const source = String.raw`% !TEX root = ../thuthesis-example.tex
\chapter{论文主要部分的写法}\label{chap:writing}
\section{论文的语言及表述}
参见 \eqref{eq:sample}。
\begin{equation}
  E = mc^2
  \label{eq:sample}
\end{equation}`;
  const defaultRecords = scanVisualDocumentStructure(source).records;
  assert.equal(defaultRecords.some((record) => record.kind === 'heading'), false);

  const records = scanVisualDocumentStructure(source, {
    fragmentKind: 'body',
    documentLanguage: 'zh',
    numberingRootLevel: 'chapter',
  }).records;
  const headings = records.filter((record) => record.kind === 'heading');
  assert.deepEqual(
    headings.map((record) => [record.command, record.title, record.number]),
    [
      ['chapter', '论文主要部分的写法', '1'],
      ['section', '论文的语言及表述', '1.1'],
    ],
  );
  assert.equal(
    records.some(
      (record) =>
        record.kind === 'reference' &&
        record.command === 'eqref' &&
        record.keys.includes('eq:sample'),
    ),
    true,
  );

  const projectRecords = scanVisualDocumentStructure(source, {
    fragmentKind: 'body',
    documentLanguage: 'zh',
    numberingRootLevel: 'chapter',
    numberingMode: 'unknown',
  }).records;
  assert.deepEqual(
    projectRecords
      .filter((record) => record.kind === 'heading')
      .map((record) => record.number),
    [undefined, undefined],
    'a body fragment without an execution seed must not invent chapter numbers',
  );
});

test('visual structure recognizes ThuThesis language and chapter hierarchy', () => {
  const chinese = String.raw`\documentclass[degree=master]{thuthesis}
\begin{document}\chapter{中文}\end{document}`;
  const english = String.raw`\documentclass[degree=master,language=english]{thuthesis}
\begin{document}\chapter{English}\end{document}`;

  assert.equal(
    scanVisualDocumentStructure(chinese).records.find(
      (record) => record.kind === 'heading',
    )?.number,
    '1',
  );
  assert.equal(
    scanVisualDocumentStructure(english).records.find(
      (record) => record.kind === 'documentEnd',
    )?.language,
    'en',
  );
});

test('visual proof titles resolve theorem references while retaining exact optional source', () => {
  const source = String.raw`\documentclass{article}
\newtheorem{theorem}{Theorem}[section]
\begin{document}
\section{Introduction}
\begin{theorem}\label{thm:main}
The assertion.
\end{theorem}
\begin{proof}[Proof of Theorem \ref{thm:main}]

\end{proof}
\end{document}`;
  const theorems = scanVisualDocumentStructure(source).records.filter(
    (record) => record.kind === 'theorem',
  );
  const theorem = theorems.find((record) => record.environment === 'theorem');
  const proof = theorems.find((record) => record.environment === 'proof');
  assert.ok(theorem !== undefined);
  assert.ok(proof !== undefined);
  assert.equal(theorem.number, '1.1');
  assert.equal(proof.number, undefined);
  assert.equal(proof.optionalTitleLatex, String.raw`Proof of Theorem \ref{thm:main}`);
  assert.equal(proof.optionalTitle, 'Proof of Theorem 1.1');
  assert.equal(source.slice(proof.bodyFrom, proof.bodyTo).trim(), '');
});

test('visual structure scanner renders TeX text accents in prose and title metadata', () => {
  const source = String.raw`\documentclass{article}
\title{Br\'ezin and G\"{o}del}
\author{Dvo\v{r}ák \and Fran\c{c}ois}
\begin{document}
\maketitle
Br\'ezin, G\"odel, Dvo\v{r}ák, Fran\c{c}ois, Erd\H{o}s, and \AA ngström.
\end{document}`;
  const structure = scanVisualDocumentStructure(source);
  const makeTitle = structure.records.find((record) => record.kind === 'maketitle');
  assert.ok(makeTitle !== undefined && makeTitle.kind === 'maketitle');
  assert.equal(makeTitle.title?.text, 'Brézin and Gödel');
  assert.deepEqual(makeTitle.authors.map((author) => author.text), [
    'Dvořák',
    'François',
  ]);
  assert.deepEqual(
    structure.records
      .filter((record) => record.kind === 'accent')
      .map((record) => record.text),
    ['é', 'ö', 'ř', 'ç', 'ő', 'Å'],
  );
});

test('visual headings render one number while preserving accents and named text symbols', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\section{Emergent K\"{a}hler Geometry}\label{sec:kahler}
By \S\ref{sec:kahler}, compare \P, \copyright, and \textdegree.
\end{document}`;
  const structure = scanVisualDocumentStructure(source);
  const heading = structure.records.find((record) => record.kind === 'heading');
  assert.ok(heading !== undefined && heading.kind === 'heading');
  assert.equal(heading.number, '1');
  assert.equal(heading.title, 'Emergent Kähler Geometry');
  assert.deepEqual(
    structure.records
      .filter((record) => record.kind === 'accent')
      .map((record) => record.text),
    ['ä', '§', '¶', '©', '°'],
  );
});

test('visual headings render only the TeX branch of texorpdfstring', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\section{Free energy and \texorpdfstring{\(n\)}{PDF n} point functions}
\subsection{Emergent \texorpdfstring{K\"{a}hler}{PDF \textbf{fallback}} geometry}
\end{document}`;
  const structure = scanVisualDocumentStructure(source);
  const headings = structure.records.filter((record) => record.kind === 'heading');
  assert.deepEqual(
    headings.map((record) => record.title),
    ['Free energy and n point functions', 'Emergent Kähler geometry'],
  );
  const wrappers = structure.records.filter(
    (record) => record.kind === 'textStyle' && record.command === 'texorpdfstring',
  );
  assert.equal(wrappers.length, 2);
  assert.deepEqual(
    wrappers.map((record) => {
      assert.equal(record.kind, 'textStyle');
      return record.kind === 'textStyle'
        ? source.slice(record.contentFrom, record.contentTo)
        : '';
    }),
    [String.raw`\(n\)`, String.raw`K\"{a}hler`],
  );
  assert.equal(
    structure.records.some(
      (record) => record.kind === 'textStyle' && record.command === 'textbf',
    ),
    false,
    'commands in the hidden PDF-string branch must not create overlapping visual records',
  );
  assert.deepEqual(
    structure.records
      .filter((record) => record.kind === 'accent')
      .map((record) => record.text),
    ['ä'],
  );
});

test('visual heading labels resolve only across whitespace and comments', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
% a harmless label comment
\label{sec:introduction}
Text. \label{not-a-heading}
\subsection{Background \label{sec:inside-title}}
\end{document}`;
  const structure = scanVisualDocumentStructure(source);
  const introduction = findVisualHeadingForLabel(
    source,
    structure.records,
    'sec:introduction',
  );
  assert.equal(introduction?.command, 'section');
  assert.equal(introduction?.number, '1');
  assert.equal(introduction?.title, 'Introduction');
  assert.equal(
    findVisualHeadingForLabel(source, structure.records, 'not-a-heading'),
    undefined,
  );
  const nested = findVisualHeadingForLabel(
    source,
    structure.records,
    'sec:inside-title',
  );
  assert.equal(nested?.command, 'subsection');
  assert.match(nested?.title ?? '', /Background/u);
});

test('visual title preview preserves repeated authors and separates thanks emails', () => {
  const source = String.raw`\documentclass{article}
\title{Strict Monotonicity of Normalized Br\'ezin--Gross--Witten Numbers}
\author[1]{Chenglang Yang\thanks{yangcl@whu.edu.cn}}
\author[2]{Xuhui Zhang\thanks{Corresponding author: zhangxh.math@gmail.com}}
\affil[1]{Institute for Math and AI, Wuhan University}
\affil[2]{School of Mathematics, Sun Yat-sen University}
\email{zhangxh.math@gmail.com}
\begin{document}
\maketitle
\end{document}`;
  const makeTitle = scanVisualDocumentStructure(source).records.find(
    (record) => record.kind === 'maketitle',
  );
  assert.ok(makeTitle !== undefined && makeTitle.kind === 'maketitle');
  assert.equal(
    makeTitle.title?.text,
    'Strict Monotonicity of Normalized Brézin--Gross--Witten Numbers',
  );
  assert.deepEqual(makeTitle.authors.map((author) => author.text), [
    'Chenglang Yang',
    'Xuhui Zhang',
  ]);
  assert.deepEqual(makeTitle.emails.map((email) => email.text), [
    'yangcl@whu.edu.cn',
    'zhangxh.math@gmail.com',
  ]);
  assert.deepEqual(makeTitle.affiliations.map((item) => item.text), [
    'Institute for Math and AI, Wuhan University',
    'School of Mathematics, Sun Yat-sen University',
  ]);
});

test('visual enumerate preview applies legacy and enumitem label templates', () => {
  const source = String.raw`\begin{document}
\begin{enumerate}[(1)]
\item First.
\item Second.
\end{enumerate}
\begin{enumerate}[label=(\alph*)]
\item Alpha.
\item Beta.
\end{enumerate}
\begin{enumerate}[label=\Roman*.]
\item Roman.
\item[Special] Override.
\end{enumerate}
\end{document}`;
  const lists = scanVisualDocumentStructure(source).records.filter(
    (record) => record.kind === 'list',
  );
  assert.equal(lists.length, 3);
  assert.equal(lists[0]?.labelTemplate, '(1)');
  assert.deepEqual(lists[0]?.items.map((item) => item.marker), ['(1)', '(2)']);
  assert.deepEqual(lists[1]?.items.map((item) => item.marker), ['(a)', '(b)']);
  assert.deepEqual(lists[2]?.items.map((item) => item.marker), ['I.', 'Special']);
  assert.equal(
    source.slice(lists[0]?.begin.sourceFrom, lists[0]?.begin.sourceTo),
    String.raw`\begin{enumerate}[(1)]`,
  );
});

test('visual list preview adapts itemize, description, compact and inline variants', () => {
  const source = String.raw`\begin{document}
\begin{itemize}
\item Bullet.
\item[--] Custom bullet.
\begin{compactenum}[(A)]
\item Nested one.
\item Nested two.
\end{compactenum}
\end{itemize}
\begin{description*}
\item[Term] Meaning.
\end{description*}
\begin{inparaenum}[label=(\roman*)]
\item Inline one.
\item Inline two.
\end{inparaenum}
\end{document}`;
  const lists = scanVisualDocumentStructure(source).records.filter(
    (record) => record.kind === 'list',
  );
  const itemize = lists.find((record) => record.environment === 'itemize');
  const compact = lists.find((record) => record.environment === 'compactenum');
  const description = lists.find((record) => record.environment === 'description*');
  const inline = lists.find((record) => record.environment === 'inparaenum');
  assert.equal(itemize?.listKind, 'itemize');
  assert.deepEqual(itemize?.items.map((item) => item.marker), ['•', '--']);
  assert.equal(compact?.listKind, 'enumerate');
  assert.deepEqual(compact?.items.map((item) => item.marker), ['(A)', '(B)']);
  assert.equal(description?.listKind, 'description');
  assert.deepEqual(description?.items.map((item) => item.marker), ['Term:']);
  assert.deepEqual(inline?.items.map((item) => item.marker), ['(i)', '(ii)']);
});

test('visual label lookup ignores deferred definitions and literal false branches', () => {
  const source = String.raw`\newcommand{\deferred}{\label{macro-label}}
\def\plain#1{\label{def-label}}
\newenvironment{wrapped}{\label{begin-label}}{\label{end-label}}
\newif\ifdraft
\label{after-newif-declaration}
\iffalse
\label{false-label}
\fi
\iftrue
\label{conditionally-live-but-unproven}
\fi
\ifdraft
\label{custom-conditional-label}
\fi
\begin{comment}
\label{comment-label}
\end{comment}
\begin{Verbatim*}
\label{verbatim-star-label}
\end{Verbatim*}
\begin{filecontents*}{labels.tex}
\label{filecontents-label}
\end{filecontents*}
\IfFileExists{choice.tex}{\label{functional-a}}{\label{functional-b}}
\label{after-functional-conditional}
\label{real-label}`;

  assert.deepEqual(
    findVisualLabelsInRange(source, 0, source.length).map((target) => target.key),
    ['after-newif-declaration', 'after-functional-conditional', 'real-label'],
  );
});

test('visual structures omit unproven conditional branches', () => {
  const source = String.raw`\newif\ifdraft
\iffalse\section{Dead section}\fi
\ifdraft\begin{theorem}Dead theorem\end{theorem}\fi
\IfFileExists{choice.tex}{\section{Choice A}}{\section{Choice B}}
\section{Live section}`;
  const structure = scanVisualDocumentStructure(source, { fragmentKind: 'body' });

  assert.deepEqual(
    structure.records
      .filter((record) => record.kind === 'heading')
      .map((record) => record.title),
    ['Live section'],
  );
  assert.equal(structure.records.some((record) => record.kind === 'theorem'), false);
});

test('visual opaque environments do not nest or accept inexact comment endings', () => {
  const source = String.raw`\begin{comment}
prefix \end{comment} \section{Ghost comment heading}\label{ghost-comment-label}
\end{comment}
\label{live-after-comment}
\begin{verbatim}
\begin{verbatim}
\end{verbatim}
\section{Live after literal begin}\label{live-after-literal-begin}
\begin{verbatim}
\end {verbatim}
\section{Ghost after spaced end}\label{ghost-after-spaced-end}
\end{verbatim}
\section{Final live heading}\label{final-live-label}`;
  const structure = scanVisualDocumentStructure(source, { fragmentKind: 'body' });

  assert.deepEqual(
    structure.records
      .filter((record) => record.kind === 'heading')
      .map((record) => record.title),
    ['Live after literal begin', 'Final live heading'],
  );
  assert.deepEqual(
    findVisualLabelsInRange(source, 0, source.length).map((target) => target.key),
    ['live-after-comment', 'live-after-literal-begin', 'final-live-label'],
  );
});

test('project endinput bounds body Visual Structure and Math Preview with stable offsets', () => {
  const source = String.raw`\section{Live section}$x$
\endinput
\section{Inert section}$y$`;
  const projectScan = scanLatexProjectSource(source);
  assert.ok(projectScan.endInput);
  const executable = source.slice(0, projectScan.endInput.start);
  const structure = scanVisualDocumentStructure(executable, { fragmentKind: 'body' });
  const math = scanMathPreviewDocument(executable, { fragmentKind: 'body' });

  assert.deepEqual(
    structure.records
      .filter((record) => record.kind === 'heading')
      .map((record) => record.title),
    ['Live section'],
  );
  assert.deepEqual(
    math.formulas.map((formula) =>
      source.slice(formula.bodyRange.start, formula.bodyRange.end)
    ),
    ['x'],
  );
});

test('visual theorem labels and cross-references retain exact editable source ranges', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\section{Monotonicity}\label{sec:monotonicity}
\begin{corollary}\label{cor:monotone-pseudo-adjacent}
For adjacent partitions, the claim follows from \eqref{eq:Phi122z}.
\end{corollary}
\begin{theorem}
\label{thm:next-line}
Compare \ref{cor:monotone-pseudo-adjacent} and \cref{thm:next-line,sec:monotonicity}.
\end{theorem}
\end{document}`;
  const structure = scanVisualDocumentStructure(source);
  const theorems = structure.records.filter((record) => record.kind === 'theorem');
  assert.equal(theorems.length, 2);

  const corollary = theorems.find((record) => record.environment === 'corollary');
  assert.ok(corollary !== undefined);
  assert.equal(corollary.begin.block, true);
  assert.deepEqual(corollary.labels.map((label) => label.key), [
    'cor:monotone-pseudo-adjacent',
  ]);
  assert.equal(
    source.slice(corollary.labels[0]?.from, corollary.labels[0]?.to),
    String.raw`\label{cor:monotone-pseudo-adjacent}`,
  );
  assert.equal(
    source.slice(corollary.begin.from, corollary.begin.to),
    String.raw`\begin{corollary}\label{cor:monotone-pseudo-adjacent}` + '\n',
  );

  const theorem = theorems.find((record) => record.environment === 'theorem');
  assert.ok(theorem !== undefined);
  assert.deepEqual(theorem.labels.map((label) => label.key), ['thm:next-line']);
  assert.equal(theorem.labels[0]?.replacement.block, true);

  const standaloneLabel = structure.records.find(
    (record) => record.kind === 'label' && record.key === 'sec:monotonicity',
  );
  assert.ok(standaloneLabel !== undefined && standaloneLabel.kind === 'label');
  assert.equal(
    source.slice(standaloneLabel.from, standaloneLabel.to),
    String.raw`\label{sec:monotonicity}`,
  );

  const references = structure.records.filter((record) => record.kind === 'reference');
  assert.deepEqual(
    references.map((record) => [record.command, record.keys, record.label]),
    [
      ['eqref', ['eq:Phi122z'], '(eq:Phi122z)'],
      ['ref', ['cor:monotone-pseudo-adjacent'], 'cor:monotone-pseudo-adjacent'],
      [
        'cref',
        ['thm:next-line', 'sec:monotonicity'],
        'thm:next-line, sec:monotonicity',
      ],
    ],
  );
  for (const reference of references) {
    assert.equal(source.slice(reference.from, reference.to).startsWith('\\'), true);
  }
});

test('visual proposition and lemma headers stay on standalone editable lines', () => {
  const source = String.raw`\begin{document}
To continue estimating, we use the following proposition.
\begin{proposition}\label{prp:cubic-absorption}
For any partition, the first inequality holds.
\end{proposition}
To prove the proposition, we need the following lemma.
\begin{lemma}\label{lem:cubic-absorption-K}
For any partitions without zero parts, the second inequality holds.
\end{lemma}
\end{document}`;
  const structure = scanVisualDocumentStructure(source);
  const records = structure.records.filter((record) => record.kind === 'theorem');
  assert.deepEqual(records.map((record) => record.environment), [
    'proposition',
    'lemma',
  ]);
  for (const record of records) {
    assert.equal(record.begin.block, true);
    assert.equal(record.bodyFrom, record.begin.to);
    assert.equal(source[record.bodyFrom - 1], '\n');
    assert.equal(source.slice(record.bodyFrom, record.bodyTo).startsWith('For any'), true);
    assert.equal(record.labels.length, 1);
    assert.equal(
      source.slice(record.begin.from, record.begin.to),
      `${source.slice(record.begin.sourceFrom, record.begin.sourceTo)}\n`,
    );
  }
});

test('visual structure scanner previews standalone tables and local images', () => {
  const source = String.raw`\begin{document}
\begin{table}[htbp]
\centering
\caption{Explicit values in small genera}
\label{tab:small-values}
\begin{tabular}[t]{@{}ccc@{}}
Partition & Genus & Value \\
$(3)$ & $4$ & $\frac{1}{6}$ \\
$(1,2)$ & $4$ & $0$ \\
\end{tabular}
\end{table}
\begin{figure}[tbp]
\centering
\includegraphics[width=.8\textwidth]{figures/flag-manifold}
\caption{The flag-manifold diagram}
\label{fig:flag}
\end{figure}
\includegraphics{standalone.png}
Inline \includegraphics{not-a-block.png} remains editable source.
\end{document}`;
  const structure = scanVisualDocumentStructure(source);
  const table = structure.records.find((record) => record.kind === 'table');
  assert.ok(table !== undefined && table.kind === 'table');
  assert.equal(table.environment, 'tabular');
  assert.equal(table.containerEnvironment, 'table');
  assert.equal(table.position, 'htbp');
  assert.equal(table.tableAlignment, 'center');
  assert.equal(table.replacement.block, true);
  assert.equal(table.caption, 'Explicit values in small genera');
  assert.equal(table.label?.key, 'tab:small-values');
  assert.equal(table.columnCount, 3);
  assert.deepEqual(table.rows[0]?.map((cell) => cell.source), [
    'Partition',
    'Genus',
    'Value',
  ]);
  assert.equal(table.rows[1]?.[2]?.text, '1/6');
  assert.equal(table.rows[1]?.[2]?.math?.tex, String.raw`\frac{1}{6}`);

  const images = structure.records.filter((record) => record.kind === 'image');
  assert.deepEqual(images.map((record) => record.path), [
    'figures/flag-manifold',
    'standalone.png',
  ]);
  assert.equal(images[0]?.caption, 'The flag-manifold diagram');
  assert.equal(images[0]?.label?.key, 'fig:flag');
  assert.equal(images.every((record) => record.replacement.block), true);
});

test('visual tables retain mixed prose and inline-math segments in captions and cells', () => {
  const source = String.raw`\begin{document}
\begin{table}[htbp]
\caption{Explicit values of \(N(N-1)\mathcal{Q}(\mathbf{d})\) in genera \(g(\mathbf{d})=4,5\)}
\begin{tabular}{ccc}
Partition \(\mathbf{d}\) & Genus \(g(\mathbf{d})\) & \(N(N-1)\mathcal{Q}(\mathbf{d})\) \\
\((3)\) & \(4\) & \(\dfrac{1}{6}\) \\
\end{tabular}
\end{table}
\end{document}`;
  const table = scanVisualDocumentStructure(source).records.find(
    (record) => record.kind === 'table',
  );
  assert.ok(table !== undefined && table.kind === 'table');
  assert.deepEqual(
    table.captionSegments.map((segment) => segment.kind),
    ['text', 'math', 'text', 'math'],
  );
  assert.deepEqual(
    table.rows[0]?.[0]?.segments.map((segment) => segment.kind),
    ['text', 'math'],
  );
  assert.equal(table.rows[0]?.[0]?.math, undefined);
  const headerMath = table.rows[0]?.[0]?.segments.find(
    (segment) => segment.kind === 'math',
  );
  assert.ok(headerMath?.kind === 'math');
  assert.equal(headerMath.math.tex, String.raw`\mathbf{d}`);
  assert.equal(table.rows[1]?.[2]?.segments[0]?.kind, 'math');
  assert.equal(table.rows[1]?.[2]?.math?.tex, String.raw`\dfrac{1}{6}`);
  const fragments = [
    ...table.captionSegments,
    ...table.rows.flatMap((row) => row.flatMap((cell) => cell.segments)),
  ].flatMap((segment) => segment.kind === 'math' ? [segment.math] : []);
  assert.ok(fragments.length >= 8);
  assert.deepEqual(
    fragments.map((fragment) => source.slice(fragment.sourceFrom, fragment.sourceTo)),
    [
      String.raw`\(N(N-1)\mathcal{Q}(\mathbf{d})\)`,
      String.raw`\(g(\mathbf{d})=4,5\)`,
      String.raw`\(\mathbf{d}\)`,
      String.raw`\(g(\mathbf{d})\)`,
      String.raw`\(N(N-1)\mathcal{Q}(\mathbf{d})\)`,
      String.raw`\((3)\)`,
      String.raw`\(4\)`,
      String.raw`\(\dfrac{1}{6}\)`,
    ],
  );
  for (let index = 1; index < fragments.length; index += 1) {
    assert.ok(fragments[index]!.sourceFrom > fragments[index - 1]!.sourceFrom);
  }
  for (const cell of table.rows.flat()) {
    assert.equal(source.slice(cell.sourceFrom, cell.sourceTo), cell.source);
  }
});

test('visual tikzcd scanner accepts q.uiver coordinates and composable arrow styles', () => {
  const source = String.raw`\begin{document}
\begin{tikzcd}[row sep=large, column sep=huge]
  A && B \\
  C && D
  \arrow["{f}", dashed, bend left=45, two heads, from=1-1, to=2-3]
  \arrow["g"', dotted, hook, from=2-1, to=1-3]
\end{tikzcd}
\end{document}`;
  const structure = scanVisualDocumentStructure(source);
  const diagram = structure.records.find((record) => record.kind === 'tikzcd');
  assert.ok(diagram !== undefined && diagram.kind === 'tikzcd');
  assert.equal(diagram.environmentOptions, 'row sep=large, column sep=huge');
  assert.equal(diagram.visualEditable, true);
  assert.equal(diagram.rowCount, 2);
  assert.equal(diagram.columnCount, 3);
  assert.deepEqual(
    diagram.nodes.map((node) => [node.row, node.column, node.math.tex]),
    [
      [0, 0, 'A'],
      [0, 2, 'B'],
      [1, 0, 'C'],
      [1, 2, 'D'],
    ],
  );
  assert.deepEqual(diagram.arrows.map((arrow) => ({
    from: [arrow.fromRow, arrow.fromColumn],
    to: [arrow.toRow, arrow.toColumn],
    label: arrow.label?.tex,
    swap: arrow.swap,
    lineStyle: arrow.lineStyle,
    bend: arrow.bend,
    bendAmount: arrow.bendAmount,
    head: arrow.head,
  })), [
    {
      from: [0, 0],
      to: [1, 2],
      label: '{f}',
      swap: false,
      lineStyle: 'dashed',
      bend: 'left',
      bendAmount: 45,
      head: 'twoHeads',
    },
    {
      from: [1, 0],
      to: [0, 2],
      label: 'g',
      swap: true,
      lineStyle: 'dotted',
      bend: undefined,
      bendAmount: undefined,
      head: 'hook',
    },
  ]);
  assert.deepEqual(
    diagram.nodes.map((node) =>
      source.slice(node.math.sourceFrom, node.math.sourceTo)
    ),
    ['A', 'B', 'C', 'D'],
  );
  assert.deepEqual(
    diagram.arrows.map((arrow) =>
      arrow.label === undefined
        ? undefined
        : source.slice(arrow.label.sourceFrom, arrow.label.sourceTo)
    ),
    ['{f}', 'g'],
  );
  assert.equal(
    new Set([
      ...diagram.nodes.map((node) => node.math.sourceFrom),
      ...diagram.arrows.flatMap((arrow) =>
        arrow.label === undefined ? [] : [arrow.label.sourceFrom]
      ),
    ]).size,
    6,
  );
});

test('visual structure scanner models longtable parameters and repeated headers', () => {
  const source = String.raw`\begin{document}
\begin{longtable}[c]{@{}lcr@{}}
\caption{A cross-page table}\label{tab:long} \\
\toprule
Name & Genus & Value \\
\midrule
\endfirsthead
\toprule
Name & Genus & Value \\
\midrule
\endhead
\bottomrule
\endfoot
\bottomrule
\endlastfoot
$A$ & $4$ & $\frac{1}{3}$ \\
\end{longtable}
\end{document}`;
  const structure = scanVisualDocumentStructure(source);
  const table = structure.records.find((record) => record.kind === 'table');
  assert.ok(table !== undefined && table.kind === 'table');
  assert.equal(table.environment, 'longtable');
  assert.equal(table.containerEnvironment, undefined);
  assert.equal(table.position, 'c');
  assert.equal(table.captionLatex, 'A cross-page table');
  assert.equal(table.label?.key, 'tab:long');
  assert.equal(table.longtableRepeatHeader, true);
  assert.equal(table.ruleStyle, 'booktabs');
  assert.equal(table.visualEditable, true);
  assert.deepEqual(table.rows.map((row) => row.map((cell) => cell.source)), [
    ['Name', 'Genus', 'Value'],
    ['$A$', '$4$', '$\\frac{1}{3}$'],
  ]);
});

test('visual table scanner preserves table, tabular, tabularx, and longtable models', () => {
  const source = String.raw`\begin{document}
\begin{table}[!ht]
\centering
\caption{Floating table}
\label{tab:floating}
\begin{tabular}{lc}
Name & Value \\
$A$ & $1$ \\
\end{tabular}
\end{table}

\begin{tabular}[t]{rl}
Standalone & Table \\
$B$ & $2$ \\
\end{tabular}

\begin{tabularx}{0.8\linewidth}[b]{lX}
Flexible & Width \\
$C$ & $3$ \\
\end{tabularx}

\begin{longtable}[c]{lr}
\caption{Cross-page table}\label{tab:cross-page} \\
Object & Degree \\
\endfirsthead
Object & Degree \\
\endhead
$D$ & $4$ \\
\end{longtable}
\end{document}`;
  const tables = scanVisualDocumentStructure(source).records.filter(
    (record) => record.kind === 'table',
  );
  assert.equal(tables.length, 4);
  assert.deepEqual(tables.map((table) => ({
    environment: table.environment,
    containerEnvironment: table.containerEnvironment,
    position: table.position,
    width: table.width,
    caption: table.caption,
    repeatHeader: table.longtableRepeatHeader,
    visualEditable: table.visualEditable,
  })), [
    {
      environment: 'tabular',
      containerEnvironment: 'table',
      position: '!ht',
      width: undefined,
      caption: 'Floating table',
      repeatHeader: false,
      visualEditable: true,
    },
    {
      environment: 'tabular',
      containerEnvironment: undefined,
      position: 't',
      width: undefined,
      caption: undefined,
      repeatHeader: false,
      visualEditable: true,
    },
    {
      environment: 'tabularx',
      containerEnvironment: undefined,
      position: 'b',
      width: String.raw`0.8\linewidth`,
      caption: undefined,
      repeatHeader: false,
      visualEditable: true,
    },
    {
      environment: 'longtable',
      containerEnvironment: undefined,
      position: 'c',
      width: undefined,
      caption: 'Cross-page table',
      repeatHeader: true,
      visualEditable: true,
    },
  ]);
});

test('standalone hline table inserted from the visual toolbar is immediately previewable', () => {
  const source = String.raw`\begin{document}
\begin{tabular}{ccc}
\hline
列一 & 列二 & 列三 \\
\hline
A & B & C \\
\hline
\end{tabular}

\addcontentsline{toc}{section}{References}
\bibliographystyle{alpha}
\end{document}`;
  const table = scanVisualDocumentStructure(source).records.find(
    (record) => record.kind === 'table',
  );
  assert.ok(table !== undefined && table.kind === 'table');
  assert.equal(table.environment, 'tabular');
  assert.equal(table.containerEnvironment, undefined);
  assert.equal(table.ruleStyle, 'hline');
  assert.equal(table.visualEditable, true);
  assert.equal(table.columnCount, 3);
  assert.deepEqual(table.rows.map((row) => row.map((cell) => cell.source)), [
    ['列一', '列二', '列三'],
    ['A', 'B', 'C'],
  ]);
});

test('visual text styles retain editable wrappers and theme-safe colors', () => {
  const source = String.raw`\begin{document}
\textbf{Bold} \emph{Italic} \underline{Under} \sout{Strike}
\textcolor{red}{Red} \colorbox[HTML]{112233}{Boxed}
\end{document}`;
  const styles = scanVisualDocumentStructure(source).records.filter(
    (record) => record.kind === 'textStyle',
  );
  assert.deepEqual(styles.map((record) => record.command), [
    'textbf',
    'emph',
    'underline',
    'sout',
    'textcolor',
    'colorbox',
  ]);
  assert.equal(styles[0]?.bold, true);
  assert.equal(styles[1]?.italic, true);
  assert.equal(styles[2]?.underline, true);
  assert.equal(styles[3]?.strike, true);
  assert.equal(styles[4]?.foreground, '#ff0000');
  assert.equal(styles[5]?.background, '#112233');
  for (const style of styles) {
    assert.equal(
      source.slice(style.from, style.to).startsWith(`\\${style.command}`),
      true,
    );
    assert.equal(style.prefixTo, style.contentFrom);
    assert.equal(style.suffixFrom, style.contentTo);
  }
});

test('visual layout wrappers keep small groups and subequations transparent but editable', () => {
  const source = String.raw`\begin{document}
{\small
\[
  A=B.
\]
}
\begin{subequations}\label{eq:family}
\begin{align}
  x &= y, \\
  u &= v.
\end{align}
\end{subequations}
\end{document}`;
  const wrappers = scanVisualDocumentStructure(source).records.filter(
    (record): record is VisualTextStyleRecord =>
      record.kind === 'textStyle' && record.transparent === true,
  );
  assert.deepEqual(wrappers.map((record) => record.command), [
    'small',
    'subequations',
  ]);
  assert.deepEqual(wrappers.map((record) => record.editLabel), [
    '编辑 \\small',
    '编辑 subequations',
  ]);
  for (const wrapper of wrappers) {
    assert.equal(wrapper.bold, false);
    assert.equal(wrapper.italic, false);
    assert.equal(wrapper.prefixFrom, wrapper.from);
    assert.equal(wrapper.suffixTo, wrapper.to);
    assert.ok(wrapper.contentFrom < wrapper.contentTo);
  }
  assert.equal(
    source.slice(wrappers[0]?.prefixFrom, wrappers[0]?.prefixTo),
    String.raw`{\small`,
  );
  assert.equal(
    source.slice(wrappers[0]?.suffixFrom, wrappers[0]?.suffixTo),
    '}',
  );
  assert.equal(
    source.slice(wrappers[1]?.prefixFrom, wrappers[1]?.prefixTo),
    String.raw`\begin{subequations}`,
  );
  assert.equal(
    source.slice(wrappers[1]?.suffixFrom, wrappers[1]?.suffixTo),
    String.raw`\end{subequations}`,
  );
  assert.ok(
    scanVisualDocumentStructure(source).records.some(
      (record) => record.kind === 'label' && record.key === 'eq:family',
    ),
  );
});

test('visual structure scanner ignores comments, verbatim and math contents', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
% \section{Comment heading}
\begin{verbatim}
\section{Verbatim heading}
\begin{theorem}fake\end{theorem}
\end{verbatim}
\[
\text{\section{Math heading}}
\]
\section{Real heading}
\end{document}`;
  const structure = scanVisualDocumentStructure(source);
  const headings = structure.records.filter((record) => record.kind === 'heading');
  assert.equal(headings.length, 1);
  assert.equal(headings[0]?.title, 'Real heading');
  assert.equal(
    structure.records.filter((record) => record.kind === 'theorem').length,
    0,
  );
});

test('visual structure stops all records and resources after document end', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\section{Live heading}
\end{document}
\begin{table}\begin{tabular}{c}ghost\end{tabular}\end{table}
\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}
\addbibresource{ghost.bib}`;
  const structure = scanVisualDocumentStructure(source);

  assert.deepEqual(
    structure.records.map((record) => record.kind),
    ['preamble', 'heading', 'documentEnd'],
  );
  assert.deepEqual(structure.bibliographyPaths, []);
});

test('manual thebibliography becomes one editable reference preview card', () => {
  const source = String.raw`\begin{document}
\begin{thebibliography}{9}
\bibitem{alpha} A. Author, A useful article, 2024.
\bibitem{beta} B. Author, Another article, 2025.
\end{thebibliography}
\end{document}`;
  const structure = scanVisualDocumentStructure(source);
  const bibliography = structure.records.find(
    (record) => record.kind === 'bibliography',
  );
  assert.ok(bibliography !== undefined && bibliography.kind === 'bibliography');
  assert.equal(bibliography.manual, true);
  assert.deepEqual(bibliography.entries.map((entry) => entry.key), ['alpha', 'beta']);
  assert.match(bibliography.entries[0]?.title ?? '', /useful article/u);
  assert.deepEqual(
    bibliography.settings.map((setting) => [setting.kind, setting.value]),
    [['widestLabel', '9']],
  );
});

test('visual bibliography discovery reads biblatex resources from the preamble', () => {
  const structure = scanVisualDocumentStructure(String.raw`\documentclass{article}
\usepackage[backend=biber,style=authoryear,sorting=nyt]{biblatex}
\addbibresource[location=local]{papers/library.bib}
\begin{document}
Text \parencite{alpha}.
\printbibliography[heading=bibintoc,title={Selected works},keyword=geometry]
\end{document}`);
  assert.deepEqual(structure.bibliographyPaths, ['papers/library.bib']);
  assert.deepEqual(structure.citedKeys, ['alpha']);
  const bibliography = structure.records.find(
    (record) => record.kind === 'bibliography',
  );
  assert.ok(bibliography !== undefined && bibliography.kind === 'bibliography');
  assert.deepEqual(
    bibliography.settings.map((setting) => [setting.kind, setting.name, setting.value]),
    [
      ['option', 'package', 'biblatex'],
      ['backend', 'backend', 'biber'],
      ['style', 'style', 'authoryear'],
      ['sorting', 'sorting', 'nyt'],
      ['resource', 'addbibresource', 'papers/library.bib'],
      ['option', 'location', 'local'],
      ['heading', 'heading', 'bibintoc'],
      ['title', 'title', 'Selected works'],
      ['filter', 'keyword', 'geometry'],
    ],
  );
});

test('reference preview absorbs adjacent classic bibliography settings into one card', () => {
  const source = String.raw`\documentclass{article}
\renewcommand{\refname}{Selected references}
\begin{document}
\nocite{alpha,*}
\addcontentsline{toc}{section}{References}
\bibliographystyle{alpha}
\bibliography{reference,archive}
\end{document}`;
  const structure = scanVisualDocumentStructure(source);
  const bibliography = structure.records.find(
    (record) => record.kind === 'bibliography',
  );
  assert.ok(bibliography !== undefined && bibliography.kind === 'bibliography');
  assert.equal(
    source.slice(bibliography.replacement.sourceFrom, bibliography.replacement.sourceTo),
    String.raw`\nocite{alpha,*}
\addcontentsline{toc}{section}{References}
\bibliographystyle{alpha}
\bibliography{reference,archive}`,
  );
  assert.deepEqual(bibliography.requestedPaths, ['reference.bib', 'archive.bib']);
  assert.deepEqual(
    bibliography.settings.map((setting) => [setting.kind, setting.name, setting.value]),
    [
      ['title', 'refname', 'Selected references'],
      ['inclusion', 'nocite', 'alpha,*'],
      ['toc', 'section', 'References'],
      ['style', 'bibliographystyle', 'alpha'],
      ['resource', 'bibliography', 'reference.bib'],
      ['resource', 'bibliography', 'archive.bib'],
    ],
  );
});

test('visual structure scanner fails closed on incomplete LaTeX groups', () => {
  const malformed = String.raw`\documentclass{article}\begin{document}\section{unfinished`;
  assert.doesNotThrow(() => scanVisualDocumentStructure(malformed));
  const structure = scanVisualDocumentStructure(malformed);
  assert.equal(structure.records.some((record) => record.kind === 'heading'), false);
});

test('local LaTeX preview allowlist builds ytableau, tikzpicture and tikzcd documents', () => {
  const base = {
    display: true,
    macros: {},
    macroFingerprint: '[]',
  } as const;
  const tableau = { ...base, tex: String.raw`\begin{ytableau}3 & 1 \\ 1\end{ytableau}` };
  const picture = {
    ...base,
    tex: String.raw`\begin{tikzpicture}\node (a) {$A$};\draw[->] (a) -- +(1,0);\end{tikzpicture}`,
  };
  const diagram = {
    ...base,
    tex: String.raw`\begin{tikzcd}A \arrow[r] & B\end{tikzcd}`,
  };
  assert.equal(localLatexPreviewKind(tableau), 'ytableau');
  assert.equal(localLatexPreviewKind(picture), 'tikzpicture');
  assert.equal(localLatexPreviewKind(diagram), 'tikzcd');
  assert.match(createLocalLatexPreviewDocument(tableau) ?? '', /\\usepackage\{[^}]*ytableau\}/u);
  assert.match(createLocalLatexPreviewDocument(picture) ?? '', /\\usepackage\{[^}]*tikz\}/u);
  assert.match(createLocalLatexPreviewDocument(diagram) ?? '', /tikz-cd/u);
  assert.equal(localLatexPreviewKind({
    ...base,
    tex: String.raw`\begin{tikzpicture}\input{secret}\end{tikzpicture}`,
  }), undefined);
});

test('a ytableau inside display delimiters reaches the local preview route intact', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\[
\begin{ytableau}
5 & 3 & 1 \\
3 & 1 \\
1
\end{ytableau}
\]
\end{document}`;
  const snapshot = scanMathPreviewDocument(source, {});
  assert.equal(snapshot.formulas.length, 1);
  const formula = snapshot.formulas[0];
  assert.ok(formula !== undefined);
  const input = createMathPreviewRenderInput(source, formula, snapshot);
  assert.ok(input !== undefined);
  assert.equal(localLatexPreviewKind(input), 'ytableau');
  assert.match(input.tex, /\\begin\{ytableau\}/u);
  assert.match(input.tex, /\\end\{ytableau\}/u);
});

test('local LaTeX SVG sanitizer preserves intrinsic scale and marks the preview caret', () => {
  const asset = sanitizeLocalLatexSvg(
    String.raw`<?xml version="1.0"?><svg width="24pt" height="12pt"><defs><path id="g0" d="M0 0h1"/></defs><g fill="#ff2bd6"><use href="#g0"/></g></svg>`,
    1,
    '#010203',
    'probe',
    'ytableau',
    '#ff2bd6',
  );
  assert.equal(asset.widthEm, 2);
  assert.equal(asset.heightEm, 1);
  assert.equal(asset.cursorMarked, true);
  assert.match(asset.svg, /aria-label="Young tableau preview"/u);
  assert.match(asset.svg, /id="probe-g0"/u);
  assert.match(asset.svg, /href="#probe-g0"/u);
  assert.match(asset.svg, /data-texleaf-preview-caret="true"/u);
});

test('visual structure scanner creates a collapsible advanced tikzpicture record', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\begin{tikzpicture}[node distance=2cm]
  \node (a) {$A$};
  \node[right of=a] (b) {$B$};
  \draw[->, bend left=25] (a) to (b);
\end{tikzpicture}
\end{document}`;
  const record = scanVisualDocumentStructure(source).records.find(
    (candidate) => candidate.kind === 'tikzpicture',
  );
  assert.ok(record !== undefined && record.kind === 'tikzpicture');
  assert.match(record.tex, /^\\begin\{tikzpicture\}/u);
  assert.match(record.tex, /\\end\{tikzpicture\}$/u);
  assert.equal(record.replacement.block, true);
  assert.equal(source.slice(record.bodyFrom, record.bodyTo).includes('bend left=25'), true);
});
