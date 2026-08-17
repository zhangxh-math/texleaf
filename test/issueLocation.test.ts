import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveIssueLocation } from '../src/ai/issueLocation';

test('keeps an exact ASCII UTF-16 range', () => {
  assert.deepEqual(
    resolveIssueLocation('This are wrong.', 5, 8, 'are'),
    { ok: true, start: 5, end: 8 },
  );
});

test('maps Unicode code-point and UTF-8 byte offsets back to UTF-16', () => {
  assert.deepEqual(
    resolveIssueLocation('🙂 This are wrong.', 7, 10, 'are'),
    { ok: true, start: 8, end: 11 },
  );
  assert.deepEqual(
    resolveIssueLocation('é中 bad', 6, 9, 'bad'),
    { ok: true, start: 3, end: 6 },
  );
});

test('maps LF-normalized and combined CRLF plus code-point offsets', () => {
  assert.deepEqual(
    resolveIssueLocation('First\r\nbad', 6, 9, 'bad'),
    { ok: true, start: 7, end: 10 },
  );
  assert.deepEqual(
    resolveIssueLocation('🙂x\r\nbad', 3, 6, 'bad'),
    { ok: true, start: 5, end: 8 },
  );
});

test('accepts one-based offsets only when every exact interpretation is unambiguous', () => {
  assert.deepEqual(
    resolveIssueLocation('bad prose', 1, 4, 'bad'),
    { ok: true, start: 0, end: 3 },
  );
});

test('uses an exact unique-original fallback for otherwise wrong offsets', () => {
  assert.deepEqual(
    resolveIssueLocation('The result are clear.', 0, 3, 'are'),
    { ok: true, start: 11, end: 14 },
  );
});

test('rejects conflicting raw and code-point interpretations instead of guessing', () => {
  assert.deepEqual(
    resolveIssueLocation('😀😀😀badbad', 6, 9, 'bad'),
    { ok: false, code: 'issue-location-ambiguous' },
  );
});

test('rejects repeated unanchored originals and missing exact originals', () => {
  assert.deepEqual(
    resolveIssueLocation('bad prose; bad result', 99, 102, 'bad'),
    { ok: false, code: 'issue-location-ambiguous' },
  );
  assert.deepEqual(
    resolveIssueLocation('Cafe\u0301 is wrong.', 0, 4, 'Café'),
    { ok: false, code: 'issue-original-not-found' },
  );
  assert.deepEqual(
    resolveIssueLocation('bad  prose', 0, 9, 'bad prose'),
    { ok: false, code: 'issue-original-not-found' },
  );
});

test('does not use UTF-8 recovery for text containing an unpaired surrogate', () => {
  assert.deepEqual(
    resolveIssueLocation('\ud800badbad', 3, 6, 'bad'),
    { ok: false, code: 'issue-location-ambiguous' },
  );
});

test('rejects non-integer, negative, empty, and reversed ranges', () => {
  for (const [start, end] of [
    [0.5, 3],
    [-1, 2],
    [2, 2],
    [3, 2],
  ] as const) {
    assert.deepEqual(
      resolveIssueLocation('bad', start, end, 'bad'),
      { ok: false, code: 'invalid-issue-offset' },
    );
  }
});
