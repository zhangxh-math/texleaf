import {
  aiProseSentenceSegments,
  extractAiProseDocument,
  type AiProseDocument,
  type AiProseOffsetRange,
  type AiProseSegment,
} from './aiProse';
import { isAiIssueOffsetRangeEditable } from './aiIssueRanges';

export interface AiIssueRetentionTextChange {
  /** UTF-16 offset in the document before this change event. */
  readonly rangeOffset: number;
  readonly rangeLength: number;
  readonly text: string;
}

export interface AiIssueRetentionCandidate {
  readonly key: string;
  readonly start: number;
  readonly end: number;
  readonly original: string;
}

export interface AiIssueRetentionMapping {
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

export interface AiIssueRetentionPlan {
  readonly retained: readonly AiIssueRetentionMapping[];
  /**
   * Exact post-edit ranges which still need review. These are deliberately
   * narrower than `dirtySegments`: the latter provide natural-language
   * context to the provider, while these ranges decide which existing issues
   * are stale.
   */
  readonly dirtyRanges: readonly AiProseOffsetRange[];
  readonly dirtySegments: readonly AiProseSegment[];
  readonly prose: AiProseDocument;
}

export interface AiDirtyReviewProgress {
  /** Dirty ranges which still have at least one sentence context to review. */
  readonly remainingRanges: readonly AiProseOffsetRange[];
  /** Source-stable sentence identities successfully reviewed for this version. */
  readonly reviewedSentenceKeys: ReadonlySet<string>;
}

export type AiIssueRetentionPreparation = 'discard' | 'fallback' | 'retain';

/**
 * Choose whether an edit can enter the synchronous full-document retention
 * planner. Oversized current buffers must be discarded directly: routing them
 * through the fallback sentence finder would perform the same unbounded prose
 * extraction which the caller's size guard is intended to avoid.
 */
export function chooseAiIssueRetentionPreparation(
  previousSourceLength: number | undefined,
  newSourceLength: number,
  changeCount: number,
  maximumSourceLength: number,
): AiIssueRetentionPreparation {
  if (
    newSourceLength > maximumSourceLength ||
    (previousSourceLength !== undefined && previousSourceLength > maximumSourceLength)
  ) {
    return 'discard';
  }
  if (previousSourceLength === undefined || changeCount === 0) {
    return 'fallback';
  }
  return 'retain';
}

interface NormalizedTextChange {
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly newStart: number;
  readonly newEnd: number;
  readonly text: string;
}

// A single VS Code change event is normally tiny, even for multi-cursor edits.
// Refuse pathological transactions rather than spending unbounded time
// rebuilding issue state. Returning undefined makes the caller discard stale
// results, which is the safe failure mode.
const MAX_RETENTION_TEXT_CHANGES = 1024;

/**
 * Preserve issues which are provably outside the actual edit ranges.
 *
 * Full pre-edit and post-edit sentences are still returned as provider
 * context. They do not invalidate unrelated issues in the same sentence.
 * This distinction matters both for sentences with several independent
 * suggestions and when punctuation or blank lines split/merge sentences.
 * Multiple non-overlapping VS Code content changes are handled as one atomic
 * transaction and verified by reconstructing the post-edit source exactly.
 */
export function planAiIssueRetention(
  oldSource: string,
  newSource: string,
  changes: readonly AiIssueRetentionTextChange[],
  issues: readonly AiIssueRetentionCandidate[],
  previousDirtyRanges: readonly AiProseOffsetRange[] = [],
): AiIssueRetentionPlan | undefined {
  const normalized = normalizeTextChanges(oldSource, newSource, changes);
  if (normalized === undefined) {
    return undefined;
  }

  const oldProse = extractAiProseDocument(oldSource);
  const newProse = extractAiProseDocument(newSource);
  const oldSentences = aiProseSentenceSegments(oldProse);
  const newSentences = aiProseSentenceSegments(newProse);
  const oldDirty = uniqueSegments(normalized.flatMap((change) =>
    affectedSentences(oldSentences, change.oldStart, change.oldEnd)
  ));
  const directlyDirtyNew = uniqueSegments(normalized.flatMap((change) =>
    affectedSentences(newSentences, change.newStart, change.newEnd)
  ));

  const previousInvalidationRanges = normalizeRanges(
    previousDirtyRanges,
    oldSource.length,
  );
  if (previousInvalidationRanges === undefined) {
    return undefined;
  }
  const oldContextRanges = normalizeRanges([
    ...oldDirty.map(sourceRange),
    ...previousDirtyRanges,
  ], oldSource.length);
  if (oldContextRanges === undefined) {
    return undefined;
  }
  const projectedOldDirty = oldContextRanges
    .flatMap((range) => {
      const mapped = mapRangeEnvelope(range, normalized);
      return mapped === undefined
        ? []
        : affectedSentences(newSentences, mapped.start, mapped.end);
    });
  const dirtySegments = uniqueSegments([
    ...directlyDirtyNew,
    ...projectedOldDirty,
  ]);
  const dirtyRanges = normalizeRanges([
    ...normalized.map((change) => ({
      start: change.newStart,
      end: change.newEnd,
    })),
    ...previousDirtyRanges.flatMap((range) => {
      const mapped = mapRangeEnvelope(range, normalized);
      return mapped === undefined ? [] : [mapped];
    }),
  ], newSource.length);
  if (dirtyRanges === undefined) {
    return undefined;
  }

  const retained: AiIssueRetentionMapping[] = [];
  for (const issue of issues) {
    if (
      !validIssueCandidate(issue, oldSource) ||
      normalized.some((change) => textChangeInvalidatesIssue(issue, change)) ||
      rangesTouchAny(issue, previousInvalidationRanges)
    ) {
      continue;
    }
    const mapped = remapRangeStrict(issue, normalized);
    if (
      mapped === undefined ||
      rangesTouchAny(mapped, dirtyRanges) ||
      newSource.slice(mapped.start, mapped.end) !== issue.original ||
      !isRangeEditableInProse(mapped, newProse.segments)
    ) {
      continue;
    }
    retained.push({ key: issue.key, start: mapped.start, end: mapped.end });
  }

  return { retained, dirtyRanges, dirtySegments, prose: newProse };
}

/**
 * Decide whether an editor change directly invalidates an existing issue.
 *
 * Ordinary ranges use half-open intersection, but an insertion at either edge
 * of a non-empty issue must invalidate it. Editors can reduce a replacement
 * such as `one take` -> `one takes` to a zero-width `s` insertion exactly at
 * the old right edge. Treating that edge as unrelated would retain an already
 * applied issue whose old `original` is still a prefix of the new text.
 *
 * This deliberately does not change the general `rangesTouch` helper: dirty
 * range merging and issue-to-issue comparisons still need half-open semantics.
 */
function textChangeInvalidatesIssue(
  issue: AiIssueRetentionCandidate,
  change: NormalizedTextChange,
): boolean {
  if (change.oldStart === change.oldEnd) {
    if (issue.start === issue.end) {
      return change.oldStart === issue.start;
    }
    return change.oldStart >= issue.start && change.oldStart <= issue.end;
  }
  if (issue.start === issue.end) {
    return issue.start >= change.oldStart && issue.start < change.oldEnd;
  }
  return issue.start < change.oldEnd && issue.end > change.oldStart;
}

/**
 * Decide whether a previously retained issue must be replaced when a provider
 * response for a contextual sentence arrives. Only the locally dirty area or
 * a newly returned issue may supersede it; merely sharing the sentence is not
 * enough.
 */
export function shouldReplaceAiIssueAfterReview(
  existing: AiProseOffsetRange,
  dirtyRanges: readonly AiProseOffsetRange[],
  newIssueRanges: readonly AiProseOffsetRange[],
): boolean {
  return dirtyRanges.some((range) => rangesTouch(existing, range)) ||
    newIssueRanges.some((range) => rangesTouch(existing, range));
}

/** Resolve saved dirty sentence ranges against the current prose snapshot. */
export function selectAiProseSentenceSegmentsForRanges(
  prose: AiProseDocument,
  ranges: readonly AiProseOffsetRange[],
): readonly AiProseSegment[] {
  const sentences = aiProseSentenceSegments(prose);
  return uniqueSegments(ranges.flatMap((range) =>
    affectedSentences(sentences, range.start, range.end)
  ));
}

/**
 * Accumulate successful sentence reviews across provider calls and batches.
 *
 * Automatic review can split one dirty range across several sentence requests,
 * while a manual paragraph review can cover several sentence contexts at once.
 * Keeping this progress outside any one request prevents a partial failure from
 * leaving a dirty range permanently queued after the remaining request succeeds.
 */
export function advanceAiDirtyReviewProgress(
  prose: AiProseDocument,
  dirtyRanges: readonly AiProseOffsetRange[],
  previouslyReviewedSentenceKeys: ReadonlySet<string>,
  reviewedSegments: readonly AiProseSegment[],
): AiDirtyReviewProgress {
  const sentences = aiProseSentenceSegments(prose);
  const reviewedSentenceKeys = new Set(previouslyReviewedSentenceKeys);
  for (const sentence of sentences) {
    if (reviewedSegments.some((reviewed) =>
      reviewed.sourceStart <= sentence.sourceStart &&
      reviewed.sourceEnd >= sentence.sourceEnd
    )) {
      reviewedSentenceKeys.add(sentenceKey(sentence));
    }
  }

  const contextsByRange = dirtyRanges.map((range) =>
    affectedSentences(sentences, range.start, range.end)
  );
  const remainingRanges = dirtyRanges.filter((_range, index) => {
    const contexts = contextsByRange[index] ?? [];
    return contexts.length === 0 || contexts.some((sentence) =>
      !reviewedSentenceKeys.has(sentenceKey(sentence))
    );
  });

  // Retain only keys which can contribute to a remaining dirty range. This
  // bounds the progress set even when a large manual review covers many more
  // sentences than the locally edited region.
  const relevantKeys = new Set(
    remainingRanges.flatMap((range) =>
      affectedSentences(sentences, range.start, range.end).map(sentenceKey)
    ),
  );
  return {
    remainingRanges,
    reviewedSentenceKeys: new Set(
      [...reviewedSentenceKeys].filter((key) => relevantKeys.has(key)),
    ),
  };
}

function normalizeTextChanges(
  oldSource: string,
  newSource: string,
  changes: readonly AiIssueRetentionTextChange[],
): readonly NormalizedTextChange[] | undefined {
  if (changes.length === 0 || changes.length > MAX_RETENTION_TEXT_CHANGES) {
    return undefined;
  }
  const sorted = [...changes].sort((left, right) =>
    left.rangeOffset - right.rangeOffset || left.rangeLength - right.rangeLength
  );
  const normalized: NormalizedTextChange[] = [];
  const chunks: string[] = [];
  let oldCursor = 0;
  let delta = 0;
  let previousStart = -1;
  let previousEnd = -1;
  for (const change of sorted) {
    if (
      !isNonNegativeInteger(change.rangeOffset) ||
      !isNonNegativeInteger(change.rangeLength) ||
      typeof change.text !== 'string'
    ) {
      return undefined;
    }
    const oldStart = change.rangeOffset;
    const oldEnd = oldStart + change.rangeLength;
    if (
      !Number.isSafeInteger(oldEnd) ||
      oldEnd > oldSource.length ||
      oldStart < oldCursor ||
      oldStart === previousStart ||
      oldStart < previousEnd
    ) {
      return undefined;
    }
    chunks.push(oldSource.slice(oldCursor, oldStart), change.text);
    const newStart = oldStart + delta;
    const newEnd = newStart + change.text.length;
    if (!isNonNegativeInteger(newStart) || !isNonNegativeInteger(newEnd)) {
      return undefined;
    }
    normalized.push({ oldStart, oldEnd, newStart, newEnd, text: change.text });
    oldCursor = oldEnd;
    previousStart = oldStart;
    previousEnd = oldEnd;
    delta += change.text.length - change.rangeLength;
  }
  chunks.push(oldSource.slice(oldCursor));
  return chunks.join('') === newSource ? normalized : undefined;
}

function affectedSentences(
  sentences: readonly AiProseSegment[],
  start: number,
  end: number,
): readonly AiProseSegment[] {
  if (!isNonNegativeInteger(start) || !isNonNegativeInteger(end) || start > end) {
    return [];
  }
  const results: AiProseSegment[] = [];
  if (start === end) {
    let index = firstSentenceWithEnd(sentences, start, true);
    while (index < sentences.length) {
      const sentence = sentences[index];
      if (sentence === undefined || sentence.sourceStart > start) {
        break;
      }
      if (start >= sentence.sourceStart && start <= sentence.sourceEnd) {
        results.push(sentence);
      }
      index += 1;
    }
    return results;
  }
  let index = firstSentenceWithEnd(sentences, start, false);
  while (index < sentences.length) {
    const sentence = sentences[index];
    if (sentence === undefined || sentence.sourceStart >= end) {
      break;
    }
    if (start < sentence.sourceEnd && end > sentence.sourceStart) {
      results.push(sentence);
    }
    index += 1;
  }
  return results;
}

/**
 * Sentence segments are source-ordered and non-overlapping. Binary-searching
 * their monotonically increasing ends avoids scanning every sentence once per
 * content change in large documents.
 */
function firstSentenceWithEnd(
  sentences: readonly AiProseSegment[],
  offset: number,
  inclusive: boolean,
): number {
  let low = 0;
  let high = sentences.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const sentence = sentences[middle];
    if (
      sentence === undefined ||
      (inclusive ? sentence.sourceEnd >= offset : sentence.sourceEnd > offset)
    ) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

function mapRangeEnvelope(
  range: AiProseOffsetRange,
  changes: readonly NormalizedTextChange[],
): AiProseOffsetRange | undefined {
  if (
    !isNonNegativeInteger(range.start) ||
    !isNonNegativeInteger(range.end) ||
    range.start > range.end
  ) {
    return undefined;
  }
  const start = mapBoundary(range.start, 'left', changes);
  const end = mapBoundary(range.end, 'right', changes);
  return start === undefined || end === undefined || start > end
    ? undefined
    : { start, end };
}

function mapBoundary(
  offset: number,
  affinity: 'left' | 'right',
  changes: readonly NormalizedTextChange[],
): number | undefined {
  if (!isNonNegativeInteger(offset)) {
    return undefined;
  }
  const index = lastChangeStartingAtOrBefore(changes, offset);
  if (index < 0) {
    return offset;
  }
  const change = changes[index];
  if (change === undefined) {
    return undefined;
  }
  if (change.oldStart === change.oldEnd && offset === change.oldStart) {
    return affinity === 'left' ? change.newStart : change.newEnd;
  }
  if (offset === change.oldStart) {
    return change.newStart;
  }
  if (offset < change.oldEnd) {
    return affinity === 'left' ? change.newStart : change.newEnd;
  }
  if (offset === change.oldEnd) {
    return change.newEnd;
  }
  const mapped = offset + change.newEnd - change.oldEnd;
  return isNonNegativeInteger(mapped) ? mapped : undefined;
}

function remapRangeStrict(
  range: AiProseOffsetRange,
  changes: readonly NormalizedTextChange[],
): AiProseOffsetRange | undefined {
  if (
    !isNonNegativeInteger(range.start) ||
    !isNonNegativeInteger(range.end) ||
    range.start > range.end
  ) {
    return undefined;
  }
  if (range.start === range.end) {
    const mapped = mapZeroWidthRangeStrict(range.start, changes);
    return mapped === undefined ? undefined : { start: mapped, end: mapped };
  }

  const firstAtOrAfterStart = firstChangeStartingAtOrAfter(changes, range.start);
  const previous = changes[firstAtOrAfterStart - 1];
  if (
    previous !== undefined &&
    previous.oldStart !== previous.oldEnd &&
    previous.oldEnd > range.start
  ) {
    return undefined;
  }
  for (let index = firstAtOrAfterStart; index < changes.length; index += 1) {
    const change = changes[index];
    if (change === undefined || change.oldStart >= range.end) {
      break;
    }
    if (
      change.oldStart !== change.oldEnd ||
      change.oldStart > range.start
    ) {
      return undefined;
    }
  }
  const start = mapBoundary(range.start, 'right', changes);
  const end = mapBoundary(range.end, 'left', changes);
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return isNonNegativeInteger(start) && isNonNegativeInteger(end) && start <= end
    ? { start, end }
    : undefined;
}

function mapZeroWidthRangeStrict(
  offset: number,
  changes: readonly NormalizedTextChange[],
): number | undefined {
  const firstAtOrAfter = firstChangeStartingAtOrAfter(changes, offset);
  const previous = changes[firstAtOrAfter - 1];
  if (
    previous !== undefined &&
    previous.oldStart !== previous.oldEnd &&
    previous.oldEnd > offset
  ) {
    return undefined;
  }
  const atOffset = changes[firstAtOrAfter];
  if (atOffset !== undefined && atOffset.oldStart === offset) {
    return atOffset.oldStart === atOffset.oldEnd
      ? atOffset.newEnd
      : atOffset.newStart;
  }
  if (previous !== undefined && previous.oldEnd === offset) {
    return previous.newEnd;
  }
  const mapped = previous === undefined
    ? offset
    : offset + previous.newEnd - previous.oldEnd;
  return isNonNegativeInteger(mapped) ? mapped : undefined;
}

function firstChangeStartingAtOrAfter(
  changes: readonly NormalizedTextChange[],
  offset: number,
): number {
  let low = 0;
  let high = changes.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const change = changes[middle];
    if (change === undefined || change.oldStart >= offset) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

function lastChangeStartingAtOrBefore(
  changes: readonly NormalizedTextChange[],
  offset: number,
): number {
  let low = 0;
  let high = changes.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const change = changes[middle];
    if (change !== undefined && change.oldStart <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low - 1;
}

function validIssueCandidate(
  issue: AiIssueRetentionCandidate,
  source: string,
): boolean {
  return typeof issue.key === 'string' &&
    issue.key.length > 0 &&
    isNonNegativeInteger(issue.start) &&
    isNonNegativeInteger(issue.end) &&
    issue.start <= issue.end &&
    issue.end <= source.length &&
    typeof issue.original === 'string' &&
    source.slice(issue.start, issue.end) === issue.original;
}

function isRangeEditableInProse(
  range: AiProseOffsetRange,
  segments: readonly AiProseSegment[],
): boolean {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const segment = segments[middle];
    if (segment === undefined || segment.sourceEnd >= range.start) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  for (let index = low; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined || segment.sourceStart > range.start) {
      break;
    }
    if (range.end <= segment.sourceEnd) {
      return isAiIssueOffsetRangeEditable(range, [segment]);
    }
  }
  return false;
}

function rangesTouch(
  left: AiProseOffsetRange,
  right: AiProseOffsetRange,
): boolean {
  if (left.start === left.end && right.start === right.end) {
    return left.start === right.start;
  }
  if (left.start === left.end) {
    return left.start >= right.start && left.start < right.end;
  }
  if (right.start === right.end) {
    return right.start >= left.start && right.start < left.end;
  }
  return left.start < right.end && left.end > right.start;
}

function rangesTouchAny(
  range: AiProseOffsetRange,
  sortedRanges: readonly AiProseOffsetRange[],
): boolean {
  let low = 0;
  let high = sortedRanges.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const candidate = sortedRanges[middle];
    if (candidate === undefined || candidate.end >= range.start) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  for (let index = low; index < sortedRanges.length; index += 1) {
    const candidate = sortedRanges[index];
    if (candidate === undefined || candidate.start > range.end) {
      break;
    }
    if (rangesTouch(range, candidate)) {
      return true;
    }
  }
  return false;
}

/** Validate, sort, and coalesce ranges so their ends are monotonic. */
function normalizeRanges(
  ranges: readonly AiProseOffsetRange[],
  sourceLength: number,
): readonly AiProseOffsetRange[] | undefined {
  if (!isNonNegativeInteger(sourceLength)) {
    return undefined;
  }
  const sorted = [...ranges].sort((left, right) =>
    left.start - right.start || left.end - right.end
  );
  const merged: AiProseOffsetRange[] = [];
  for (const range of sorted) {
    if (
      !isNonNegativeInteger(range.start) ||
      !isNonNegativeInteger(range.end) ||
      range.start > range.end ||
      range.end > sourceLength
    ) {
      return undefined;
    }
    const previous = merged.at(-1);
    if (previous !== undefined && rangesCanCoalesce(previous, range)) {
      merged[merged.length - 1] = {
        start: previous.start,
        end: Math.max(previous.end, range.end),
      };
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

/** Preserve the inclusive meaning of zero-width dirty ranges at boundaries. */
function rangesCanCoalesce(
  previous: AiProseOffsetRange,
  current: AiProseOffsetRange,
): boolean {
  if (previous.start === current.start && previous.end === current.end) {
    return true;
  }
  const strictlyOverlap = previous.start < current.end && current.start < previous.end;
  if (strictlyOverlap) {
    return true;
  }
  const previousIsPoint = previous.start === previous.end;
  const currentIsPoint = current.start === current.end;
  return (
    previousIsPoint &&
    !currentIsPoint &&
    previous.start >= current.start &&
    previous.start < current.end
  ) || (
    currentIsPoint &&
    !previousIsPoint &&
    current.start >= previous.start &&
    current.start < previous.end
  );
}

function uniqueSegments(
  segments: readonly AiProseSegment[],
): readonly AiProseSegment[] {
  const unique = new Map<string, AiProseSegment>();
  for (const segment of segments) {
    unique.set(`${segment.sourceStart}:${segment.sourceEnd}`, segment);
  }
  return [...unique.values()].sort((left, right) =>
    left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
  );
}

function sourceRange(segment: AiProseSegment): AiProseOffsetRange {
  return { start: segment.sourceStart, end: segment.sourceEnd };
}

function sentenceKey(segment: AiProseSegment): string {
  return `${segment.sourceStart}:${segment.sourceEnd}`;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
