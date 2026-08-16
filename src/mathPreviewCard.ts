import type { MathPreviewAppearance } from "./mathPreviewAppearance";

export interface MathPreviewSvgAsset {
  readonly svg: string;
  readonly widthEm: number;
  readonly heightEm: number;
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
  };
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

function round(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}
