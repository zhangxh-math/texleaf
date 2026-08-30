/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import type { MathPreviewAppearance } from "./mathPreviewAppearance";
import type { MathPreviewCursorGeometry } from "./mathPreviewProtocol";

export interface MathPreviewSvgAsset {
  readonly svg: string;
  readonly widthEm: number;
  readonly heightEm: number;
  readonly cursor?: MathPreviewCursorGeometry;
}

const HORIZONTAL_PADDING_EM = 0.55;
const VERTICAL_PADDING_EM = 0.4;
const EX_PER_EM = 2;
const CARD_MARKER = 'data-texleaf-preview-card="true"';
const NUMBER_PATTERN = "[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)";
const VIEW_BOX_PATTERN = new RegExp(
  `\\bviewBox="(${NUMBER_PATTERN})[\\s,]+(${NUMBER_PATTERN})[\\s,]+(${NUMBER_PATTERN})[\\s,]+(${NUMBER_PATTERN})"`,
  "iu",
);

export interface MathPreviewErrorLocation {
  readonly from: number;
  readonly to: number;
}

/**
 * Build a compact, self-contained failure card that works in both Monaco's
 * image attachment and the visual editor's DOM-backed Math Preview.  Keeping
 * this in SVG avoids a second layout implementation and guarantees that a
 * failed render replaces a stale formula instead of leaving an empty card.
 */
export function createMathPreviewErrorCard(
  message: string,
  source: string,
  appearance: MathPreviewAppearance,
  maximumWidthEm = 40,
): MathPreviewSvgAsset {
  const safeMessage = compactMathPreviewErrorMessage(message);
  const location = inferMathPreviewErrorLocation(safeMessage, source);
  const excerpt = mathPreviewErrorExcerpt(source, location, 64);
  const messageLines = wrapMathPreviewErrorText(safeMessage, 54, 2);
  const longest = Math.max(
    18,
    ...messageLines.map((line) => line.length),
    excerpt.text.length,
  );
  const widthEm = Math.min(
    Math.max(18, longest * 0.56 + 3.2),
    Math.max(18, maximumWidthEm),
  );
  const heightEm = 6.8 + Math.max(0, messageLines.length - 1) * 1.15;
  const unit = 100;
  const width = widthEm * unit;
  const height = heightEm * unit;
  const padding = 105;
  const foreground = safeHex(appearance.foreground, "#ffffff");
  const background = safeHex(appearance.cardBackground, "#0b0f14");
  const border = "#ff4d64";
  const muted = safeHex(appearance.cardBorder, foreground);
  const messageSvg = messageLines.map((line, index) =>
    `<text x="${padding}" y="${235 + index * 112}" fill="${foreground}" ` +
    `font-family="sans-serif" font-size="78">${escapeXml(line)}</text>`
  ).join("");
  const sourceY = 520 + Math.max(0, messageLines.length - 1) * 112;
  const before = escapeXml(excerpt.text.slice(0, excerpt.highlightFrom));
  const highlighted = escapeXml(
    excerpt.text.slice(excerpt.highlightFrom, excerpt.highlightTo),
  );
  const after = escapeXml(excerpt.text.slice(excerpt.highlightTo));
  const sourceSvg = excerpt.text.length === 0
    ? `<text x="${padding}" y="${sourceY + 80}" fill="${muted}" ` +
      `fill-opacity="0.72" font-family="monospace" font-size="70">` +
      "当前公式源码为空或尚未完成</text>"
    : `<text x="${padding}" y="${sourceY + 80}" fill="${foreground}" ` +
      `font-family="monospace" font-size="70" xml:space="preserve">` +
      `<tspan>${before}</tspan>` +
      `<tspan fill="${border}" font-weight="700">${highlighted}</tspan>` +
      `<tspan>${after}</tspan></text>`;
  const aria = escapeXml(`公式渲染失败：${safeMessage}`);
  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `data-texleaf-preview-error="true" width="${round(widthEm * EX_PER_EM)}ex" ` +
      `height="${round(heightEm * EX_PER_EM)}ex" viewBox="0 0 ${round(width)} ${round(height)}" ` +
      `role="img" aria-label="${aria}">` +
      `<rect x="4" y="4" width="${round(width - 8)}" height="${round(height - 8)}" ` +
      `rx="52" fill="${background}" fill-opacity="${round(safeOpacity(appearance.cardBackgroundOpacity, 1))}" ` +
      `stroke="${border}" stroke-width="8"/>` +
      `<circle cx="${padding + 34}" cy="105" r="34" fill="${border}"/>` +
      `<text x="${padding + 22}" y="128" fill="#ffffff" font-family="sans-serif" ` +
      `font-size="64" font-weight="700">!</text>` +
      `<text x="${padding + 92}" y="130" fill="${border}" font-family="sans-serif" ` +
      `font-size="82" font-weight="700">公式渲染失败</text>` +
      messageSvg +
      `<rect x="${padding - 28}" y="${sourceY}" width="${round(width - padding * 2 + 56)}" ` +
      `height="150" rx="24" fill="${border}" fill-opacity="0.08"/>` +
      sourceSvg +
      `</svg>`,
    widthEm,
    heightEm,
  };
}

export function inferMathPreviewErrorLocation(
  message: string,
  source: string,
): MathPreviewErrorLocation | undefined {
  if (source.length === 0) {
    return undefined;
  }
  const position = /\b(?:position|offset|character)\s*[:#]?\s*(\d+)\b/iu.exec(message);
  if (position?.[1] !== undefined) {
    const offset = clamp(Number.parseInt(position[1], 10), 0, source.length - 1);
    return { from: offset, to: Math.min(source.length, offset + 1) };
  }
  const command = /\\[A-Za-z@]+|\\[^A-Za-z\s]/u.exec(message)?.[0];
  if (command !== undefined) {
    const offset = source.indexOf(command);
    if (offset >= 0) {
      return { from: offset, to: offset + command.length };
    }
  }
  const unmatched = unmatchedBraceLocation(source);
  if (unmatched !== undefined) {
    return { from: unmatched, to: Math.min(source.length, unmatched + 1) };
  }
  return undefined;
}

function compactMathPreviewErrorMessage(message: string): string {
  const compact = message.replace(/\s+/gu, " ").trim();
  return compact.length === 0
    ? "MathJax 未返回可用的渲染结果。"
    : compact.slice(0, 180);
}

function wrapMathPreviewErrorText(
  text: string,
  maximumLength: number,
  maximumLines: number,
): readonly string[] {
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > maximumLength && lines.length + 1 < maximumLines) {
    let split = remaining.lastIndexOf(" ", maximumLength);
    if (split < Math.floor(maximumLength * 0.55)) {
      split = maximumLength;
    }
    lines.push(remaining.slice(0, split).trimEnd());
    remaining = remaining.slice(split).trimStart();
  }
  if (remaining.length > maximumLength) {
    remaining = `${remaining.slice(0, Math.max(1, maximumLength - 1))}…`;
  }
  lines.push(remaining);
  return lines;
}

function mathPreviewErrorExcerpt(
  source: string,
  location: MathPreviewErrorLocation | undefined,
  maximumLength: number,
): {
  readonly text: string;
  readonly highlightFrom: number;
  readonly highlightTo: number;
} {
  const compact = source.replace(/[\r\n\t]+/gu, " ");
  if (compact.length <= maximumLength) {
    const from = location?.from ?? 0;
    const to = location?.to ?? Math.min(compact.length, Math.max(1, from + 1));
    return {
      text: compact,
      highlightFrom: clamp(from, 0, compact.length),
      highlightTo: clamp(Math.max(from + 1, to), 0, compact.length),
    };
  }
  const focus = location?.from ?? 0;
  const start = clamp(focus - Math.floor(maximumLength / 2), 0, compact.length - maximumLength);
  const end = start + maximumLength;
  const prefix = start > 0 ? "…" : "";
  const suffix = end < compact.length ? "…" : "";
  const text = `${prefix}${compact.slice(start, end)}${suffix}`;
  const relativeFrom = prefix.length + clamp(focus - start, 0, maximumLength - 1);
  const sourceLength = Math.max(1, (location?.to ?? focus + 1) - focus);
  return {
    text,
    highlightFrom: relativeFrom,
    highlightTo: Math.min(text.length, relativeFrom + sourceLength),
  };
}

function unmatchedBraceLocation(source: string): number | undefined {
  const stack: number[] = [];
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
    } else if (char === "{") {
      stack.push(index);
    } else if (char === "}") {
      const open = stack.pop();
      if (open === undefined) {
        return index;
      }
    }
  }
  return stack.at(-1);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Paint the preview card inside the SVG itself. VS Code's public attachment
 * API has no border-radius or padding fields; keeping all visual styling in
 * the image makes the rounded, opaque surface reliable for both data-URI
 * decorations and Hover assets. Layout is handled separately.
 */
export function frameMathPreviewSvg(
  asset: MathPreviewSvgAsset,
  appearance: MathPreviewAppearance,
): MathPreviewSvgAsset {
  if (asset.svg.includes(CARD_MARKER)) {
    return asset;
  }
  const widthEx = readExDimension(asset.svg, "width");
  const heightEx = readExDimension(asset.svg, "height");
  const viewBox = VIEW_BOX_PATTERN.exec(asset.svg);
  const openingEnd = asset.svg.indexOf(">");
  if (
    widthEx === undefined ||
    heightEx === undefined ||
    viewBox === null ||
    openingEnd < 0
  ) {
    return asset;
  }
  const [x, y, viewWidth, viewHeight] = viewBox
    .slice(1, 5)
    .map((value) => Number.parseFloat(value ?? ""));
  if (
    x === undefined ||
    y === undefined ||
    viewWidth === undefined ||
    viewHeight === undefined ||
    ![x, y, viewWidth, viewHeight].every(Number.isFinite) ||
    viewWidth <= 0 ||
    viewHeight <= 0
  ) {
    return asset;
  }

  const horizontalPaddingEx = HORIZONTAL_PADDING_EM * EX_PER_EM;
  const verticalPaddingEx = VERTICAL_PADDING_EM * EX_PER_EM;
  const unitsPerExX = viewWidth / widthEx;
  const unitsPerExY = viewHeight / heightEx;
  const paddingX = horizontalPaddingEx * unitsPerExX;
  const paddingY = verticalPaddingEx * unitsPerExY;
  const framedX = x - paddingX;
  const framedY = y - paddingY;
  const framedWidth = viewWidth + paddingX * 2;
  const framedHeight = viewHeight + paddingY * 2;
  const strokeWidth = Math.max(
    1,
    Math.min(unitsPerExX, unitsPerExY) * 0.1,
  );
  const inset = strokeWidth / 2;
  const radiusX = unitsPerExX * 0.7;
  const radiusY = unitsPerExY * 0.7;
  const background = safeHex(appearance.cardBackground, "#0b0f14");
  const border = safeHex(appearance.cardBorder, "#ffffff");
  const backgroundOpacity = safeOpacity(appearance.cardBackgroundOpacity, 1);
  const borderOpacity = safeOpacity(appearance.cardBorderOpacity, 0.3);
  const card =
    `<rect ${CARD_MARKER} aria-hidden="true" ` +
    `x="${round(framedX + inset)}" y="${round(framedY + inset)}" ` +
    `width="${round(framedWidth - strokeWidth)}" ` +
    `height="${round(framedHeight - strokeWidth)}" ` +
    `rx="${round(radiusX)}" ry="${round(radiusY)}" ` +
    `fill="${background}" fill-opacity="${round(backgroundOpacity)}" ` +
    `stroke="${border}" stroke-opacity="${round(borderOpacity)}" ` +
    `stroke-width="${round(strokeWidth)}"/>`;

  let svg = asset.svg.replace(
    VIEW_BOX_PATTERN,
    `viewBox="${round(framedX)} ${round(framedY)} ${round(framedWidth)} ${round(framedHeight)}"`,
  );
  svg = replaceExDimension(
    svg,
    "width",
    widthEx + horizontalPaddingEx * 2,
  );
  svg = replaceExDimension(
    svg,
    "height",
    heightEx + verticalPaddingEx * 2,
  );
  const framedOpeningEnd = svg.indexOf(">");
  svg = `${svg.slice(0, framedOpeningEnd + 1)}${card}${svg.slice(framedOpeningEnd + 1)}`;

  return {
    svg,
    // Derive the displayed aspect ratio from the final SVG dimensions. The
    // worker deliberately gives tiny formulas a minimum metadata size, which
    // would otherwise stretch a one-glyph/card preview after padding.
    widthEm: (widthEx + horizontalPaddingEx * 2) / EX_PER_EM,
    heightEm: (heightEx + verticalPaddingEx * 2) / EX_PER_EM,
    ...(asset.cursor === undefined ? {} : { cursor: asset.cursor }),
  };
}

/**
 * Turn an oversized native-editor preview into a fixed viewport centred on
 * MathJax's measured caret. Monaco exposes the preview only as a generated
 * image, so the tracks are position indicators rather than interactive DOM
 * scrollbars. Every cursor move renders a new exact viewport and thumb
 * position; the visual editor uses a real scroll container around the same
 * tagged caret node.
 */
export function createMathPreviewCursorViewport(
  asset: MathPreviewSvgAsset,
  maximumWidthEm: number,
  maximumHeightEm: number,
  appearance: MathPreviewAppearance,
): MathPreviewSvgAsset {
  if (
    asset.cursor === undefined ||
    !positiveNumber(asset.widthEm) ||
    !positiveNumber(asset.heightEm) ||
    !positiveNumber(maximumWidthEm) ||
    !positiveNumber(maximumHeightEm)
  ) {
    return asset;
  }
  const viewBox = VIEW_BOX_PATTERN.exec(asset.svg);
  if (viewBox === null) {
    return asset;
  }
  const values = viewBox.slice(1, 5).map((value) => Number.parseFloat(value ?? ""));
  const [fullX, fullY, fullWidth, fullHeight] = values;
  if (
    fullX === undefined ||
    fullY === undefined ||
    fullWidth === undefined ||
    fullHeight === undefined ||
    !values.every(Number.isFinite) ||
    fullWidth <= 0 ||
    fullHeight <= 0
  ) {
    return asset;
  }
  const viewportWidthEm = Math.min(asset.widthEm, maximumWidthEm);
  const viewportHeightEm = Math.min(asset.heightEm, maximumHeightEm);
  const overflowX = viewportWidthEm + 1e-6 < asset.widthEm;
  const overflowY = viewportHeightEm + 1e-6 < asset.heightEm;
  if (!overflowX && !overflowY) {
    return asset;
  }

  const viewportWidth = fullWidth * (viewportWidthEm / asset.widthEm);
  const viewportHeight = fullHeight * (viewportHeightEm / asset.heightEm);
  const cursorCenterX = asset.cursor.x + asset.cursor.width / 2;
  const cursorCenterY = asset.cursor.y + asset.cursor.height / 2;
  const viewportX = clamp(
    cursorCenterX - viewportWidth / 2,
    fullX,
    fullX + fullWidth - viewportWidth,
  );
  const viewportY = clamp(
    cursorCenterY - viewportHeight / 2,
    fullY,
    fullY + fullHeight - viewportHeight,
  );
  const unitsPerEm = Math.max(
    1,
    Math.min(fullWidth / asset.widthEm, fullHeight / asset.heightEm),
  );
  const indicators = createScrollIndicators({
    fullX,
    fullY,
    fullWidth,
    fullHeight,
    viewportX,
    viewportY,
    viewportWidth,
    viewportHeight,
    unitsPerEm,
    overflowX,
    overflowY,
    appearance,
  });
  let svg = asset.svg.replace(
    VIEW_BOX_PATTERN,
    `viewBox="${round(viewportX)} ${round(viewportY)} ${round(viewportWidth)} ${round(viewportHeight)}"`,
  );
  svg = replaceExDimension(svg, "width", viewportWidthEm * EX_PER_EM);
  svg = replaceExDimension(svg, "height", viewportHeightEm * EX_PER_EM);
  svg = svg.replace(
    /^<svg\b/iu,
    '<svg data-texleaf-preview-scroll-viewport="true"',
  );
  svg = svg.replace(/<\/svg>$/iu, `${indicators}</svg>`);
  return {
    svg,
    widthEm: viewportWidthEm,
    heightEm: viewportHeightEm,
    cursor: asset.cursor,
  };
}

interface ScrollIndicatorGeometry {
  readonly fullX: number;
  readonly fullY: number;
  readonly fullWidth: number;
  readonly fullHeight: number;
  readonly viewportX: number;
  readonly viewportY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly unitsPerEm: number;
  readonly overflowX: boolean;
  readonly overflowY: boolean;
  readonly appearance: MathPreviewAppearance;
}

function createScrollIndicators(geometry: ScrollIndicatorGeometry): string {
  const {
    fullX,
    fullY,
    fullWidth,
    fullHeight,
    viewportX,
    viewportY,
    viewportWidth,
    viewportHeight,
    unitsPerEm,
    overflowX,
    overflowY,
    appearance,
  } = geometry;
  const thickness = unitsPerEm * 0.28;
  const inset = unitsPerEm * 0.14;
  const cornerReserve = overflowX && overflowY ? thickness + inset : 0;
  const trackColor = safeHex(appearance.cardBorder, "#ffffff");
  const thumbColor = safeHex(appearance.cursor, "#00e5ff");
  const pieces = [
    `<g data-texleaf-preview-scrollbars="true" aria-hidden="true" pointer-events="none">`,
    `<rect data-texleaf-preview-viewport-border="true" x="${round(viewportX + inset / 2)}" y="${round(viewportY + inset / 2)}" width="${round(Math.max(1, viewportWidth - inset))}" height="${round(Math.max(1, viewportHeight - inset))}" rx="${round(unitsPerEm * 0.28)}" ry="${round(unitsPerEm * 0.28)}" fill="none" stroke="${trackColor}" stroke-opacity="0.3" stroke-width="${round(Math.max(1, unitsPerEm * 0.05))}"/>`,
  ];
  if (overflowX) {
    const trackX = viewportX + inset;
    const trackY = viewportY + viewportHeight - inset - thickness;
    const trackWidth = Math.max(1, viewportWidth - inset * 2 - cornerReserve);
    const thumbWidth = Math.min(
      trackWidth,
      Math.max(unitsPerEm * 2, trackWidth * (viewportWidth / fullWidth)),
    );
    const progress = (viewportX - fullX) / Math.max(1, fullWidth - viewportWidth);
    const thumbX = trackX + (trackWidth - thumbWidth) * clamp(progress, 0, 1);
    pieces.push(
      `<rect x="${round(trackX)}" y="${round(trackY)}" width="${round(trackWidth)}" height="${round(thickness)}" rx="${round(thickness / 2)}" fill="${trackColor}" fill-opacity="0.18"/>`,
      `<rect data-texleaf-preview-scroll-thumb-x="true" x="${round(thumbX)}" y="${round(trackY)}" width="${round(thumbWidth)}" height="${round(thickness)}" rx="${round(thickness / 2)}" fill="${thumbColor}" fill-opacity="0.86"/>`,
    );
  }
  if (overflowY) {
    const trackX = viewportX + viewportWidth - inset - thickness;
    const trackY = viewportY + inset;
    const trackHeight = Math.max(1, viewportHeight - inset * 2 - cornerReserve);
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(unitsPerEm * 2, trackHeight * (viewportHeight / fullHeight)),
    );
    const progress = (viewportY - fullY) / Math.max(1, fullHeight - viewportHeight);
    const thumbY = trackY + (trackHeight - thumbHeight) * clamp(progress, 0, 1);
    pieces.push(
      `<rect x="${round(trackX)}" y="${round(trackY)}" width="${round(thickness)}" height="${round(trackHeight)}" rx="${round(thickness / 2)}" fill="${trackColor}" fill-opacity="0.18"/>`,
      `<rect data-texleaf-preview-scroll-thumb-y="true" x="${round(trackX)}" y="${round(thumbY)}" width="${round(thickness)}" height="${round(thumbHeight)}" rx="${round(thickness / 2)}" fill="${thumbColor}" fill-opacity="0.86"/>`,
    );
  }
  pieces.push("</g>");
  return pieces.join("");
}

/**
 * Fit a cursor decoration by changing the SVG's intrinsic root dimensions.
 * Generated-content images do not reliably obey a pseudo-element's CSS size
 * on every Monaco/Electron combination, so metadata-only scaling could make
 * placement calculations disagree with the pixels on screen.
 *
 * Normal previews are limited by width only. The much larger height argument
 * is solely a paint-safety ceiling for adversarial TeX geometry; it must stay
 * high enough that ordinary tall matrices/alignments reach the layout planner
 * at readable scale, trigger its overflow-above branch, and get clipped by the
 * viewport rather than compressed into a tiny card.
 */
export function fitMathPreviewSvgForCursor(
  asset: MathPreviewSvgAsset,
  maximumWidthEm: number,
  safetyMaximumHeightEm: number,
): MathPreviewSvgAsset {
  if (
    !Number.isFinite(maximumWidthEm) ||
    maximumWidthEm <= 0 ||
    !Number.isFinite(safetyMaximumHeightEm) ||
    safetyMaximumHeightEm <= 0 ||
    !Number.isFinite(asset.widthEm) ||
    asset.widthEm <= 0 ||
    !Number.isFinite(asset.heightEm) ||
    asset.heightEm <= 0
  ) {
    return asset;
  }
  const scale = Math.min(
    1,
    maximumWidthEm / asset.widthEm,
    safetyMaximumHeightEm / asset.heightEm,
  );
  if (scale >= 1) {
    return asset;
  }
  const widthEx = readExDimension(asset.svg, "width");
  const heightEx = readExDimension(asset.svg, "height");
  if (widthEx === undefined || heightEx === undefined) {
    return asset;
  }
  let svg = replaceExDimension(asset.svg, "width", widthEx * scale);
  svg = replaceExDimension(svg, "height", heightEx * scale);
  return {
    svg,
    widthEm: asset.widthEm * scale,
    heightEm: asset.heightEm * scale,
    ...(asset.cursor === undefined ? {} : { cursor: asset.cursor }),
  };
}

function readExDimension(
  svg: string,
  attribute: "width" | "height",
): number | undefined {
  const match = new RegExp(
    `\\b${attribute}="([0-9]+(?:\\.[0-9]+)?)ex"`,
    "iu",
  ).exec(svg);
  const value = match?.[1] === undefined ? Number.NaN : Number.parseFloat(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function replaceExDimension(
  svg: string,
  attribute: "width" | "height",
  value: number,
): string {
  return svg.replace(
    new RegExp(`\\b${attribute}="[0-9]+(?:\\.[0-9]+)?ex"`, "iu"),
    `${attribute}="${round(value)}ex"`,
  );
}

function safeHex(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/iu.test(value) ? value.toLowerCase() : fallback;
}

function safeOpacity(value: number, fallback: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function positiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}
