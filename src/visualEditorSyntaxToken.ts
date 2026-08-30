/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import type { VisualEditorSyntaxToken } from "./visualEditorProtocol";

export interface TextMateSyntaxTokenInput {
  readonly from: number;
  readonly to: number;
  readonly resolvedForeground?: string;
  readonly inheritedForeground?: string;
  readonly fontStyle: number;
}

/**
 * Convert one resolved TextMate segment into the Webview token contract.
 *
 * A TextMate runtime can use a private foreground sentinel to mean “inherit
 * the real VS Code editor foreground”.  That segment must still reach
 * CodeMirror as an explicit mark with no foreground: otherwise CodeMirror's
 * local fallback highlighter may repaint freshly typed plain text as an
 * unrelated LaTeX role until the next full syntax refresh.
 */
export function visualEditorSyntaxTokenFromTextMate(
  input: TextMateSyntaxTokenInput,
): VisualEditorSyntaxToken | undefined {
  if (input.to <= input.from) {
    return undefined;
  }
  const inheritsEditorForeground = input.resolvedForeground !== undefined &&
    input.inheritedForeground !== undefined &&
    input.resolvedForeground.toUpperCase() ===
      input.inheritedForeground.toUpperCase();
  const foreground = inheritsEditorForeground
    ? undefined
    : input.resolvedForeground;
  if (!inheritsEditorForeground && foreground === undefined && input.fontStyle === 0) {
    return undefined;
  }
  return {
    from: input.from,
    to: input.to,
    ...(foreground === undefined ? {} : { foreground }),
    fontStyle: input.fontStyle,
  };
}
