import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_ISSUE_PERSISTENCE_SCHEMA,
  aiIssueSourceHash,
  createPersistedAiIssueRecord,
  parsePersistedAiIssueRecord,
  restorePersistedAiIssues,
  shouldCommitPersistedAiIssueRecord,
  type PersistedAiIssue,
} from '../src/core';

function issue(
  source: string,
  original: string,
  overrides: Partial<PersistedAiIssue> = {},
): PersistedAiIssue {
  const start = original.length === 0 ? source.length : source.indexOf(original);
  assert.ok(start >= 0);
  const fingerprint = start.toString(16).padStart(64, '0');
  return {
    id: `texleaf-ai-${fingerprint}`,
    fingerprint,
    start,
    end: start + original.length,
    original,
    replacement: original.length === 0 ? '.' : `better-${original}`,
    message: '建议修改',
    explanation: '中文说明',
    category: 'grammar',
    severity: 1,
    ...overrides,
  };
}

test('AI issue persistence restores exact-source ranges including insertions', () => {
  const source = 'This sentence has bad prose';
  const issues = [issue(source, 'bad'), issue(source, '')];
  const record = createPersistedAiIssueRecord(
    'file:///paper.tex',
    source,
    7,
    issues,
    1234,
  );
  assert.ok(record);
  assert.equal(record.schema, AI_ISSUE_PERSISTENCE_SCHEMA);
  assert.equal(record.sourceHash, aiIssueSourceHash(source));
  assert.equal('source' in record, false, 'the complete paper source is not persisted');

  const parsed = parsePersistedAiIssueRecord(
    JSON.stringify(record),
    'file:///paper.tex',
  );
  assert.ok(parsed);
  assert.deepEqual(restorePersistedAiIssues(parsed, source), {
    exactSource: true,
    issues,
  });
});

test('changed files never relocate issues even when an original is globally unique', () => {
  const oldSource = 'A unique typo remains. Common bad and bad.';
  const record = createPersistedAiIssueRecord(
    'file:///paper.tex',
    oldSource,
    1,
    [issue(oldSource, 'unique'), issue(oldSource, 'bad'), issue(oldSource, '')],
  );
  assert.ok(record);

  const moved = 'A prefix. A unique typo remains. Common bad and bad.';
  assert.deepEqual(restorePersistedAiIssues(record, moved), {
    exactSource: false,
    issues: [],
  });

  const unrelatedUnique = 'The reviewed sentence is gone. An unrelated unique word remains.';
  assert.deepEqual(restorePersistedAiIssues(record, unrelatedUnique), {
    exactSource: false,
    issues: [],
  }, 'a unique original elsewhere must not steal a stale suggestion');

  const protectedMath = String.raw`A prefix. $unique$ remains hidden.`;
  assert.deepEqual(
    restorePersistedAiIssues(record, protectedMath).issues,
    [],
    'an otherwise unique original inside math must fail closed',
  );
});

test('persistence drops a truncated issue when its replacement is already present', () => {
  const source = 'Note that if one takes the object.';
  const stale = issue(source, 'one take', {
    replacement: 'one takes',
  });
  const current = createPersistedAiIssueRecord(
    'file:///paper.tex',
    source,
    3,
    [stale],
    1234,
  );
  assert.ok(current);
  assert.deepEqual(current.issues, []);

  const legacyRecord = {
    ...current,
    issues: [stale],
  };
  assert.deepEqual(restorePersistedAiIssues(legacyRecord, source), {
    exactSource: true,
    issues: [],
  });
});

test('persistence freshness guard rejects an observed newer clear tombstone', () => {
  const source = 'Some bad prose.';
  const staleIssues = createPersistedAiIssueRecord(
    'file:///paper.tex',
    source,
    1,
    [issue(source, 'bad')],
    1_000,
  );
  const newerClear = createPersistedAiIssueRecord(
    'file:///paper.tex',
    source,
    2,
    [],
    1_001,
  );
  assert.ok(staleIssues);
  assert.ok(newerClear);

  assert.equal(
    shouldCommitPersistedAiIssueRecord(staleIssues, newerClear),
    false,
    'an observed newer tombstone must win over a queued stale issue list',
  );
  assert.equal(
    shouldCommitPersistedAiIssueRecord(
      { ...staleIssues, savedAt: newerClear.savedAt },
      newerClear,
    ),
    false,
    'same-millisecond payloads are ambiguous and must fail closed',
  );
});

test('persistence freshness guard permits only timestamp-newer queued states', () => {
  const source = 'Some bad prose.';
  const observed = createPersistedAiIssueRecord(
    'file:///paper.tex',
    source,
    1,
    [issue(source, 'bad')],
    2_000,
  );
  const laterClear = createPersistedAiIssueRecord(
    'file:///paper.tex',
    source,
    2,
    [],
    2_001,
  );
  assert.ok(observed);
  assert.ok(laterClear);

  assert.equal(shouldCommitPersistedAiIssueRecord(laterClear, observed), true);
  assert.equal(shouldCommitPersistedAiIssueRecord(laterClear, undefined), true);
  assert.equal(
    shouldCommitPersistedAiIssueRecord(observed, laterClear),
    false,
    'the guard applies symmetrically to stale clears and stale issue lists',
  );
});

test('persistence parsing rejects wrong URI, invalid schema and bad issue offsets', () => {
  const source = 'Some bad prose.';
  const record = createPersistedAiIssueRecord(
    'file:///paper.tex',
    source,
    1,
    [issue(source, 'bad')],
  );
  assert.ok(record);
  assert.equal(
    parsePersistedAiIssueRecord(JSON.stringify(record), 'file:///other.tex'),
    undefined,
  );
  assert.equal(
    parsePersistedAiIssueRecord(
      JSON.stringify({ ...record, schema: 999 }),
      record.uri,
    ),
    undefined,
  );
  assert.equal(
    parsePersistedAiIssueRecord(
      JSON.stringify({
        ...record,
        issues: [{ ...record.issues[0], end: source.length + 1 }],
      }),
      record.uri,
    ),
    undefined,
  );
  assert.equal(
    createPersistedAiIssueRecord(
      record.uri,
      source,
      1,
      [{ ...issue(source, 'bad'), original: 'mismatch' }],
    ),
    undefined,
  );
  assert.equal(
    parsePersistedAiIssueRecord(
      JSON.stringify({
        ...record,
        issues: [{ ...record.issues[0], replacement: String.raw`\\input{private}` }],
      }),
      record.uri,
    ),
    undefined,
    'a modified local cache must not bypass live TeX replacement validation',
  );
  assert.equal(
    parsePersistedAiIssueRecord(
      JSON.stringify({
        ...record,
        issues: [{ ...record.issues[0], message: 'misleading\u202econtrol' }],
      }),
      record.uri,
    ),
    undefined,
    'control and bidi text must remain invalid after restart',
  );
  assert.equal(
    parsePersistedAiIssueRecord(
      JSON.stringify({ ...record, savedAt: Date.now() + 24 * 60 * 60 * 1_000 }),
      record.uri,
    ),
    undefined,
    'a cache timestamp far in the future must not block later clears forever',
  );
  assert.equal(
    createPersistedAiIssueRecord(
      record.uri,
      source,
      1,
      [issue(source, 'bad')],
      Date.now() + 24 * 60 * 60 * 1_000,
    ),
    undefined,
  );
  assert.equal(
    parsePersistedAiIssueRecord(
      JSON.stringify({
        ...record,
        issues: [{
          ...record.issues[0],
          replacement: record.issues[0]?.original,
        }],
      }),
      record.uri,
    ),
    undefined,
    'a modified cache must not resurrect a no-op issue rejected online',
  );
});
