/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { isMathPreviewMacroName } from "../mathPreviewProtocol";
import type { MathPreviewRenderInput } from "./mathPreview";
import type { VisualFormulaAsset } from "./visualFormula";

const MAX_LOCAL_PREVIEW_SOURCE_LENGTH = 32_768;
const MAX_LOCAL_PREVIEW_SVG_LENGTH = 4_000_000;

const BLOCKED_LOCAL_TEX_COMMAND = /\\(?:input|include|includeonly|usepackage|documentclass|RequirePackage|includegraphics|pgfimage|openin|openout|closein|closeout|read|readline|write|immediate|special|catcode|csname|endcsname|newread|newwrite|everyjob|directlua|latelua|pdfobj|pdfxform|pdffilemoddate|pdffilesize|pdfmdfivesum|filemodprint|shellescape|write18|scantokens|@@input|primitive)\b/iu;
const BLOCKED_LOCAL_TEX_ENVIRONMENT = /\\(?:begin|end)\s*\{\s*(?:document|filecontents\*?)\s*\}/iu;
const YTABLEAU_ENVIRONMENT = /\\begin\s*\{\s*ytableau\s*\}/iu;
const TIKZPICTURE_ENVIRONMENT = /\\begin\s*\{\s*tikzpicture\s*\}/iu;
const TIKZCD_ENVIRONMENT = /\\begin\s*\{\s*tikzcd\s*\}/iu;
const DISPLAY_ENVIRONMENT = /^\s*\\begin\s*\{\s*(?:equation\*?|align\*?|alignat\*?|gather\*?|multline\*?|flalign\*?|displaymath)\s*\}/u;

export type LocalLatexPreviewKind = "ytableau" | "tikzpicture" | "tikzcd";

export interface SanitizedLocalLatexSvg extends VisualFormulaAsset {
  readonly cursorMarked: boolean;
}

/**
 * Detect the small set of structures that deliberately use the installed TeX
 * distribution instead of MathJax. Keeping this allowlist exact is important:
 * ordinary formulae remain instantaneous and never start a TeX process merely
 * because MathJax rejected them.
 */
export function localLatexPreviewKind(
  input: MathPreviewRenderInput,
): LocalLatexPreviewKind | undefined {
  if (!isSafeLocalLatexInput(input)) {
    return undefined;
  }
  if (TIKZPICTURE_ENVIRONMENT.test(input.tex)) {
    return "tikzpicture";
  }
  if (TIKZCD_ENVIRONMENT.test(input.tex)) {
    return "tikzcd";
  }
  return YTABLEAU_ENVIRONMENT.test(input.tex) ? "ytableau" : undefined;
}

export function isLocalYtableauPreviewInput(input: MathPreviewRenderInput): boolean {
  return localLatexPreviewKind(input) === "ytableau";
}

export function isLocalTikzpicturePreviewInput(input: MathPreviewRenderInput): boolean {
  return localLatexPreviewKind(input) === "tikzpicture";
}

export function isLocalTikzcdPreviewInput(input: MathPreviewRenderInput): boolean {
  return localLatexPreviewKind(input) === "tikzcd";
}

export function createLocalLatexPreviewDocument(
  input: MathPreviewRenderInput,
  foreground = "#010203",
): string | undefined {
  const kind = localLatexPreviewKind(input);
  if (kind === undefined) {
    return undefined;
  }
  const color = /^#[0-9A-Fa-f]{6}$/u.test(foreground)
    ? foreground.slice(1).toUpperCase()
    : "010203";
  const macros = Object.values(input.macros)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((macro) => {
      const argumentCount = macro.argumentCount > 0 ? `[${macro.argumentCount}]` : "";
      const optionalDefault = macro.optionalDefault === undefined
        ? ""
        : `[${macro.optionalDefault}]`;
      return `\\providecommand{\\${macro.name}}{}\\renewcommand{\\${macro.name}}${argumentCount}${optionalDefault}{${macro.replacement}}`;
    })
    .join("\n");
  const normalizedTex = input.tex.replace(
    /\\color\s*\{\s*#([0-9A-Fa-f]{6})\s*\}/gu,
    "\\color[HTML]{$1}",
  );
  const content = kind === "tikzpicture" || kind === "tikzcd"
    ? normalizedTex
    : DISPLAY_ENVIRONMENT.test(normalizedTex)
      ? normalizedTex
      : input.display
        ? `\\[\n${normalizedTex}\n\\]`
        : `$${normalizedTex}$`;
  const packages = kind === "tikzpicture"
    ? String.raw`\usepackage{amsmath,amssymb,mathtools,xcolor,tikz}
\usetikzlibrary{arrows.meta,backgrounds,calc,decorations.markings,decorations.pathmorphing,fit,intersections,matrix,positioning,quotes,shapes.geometric,shapes.multipart}`
    : kind === "tikzcd"
      ? String.raw`\usepackage{amsmath,amssymb,mathtools,xcolor,tikz-cd}
\usetikzlibrary{arrows.meta,calc,decorations.pathmorphing,positioning}`
      : String.raw`\usepackage{amsmath,amssymb,mathtools,xcolor,ytableau}`;
  return String.raw`\documentclass[varwidth,border=1pt]{standalone}
${packages}
\pagestyle{empty}
${macros}
\begin{document}
\color[HTML]{${color}}
${content}
\end{document}
`;
}

/** Backward-compatible name retained for the ytableau unit boundary. */
export function createLocalYtableauDocument(
  input: MathPreviewRenderInput,
  foreground = "#010203",
): string | undefined {
  return isLocalYtableauPreviewInput(input)
    ? createLocalLatexPreviewDocument(input, foreground)
    : undefined;
}

export function sanitizeLocalLatexSvg(
  source: string,
  scale: number,
  foreground = "#010203",
  idPrefix = "texleaf-local",
  kind: LocalLatexPreviewKind = "ytableau",
  cursorMarkerColor?: string,
): SanitizedLocalLatexSvg {
  const start = source.search(/<svg(?:\s|>)/iu);
  const end = source.lastIndexOf("</svg>");
  if (start < 0 || end < start || source.length > MAX_LOCAL_PREVIEW_SVG_LENGTH) {
    throw new Error("Local TeX returned malformed SVG.");
  }
  let svg = source.slice(start, end + "</svg>".length);
  if (
    /<(?:script|foreignObject|iframe|object|embed)\b/iu.test(svg) ||
    /\son[a-z]+\s*=/iu.test(svg) ||
    /(?:javascript:|data:text\/html|url\s*\(\s*["']?(?!#))/iu.test(svg) ||
    /\b(?:xlink:)?href\s*=\s*["'](?!#)/iu.test(svg)
  ) {
    throw new Error("Local TeX returned unsafe SVG content.");
  }
  const width = readSvgLength(svg, "width");
  const height = readSvgLength(svg, "height");
  if (width === undefined || height === undefined) {
    throw new Error("Local TeX SVG has no usable dimensions.");
  }
  const safeScale = Math.max(0.5, Math.min(3, Number.isFinite(scale) ? scale : 1));
  const widthEm = Math.max(0.5, lengthToEm(width.value, width.unit) * safeScale);
  const heightEm = Math.max(0.5, lengthToEm(height.value, height.unit) * safeScale);
  const prefix = idPrefix.replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 80) || "texleaf-local";
  svg = prefixSvgIds(svg, prefix);
  svg = replaceSvgLength(svg, "width", `${roundDimension(widthEm)}em`);
  svg = replaceSvgLength(svg, "height", `${roundDimension(heightEm)}em`);
  const safeForeground = /^#[0-9A-Fa-f]{6}$/u.test(foreground)
    ? foreground.toLowerCase()
    : "#010203";
  const label = kind === "tikzpicture"
    ? "TikZ picture preview"
    : kind === "tikzcd"
      ? "tikz-cd diagram preview"
      : "Young tableau preview";
  svg = svg.replace(
    /^<svg\b/iu,
    `<svg aria-label="${label}" shape-rendering="geometricPrecision" fill="${safeForeground}"`,
  );
  const marked = markLocalLatexCursor(svg, cursorMarkerColor);
  return { svg: marked.svg, widthEm, heightEm, cursorMarked: marked.marked };
}

function isSafeLocalLatexInput(input: MathPreviewRenderInput): boolean {
  return isSafeLocalLatexSource(input.tex) &&
    Object.values(input.macros).every((macro) =>
      isMathPreviewMacroName(macro.name) &&
      macro.argumentCount >= 0 &&
      macro.argumentCount <= 9 &&
      isSafeLocalLatexSource(macro.replacement) &&
      (macro.optionalDefault === undefined || isSafeLocalLatexSource(macro.optionalDefault))
    );
}

function isSafeLocalLatexSource(source: string): boolean {
  return source.length <= MAX_LOCAL_PREVIEW_SOURCE_LENGTH &&
    !source.includes("\0") &&
    !source.includes("^^") &&
    !BLOCKED_LOCAL_TEX_COMMAND.test(source) &&
    !BLOCKED_LOCAL_TEX_ENVIRONMENT.test(source);
}

function readSvgLength(
  source: string,
  attribute: "width" | "height",
): { readonly value: number; readonly unit: string } | undefined {
  const match = new RegExp(
    `\\b${attribute}\\s*=\\s*(["'])([0-9]+(?:\\.[0-9]+)?)(pt|bp|px|em)\\1`,
    "iu",
  ).exec(source);
  const value = Number.parseFloat(match?.[2] ?? "");
  return Number.isFinite(value) && value > 0 && match?.[3] !== undefined
    ? { value, unit: match[3].toLowerCase() }
    : undefined;
}

function replaceSvgLength(
  source: string,
  attribute: "width" | "height",
  replacement: string,
): string {
  return source.replace(
    new RegExp(
      `\\b${attribute}\\s*=\\s*(["'])[0-9]+(?:\\.[0-9]+)?(?:pt|bp|px|em)\\1`,
      "iu",
    ),
    `${attribute}="${replacement}"`,
  );
}

function lengthToEm(value: number, unit: string): number {
  if (unit === "em") {
    return value;
  }
  if (unit === "px") {
    return value / 16;
  }
  // One 16px editor em is 12 PostScript points (and approximately 12 TeX pt).
  return value / 12;
}

function prefixSvgIds(source: string, prefix: string): string {
  const ids = new Map<string, string>();
  let svg = source.replace(
    /\bid\s*=\s*(["'])([^"']+)\1/giu,
    (_match, quote: string, id: string) => {
      const replacement = `${prefix}-${id}`;
      ids.set(id, replacement);
      return `id=${quote}${replacement}${quote}`;
    },
  );
  for (const [id, replacement] of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    svg = svg.replace(
      new RegExp(`((?:xlink:)?href\\s*=\\s*["'])#${escaped}(["'])`, "gu"),
      `$1#${replacement}$2`,
    );
    svg = svg.replace(
      new RegExp(`url\\(\\s*#${escaped}\\s*\\)`, "gu"),
      `url(#${replacement})`,
    );
  }
  return svg;
}

function markLocalLatexCursor(
  source: string,
  cursorMarkerColor: string | undefined,
): { readonly svg: string; readonly marked: boolean } {
  if (!/^#[0-9A-Fa-f]{6}$/u.test(cursorMarkerColor ?? "")) {
    return { svg: source, marked: false };
  }
  const escaped = (cursorMarkerColor ?? "").slice(1);
  const pattern = new RegExp(
    `(<(?:g|path|rect|use)\\b[^>]*(?:fill|stroke)\\s*=\\s*["']#${escaped}["'][^>]*)>`,
    "iu",
  );
  if (!pattern.test(source)) {
    return { svg: source, marked: false };
  }
  return {
    svg: source.replace(pattern, '$1 data-texleaf-preview-caret="true">'),
    marked: true,
  };
}

function roundDimension(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}
