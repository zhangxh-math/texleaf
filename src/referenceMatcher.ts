import {
  normalizeReferenceSearchText,
  type BibTeXEntry,
} from "./core";
import type { ZoteroReference } from "./zoteroClient";

export interface BibIdentityIndex {
  readonly entries: readonly BibTeXEntry[];
  readonly byKey: ReadonlyMap<string, BibTeXEntry>;
  readonly byDoi: ReadonlyMap<string, BibTeXEntry>;
  /** ISBNs identify a containing book, so retain every chapter/title bucket. */
  readonly byIsbn: ReadonlyMap<string, readonly BibTeXEntry[]>;
  readonly byTitleYear: ReadonlyMap<string, readonly BibTeXEntry[]>;
}

/** True when a key can be inserted into a LaTeX citation argument verbatim. */
export function isSafeCitationKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 512 &&
    !/[\s,{}\\%#&$^~]/u.test(key) &&
    !/[\u0000-\u001f\u007f]/u.test(key)
  );
}

/**
 * Find an existing bibliography entry that represents the Zotero item, even
 * if the bibliography uses a different citation key.
 */
export function findEquivalentBibEntry(
  reference: ZoteroReference,
  entriesOrIndex: readonly BibTeXEntry[] | BibIdentityIndex,
): BibTeXEntry | undefined {
  const index = isBibIdentityIndex(entriesOrIndex)
    ? entriesOrIndex
    : createBibIdentityIndex(entriesOrIndex);
  const exactKey = index.byKey.get(reference.citekey);
  if (
    exactKey !== undefined &&
    !referenceMetadataClearlyConflicts(exactKey, reference)
  ) {
    return exactKey;
  }

  const doi = normalizeDoi(reference.doi);
  if (doi.length > 0) {
    const match = index.byDoi.get(doi);
    if (match !== undefined) {
      return match;
    }
  }

  const isbns = normalizedIsbns(reference.isbn);
  if (isbns.size > 0) {
    for (const isbn of isbns) {
      const match = (index.byIsbn.get(isbn) ?? []).find((entry) =>
        entry !== exactKey &&
        !referenceMetadataClearlyConflicts(entry, reference) &&
        isbnMetadataMatches(entry, reference)
      );
      if (match !== undefined) {
        return match;
      }
    }
  }

  const title = normalizeReferenceSearchText(reference.title);
  const year = normalizeReferenceSearchText(reference.year);
  const authorTokens = normalizedAuthorTokens(reference.authors[0] ?? "");
  if (title.length === 0 || year.length === 0 || authorTokens.size === 0) {
    return undefined;
  }
  return (index.byTitleYear.get(titleYearKey(title, year)) ?? []).find((entry) => {
    return entry !== exactKey &&
      !referenceMetadataClearlyConflicts(entry, reference) &&
      authorNamesHaveEvidenceOfMatch(
      firstBibAuthor(entry.authors),
      reference.authors[0] ?? "",
    );
  });
}

/**
 * Resolve a weak snapshot match only when the entry actually exported for this
 * import also agrees. Zotero can change after a cached completion was built;
 * the fresh export is therefore the final authority before an existing key is
 * reused instead of appending the exported entry.
 */
export function findImportCompatibleBibEntry(
  reference: ZoteroReference,
  exported: BibTeXEntry,
  entriesOrIndex: readonly BibTeXEntry[] | BibIdentityIndex,
): BibTeXEntry | undefined {
  const equivalent = findEquivalentBibEntry(reference, entriesOrIndex);
  return equivalent !== undefined &&
      !referencesClearlyConflict(equivalent, exported)
    ? equivalent
    : undefined;
}

/** Build once when matching a Zotero library against many bibliography items. */
export function createBibIdentityIndex(
  entries: readonly BibTeXEntry[],
): BibIdentityIndex {
  const usableEntries = entries.filter((entry) => isSafeCitationKey(entry.key));
  const byKey = new Map<string, BibTeXEntry>();
  const byDoi = new Map<string, BibTeXEntry>();
  const byIsbn = new Map<string, BibTeXEntry[]>();
  const byTitleYear = new Map<string, BibTeXEntry[]>();
  for (const entry of usableEntries) {
    if (!byKey.has(entry.key)) {
      byKey.set(entry.key, entry);
    }
    const doi = normalizeDoi(entry.fields.doi ?? "");
    if (doi.length > 0 && !byDoi.has(doi)) {
      byDoi.set(doi, entry);
    }
    for (const isbn of normalizedIsbns(entry.fields.isbn ?? "")) {
      const bucket = byIsbn.get(isbn);
      if (bucket === undefined) {
        byIsbn.set(isbn, [entry]);
      } else {
        bucket.push(entry);
      }
    }
    const title = normalizeReferenceSearchText(entry.title);
    const year = normalizeReferenceSearchText(entry.year);
    if (title.length > 0 && year.length > 0) {
      const key = titleYearKey(title, year);
      const bucket = byTitleYear.get(key);
      if (bucket === undefined) {
        byTitleYear.set(key, [entry]);
      } else {
        bucket.push(entry);
      }
    }
  }
  return { entries: usableEntries, byKey, byDoi, byIsbn, byTitleYear };
}

/** Detect a same-key collision while allowing authoritative identifier matches. */
export function referencesClearlyConflict(
  existing: BibTeXEntry,
  exported: BibTeXEntry,
): boolean {
  const existingDoi = normalizeDoi(existing.fields.doi ?? "");
  const exportedDoi = normalizeDoi(exported.fields.doi ?? "");
  if (existingDoi.length > 0 && exportedDoi.length > 0) {
    return existingDoi !== exportedDoi;
  }
  const existingTitle = normalizeReferenceSearchText(existing.title);
  const exportedTitle = normalizeReferenceSearchText(exported.title);
  if (
    existingTitle.length > 0 &&
    exportedTitle.length > 0 &&
    existingTitle !== exportedTitle
  ) {
    return true;
  }
  const existingYear = normalizeReferenceSearchText(existing.year);
  const exportedYear = normalizeReferenceSearchText(exported.year);
  if (
    existingYear.length > 0 &&
    exportedYear.length > 0 &&
    existingYear !== exportedYear
  ) {
    return true;
  }
  return authorNamesClearlyConflict(
    firstBibAuthor(existing.authors),
    firstBibAuthor(exported.authors),
  );
}

export function normalizeDoi(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, "")
    .replace(/^doi\s*:\s*/u, "")
    .replace(/[\s.,;]+$/u, "");
  return /^10\.\d{4,9}\/[^\s\p{C}]+$/u.test(normalized) && normalized.length <= 512
    ? normalized
    : "";
}

export function normalizedIsbns(value: string): ReadonlySet<string> {
  const result = new Set<string>();
  for (const part of value.split(/[,;]+/u)) {
    const isbn = part.toLocaleUpperCase("en-US").replace(/[^0-9X]/gu, "");
    if (isbn.length === 10 || isbn.length === 13) {
      result.add(isbn);
    }
  }
  return result;
}

function firstBibAuthor(authors: string): string {
  return authors.split(/\s+and\s+/iu)[0]?.trim() ?? "";
}

function isBibIdentityIndex(
  value: readonly BibTeXEntry[] | BibIdentityIndex,
): value is BibIdentityIndex {
  return !Array.isArray(value);
}

function titleYearKey(title: string, year: string): string {
  return `${title}\u0000${year}`;
}

function normalizedAuthorTokens(value: string): ReadonlySet<string> {
  return new Set(
    normalizeReferenceSearchText(value)
      .split(" ")
      .filter((token) => token.length >= 2),
  );
}

function referenceMetadataClearlyConflicts(
  entry: BibTeXEntry,
  reference: ZoteroReference,
): boolean {
  const entryDoi = normalizeDoi(entry.fields.doi ?? "");
  const referenceDoi = normalizeDoi(reference.doi);
  if (entryDoi.length > 0 && referenceDoi.length > 0) {
    return entryDoi !== referenceDoi;
  }
  const entryTitle = normalizeReferenceSearchText(entry.title);
  const referenceTitle = normalizeReferenceSearchText(reference.title);
  if (
    entryTitle.length > 0 &&
    referenceTitle.length > 0 &&
    entryTitle !== referenceTitle
  ) {
    return true;
  }
  const entryYear = normalizeReferenceSearchText(entry.year);
  const referenceYear = normalizeReferenceSearchText(reference.year);
  if (
    entryYear.length > 0 &&
    referenceYear.length > 0 &&
    entryYear !== referenceYear
  ) {
    return true;
  }
  return authorNamesClearlyConflict(
    firstBibAuthor(entry.authors),
    reference.authors[0] ?? "",
  );
}

/**
 * An ISBN alone is not a work identity: book chapters commonly share the
 * containing volume's ISBN. Require the normalized title to agree, and reject
 * contradictory year/first-author metadata when both sides provide it.
 */
function isbnMetadataMatches(
  entry: BibTeXEntry,
  reference: ZoteroReference,
): boolean {
  const entryTitle = normalizeReferenceSearchText(entry.title);
  const referenceTitle = normalizeReferenceSearchText(reference.title);
  if (
    entryTitle.length === 0 ||
    referenceTitle.length === 0 ||
    entryTitle !== referenceTitle
  ) {
    return false;
  }
  const entryYear = normalizeReferenceSearchText(entry.year);
  const referenceYear = normalizeReferenceSearchText(reference.year);
  if (
    entryYear.length > 0 &&
    referenceYear.length > 0 &&
    entryYear !== referenceYear
  ) {
    return false;
  }
  const entryAuthors = normalizedAuthorTokens(firstBibAuthor(entry.authors));
  const referenceAuthors = normalizedAuthorTokens(reference.authors[0] ?? "");
  const entryFamily = normalizedAuthorFamilyToken(firstBibAuthor(entry.authors));
  const referenceFamily = normalizedAuthorFamilyToken(reference.authors[0] ?? "");
  if (entryFamily !== undefined && referenceFamily !== undefined) {
    return entryFamily === referenceFamily;
  }
  return (
    entryAuthors.size === 0 ||
    referenceAuthors.size === 0 ||
    [...entryAuthors].some((token) => referenceAuthors.has(token))
  );
}

/**
 * BibTeX's comma form puts the family name first; ordinary Zotero/CSL display
 * names put it last. Comparing the last normalized token of the applicable
 * family-name segment avoids treating a shared given name as ISBN identity.
 * A one-character non-Latin family name remains useful, while a Latin initial
 * is too ambiguous to become an automatic identity signal.
 */
function normalizedAuthorFamilyToken(value: string): string | undefined {
  const familySegment = value.includes(",")
    ? value.slice(0, value.indexOf(","))
    : value;
  const tokens = normalizeReferenceSearchText(familySegment)
    .split(" ")
    .filter((token) => token.length > 0);
  const family = tokens[tokens.length - 1];
  if (family === undefined || /^[a-z0-9]$/u.test(family)) {
    return undefined;
  }
  return family;
}

function authorNamesClearlyConflict(left: string, right: string): boolean {
  const leftFamily = normalizedAuthorFamilyToken(left);
  const rightFamily = normalizedAuthorFamilyToken(right);
  if (leftFamily !== undefined && rightFamily !== undefined) {
    return leftFamily !== rightFamily;
  }
  return authorTokensClearlyConflict(
    normalizedAuthorTokens(left),
    normalizedAuthorTokens(right),
  );
}

function authorNamesHaveEvidenceOfMatch(left: string, right: string): boolean {
  const leftFamily = normalizedAuthorFamilyToken(left);
  const rightFamily = normalizedAuthorFamilyToken(right);
  if (leftFamily !== undefined && rightFamily !== undefined) {
    return leftFamily === rightFamily;
  }
  const leftTokens = normalizedAuthorTokens(left);
  const rightTokens = normalizedAuthorTokens(right);
  return [...leftTokens].some((token) => rightTokens.has(token));
}

function authorTokensClearlyConflict(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    left.size > 0 &&
    right.size > 0 &&
    ![...left].some((token) => right.has(token))
  );
}
