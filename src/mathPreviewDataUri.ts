/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

const SVG_DATA_URI_PREFIX = "data:image/svg+xml;base64,";

/**
 * Encodes a rendered MathJax SVG as a fragment-safe URI for editor decorations.
 * Base64 is intentional: MathJax SVGs contain internal `#id` references, and a
 * UTF-8 data URI could otherwise treat those references as the URI fragment.
 */
export function createMathPreviewSvgDataUri(svg: string): string {
  return `${SVG_DATA_URI_PREFIX}${Buffer.from(svg, "utf8").toString("base64")}`;
}
