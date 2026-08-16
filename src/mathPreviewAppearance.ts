export interface MathPreviewAppearance {
  readonly foreground: string;
  readonly cursor: string;
  readonly cardBackground: string;
  readonly cardBackgroundOpacity: number;
  readonly cardBorder: string;
  readonly cardBorderOpacity: number;
}

/**
 * Resolve a deliberately opaque preview-card palette without depending on
 * user-overridable editor background colors. Wallpaper/transparency themes
 * can make editor surfaces translucent, so the card itself must remain fully
 * opaque; only its border keeps a small amount of transparency.
 */
export function resolveMathPreviewAppearance(
  dark: boolean,
): MathPreviewAppearance {
  return dark
    ? {
        foreground: "#ffffff",
        cursor: "#00e5ff",
        cardBackground: "#0b0f14",
        cardBackgroundOpacity: 1,
        cardBorder: "#ffffff",
        cardBorderOpacity: 0.32,
      }
    : {
        foreground: "#202020",
        cursor: "#e0005a",
        cardBackground: "#fafafc",
        cardBackgroundOpacity: 1,
        cardBorder: "#000000",
        cardBorderOpacity: 0.28,
      };
}

/**
 * Build the small, theme-aware MathJax atom used to represent the editor
 * caret.  A rule is more predictable than a text `|` glyph across fonts and
 * remains narrow when MathJax lays it out inside a fraction or subscript.
 */
export function createMathPreviewCursorMarker(cursor: string): string {
  const safeCursor = /^#[0-9a-f]{6}$/iu.test(cursor)
    ? cursor.slice(1).toUpperCase()
    : "00E5FF";
  return (
    `\\mathord{\\color{#${safeCursor}}` +
    "\\rule[-0.2em]{0.09em}{1.2em}}"
  );
}
