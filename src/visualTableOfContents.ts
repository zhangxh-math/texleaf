/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { createHash } from "node:crypto";
import type * as vscode from "vscode";
import {
  numberVisualHeadingSequence,
  scanVisualDocumentStructure,
  type VisualDocumentFragmentKind,
  type VisualDocumentStructure,
  type VisualHeadingRecord,
  type VisualTableOfContentsEntry,
  type VisualTableOfContentsNotice,
  type VisualTableOfContentsRecord,
} from "./core";
import type {
  LatexProjectBodyExecutionSlice,
  LatexProjectContext,
  LatexProjectFile,
} from "./latexProjectContext";

const MAX_VISUAL_TABLE_OF_CONTENTS_HEADINGS = 4_000;
const MAX_VISUAL_TABLE_OF_CONTENTS_ENTRIES = 1_000;
/** LaTeX's ordinary tocdepth includes through subsubsection. */
const MAX_DEFAULT_TABLE_OF_CONTENTS_LEVEL = 4;

export interface VisualTableOfContentsTarget {
  readonly entry: VisualTableOfContentsEntry;
  readonly uri: vscode.Uri;
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  readonly expectedText: string;
}

export interface VisualTableOfContentsResolution {
  readonly structure: VisualDocumentStructure;
  /** Host-only targets. URIs are deliberately never serialized to the Webview. */
  readonly targetsById: ReadonlyMap<string, VisualTableOfContentsTarget>;
}

interface OrderedProjectHeading {
  readonly slice: LatexProjectBodyExecutionSlice;
  readonly executionOrder: number;
  readonly file: LatexProjectFile;
  readonly heading: VisualHeadingRecord;
  readonly appendixStart: boolean;
}

interface ResolvedProjectHeading {
  readonly orderedIndex: number;
  readonly candidate: OrderedProjectHeading;
  readonly entry: VisualTableOfContentsEntry;
}

interface CachedProjectHeadings {
  readonly headings: readonly VisualHeadingRecord[];
  readonly appendixOffsets: readonly number[];
  readonly notices: readonly VisualTableOfContentsNotice[];
}

/**
 * Enrich every local `\\tableofcontents` placeholder with a bounded,
 * project-ordered heading tree. The project context supplies execution slices
 * instead of a flat file order, so root headings remain correctly interleaved
 * with `\\input`/`\\include` children and repeated includes remain visible.
 */
export function resolveVisualTableOfContents(
  structure: VisualDocumentStructure,
  context: LatexProjectContext,
): VisualTableOfContentsResolution {
  if (!structure.records.some((record) => record.kind === "tableOfContents")) {
    return { structure, targetsById: new Map() };
  }

  const filesByUri = new Map(
    context.files.map((file) => [visualUriKey(file.uri), file] as const),
  );
  const scans = new Map<string, CachedProjectHeadings>();
  const ordered: OrderedProjectHeading[] = [];
  const notices = new Set<VisualTableOfContentsNotice>();
  let incomplete = false;
  if (context.bodyExecution.incomplete || context.graphIncomplete) {
    notices.add("projectGraph");
    incomplete = true;
  }

  let pendingAppendix = false;
  for (const [executionOrder, slice] of context.bodyExecution.slices.entries()) {
    if (ordered.length >= MAX_VISUAL_TABLE_OF_CONTENTS_HEADINGS) {
      notices.add("sourceLimit");
      incomplete = true;
      break;
    }
    const file = filesByUri.get(visualUriKey(slice.uri));
    if (
      file === undefined ||
      slice.from < 0 ||
      slice.to < slice.from ||
      slice.to > file.text.length
    ) {
      notices.add("projectGraph");
      incomplete = true;
      continue;
    }
    if (
      visualTableOfContentsSliceHasConditionalHeading(
        file.text.slice(slice.from, slice.to),
      )
    ) {
      notices.add("conditionalHeadings");
      incomplete = true;
    }
    const fragmentKind = visualExecutionFragmentKind(file, slice);
    const scanKey = `${visualUriKey(file.uri)}\u0000${fragmentKind}`;
    let scan = scans.get(scanKey);
    if (scan === undefined) {
      const executableText = projectExecutableText(file);
      const scanned = scanVisualDocumentStructure(executableText, {
        fragmentKind,
        documentLanguage: context.rootLanguage,
        numberingRootLevel: context.numberingRoot,
        numberingMode: "unknown",
      });
      const scanNotices = [...visualTableOfContentsSourceNotices(executableText)];
      if (scanned.records.length >= MAX_VISUAL_TABLE_OF_CONTENTS_HEADINGS) {
        scanNotices.push("sourceLimit");
      }
      scan = {
        appendixOffsets: scanned.appendixOffsets ?? [],
        headings: scanned.records.filter(
          (record): record is VisualHeadingRecord => record.kind === "heading",
        ),
        notices: scanNotices,
      };
      scans.set(scanKey, scan);
    }
    for (const notice of scan.notices) {
      notices.add(notice);
      incomplete ||= visualTableOfContentsNoticeCanChangeEntries(notice);
    }
    const appendixOffsets = scan.appendixOffsets.filter(offset => offset >= slice.from && offset < slice.to);
    let appendixIndex = 0;
    for (const heading of scan.headings) {
      if (heading.from < slice.from || heading.to > slice.to) {
        continue;
      }
      if (ordered.length >= MAX_VISUAL_TABLE_OF_CONTENTS_HEADINGS) {
        notices.add("sourceLimit");
        incomplete = true;
        break;
      }
      while (appendixIndex < appendixOffsets.length && appendixOffsets[appendixIndex]! <= heading.from) {
        pendingAppendix = true;
        appendixIndex += 1;
      }
      ordered.push({ slice, executionOrder, file, heading, appendixStart: pendingAppendix });
      pendingAppendix = false;
    }
    pendingAppendix ||= appendixIndex < appendixOffsets.length;
  }

  const numbers = numberVisualHeadingSequence(
    ordered.map(({ heading, appendixStart }) => ({ ...heading, appendixStart })),
    context.numberingRoot,
  );
  const targetsById = new Map<string, VisualTableOfContentsTarget>();
  const entries: VisualTableOfContentsEntry[] = [];
  const resolvedHeadings: ResolvedProjectHeading[] = [];
  for (const [index, candidate] of ordered.entries()) {
    const { file, heading, slice } = candidate;
    if (heading.starred || heading.level > MAX_DEFAULT_TABLE_OF_CONTENTS_LEVEL) {
      continue;
    }
    if (entries.length >= MAX_VISUAL_TABLE_OF_CONTENTS_ENTRIES) {
      notices.add("sourceLimit");
      incomplete = true;
      break;
    }
    const id = visualTableOfContentsEntryId(context, slice, heading, file);
    if (targetsById.has(id)) {
      // A collision must never cause a Webview-supplied ID to select between
      // two host targets, even though the SHA-256 prefix makes this unlikely.
      notices.add("projectGraph");
      incomplete = true;
      continue;
    }
    const number = numbers[index];
    const entry: VisualTableOfContentsEntry = {
      id,
      command: heading.command,
      level: heading.level,
      ...(number === undefined ? {} : { number }),
      title: heading.tocTitle,
    };
    entries.push(entry);
    resolvedHeadings.push({ orderedIndex: index, candidate, entry });
    targetsById.set(id, {
      entry,
      uri: file.uri,
      from: heading.from,
      to: heading.to,
      contentFrom: heading.contentFrom,
      expectedText: file.text.slice(heading.from, heading.to),
    });
  }

  return {
    structure: {
      ...structure,
      records: structure.records.map((record) =>
        record.kind === "tableOfContents"
          ? {
              ...record,
              entries: visualTableOfContentsEntriesForRecord(
                record,
                entries,
                resolvedHeadings,
                ordered,
                context,
              ),
              incomplete,
              numberingApproximate: [...notices].some(
                visualTableOfContentsNoticeChangesNumbering,
              ),
              notices: [...notices],
            }
          : record
      ),
    },
    targetsById,
  };
}

function visualTableOfContentsEntriesForRecord(
  record: VisualTableOfContentsRecord,
  entries: readonly VisualTableOfContentsEntry[],
  resolvedHeadings: readonly ResolvedProjectHeading[],
  ordered: readonly OrderedProjectHeading[],
  context: LatexProjectContext,
): readonly VisualTableOfContentsEntry[] {
  if (record.template) {
    // A preamble frame is executed once for each matching section. Showing a
    // static project-wide tree here would be actively misleading; the Webview
    // renders an explicit runtime-template placeholder instead.
    return [];
  }
  if (record.scope === "all") {
    return entries;
  }

  const requestedKey = visualUriKey(context.requestedUri);
  const executionOrder = context.bodyExecution.slices.findIndex((slice) =>
    visualUriKey(slice.uri) === requestedKey &&
    record.replacement.sourceFrom >= slice.from &&
    record.replacement.sourceTo <= slice.to
  );
  const precedesRecord = (candidate: OrderedProjectHeading): boolean => {
    if (executionOrder >= 0) {
      return candidate.executionOrder < executionOrder ||
        (
          candidate.executionOrder === executionOrder &&
          visualUriKey(candidate.file.uri) === requestedKey &&
          candidate.heading.to <= record.replacement.sourceFrom
        );
    }
    return visualUriKey(candidate.file.uri) === requestedKey &&
      candidate.heading.to <= record.replacement.sourceFrom;
  };
  const anchorCommand = record.scope === "currentSubsection"
    ? "subsection"
    : "section";
  let anchorIndex = -1;
  let anchorLevel = -1;
  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = ordered[index];
    if (
      candidate !== undefined &&
      candidate.heading.command === anchorCommand &&
      !candidate.heading.starred &&
      precedesRecord(candidate)
    ) {
      anchorIndex = index;
      anchorLevel = candidate.heading.level;
    }
  }
  if (anchorIndex < 0) {
    return [];
  }

  let boundaryIndex = ordered.length;
  for (let index = anchorIndex + 1; index < ordered.length; index += 1) {
    const heading = ordered[index]?.heading;
    if (heading !== undefined && !heading.starred && heading.level <= anchorLevel) {
      boundaryIndex = index;
      break;
    }
  }
  return resolvedHeadings
    .filter(({ orderedIndex }) =>
      orderedIndex >= anchorIndex && orderedIndex < boundaryIndex
    )
    .map(({ entry }) => entry);
}

function visualExecutionFragmentKind(
  file: LatexProjectFile,
  slice: LatexProjectBodyExecutionSlice,
): VisualDocumentFragmentKind {
  if (file.sourceScan.beginDocument !== undefined) {
    return "standalone";
  }
  return slice.role === "body" ? "body" : slice.role;
}

/**
 * Commands below can add/suppress entries or alter structural numbering in
 * ways that a static heading scan cannot prove. Keep the reason instead of
 * flattening every case into a generic "incomplete" warning: matter switches
 * and `\appendix`, for example, leave title discovery and navigation intact
 * even though their compiled numbering cannot be reproduced here.
 */
function visualTableOfContentsSourceNotices(
  source: string,
): readonly VisualTableOfContentsNotice[] {
  const executable = source
    .split(/\r?\n/u)
    .map((line) => line.replace(/(^|[^\\])%.*$/u, "$1"))
    .join("\n");
  const notices: VisualTableOfContentsNotice[] = [];
  if (/\\includeonly(?![A-Za-z@])/u.test(executable)) {
    notices.push("includeOnly");
  }
  if (/\\(?:addcontentsline|addtocontents)(?![A-Za-z@])/u.test(executable)) {
    notices.push("manualContents");
  }
  if (
    /\\(?:setcounter|addtocounter)\s*\{\s*tocdepth\s*\}/u.test(executable)
  ) {
    notices.push("tocDepth");
  }
  if (
    /\\(?:setcounter|addtocounter)\s*\{\s*(?:part|chapter|section|subsection|subsubsection)\s*\}/u.test(
      executable,
    )
  ) {
    notices.push("counterControl");
  }
  if (/\\frontmatter(?![A-Za-z@])/u.test(executable)) {
    notices.push("frontMatter");
  }
  if (/\\mainmatter(?![A-Za-z@])/u.test(executable)) {
    notices.push("mainMatter");
  }
  if (/\\backmatter(?![A-Za-z@])/u.test(executable)) {
    notices.push("backMatter");
  }
  if (/\\appendix(?![A-Za-z@])/u.test(executable)) {
    notices.push("appendix");
  }
  return notices;
}

function visualTableOfContentsNoticeCanChangeEntries(
  notice: VisualTableOfContentsNotice,
): boolean {
  return notice === "projectGraph" ||
    notice === "conditionalHeadings" ||
    notice === "sourceLimit" ||
    notice === "includeOnly" ||
    notice === "manualContents" ||
    notice === "tocDepth";
}

function visualTableOfContentsNoticeChangesNumbering(
  notice: VisualTableOfContentsNotice,
): boolean {
  return notice === "counterControl" ||
    notice === "frontMatter" ||
    notice === "mainMatter" ||
    notice === "backMatter" ||
    notice === "appendix";
}

function visualTableOfContentsSliceHasConditionalHeading(source: string): boolean {
  const executable = source
    .split(/\r?\n/u)
    .map((line) => line.replace(/(^|[^\\])%.*$/u, "$1"))
    .join("\n");
  const hasActualConditional = [...executable.matchAll(/\\(if[A-Za-z@]*)/gu)]
    .some((match) => match[1] !== "iff");
  return hasActualConditional &&
    /\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?![A-Za-z@])/u.test(
      executable,
    );
}

function projectExecutableText(file: LatexProjectFile): string {
  const end = Math.min(
    file.text.length,
    file.sourceScan.endInput?.start ?? file.text.length,
    file.sourceScan.endDocument?.end ?? file.text.length,
  );
  return end === file.text.length
    ? file.text
    : file.text.slice(0, Math.max(0, end));
}

function visualTableOfContentsEntryId(
  context: LatexProjectContext,
  slice: LatexProjectBodyExecutionSlice,
  heading: VisualHeadingRecord,
  file: LatexProjectFile,
): string {
  return createHash("sha256").update([
    context.contextId,
    slice.executionIndex,
    visualUriKey(file.uri),
    heading.from,
    heading.to,
    file.text.slice(heading.from, heading.to),
  ].join("\u0000")).digest("hex").slice(0, 32);
}

function visualUriKey(uri: vscode.Uri): string {
  const value = uri.toString(true);
  return process.platform === "win32" ? value.toLowerCase() : value;
}
