/**
 * Resolves model-produced text offsets without ever using fuzzy text matching.
 *
 * Language models routinely count Unicode code points or UTF-8 bytes even when
 * asked for JavaScript UTF-16 offsets. They can also count CRLF as one newline
 * and occasionally use one-based offsets. Every interpretation below must
 * still select an exact occurrence of `original`; conflicting interpretations
 * are rejected instead of guessing which occurrence the model intended.
 */

export type IssueLocationFailureCode =
  | 'invalid-issue-offset'
  | 'issue-original-not-found'
  | 'issue-location-ambiguous';

export interface ResolvedIssueLocation {
  readonly ok: true;
  readonly start: number;
  readonly end: number;
}

export interface RejectedIssueLocation {
  readonly ok: false;
  readonly code: IssueLocationFailureCode;
}

export type IssueLocationResult = ResolvedIssueLocation | RejectedIssueLocation;

interface CoordinateView {
  readonly text: string;
  readonly toSourceOffset: readonly number[];
  readonly utf8Safe: boolean;
}

interface OffsetPair {
  readonly start: number;
  readonly end: number;
}

function hasUnpairedSurrogate(text: string): boolean {
  for (let offset = 0; offset < text.length; offset += 1) {
    const codeUnit = text.charCodeAt(offset);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = text.charCodeAt(offset + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      offset += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function sourceView(text: string): CoordinateView {
  return {
    text,
    toSourceOffset: Array.from({ length: text.length + 1 }, (_unused, offset) => offset),
    utf8Safe: !hasUnpairedSurrogate(text),
  };
}

/** Makes CRLF one coordinate unit while retaining exact source boundaries. */
function lfNormalizedView(text: string): CoordinateView {
  let normalized = '';
  const toSourceOffset: number[] = [0];
  let sourceOffset = 0;
  while (sourceOffset < text.length) {
    if (text[sourceOffset] === '\r' && text[sourceOffset + 1] === '\n') {
      normalized += '\n';
      sourceOffset += 2;
    } else {
      normalized += text[sourceOffset]!;
      sourceOffset += 1;
    }
    toSourceOffset.push(sourceOffset);
  }
  return {
    text: normalized,
    toSourceOffset,
    utf8Safe: !hasUnpairedSurrogate(normalized),
  };
}

function utf16Offset(view: CoordinateView, offset: number): number | undefined {
  if (offset < 0 || offset > view.text.length) {
    return undefined;
  }
  return view.toSourceOffset[offset];
}

function codePointOffset(view: CoordinateView, offset: number): number | undefined {
  if (offset < 0) {
    return undefined;
  }
  let codePoints = 0;
  let utf16 = 0;
  if (offset === 0) {
    return view.toSourceOffset[0];
  }
  for (const character of view.text) {
    codePoints += 1;
    utf16 += character.length;
    if (codePoints === offset) {
      return view.toSourceOffset[utf16];
    }
  }
  return undefined;
}

function utf8Width(character: string): number {
  const codePoint = character.codePointAt(0)!;
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

function utf8ByteOffset(view: CoordinateView, offset: number): number | undefined {
  if (offset < 0) {
    return undefined;
  }
  let bytes = 0;
  let utf16 = 0;
  if (offset === 0) {
    return view.toSourceOffset[0];
  }
  for (const character of view.text) {
    bytes += utf8Width(character);
    utf16 += character.length;
    if (bytes === offset) {
      return view.toSourceOffset[utf16];
    }
    if (bytes > offset) {
      return undefined;
    }
  }
  return undefined;
}

function exactCandidate(
  text: string,
  original: string,
  view: CoordinateView,
  pair: OffsetPair,
  converter: (view: CoordinateView, offset: number) => number | undefined,
): OffsetPair | undefined {
  const start = converter(view, pair.start);
  const end = converter(view, pair.end);
  if (start === undefined || end === undefined || start >= end
    || text.slice(start, end) !== original) {
    return undefined;
  }
  return { start, end };
}

function allExactOccurrences(text: string, original: string): readonly OffsetPair[] {
  const occurrences: OffsetPair[] = [];
  let from = 0;
  while (from <= text.length - original.length) {
    const start = text.indexOf(original, from);
    if (start < 0) {
      break;
    }
    occurrences.push({ start, end: start + original.length });
    from = start + 1;
  }
  return occurrences;
}

/**
 * Reconciles an issue range with its exact original text.
 *
 * This function never normalizes case, quotes, whitespace, or Unicode. A result
 * is returned only when all viable coordinate interpretations collapse to one
 * exact UTF-16 source range, or when `original` occurs exactly once in `text`.
 */
export function resolveIssueLocation(
  text: string,
  rawStart: unknown,
  rawEnd: unknown,
  original: string,
): IssueLocationResult {
  if (!Number.isSafeInteger(rawStart) || !Number.isSafeInteger(rawEnd)
    || (rawStart as number) < 0 || (rawEnd as number) <= (rawStart as number)) {
    return { ok: false, code: 'invalid-issue-offset' };
  }

  const zeroBased = { start: rawStart as number, end: rawEnd as number };
  const coordinatePairs: OffsetPair[] = [zeroBased];
  if (zeroBased.start > 0 && zeroBased.end > 0) {
    coordinatePairs.push({ start: zeroBased.start - 1, end: zeroBased.end - 1 });
  }

  const rawView = sourceView(text);
  const normalizedView = lfNormalizedView(text);
  const views = normalizedView.text === rawView.text
    ? [rawView]
    : [rawView, normalizedView];
  const converters = [utf16Offset, codePointOffset, utf8ByteOffset] as const;
  const candidates = new Map<string, OffsetPair>();

  for (const pair of coordinatePairs) {
    for (const view of views) {
      for (const converter of converters) {
        if (converter === utf8ByteOffset && !view.utf8Safe) {
          continue;
        }
        const candidate = exactCandidate(text, original, view, pair, converter);
        if (candidate !== undefined) {
          candidates.set(`${candidate.start}:${candidate.end}`, candidate);
        }
      }
    }
  }

  if (candidates.size === 1) {
    const candidate = candidates.values().next().value as OffsetPair;
    return { ok: true, ...candidate };
  }
  if (candidates.size > 1) {
    return { ok: false, code: 'issue-location-ambiguous' };
  }

  const occurrences = allExactOccurrences(text, original);
  if (occurrences.length === 1) {
    return { ok: true, ...occurrences[0]! };
  }
  if (occurrences.length > 1) {
    return { ok: false, code: 'issue-location-ambiguous' };
  }
  return { ok: false, code: 'issue-original-not-found' };
}
