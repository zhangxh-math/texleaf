/**
 * A small, dependency-free client for Better BibTeX's local JSON-RPC API.
 *
 * The endpoint is intentionally derived from a port and pinned to 127.0.0.1.
 * Do not make the host configurable: the API has access to a user's complete
 * Zotero library and is not intended to be contacted over the network.
 */

export const DEFAULT_ZOTERO_PORT = 23_119;
export const DEFAULT_ZOTERO_TIMEOUT_MS = 5_000;

const JSON_RPC_PATH = '/better-bibtex/json-rpc';
const ZOTERO_LOCAL_API_PATH = '/api';
const JSON_RPC_VERSION = '2.0';
const MAX_LEGACY_WRAPPER_DEPTH = 2;
const PERSONAL_LIBRARY_ID = 0;
const PERSONAL_LIBRARY_NAME = 'My Library';

type ZoteroBackend = 'better-bibtex' | 'zotero-local-api';

export type ZoteroLibrarySelector = string | number;

export type ZoteroExportFormat =
  | 'bibtex'
  | 'biblatex'
  | 'Better BibTeX'
  | 'Better BibLaTeX';

export interface ZoteroReady {
  readonly zotero: string;
  readonly betterbibtex: string;
}

export interface ZoteroLibrary {
  readonly id: number;
  readonly name: string;
}

export interface ZoteroReference {
  readonly title: string;
  readonly authors: readonly string[];
  readonly container: string;
  readonly year: string;
  readonly doi: string;
  readonly isbn: string;
  readonly citekey: string;
  readonly libraryID: number;
}

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  json(): Promise<unknown>;
}

export interface FetchRequestInitLike {
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal: AbortSignal;
}

/** A structural subset of global fetch, deliberately easy to mock in tests. */
export type FetchLike = (
  input: string,
  init: FetchRequestInitLike,
) => Promise<FetchResponseLike>;

export interface ZoteroClientOptions {
  readonly port?: number | string;
  readonly timeoutMs?: number;
  readonly library?: ZoteroLibrarySelector;
  readonly exportFormat?: ZoteroExportFormat;
  readonly fetch?: FetchLike;
}

export type ZoteroClientErrorKind =
  | 'configuration'
  | 'timeout'
  | 'connection'
  | 'not-found'
  | 'http'
  | 'rpc'
  | 'invalid-response'
  | 'library-not-found';

interface ZoteroClientErrorDetails {
  readonly code?: string | number;
  readonly status?: number;
  readonly rpcCode?: number;
  readonly rpcData?: unknown;
  readonly cause?: unknown;
}

export class ZoteroClientError extends Error {
  public readonly kind: ZoteroClientErrorKind;
  public readonly code: string | number;
  public readonly status?: number;
  public readonly rpcCode?: number;
  public readonly rpcData?: unknown;

  public constructor(
    kind: ZoteroClientErrorKind,
    message: string,
    details: ZoteroClientErrorDetails = {},
  ) {
    super(
      message,
      details.cause === undefined ? undefined : { cause: details.cause },
    );
    this.name = 'ZoteroClientError';
    this.kind = kind;
    this.code = details.code ?? kind;
    if (details.status !== undefined) {
      this.status = details.status;
    }
    if (details.rpcCode !== undefined) {
      this.rpcCode = details.rpcCode;
    }
    if (details.rpcData !== undefined) {
      this.rpcData = details.rpcData;
    }
  }
}

interface JsonRpcRequest {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly id: number;
  readonly method: string;
  readonly params: readonly unknown[];
}

type SearchCondition =
  | readonly ['ignore_feeds']
  | readonly ['itemType', 'isNot', 'attachment' | 'note', true]
  | readonly ['libraryID', 'is', number, true]
  | readonly ['quicksearch-titleCreatorYear', 'contains', string];

interface LocalReferenceResult {
  readonly reference: ZoteroReference;
  readonly exportText: string;
}

interface CslName {
  readonly literal?: unknown;
  readonly given?: unknown;
  readonly family?: unknown;
  readonly suffix?: unknown;
  readonly 'non-dropping-particle'?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    ? value
    : undefined;
}

function libraryIdentifier(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : undefined;
}

function parsePort(port: number | string): number {
  const parsed = typeof port === 'number'
    ? port
    : /^\d+$/.test(port)
      ? Number(port)
      : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new ZoteroClientError(
      'configuration',
      `Invalid Zotero port ${JSON.stringify(port)}; expected an integer from 1 to 65535.`,
      { code: 'invalid-port' },
    );
  }
  return parsed;
}

export function createBetterBibTeXEndpoint(
  port: number | string = DEFAULT_ZOTERO_PORT,
): string {
  const parsedPort = parsePort(port);
  const endpoint = new URL(`http://127.0.0.1:${parsedPort}${JSON_RPC_PATH}`);

  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') {
    throw new ZoteroClientError(
      'configuration',
      'The Better BibTeX endpoint must use the local loopback interface.',
      { code: 'non-loopback-endpoint' },
    );
  }
  return endpoint.toString();
}

export function createZoteroLocalApiEndpoint(
  port: number | string = DEFAULT_ZOTERO_PORT,
): string {
  const parsedPort = parsePort(port);
  const endpoint = new URL(`http://127.0.0.1:${parsedPort}${ZOTERO_LOCAL_API_PATH}/`);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') {
    throw new ZoteroClientError(
      'configuration',
      'The Zotero Local API endpoint must use the local loopback interface.',
      { code: 'non-loopback-endpoint' },
    );
  }
  return endpoint.toString();
}

function parseTimeout(timeoutMs: number): number {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new ZoteroClientError(
      'configuration',
      `Invalid Zotero timeout ${JSON.stringify(timeoutMs)}; expected a positive integer.`,
      { code: 'invalid-timeout' },
    );
  }
  return timeoutMs;
}

function globalFetch(): FetchLike {
  if (typeof globalThis.fetch !== 'function') {
    throw new ZoteroClientError(
      'configuration',
      'This extension host does not provide the global fetch API.',
      { code: 'fetch-unavailable' },
    );
  }

  return async (input, init) => globalThis.fetch(input, init);
}

function rpcError(
  method: string,
  error: unknown,
): ZoteroClientError {
  if (!isRecord(error)
    || typeof error.code !== 'number'
    || !Number.isFinite(error.code)
    || typeof error.message !== 'string') {
    return new ZoteroClientError(
      'invalid-response',
      `Better BibTeX returned an invalid JSON-RPC error for ${method}.`,
      { code: 'invalid-rpc-error' },
    );
  }

  return new ZoteroClientError(
    'rpc',
    `Better BibTeX JSON-RPC ${method} failed (${error.code}): ${error.message}`,
    {
      code: error.code,
      rpcCode: error.code,
      ...(own(error, 'data') ? { rpcData: error.data } : {}),
    },
  );
}

function maybeParseLegacyEnvelope(value: unknown): unknown {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== 'string' || !value.trimStart().startsWith('{')) {
    return value;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function unwrapJsonRpcResponse(
  payload: unknown,
  expectedId: number,
  method: string,
  depth = 0,
): unknown {
  if (!isRecord(payload) || payload.jsonrpc !== JSON_RPC_VERSION) {
    throw new ZoteroClientError(
      'invalid-response',
      `Better BibTeX returned an invalid JSON-RPC response for ${method}.`,
      { code: 'invalid-rpc-response' },
    );
  }

  if (own(payload, 'id')
    && payload.id !== null
    && payload.id !== expectedId) {
    throw new ZoteroClientError(
      'invalid-response',
      `Better BibTeX returned a mismatched JSON-RPC id for ${method}.`,
      { code: 'mismatched-rpc-id' },
    );
  }

  if (own(payload, 'error')) {
    throw rpcError(method, payload.error);
  }
  if (!own(payload, 'result')) {
    throw new ZoteroClientError(
      'invalid-response',
      `Better BibTeX omitted the JSON-RPC result for ${method}.`,
      { code: 'missing-rpc-result' },
    );
  }

  const result = maybeParseLegacyEnvelope(payload.result);
  if (depth < MAX_LEGACY_WRAPPER_DEPTH
    && isRecord(result)
    && result.jsonrpc === JSON_RPC_VERSION
    && (own(result, 'result') || own(result, 'error'))) {
    return unwrapJsonRpcResponse(result, expectedId, method, depth + 1);
  }
  return payload.result;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .join(', ');
  }
  return '';
}

function formatCslName(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const name = value as CslName;
  const literal = nonEmptyString(name.literal);
  if (literal !== undefined) {
    return literal;
  }

  const given = nonEmptyString(name.given);
  const family = nonEmptyString(name.family);
  const particle = nonEmptyString(name['non-dropping-particle']);
  const suffix = nonEmptyString(name.suffix);
  const familyWithParticle = [particle, family].filter((part) => part !== undefined).join(' ');
  const base = [given, familyWithParticle || undefined]
    .filter((part) => part !== undefined)
    .join(' ');
  if (base.length === 0) {
    return undefined;
  }
  return suffix === undefined ? base : `${base}, ${suffix}`;
}

function cslAuthors(record: Record<string, unknown>): readonly string[] {
  const creatorLists = [record.author, record.editor, record.translator];
  const creators = creatorLists.find((value) => Array.isArray(value) && value.length > 0);
  if (!Array.isArray(creators)) {
    return [];
  }
  return creators
    .map(formatCslName)
    .filter((name): name is string => name !== undefined);
}

function cslYear(record: Record<string, unknown>): string {
  const issued = record.issued;
  if (isRecord(issued)) {
    const dateParts = issued['date-parts'];
    if (Array.isArray(dateParts) && Array.isArray(dateParts[0])) {
      const year = dateParts[0][0];
      if (typeof year === 'number' && Number.isFinite(year)) {
        return String(Math.trunc(year));
      }
      if (typeof year === 'string') {
        return year.trim();
      }
    }
    const raw = nonEmptyString(issued.raw) ?? nonEmptyString(issued.literal);
    if (raw !== undefined) {
      const match = raw.match(/-?\d{4}/);
      return match?.[0] ?? raw;
    }
  }
  if (typeof issued === 'string') {
    const match = issued.match(/-?\d{4}/);
    return match?.[0] ?? issued.trim();
  }
  if (typeof record.year === 'number' && Number.isFinite(record.year)) {
    return String(Math.trunc(record.year));
  }
  return stringField(record, 'year');
}

function cslContainer(record: Record<string, unknown>): string {
  return stringField(record, 'container-title')
    || stringField(record, 'collection-title')
    || stringField(record, 'publisher');
}

function mapCslReference(
  value: unknown,
  fallbackLibraryID: number,
  index: number,
): ZoteroReference | undefined {
  if (!isRecord(value)) {
    throw new ZoteroClientError(
      'invalid-response',
      `Better BibTeX returned a non-object item at search result index ${index}.`,
      { code: 'invalid-search-item' },
    );
  }

  const itemType = nonEmptyString(value.itemType)?.toLocaleLowerCase('en-US')
    ?? nonEmptyString(value.type)?.toLocaleLowerCase('en-US');
  if (itemType === 'attachment' || itemType === 'note' || itemType === 'annotation') {
    return undefined;
  }

  const citekey = nonEmptyString(value.citekey)
    ?? nonEmptyString(value['citation-key'])
    ?? nonEmptyString(value.citationKey);
  if (citekey === undefined) {
    // Read-only and newly-created items can temporarily have no generated key.
    // They cannot be inserted into \cite{} or exported by item.export, so keep
    // the rest of a valid search result usable and omit only this entry.
    return undefined;
  }

  const libraryID = positiveInteger(value.libraryID)
    ?? positiveInteger(value.libraryId)
    ?? fallbackLibraryID;
  return {
    title: stringField(value, 'title'),
    authors: cslAuthors(value),
    container: cslContainer(value),
    year: cslYear(value),
    doi: stringField(value, 'DOI') || stringField(value, 'doi'),
    isbn: stringField(value, 'ISBN') || stringField(value, 'isbn'),
    citekey: citekey.replace(/^@/, ''),
    libraryID,
  };
}

function localExportFormat(format: ZoteroExportFormat): 'bibtex' | 'biblatex' {
  return format === 'biblatex' || format === 'Better BibLaTeX'
    ? 'biblatex'
    : 'bibtex';
}

function localExportCacheKey(
  libraryID: number,
  citekey: string,
  format: ZoteroExportFormat,
): string {
  return `${libraryID}\u0000${localExportFormat(format)}\u0000${citekey}`;
}

function parseExportedCitekey(exportText: string): string | undefined {
  const entry = /@(?!comment\b|string\b|preamble\b)[A-Za-z][A-Za-z0-9_-]*\s*[({]\s*([^,\s{}()]+)\s*,/iu
    .exec(exportText);
  return nonEmptyString(entry?.[1])?.replace(/^@/, '');
}

function localCreators(data: Record<string, unknown>): readonly string[] {
  if (!Array.isArray(data.creators)) {
    return [];
  }
  const creators = data.creators.filter(isRecord);
  const authors = creators.filter((creator) => creator.creatorType === 'author');
  const preferred = authors.length > 0 ? authors : creators;
  return preferred
    .map((creator) => {
      const literal = nonEmptyString(creator.name);
      if (literal !== undefined) {
        return literal;
      }
      const firstName = nonEmptyString(creator.firstName);
      const lastName = nonEmptyString(creator.lastName);
      const name = [firstName, lastName].filter((part) => part !== undefined).join(' ');
      return name.length > 0 ? name : undefined;
    })
    .filter((name): name is string => name !== undefined);
}

function localYear(item: Record<string, unknown>, data: Record<string, unknown>): string {
  const meta = isRecord(item.meta) ? item.meta : undefined;
  const value = nonEmptyString(meta?.parsedDate) ?? nonEmptyString(data.date);
  if (value === undefined) {
    return '';
  }
  return /-?\d{4}/u.exec(value)?.[0] ?? value;
}

function localContainer(data: Record<string, unknown>): string {
  for (const field of [
    'publicationTitle',
    'conferenceName',
    'bookTitle',
    'series',
    'websiteTitle',
    'publisher',
    'university',
  ]) {
    const value = stringField(data, field);
    if (value.length > 0) {
      return value;
    }
  }
  return '';
}

function mapLocalReference(
  value: unknown,
  libraryID: number,
  format: ZoteroExportFormat,
  index: number,
): LocalReferenceResult | undefined {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new ZoteroClientError(
      'invalid-response',
      `Zotero Local API returned an invalid item at index ${index}.`,
      { code: 'invalid-local-item' },
    );
  }
  const itemType = nonEmptyString(value.data.itemType)?.toLocaleLowerCase('en-US');
  if (itemType === 'attachment' || itemType === 'note' || itemType === 'annotation') {
    return undefined;
  }

  const exportField = localExportFormat(format);
  const exportText = typeof value[exportField] === 'string' ? value[exportField] : '';
  const citekey = parseExportedCitekey(exportText);
  if (citekey === undefined) {
    // Some non-bibliographic or temporarily incomplete Zotero records cannot
    // be exported. They cannot safely be inserted into \cite{}, so omit only
    // that record and keep the remainder of the library available.
    return undefined;
  }

  return {
    reference: {
      title: stringField(value.data, 'title'),
      authors: localCreators(value.data),
      container: localContainer(value.data),
      year: localYear(value, value.data),
      doi: stringField(value.data, 'DOI') || stringField(value.data, 'doi'),
      isbn: stringField(value.data, 'ISBN') || stringField(value.data, 'isbn'),
      citekey,
      libraryID,
    },
    exportText,
  };
}

function canUseLocalApiFallback(error: unknown): boolean {
  return error instanceof ZoteroClientError
    && (error.kind === 'not-found'
      || (error.kind === 'rpc' && error.rpcCode === -32_601));
}

function translatorFor(format: ZoteroExportFormat): 'Better BibTeX' | 'Better BibLaTeX' {
  switch (format) {
    case 'bibtex':
    case 'Better BibTeX':
      return 'Better BibTeX';
    case 'biblatex':
    case 'Better BibLaTeX':
      return 'Better BibLaTeX';
  }
}

function libraryNotFound(
  selector: ZoteroLibrarySelector | undefined,
  libraries: readonly ZoteroLibrary[],
  reason = 'was not found',
): ZoteroClientError {
  const available = libraries.length === 0
    ? 'No Zotero libraries are available.'
    : `Available libraries: ${libraries.map((library) => `${library.name} (${library.id})`).join(', ')}.`;
  return new ZoteroClientError(
    'library-not-found',
    selector === undefined
      ? available
      : `Zotero library ${JSON.stringify(selector)} ${reason}. ${available}`,
    { code: 'library-not-found' },
  );
}

export function selectZoteroLibrary(
  libraries: readonly ZoteroLibrary[],
  selector?: ZoteroLibrarySelector,
): ZoteroLibrary {
  if (selector === undefined) {
    const first = libraries[0];
    if (first === undefined) {
      throw libraryNotFound(selector, libraries);
    }
    return first;
  }

  if (typeof selector === 'number') {
    const id = libraryIdentifier(selector);
    if (id === undefined) {
      throw libraryNotFound(selector, libraries, 'is not a non-negative integer');
    }
    const match = libraries.find((library) => library.id === id);
    if (match === undefined) {
      throw libraryNotFound(selector, libraries);
    }
    return match;
  }

  const normalized = selector.trim();
  if (/^\d+$/.test(normalized)) {
    const id = Number(normalized);
    const match = libraries.find((library) => library.id === id);
    if (match === undefined) {
      throw libraryNotFound(selector, libraries);
    }
    return match;
  }

  // `user.groups(false)` returns `lib.name`, which is localized by Zotero.
  // TeXLeaf's portable default remains the documented English alias. Zotero's
  // own `Libraries.getAll()` puts the personal library first, so interpret
  // this special default as that first entry even on a Chinese/German/etc. UI.
  // A group literally named "My Library" can still be selected by numeric ID.
  if (normalized.toLocaleLowerCase('en-US') === PERSONAL_LIBRARY_NAME.toLocaleLowerCase('en-US')) {
    const personal = libraries[0];
    if (personal === undefined) {
      throw libraryNotFound(selector, libraries);
    }
    return personal;
  }

  const exact = libraries.filter((library) => library.name === normalized);
  const matches = exact.length > 0
    ? exact
    : libraries.filter((library) => library.name.toLocaleLowerCase() === normalized.toLocaleLowerCase());
  if (matches.length === 0) {
    throw libraryNotFound(selector, libraries);
  }
  if (matches.length > 1) {
    throw libraryNotFound(selector, libraries, 'is ambiguous; select it by numeric ID instead');
  }
  return matches[0]!;
}

export class ZoteroClient {
  public readonly endpoint: string;
  public readonly localApiEndpoint: string;
  public readonly timeoutMs: number;

  private readonly fetchImpl: FetchLike;
  private readonly configuredLibrary: ZoteroLibrarySelector | undefined;
  private readonly exportFormat: ZoteroExportFormat;
  private backend: ZoteroBackend = 'better-bibtex';
  private readyResult: ZoteroReady | undefined;
  private requestId = 0;
  private cachedLibraries: readonly ZoteroLibrary[] | undefined;
  private readonly localExports = new Map<string, string>();

  public constructor(options: ZoteroClientOptions = {}) {
    this.endpoint = createBetterBibTeXEndpoint(options.port ?? DEFAULT_ZOTERO_PORT);
    this.localApiEndpoint = createZoteroLocalApiEndpoint(options.port ?? DEFAULT_ZOTERO_PORT);
    this.timeoutMs = parseTimeout(options.timeoutMs ?? DEFAULT_ZOTERO_TIMEOUT_MS);
    this.fetchImpl = options.fetch ?? globalFetch();
    this.configuredLibrary = options.library;
    this.exportFormat = options.exportFormat ?? 'bibtex';
  }

  public async ready(): Promise<ZoteroReady> {
    if (this.readyResult !== undefined) {
      return this.readyResult;
    }

    try {
      const result = await this.callRpc('api.ready', []);
      if (!isRecord(result)
        || typeof result.zotero !== 'string'
        || typeof result.betterbibtex !== 'string') {
        throw new ZoteroClientError(
          'invalid-response',
          'Better BibTeX returned an invalid api.ready result.',
          { code: 'invalid-ready-result' },
        );
      }
      this.backend = 'better-bibtex';
      this.readyResult = {
        zotero: result.zotero,
        betterbibtex: result.betterbibtex,
      };
      return this.readyResult;
    } catch (error) {
      if (!canUseLocalApiFallback(error)) {
        throw error;
      }
    }

    this.useLocalApi();
    const probe = await this.localGet(
      this.localUrl('users/0/items/top', {
        format: 'json',
        include: 'data',
        limit: '1',
      }),
      'Zotero Local API readiness probe',
    );
    if (!Array.isArray(probe)) {
      throw new ZoteroClientError(
        'invalid-response',
        'Zotero Local API returned an invalid readiness response.',
        { code: 'invalid-local-ready-result' },
      );
    }
    this.readyResult = {
      zotero: 'Local API v3',
      betterbibtex: 'not installed (using Zotero export)',
    };
    return this.readyResult;
  }

  public async listLibraries(): Promise<readonly ZoteroLibrary[]> {
    if (this.cachedLibraries !== undefined) {
      return this.cachedLibraries;
    }

    if (this.backend === 'zotero-local-api') {
      return this.listLocalLibraries();
    }

    let result: unknown;
    try {
      result = await this.callRpc('user.groups', [false]);
    } catch (error) {
      if (!canUseLocalApiFallback(error)) {
        throw error;
      }
      this.useLocalApi();
      return this.listLocalLibraries();
    }
    if (!Array.isArray(result)) {
      throw new ZoteroClientError(
        'invalid-response',
        'Better BibTeX returned an invalid user.groups result.',
        { code: 'invalid-library-result' },
      );
    }

    const libraries = result.map((value, index): ZoteroLibrary => {
      if (!isRecord(value)) {
        throw new ZoteroClientError(
          'invalid-response',
          `Better BibTeX returned a non-object library at index ${index}.`,
          { code: 'invalid-library' },
        );
      }
      const id = positiveInteger(value.id);
      const name = nonEmptyString(value.name);
      if (id === undefined || name === undefined) {
        throw new ZoteroClientError(
          'invalid-response',
          `Better BibTeX returned an invalid library at index ${index}.`,
          { code: 'invalid-library' },
        );
      }
      return { id, name };
    });
    this.cachedLibraries = libraries;
    return libraries;
  }

  public async selectLibrary(
    selector: ZoteroLibrarySelector | undefined = this.configuredLibrary,
  ): Promise<ZoteroLibrary> {
    return selectZoteroLibrary(await this.listLibraries(), selector);
  }

  public async search(
    query = '',
    library: ZoteroLibrarySelector | undefined = this.configuredLibrary,
  ): Promise<readonly ZoteroReference[]> {
    const selectedLibrary = await this.selectLibrary(library);
    if (this.backend === 'zotero-local-api') {
      return this.searchLocal(query, selectedLibrary, this.exportFormat);
    }

    const terms: SearchCondition[] = [
      ['ignore_feeds'],
      ['itemType', 'isNot', 'attachment', true],
      ['itemType', 'isNot', 'note', true],
      ['libraryID', 'is', selectedLibrary.id, true],
    ];
    const normalizedQuery = query.trim();
    if (normalizedQuery.length > 0) {
      terms.push(['quicksearch-titleCreatorYear', 'contains', normalizedQuery]);
    }

    let result: unknown;
    try {
      result = await this.callRpc('item.search', [terms, selectedLibrary.id]);
    } catch (error) {
      if (!canUseLocalApiFallback(error)) {
        throw error;
      }
      this.useLocalApi();
      const localLibrary = await this.selectLibrary(library);
      return this.searchLocal(query, localLibrary, this.exportFormat);
    }
    if (!Array.isArray(result)) {
      throw new ZoteroClientError(
        'invalid-response',
        'Better BibTeX returned an invalid item.search result.',
        { code: 'invalid-search-result' },
      );
    }
    return result
      .map((value, index) => mapCslReference(value, selectedLibrary.id, index))
      .filter((reference): reference is ZoteroReference => reference !== undefined);
  }

  public async exportBibTeX(
    reference: Pick<ZoteroReference, 'citekey' | 'libraryID'>,
    format: ZoteroExportFormat = this.exportFormat,
  ): Promise<string> {
    const citekey = reference.citekey.trim().replace(/^@/, '');
    if (citekey.length === 0) {
      throw new ZoteroClientError(
        'configuration',
        'Cannot export a Zotero reference without a citation key.',
        { code: 'missing-citekey' },
      );
    }
    const libraryID = libraryIdentifier(reference.libraryID);
    if (libraryID === undefined) {
      throw new ZoteroClientError(
        'configuration',
        `Cannot export from invalid Zotero library ID ${JSON.stringify(reference.libraryID)}.`,
        { code: 'invalid-library-id' },
      );
    }

    if (this.backend === 'zotero-local-api') {
      return this.exportLocal(citekey, libraryID, format);
    }

    let result: unknown;
    try {
      result = await this.callRpc('item.export', [
        [citekey],
        translatorFor(format),
        libraryID,
      ]);
    } catch (error) {
      if (!canUseLocalApiFallback(error)) {
        throw error;
      }
      this.useLocalApi();
      return this.exportLocal(citekey, this.localFallbackLibraryID(libraryID), format);
    }
    if (typeof result !== 'string') {
      throw new ZoteroClientError(
        'invalid-response',
        'Better BibTeX returned a non-text item.export result.',
        { code: 'invalid-export-result' },
      );
    }
    return result;
  }

  private useLocalApi(): void {
    if (this.backend !== 'zotero-local-api') {
      this.backend = 'zotero-local-api';
      this.cachedLibraries = undefined;
    }
  }

  private localFallbackLibraryID(currentID: number): number {
    const configured = this.configuredLibrary;
    if (configured === undefined
      || (typeof configured === 'string'
        && configured.trim().toLocaleLowerCase('en-US')
          === PERSONAL_LIBRARY_NAME.toLocaleLowerCase('en-US'))) {
      return PERSONAL_LIBRARY_ID;
    }
    return currentID;
  }

  private async listLocalLibraries(): Promise<readonly ZoteroLibrary[]> {
    if (this.cachedLibraries !== undefined) {
      return this.cachedLibraries;
    }
    const result = await this.localGet(
      this.localUrl('users/0/groups', { format: 'json' }),
      'Zotero Local API groups',
    );
    if (!Array.isArray(result)) {
      throw new ZoteroClientError(
        'invalid-response',
        'Zotero Local API returned an invalid groups result.',
        { code: 'invalid-local-groups' },
      );
    }

    const libraries: ZoteroLibrary[] = [{
      id: PERSONAL_LIBRARY_ID,
      name: PERSONAL_LIBRARY_NAME,
    }];
    const seen = new Set<number>([PERSONAL_LIBRARY_ID]);
    for (let index = 0; index < result.length; index += 1) {
      const value = result[index];
      if (!isRecord(value)) {
        throw new ZoteroClientError(
          'invalid-response',
          `Zotero Local API returned a non-object group at index ${index}.`,
          { code: 'invalid-local-group' },
        );
      }
      const data = isRecord(value.data) ? value.data : value;
      const id = positiveInteger(data.id) ?? positiveInteger(value.id);
      const name = nonEmptyString(data.name) ?? nonEmptyString(value.name);
      if (id === undefined || name === undefined) {
        throw new ZoteroClientError(
          'invalid-response',
          `Zotero Local API returned an invalid group at index ${index}.`,
          { code: 'invalid-local-group' },
        );
      }
      if (!seen.has(id)) {
        seen.add(id);
        libraries.push({ id, name });
      }
    }
    this.cachedLibraries = libraries;
    return libraries;
  }

  private async searchLocal(
    query: string,
    library: ZoteroLibrary,
    format: ZoteroExportFormat,
  ): Promise<readonly ZoteroReference[]> {
    const prefix = library.id === PERSONAL_LIBRARY_ID
      ? 'users/0'
      : `groups/${library.id}`;
    const parameters: Record<string, string> = {
      format: 'json',
      include: `data,${localExportFormat(format)}`,
    };
    const normalizedQuery = query.trim();
    if (normalizedQuery.length > 0) {
      parameters.q = normalizedQuery;
      parameters.qmode = 'titleCreatorYear';
    }
    const result = await this.localGet(
      this.localUrl(`${prefix}/items/top`, parameters),
      'Zotero Local API item search',
    );
    if (!Array.isArray(result)) {
      throw new ZoteroClientError(
        'invalid-response',
        'Zotero Local API returned an invalid items result.',
        { code: 'invalid-local-items' },
      );
    }

    const references: ZoteroReference[] = [];
    for (let index = 0; index < result.length; index += 1) {
      const mapped = mapLocalReference(result[index], library.id, format, index);
      if (mapped === undefined) {
        continue;
      }
      references.push(mapped.reference);
      this.localExports.set(
        localExportCacheKey(library.id, mapped.reference.citekey, format),
        mapped.exportText,
      );
    }
    return references;
  }

  private async exportLocal(
    citekey: string,
    libraryID: number,
    format: ZoteroExportFormat,
  ): Promise<string> {
    const cacheKey = localExportCacheKey(libraryID, citekey, format);
    const cached = this.localExports.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const libraries = await this.listLocalLibraries();
    const library = selectZoteroLibrary(libraries, libraryID);
    await this.searchLocal('', library, format);
    const exported = this.localExports.get(cacheKey);
    if (exported === undefined) {
      throw new ZoteroClientError(
        'invalid-response',
        `Zotero Local API could not export citation key ${JSON.stringify(citekey)}.`,
        { code: 'missing-local-export' },
      );
    }
    return exported;
  }

  private localUrl(path: string, parameters: Readonly<Record<string, string>>): string {
    const url = new URL(path, this.localApiEndpoint);
    for (const [name, value] of Object.entries(parameters)) {
      url.searchParams.set(name, value);
    }
    return url.toString();
  }

  private async localGet(url: string, context: string): Promise<unknown> {
    return this.requestJson(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Zotero-API-Version': '3',
      },
    }, context);
  }

  private async callRpc(method: string, params: readonly unknown[]): Promise<unknown> {
    this.requestId = this.requestId >= Number.MAX_SAFE_INTEGER ? 1 : this.requestId + 1;
    const request: JsonRpcRequest = {
      jsonrpc: JSON_RPC_VERSION,
      id: this.requestId,
      method,
      params,
    };
    const payload = await this.requestJson(this.endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    }, `Better BibTeX JSON-RPC ${method}`);
    return unwrapJsonRpcResponse(payload, request.id, method);
  }

  private async requestJson(
    url: string,
    request: {
      readonly method: 'GET' | 'POST';
      readonly headers: Readonly<Record<string, string>>;
      readonly body?: string;
    },
    context: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    let didTimeout = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutError = new ZoteroClientError(
      'timeout',
      `Zotero did not respond within ${this.timeoutMs} ms. Make sure Zotero is running and local API access is enabled.`,
      { code: 'timeout' },
    );
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        didTimeout = true;
        controller.abort();
        reject(timeoutError);
      }, this.timeoutMs);
    });

    try {
      let response: FetchResponseLike;
      const init: FetchRequestInitLike = request.body === undefined
        ? {
            method: request.method,
            headers: request.headers,
            signal: controller.signal,
          }
        : {
            method: request.method,
            headers: request.headers,
            body: request.body,
            signal: controller.signal,
          };
      try {
        response = await Promise.race([
          this.fetchImpl(url, init),
          timeout,
        ]);
      } catch (error) {
        if (error instanceof ZoteroClientError) {
          throw error;
        }
        if (didTimeout || controller.signal.aborted) {
          throw timeoutError;
        }
        throw new ZoteroClientError(
          'connection',
          `Could not connect to Zotero at ${url}. Make sure Zotero is running.`,
          { code: 'connection', cause: error },
        );
      }

      if (response.status === 404) {
        throw new ZoteroClientError(
          'not-found',
          `${context} was not found at ${url} (HTTP 404).`,
          { code: 404, status: 404 },
        );
      }
      if (!response.ok) {
        const statusText = response.statusText.trim();
        throw new ZoteroClientError(
          'http',
          `${context} returned HTTP ${response.status}${statusText.length > 0 ? ` ${statusText}` : ''}.`,
          { code: response.status, status: response.status },
        );
      }

      let payload: unknown;
      try {
        payload = await Promise.race([response.json(), timeout]);
      } catch (error) {
        if (error instanceof ZoteroClientError) {
          throw error;
        }
        if (didTimeout || controller.signal.aborted) {
          throw timeoutError;
        }
        throw new ZoteroClientError(
          'invalid-response',
          `${context} returned invalid JSON.`,
          { code: 'invalid-json', cause: error },
        );
      }
      return payload;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
