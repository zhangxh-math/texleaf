export interface BoundedResponseHeaders {
  get(name: string): string | null;
}

export interface BoundedResponseReader {
  read(): Promise<{
    readonly done: boolean;
    readonly value?: Uint8Array;
  }>;
  cancel?(reason?: unknown): Promise<void> | void;
  releaseLock?(): void;
}

export interface BoundedReadableBody {
  getReader(): BoundedResponseReader;
}

export interface BoundedTextResponse {
  readonly headers?: BoundedResponseHeaders;
  readonly body?: BoundedReadableBody | null;
  text(): Promise<string>;
}

export class BoundedResponseBodyError extends Error {
  public readonly code: 'invalid-body' | 'too-large';

  public constructor(code: 'invalid-body' | 'too-large') {
    super(code);
    this.name = 'BoundedResponseBodyError';
    this.code = code;
  }
}

function safelyCancelReader(reader: BoundedResponseReader): void {
  try {
    const cancellation = reader.cancel?.();
    if (cancellation !== undefined) {
      void Promise.resolve(cancellation).catch(() => undefined);
    }
  } catch {
    // Never surface a stream's raw cancellation error or response data.
  }
}

/**
 * Read a successful fetch response without first buffering an unbounded body.
 * Standard fetch responses use their ReadableStream; small structural test
 * doubles without a stream retain the deliberately simple text() fallback.
 */
export async function readBoundedResponseText(
  response: BoundedTextResponse,
  options: {
    readonly maxBytes: number;
    readonly maxCharacters?: number;
    readonly signal?: AbortSignal;
  },
): Promise<string> {
  const maxCharacters = options.maxCharacters ?? Number.MAX_SAFE_INTEGER;
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes <= 0 ||
    !Number.isSafeInteger(maxCharacters) ||
    maxCharacters <= 0
  ) {
    throw new BoundedResponseBodyError('invalid-body');
  }

  const declaredLength = response.headers?.get('content-length');
  if (declaredLength !== undefined && declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)) {
      throw new BoundedResponseBodyError('invalid-body');
    }
    try {
      if (BigInt(declaredLength) > BigInt(options.maxBytes)) {
        throw new BoundedResponseBodyError('too-large');
      }
    } catch (error: unknown) {
      if (error instanceof BoundedResponseBodyError) {
        throw error;
      }
      throw new BoundedResponseBodyError('invalid-body');
    }
  }

  const readable = response.body;
  if (readable === undefined || readable === null) {
    const text = await response.text();
    if (
      typeof text !== 'string' ||
      text.length > maxCharacters ||
      Buffer.byteLength(text, 'utf8') > options.maxBytes
    ) {
      throw new BoundedResponseBodyError(
        typeof text === 'string' ? 'too-large' : 'invalid-body',
      );
    }
    return text;
  }

  let reader: BoundedResponseReader;
  try {
    reader = readable.getReader();
  } catch {
    throw new BoundedResponseBodyError('invalid-body');
  }

  let aborted = options.signal?.aborted ?? false;
  const abortListener = (): void => {
    aborted = true;
    safelyCancelReader(reader);
  };
  options.signal?.addEventListener('abort', abortListener, { once: true });

  const decoder = new TextDecoder('utf-8');
  const pieces: string[] = [];
  let byteLength = 0;
  let characterLength = 0;
  try {
    while (true) {
      if (aborted) {
        throw new BoundedResponseBodyError('invalid-body');
      }
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      if (!(chunk.value instanceof Uint8Array)) {
        throw new BoundedResponseBodyError('invalid-body');
      }
      byteLength += chunk.value.byteLength;
      if (byteLength > options.maxBytes) {
        throw new BoundedResponseBodyError('too-large');
      }
      const decoded = decoder.decode(chunk.value, { stream: true });
      characterLength += decoded.length;
      if (characterLength > maxCharacters) {
        throw new BoundedResponseBodyError('too-large');
      }
      pieces.push(decoded);
    }
    const final = decoder.decode();
    characterLength += final.length;
    if (characterLength > maxCharacters) {
      throw new BoundedResponseBodyError('too-large');
    }
    pieces.push(final);
    return pieces.join('');
  } catch (error: unknown) {
    safelyCancelReader(reader);
    if (error instanceof BoundedResponseBodyError) {
      throw error;
    }
    throw new BoundedResponseBodyError('invalid-body');
  } finally {
    options.signal?.removeEventListener('abort', abortListener);
    try {
      reader.releaseLock?.();
    } catch {
      // A released/errored reader needs no further cleanup.
    }
  }
}
