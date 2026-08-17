export interface AiIssueOffsetRange {
  readonly start: number;
  readonly end: number;
}

export interface AiIssueSingleTextChange {
  readonly rangeOffset: number;
  readonly rangeLength: number;
  readonly insertedLength: number;
}

export interface AiIssueEditableSegment {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly editableRanges: readonly AiIssueOffsetRange[];
}

export interface AiAutomaticReviewTarget {
  readonly offset: number;
  readonly reason: 'edit' | 'navigation';
}

/** Keep an unchecked edit as the next idle-review target across cursor moves. */
export function choosePendingAiAutomaticReviewTarget(
  current: AiAutomaticReviewTarget | undefined,
  next: AiAutomaticReviewTarget,
): AiAutomaticReviewTarget {
  return current?.reason === 'edit' && next.reason === 'navigation'
    ? current
    : next;
}

/** Reserve one same-version automatic review without turning the cap into LRU. */
export function tryReserveAiAutomaticReviewKey(
  keys: Set<string>,
  key: string,
  maximumKeys: number,
): boolean {
  if (
    keys.has(key) ||
    !Number.isSafeInteger(maximumKeys) ||
    maximumKeys < 1 ||
    keys.size >= maximumKeys
  ) {
    return false;
  }
  keys.add(key);
  return true;
}

/**
 * Return true only when an issue is still wholly inside one currently
 * editable prose range. This deliberately fails closed when a surrounding
 * TeX edit has turned old prose into a comment, math, or verbatim/code text.
 */
export function isAiIssueOffsetRangeEditable(
  range: AiIssueOffsetRange,
  segments: readonly AiIssueEditableSegment[],
): boolean {
  if (
    !isNonNegativeInteger(range.start) ||
    !isNonNegativeInteger(range.end) ||
    range.start > range.end
  ) {
    return false;
  }
  const segment = segments.find(
    (candidate) =>
      range.start >= candidate.sourceStart &&
      range.end <= candidate.sourceEnd,
  );
  if (segment === undefined) {
    return false;
  }
  const relativeStart = range.start - segment.sourceStart;
  const relativeEnd = range.end - segment.sourceStart;
  if (relativeStart === relativeEnd) {
    const leftEditable = relativeStart > 0 && segment.editableRanges.some(
      (editable) =>
        relativeStart - 1 >= editable.start &&
        relativeStart - 1 < editable.end,
    );
    const rightEditable = relativeStart < segment.sourceEnd - segment.sourceStart &&
      segment.editableRanges.some(
        (editable) =>
          relativeStart >= editable.start && relativeStart < editable.end,
      );
    if (relativeStart === 0) {
      return rightEditable;
    }
    if (relativeStart === segment.sourceEnd - segment.sourceStart) {
      return leftEditable;
    }
    return leftEditable && rightEditable;
  }
  return segment.editableRanges.some(
    (editable) =>
      relativeStart >= editable.start && relativeEnd <= editable.end,
  );
}

/**
 * Move an issue range across one document change without guessing.
 *
 * A range that intersects replaced text, or contains a new insertion, is
 * invalidated. Ranges wholly before the change stay put; ranges wholly after
 * it move by the exact UTF-16 delta. Boundary insertions remain valid because
 * callers can separately invalidate the surrounding prose paragraph.
 */
export function remapAiIssueOffsetRange(
  range: AiIssueOffsetRange,
  change: AiIssueSingleTextChange,
): AiIssueOffsetRange | undefined {
  if (
    !isNonNegativeInteger(range.start) ||
    !isNonNegativeInteger(range.end) ||
    range.start > range.end ||
    !isNonNegativeInteger(change.rangeOffset) ||
    !isNonNegativeInteger(change.rangeLength) ||
    !isNonNegativeInteger(change.insertedLength)
  ) {
    return undefined;
  }

  const changeStart = change.rangeOffset;
  const changeEnd = changeStart + change.rangeLength;
  if (!Number.isSafeInteger(changeEnd)) {
    return undefined;
  }

  if (change.rangeLength === 0) {
    if (changeStart <= range.start) {
      return shifted(range, change.insertedLength);
    }
    if (changeStart >= range.end) {
      return range;
    }
    return undefined;
  }

  if (range.end <= changeStart) {
    return range;
  }
  const delta = change.insertedLength - change.rangeLength;
  if (range.start >= changeEnd) {
    return shifted(range, delta);
  }
  return undefined;
}

function shifted(
  range: AiIssueOffsetRange,
  delta: number,
): AiIssueOffsetRange | undefined {
  const start = range.start + delta;
  const end = range.end + delta;
  return isNonNegativeInteger(start) && isNonNegativeInteger(end) && start <= end
    ? { start, end }
    : undefined;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
