/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

/**
 * Shared theorem-frame CSS contract.
 *
 * CodeMirror serializes style-object property names through style-mod, which
 * treats capital letters as camel-case boundaries. Custom properties used in
 * an EditorView theme must therefore stay lower-case: `--texLeaf-*` would be
 * emitted as `--tex-leaf-*`, while a literal `var(--texLeaf-*)` reference
 * would remain unchanged and silently lose every border declaration.
 */
export const VISUAL_THEOREM_BORDER_PROPERTY =
  "--texleaf-theorem-border" as const;

export const VISUAL_THEOREM_BORDER_VALUE =
  "color-mix(in srgb, " +
  "var(--vscode-editor-foreground, currentColor) 44%, " +
  "var(--vscode-editorWidget-border, var(--vscode-contrastBorder, currentColor)) 56%)";

export const VISUAL_THEOREM_FRAME_BORDER =
  `3px solid var(${VISUAL_THEOREM_BORDER_PROPERTY})` as const;

export const VISUAL_THEOREM_FRAME_RADIUS = "6px" as const;
