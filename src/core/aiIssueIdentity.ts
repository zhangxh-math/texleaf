import { createHash, randomBytes } from 'node:crypto';

export interface AiIssueActionSource {
  readonly id: string;
  readonly fingerprint: string;
  readonly documentVersion: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly original: string;
  readonly replacement: string;
  readonly category: string;
}

export interface CapturedAiIssueIdentity {
  readonly id: string;
  readonly fingerprint: string;
  readonly documentVersion: number;
  readonly range: {
    readonly start: number;
    readonly end: number;
  };
  readonly original: string;
  readonly replacement: string;
  readonly category: string;
}

/**
 * Create an opaque command identity independent from a location fingerprint.
 *
 * The optional nonce exists for deterministic tests. Production callers omit
 * it and receive 256 bits from Node's cryptographic random source. Including
 * the version and fingerprint keeps the ID auditable without allowing either
 * value to deterministically rebind an older command at a historical offset.
 */
export function createAiIssueActionId(
  fingerprint: string,
  documentVersion: number,
  lineageNonce = randomBytes(32).toString('hex'),
): string {
  const digest = createHash('sha256').update([
    'texleaf-ai-action-v2',
    fingerprint,
    String(documentVersion),
    lineageNonce,
  ].join('\u0000'), 'utf8').digest('hex');
  return `texleaf-ai-${digest}`;
}

export function captureAiIssueIdentity(
  issue: AiIssueActionSource,
): CapturedAiIssueIdentity {
  return {
    id: issue.id,
    fingerprint: issue.fingerprint,
    documentVersion: issue.documentVersion,
    range: {
      start: issue.sourceStart,
      end: issue.sourceEnd,
    },
    original: issue.original,
    replacement: issue.replacement,
    category: issue.category,
  };
}

export function aiIssueMatchesCapturedIdentity(
  issue: AiIssueActionSource,
  captured: CapturedAiIssueIdentity,
): boolean {
  return issue.id === captured.id &&
    issue.fingerprint === captured.fingerprint &&
    issue.documentVersion === captured.documentVersion &&
    issue.sourceStart === captured.range.start &&
    issue.sourceEnd === captured.range.end &&
    issue.original === captured.original &&
    issue.replacement === captured.replacement &&
    issue.category === captured.category;
}
