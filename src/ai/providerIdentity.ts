import { createHash } from 'node:crypto';

import {
  normalizeOpenAIBaseUrl,
  responsesEndpointFor,
} from './openaiClient';
import {
  DEEPSEEK_API_BASE_URL,
  deepSeekChatCompletionsEndpointFor,
  normalizeDeepSeekBaseUrl,
} from './deepseekClient';

export const OPENAI_SECRET_KEY_PREFIX = 'texleaf.openaiApiKey.v1.';
export const OPENAI_CONSENT_KEY_PREFIX = 'texleaf.aiWritingConsent.openai.v1.';
export const DEEPSEEK_SECRET_KEY_PREFIX = 'texleaf.deepseekApiKey.v2.';
export const DEEPSEEK_CONSENT_KEY_PREFIX = 'texleaf.aiWritingConsent.deepseek.v1.';
export const LEGACY_DEEPSEEK_SECRET_KEY = 'texleaf.deepseekApiKey.v1';
export const LEGACY_DEEPSEEK_CONSENT_KEY = 'texleaf.aiWritingConsent.v1';

/**
 * Canonical, address-scoped identity for one OpenAI Responses-compatible service.
 *
 * The storage identifiers contain only a full SHA-256 digest. They deliberately
 * do not embed the service URL or accept an API key, so neither can leak through
 * VS Code storage-key names.
 */
export interface OpenAIProviderIdentity {
  readonly canonicalBaseUrl: string;
  readonly endpoint: string;
  readonly identity: string;
  readonly secretKey: string;
  readonly consentKey: string;
}

/** Address-scoped identity for one DeepSeek Chat Completions service. */
export interface DeepSeekProviderIdentity {
  readonly canonicalBaseUrl: string;
  readonly endpoint: string;
  readonly identity: string;
  readonly secretKey: string;
  readonly consentKey: string;
  /** True only for DeepSeek's canonical public API address. */
  readonly isOfficialDefault: boolean;
}

/**
 * Returns the immutable credential and consent scope for an OpenAI Base URL.
 * Invalid or insecure URLs are rejected by the shared fail-closed normalizer.
 */
export function openAIProviderIdentityFor(
  baseUrl?: string,
): Readonly<OpenAIProviderIdentity> {
  const canonicalBaseUrl = normalizeOpenAIBaseUrl(baseUrl);
  const endpoint = responsesEndpointFor(canonicalBaseUrl);
  const identity = createHash('sha256')
    .update(canonicalBaseUrl, 'utf8')
    .digest('hex');

  return Object.freeze({
    canonicalBaseUrl,
    endpoint,
    identity,
    secretKey: `${OPENAI_SECRET_KEY_PREFIX}${identity}`,
    consentKey: `${OPENAI_CONSENT_KEY_PREFIX}${identity}`,
  });
}

/**
 * Returns the immutable credential and consent scope for a DeepSeek Base URL.
 * The official service deliberately keeps the original unscoped storage keys
 * for seamless compatibility. Custom addresses always use digest-scoped keys,
 * so an official credential can never be reused by a custom service.
 */
export function deepSeekProviderIdentityFor(
  baseUrl?: string,
): Readonly<DeepSeekProviderIdentity> {
  const canonicalBaseUrl = normalizeDeepSeekBaseUrl(baseUrl);
  const endpoint = deepSeekChatCompletionsEndpointFor(canonicalBaseUrl);
  const identity = createHash('sha256')
    .update(canonicalBaseUrl, 'utf8')
    .digest('hex');
  const isOfficialDefault = canonicalBaseUrl === DEEPSEEK_API_BASE_URL;

  return Object.freeze({
    canonicalBaseUrl,
    endpoint,
    identity,
    secretKey: isOfficialDefault
      ? LEGACY_DEEPSEEK_SECRET_KEY
      : `${DEEPSEEK_SECRET_KEY_PREFIX}${identity}`,
    consentKey: isOfficialDefault
      ? LEGACY_DEEPSEEK_CONSENT_KEY
      : `${DEEPSEEK_CONSENT_KEY_PREFIX}${identity}`,
    isOfficialDefault,
  });
}
