/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { scanVisualDocumentStructure, type VisualFrameRecord } from "./visualStructure";

function frames(source: string): readonly VisualFrameRecord[] {
  if (!/\\begin\s*\{frame\}/u.test(source)) return [];
  return scanVisualDocumentStructure(source, {fragmentKind: "body"}).records.filter(
    (record): record is VisualFrameRecord => record.kind === "frame" && record.syntax === "environment",
  );
}

/** Ordinary Beamer frames are collected, so SyncTeX attributes their boxes to end{frame}. */
export function beamerForwardSynctexLine(source: string, offset: number): number | undefined {
  const frame = frames(source).find(record => offset >= record.begin.sourceFrom && offset <= record.end.sourceTo);
  if (frame === undefined) return undefined;
  // The visual begin range may stop before overlays or a second option list.
  const header = /^\\begin\s*\{frame\}((?:\s+|%[^\r\n]*|<[^>]*>|\[[^\]]*\])*)/u.exec(
    source.slice(frame.begin.sourceFrom, frame.end.sourceFrom),
  )?.[1]?.replace(/%[^\r\n]*/gu, "");
  // Fragile/direct frames may have precise line records; preserve those queries.
  if (header !== undefined && /\[[^\]]*\b(?:fragile|containsverbatim)\b[^\]]*\]/u.test(header)) return undefined;
  return source.slice(0, frame.end.sourceFrom).split("\n").length;
}

/** Deferred titles and collected frame bodies have a frame-level, not a word-level, location. */
export function beamerReverseSynctexOffset(source: string, offset: number): number | undefined {
  const start = source.lastIndexOf("\n", offset - 1) + 1;
  const end = source.indexOf("\n", offset);
  const to = end < 0 ? source.length : end;
  if (!/^\s*\\end\s*\{frame\}\s*(?:%[^\r\n]*)?$/u.test(source.slice(start, to))) return undefined;
  return frames(source).find(frame => frame.end.sourceFrom >= start && frame.end.sourceFrom < to)?.begin.sourceFrom;
}
