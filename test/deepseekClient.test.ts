import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEEPSEEK_API_BASE_URL,
  DEEPSEEK_API_ENDPOINT,
  DEFAULT_DEEPSEEK_MODEL,
  DeepSeekClient,
  DeepSeekClientError,
  DeepSeekFetch,
  DeepSeekFetchRequestInit,
  DeepSeekFetchResponse,
  deepSeekChatCompletionsEndpointFor,
  normalizeDeepSeekBaseUrl,
} from '../src/ai/deepseekClient';

interface CapturedCall {
  readonly input: string;
  readonly init: DeepSeekFetchRequestInit;
  readonly body: Record<string, unknown>;
}

function response(
  payload: unknown,
  status = 200,
  onJson?: () => void,
): DeepSeekFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => {
      onJson?.();
      const serialized = JSON.stringify(payload);
      assert.notEqual(serialized, undefined);
      return serialized as string;
    },
  };
}

function streamedResponse(
  chunks: readonly Uint8Array[],
  options: {
    readonly onText?: () => void;
    readonly onRead?: () => void;
    readonly onCancel?: () => void;
  } = {},
): DeepSeekFetchResponse {
  let index = 0;
  return {
    ok: true,
    status: 200,
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

function completion(
  content: string,
  options: {
    readonly finishReason?: string;
    readonly usage?: unknown;
    readonly model?: string;
  } = {},
): unknown {
  return {
    id: 'request-id',
    object: 'chat.completion',
    model: options.model ?? 'deepseek-v4-flash-20260801',
    choices: [{
      index: 0,
      finish_reason: options.finishReason ?? 'stop',
      message: { role: 'assistant', content },
    }],
    ...(options.usage === undefined ? {} : { usage: options.usage }),
  };
}

function fetchQueue(...payloads: readonly unknown[]): {
  readonly fetch: DeepSeekFetch;
  readonly calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const queue = [...payloads];
  const fetch: DeepSeekFetch = async (input, init) => {
    const parsed: unknown = JSON.parse(init.body);
    assert.equal(typeof parsed, 'object');
    assert.notEqual(parsed, null);
    calls.push({ input, init, body: parsed as Record<string, unknown> });
    const payload = queue.shift();
    assert.notEqual(payload, undefined, 'unexpected DeepSeek request');
    return response(payload);
  };
  return { fetch, calls };
}

function expectClientError(
  kind: DeepSeekClientError['kind'],
  code?: string | number,
): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.equal(error instanceof DeepSeekClientError, true);
    if (!(error instanceof DeepSeekClientError)) {
      return false;
    }
    assert.equal(error.kind, kind);
    if (code !== undefined) {
      assert.equal(error.code, code);
    }
    return true;
  };
}

test('review uses the official Chat Completions JSON contract in non-thinking mode', async () => {
  const source = 'This are bad.';
  const mock = fetchQueue(completion(JSON.stringify({
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
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 140,
      prompt_cache_hit_tokens: 60,
      prompt_cache_miss_tokens: 40,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  }));
  const client = new DeepSeekClient({
    apiKey: '  sk-test-key  ',
    fetch: mock.fetch,
  });

  const result = await client.review(source, {
    language: 'English',
    style: 'concise academic',
  });

  assert.deepEqual(result, {
    model: 'deepseek-v4-flash-20260801',
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
  assert.equal(call.input, DEEPSEEK_API_ENDPOINT);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'error');
  assert.deepEqual(call.init.headers, {
    Accept: 'application/json',
    Authorization: 'Bearer sk-test-key',
    'Content-Type': 'application/json',
  });
  assert.equal(call.init.signal instanceof AbortSignal, true);
  assert.equal(call.body.model, DEFAULT_DEEPSEEK_MODEL);
  assert.deepEqual(call.body.thinking, { type: 'disabled' });
  assert.deepEqual(call.body.response_format, { type: 'json_object' });
  assert.equal(call.body.stream, false);
  assert.equal(call.body.temperature, 0);
  assert.equal(call.body.max_tokens, 6_144);
  assert.equal(JSON.stringify(call.body).includes('sk-test-key'), false);

  const messages = call.body.messages as Array<{ readonly role: string; readonly content: string }>;
  assert.equal(messages[0]?.role, 'system');
  assert.match(messages[0]?.content ?? '', /json only/i);
  assert.match(messages[0]?.content ?? '', /original must be non-empty/u);
  assert.match(messages[0]?.content ?? '', /⟦DISPLAYED_FORMULA⟧/u);
  assert.match(messages[0]?.content ?? '', /meaningful noun phrase or object/u);
  assert.match(messages[0]?.content ?? '', /Simplified Chinese/u);
  assert.match(messages[0]?.content ?? '', /Keep replacement in payload\.language/u);
  assert.match(messages[0]?.content ?? '', /用词不够准确/u);
  assert.doesNotMatch(
    messages[0]?.content ?? '',
    /Short diagnosis|Brief explanation/u,
  );
  assert.equal(messages[1]?.role, 'user');
  assert.deepEqual(JSON.parse(messages[1]!.content), {
    task: 'review',
    language: 'English',
    style: 'concise academic',
    text: source,
  });
});

test('base URL normalization permits HTTPS and loopback HTTP without duplicating the endpoint', async () => {
  assert.equal(normalizeDeepSeekBaseUrl(), DEEPSEEK_API_BASE_URL);
  assert.equal(
    normalizeDeepSeekBaseUrl('HTTPS://API.DEEPSEEK.COM:443///'),
    DEEPSEEK_API_BASE_URL,
  );
  assert.equal(
    normalizeDeepSeekBaseUrl('https://gateway.example/deepseek/v1///'),
    'https://gateway.example/deepseek/v1',
  );
  assert.equal(
    deepSeekChatCompletionsEndpointFor('https://gateway.example/deepseek/v1/'),
    'https://gateway.example/deepseek/v1/chat/completions',
  );
  assert.equal(
    deepSeekChatCompletionsEndpointFor('http://127.0.0.1:11434/v1/'),
    'http://127.0.0.1:11434/v1/chat/completions',
  );
  assert.equal(
    deepSeekChatCompletionsEndpointFor('http://localhost:8080'),
    'http://localhost:8080/chat/completions',
  );
  assert.equal(
    deepSeekChatCompletionsEndpointFor('http://[::1]:8080/v1/'),
    'http://[::1]:8080/v1/chat/completions',
  );

  const mock = fetchQueue(completion('{"issues":[]}'));
  await new DeepSeekClient({
    apiKey: 'sk-test',
    baseUrl: 'https://gateway.example/deepseek/v1///',
    fetch: mock.fetch,
  }).review('prose');
  assert.equal(
    mock.calls[0]!.input,
    'https://gateway.example/deepseek/v1/chat/completions',
  );
});

test('unsafe or endpoint-bearing DeepSeek Base URLs fail closed before fetch', () => {
  const mock = fetchQueue();
  const rejected = [
    'http://api.deepseek.com',
    'ftp://localhost/deepseek',
    'https://user:password@api.deepseek.com',
    'https://api.deepseek.com?tenant=private',
    'https://api.deepseek.com#fragment',
    'https://api.deepseek.com./v1',
    'https://api.deepseek.com/chat/completions',
    'https://api.deepseek.com/Chat/Completions///',
    'javascript:alert(1)',
  ];

  for (const baseUrl of rejected) {
    assert.throws(
      () => new DeepSeekClient({
        apiKey: 'sk-test',
        baseUrl,
        fetch: mock.fetch,
      }),
      (error: unknown): boolean => {
        assert.equal(error instanceof DeepSeekClientError, true);
        if (!(error instanceof DeepSeekClientError)) {
          return false;
        }
        assert.equal(error.kind, 'configuration');
        assert.equal([
          'invalid-base-url',
          'insecure-base-url',
          'base-url-includes-chat-completions',
        ].includes(String(error.code)), true);
        assert.equal(String(error).includes('password'), false);
        assert.equal(String(error).includes('tenant'), false);
        return true;
      },
      baseUrl,
    );
  }
  assert.equal(mock.calls.length, 0);
});

test('rewrite and completion preserve JSON string whitespace and support the pro model', async () => {
  const mock = fetchQueue(
    completion('{"replacement":"A clearer sentence."}', { model: 'deepseek-v4-pro' }),
    completion('{"completion":" and remains stable"}', { model: 'deepseek-v4-pro' }),
    completion('{"completion":""}', { model: 'deepseek-v4-pro' }),
  );
  const client = new DeepSeekClient({
    apiKey: 'sk-test',
    model: 'deepseek-v4-pro',
    fetch: mock.fetch,
  });

  assert.deepEqual(
    await client.rewrite('A sentence.', 'Make this clearer.'),
    { replacement: 'A clearer sentence.', model: 'deepseek-v4-pro' },
  );
  assert.deepEqual(
    await client.complete('The method converges', ' under the assumptions.', {
      language: 'en',
      style: 'academic',
    }),
    { completion: ' and remains stable', model: 'deepseek-v4-pro' },
  );
  assert.deepEqual(
    await client.complete('No suggestion needed.'),
    { completion: '', model: 'deepseek-v4-pro' },
  );

  assert.equal(mock.calls[0]!.body.model, 'deepseek-v4-pro');
  assert.equal(mock.calls[0]!.body.max_tokens, 8_192);
  assert.equal(mock.calls[1]!.body.max_tokens, 512);
  assert.deepEqual(mock.calls.map((call) => call.body.thinking), [
    { type: 'disabled' },
    { type: 'disabled' },
    { type: 'disabled' },
  ]);
});

test('a single exact json Markdown fence is stripped before strict validation', async () => {
  const source = 'bad prose';
  const mock = fetchQueue(completion([
    '```json',
    JSON.stringify({
      issues: [{
        start: 0,
        end: 3,
        original: 'bad',
        replacement: 'clear',
        message: 'Improve this.',
        explanation: 'The replacement is more precise.',
        category: 'clarity',
        severity: 'warning',
      }],
    }),
    '```',
  ].join('\r\n')));
  const client = new DeepSeekClient({ apiKey: 'sk-test', fetch: mock.fetch });

  const result = await client.review(source);

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.replacement, 'clear');
  assert.equal(mock.calls.length, 1);
});

test('empty content and invalid JSON retry once, while schema errors never retry', async () => {
  const recovered = fetchQueue(
    completion(' \r\n '),
    completion('{"issues":[]}'),
  );
  const recoveredClient = new DeepSeekClient({ apiKey: 'sk-test', fetch: recovered.fetch });
  assert.deepEqual(await recoveredClient.review('prose'), {
    issues: [],
    model: 'deepseek-v4-flash-20260801',
  });
  assert.equal(recovered.calls.length, 2);

  const exhausted = fetchQueue(completion('not json'), completion('{also not json'));
  const exhaustedClient = new DeepSeekClient({ apiKey: 'sk-test', fetch: exhausted.fetch });
  await assert.rejects(
    exhaustedClient.review('prose'),
    expectClientError('invalid-response', 'invalid-json-output'),
  );
  assert.equal(exhausted.calls.length, 2);

  const schemaFailure = fetchQueue(completion('{"issues":"not-an-array"}'));
  const schemaClient = new DeepSeekClient({ apiKey: 'sk-test', fetch: schemaFailure.fetch });
  await assert.rejects(
    schemaClient.review('prose'),
    expectClientError('invalid-response', 'invalid-issues'),
  );
  assert.equal(schemaFailure.calls.length, 1);
});

test('configuration validation rejects missing keys and unsafe or oversized inputs', async () => {
  assert.throws(
    () => new DeepSeekClient({ apiKey: '' }),
    expectClientError('configuration', 'missing-api-key'),
  );
  assert.throws(
    () => new DeepSeekClient({ apiKey: 'secret\nheader' }),
    (error: unknown): boolean => {
      assert.equal(expectClientError('configuration', 'invalid-api-key')(error), true);
      assert.equal(String(error).includes('secret'), false);
      return true;
    },
  );
  assert.throws(
    () => new DeepSeekClient({
      apiKey: 'sk-test',
      model: 'deepseek-chat' as 'deepseek-v4-flash',
    }),
    expectClientError('configuration', 'invalid-model'),
  );
  assert.throws(
    () => new DeepSeekClient({ apiKey: 'sk-test', timeoutMs: 0 }),
    expectClientError('configuration', 'invalid-timeout'),
  );

  const client = new DeepSeekClient({
    apiKey: 'sk-test',
    fetch: async () => response(completion('{"issues":[]}')),
  });
  await assert.rejects(client.review(''), expectClientError('configuration', 'empty-review-text'));
  await assert.rejects(
    client.review('x'.repeat(32_769)),
    expectClientError('configuration', 'review-text-too-long'),
  );
  await assert.rejects(
    client.complete('', ''),
    expectClientError('configuration', 'empty-completion-context'),
  );
  await assert.rejects(
    client.rewrite('text', ''),
    expectClientError('configuration', 'empty-rewrite-instruction'),
  );
});

test('language labels enforce the client boundary before any network request', async () => {
  const accepted = fetchQueue(completion('{"issues":[]}'));
  const acceptedClient = new DeepSeekClient({
    apiKey: 'sk-test',
    fetch: accepted.fetch,
  });
  await acceptedClient.review('Prose.', { language: 'x'.repeat(64) });
  assert.equal(accepted.calls.length, 1);

  const blocked = fetchQueue();
  const blockedClient = new DeepSeekClient({
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

test('review reports and discards unsafe individual issues but still rejects an invalid top-level list', async () => {
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
  const payloads = [
    { issues: [{ ...valid, start: -1 }] },
    { issues: [{ ...valid, original: 'BAD' }] },
    { issues: [{ ...valid, original: '' }] },
    { issues: [{ ...valid, replacement: 'two\nlines' }] },
    { issues: [{ ...valid, category: 'made-up' }] },
    {
      issues: [
        { ...valid, start: 0, end: 3, original: 'bad' },
        { ...valid, start: 2, end: 4, original: 'd ' },
      ],
    },
    { issues: [valid, valid] },
    { issues: Array.from({ length: 65 }, () => valid) },
  ].map((value) => completion(JSON.stringify(value)));
  const mock = fetchQueue(...payloads);
  const client = new DeepSeekClient({ apiKey: 'sk-test', fetch: mock.fetch });
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
      model: 'deepseek-v4-flash-20260801',
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

test('review reconciles model offset units but rejects ambiguous repeated text without guessing', async () => {
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
  const accepted = [
    { source: 'bad 😀 bad', raw: issue(6, 9, 'bad'), expected: [7, 10] },
    { source: 'bad 漢 bad', raw: issue(8, 11, 'bad'), expected: [6, 9] },
    { source: 'bad\r\nbad', raw: issue(4, 7, 'bad'), expected: [5, 8] },
    { source: 'Alpha bad.', raw: issue(0, 5, 'bad'), expected: [6, 9] },
  ] as const;
  const mock = fetchQueue(
    ...accepted.map(({ raw }) => completion(JSON.stringify({ issues: [raw] }))),
    completion(JSON.stringify({ issues: [issue(2, 3, 'a')] })),
  );
  const client = new DeepSeekClient({ apiKey: 'sk-test', fetch: mock.fetch });

  for (const item of accepted) {
    const result = await client.review(item.source);
    assert.deepEqual(
      [result.issues[0]?.start, result.issues[0]?.end],
      item.expected,
    );
  }
  assert.deepEqual(await client.review('😀aa'), {
    issues: [],
    model: 'deepseek-v4-flash-20260801',
    rejectedIssueCount: 1,
    rejectedIssueCodes: ['issue-location-ambiguous'],
  });
});

test('malformed, empty, filtered, and truncated responses fail safely', async () => {
  const payloads = [
    { object: 'not-chat', choices: [] },
    completion('not json'),
    completion('not json again'),
    completion(''),
    completion('  '),
    completion('{"issues":[]}', { finishReason: 'content_filter' }),
    completion('{"issues":[]}', { finishReason: 'length' }),
  ];
  const mock = fetchQueue(...payloads);
  const client = new DeepSeekClient({ apiKey: 'sk-test', fetch: mock.fetch });

  await assert.rejects(
    client.review('prose'),
    expectClientError('invalid-response', 'invalid-chat-completion'),
  );
  await assert.rejects(
    client.review('prose'),
    expectClientError('invalid-response', 'invalid-json-output'),
  );
  await assert.rejects(
    client.review('prose'),
    expectClientError('invalid-response', 'empty-content'),
  );
  await assert.rejects(
    client.review('prose'),
    expectClientError('invalid-response', 'content-filtered'),
  );
  await assert.rejects(
    client.review('prose'),
    expectClientError('truncated', 'output-truncated'),
  );
});

test('usage metadata is best-effort and API field evolution cannot discard valid output', async () => {
  const mock = fetchQueue(
    completion('{"issues":[]}', {
      usage: {
        input_tokens: 7,
        output_tokens: 3,
        total_tokens: 10,
        future_usage_field: { nested: true },
      },
    }),
    completion('{"issues":[]}', {
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
        prompt_cache_hit_tokens: 'new-format',
        completion_tokens_details: 'new-format',
        future_usage_field: 99,
      },
    }),
  );
  const client = new DeepSeekClient({ apiKey: 'sk-test', fetch: mock.fetch });

  assert.deepEqual(await client.review('prose'), {
    issues: [],
    model: 'deepseek-v4-flash-20260801',
  });
  assert.deepEqual(await client.review('prose'), {
    issues: [],
    model: 'deepseek-v4-flash-20260801',
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
  });
});

test('oversized HTTP response bodies are rejected before JSON parsing and are not retried', async () => {
  let calls = 0;
  const fetch: DeepSeekFetch = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      text: async () => 'x'.repeat(2_097_153),
    };
  };
  const client = new DeepSeekClient({ apiKey: 'sk-test', fetch });

  await assert.rejects(
    client.review('PRIVATE-REQUEST-TEXT'),
    (error: unknown): boolean => {
      assert.equal(expectClientError('invalid-response', 'http-body-too-large')(error), true);
      assert.equal(String(error).includes('PRIVATE-REQUEST-TEXT'), false);
      return true;
    },
  );
  assert.equal(calls, 1);

  let streamTextRead = false;
  let streamCancelled = false;
  let streamReads = 0;
  const streamedOversized = new DeepSeekClient({
    apiKey: 'sk-test',
    fetch: async () => streamedResponse(
      [new Uint8Array(1_100_000), new Uint8Array(1_100_000)],
      {
        onText: () => { streamTextRead = true; },
        onRead: () => { streamReads += 1; },
        onCancel: () => { streamCancelled = true; },
      },
    ),
  });
  await assert.rejects(
    streamedOversized.review('prose'),
    expectClientError('invalid-response', 'http-body-too-large'),
  );
  assert.equal(streamTextRead, false);
  assert.equal(streamCancelled, true);
  assert.equal(streamReads, 2);

  const validPayload = JSON.stringify(completion('{"issues":[]}'));
  const streamedValid = new DeepSeekClient({
    apiKey: 'sk-test',
    fetch: async () => streamedResponse([
      Buffer.from(validPayload.slice(0, 23), 'utf8'),
      Buffer.from(validPayload.slice(23), 'utf8'),
    ]),
  });
  assert.deepEqual(await streamedValid.review('prose'), {
    issues: [],
    model: 'deepseek-v4-flash-20260801',
  });
});

test('response metadata and diagnostic display text cannot inject logs or UI controls', async () => {
  const issue = {
    start: 0,
    end: 3,
    original: 'bad',
    replacement: 'good',
    message: 'Improve this.',
    explanation: 'Grammar explanation.',
    category: 'grammar',
    severity: 'warning',
  };
  const mock = fetchQueue(
    completion('{"issues":[]}', { model: 'PRIVATE TEXT\u001b[31m' }),
    completion(JSON.stringify({
      issues: [{ ...issue, message: 'Misleading\nsecond line' }],
    })),
    completion(JSON.stringify({
      issues: [{ ...issue, explanation: 'hidden\u202econtrol' }],
    })),
  );
  const client = new DeepSeekClient({ apiKey: 'sk-test', fetch: mock.fetch });

  await assert.rejects(
    client.review('bad prose'),
    expectClientError('invalid-response', 'invalid-response-model'),
  );
  assert.deepEqual(await client.review('bad prose'), {
    issues: [],
    model: 'deepseek-v4-flash-20260801',
    rejectedIssueCount: 1,
    rejectedIssueCodes: ['invalid-message'],
  });
  assert.deepEqual(await client.review('bad prose'), {
    issues: [],
    model: 'deepseek-v4-flash-20260801',
    rejectedIssueCount: 1,
    rejectedIssueCodes: ['invalid-explanation'],
  });
});

test('review, rewrite, and completion reject C1 and Unicode line separators', async () => {
  const issue = {
    start: 0,
    end: 3,
    original: 'bad',
    replacement: 'good\u0085hidden',
    message: 'Improve this.',
    explanation: 'Grammar explanation.',
    category: 'grammar',
    severity: 'warning',
  };
  const mock = fetchQueue(
    completion(JSON.stringify({ issues: [issue] })),
    completion(JSON.stringify({ replacement: 'Better\u2028hidden' })),
    completion(JSON.stringify({ completion: ' next\u2029hidden' })),
  );
  const client = new DeepSeekClient({ apiKey: 'sk-test', fetch: mock.fetch });

  assert.deepEqual(await client.review('bad prose'), {
    issues: [],
    model: 'deepseek-v4-flash-20260801',
    rejectedIssueCount: 1,
    rejectedIssueCodes: ['invalid-replacement'],
  });
  await assert.rejects(
    client.rewrite('Original.', 'Improve it.'),
    expectClientError('invalid-response', 'invalid-replacement'),
  );
  await assert.rejects(
    client.complete('A useful prefix'),
    expectClientError('invalid-response', 'invalid-completion'),
  );
});

test('HTTP status errors are classified without reading or exposing response bodies', async () => {
  const secretBody = 'BODY-CONTAINING-PRIVATE-DOCUMENT';
  const cases = [
    { status: 401, kind: 'authentication' as const },
    { status: 402, kind: 'payment-required' as const },
    { status: 429, kind: 'rate-limit' as const },
    { status: 503, kind: 'http' as const },
  ];

  for (const item of cases) {
    let bodyRead = false;
    const fetch: DeepSeekFetch = async () => response(
      { error: { message: secretBody } },
      item.status,
      () => { bodyRead = true; },
    );
    const client = new DeepSeekClient({ apiKey: 'sk-private-key', fetch });
    await assert.rejects(client.review('PRIVATE-REQUEST-TEXT'), (error: unknown): boolean => {
      assert.equal(error instanceof DeepSeekClientError, true);
      if (!(error instanceof DeepSeekClientError)) {
        return false;
      }
      assert.equal(error.kind, item.kind);
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

test('network failures are sanitized and invalid HTTP JSON does not leak its parser error', async () => {
  const client = new DeepSeekClient({
    apiKey: 'sk-network-secret',
    fetch: async () => {
      throw new Error('sk-network-secret PRIVATE-REQUEST-TEXT');
    },
  });
  await assert.rejects(client.review('PRIVATE-REQUEST-TEXT'), (error: unknown): boolean => {
    assert.equal(expectClientError('network', 'network')(error), true);
    assert.equal(String(error).includes('sk-network-secret'), false);
    assert.equal(String(error).includes('PRIVATE-REQUEST-TEXT'), false);
    assert.equal((error as Error & { cause?: unknown }).cause, undefined);
    return true;
  });

  const malformed = new DeepSeekClient({
    apiKey: 'sk-test',
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('PRIVATE-RESPONSE-BODY');
      },
    }),
  });
  await assert.rejects(malformed.review('prose'), (error: unknown): boolean => {
    assert.equal(expectClientError('invalid-response', 'invalid-http-json')(error), true);
    assert.equal(String(error).includes('PRIVATE-RESPONSE-BODY'), false);
    return true;
  });
});

test('timeout aborts stalled fetch and external AbortSignal is distinguished from timeout', async () => {
  let timeoutSignal: AbortSignal | undefined;
  let timeoutCalls = 0;
  const stalled: DeepSeekFetch = async (_input, init) => {
    timeoutCalls += 1;
    timeoutSignal = init.signal;
    return new Promise<DeepSeekFetchResponse>(() => undefined);
  };
  const timedClient = new DeepSeekClient({
    apiKey: 'sk-test',
    timeoutMs: 5,
    fetch: stalled,
  });
  await assert.rejects(
    timedClient.review('prose'),
    expectClientError('timeout', 'timeout'),
  );
  assert.equal(timeoutSignal?.aborted, true);
  assert.equal(timeoutCalls, 1);

  const external = new AbortController();
  let cancellationSignal: AbortSignal | undefined;
  let cancellationCalls = 0;
  const cancellable: DeepSeekFetch = async (_input, init) => {
    cancellationCalls += 1;
    cancellationSignal = init.signal;
    return new Promise<DeepSeekFetchResponse>(() => undefined);
  };
  const cancelledClient = new DeepSeekClient({
    apiKey: 'sk-test',
    timeoutMs: 10_000,
    fetch: cancellable,
  });
  const pending = cancelledClient.review('prose', { signal: external.signal });
  external.abort();
  await assert.rejects(pending, expectClientError('cancelled', 'cancelled'));
  assert.equal(cancellationSignal?.aborted, true);
  assert.equal(cancellationCalls, 1);

  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  await assert.rejects(
    cancelledClient.review('prose', { signal: alreadyCancelled.signal }),
    expectClientError('cancelled', 'cancelled'),
  );
  assert.equal(cancellationCalls, 1);
});

test('timeout also bounds a stalled response body', async () => {
  const fetch: DeepSeekFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => new Promise<string>(() => undefined),
  });
  const client = new DeepSeekClient({ apiKey: 'sk-test', timeoutMs: 5, fetch });
  await assert.rejects(
    client.review('prose'),
    expectClientError('timeout', 'timeout'),
  );
});
