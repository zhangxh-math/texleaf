import {
  CaptureTemplatePart,
  ReplacementContext,
  ReplacementPart,
  ReplacementTemplatePart,
  SnippetSyntaxVersion,
  VsCodeTabstopMapping,
} from './types';

function pushTemplateText(parts: ReplacementTemplatePart[], value: string): void {
  if (value.length === 0) {
    return;
  }
  const previous = parts[parts.length - 1];
  if (previous?.kind === 'text') {
    parts[parts.length - 1] = { kind: 'text', value: previous.value + value };
  } else {
    parts.push({ kind: 'text', value });
  }
}

function pushReplacementText(parts: ReplacementPart[], value: string): void {
  if (value.length === 0) {
    return;
  }
  const previous = parts[parts.length - 1];
  if (previous?.kind === 'text') {
    parts[parts.length - 1] = { kind: 'text', value: previous.value + value };
  } else {
    parts.push({ kind: 'text', value });
  }
}

function isCaptureName(value: string): boolean {
  return /^[A-Za-z$_][A-Za-z$_0-9]*$/.test(value);
}

function parseVersionTwo(replacement: string): readonly ReplacementTemplatePart[] {
  const parts: ReplacementTemplatePart[] = [];
  let index = 0;

  while (index < replacement.length) {
    if (replacement.startsWith('@@', index)) {
      pushTemplateText(parts, '@');
      index += 2;
      continue;
    }

    if (replacement.startsWith('@{VISUAL}', index)) {
      parts.push({ kind: 'visual', raw: '@{VISUAL}' });
      index += '@{VISUAL}'.length;
      continue;
    }

    if (replacement.startsWith('@[', index)) {
      const close = replacement.indexOf(']', index + 2);
      if (close >= 0) {
        const referenceText = replacement.slice(index + 2, close);
        const reference = /^\d+$/.test(referenceText)
          ? Number(referenceText)
          : isCaptureName(referenceText)
            ? referenceText
            : undefined;
        if (reference !== undefined) {
          const raw = replacement.slice(index, close + 1);
          parts.push({ kind: 'capture', reference, raw, version: 2 });
          index = close + 1;
          continue;
        }
      }
    }

    if (replacement.startsWith('@{', index)) {
      const close = replacement.indexOf('}', index + 2);
      if (close >= 0) {
        const body = replacement.slice(index + 2, close);
        const match = /^(\d+)(?::([\s\S]*))?$/.exec(body);
        if (match !== null) {
          parts.push({
            kind: 'tabstop',
            index: Number(match[1]!),
            placeholder: match[2],
          });
          index = close + 1;
          continue;
        }
      }
    }

    if (replacement[index] === '@') {
      const number = /^(\d+)/.exec(replacement.slice(index + 1));
      if (number !== null) {
        parts.push({ kind: 'tabstop', index: Number(number[1]) });
        index += number[1]!.length + 1;
        continue;
      }
    }

    pushTemplateText(parts, replacement[index]!);
    index += 1;
  }

  return parts;
}

function parseVersionOne(replacement: string): readonly ReplacementTemplatePart[] {
  const parts: ReplacementTemplatePart[] = [];
  let index = 0;

  while (index < replacement.length) {
    if (replacement.startsWith('${VISUAL}', index)) {
      parts.push({ kind: 'visual', raw: '${VISUAL}' });
      index += '${VISUAL}'.length;
      continue;
    }

    if (replacement.startsWith('[[', index)) {
      const match = /^\[\[(\d+)\]\]/.exec(replacement.slice(index));
      if (match !== null) {
        const raw = match[0];
        parts.push({
          kind: 'capture',
          reference: Number(match[1]),
          raw,
          version: 1,
        });
        index += raw.length;
        continue;
      }
    }

    if (replacement.startsWith('${', index)) {
      const close = replacement.indexOf('}', index + 2);
      if (close >= 0) {
        const body = replacement.slice(index + 2, close);
        const match = /^(\d+)(?::([\s\S]*))?$/.exec(body);
        if (match !== null) {
          parts.push({
            kind: 'tabstop',
            index: Number(match[1]!),
            placeholder: match[2],
          });
          index = close + 1;
          continue;
        }
      }
    }

    // Version one intentionally treats $10 as tabstop 1 followed by literal
    // zero, matching the upstream v1 grammar.
    if (replacement[index] === '$' && /\d/.test(replacement[index + 1] ?? '')) {
      parts.push({ kind: 'tabstop', index: Number(replacement[index + 1]) });
      index += 2;
      continue;
    }

    pushTemplateText(parts, replacement[index]!);
    index += 1;
  }

  return parts;
}

export function parseReplacementTemplate(
  replacement: string,
  version: SnippetSyntaxVersion = 2,
): readonly ReplacementTemplatePart[] {
  return version === 1 ? parseVersionOne(replacement) : parseVersionTwo(replacement);
}

function materializeCapture(
  part: CaptureTemplatePart,
  context: ReplacementContext,
): string {
  if (typeof part.reference === 'number') {
    const captures = context.captures;
    if (captures === undefined || part.reference < 0 || part.reference >= captures.length) {
      return part.raw;
    }
    const value = captures[part.reference];
    return value === undefined ? (part.version === 1 ? 'undefined' : '') : value;
  }

  const namedCaptures = context.namedCaptures;
  if (namedCaptures === undefined || !Object.prototype.hasOwnProperty.call(namedCaptures, part.reference)) {
    return part.raw;
  }
  return namedCaptures[part.reference] ?? (part.version === 1 ? 'undefined' : '');
}

/** Resolve captures and visual text, leaving only text and neutral tabstops. */
export function materializeReplacement(
  template: readonly ReplacementTemplatePart[],
  context: ReplacementContext = {},
): readonly ReplacementPart[] {
  const parts: ReplacementPart[] = [];
  for (const part of template) {
    switch (part.kind) {
      case 'text':
        pushReplacementText(parts, part.value);
        break;
      case 'tabstop':
        parts.push({
          kind: 'tabstop',
          index: part.index,
          placeholder: part.placeholder,
        });
        break;
      case 'capture':
        pushReplacementText(parts, materializeCapture(part, context));
        break;
      case 'visual':
        pushReplacementText(parts, context.visualText ?? part.raw);
        break;
    }
  }
  return parts;
}

/**
 * Shift Snippet Leaf's zero-based tabstops to VS Code's order. The highest
 * explicitly declared index becomes VS Code's final `$0`, so no synthetic
 * tabstop is added after the replacement text. This is important for
 * environment snippets whose only `@0` intentionally stays inside the body.
 */
export function remapTabstopsForVsCode(parts: readonly ReplacementPart[]): VsCodeTabstopMapping {
  const tabstopIndexes = parts
    .filter((part): part is Extract<ReplacementPart, { kind: 'tabstop' }> =>
      part.kind === 'tabstop')
    .map((part) => part.index);
  const finalIndex = tabstopIndexes.length === 0
    ? undefined
    : Math.max(...tabstopIndexes);
  return {
    parts: parts.map((part) =>
      part.kind === 'tabstop'
        ? { ...part, index: part.index === finalIndex ? 0 : part.index + 1 }
        : part,
    ),
  };
}

/** Plain text representation useful for previews and non-interactive fallbacks. */
export function replacementPartsToText(parts: readonly ReplacementPart[]): string {
  return parts
    .map((part) => (part.kind === 'text' ? part.value : (part.placeholder ?? '')))
    .join('');
}
