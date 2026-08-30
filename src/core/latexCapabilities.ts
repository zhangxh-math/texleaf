/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import type {
  VisualDocumentLanguage,
  VisualHeadingLevel,
} from './visualStructure';

/**
 * A deliberately small, renderer-neutral description of class behaviour that
 * can be established without executing a class file. Template-specific
 * compatibility belongs here instead of being scattered through the provider
 * and MathJax worker.
 */
export interface LatexPreviewCapability {
  readonly id: string;
  readonly documentClass: string | undefined;
  readonly documentLanguage: VisualDocumentLanguage | undefined;
  readonly numberingRootLevel: VisualHeadingLevel;
  /** Safe MathJax config-macro approximations, without a leading backslash. */
  readonly mathMacros: Readonly<Record<string, string>>;
  readonly limitations: readonly string[];
}

const EMPTY_MACROS = frozenStringRecord({});

const THUTHESIS_MATH_MACROS = frozenStringRecord({
  // unicode-math style commands exposed by current ThuThesis math profiles.
  // These preserve mathematical intent in MathJax; they do not claim the same
  // glyphs as XeLaTeX with XITS/STIX/Libertinus.
  symup: String.raw`\mathrm{#1}`,
  symbf: String.raw`\boldsymbol{#1}`,
  symbfsf: String.raw`\boldsymbol{\mathsf{#1}}`,
  uppi: String.raw`\mathrm{\pi}`,
  increment: String.raw`\mathrm{\Delta}`,
  // ThuThesis' source definition is conditional on math-style. The Chinese
  // default uses an upright differential; a user/root definition discovered
  // later in the real preamble still overrides this capability fallback.
  dif: String.raw`\mathop{}\!\mathrm{d}`,
});

/**
 * Safe MathJax approximations for literal packages that are common in the
 * projects TeXLeaf is expected to preview. These definitions model only
 * renderer-visible commands; package code is never executed in the Webview.
 */
const BRAKET_PACKAGE_MATH_MACROS = frozenStringRecord({
  bra: String.raw`\mathinner{\langle{#1}\rvert}`,
  ket: String.raw`\mathinner{\lvert{#1}\rangle}`,
  braket: String.raw`\mathinner{\langle{#1}\rangle}`,
  Bra: String.raw`\left\langle#1\right\rvert`,
  Ket: String.raw`\left\lvert#1\right\rangle`,
  Braket: String.raw`\left\langle#1\right\rangle`,
  set: String.raw`\mathinner{\lbrace\,{#1}\,\rbrace}`,
  Set: String.raw`\left\{\,#1\,\right\}`,
});

const PACKAGE_MATH_MACROS = new Map<
  string,
  Readonly<Record<string, string>>
>([
  ['braket', BRAKET_PACKAGE_MATH_MACROS],
]);

const CHAPTER_CLASSES = new Set([
  'book',
  'report',
  'memoir',
  'ctexbook',
  'ctexrep',
  'thuthesis',
]);

const CHINESE_CLASSES = new Set([
  'ctexart',
  'ctexbook',
  'ctexrep',
  'ctexbeamer',
  'thuthesis',
]);

/** Resolve a conservative preview profile from literal document-class data. */
export function resolveLatexPreviewCapability(
  requestedDocumentClass: string | undefined,
  documentClassOptions = '',
): LatexPreviewCapability {
  const documentClass = normalizeDocumentClass(requestedDocumentClass);
  const numberingRootLevel: VisualHeadingLevel =
    documentClass !== undefined && CHAPTER_CLASSES.has(documentClass)
      ? 'chapter'
      : 'section';
  const language = documentClass === undefined
    ? undefined
    : documentClass === 'thuthesis'
      ? thuthesisLanguage(documentClassOptions)
      : CHINESE_CLASSES.has(documentClass)
        ? 'zh'
        : undefined;
  if (documentClass === 'thuthesis') {
    return Object.freeze({
      id: 'class:thuthesis:v1',
      documentClass,
      documentLanguage: language,
      numberingRootLevel,
      mathMacros: THUTHESIS_MATH_MACROS,
      limitations: Object.freeze([
        'MathJax uses semantic font approximations instead of ThuThesis XeLaTeX glyphs.',
        'Dynamic class/package definitions are not executed.',
      ]),
    });
  }
  return Object.freeze({
    id: documentClass === undefined ? 'class:unknown:v1' : `class:${documentClass}:v1`,
    documentClass,
    documentLanguage: language,
    numberingRootLevel,
    mathMacros: EMPTY_MACROS,
    limitations: Object.freeze([
      'Dynamic class/package definitions are not executed.',
    ]),
  });
}

/**
 * Resolve renderer-safe macros from literal top-level package declarations in
 * an expanded project preamble. The scanner deliberately ignores comments
 * and commands nested inside brace groups, so a commented package or a
 * `\newcommand` replacement cannot accidentally grant preview capabilities.
 */
export function resolveLatexPackagePreviewMacros(
  preambleSource: string,
): Readonly<Record<string, string>> {
  const result = Object.create(null) as Record<string, string>;
  for (const packageName of scanLiteralTopLevelPackages(preambleSource)) {
    const macros = PACKAGE_MATH_MACROS.get(packageName);
    if (macros !== undefined) {
      Object.assign(result, macros);
    }
  }
  return Object.freeze(result);
}

function normalizeDocumentClass(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}

function thuthesisLanguage(options: string): VisualDocumentLanguage {
  return /(?:^|,)\s*language\s*=\s*english\s*(?:,|$)/iu.test(options)
    ? 'en'
    : 'zh';
}

function frozenStringRecord(
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const result = Object.create(null) as Record<string, string>;
  for (const [name, replacement] of Object.entries(values)) {
    result[name] = replacement;
  }
  return Object.freeze(result);
}

function scanLiteralTopLevelPackages(source: string): ReadonlySet<string> {
  const packages = new Set<string>();
  const scanEnd = Math.min(source.length, 1_000_000);
  let braceDepth = 0;
  let index = 0;
  while (index < scanEnd) {
    const character = source[index];
    if (character === '%' && !isEscapedAt(source, index)) {
      index = endOfLine(source, index, scanEnd);
      continue;
    }
    if (character === '{' && !isEscapedAt(source, index)) {
      braceDepth += 1;
      index += 1;
      continue;
    }
    if (character === '}' && !isEscapedAt(source, index)) {
      braceDepth = Math.max(0, braceDepth - 1);
      index += 1;
      continue;
    }
    if (character !== '\\') {
      index += 1;
      continue;
    }
    const control = readControlSequence(source, index, scanEnd);
    if (control === undefined) {
      index += 1;
      continue;
    }
    index = control.end;
    if (
      braceDepth !== 0 ||
      (control.name !== 'usepackage' && control.name !== 'RequirePackage')
    ) {
      continue;
    }
    let cursor = skipWhitespaceAndComments(source, control.end, scanEnd);
    if (source[cursor] === '[') {
      const optionalEnd = balancedArgumentEnd(source, cursor, '[', ']', scanEnd);
      if (optionalEnd === undefined) {
        continue;
      }
      cursor = skipWhitespaceAndComments(source, optionalEnd, scanEnd);
    }
    if (source[cursor] !== '{') {
      continue;
    }
    const argumentEnd = balancedArgumentEnd(source, cursor, '{', '}', scanEnd);
    if (argumentEnd === undefined) {
      continue;
    }
    const names = source.slice(cursor + 1, argumentEnd - 1);
    if (/^[\p{L}\p{N}@._,+\-\s]+$/u.test(names)) {
      for (const name of names.split(',')) {
        const normalized = name.trim().toLocaleLowerCase();
        if (normalized.length > 0) {
          packages.add(normalized);
        }
      }
    }
    index = argumentEnd;
  }
  return packages;
}

function readControlSequence(
  source: string,
  start: number,
  end: number,
): { readonly name: string; readonly end: number } | undefined {
  if (source[start] !== '\\' || start + 1 >= end) {
    return undefined;
  }
  let cursor = start + 1;
  if (/[A-Za-z@]/u.test(source[cursor] ?? '')) {
    cursor += 1;
    while (cursor < end && /[A-Za-z@]/u.test(source[cursor] ?? '')) {
      cursor += 1;
    }
  } else {
    cursor += 1;
  }
  return { name: source.slice(start + 1, cursor), end: cursor };
}

function skipWhitespaceAndComments(
  source: string,
  start: number,
  end: number,
): number {
  let cursor = start;
  while (cursor < end) {
    if (/\s/u.test(source[cursor] ?? '')) {
      cursor += 1;
      continue;
    }
    if (source[cursor] === '%' && !isEscapedAt(source, cursor)) {
      cursor = endOfLine(source, cursor, end);
      continue;
    }
    break;
  }
  return cursor;
}

function balancedArgumentEnd(
  source: string,
  start: number,
  open: '[' | '{',
  close: ']' | '}',
  end: number,
): number | undefined {
  if (source[start] !== open) {
    return undefined;
  }
  let depth = 1;
  for (let cursor = start + 1; cursor < end; cursor += 1) {
    if (source[cursor] === '%' && !isEscapedAt(source, cursor)) {
      cursor = endOfLine(source, cursor, end) - 1;
      continue;
    }
    if (source[cursor] === open && !isEscapedAt(source, cursor)) {
      depth += 1;
    } else if (source[cursor] === close && !isEscapedAt(source, cursor)) {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
  }
  return undefined;
}

function endOfLine(source: string, start: number, end: number): number {
  const newline = source.indexOf('\n', start);
  return newline < 0 || newline >= end ? end : newline + 1;
}

function isEscapedAt(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
