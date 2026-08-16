import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBibTeX } from '../src/core';
import {
  findEquivalentBibEntry,
  isSafeCitationKey,
  normalizeDoi,
  normalizedIsbns,
  referencesClearlyConflict,
} from '../src/referenceMatcher';
import type { ZoteroReference } from '../src/zoteroClient';

function reference(overrides: Partial<ZoteroReference> = {}): ZoteroReference {
  return {
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    container: 'NeurIPS',
    year: '2017',
    doi: '',
    isbn: '',
    citekey: 'vaswaniAttentionAllYou2017',
    libraryID: 1,
    ...overrides,
  };
}

test('reference identity matches exact keys and normalized DOI or ISBN values', () => {
  const entries = parseBibTeX(String.raw`
@article{ExistingKey,
  title = {A Revised Display Title},
  author = {Someone, Else},
  year = {2018},
  doi = {https://doi.org/10.48550/ARXIV.1706.03762}
}
@book{BookKey,
  title = {A Book},
  author = {Writer, Ada},
  year = {2020},
  isbn = {978-1-4028-9462-6}
}`);

  assert.equal(
    findEquivalentBibEntry(
      reference({ doi: 'doi:10.48550/arxiv.1706.03762' }),
      entries,
    )?.key,
    'ExistingKey',
  );
  assert.equal(
    findEquivalentBibEntry(
      reference({ doi: '', isbn: '9781402894626' }),
      entries,
    )?.key,
    'BookKey',
  );
  assert.equal(normalizeDoi(' HTTPS://doi.org/10.1000/Test. '), '10.1000/test');
  assert.deepEqual([...normalizedIsbns('0-306-40615-2; 978-1-4028-9462-6')], [
    '0306406152',
    '9781402894626',
  ]);
});

test('reference identity falls back to title, first-author tokens, and year', () => {
  const [entry] = parseBibTeX(String.raw`
@inproceedings{DifferentKey,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish and Shazeer, Noam},
  year = {2017}
}`);
  assert.ok(entry);
  assert.equal(findEquivalentBibEntry(reference(), [entry])?.key, 'DifferentKey');
  assert.equal(
    findEquivalentBibEntry(reference({ year: '2018' }), [entry]),
    undefined,
  );
  assert.equal(
    findEquivalentBibEntry(reference({ authors: ['Grace Hopper'] }), [entry]),
    undefined,
  );
});

test('unsafe existing keys are not reused in LaTeX and conflicting entries are detected', () => {
  const [unsafe, sameDoi, other] = parseBibTeX(String.raw`
@article{bad#key, title={Attention Is All You Need}, author={Vaswani, Ashish}, year={2017}}
@article{same, title={Old title}, year={2010}, doi={10.1000/shared}}
@article{other, title={Different title}, year={2020}}
}`);
  assert.ok(unsafe && sameDoi && other);
  assert.equal(findEquivalentBibEntry(reference(), [unsafe]), undefined);
  assert.equal(isSafeCitationKey('safe-key_2026'), true);
  assert.equal(isSafeCitationKey('bad#key'), false);

  const [exportedSameDoi, exportedConflict] = parseBibTeX(String.raw`
@article{same, title={New title}, year={2026}, doi={https://doi.org/10.1000/shared}}
@article{other, title={Another title}, year={2021}}
}`);
  assert.ok(exportedSameDoi && exportedConflict);
  assert.equal(referencesClearlyConflict(sameDoi, exportedSameDoi), false);
  assert.equal(referencesClearlyConflict(other, exportedConflict), true);
});
