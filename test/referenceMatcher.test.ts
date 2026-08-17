import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBibTeX } from '../src/core';
import {
  findEquivalentBibEntry,
  findImportCompatibleBibEntry,
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
      reference({
        title: 'A Book',
        authors: ['Ada Writer'],
        year: '2020',
        doi: '',
        isbn: '9781402894626',
      }),
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

test('shared book ISBNs do not collapse or reuse a different chapter', () => {
  const [chapterA, chapterB] = parseBibTeX(String.raw`
@incollection{ChapterA,
  title = {First Chapter},
  author = {Author, Alice},
  year = {2024},
  isbn = {978-1-4028-9462-6}
}
@incollection{ChapterB,
  title = {Second Chapter},
  author = {Writer, Bob},
  year = {2024},
  isbn = {978-1-4028-9462-6}
}`);
  assert.ok(chapterA && chapterB);

  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'ZoteroChapterB',
        title: 'Second Chapter',
        authors: ['Bob Writer'],
        year: '2024',
        doi: '',
        isbn: '9781402894626',
      }),
      [chapterA, chapterB],
    )?.key,
    'ChapterB',
  );
  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'ZoteroChapterC',
        title: 'Third Chapter',
        authors: ['Carol Editor'],
        year: '2024',
        doi: '',
        isbn: '9781402894626',
      }),
      [chapterA, chapterB],
    ),
    undefined,
  );

  const [sameKeyDifferentChapter] = parseBibTeX(String.raw`
@incollection{ChapterA,
  title = {Second Chapter},
  author = {Writer, Bob},
  year = {2024},
  isbn = {978-1-4028-9462-6}
}`);
  assert.ok(sameKeyDifferentChapter);
  assert.equal(
    referencesClearlyConflict(chapterA, sameKeyDifferentChapter),
    true,
    'a shared containing-volume ISBN must not override contradictory titles',
  );
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

test('BibTeX entries with the same key and metadata reject a different valid DOI', () => {
  const [existing, differentDoi, sameDoi] = parseBibTeX(String.raw`
@article{SharedDoiKey,
  title = {A Shared Result},
  author = {Smith, John},
  year = {2024},
  doi = {10.1000/original}
}
@article{SharedDoiKey,
  title = {A Shared Result},
  author = {Smith, John},
  year = {2024},
  doi = {10.1000/different}
}
@article{SharedDoiKey,
  title = {A Different Display Title},
  author = {Brown, Alice},
  year = {2025},
  doi = {https://doi.org/10.1000/ORIGINAL}
}`);
  assert.ok(existing && differentDoi && sameDoi);

  assert.equal(
    referencesClearlyConflict(existing, differentDoi),
    true,
    'two different valid DOIs must override otherwise identical metadata',
  );
  assert.equal(
    referencesClearlyConflict(existing, sameDoi),
    false,
    'the same normalized valid DOI remains authoritative',
  );
});

test('a same-key Zotero item cannot reuse a bibliography entry with a different valid DOI', () => {
  const [existing] = parseBibTeX(String.raw`
@article{SharedDoiKey,
  title = {A Shared Result},
  author = {Smith, John},
  year = {2024},
  doi = {10.1000/original}
}`);
  assert.ok(existing);

  const sharedMetadata = {
    citekey: 'SharedDoiKey',
    title: 'A Shared Result',
    authors: ['John Smith'],
    year: '2024',
  } as const;
  assert.equal(
    findEquivalentBibEntry(
      reference({ ...sharedMetadata, doi: '10.1000/different' }),
      [existing],
    ),
    undefined,
    'a contradictory valid DOI must prevent exact-key reuse',
  );
  assert.equal(
    findEquivalentBibEntry(
      reference({
        ...sharedMetadata,
        title: 'A Different Display Title',
        authors: ['Alice Brown'],
        year: '2025',
        doi: 'doi:10.1000/original',
      }),
      [existing],
    )?.key,
    'SharedDoiKey',
    'the same normalized valid DOI remains authoritative over other metadata',
  );
});

test('a cross-key title/year fallback rejects a contradictory valid DOI', () => {
  const [withDoi, withoutDoi] = parseBibTeX(String.raw`
@article{ExistingWithDoi,
  title = {A Shared Result},
  author = {Smith, John},
  year = {2024},
  doi = {10.1000/original}
}
@article{ExistingWithoutDoi,
  title = {A Conservative Match},
  author = {Smith, John},
  year = {2024}
}`);
  assert.ok(withDoi && withoutDoi);

  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'DifferentKey',
        title: 'A Shared Result',
        authors: ['John Smith'],
        year: '2024',
        doi: '10.1000/different',
      }),
      [withDoi],
    ),
    undefined,
    'title, year, and author must not override two contradictory valid DOIs',
  );
  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'DifferentKey',
        title: 'A Conservative Match',
        authors: ['John Smith'],
        year: '2024',
        doi: '10.1000/newly-supplied',
      }),
      [withoutDoi],
    )?.key,
    'ExistingWithoutDoi',
    'metadata fallback remains available when only the Zotero side has a DOI',
  );
});

test('a fresh export can veto a weak match made from stale DOI-less snapshot metadata', () => {
  const [existing, conflictingExport, matchingExport] = parseBibTeX(String.raw`
@article{ExistingKey,
  title = {A Shared Result},
  author = {Smith, John},
  year = {2024},
  doi = {10.1000/original}
}
@article{NewKey,
  title = {A Shared Result},
  author = {Smith, John},
  year = {2024},
  doi = {10.1000/different}
}
@article{NewKey,
  title = {A Shared Result},
  author = {Smith, John},
  year = {2024},
  doi = {https://doi.org/10.1000/ORIGINAL}
}`);
  assert.ok(existing && conflictingExport && matchingExport);
  const staleReference = reference({
    citekey: 'NewKey',
    title: 'A Shared Result',
    authors: ['John Smith'],
    year: '2024',
    doi: '',
  });

  assert.equal(
    findEquivalentBibEntry(staleReference, [existing])?.key,
    'ExistingKey',
    'the cached DOI-less snapshot alone still has a conservative metadata match',
  );
  assert.equal(
    findImportCompatibleBibEntry(
      staleReference,
      conflictingExport,
      [existing],
    ),
    undefined,
    'a contradictory DOI in the fresh export must force appending the exported entry',
  );
  assert.equal(
    findImportCompatibleBibEntry(
      staleReference,
      matchingExport,
      [existing],
    )?.key,
    'ExistingKey',
    'the same normalized DOI in the fresh export still permits safe key reuse',
  );
});

test('a shared ISBN fallback rejects a contradictory valid DOI', () => {
  const [withDoi, withoutDoi] = parseBibTeX(String.raw`
@incollection{ChapterWithDoi,
  title = {The Same Chapter},
  author = {Smith, John},
  year = {2024},
  isbn = {978-1-4028-9462-6},
  doi = {10.1000/original-chapter}
}
@incollection{ChapterWithoutDoi,
  title = {A Chapter Without DOI},
  author = {Smith, John},
  year = {2024},
  isbn = {978-1-4028-9462-6}
}`);
  assert.ok(withDoi && withoutDoi);

  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'DifferentChapterKey',
        title: 'The Same Chapter',
        authors: ['John Smith'],
        year: '2024',
        doi: '10.1000/different-chapter',
        isbn: '9781402894626',
      }),
      [withDoi],
    ),
    undefined,
    'shared ISBN and metadata must not override two contradictory valid DOIs',
  );
  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'DifferentChapterKey',
        title: 'A Chapter Without DOI',
        authors: ['John Smith'],
        year: '2024',
        doi: '10.1000/new-chapter-doi',
        isbn: '9781402894626',
      }),
      [withoutDoi],
    )?.key,
    'ChapterWithoutDoi',
    'ISBN metadata fallback remains conservative when the bibliography lacks a DOI',
  );
});

test('same key and generic metadata still conflict when first authors disagree', () => {
  const [existing, exported] = parseBibTeX(String.raw`
@article{SharedKey, title={Editorial Introduction}, author={Alpha, Alice}, year={2024}}
@article{SharedKey, title={Editorial Introduction}, author={Beta, Bob}, year={2024}}
}`);
  assert.ok(existing && exported);
  assert.equal(referencesClearlyConflict(existing, exported), true);
  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'SharedKey',
        title: 'Editorial Introduction',
        authors: ['Bob Beta'],
        year: '2024',
      }),
      [existing],
    ),
    undefined,
  );
});

test('same-key author conflicts compare family names before shared given names', () => {
  const [smith, brown, sameDoiBrown] = parseBibTeX(String.raw`
@article{SharedName,
  title = {Shared Title},
  author = {Smith, John},
  year = {2024}
}
@article{SharedName,
  title = {Shared Title},
  author = {Brown, John},
  year = {2024}
}
@article{SharedName,
  title = {Different Exported Title},
  author = {Brown, John},
  year = {2025},
  doi = {10.1000/shared-family-test}
}`);
  assert.ok(smith && brown && sameDoiBrown);

  assert.equal(
    referencesClearlyConflict(smith, brown),
    true,
    'a shared given name must not hide contradictory family names',
  );
  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'SharedName',
        title: 'Shared Title',
        authors: ['John Brown'],
        year: '2024',
      }),
      [smith],
    ),
    undefined,
    'a same-key Zotero item with a different family name must not reuse the entry',
  );

  const [sameDoiSmith] = parseBibTeX(String.raw`
@article{SharedName,
  title = {Original Title},
  author = {Smith, John},
  year = {2024},
  doi = {https://doi.org/10.1000/shared-family-test}
}`);
  assert.ok(sameDoiSmith);
  assert.equal(
    referencesClearlyConflict(sameDoiSmith, sameDoiBrown),
    false,
    'a matching valid DOI remains authoritative over conflicting author metadata',
  );
  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'SharedName',
        title: 'Different Zotero Title',
        authors: ['John Brown'],
        year: '2025',
        doi: 'doi:10.1000/shared-family-test',
      }),
      [sameDoiSmith],
    )?.key,
    'SharedName',
    'a valid matching DOI must also override exact-key metadata conflicts',
  );
});

test('invalid DOI placeholders never become authoritative reference identity', () => {
  const [existing, exported, spacedDoi] = parseBibTeX(String.raw`
@article{PlaceholderKey,
  title = {First Work},
  author = {Alpha, Alice},
  year = {2024},
  doi = {N/A}
}
@article{PlaceholderKey,
  title = {Second Work},
  author = {Beta, Bob},
  year = {2024},
  doi = {N/A}
}
@article{SpacedDoi,
  title = {A Different Work},
  author = {Gamma, Grace},
  year = {2023},
  doi = {10.1000/wrong work}
}`);
  assert.ok(existing && exported && spacedDoi);

  assert.equal(normalizeDoi('N/A'), '');
  assert.equal(normalizeDoi('unknown'), '');
  assert.equal(normalizeDoi('-'), '');
  assert.equal(normalizeDoi('10.1000/wrong work'), '');
  assert.equal(normalizeDoi('10.1000/wrong\u0000work'), '');
  assert.equal(
    referencesClearlyConflict(existing, exported),
    true,
    'a shared invalid DOI placeholder must not override contradictory metadata',
  );
  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'DifferentKey',
        title: 'Second Work',
        authors: ['Bob Beta'],
        year: '2024',
        doi: 'N/A',
      }),
      [existing],
    ),
    undefined,
    'an invalid Zotero DOI must not match a bibliography placeholder DOI',
  );
  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'ValidCompactDoi',
        title: 'Unrelated Valid Work',
        authors: ['Victor Valid'],
        year: '2025',
        doi: '10.1000/wrongwork',
      }),
      [spacedDoi],
    ),
    undefined,
    'internal whitespace must not be deleted to manufacture authoritative DOI identity',
  );
});

test('ISBN identity compares family names instead of a shared given name', () => {
  const [entry] = parseBibTeX(String.raw`
@book{SmithBook,
  title = {Shared Book Title},
  author = {Smith, John},
  year = {2024},
  isbn = {978-1-4028-9462-6}
}`);
  assert.ok(entry);

  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'BrownBook',
        title: 'Shared Book Title',
        authors: ['John Brown'],
        year: '2024',
        doi: '',
        isbn: '9781402894626',
      }),
      [entry],
    ),
    undefined,
    'a shared given name must not make different family names equivalent',
  );
  assert.equal(
    findEquivalentBibEntry(
      reference({
        citekey: 'SmithBookFromZotero',
        title: 'Shared Book Title',
        authors: ['John Smith'],
        year: '2024',
        doi: '',
        isbn: '9781402894626',
      }),
      [entry],
    )?.key,
    'SmithBook',
    'BibTeX comma form and Zotero given-family form must retain the same family identity',
  );
});
