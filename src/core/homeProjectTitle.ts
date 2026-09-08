/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import {
  createMathPreviewRenderInput,
  scanMathPreviewDocument,
} from "./mathPreview";

const MAX_VISUAL_TITLE_FORMULAS = 4;
const MAX_VISUAL_TITLE_SOURCE_LENGTH = 512;

const ACCENT_MARKS: Readonly<Record<string, string>> = Object.freeze({
  "'": "\u0301",
  "`": "\u0300",
  "^": "\u0302",
  '"': "\u0308",
  "~": "\u0303",
  "=": "\u0304",
  ".": "\u0307",
  "u": "\u0306",
  "v": "\u030c",
  "H": "\u030b",
  "c": "\u0327",
  "k": "\u0328",
  "r": "\u030a",
  "b": "\u0331",
  "d": "\u0323",
});

const SPECIAL_TEXT_COMMANDS: Readonly<Record<string, string>> = Object.freeze({
  TeX: "TeX",
  LaTeX: "LaTeX",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  aa: "å",
  AA: "Å",
  o: "ø",
  O: "Ø",
  ss: "ß",
  l: "ł",
  L: "Ł",
  i: "ı",
  j: "ȷ",
  textasciitilde: "~",
  textasciicircum: "^",
  textbackslash: "\\",
});

const TEXT_WRAPPER_COMMANDS = new Set([
  "emph",
  "mbox",
  "textrm",
  "textsf",
  "texttt",
  "textup",
  "textit",
  "textsl",
  "textsc",
  "textmd",
  "textbf",
  "textnormal",
]);

export interface HomeProjectTitleTextSegment {
  readonly kind: "text";
  readonly text: string;
}

export interface HomeProjectTitleMathSegment {
  readonly kind: "math";
  /** Normalized MathJax input without its source delimiters. */
  readonly tex: string;
  /** Exact source, retained as a faithful fallback if rendering is unavailable. */
  readonly fallbackText: string;
  readonly accessibleText: string;
  /** Filled only by the extension-host renderer after the worker safety boundary. */
  readonly dataUri?: string;
  readonly widthEm?: number;
  readonly heightEm?: number;
}

export type HomeProjectTitleSegment =
  | HomeProjectTitleTextSegment
  | HomeProjectTitleMathSegment;

export interface HomeProjectTitlePresentation {
  readonly accessibleText: string;
  readonly segments: readonly HomeProjectTitleSegment[];
}

/**
 * Convert the small, presentational subset of TeX commonly used in project
 * titles to Unicode. This is deliberately not a TeX evaluator: unknown
 * commands remain visible, while accents, escaped punctuation, standard
 * letter commands, grouping, and harmless text-style wrappers are decoded.
 */
export function latexProjectTitleTextToUnicode(source: string): string {
  return decodeLatexTitleText(source, 0).normalize("NFC");
}

/**
 * Split a project title into Unicode text and a bounded set of closed math
 * fragments. The existing LaTeX scanner remains the delimiter source of truth;
 * malformed or excessive formulae stay literal instead of being guessed.
 */
export function parseHomeProjectTitle(source: string): HomeProjectTitlePresentation {
  if (source.length === 0 || source.length > MAX_VISUAL_TITLE_SOURCE_LENGTH) {
    const text = latexProjectTitleTextToUnicode(source);
    return freezePresentation(text, text.length === 0 ? [] : [{ kind: "text", text }]);
  }

  const snapshot = scanMathPreviewDocument(source, {
    fragmentKind: "body",
    maxSourceLength: MAX_VISUAL_TITLE_SOURCE_LENGTH,
  });
  const formulas = snapshot.formulas.filter((formula) =>
    formula.closed && formula.syntax !== "environment"
  );
  const segments: HomeProjectTitleSegment[] = [];
  let cursor = 0;
  let renderedFormulaCount = 0;

  for (const formula of formulas) {
    if (
      renderedFormulaCount >= MAX_VISUAL_TITLE_FORMULAS ||
      formula.outerRange.start < cursor ||
      formula.outerRange.end > source.length
    ) {
      continue;
    }
    appendTextSegment(segments, source.slice(cursor, formula.outerRange.start));
    const input = createMathPreviewRenderInput(source, formula, snapshot);
    if (input === undefined || input.tex.trim().length === 0) {
      appendTextSegment(segments, source.slice(formula.outerRange.start, formula.outerRange.end));
    } else {
      const tex = input.tex.trim();
      segments.push(Object.freeze({
        kind: "math",
        tex,
        fallbackText: source.slice(formula.outerRange.start, formula.outerRange.end),
        accessibleText: `公式 ${tex}`,
      }));
      renderedFormulaCount += 1;
    }
    cursor = formula.outerRange.end;
  }
  appendTextSegment(segments, source.slice(cursor));

  const accessibleText = segments.map((segment) =>
    segment.kind === "text" ? segment.text : segment.accessibleText
  ).join("").replace(/\s+/gu, " ").trim();
  return freezePresentation(
    accessibleText || latexProjectTitleTextToUnicode(source),
    segments,
  );
}

function appendTextSegment(segments: HomeProjectTitleSegment[], source: string): void {
  if (source.length === 0) return;
  const text = latexProjectTitleTextToUnicode(source);
  if (text.length === 0) return;
  const previous = segments.at(-1);
  if (previous?.kind === "text") {
    segments[segments.length - 1] = Object.freeze({
      kind: "text",
      text: previous.text + text,
    });
  } else {
    segments.push(Object.freeze({ kind: "text", text }));
  }
}

function freezePresentation(
  accessibleText: string,
  segments: readonly HomeProjectTitleSegment[],
): HomeProjectTitlePresentation {
  return Object.freeze({
    accessibleText,
    segments: Object.freeze([...segments]),
  });
}

function decodeLatexTitleText(source: string, depth: number): string {
  if (depth > 12) return source;
  let result = "";
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (character === "{") {
      const close = matchingBrace(source, index);
      if (close < 0) {
        result += character;
        index += 1;
      } else {
        result += decodeLatexTitleText(source.slice(index + 1, close), depth + 1);
        index = close + 1;
      }
      continue;
    }
    if (character === "}") {
      result += character;
      index += 1;
      continue;
    }
    if (character === "~") {
      result += "\u00a0";
      index += 1;
      continue;
    }
    if (character !== "\\") {
      result += character;
      index += 1;
      continue;
    }
    if (index + 1 >= source.length) {
      result += "\\";
      break;
    }

    const next = source[index + 1]!;
    if (!/[A-Za-z]/u.test(next) && ACCENT_MARKS[next] !== undefined) {
      const accented = readAccentArgument(source, index + 2, ACCENT_MARKS[next]!, depth);
      if (accented !== undefined) {
        result += accented.text;
        index = accented.end;
      } else {
        result += `\\${next}`;
        index += 2;
      }
      continue;
    }
    if (/[A-Za-z]/u.test(next)) {
      let end = index + 2;
      while (end < source.length && /[A-Za-z]/u.test(source[end]!)) end += 1;
      const command = source.slice(index + 1, end);
      const accent = ACCENT_MARKS[command];
      if (accent !== undefined) {
        const accented = readAccentArgument(source, end, accent, depth);
        if (accented !== undefined) {
          result += accented.text;
          index = accented.end;
        } else {
          result += `\\${command}`;
          index = end;
        }
        continue;
      }
      const special = SPECIAL_TEXT_COMMANDS[command];
      if (special !== undefined) {
        result += special;
        index = skipEmptyGroup(source, end);
        continue;
      }
      if (TEXT_WRAPPER_COMMANDS.has(command)) {
        const argumentStart = skipWhitespace(source, end);
        if (source[argumentStart] === "{") {
          const close = matchingBrace(source, argumentStart);
          if (close >= 0) {
            result += decodeLatexTitleText(
              source.slice(argumentStart + 1, close),
              depth + 1,
            );
            index = close + 1;
            continue;
          }
        }
      }
      result += `\\${command}`;
      index = end;
      continue;
    }

    const escaped: Readonly<Record<string, string>> = {
      "&": "&",
      "%": "%",
      "#": "#",
      "$": "$",
      "_": "_",
      "{": "{",
      "}": "}",
      " ": " ",
      "\\": " ",
    };
    if (escaped[next] !== undefined) {
      result += escaped[next];
      index += 2;
      continue;
    }
    result += `\\${next}`;
    index += 2;
  }
  return result;
}

function readAccentArgument(
  source: string,
  from: number,
  mark: string,
  depth: number,
): { readonly text: string; readonly end: number } | undefined {
  const start = skipWhitespace(source, from);
  if (start >= source.length) return undefined;
  let argument: string;
  let end: number;
  if (source[start] === "{") {
    const close = matchingBrace(source, start);
    if (close < 0) return undefined;
    argument = decodeLatexTitleText(source.slice(start + 1, close), depth + 1);
    end = close + 1;
  } else if (source[start] === "\\") {
    const dotless = /^(?:\\i|\\j)(?:\{\})?/u.exec(source.slice(start));
    if (dotless === null) return undefined;
    argument = dotless[0].startsWith("\\i") ? "ı" : "ȷ";
    end = start + dotless[0].length;
  } else {
    const codePoint = source.codePointAt(start);
    if (codePoint === undefined) return undefined;
    argument = String.fromCodePoint(codePoint);
    end = start + argument.length;
  }
  if (argument.length === 0) return undefined;
  const characters = [...argument];
  return {
    text: `${characters[0]}${mark}`.normalize("NFC") + characters.slice(1).join(""),
    end,
  };
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function skipWhitespace(source: string, from: number): number {
  let index = from;
  while (index < source.length && /\s/u.test(source[index]!)) index += 1;
  return index;
}

function skipEmptyGroup(source: string, from: number): number {
  const start = skipWhitespace(source, from);
  return source.startsWith("{}", start) ? start + 2 : from;
}
