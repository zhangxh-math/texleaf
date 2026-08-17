import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_OPENAI_MODEL,
  OPENAI_RESPONSES_ENDPOINT,
  OpenAIClient,
  OpenAIClientError,
  OpenAIFetch,
  OpenAIFetchRequestInit,
  OpenAIFetchResponse,
  normalizeOpenAIBaseUrl,
  responsesEndpointFor,
} from '../src/ai/openaiClient';

interface CapturedCall {
  readonly input: string;
  readonly init: OpenAIFetchRequestInit;
  readonly body: Record<string, unknown>;
}

function httpResponse(
  payload: unknown,
  status = 200,
  options: {
    readonly raw?: string;
    readonly contentLength?: string;
    readonly onText?: () => void;
  } = {},
): OpenAIFetchResponse {
  const raw = options.raw ?? JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => name.toLowerCase() === 'content-length'
        ? options.contentLength ?? null
        : null,
    },
    text: async () => {
      options.onText?.();
      return raw;
    },
  };
}

function streamedHttpResponse(
  chunks: readonly Uint8Array[],
  options: {
    readonly onText?: () => void;
    readonly onRead?: () => void;
    readonly onCancel?: () => void;
  } = {},
): OpenAIFetchResponse {
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          options.onRead?.();
          const value = chunks[index];
          index += 1;
          return value === undefined
            ? { done: true }
            : { done: false, value };
        },
        cancel: async () => { options.onCancel?.(); },
      }),
    },
    text: async () => {
      options.onText?.();
      throw new Error('streaming responses must not call text()');
    },
  };
}

function responsePayload(
  content: string,
  options: {
    readonly status?: string;
    readonly model?: string;
    readonly usage?: unknown;
    readonly contentPart?: unknown;
    readonly output?: unknown;
  } = {},
): unknown {
  return {
    id: 'resp_test',
    object: 'response',
    status: options.status ?? 'completed',
    model: options.model ?? 'gpt-5.6-luna-2026-08-01',
    output: options.output ?? [{
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [options.contentPart ?? {
        type: 'output_text',
        text: content,
        annotations: [],
      }],
    }],
    ...(options.usage === undefined ? {} : { usage: options.usage }),
  };
}

function fetchQueue(...payloads: readonly unknown[]): {
  readonly fetch: OpenAIFetch;
  readonly calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const queue = [...payloads];
  const fetch: OpenAIFetch = async (input, init) => {
    const parsed: unknown = JSON.parse(init.body);
    assert.equal(typeof parsed, 'object');
    assert.notEqual(parsed, null);
    calls.push({ input, init, body: parsed as Record<string, unknown> });
    const payload = queue.shift();
    assert.notEqual(payload, undefined, 'unexpected OpenAI request');
    return httpResponse(payload);
  };
  return { fetch, calls };
}

function expectClientError(
  kind: OpenAIClientError['kind'],
  code?: string | number,
): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.equal(error instanceof OpenAIClientError, true);
    if (!(error instanceof OpenAIClientError)) {
      return false;
    }
    assert.equal(error.kind, kind);
    if (code !== undefined) {
      assert.equal(error.code, code);
    }
    return true;
  };
}

test('review uses the official Responses API strict structured-output contract', async () => {
  const source = 'This are bad.';
  const mock = fetchQueue(responsePayload(JSON.stringify({
    issues: [
      {
        start: 9,
        end: 12,
        original: 'bad',
        replacement: 'unclear',
        message: 'Use a more precise adjective.',
        explanation: 'Academic prose benefits from precise wording.',
        category: 'word-choice',
        severity: 'information',
      },
      {
        start: 5,
        end: 8,
        original: 'are',
        replacement: 'is',
        message: 'Subject–verb agreement.',
        explanation: 'The singular subject takes “is”.',
        category: 'grammar',
        severity: 'error',
      },
    ],
  }), {
    usage: {
      input_tokens: 100,
      output_tokens: 40,
      total_tokens: 140,
      input_tokens_details: { cached_tokens: 60 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  }));
  const client = new OpenAIClient({ apiKey: '  sk-test-key  ', fetch: mock.fetch });

  const result = await client.review(source, {
    language: 'English',
    style: 'concise academic',
  });

  assert.deepEqual(result, {
    model: 'gpt-5.6-luna-2026-08-01',
    issues: [
      {
        start: 5,
        end: 8,
        original: 'are',
        replacement: 'is',
        message: 'Subject–verb agreement.',
        explanation: 'The singular subject takes “is”.',
        category: 'grammar',
        severity: 'error',
      },
      {
        start: 9,
        end: 12,
        original: 'bad',
        replacement: 'unclear',
        message: 'Use a more precise adjective.',
        explanation: 'Academic prose benefits from precise wording.',
        category: 'word-choice',
        severity: 'information',
      },
    ],
    usage: {
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      cacheHitTokens: 60,
      cacheMissTokens: 40,
      reasoningTokens: 0,
    },
  });

  assert.equal(mock.calls.length, 1);
  const call = mock.calls[0]!;
  assert.equal(call.input, OPENAI_RESPONSES_ENDPOINT);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'error');
  assert.deepEqual(call.init.headers, {
    Accept: 'application/json',
    Authorization: 'Bearer sk-test-key',
    'Content-Type': 'application/json',
  });
  assert.equal(call.init.signal instanceof AbortSignal, true);
  assert.equal(call.body.model, DEFAULT_OPENAI_MODEL);
  assert.equal(call.body.store, false);
  assert.deepEqual(call.body.reasoning, { effort: 'none' });
  assert.equal(call.body.max_output_tokens, 6_144);
  assert.equal(JSON.stringify(call.body).includes('sk-test-key'), false);
  assert.match(String(call.body.instructions), /UTF-16/u);
  assert.match(String(call.body.instructions), /original must be non-empty/u);
  assert.match(String(call.body.instructions), /⟦DISPLAYED_FORMULA⟧/u);
  assert.match(String(call.body.instructions), /meaningful noun phrase or object/u);
  assert.match(String(call.body.instructions), /Simplified Chinese/u);
  assert.match(String(call.body.instructions), /Keep replacement in payload\.language/u);
  assert.deepEqual(JSON.parse(String(call.body.input)), {
    task: 'review',
    language: 'English',
    style: 'concise academic',
    text: source,
  });

  const text = call.body.text as { readonly format: Record<string, unknown> };
  assert.equal(text.format.type, 'json_schema');
  assert.equal(text.format.name, 'texleaf_review');
  assert.equal(text.format.strict, true);
  const schema = text.format.schema as Record<string, unknown>;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['issues']);
  const properties = schema.properties as Record<string, unknown>;
  const issues = properties.issues as Record<string, unknown>;
  const item = issues.items as Record<string, unknown>;
  assert.equal(item.additionalProperties, false);
  const issueProperties = item.properties as Record<string, Record<string, unknown>>;
  assert.equal(issueProperties.original?.minLength, 1);
  assert.deepEqual(item.required, [
    'start',
    'end',
    'original',
    'replacement',
    'message',
    'explanation',
    'category',
    'severity',
  ]);
});

test('rewrite and completion support a custom model, custom HTTPS base, and split output text', async () => {
  const splitOutput = [
    { id: 'reason', type: 'reasoning', summary: [] },
    {
      id: 'message',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        { type: 'output_text', text: '{"completion":" and remains', annotations: [] },
        { type: 'output_text', text: ' stable"}', annotations: [] },
      ],
    },
  ];
  const mock = fetchQueue(
    responsePayload('{"replacement":"A clearer sentence."}', { model: 'company.writer-v2' }),
    responsePayload('', { model: 'company.writer-v2', output: splitOutput }),
    responsePayload('{"completion":""}', { model: 'company.writer-v2' }),
  );
  const client = new OpenAIClient({
    apiKey: 'sk-test',
    model: 'company.writer-v2',
    baseUrl: 'https://gateway.example/openai/v1///',
    fetch: mock.fetch,
  });

  assert.deepEqual(
    await client.rewrite('A sentence.', 'Make this clearer.'),
    { replacement: 'A clearer sentence.', model: 'company.writer-v2' },
  );
  assert.deepEqual(
    await client.complete('The method converges', ' under the assumptions.'),
    { completion: ' and remains stable', model: 'company.writer-v2' },
  );
  assert.deepEqual(
    await client.complete('No suggestion needed.'),
    { completion: '', model: 'company.writer-v2' },
  );

  assert.deepEqual(mock.calls.map((call) => call.input), [
    'https://gateway.example/openai/v1/responses',
    'https://gateway.example/openai/v1/responses',
    'https://gateway.example/openai/v1/responses',
  ]);
  assert.deepEqual(mock.calls.map((call) => call.body.model), [
    'company.writer-v2',
    'company.writer-v2',
    'company.writer-v2',
  ]);
  assert.deepEqual(
    (mock.calls[0]!.body.text as { format: { name: string } }).format.name,
    'texleaf_rewrite',
  );
  assert.deepEqual(
    (mock.calls[1]!.body.text as { format: { name: string } }).format.name,
    'texleaf_completion',
  );
});

test('base URL normalization allows HTTPS and loopback HTTP but rejects unsafe forms', async () => {
  assert.equal(normalizeOpenAIBaseUrl(), 'https://api.openai.com/v1');
  assert.equal(
    normalizeOpenAIBaseUrl('https://proxy.example/openai/v1///'),
    'https://proxy.example/openai/v1',
  );
  assert.equal(
    responsesEndpointFor('https://proxy.example/openai/v1/'),
    'https://proxy.example/openai/v1/responses',
  );
  const destinations: string[] = [];
  const fetch: OpenAIFetch = async (input) => {
    destinations.push(input);
    return httpResponse(responsePayload('{"issues":[]}'));
  };

  await new OpenAIClient({
    apiKey: 'sk-test',
    baseUrl: 'https://proxy.example/api/v1/',
    fetch,
  }).review('prose');
  await new OpenAIClient({
    apiKey: 'sk-test',
    baseUrl: 'http://127.0.0.1:11434/v1/',
    fetch,
  }).review('prose');
  await new OpenAIClient({
    apiKey: 'sk-test',
    baseUrl: 'http://localhost:8080/v1',
    fetch,
  }).review('prose');
  await new OpenAIClient({
    apiKey: 'sk-test',
    baseUrl: 'http://[::1]:8080/v1/',
    fetch,
  }).review('prose');

  assert.deepEqual(destinations, [
    'https://proxy.example/api/v1/responses',
    'http://127.0.0.1:11434/v1/responses',
    'http://localhost:8080/v1/responses',
    'http://[::1]:8080/v1/responses',
  ]);

  const rejected = [
    'http://api.example/v1',
    'ftp://localhost/v1',
    'https://user:password@api.example/v1',
    'https://api.example/v1?tenant=private',
    'https://api.example/v1#fragment',
    'https://api.example./v1',
    'https://api.example/v1/responses',
    'https://api.example/v1/Responses///',
  ];
  for (const baseUrl of rejected) {
    assert.throws(
      () => new OpenAIClient({ apiKey: 'sk-test', baseUrl, fetch }),
      (error: unknown): boolean => {
        assert.equal(error instanceof OpenAIClientError, true);
        if (!(error instanceof OpenAIClientError)) {
          return false;
        }
        assert.equal(error.kind, 'configuration');
        assert.equal([
          'invalid-base-url',
          'insecure-base-url',
          'base-url-includes-responses',
        ].includes(String(error.code)), true);
        assert.equal(String(error).includes('password'), false);
        assert.equal(String(error).includes('tenant'), false);
        return true;
      },
    );
  }
});

test('configuration errors fail, while unsafe individual review issues are reported and discarded', async () => {
  assert.throws(
    () => new OpenAIClient({ apiKey: '' }),
    expectClientError('configuration', 'missing-api-key'),
  );
  assert.throws(
    () => new OpenAIClient({ apiKey: 'secret\nheader' }),
    (error: unknown): boolean => {
      assert.equal(expectClientError('configuration', 'invalid-api-key')(error), true);
      assert.equal(String(error).includes('secret'), false);
      return true;
    },
  );
  assert.throws(
    () => new OpenAIClient({ apiKey: 'sk-test', model: '../unsafe/model' }),
    expectClientError('configuration', 'invalid-model'),
  );

  const valid = {
    start: 0,
    end: 3,
    original: 'bad',
    replacement: 'good',
    message: 'Improve this.',
    explanation: 'The replacement is clearer.',
    category: 'clarity',
    severity: 'warning',
  };
  const mock = fetchQueue(
    responsePayload(JSON.stringify({ issues: [{ ...valid, start: -1 }] })),
    responsePayload(JSON.stringify({ issues: [{ ...valid, original: 'BAD' }] })),
    responsePayload(JSON.stringify({ issues: [{ ...valid, original: '' }] })),
    responsePayload(JSON.stringify({ issues: [{ ...valid, replacement: 'two\nlines' }] })),
    responsePayload(JSON.stringify({ issues: [{ ...valid, category: 'made-up' }] })),
    responsePayload(JSON.stringify({
      issues: [valid, { ...valid, replacement: 'better' }],
    })),
    responsePayload(JSON.stringify({ issues: [valid, valid] })),
    responsePayload(JSON.stringify({ issues: Array.from({ length: 65 }, () => valid) })),
  );
  const client = new OpenAIClient({ apiKey: 'sk-test', fetch: mock.fetch });
  for (const [code, count] of [
    ['invalid-issue-offset', 1],
    ['issue-original-not-found', 1],
    ['invalid-original', 1],
    ['invalid-replacement', 1],
    ['invalid-category', 1],
    ['overlapping-issues', 2],
  ] as const) {
    assert.deepEqual(await client.review('bad prose'), {
      issues: [],
      model: 'gpt-5.6-luna-2026-08-01',
      rejectedIssueCount: count,
      rejectedIssueCodes: [code],
    });
  }
  const duplicate = await client.review('bad prose');
  assert.equal(duplicate.issues.length, 1);
  assert.equal(duplicate.issues[0]?.original, 'bad');
  assert.equal(duplicate.rejectedIssueCount, 1);
  assert.deepEqual(duplicate.rejectedIssueCodes, ['duplicate-issue']);
  await assert.rejects(
    client.review('bad prose'),
    expectClientError('invalid-response', 'invalid-issues'),
  );
});

test('language labels enforce the client boundary before any network request', async () => {
  const accepted = fetchQueue(responsePayload('{"issues":[]}'));
  const acceptedClient = new OpenAIClient({
    apiKey: 'sk-test',
    fetch: accepted.fetch,
  });
  await acceptedClient.review('Prose.', { language: 'x'.repeat(64) });
  assert.equal(accepted.calls.length, 1);

  const blocked = fetchQueue();
  const blockedClient = new OpenAIClient({
    apiKey: 'sk-test',
    fetch: blocked.fetch,
  });
  await assert.rejects(
    blockedClient.review('Prose.', { language: 'x'.repeat(65) }),
    expectClientError('configuration', 'language-too-long'),
  );
  await assert.rejects(
    blockedClient.review('Prose.', { language: 'English\nChinese' }),
    expectClientError('configuration', 'invalid-language'),
  );
  assert.equal(blocked.calls.length, 0);
});

test('review reconciles exact UTF-16, code-point, UTF-8, CRLF, one-based, and unique-original locations', async () => {
  const issue = (start: number, end: number, original: string) => ({
    start,
    end,
    original,
    replacement: 'clear',
    message: 'Improve this.',
    explanation: 'The replacement is clearer.',
    category: 'clarity',
    severity: 'warning',
  });
  const cases = [
    { source: 'bad prose', raw: issue(0, 3, 'bad'), expected: [0, 3] },
    { source: 'bad 😀 bad', raw: issue(6, 9, 'bad'), expected: [7, 10] },
    { source: 'bad 漢 bad', raw: issue(8, 11, 'bad'), expected: [6, 9] },
    { source: 'bad\r\nbad', raw: issue(4, 7, 'bad'), expected: [5, 8] },
    { source: 'bad prose', raw: issue(1, 4, 'bad'), expected: [0, 3] },
    { source: 'Alpha bad.', raw: issue(0, 5, 'bad'), expected: [6, 9] },
  ] as const;
  const mock = fetchQueue(...cases.map(({ raw }) =>
    responsePayload(JSON.stringify({ issues: [raw] }))));
  const client = new OpenAIClient({ apiKey: 'sk-test', fetch: mock.fetch });

  for (const item of cases) {
    const result = await client.review(item.source);
    assert.equal(result.rejectedIssueCount, undefined);
    assert.equal(result.issues.length, 1);
    assert.deepEqual(
      [result.issues[0]?.start, result.issues[0]?.end],
      item.expected,
    );
    assert.equal(
      item.source.slice(result.issues[0]!.start, result.issues[0]!.end),
      'bad',
    );
  }
});

test('review never guesses between repeated text, quote normalization, or unsafe UTF-8 surrogate interpretations', async () => {
  const base = {
    replacement: 'clear',
    message: 'Improve this.',
    explanation: 'The replacement is clearer.',
    category: 'clarity',
    severity: 'warning',
  };
  const cases = [
    {
      source: '😀aa',
      issue: { ...base, start: 2, end: 3, original: 'a' },
      code: 'issue-location-ambiguous',
    },
    {
      source: 'The “term” fails.',
      issue: { ...base, start: 4, end: 10, original: '"term"' },
      code: 'issue-original-not-found',
    },
    {
      source: '\ud800aa',
      issue: { ...base, start: 4, end: 5, original: 'a' },
      code: 'issue-location-ambiguous',
    },
  ] as const;
  const mock = fetchQueue(...cases.map(({ issue: modelIssue }) =>
    responsePayload(JSON.stringify({ issues: [modelIssue] }))));
  const client = new OpenAIClient({ apiKey: 'sk-test', fetch: mock.fetch });

  for (const item of cases) {
    assert.deepEqual(await client.review(item.source), {
      issues: [],
      model: 'gpt-5.6-luna-2026-08-01',
      rejectedIssueCount: 1,
      rejectedIssueCodes: [item.code],
    });
  }
});

test('review retains independent valid issues and rejects every member of an overlapping group', async () => {
  const source = 'bad and vague.';
  const base = {
    replacement: 'clear',
    message: 'Improve this.',
    explanation: 'The replacement is clearer.',
    category: 'clarity',
    severity: 'warning',
  };
  const mock = fetchQueue(responsePayload(JSON.stringify({
    issues: [
      { ...base, start: 0, end: 3, original: 'bad' },
      { ...base, start: 8, end: 13, original: 'vague' },
      { ...base, start: 9, end: 13, original: 'ague' },
      { ...base, start: 8, end: 13, original: '"vague"' },
    ],
  })));
  const result = await new OpenAIClient({ apiKey: 'sk-test', fetch: mock.fetch }).review(source);

  assert.deepEqual(result.issues.map(({ start, end, original }) => ({ start, end, original })), [
    { start: 0, end: 3, original: 'bad' },
  ]);
  assert.equal(result.rejectedIssueCount, 3);
  assert.deepEqual(result.rejectedIssueCodes, [
    'issue-original-not-found',
    'overlapping-issues',
  ]);
});

test('incomplete, refusal, empty, invalid JSON, and unfamiliar usage are classified', async () => {
  const mock = fetchQueue(
    responsePayload('', { status: 'incomplete', output: [] }),
    responsePayload('', { contentPart: { type: 'refusal', refusal: 'Cannot help.' } }),
    responsePayload('', { output: [] }),
    responsePayload('not json'),
    responsePayload('{"issues":[]}', {
      usage: { input_tokens: 'future-shape', extra_future_field: 1 },
    }),
  );
  const client = new OpenAIClient({ apiKey: 'sk-test', fetch: mock.fetch });

  await assert.rejects(
    client.review('prose'),
    expectClientError('truncated', 'incomplete-response'),
  );
  await assert.rejects(
    client.review('prose'),
    expectClientError('invalid-response', 'refusal'),
  );
  await assert.rejects(
    client.review('prose'),
    expectClientError('invalid-response', 'empty-content'),
  );
  await assert.rejects(
    client.review('prose'),
    expectClientError('invalid-response', 'invalid-json-output'),
  );
  assert.deepEqual(await client.review('prose'), {
    issues: [],
    model: 'gpt-5.6-luna-2026-08-01',
  });
});

test('HTTP errors are classified without reading or exposing response bodies', async () => {
  const secretBody = 'BODY-CONTAINING-PRIVATE-DOCUMENT';
  const cases = [
    { status: 401, kind: 'authentication' as const, code: 401 },
    { status: 402, kind: 'payment-required' as const, code: 402 },
    { status: 429, kind: 'rate-limit' as const, code: 429 },
    { status: 503, kind: 'http' as const, code: 'service-error' },
  ];

  for (const item of cases) {
    let bodyRead = false;
    const fetch: OpenAIFetch = async () => httpResponse(
      { error: { message: secretBody } },
      item.status,
      { onText: () => { bodyRead = true; } },
    );
    const client = new OpenAIClient({ apiKey: 'sk-private-key', fetch });
    await assert.rejects(client.review('PRIVATE-REQUEST-TEXT'), (error: unknown): boolean => {
      assert.equal(error instanceof OpenAIClientError, true);
      if (!(error instanceof OpenAIClientError)) {
        return false;
      }
      assert.equal(error.kind, item.kind);
      assert.equal(error.code, item.code);
      assert.equal(error.status, item.status);
      assert.equal(String(error).includes('sk-private-key'), false);
      assert.equal(String(error).includes('PRIVATE-REQUEST-TEXT'), false);
      assert.equal(String(error).includes(secretBody), false);
      assert.equal((error as Error & { cause?: unknown }).cause, undefined);
      return true;
    });
    assert.equal(bodyRead, false);
  }
});

test('response body limits and malformed HTTP JSON fail without leaking raw content', async () => {
  let oversizedBodyRead = false;
  const declaredOversized = new OpenAIClient({
    apiKey: 'sk-test',
    fetch: async () => httpResponse({}, 200, {
      contentLength: '1048577',
      onText: () => { oversizedBodyRead = true; },
    }),
  });
  await assert.rejects(
    declaredOversized.review('prose'),
    expectClientError('invalid-response', 'response-too-large'),
  );
  assert.equal(oversizedBodyRead, false);

  let streamTextRead = false;
  let streamCancelled = false;
  let streamReads = 0;
  const streamedOversized = new OpenAIClient({
    apiKey: 'sk-test',
    fetch: async () => streamedHttpResponse(
      [new Uint8Array(800_000), new Uint8Array(300_000)],
      {
        onText: () => { streamTextRead = true; },
        onRead: () => { streamReads += 1; },
        onCancel: () => { streamCancelled = true; },
      },
    ),
  });
  await assert.rejects(
    streamedOversized.review('prose'),
    expectClientError('invalid-response', 'response-too-large'),
  );
  assert.equal(streamTextRead, false);
  assert.equal(streamCancelled, true);
  assert.equal(streamReads, 2);

  const streamedValidPayload = JSON.stringify(
    responsePayload('{"issues":[]}'),
  );
  const streamedValid = new OpenAIClient({
    apiKey: 'sk-test',
    fetch: async () => streamedHttpResponse([
      Buffer.from(streamedValidPayload.slice(0, 31), 'utf8'),
      Buffer.from(streamedValidPayload.slice(31), 'utf8'),
    ]),
  });
  assert.deepEqual(await streamedValid.review('prose'), {
    issues: [],
    model: 'gpt-5.6-luna-2026-08-01',
  });

  const actualOversized = new OpenAIClient({
    apiKey: 'sk-test',
    fetch: async () => httpResponse({}, 200, { raw: '界'.repeat(400_000) }),
  });
  await assert.rejects(
    actualOversized.review('prose'),
    expectClientError('invalid-response', 'response-too-large'),
  );

  const malformed = new OpenAIClient({
    apiKey: 'sk-test',
    fetch: async () => httpResponse({}, 200, { raw: 'PRIVATE-RESPONSE-BODY' }),
  });
  await assert.rejects(malformed.review('prose'), (error: unknown): boolean => {
    assert.equal(expectClientError('invalid-response', 'invalid-http-json')(error), true);
    assert.equal(String(error).includes('PRIVATE-RESPONSE-BODY'), false);
    return true;
  });
});

test('timeout bounds fetch/body reads and cancellation is distinguished', async () => {
  let timeoutSignal: AbortSignal | undefined;
  const stalled: OpenAIFetch = async (_input, init) => {
    timeoutSignal = init.signal;
    return new Promise<OpenAIFetchResponse>(() => undefined);
  };
  const timedClient = new OpenAIClient({ apiKey: 'sk-test', timeoutMs: 5, fetch: stalled });
  await assert.rejects(timedClient.review('prose'), expectClientError('timeout', 'timeout'));
  assert.equal(timeoutSignal?.aborted, true);

  const stalledBody = new OpenAIClient({
    apiKey: 'sk-test',
    timeoutMs: 5,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => new Promise<string>(() => undefined),
    }),
  });
  await assert.rejects(stalledBody.review('prose'), expectClientError('timeout', 'timeout'));

  const external = new AbortController();
  let cancellationSignal: AbortSignal | undefined;
  const cancellable: OpenAIFetch = async (_input, init) => {
    cancellationSignal = init.signal;
    return new Promise<OpenAIFetchResponse>(() => undefined);
  };
  const cancelledClient = new OpenAIClient({
    apiKey: 'sk-test',
    timeoutMs: 10_000,
    fetch: cancellable,
  });
  const pending = cancelledClient.review('prose', { signal: external.signal });
  external.abort();
  await assert.rejects(pending, expectClientError('cancelled', 'cancelled'));
  assert.equal(cancellationSignal?.aborted, true);

  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const bodyAbort = new AbortController();
    const rejectedCancelClient = new OpenAIClient({
      apiKey: 'sk-test',
      timeoutMs: 10_000,
      fetch: async () => ({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => new Promise(() => undefined),
            cancel: async () => { throw new Error('PRIVATE cancel failure'); },
          }),
        },
        text: async () => { throw new Error('text() must not be called'); },
      }),
    });
    const rejectedCancel = rejectedCancelClient.review('prose', {
      signal: bodyAbort.signal,
    });
    await new Promise((resolve) => setImmediate(resolve));
    bodyAbort.abort();
    await assert.rejects(
      rejectedCancel,
      expectClientError('cancelled', 'cancelled'),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});
