import { createHash } from 'node:crypto';

import {
  aiIssueReplacementAlreadyPresent,
  extractAiProseDocument,
  type AiProseDocument,
} from './aiProse';
import { isAiIssueOffsetRangeEditable } from './aiIssueRanges';

export const AI_ISSUE_PERSISTENCE_SCHEMA = 1;
export const MAX_PERSISTED_AI_ISSUES = 2_048;
export const MAX_PERSISTED_AI_RECORD_BYTES = 2 * 1024 * 1024;

const MAX_URI_LENGTH = 8_192;
const MAX_ID_LENGTH = 256;
const MAX_ORIGINAL_LENGTH = 2_048;
// Keep the persisted format at least as strict as planAiProseIssues. A cache
// file is local but still untrusted input after restart; loading it must never
// bypass the live response validator's TeX/control-character protections.
const MAX_REPLACEMENT_LENGTH = 4_096;
const MAX_MESSAGE_LENGTH = 320;
const MAX_EXPLANATION_LENGTH = 1_024;
const MAX_CATEGORY_LENGTH = 128;
const MAX_FUTURE_SAVED_AT_SKEW_MS = 5 * 60 * 1_000;
const ISSUE_CATEGORIES = new Set([
  'spelling',
  'grammar',
  'punctuation',
  'word-choice',
  'clarity',
  'style',
  'consistency',
]);

export interface PersistedAiIssue {
  readonly id: string;
  readonly fingerprint: string;
  readonly start: number;
  readonly end: number;
  readonly original: string;
  readonly replacement: string;
  readonly message: string;
  readonly explanation: string;
  readonly category: string;
  readonly severity: number;
}

export interface PersistedAiIssueRecord {
  readonly schema: typeof AI_ISSUE_PERSISTENCE_SCHEMA;
  readonly uri: string;
  /** SHA-256 of the complete source. The source itself is deliberately absent. */
  readonly sourceHash: string;
  readonly sourceLength: number;
  readonly documentVersion: number;
  readonly savedAt: number;
  readonly issues: readonly PersistedAiIssue[];
}

export interface RestoredAiIssue extends PersistedAiIssue {
  readonly start: number;
  readonly end: number;
}

export interface RestoredAiIssueRecord {
  readonly exactSource: boolean;
  readonly issues: readonly RestoredAiIssue[];
}

/**
 * Decide whether a pending snapshot may replace the record observed directly
 * before its atomic rename. Equal timestamps are deliberately treated as a
 * conflict: without a shared writer identity there is no safe way to prove
 * that two different payloads with the same timestamp are causally ordered.
 *
 * This is a fail-closed pre-commit freshness guard, not a cross-process lock
 * or transactional compare-and-swap. A later local mutation can still be
 * scheduled above the observed high-water mark, while an already queued stale
 * payload is not artificially promoted over a tombstone it actually observed.
 */
export function shouldCommitPersistedAiIssueRecord(
  pending: Pick<PersistedAiIssueRecord, 'savedAt'>,
  observed: Pick<PersistedAiIssueRecord, 'savedAt'> | undefined,
): boolean {
  return observed === undefined || pending.savedAt > observed.savedAt;
}

export function aiIssueSourceHash(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function createPersistedAiIssueRecord(
  uri: string,
  source: string,
  documentVersion: number,
  issues: readonly PersistedAiIssue[],
  savedAt = Date.now(),
): PersistedAiIssueRecord | undefined {
  if (
    !validBoundedString(uri, MAX_URI_LENGTH, false) ||
    !nonNegativeInteger(documentVersion) ||
    !validSavedAt(savedAt) ||
    issues.length > MAX_PERSISTED_AI_ISSUES
  ) {
    return undefined;
  }
  const validated = validateIssues(issues, source.length, source);
  if (validated === undefined) {
    return undefined;
  }
  const currentIssues = validated.filter((issue) =>
    !aiIssueReplacementAlreadyPresent(
      source,
      issue.start,
      issue.end,
      issue.original,
      issue.replacement,
    )
  );
  return {
    schema: AI_ISSUE_PERSISTENCE_SCHEMA,
    uri,
    sourceHash: aiIssueSourceHash(source),
    sourceLength: source.length,
    documentVersion,
    savedAt,
    issues: currentIssues,
  };
}

export function parsePersistedAiIssueRecord(
  text: string,
  expectedUri: string,
  now = Date.now(),
): PersistedAiIssueRecord | undefined {
  if (
    new TextEncoder().encode(text).byteLength > MAX_PERSISTED_AI_RECORD_BYTES ||
    !validBoundedString(expectedUri, MAX_URI_LENGTH, false)
  ) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(value)) {
    return undefined;
  }
  const {
    schema,
    uri,
    sourceHash,
    sourceLength,
    documentVersion,
    savedAt,
    issues,
  } = value;
  if (
    schema !== AI_ISSUE_PERSISTENCE_SCHEMA ||
    uri !== expectedUri ||
    typeof sourceHash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(sourceHash) ||
    !nonNegativeInteger(sourceLength) ||
    !nonNegativeInteger(documentVersion) ||
    !validSavedAt(savedAt, now) ||
    !Array.isArray(issues) ||
    issues.length > MAX_PERSISTED_AI_ISSUES
  ) {
    return undefined;
  }
  const validated = validateIssues(issues, sourceLength);
  if (validated === undefined) {
    return undefined;
  }
  return {
    schema,
    uri,
    sourceHash,
    sourceLength,
    documentVersion,
    savedAt,
    issues: validated,
  };
}

/**
 * Restore without guessing. A cache is useful only for the exact complete
 * source snapshot which produced it. Even a globally unique `original` is not
 * a safe cross-source anchor: the reviewed occurrence may have been deleted
 * while an unrelated occurrence became unique elsewhere in the paper.
 */
export function restorePersistedAiIssues(
  record: PersistedAiIssueRecord,
  currentSource: string,
): RestoredAiIssueRecord {
  const exactSource = record.sourceLength === currentSource.length &&
    record.sourceHash === aiIssueSourceHash(currentSource);
  if (!exactSource) {
    return { exactSource: false, issues: [] };
  }
  const prose = extractAiProseDocument(currentSource);
  const restored: RestoredAiIssue[] = [];
  for (const issue of record.issues) {
    const mapped = exactIssueRange(issue, currentSource, prose);
    if (mapped !== undefined) {
      restored.push({ ...issue, ...mapped });
    }
  }
  return { exactSource, issues: restored };
}

function exactIssueRange(
  issue: PersistedAiIssue,
  source: string,
  prose: AiProseDocument,
): { start: number; end: number } | undefined {
  const range = { start: issue.start, end: issue.end };
  return source.slice(range.start, range.end) === issue.original &&
      !aiIssueReplacementAlreadyPresent(
        source,
        range.start,
        range.end,
        issue.original,
        issue.replacement,
      ) &&
      isAiIssueOffsetRangeEditable(range, prose.segments)
    ? range
    : undefined;
}

function validateIssues(
  values: readonly unknown[],
  sourceLength: number,
  source?: string,
): readonly PersistedAiIssue[] | undefined {
  const issues: PersistedAiIssue[] = [];
  const ids = new Set<string>();
  for (const value of values) {
    if (!isObject(value)) {
      return undefined;
    }
    const {
      id,
      fingerprint,
      start,
      end,
      original,
      replacement,
      message,
      explanation,
      category,
      severity,
    } = value;
    if (
      !validBoundedString(id, MAX_ID_LENGTH, false) ||
      !/^texleaf-ai-[a-f0-9]{64}$/u.test(id) ||
      !validBoundedString(fingerprint, MAX_ID_LENGTH, false) ||
      !/^[a-f0-9]{64}$/u.test(fingerprint) ||
      !nonNegativeInteger(start) ||
      !nonNegativeInteger(end) ||
      start > end ||
      end > sourceLength ||
      !validBoundedString(original, MAX_ORIGINAL_LENGTH, true) ||
      !validBoundedString(replacement, MAX_REPLACEMENT_LENGTH, true) ||
      !validBoundedString(message, MAX_MESSAGE_LENGTH, false) ||
      !validBoundedString(explanation, MAX_EXPLANATION_LENGTH, true) ||
      !validBoundedString(category, MAX_CATEGORY_LENGTH, false) ||
      !ISSUE_CATEGORIES.has(category) ||
      !nonNegativeInteger(severity) ||
      severity > 3 ||
      end - start !== original.length ||
      /[\r\n]/u.test(original) ||
      original === replacement ||
      unsafePersistedReplacement(replacement) ||
      unsafeDisplayText(message) ||
      unsafeDisplayText(explanation) ||
      (source !== undefined && source.slice(start, end) !== original) ||
      ids.has(id)
    ) {
      return undefined;
    }
    ids.add(id);
    issues.push({
      id,
      fingerprint,
      start,
      end,
      original,
      replacement,
      message,
      explanation,
      category,
      severity,
    });
  }
  return issues;
}

function unsafePersistedReplacement(value: string): boolean {
  return unsafeDisplayText(value) || /[\\{}$%#&_~^]/u.test(value);
}

function unsafeDisplayText(value: string): boolean {
  return /[\r\n\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u
    .test(value);
}

function validBoundedString(
  value: unknown,
  maximumLength: number,
  allowEmpty: boolean,
): value is string {
  return typeof value === 'string' &&
    value.length <= maximumLength &&
    (allowEmpty || value.length > 0);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validSavedAt(value: unknown, now = Date.now()): value is number {
  return nonNegativeInteger(value) &&
    nonNegativeInteger(now) &&
    Number(value) <= now + MAX_FUTURE_SAVED_AT_SKEW_MS;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
