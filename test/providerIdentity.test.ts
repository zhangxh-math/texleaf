import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEEPSEEK_CONSENT_KEY_PREFIX,
  DEEPSEEK_SECRET_KEY_PREFIX,
  LEGACY_DEEPSEEK_CONSENT_KEY,
  LEGACY_DEEPSEEK_SECRET_KEY,
  OPENAI_CONSENT_KEY_PREFIX,
  OPENAI_SECRET_KEY_PREFIX,
  deepSeekProviderIdentityFor,
  openAIProviderIdentityFor,
} from '../src/ai/providerIdentity';
import { DeepSeekClientError } from '../src/ai/deepseekClient';
import { OpenAIClientError } from '../src/ai/openaiClient';

test('DeepSeek canonical equivalents reuse one address-scoped identity', () => {
  const expected = deepSeekProviderIdentityFor();
  const equivalents = [
    'https://api.deepseek.com',
    'https://api.deepseek.com/',
    'HTTPS://API.DEEPSEEK.COM:443///',
  ];

  assert.equal(expected.canonicalBaseUrl, 'https://api.deepseek.com');
  assert.equal(expected.endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(
    expected.identity,
    'a34e2a4708ed1c61008a151688838dcf1c44d4e7f08054633e72ba7c0b16cfc1',
  );
  assert.equal(expected.secretKey, LEGACY_DEEPSEEK_SECRET_KEY);
  assert.equal(expected.consentKey, LEGACY_DEEPSEEK_CONSENT_KEY);
  assert.equal(expected.isOfficialDefault, true);
  assert.ok(Object.isFrozen(expected));

  for (const equivalent of equivalents) {
    assert.deepEqual(deepSeekProviderIdentityFor(equivalent), expected);
  }
});

test('DeepSeek identities isolate hosts, ports, paths, and OpenAI storage scopes', () => {
  const identities = [
    deepSeekProviderIdentityFor('https://api.deepseek.com'),
    deepSeekProviderIdentityFor('https://proxy.example.test/v1'),
    deepSeekProviderIdentityFor('https://api.deepseek.com:8443'),
    deepSeekProviderIdentityFor('https://api.deepseek.com/gateway/v1'),
  ];

  assert.equal(new Set(identities.map((value) => value.identity)).size, identities.length);
  assert.equal(new Set(identities.map((value) => value.secretKey)).size, identities.length);
  assert.equal(new Set(identities.map((value) => value.consentKey)).size, identities.length);
  assert.equal(new Set(identities.map((value) => value.endpoint)).size, identities.length);

  const sharedAddress = 'https://proxy.example.test/v1';
  const deepSeek = deepSeekProviderIdentityFor(sharedAddress);
  const openAI = openAIProviderIdentityFor(sharedAddress);
  assert.notEqual(deepSeek.secretKey, openAI.secretKey);
  assert.notEqual(deepSeek.consentKey, openAI.consentKey);
  assert.match(deepSeek.secretKey, /^texleaf\.deepseekApiKey\.v2\.[a-f0-9]{64}$/u);
  assert.match(deepSeek.consentKey, /^texleaf\.aiWritingConsent\.deepseek\.v1\.[a-f0-9]{64}$/u);
});

test('DeepSeek legacy keys remain active only for the official default address', () => {
  const official = deepSeekProviderIdentityFor();
  const custom = deepSeekProviderIdentityFor('https://proxy.example.test/deepseek');

  assert.equal(official.secretKey, LEGACY_DEEPSEEK_SECRET_KEY);
  assert.equal(official.consentKey, LEGACY_DEEPSEEK_CONSENT_KEY);
  assert.equal(custom.isOfficialDefault, false);
  assert.equal(custom.secretKey.startsWith(DEEPSEEK_SECRET_KEY_PREFIX), true);
  assert.equal(custom.consentKey.startsWith(DEEPSEEK_CONSENT_KEY_PREFIX), true);
  assert.notEqual(custom.secretKey, official.secretKey);
  assert.notEqual(custom.consentKey, official.consentKey);
});

test('unsafe DeepSeek Base URLs fail before an identity is created', () => {
  const unsafe = [
    'http://api.deepseek.com',
    'https://user:password@api.deepseek.com',
    'https://api.deepseek.com?tenant=other',
    'https://api.deepseek.com#other',
    'https://api.deepseek.com.',
    'https://api.deepseek.com/chat/completions',
    'javascript:alert(1)',
  ];

  for (const value of unsafe) {
    assert.throws(
      () => deepSeekProviderIdentityFor(value),
      (error: unknown) => error instanceof DeepSeekClientError
        && error.kind === 'configuration',
      value,
    );
  }
});

test('DeepSeek storage identifiers contain only provider prefixes and a full digest', () => {
  const rawBaseUrl = 'HTTPS://PROXY.EXAMPLE.TEST:443/deepseek/v1///';
  const fakeApiKey = 'sk-test-do-not-store-in-an-identifier';
  const identity = deepSeekProviderIdentityFor(rawBaseUrl);
  const storageIdentifiers = [identity.identity, identity.secretKey, identity.consentKey];

  for (const value of storageIdentifiers) {
    assert.doesNotMatch(value, /proxy\.example\.test|deepseek\/v1|https?:/iu);
    assert.ok(!value.includes(rawBaseUrl));
    assert.ok(!value.includes(fakeApiKey));
  }
  assert.match(identity.identity, /^[a-f0-9]{64}$/u);
});

test('canonical equivalents reuse exactly one credential and consent scope', () => {
  const expected = openAIProviderIdentityFor();
  const equivalents = [
    'https://api.openai.com/v1',
    'https://api.openai.com/v1/',
    'HTTPS://API.OPENAI.COM:443/v1///',
  ];

  assert.equal(expected.canonicalBaseUrl, 'https://api.openai.com/v1');
  assert.equal(expected.endpoint, 'https://api.openai.com/v1/responses');
  assert.equal(
    expected.identity,
    'd9617135d6fdd0a2cde722d637a1dfcc3da37515708b3ea5d66ae607c8ac785e',
  );
  assert.equal(expected.secretKey, `${OPENAI_SECRET_KEY_PREFIX}${expected.identity}`);
  assert.equal(expected.consentKey, `${OPENAI_CONSENT_KEY_PREFIX}${expected.identity}`);
  assert.ok(Object.isFrozen(expected));

  for (const equivalent of equivalents) {
    assert.deepEqual(openAIProviderIdentityFor(equivalent), expected);
  }
});

test('different hosts, ports, and paths are strictly isolated', () => {
  const identities = [
    openAIProviderIdentityFor('https://api.openai.com/v1'),
    openAIProviderIdentityFor('https://proxy.example.test/v1'),
    openAIProviderIdentityFor('https://api.openai.com:8443/v1'),
    openAIProviderIdentityFor('https://api.openai.com/gateway/v1'),
  ];

  assert.equal(new Set(identities.map((value) => value.identity)).size, identities.length);
  assert.equal(new Set(identities.map((value) => value.secretKey)).size, identities.length);
  assert.equal(new Set(identities.map((value) => value.consentKey)).size, identities.length);
  assert.equal(new Set(identities.map((value) => value.endpoint)).size, identities.length);
});

test('unsafe and ambiguous Base URLs fail closed before an identity is created', () => {
  const unsafe = [
    'http://api.openai.com/v1',
    'https://user:password@api.openai.com/v1',
    'https://api.openai.com/v1?tenant=other',
    'https://api.openai.com/v1#other',
    'https://api.openai.com./v1',
    'https://api.openai.com/v1/responses',
    'javascript:alert(1)',
  ];

  for (const value of unsafe) {
    assert.throws(
      () => openAIProviderIdentityFor(value),
      (error: unknown) => error instanceof OpenAIClientError
        && error.kind === 'configuration',
      value,
    );
  }
});

test('storage identifiers contain only prefixes and a digest, never URL or API key material', () => {
  const rawBaseUrl = 'HTTPS://PROXY.EXAMPLE.TEST:443/openai/v1///';
  const fakeApiKey = 'sk-test-do-not-store-in-an-identifier';
  const identity = openAIProviderIdentityFor(rawBaseUrl);
  const storageIdentifiers = [identity.identity, identity.secretKey, identity.consentKey];

  for (const value of storageIdentifiers) {
    assert.doesNotMatch(value, /proxy\.example\.test|openai\/v1|https?:/iu);
    assert.ok(!value.includes(rawBaseUrl));
    assert.ok(!value.includes(fakeApiKey));
  }
  assert.match(identity.secretKey, /^texleaf\.openaiApiKey\.v1\.[a-f0-9]{64}$/u);
  assert.match(identity.consentKey, /^texleaf\.aiWritingConsent\.openai\.v1\.[a-f0-9]{64}$/u);
});

test('the returned identity is immutable at runtime', () => {
  const identity = openAIProviderIdentityFor('https://proxy.example.test/v1');

  assert.throws(() => {
    (identity as { canonicalBaseUrl: string }).canonicalBaseUrl = 'https://attacker.test/v1';
  }, TypeError);
  assert.equal(identity.canonicalBaseUrl, 'https://proxy.example.test/v1');
});
