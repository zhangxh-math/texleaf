/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

export type MathJaxMacroOption =
  | string
  | readonly [string, number]
  | readonly [string, number, string];

export interface MathPreviewWorkerRequest {
  readonly type: "render";
  readonly id: number;
  readonly tex: string;
  readonly display: boolean;
  readonly macros: Readonly<Record<string, MathJaxMacroOption>>;
  readonly macroFingerprint: string;
  readonly foreground: string;
  readonly scale: number;
  /**
   * Reserved colour used by TeXLeaf's injected caret rule. When present, the
   * worker tags that exact MathJax SVG node and reports its transformed
   * geometry in root viewBox coordinates.
   */
  readonly cursorMarkerColor?: string;
}

export interface MathPreviewCursorGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MathPreviewWorkerSuccess {
  readonly type: "result";
  readonly id: number;
  readonly svg: string;
  readonly widthEm: number;
  readonly heightEm: number;
  readonly cursor?: MathPreviewCursorGeometry;
}

export interface MathPreviewWorkerFailure {
  readonly type: "error";
  readonly id: number;
  readonly message: string;
}

export type MathPreviewWorkerResponse =
  | MathPreviewWorkerSuccess
  | MathPreviewWorkerFailure;
