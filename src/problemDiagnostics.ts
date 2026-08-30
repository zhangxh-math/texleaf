/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import * as vscode from "vscode";
import { VISUAL_EDITOR_REVEAL_DIAGNOSTIC_COMMAND } from "./visualEditorProtocol";

/**
 * Add an explicit, range-preserving visual-editor navigation link to a native
 * diagnostic. The ordinary Problems-row action is still left intact as a
 * fallback, but no longer has to infer the selected range from a transient
 * source/mirror editor.
 */
export function visualDiagnosticCode(
  value: string,
  resource: vscode.Uri,
  range: vscode.Range,
): { readonly value: string; readonly target: vscode.Uri } {
  const argumentsJson = JSON.stringify([
    resource.toString(),
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  ]);
  return {
    value: `${value} · 可视化定位`,
    target: vscode.Uri.parse(
      `command:${VISUAL_EDITOR_REVEAL_DIAGNOSTIC_COMMAND}?${encodeURIComponent(argumentsJson)}`,
    ),
  };
}
