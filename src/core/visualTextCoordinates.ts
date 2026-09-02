/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

/**
 * Pure text/EOL coordinate helpers shared by the visual editor boundary.
 *
 * VS Code and CodeMirror both count offsets in UTF-16 code units. The only
 * coordinate difference we remove here is line-ending width: the visual
 * document always contains one LF per logical line break, while the backing
 * VS Code document may contain CRLF.
 */

export type VisualDocumentEol = "\n" | "\r\n";

/** Convert CRLF and legacy lone-CR line endings to the visual LF form. */
export function normalizeVisualText(text: string): string {
  return text.replace(/\r\n?|\n/gu, "\n");
}

/** Convert visual text to the backing document's EOL without changing content. */
export function textForVisualDocumentEol(
  text: string,
  eol: VisualDocumentEol,
): string {
  const normalized = normalizeVisualText(text);
  return eol === "\n" ? normalized : normalized.replace(/\n/gu, "\r\n");
}

/**
 * Map an offset in the backing document to its LF-normalized visual offset.
 *
 * Inputs outside the current text are clamped, matching editor selection
 * behavior. A non-representable offset between CR and LF maps to the position
 * before the visual LF; all ordinary character and line boundaries round-trip.
 */
export function visualOffsetFromDocumentOffset(
  documentText: string,
  documentOffset: number,
): number {
  const target = clampUtf16Offset(documentOffset, documentText.length);
  let visualOffset = 0;
  let documentCursor = 0;
  while (documentCursor < target) {
    if (documentText.charCodeAt(documentCursor) === 0x0d) {
      if (documentText.charCodeAt(documentCursor + 1) === 0x0a) {
        if (documentCursor + 1 >= target) break;
        documentCursor += 2;
      } else {
        documentCursor += 1;
      }
      visualOffset += 1;
      continue;
    }
    documentCursor += 1;
    visualOffset += 1;
  }
  return visualOffset;
}

/**
 * Map an LF-normalized visual offset back to the backing document offset.
 * Both CRLF and legacy lone-CR source endings are treated as one visual LF.
 */
export function documentOffsetFromVisualOffset(
  documentText: string,
  visualOffset: number,
): number {
  const visualLength = normalizedUtf16Length(documentText);
  const target = clampUtf16Offset(visualOffset, visualLength);
  let visualCursor = 0;
  let documentOffset = 0;
  while (visualCursor < target && documentOffset < documentText.length) {
    if (documentText.charCodeAt(documentOffset) === 0x0d &&
        documentText.charCodeAt(documentOffset + 1) === 0x0a) {
      documentOffset += 2;
    } else {
      documentOffset += 1;
    }
    visualCursor += 1;
  }
  return documentOffset;
}

function normalizedUtf16Length(text: string): number {
  let length = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0d && text.charCodeAt(index + 1) === 0x0a) {
      index += 1;
    }
    length += 1;
  }
  return length;
}

function clampUtf16Offset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return offset === Number.POSITIVE_INFINITY ? length : 0;
  return Math.min(length, Math.max(0, Math.trunc(offset)));
}


