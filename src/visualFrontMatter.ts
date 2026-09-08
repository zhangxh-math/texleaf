/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { createHash } from "node:crypto";
import type * as vscode from "vscode";
import { scanVisualDocumentStructure, type VisualDocumentStructure, type VisualSourceText } from "./core";
import type { LatexProjectContext, LatexProjectFile } from "./latexProjectContext";

export interface VisualFrontMatterTarget {
  readonly uri: vscode.Uri;
  readonly from: number;
  readonly to: number;
  readonly expectedDocument: string;
  readonly originFrom: number;
  readonly originTo: number;
}

/** Resolve only verified execution slices; paths and snapshots remain host-only. */
export function resolveVisualFrontMatter(structure: VisualDocumentStructure, context: LatexProjectContext, compatibilityMode: "basic" | "maximum" = "basic"): {
  readonly structure: VisualDocumentStructure;
  readonly targetsById: ReadonlyMap<string, VisualFrontMatterTarget>;
} {
  const targetsById = new Map<string, VisualFrontMatterTarget>();
  const unchanged = { structure, targetsById };
  if (!structure.records.some(record => record.kind === "maketitle") || context.graphIncomplete ||
    context.bodyExecution.incomplete || context.rootUri === undefined) return unchanged;
  const files = new Map(context.files.filter(file => file.reachableFromRoot)
    .map(file => [file.uri.toString(), file]));
  const root = files.get(context.rootUri.toString());
  if (root === undefined) return unchanged;
  const segments: { file: LatexProjectFile; from: number; to: number; offset: number }[] = [];
  let merged = "", complete = true;
  const append = (file: LatexProjectFile, from: number, to: number): void => {
    if (from < 0 || to < from || to > file.text.length || merged.length + to - from > 2_000_000) {
      complete = false;
      return;
    }
    segments.push({ file, from, to, offset: merged.length });
    merged += file.text.slice(from, to);
  };
  // The graph already resolved paths. Verify the reconstructed preamble against
  // its authoritative expansion so role/path-state ambiguities fail closed.
  const preamble = (file: LatexProjectFile, ancestry: readonly string[]): void => {
    const key = file.uri.toString();
    if (!complete || ancestry.length > 32 || ancestry.includes(key)) { complete = false; return; }
    const limit = Math.min(file.text.length, file.sourceScan.beginDocument?.start ?? file.text.length,
      file.sourceScan.endInput?.start ?? file.text.length);
    let cursor = 0;
    for (const include of file.sourceScan.includes.filter(include => include.phase === "preamble" && include.range.start < limit)) {
      const edges = file.includes.filter(edge => edge.range.start === include.range.start && edge.range.end === include.range.end);
      const edge = edges[0];
      if (edges.length === 1 && edge?.status === "library") {
        append(file, cursor, include.range.end);
        cursor = include.range.end;
        continue;
      }
      const child = edge?.targetUri === undefined ? undefined : files.get(edge.targetUri.toString());
      if (edges.length !== 1 || edge?.status !== "resolved" || child === undefined || !child.roles.includes("preamble")) {
        complete = false;
        return;
      }
      append(file, cursor, include.range.start);
      merged += "\n";
      preamble(child, [...ancestry, key]);
      merged += "\n";
      cursor = include.range.end;
    }
    append(file, cursor, limit);
  };
  preamble(root, []);
  if (!complete || merged !== context.preambleSource) return unchanged;
  merged += "\n\\begin{document}\n";
  for (const slice of context.bodyExecution.slices) {
    const file = files.get(slice.uri.toString());
    if (file === undefined) return unchanged;
    append(file, slice.from, slice.to);
    merged += "\n";
  }
  if (!complete) return unchanged;
  merged += "\\end{document}";
  const locate = (from: number, to: number) => {
    const segment = segments.find(segment => from >= segment.offset && to <= segment.offset + segment.to - segment.from);
    return segment === undefined ? undefined : { file: segment.file,
      from: segment.from + from - segment.offset, to: segment.from + to - segment.offset };
  };
  const titles = scanVisualDocumentStructure(merged, { documentLanguage: context.rootLanguage, compatibilityMode }).records
    .filter(record => record.kind === "maketitle");
  const requested = context.requestedUri.toString();
  return { targetsById, structure: { ...structure, records: structure.records.map(record => {
    if (record.kind !== "maketitle") return record;
    const candidates = titles.filter(title => {
      const origin = locate(title.replacement.sourceFrom, title.replacement.sourceTo);
      return origin?.file.uri.toString() === requested && origin.from === record.replacement.sourceFrom && origin.to === record.replacement.sourceTo;
    });
    if (candidates.length !== 1) return record;
    const title = candidates[0]!;
    const verified = title.frontMatter === undefined ? undefined
      : locate(title.frontMatter.replacement.sourceFrom, title.frontMatter.replacement.sourceTo);
    const local = record.frontMatter?.replacement;
    // Included definitions may change the meaning of a local command. A local
    // fold is usable only when the expanded execution confirms its whole span.
    const group = local !== undefined && verified?.file.uri.toString() === requested &&
      verified.from <= local.sourceFrom && verified.to >= local.sourceTo ? local : record.replacement;
    const verifiedMetadata = (title.metadataReplacements ?? []).flatMap(range => {
      const target = locate(range.sourceFrom, range.sourceTo);
      return target?.file.uri.toString() === requested ? [target] : [];
    });
    const metadataReplacements = (record.metadataReplacements ?? []).filter(range =>
      verifiedMetadata.some(target => target.from === range.sourceFrom && target.to === range.sourceTo));
    const verifiedExtra = (title.frontMatter?.replacements ?? []).flatMap(range => {
      const target = locate(range.sourceFrom, range.sourceTo);
      return target?.file.uri.toString() === requested ? [target] : [];
    });
    const replacements = (record.frontMatter?.replacements ?? []).filter(range =>
      verifiedExtra.some(target => target.from === range.sourceFrom && target.to === range.sourceTo));
    const mapRange = (value: { readonly from: number; readonly to: number }) => {
      const target = locate(value.from, value.to);
      if (target === undefined) return undefined;
      if (target.file.uri.toString() === requested) return { from: target.from, to: target.to };
      const id = createHash("sha256").update(JSON.stringify([context.contextId, context.revision,
        target.file.uri.toString(), target.file.contentRevision, target.from, target.to,
        record.replacement.sourceFrom, record.replacement.sourceTo])).digest("hex").slice(0, 32);
      targetsById.set(id, { uri: target.file.uri, from: target.from, to: target.to,
        expectedDocument: target.file.text, originFrom: record.replacement.sourceFrom, originTo: record.replacement.sourceTo });
      return { from: record.replacement.sourceFrom, to: record.replacement.sourceTo, navigationId: id };
    };
    const source = (value: VisualSourceText | undefined): VisualSourceText | undefined => {
      if (value === undefined) return undefined;
      const range = mapRange(value);
      if (range === undefined) return undefined;
      const definition = value.definition === undefined ? undefined : mapRange(value.definition);
      const { definition: _definition, segments: _segments, ...base } = value;
      const segments = value.segments?.map(segment => {
        if (segment.kind === "text") return segment;
        if (segment.kind !== "math") {
          const reference = segment.kind === "citation" ? segment.citation : segment.reference;
          const target = locate(reference.from, reference.to);
          if (target === undefined || target.file.uri.toString() !== requested) {
            return { kind: "text" as const, text: reference.label };
          }
          const shifted = { from: target.from, to: target.to };
          return segment.kind === "citation"
            ? { ...segment, citation: { ...segment.citation, ...shifted } }
            : { ...segment, reference: { ...segment.reference, ...shifted } };
        }
        const mathRange = mapRange({ from: segment.math.sourceFrom, to: segment.math.sourceTo });
        return { ...segment, math: { ...segment.math,
          sourceFrom: mathRange?.from ?? range.from, sourceTo: mathRange?.to ?? range.to } };
      });
      return { ...base, ...range, ...(definition === undefined ? {} : { definition }),
        ...(segments === undefined ? {} : { segments }) };
    };
    const list = (values: readonly VisualSourceText[]) => values.map(source).filter((value): value is VisualSourceText => value !== undefined);
    const sections = title.frontMatter?.sections.flatMap(section => {
      const mapped = source(section.source);
      if (mapped === undefined) return [];
      // A remote abstract is shown at the local title trigger. Local body
      // sections must still belong to the locally verified fold range.
      if (!mapped.navigationId && mapped.from >= (files.get(requested)?.sourceScan.beginDocument?.start ?? 0) &&
        (mapped.from < group.from || mapped.to > group.to) &&
        !replacements.some(range => mapped.from >= range.from && mapped.to <= range.to)) return [];
      return [{ ...section, source: mapped }];
    }) ?? [];
    return { ...record, metadataReplacements, title: source(title.title), authors: list(title.authors), affiliations: list(title.affiliations),
      emails: list(title.emails), date: source(title.date),
      ...((record.frontMatter !== undefined || sections.length > 0) ? {
        frontMatter: { replacement: group, sections, ...(replacements.length === 0 ? {} : { replacements }) },
      } : {}) };
  }) } };
}
