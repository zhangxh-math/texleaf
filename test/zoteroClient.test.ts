import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FetchLike,
  FetchRequestInitLike,
  FetchResponseLike,
  ZoteroClient,
  ZoteroClientError,
  createBetterBibTeXEndpoint,
  createZoteroLocalApiEndpoint,
} from '../src/zoteroClient';

interface CapturedRpcRequest {
  readonly jsonrpc: string;
  readonly id: number;
  readonly method: string;
  readonly params: readonly unknown[];
}

interface CapturedFetchCall {
  readonly input: string;
  readonly init: FetchRequestInitLike;
  readonly request: CapturedRpcRequest;
}

type RpcResponder = (request: CapturedRpcRequest) => unknown;

function response(payload: unknown, status = 200, statusText = 'OK'): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => payload,
  };
}

function result(request: CapturedRpcRequest, value: unknown): unknown {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: value,
  };
}

function rpcQueue(...responders: readonly RpcResponder[]): {
  readonly fetch: FetchLike;
  readonly calls: CapturedFetchCall[];
} {
  const calls: CapturedFetchCall[] = [];
  const queue = [...responders];
  const fetch: FetchLike = async (input, init) => {
    assert.equal(typeof init.body, 'string');
    const parsed: unknown = JSON.parse(init.body!);
    assert.equal(typeof parsed, 'object');
    assert.notEqual(parsed, null);
    const request = parsed as CapturedRpcRequest;
    calls.push({ input, init, request });
    const responder = queue.shift();
    assert.notEqual(responder, undefined, `unexpected JSON-RPC call ${request.method}`);
    return response(responder!(request));
  };
  return { fetch, calls };
}

function expectClientError(
  kind: ZoteroClientError['kind'],
  code?: string | number,
): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.equal(error instanceof ZoteroClientError, true);
    if (!(error instanceof ZoteroClientError)) {
      return false;
    }
    assert.equal(error.kind, kind);
    if (code !== undefined) {
      assert.equal(error.code, code);
    }
    return true;
  };
}

test('endpoint is derived from a validated port and pinned to IPv4 loopback', () => {
  assert.equal(
    createBetterBibTeXEndpoint('23120'),
    'http://127.0.0.1:23120/better-bibtex/json-rpc',
  );
  assert.equal(
    createZoteroLocalApiEndpoint('23120'),
    'http://127.0.0.1:23120/api/',
  );
  assert.throws(
    () => createBetterBibTeXEndpoint('23119/example.com'),
    expectClientError('configuration', 'invalid-port'),
  );
  assert.throws(
    () => new ZoteroClient({ port: 0, fetch: async () => response(undefined) }),
    expectClientError('configuration', 'invalid-port'),
  );
  assert.throws(
    () => new ZoteroClient({ timeoutMs: -1, fetch: async () => response(undefined) }),
    expectClientError('configuration', 'invalid-timeout'),
  );
});

test('api.ready uses the JSON-RPC POST contract and injected fetch', async () => {
  const mock = rpcQueue((request) => result(request, {
    zotero: '8.0.1',
    betterbibtex: '9.0.27',
  }));
  const client = new ZoteroClient({ port: 24_119, fetch: mock.fetch });

  assert.deepEqual(await client.ready(), {
    zotero: '8.0.1',
    betterbibtex: '9.0.27',
  });
  assert.equal(mock.calls.length, 1);
  const call = mock.calls[0]!;
  assert.equal(call.input, 'http://127.0.0.1:24119/better-bibtex/json-rpc');
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(call.init.headers, {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  assert.equal(call.init.signal instanceof AbortSignal, true);
  assert.deepEqual(call.request, {
    jsonrpc: '2.0',
    id: 1,
    method: 'api.ready',
    params: [],
  });
});

test('user.groups(false) is cached and libraries resolve by name or numeric string', async () => {
  const mock = rpcQueue((request) => result(request, [
    { id: 1, name: 'My Library' },
    { id: 42, name: 'Research Team' },
  ]));
  const client = new ZoteroClient({ library: 'Research Team', fetch: mock.fetch });

  assert.deepEqual(await client.listLibraries(), [
    { id: 1, name: 'My Library' },
    { id: 42, name: 'Research Team' },
  ]);
  assert.deepEqual(await client.selectLibrary(), { id: 42, name: 'Research Team' });
  assert.deepEqual(await client.selectLibrary('42'), { id: 42, name: 'Research Team' });
  assert.deepEqual(await client.selectLibrary('my library'), { id: 1, name: 'My Library' });
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0]!.request.method, 'user.groups');
  assert.deepEqual(mock.calls[0]!.request.params, [false]);
  await assert.rejects(client.selectLibrary('missing'), expectClientError('library-not-found'));
});

test('portable My Library default resolves the localized first BBT user library', async () => {
  const mock = rpcQueue((request) => result(request, [
    { id: 7, name: '我的文库' },
    { id: 42, name: '研究小组' },
  ]));
  const client = new ZoteroClient({ library: 'My Library', fetch: mock.fetch });

  assert.deepEqual(await client.selectLibrary(), { id: 7, name: '我的文库' });
  assert.deepEqual(await client.selectLibrary('42'), { id: 42, name: '研究小组' });
});

test('item.search scopes explicit ordinary-item filters and maps CSL-JSON fields', async () => {
  const mock = rpcQueue(
    (request) => result(request, [
      { id: 1, name: 'My Library' },
      { id: 42, name: 'Research Team' },
    ]),
    (request) => result(request, [
      {
        title: 'Analytical Engines',
        author: [
          { given: 'Ada', family: 'Lovelace' },
          { literal: 'Royal Society' },
        ],
        'container-title': 'Journal of Engines',
        issued: { 'date-parts': [[1843, 7]] },
        DOI: '10.1000/engines',
        ISBN: ['978-1-4028-9462-6'],
        citekey: '@Lovelace1843',
      },
      {
        title: 'Edited Work',
        author: [],
        editor: [{ family: 'Curie', given: 'Marie' }],
        publisher: 'Science Press',
        issued: { raw: 'published 1911' },
        'citation-key': 'Curie1911',
        libraryID: 42,
      },
      {
        itemType: 'annotation',
        title: 'Must not be shown',
        citekey: 'AnnotationKey',
      },
    ]),
  );
  const client = new ZoteroClient({ fetch: mock.fetch });

  assert.deepEqual(await client.search('  engines  ', 'Research Team'), [
    {
      title: 'Analytical Engines',
      authors: ['Ada Lovelace', 'Royal Society'],
      container: 'Journal of Engines',
      year: '1843',
      doi: '10.1000/engines',
      isbn: '978-1-4028-9462-6',
      citekey: 'Lovelace1843',
      libraryID: 42,
    },
    {
      title: 'Edited Work',
      authors: ['Marie Curie'],
      container: 'Science Press',
      year: '1911',
      doi: '',
      isbn: '',
      citekey: 'Curie1911',
      libraryID: 42,
    },
  ]);

  const searchRequest = mock.calls[1]!.request;
  assert.equal(searchRequest.method, 'item.search');
  assert.deepEqual(searchRequest.params, [
    [
      ['ignore_feeds'],
      ['itemType', 'isNot', 'attachment', true],
      ['itemType', 'isNot', 'note', true],
      ['libraryID', 'is', 42, true],
      ['quicksearch-titleCreatorYear', 'contains', 'engines'],
    ],
    42,
  ]);
});

test('empty search returns all ordinary keyed items and skips only keyless items', async () => {
  const mock = rpcQueue(
    (request) => result(request, [{ id: 1, name: 'My Library' }]),
    (request) => result(request, [
      { title: 'Keyed', citekey: 'Keyed2026', issued: { 'date-parts': [[2026]] } },
      { title: 'New item without a generated key', citekey: '' },
      { title: 'Read-only keyless item' },
    ]),
  );
  const client = new ZoteroClient({ fetch: mock.fetch });

  assert.deepEqual(await client.search('', 1), [{
    title: 'Keyed',
    authors: [],
    container: '',
    year: '2026',
    doi: '',
    isbn: '',
    citekey: 'Keyed2026',
    libraryID: 1,
  }]);
  assert.deepEqual(mock.calls[1]!.request.params, [
    [
      ['ignore_feeds'],
      ['itemType', 'isNot', 'attachment', true],
      ['itemType', 'isNot', 'note', true],
      ['libraryID', 'is', 1, true],
    ],
    1,
  ]);
});

test('missing Better BibTeX falls back to the official Zotero Local API', async () => {
  const bibtex = '@article{Lovelace1843,\n  title = {Analytical Engines}\n}\n';
  const calls: Array<{ readonly input: string; readonly init: FetchRequestInitLike }> = [];
  const fetch: FetchLike = async (input, init) => {
    calls.push({ input, init });
    const url = new URL(input);
    if (init.method === 'POST') {
      return response({}, 404, 'Not Found');
    }
    assert.deepEqual(init.headers, {
      Accept: 'application/json',
      'Zotero-API-Version': '3',
    });
    if (url.pathname === '/api/users/0/items/top' && url.searchParams.get('limit') === '1') {
      return response([]);
    }
    if (url.pathname === '/api/users/0/groups') {
      return response([{
        id: 42,
        data: { id: 42, name: '研究小组' },
      }]);
    }
    if (url.pathname === '/api/users/0/items/top') {
      assert.equal(url.searchParams.get('format'), 'json');
      assert.equal(url.searchParams.get('include'), 'data,bibtex');
      assert.equal(url.searchParams.has('limit'), false);
      return response([
        {
          key: 'AAAA1111',
          data: {
            itemType: 'journalArticle',
            title: 'Analytical Engines',
            creators: [
              { creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' },
              { creatorType: 'editor', firstName: 'Charles', lastName: 'Babbage' },
            ],
            publicationTitle: 'Scientific Memoirs',
            date: '1843-07',
            DOI: '10.1000/engine',
            ISBN: '978-1-4028-9462-6',
          },
          meta: { parsedDate: '1843-07-01' },
          bibtex,
        },
        {
          data: { itemType: 'annotation', title: 'Highlight' },
          bibtex: '@misc{ShouldNotAppear,}\n',
        },
        {
          data: { itemType: 'journalArticle', title: 'Cannot export yet' },
          bibtex: '',
        },
      ]);
    }
    throw new Error(`unexpected request ${input}`);
  };
  const client = new ZoteroClient({ library: 'My Library', fetch });

  assert.deepEqual(await client.ready(), {
    zotero: 'Local API v3',
    betterbibtex: 'not installed (using Zotero export)',
  });
  assert.deepEqual(await client.listLibraries(), [
    { id: 0, name: 'My Library' },
    { id: 42, name: '研究小组' },
  ]);
  assert.deepEqual(await client.selectLibrary(), { id: 0, name: 'My Library' });
  const references = await client.search('', 0);
  assert.deepEqual(references, [{
    title: 'Analytical Engines',
    authors: ['Ada Lovelace'],
    container: 'Scientific Memoirs',
    year: '1843',
    doi: '10.1000/engine',
    isbn: '978-1-4028-9462-6',
    citekey: 'Lovelace1843',
    libraryID: 0,
  }]);
  assert.equal(await client.exportBibTeX(references[0]!), bibtex);
  assert.equal(calls.length, 4, 'cached export must not make another Local API request');
});

test('Local API group search uses q/titleCreatorYear and native BibLaTeX export', async () => {
  const biblatex = '@article{Curie1911,\n  journaltitle = {Le Radium}\n}\n';
  const calls: string[] = [];
  const fetch: FetchLike = async (input, init) => {
    calls.push(input);
    const url = new URL(input);
    if (init.method === 'POST') {
      return response({}, 404, 'Not Found');
    }
    if (url.pathname === '/api/users/0/items/top' && url.searchParams.get('limit') === '1') {
      return response([]);
    }
    if (url.pathname === '/api/users/0/groups') {
      return response([{ data: { id: 42, name: 'Research Team' } }]);
    }
    if (url.pathname === '/api/groups/42/items/top') {
      assert.equal(url.searchParams.get('include'), 'data,biblatex');
      assert.equal(url.searchParams.get('q'), 'Curie radium');
      assert.equal(url.searchParams.get('qmode'), 'titleCreatorYear');
      return response([{
        data: {
          itemType: 'journalArticle',
          title: 'Research on Radium',
          creators: [{ creatorType: 'author', firstName: 'Marie', lastName: 'Curie' }],
          publicationTitle: 'Le Radium',
          date: '1911',
        },
        biblatex,
      }]);
    }
    throw new Error(`unexpected request ${input}`);
  };
  const client = new ZoteroClient({
    library: '42',
    exportFormat: 'biblatex',
    fetch,
  });

  await client.ready();
  const references = await client.search(' Curie radium ');
  assert.equal(references[0]?.citekey, 'Curie1911');
  assert.equal(references[0]?.libraryID, 42);
  assert.equal(await client.exportBibTeX(references[0]!), biblatex);
  assert.equal(calls.filter((url) => url.includes('/api/groups/42/items/top')).length, 1);
});

test('item.export selects Better BibTeX/BibLaTeX and accepts legacy wrapped results', async () => {
  const bibtex = '@article{Ada1843,\n  title = {Engines}\n}\n';
  const biblatex = '@article{Ada1843,\n  journaltitle = {Engines}\n}\n';
  const mock = rpcQueue(
    (request) => result(request, result(request, bibtex)),
    (request) => result(request, JSON.stringify(result(request, biblatex))),
  );
  const client = new ZoteroClient({ fetch: mock.fetch });
  const reference = { citekey: '@Ada1843', libraryID: 42 };

  assert.equal(await client.exportBibTeX(reference), bibtex);
  assert.equal(await client.exportBibTeX(reference, 'biblatex'), biblatex);
  assert.deepEqual(mock.calls[0]!.request.params, [
    ['Ada1843'],
    'Better BibTeX',
    42,
  ]);
  assert.deepEqual(mock.calls[1]!.request.params, [
    ['Ada1843'],
    'Better BibLaTeX',
    42,
  ]);
});

test('HTTP-200 JSON-RPC errors preserve their RPC code and data', async () => {
  const mock = rpcQueue((request) => ({
    jsonrpc: '2.0',
    id: request.id,
    error: {
      code: -32_602,
      message: 'Unknown library',
      data: { library: 99 },
    },
  }));
  const client = new ZoteroClient({ fetch: mock.fetch });

  await assert.rejects(client.ready(), (error: unknown): boolean => {
    assert.equal(error instanceof ZoteroClientError, true);
    if (!(error instanceof ZoteroClientError)) {
      return false;
    }
    assert.equal(error.kind, 'rpc');
    assert.equal(error.code, -32_602);
    assert.equal(error.rpcCode, -32_602);
    assert.deepEqual(error.rpcData, { library: 99 });
    assert.match(error.message, /Unknown library/);
    return true;
  });
});

test('invalid JSON-RPC payloads and malformed method results are rejected', async () => {
  const invalidEnvelope = rpcQueue(() => ({ result: { zotero: '8', betterbibtex: '9' } }));
  await assert.rejects(
    new ZoteroClient({ fetch: invalidEnvelope.fetch }).ready(),
    expectClientError('invalid-response', 'invalid-rpc-response'),
  );

  const invalidReady = rpcQueue((request) => result(request, { zotero: 8 }));
  await assert.rejects(
    new ZoteroClient({ fetch: invalidReady.fetch }).ready(),
    expectClientError('invalid-response', 'invalid-ready-result'),
  );

  const invalidJson: FetchLike = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => {
      throw new SyntaxError('not JSON');
    },
  });
  await assert.rejects(
    new ZoteroClient({ fetch: invalidJson }).ready(),
    expectClientError('invalid-response', 'invalid-json'),
  );
});

test('timeout, connection, and missing-endpoint failures have actionable kinds', async () => {
  const stalled: FetchLike = async (_input, init) => new Promise<FetchResponseLike>((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  await assert.rejects(
    new ZoteroClient({ fetch: stalled, timeoutMs: 5 }).ready(),
    expectClientError('timeout', 'timeout'),
  );

  const stalledBody: FetchLike = async (_input, init) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => new Promise<unknown>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('body aborted')), { once: true });
    }),
  });
  await assert.rejects(
    new ZoteroClient({ fetch: stalledBody, timeoutMs: 5 }).ready(),
    expectClientError('timeout', 'timeout'),
  );

  const disconnected: FetchLike = async () => {
    throw new TypeError('fetch failed: ECONNREFUSED');
  };
  await assert.rejects(
    new ZoteroClient({ fetch: disconnected }).ready(),
    expectClientError('connection', 'connection'),
  );

  const missing: FetchLike = async () => response({}, 404, 'Not Found');
  await assert.rejects(
    new ZoteroClient({ fetch: missing }).ready(),
    expectClientError('not-found', 404),
  );
});
