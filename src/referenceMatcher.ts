import {
  normalizeReferenceSearchText,
  type BibTeXEntry,
} from "./core";
import type { ZoteroReference } from "./zoteroClient";

export interface BibIdentityIndex {
  readonly entries: readonly BibTeXEntry[];
  readonly byKey: ReadonlyMap<string, BibTeXEntry>;
  readonly byDoi: ReadonlyMap<string, BibTeXEntry>;
  readonly byIsbn: ReadonlyMap<string, BibTeXEntry>;
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
      const match = index.byIsbn.get(isbn);
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
    const bibAuthorTokens = normalizedAuthorTokens(firstBibAuthor(entry.authors));
    return [...bibAuthorTokens].some((token) => authorTokens.has(token));
  });
}

/** Build once when matching a Zotero library against many bibliography items. */
export function createBibIdentityIndex(
  entries: readonly BibTeXEntry[],
): BibIdentityIndex {
  const usableEntries = entries.filter((entry) => isSafeCitationKey(entry.key));
  const byKey = new Map<string, BibTeXEntry>();
  const byDoi = new Map<string, BibTeXEntry>();
  const byIsbn = new Map<string, BibTeXEntry>();
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
      if (!byIsbn.has(isbn)) {
        byIsbn.set(isbn, entry);
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
  if (existingDoi.length > 0 && existingDoi === exportedDoi) {
    return false;
  }
  const existingIsbns = normalizedIsbns(existing.fields.isbn ?? "");
  if (
    [...normalizedIsbns(exported.fields.isbn ?? "")].some((isbn) =>
      existingIsbns.has(isbn),
    )
  ) {
    return false;
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
  return (
    existingYear.length > 0 &&
    exportedYear.length > 0 &&
    existingYear !== exportedYear
  );
}

export function normalizeDoi(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, "")
    .replace(/^doi\s*:\s*/u, "")
    .replace(/[\s.,;]+$/u, "");
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
  return (
    entryYear.length > 0 &&
    referenceYear.length > 0 &&
    entryYear !== referenceYear
  );
}
