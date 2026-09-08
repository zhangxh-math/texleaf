/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { findLatexOpaqueEnvironmentEnd } from './latexScanner';

/** UTF-16 source offsets, matching VS Code and JavaScript string indexing. */
export interface LatexProjectRange {
  readonly start: number;
  readonly end: number;
}

export type LatexProjectPhase = 'preamble' | 'body' | 'after-document';

export type LatexProjectIncludeKind =
  | 'input'
  | 'include'
  | 'subfile'
  | 'import'
  | 'subimport';

export type LatexProjectDiagnosticCode =
  | 'source-too-large'
  | 'too-many-root-directives'
  | 'multiple-root-directives'
  | 'too-many-includes'
  | 'diagnostic-limit'
  | 'invalid-root-path'
  | 'invalid-include-path'
  | 'malformed-document-class'
  | 'multiple-document-classes'
  | 'malformed-document-environment'
  | 'malformed-include'
  | 'malformed-definition'
  | 'conditional-project-commands'
  | 'unterminated-false-conditional'
  | 'unterminated-inline-verbatim'
  | 'unterminated-verbatim-environment'
  | 'invalid-source-path'
  | 'duplicate-source-path'
  | 'missing-root-file'
  | 'missing-include-file'
  | 'include-cycle'
  | 'too-many-files'
  | 'too-many-edges';

export interface LatexProjectDiagnostic {
  readonly code: LatexProjectDiagnosticCode;
  readonly message: string;
  readonly range?: LatexProjectRange;
  /** Present on diagnostics emitted while building an in-memory project graph. */
  readonly filePath?: string;
}

export interface LatexProjectRootDirective {
  readonly rawPath: string;
  /**
   * A normalized literal request path. Leading `..` segments are retained;
   * callers must resolve it against the containing file with
   * `resolveLatexProjectPath` before crossing a workspace boundary.
   */
  readonly normalizedPath: string | undefined;
  readonly range: LatexProjectRange;
  readonly pathRange: LatexProjectRange;
}

export interface LatexProjectDocumentClass {
  readonly name: string;
  readonly options: string | undefined;
  readonly range: LatexProjectRange;
  readonly nameRange: LatexProjectRange;
  readonly optionsRange: LatexProjectRange | undefined;
}

export interface LatexProjectInclude {
  readonly kind: LatexProjectIncludeKind;
  readonly phase: LatexProjectPhase;
  readonly range: LatexProjectRange;
  readonly commandRange: LatexProjectRange;
  /** The final filename argument for import/subimport, otherwise the sole path. */
  readonly pathRange: LatexProjectRange;
  /** Combined directory and filename for import/subimport. */
  readonly rawPath: string;
  /** Normalized request path, or undefined when the argument is dynamic/unsafe. */
  readonly normalizedPath: string | undefined;
  readonly directoryRawPath: string | undefined;
  readonly directoryRange: LatexProjectRange | undefined;
}

export interface LatexProjectScanOptions {
  readonly maxSourceLength?: number;
  readonly maxIncludes?: number;
  readonly maxRootDirectives?: number;
  readonly maxDiagnostics?: number;
}

export interface LatexProjectSourceScan {
  readonly rootDirectives: readonly LatexProjectRootDirective[];
  readonly documentClass: LatexProjectDocumentClass | undefined;
  readonly beginDocument: LatexProjectRange | undefined;
  readonly endDocument: LatexProjectRange | undefined;
  /** The first executable `\\endinput`, which terminates this physical file. */
  readonly endInput: LatexProjectRange | undefined;
  readonly includes: readonly LatexProjectInclude[];
  readonly diagnostics: readonly LatexProjectDiagnostic[];
  /**
   * True when a bound was reached, a project-affecting command was malformed,
   * or a literal dependency could not be represented safely.
   */
  readonly graphIncomplete: boolean;
}

export type LatexProjectPathFailureReason =
  | 'empty'
  | 'unsafe-syntax'
  | 'invalid-containing-file'
  | 'workspace-escape';

export type LatexProjectPathResolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: LatexProjectPathFailureReason };

export interface LatexProjectPathResolutionOptions {
  /** TeX adds `.tex` for ordinary source inclusions when no extension exists. */
  readonly appendTexExtension?: boolean;
}

export type LatexProjectGraphEdgeStatus =
  | 'resolved'
  | 'missing'
  | 'invalid'
  | 'cycle';

export interface LatexProjectGraphFile {
  readonly path: string;
  readonly scan: LatexProjectSourceScan;
}

export interface LatexProjectGraphEdge {
  readonly from: string;
  readonly to: string | undefined;
  readonly status: LatexProjectGraphEdgeStatus;
  readonly include: LatexProjectInclude;
}

export interface LatexProjectGraphOptions extends LatexProjectScanOptions {
  readonly maxFiles?: number;
  readonly maxEdges?: number;
}

export interface LatexProjectGraph {
  readonly rootPath: string | undefined;
  readonly files: readonly LatexProjectGraphFile[];
  readonly edges: readonly LatexProjectGraphEdge[];
  readonly cycles: readonly (readonly string[])[];
  readonly diagnostics: readonly LatexProjectDiagnostic[];
  readonly graphIncomplete: boolean;
}

interface LatexProjectExecutionPathState {
  /** Directory containing the semantic root, relative to the workspace root. */
  readonly rootDirectory: string;
  /** Active import/subimport directory used by the import package. */
  readonly importDirectory: string | undefined;
  /** Ordered import-package search bases for ordinary input/include. */
  readonly inputDirectories: readonly string[];
}

type LatexProjectExecutionPathCandidate =
  | {
      readonly ok: true;
      readonly path: string;
      readonly state: LatexProjectExecutionPathState;
    }
  | { readonly ok: false };

const DEFAULT_MAX_SOURCE_LENGTH = 5_000_000;
const DEFAULT_MAX_INCLUDES = 2_048;
const DEFAULT_MAX_ROOT_DIRECTIVES = 8;
const DEFAULT_MAX_DIAGNOSTICS = 128;
const DEFAULT_MAX_FILES = 512;
const DEFAULT_MAX_EDGES = 4_096;
const MAX_PATH_LENGTH = 2_048;
const MAX_PATH_SEGMENT_LENGTH = 255;
const MAX_GRAPH_SOURCE_CANDIDATES = 4_096;

const VERBATIM_ENVIRONMENTS = new Set([
  'verbatim',
  'verbatim*',
  'Verbatim',
  'Verbatim*',
  'lstlisting',
  'minted',
  'filecontents',
  'filecontents*',
  // The comment package discards this environment before TeX executes its
  // contents. Treat it as opaque so apparent includes remain inert.
  'comment',
]);

const INCLUDE_COMMANDS = new Set<LatexProjectIncludeKind>([
  'input',
  'include',
  'subfile',
  'import',
  'subimport',
]);

const PROJECT_NEW_COMMAND_DEFINITIONS = new Set([
  'newcommand',
  'renewcommand',
  'providecommand',
  'DeclareRobustCommand',
  'DeclareMathOperator',
]);

const PROJECT_XPARSE_COMMAND_DEFINITIONS = new Set([
  'NewDocumentCommand',
  'RenewDocumentCommand',
  'ProvideDocumentCommand',
  'DeclareDocumentCommand',
  'NewExpandableDocumentCommand',
  'RenewExpandableDocumentCommand',
]);

const PROJECT_NEW_ENVIRONMENT_DEFINITIONS = new Set([
  'newenvironment',
  'renewenvironment',
]);

const PROJECT_XPARSE_ENVIRONMENT_DEFINITIONS = new Set([
  'NewDocumentEnvironment',
  'RenewDocumentEnvironment',
  'ProvideDocumentEnvironment',
  'DeclareDocumentEnvironment',
]);

const PROJECT_TEX_DEFINITIONS = new Set(['def', 'gdef', 'edef', 'xdef']);

const PROJECT_CONDITIONAL_PRIMITIVES = new Set([
  'if',
  'ifcat',
  'ifx',
  'ifnum',
  'ifdim',
  'ifodd',
  'ifvmode',
  'ifhmode',
  'ifmmode',
  'ifinner',
  'ifvoid',
  'ifhbox',
  'ifvbox',
  'ifeof',
  'iftrue',
  'iffalse',
  'ifcase',
  'ifdefined',
  'ifcsname',
  'ifincsname',
  'ifprimitive',
]);

interface SourceArgument {
  readonly range: LatexProjectRange;
  readonly contentRange: LatexProjectRange;
}

interface ControlSequence {
  readonly name: string;
  readonly range: LatexProjectRange;
}

interface TrimmedSource {
  readonly text: string;
  readonly range: LatexProjectRange;
}

interface LiteralPathParse {
  readonly normalizedPath: string | undefined;
  readonly reason: LatexProjectPathFailureReason | undefined;
}

/**
 * Scan the project-affecting subset of one TeX source file. The scanner never
 * expands macros or executes TeX; only literal commands with bounded UTF-16
 * ranges are returned.
 */
export function scanLatexProjectSource(
  source: string,
  options: LatexProjectScanOptions = {},
): LatexProjectSourceScan {
  const maxSourceLength = boundedLimit(
    options.maxSourceLength,
    DEFAULT_MAX_SOURCE_LENGTH,
    DEFAULT_MAX_SOURCE_LENGTH,
  );
  const maxIncludes = boundedLimit(
    options.maxIncludes,
    DEFAULT_MAX_INCLUDES,
    DEFAULT_MAX_INCLUDES,
  );
  const maxRootDirectives = boundedLimit(
    options.maxRootDirectives,
    DEFAULT_MAX_ROOT_DIRECTIVES,
    DEFAULT_MAX_ROOT_DIRECTIVES,
  );
  const maxDiagnostics = boundedLimit(
    options.maxDiagnostics,
    DEFAULT_MAX_DIAGNOSTICS,
    DEFAULT_MAX_DIAGNOSTICS,
  );
  const scanEnd = Math.min(source.length, maxSourceLength);
  const rootDirectives: LatexProjectRootDirective[] = [];
  const includes: LatexProjectInclude[] = [];
  const diagnostics: LatexProjectDiagnostic[] = [];
  let graphIncomplete = source.length > scanEnd;
  let diagnosticsTruncated = false;
  let documentClass: LatexProjectDocumentClass | undefined;
  let beginDocument: LatexProjectRange | undefined;
  let endDocument: LatexProjectRange | undefined;
  let endInput: LatexProjectRange | undefined;
  let phase: LatexProjectPhase = 'preamble';

  const report = (
    diagnostic: LatexProjectDiagnostic,
    incomplete = false,
  ): void => {
    if (incomplete) {
      graphIncomplete = true;
    }
    if (diagnostics.length < maxDiagnostics) {
      diagnostics.push(diagnostic);
      return;
    }
    diagnosticsTruncated = true;
    graphIncomplete = true;
  };

  if (source.length > scanEnd) {
    report({
      code: 'source-too-large',
      message: `TeX source exceeded the ${maxSourceLength} UTF-16 code-unit scan limit.`,
      range: { start: scanEnd, end: source.length },
    }, true);
  }

  let index = 0;
  while (index < scanEnd) {
    const character = source[index];
    if (character === '%' && !isEscapedAt(source, index)) {
      const lineEnd = endOfLine(source, index, scanEnd);
      const directive = parseRootDirective(source, index, lineEnd);
      if (directive !== undefined) {
        if (rootDirectives.length < maxRootDirectives) {
          rootDirectives.push(directive);
          if (directive.normalizedPath === undefined) {
            report({
              code: 'invalid-root-path',
              message: 'The TeX root directive must contain a literal relative project path.',
              range: directive.pathRange,
            }, true);
          }
        } else {
          report({
            code: 'too-many-root-directives',
            message: `More than ${maxRootDirectives} TeX root directives were found.`,
            range: directive.range,
          }, true);
        }
      }
      index = lineEnd;
      continue;
    }
    if (character !== '\\') {
      index += 1;
      continue;
    }

    const control = readControlSequence(source, index, scanEnd);
    if (control === undefined) {
      index += 1;
      continue;
    }

    if (control.name === 'verb') {
      const verbEnd = skipInlineVerb(source, control.range.end, scanEnd);
      if (verbEnd === undefined) {
        const lineEnd = endOfLine(source, control.range.end, scanEnd);
        report({
          code: 'unterminated-inline-verbatim',
          message: 'An inline \\verb command has no closing delimiter on this line.',
          range: { start: control.range.start, end: lineEnd },
        });
        index = lineEnd;
      } else {
        index = verbEnd;
      }
      continue;
    }

    if (control.name === 'newif') {
      const declarationEnd = skipProjectNewIfDeclaration(
        source,
        control.range.end,
        scanEnd,
      );
      if (declarationEnd === undefined) {
        report({
          code: 'malformed-definition',
          message: 'The \\newif declaration must be followed by a literal custom conditional name.',
          range: control.range,
        }, true);
        index = control.range.end;
      } else {
        index = declarationEnd;
      }
      continue;
    }

    const functionalConditionalArguments = projectFunctionalConditionalArgumentCount(
      control.name,
    );
    if (functionalConditionalArguments !== undefined) {
      const conditional = readProjectFunctionalConditional(
        source,
        control.range.end,
        scanEnd,
        functionalConditionalArguments,
      );
      if (
        conditional === undefined ||
        conditional.hasProjectCommand ||
        control.name === 'InputIfFileExists'
      ) {
        report({
          code: 'conditional-project-commands',
          message: conditional === undefined
            ? `The \\${control.name} conditional invocation could not be bounded; the project graph is conservative.`
            : `The \\${control.name} conditional invocation can select project-authority commands; the region was omitted.`,
          range: {
            start: control.range.start,
            end: conditional?.end ?? control.range.end,
          },
        }, true);
      }
      // A bounded functional conditional is one invocation, not a TeX
      // \if...\fi block. Omit every branch instead of publishing mutually
      // exclusive includes or labels as simultaneously authoritative.
      index = conditional?.end ?? control.range.end;
      continue;
    }

    if (isProjectConditionalControl(control.name)) {
      const skipped = skipLiteralFalseProjectConditional(
        source,
        control.range.end,
        scanEnd,
      );
      if (!skipped.terminated) {
        report({
          code: 'unterminated-false-conditional',
          message: `A \\${control.name} conditional has no matching \\fi within the scan limit.`,
          range: { start: control.range.start, end: scanEnd },
        }, true);
      } else if (
        skipped.hasProjectCommand &&
        (control.name !== 'iffalse' || skipped.hasElse)
      ) {
        // Only a literal false branch without an else arm is statically known
        // to execute nothing. Other conditionals are omitted wholesale, but
        // they only make this *project* graph incomplete when the skipped
        // region contains a command that can affect project reachability or
        // document phase. Ordinary conditionals around bibliography/style
        // setup do not invalidate otherwise unrelated root discovery.
        report({
          code: 'conditional-project-commands',
          message: `A \\${control.name} conditional region was skipped; the project graph is conservative.`,
          range: { start: control.range.start, end: skipped.end },
        }, true);
      }
      // A function-style command such as \ifthenelse also follows the `if*`
      // naming convention but has no closing \fi. Once the block hypothesis
      // fails, keep scanning after the control sequence so later unconditional
      // literal includes are not lost; graphIncomplete still prevents callers
      // from treating the result as authoritative.
      index = skipped.terminated ? skipped.end : control.range.end;
      continue;
    }

    if (isProjectDefinitionCommand(control.name)) {
      const definitionEnd = skipProjectDefinition(source, control, scanEnd);
      if (definitionEnd === undefined) {
        report({
          code: 'malformed-definition',
          message: `The \\${control.name} definition has no bounded replacement body.`,
          range: control.range,
        }, true);
        index = scanEnd;
      } else {
        index = definitionEnd;
      }
      continue;
    }

    // TeX stops reading the current physical file here. This is deliberately
    // handled after definitions/conditionals so an inert \endinput token in a
    // replacement body or skipped branch cannot truncate the source graph.
    if (control.name === 'endinput') {
      endInput = control.range;
      break;
    }

    if (control.name === 'begin' || control.name === 'end') {
      const environmentArgument = readRequiredArgument(
        source,
        control.range.end,
        scanEnd,
      );
      if (environmentArgument === undefined) {
        if (control.name === 'begin' || control.name === 'end') {
          report({
            code: 'malformed-document-environment',
            message: `The \\${control.name} command has no bounded literal environment argument.`,
            range: control.range,
          });
        }
        index = control.range.end;
        continue;
      }
      const environment = source
        .slice(
          environmentArgument.contentRange.start,
          environmentArgument.contentRange.end,
        )
        .trim();
      const environmentRange = {
        start: control.range.start,
        end: environmentArgument.range.end,
      };

      if (control.name === 'begin' && VERBATIM_ENVIRONMENTS.has(environment)) {
        const verbatimEnd = findLatexOpaqueEnvironmentEnd(
          source,
          environmentArgument.range.end,
          scanEnd,
          environment,
        );
        if (verbatimEnd === undefined) {
          report({
            code: 'unterminated-verbatim-environment',
            message: `The ${environment} environment has no closing \\end command within the scan limit.`,
            range: environmentRange,
          }, true);
          index = scanEnd;
        } else {
          index = verbatimEnd;
        }
        continue;
      }

      if (environment === 'document') {
        if (control.name === 'begin') {
          if (beginDocument === undefined) {
            beginDocument = environmentRange;
            phase = 'body';
          } else {
            report({
              code: 'malformed-document-environment',
              message: 'Multiple \\begin{document} commands were found.',
              range: environmentRange,
            }, true);
          }
        } else if (beginDocument !== undefined && endDocument === undefined) {
          endDocument = environmentRange;
          phase = 'after-document';
          // LaTeX's document environment terminator ends execution of the
          // main input stream. Anything after it is editor text, not project
          // authority, and therefore cannot poison an otherwise complete
          // graph with conditional, dynamic, or malformed commands.
          break;
        } else {
          report({
            code: 'malformed-document-environment',
            message: 'An unmatched or duplicate \\end{document} command was found.',
            range: environmentRange,
          }, true);
        }
      }
      index = environmentArgument.range.end;
      continue;
    }

    if (control.name === 'documentclass') {
      const optional = readOptionalArgument(source, control.range.end, scanEnd);
      const nameArgument = readRequiredArgument(
        source,
        optional?.range.end ?? control.range.end,
        scanEnd,
      );
      if (nameArgument === undefined) {
        report({
          code: 'malformed-document-class',
          message: 'The \\documentclass command has no bounded literal class argument.',
          range: control.range,
        }, true);
        index = control.range.end;
        continue;
      }
      const name = trimmedSource(source, nameArgument.contentRange);
      const classRecord: LatexProjectDocumentClass = {
        name: name.text,
        options: optional === undefined
          ? undefined
          : source.slice(optional.contentRange.start, optional.contentRange.end).trim(),
        range: { start: control.range.start, end: nameArgument.range.end },
        nameRange: name.range,
        optionsRange: optional?.contentRange,
      };
      if (documentClass === undefined) {
        documentClass = classRecord;
      } else {
        report({
          code: 'multiple-document-classes',
          message: 'Multiple \\documentclass commands were found.',
          range: classRecord.range,
        }, true);
      }
      index = nameArgument.range.end;
      continue;
    }

    if (INCLUDE_COMMANDS.has(control.name as LatexProjectIncludeKind)) {
      const kind = control.name as LatexProjectIncludeKind;
      const parsed = parseInclude(source, control, kind, phase, scanEnd);
      if (parsed === undefined) {
        report({
          code: 'malformed-include',
          message: `The \\${kind} command does not have the required bounded literal argument${
            kind === 'import' || kind === 'subimport' ? 's' : ''
          }.`,
          range: control.range,
        }, true);
        index = control.range.end;
        continue;
      }
      if (includes.length >= maxIncludes) {
        report({
          code: 'too-many-includes',
          message: `More than ${maxIncludes} project include commands were found.`,
          range: parsed.range,
        }, true);
        index = parsed.range.end;
        continue;
      }
      includes.push(parsed);
      if (parsed.normalizedPath === undefined) {
        report({
          code: 'invalid-include-path',
          message: `The \\${kind} command must contain only literal relative project paths.`,
          range: parsed.pathRange,
        }, true);
      }
      index = parsed.range.end;
      continue;
    }

    index = control.range.end;
  }

  if (rootDirectives.length > 1) {
    const duplicateRange = rootDirectives[1]?.range;
    report({
      code: 'multiple-root-directives',
      message: 'Multiple TeX root directives were found; callers must not guess between them.',
      ...(duplicateRange === undefined ? {} : { range: duplicateRange }),
    }, true);
  }

  if (diagnosticsTruncated && diagnostics.length > 0) {
    const last = diagnostics.at(-1);
    if (last?.code !== 'diagnostic-limit') {
      diagnostics[diagnostics.length - 1] = {
        code: 'diagnostic-limit',
        message: `Project diagnostics were truncated at ${maxDiagnostics} entries.`,
        ...(last?.range === undefined ? {} : { range: last.range }),
      };
    }
  }

  return {
    rootDirectives,
    documentClass,
    beginDocument,
    endDocument,
    endInput,
    includes,
    diagnostics,
    graphIncomplete,
  };
}

/**
 * Return whether a path is already safe relative to a conceptual project
 * root. This intentionally rejects leading parent segments. A source-local
 * request such as `../main.tex` should instead be checked with
 * `resolveLatexProjectPath` and its containing project-relative filename.
 */
export function isSafeLatexProjectRelativePath(value: string): boolean {
  const parsed = parseLiteralProjectPath(value);
  return parsed.normalizedPath !== undefined &&
    parsed.normalizedPath !== '..' &&
    !parsed.normalizedPath.startsWith('../');
}

/**
 * Resolve a literal TeX request against a project-relative containing file.
 * The returned path always uses `/` and can never escape the project root.
 */
export function resolveLatexProjectPath(
  containingFilePath: string,
  requestedPath: string,
  options: LatexProjectPathResolutionOptions = {},
): LatexProjectPathResolution {
  const containing = parseLiteralProjectPath(containingFilePath);
  if (
    containing.normalizedPath === undefined ||
    containing.normalizedPath === '..' ||
    containing.normalizedPath.startsWith('../') ||
    containing.normalizedPath.endsWith('/')
  ) {
    return { ok: false, reason: 'invalid-containing-file' };
  }
  const requested = parseLiteralProjectPath(requestedPath);
  if (requested.normalizedPath === undefined) {
    return { ok: false, reason: requested.reason ?? 'unsafe-syntax' };
  }

  const containingSegments = containing.normalizedPath.split('/');
  containingSegments.pop();
  for (const segment of requested.normalizedPath.split('/')) {
    if (segment === '..') {
      if (containingSegments.length === 0) {
        return { ok: false, reason: 'workspace-escape' };
      }
      containingSegments.pop();
    } else if (segment !== '.' && segment.length > 0) {
      containingSegments.push(segment);
    }
  }
  if (containingSegments.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  let path = containingSegments.join('/');
  if (
    (options.appendTexExtension ?? true) &&
    !/\.[^/]+$/u.test(path)
  ) {
    path += '.tex';
  }
  return { ok: true, path };
}

/**
 * Build a bounded graph from already-loaded, project-relative sources. This is
 * useful for tests and non-I/O consumers; a VS Code service can also call the
 * scanner and resolver incrementally while applying dirty-buffer precedence.
 */
export function buildLatexProjectGraph(
  requestedRootPath: string,
  sources: ReadonlyMap<string, string>,
  options: LatexProjectGraphOptions = {},
): LatexProjectGraph {
  const maxFiles = boundedLimit(options.maxFiles, DEFAULT_MAX_FILES, DEFAULT_MAX_FILES);
  const maxEdges = boundedLimit(options.maxEdges, DEFAULT_MAX_EDGES, DEFAULT_MAX_EDGES);
  const maxDiagnostics = boundedLimit(
    options.maxDiagnostics,
    DEFAULT_MAX_DIAGNOSTICS,
    DEFAULT_MAX_DIAGNOSTICS,
  );
  const sourceByPath = new Map<string, string>();
  const files: LatexProjectGraphFile[] = [];
  const edges: LatexProjectGraphEdge[] = [];
  const cycles: string[][] = [];
  const diagnostics: LatexProjectDiagnostic[] = [];
  let graphIncomplete = false;
  let diagnosticsTruncated = false;

  const report = (diagnostic: LatexProjectDiagnostic): void => {
    graphIncomplete = true;
    if (diagnostics.length < maxDiagnostics) {
      diagnostics.push(diagnostic);
    } else {
      diagnosticsTruncated = true;
    }
  };

  let candidateCount = 0;
  for (const [rawPath, source] of sources) {
    candidateCount += 1;
    if (candidateCount > MAX_GRAPH_SOURCE_CANDIDATES) {
      report({
        code: 'too-many-files',
        message: `More than ${MAX_GRAPH_SOURCE_CANDIDATES} source candidates were supplied.`,
      });
      break;
    }
    const parsed = parseLiteralProjectPath(rawPath);
    if (
      parsed.normalizedPath === undefined ||
      parsed.normalizedPath === '..' ||
      parsed.normalizedPath.startsWith('../')
    ) {
      report({
        code: 'invalid-source-path',
        message: `The source key “${boundedDisplay(rawPath)}” is not project-relative.`,
      });
      continue;
    }
    if (sourceByPath.has(parsed.normalizedPath)) {
      report({
        code: 'duplicate-source-path',
        message: `Multiple source entries normalize to “${boundedDisplay(parsed.normalizedPath)}”.`,
        filePath: parsed.normalizedPath,
      });
      continue;
    }
    sourceByPath.set(parsed.normalizedPath, source);
  }

  const parsedRoot = parseLiteralProjectPath(requestedRootPath);
  let rootPath = parsedRoot.normalizedPath;
  if (
    rootPath === undefined ||
    rootPath === '..' ||
    rootPath.startsWith('../')
  ) {
    report({
      code: 'invalid-source-path',
      message: 'The requested project root is not a safe project-relative path.',
    });
    rootPath = undefined;
  } else if (!sourceByPath.has(rootPath) && !/\.[^/]+$/u.test(rootPath)) {
    const withExtension = `${rootPath}.tex`;
    if (sourceByPath.has(withExtension)) {
      rootPath = withExtension;
    }
  }

  if (rootPath === undefined || !sourceByPath.has(rootPath)) {
    report({
      code: 'missing-root-file',
      message: `The project root “${boundedDisplay(rootPath ?? requestedRootPath)}” is not present.`,
      ...(rootPath === undefined ? {} : { filePath: rootPath }),
    });
    return finishGraph(
      rootPath,
      files,
      edges,
      cycles,
      diagnostics,
      graphIncomplete,
      diagnosticsTruncated,
      maxDiagnostics,
    );
  }

  const visited = new Set<string>();
  const expanded = new Set<string>();
  const active = new Map<string, number>();
  const ancestry: string[] = [];
  type GraphExecutionRole = 'standalone' | 'preamble' | 'body';
  const flow: { phase: 'preamble' | 'body' | 'terminated' } = { phase: 'preamble' };

  const visit = (
    filePath: string,
    pathState: LatexProjectExecutionPathState,
    role: GraphExecutionRole,
    stripStandalonePreamble: boolean,
  ): void => {
    const executionKey = latexProjectExecutionPathKey(
      filePath,
      pathState,
      role,
      stripStandalonePreamble,
    );
    if (expanded.has(executionKey)) {
      return;
    }
    const firstVisit = !visited.has(filePath);
    if (firstVisit && files.length >= maxFiles) {
      report({
        code: 'too-many-files',
        message: `The project graph exceeded ${maxFiles} reachable files.`,
        filePath,
      });
      return;
    }
    const source = sourceByPath.get(filePath);
    if (source === undefined) {
      return;
    }
    expanded.add(executionKey);
    if (firstVisit) {
      visited.add(filePath);
    }
    active.set(executionKey, ancestry.length);
    ancestry.push(filePath);
    const scan = scanLatexProjectSource(source, options);
    if (firstVisit) {
      files.push({ path: filePath, scan });
      if (scan.graphIncomplete) {
        graphIncomplete = true;
      }
      for (const diagnostic of scan.diagnostics) {
        if (diagnostics.length >= maxDiagnostics) {
          graphIncomplete = true;
          diagnosticsTruncated = true;
          break;
        }
        diagnostics.push({ ...diagnostic, filePath });
      }
    }

    for (const include of scan.includes) {
      if (
        stripStandalonePreamble &&
        scan.beginDocument !== undefined &&
        include.phase === 'preamble'
      ) {
        continue;
      }
      if (
        role !== 'body' &&
        flow.phase === 'preamble' &&
        include.phase === 'body'
      ) {
        flow.phase = 'body';
      }
      const targetRole: GraphExecutionRole = flow.phase === 'preamble'
        ? (role === 'body' || include.phase === 'body' ? 'body' : 'preamble')
        : 'body';
      if (flow.phase === 'terminated' || include.phase === 'after-document') {
        continue;
      }
      if (edges.length >= maxEdges) {
        report({
          code: 'too-many-edges',
          message: `The project graph exceeded ${maxEdges} include edges.`,
          filePath,
          range: include.range,
        });
        break;
      }
      if (include.normalizedPath === undefined) {
        edges.push({ from: filePath, to: undefined, status: 'invalid', include });
        continue;
      }
      const candidates = latexProjectIncludePathCandidates(
        include,
        source,
        pathState,
      );
      if (candidates.length === 0) {
        edges.push({ from: filePath, to: undefined, status: 'invalid', include });
        report({
          code: 'invalid-include-path',
          message: 'The include path could not be resolved within the lexical project root.',
          filePath,
          range: include.pathRange,
        });
        continue;
      }
      let firstCandidate: Extract<LatexProjectExecutionPathCandidate, { readonly ok: true }> |
        undefined;
      let selected: Extract<LatexProjectExecutionPathCandidate, { readonly ok: true }> |
        undefined;
      let blockedByUnsafeEarlierCandidate = false;
      for (const candidate of candidates) {
        if (!candidate.ok) {
          blockedByUnsafeEarlierCandidate = true;
          break;
        }
        firstCandidate ??= candidate;
        if (sourceByPath.has(candidate.path)) {
          selected = candidate;
          break;
        }
      }
      if (blockedByUnsafeEarlierCandidate || firstCandidate === undefined) {
        edges.push({ from: filePath, to: undefined, status: 'invalid', include });
        report({
          code: 'invalid-include-path',
          message: 'An earlier TeX input search candidate leaves the lexical project root; later fallbacks were not guessed.',
          filePath,
          range: include.pathRange,
        });
        continue;
      }
      selected ??= firstCandidate;
      const targetPath = selected.path;
      const targetExecutionKey = latexProjectExecutionPathKey(
        targetPath,
        selected.state,
        targetRole,
        include.kind === 'subfile' && targetRole === 'body',
      );
      const cycleStart = active.get(targetExecutionKey);
      if (cycleStart !== undefined) {
        const cycle = [...ancestry.slice(cycleStart), targetPath];
        cycles.push(cycle);
        edges.push({ from: filePath, to: targetPath, status: 'cycle', include });
        report({
          code: 'include-cycle',
          message: `Include cycle detected: ${cycle.map(boundedDisplay).join(' -> ')}.`,
          filePath,
          range: include.range,
        });
        continue;
      }
      if (!sourceByPath.has(targetPath)) {
        edges.push({ from: filePath, to: targetPath, status: 'missing', include });
        report({
          code: 'missing-include-file',
          message: `Included source “${boundedDisplay(targetPath)}” is not present.`,
          filePath,
          range: include.pathRange,
        });
        continue;
      }
      edges.push({ from: filePath, to: targetPath, status: 'resolved', include });
      visit(
        targetPath,
        selected.state,
        targetRole,
        include.kind === 'subfile' && targetRole === 'body',
      );
    }

    if (role !== 'body') {
      if (scan.endDocument !== undefined) {
        flow.phase = 'terminated';
      } else if (scan.beginDocument !== undefined && flow.phase === 'preamble') {
        flow.phase = 'body';
      }
    }

    ancestry.pop();
    active.delete(executionKey);
  };

  visit(rootPath, initialLatexProjectExecutionPathState(rootPath), 'standalone', false);
  return finishGraph(
    rootPath,
    files,
    edges,
    cycles,
    diagnostics,
    graphIncomplete,
    diagnosticsTruncated,
    maxDiagnostics,
  );
}

function initialLatexProjectExecutionPathState(
  rootPath: string,
): LatexProjectExecutionPathState {
  return {
    rootDirectory: latexProjectDirectory(rootPath),
    importDirectory: undefined,
    inputDirectories: Object.freeze([]),
  };
}

function latexProjectExecutionPathKey(
  filePath: string,
  state: LatexProjectExecutionPathState,
  role: 'standalone' | 'preamble' | 'body',
  stripStandalonePreamble: boolean,
): string {
  return [
    filePath,
    role,
    stripStandalonePreamble ? 'body-only' : 'complete-source',
    state.rootDirectory,
    state.importDirectory ?? "",
    ...state.inputDirectories,
  ].join('\u0000');
}

function latexProjectIncludePathCandidates(
  include: LatexProjectInclude,
  source: string,
  state: LatexProjectExecutionPathState,
): readonly LatexProjectExecutionPathCandidate[] {
  if (include.normalizedPath === undefined) {
    return [];
  }
  if (include.kind === 'input' || include.kind === 'include') {
    const result: LatexProjectExecutionPathCandidate[] = [];
    const seen = new Set<string>();
    for (const directory of uniqueLatexProjectDirectories([
      ...state.inputDirectories,
      state.rootDirectory,
    ])) {
      const resolved = resolveLatexProjectPathFromDirectory(
        directory,
        include.normalizedPath,
      );
      if (!resolved.ok) {
        result.push({ ok: false });
      } else if (!seen.has(resolved.path)) {
        seen.add(resolved.path);
        result.push({ ok: true, path: resolved.path, state });
      }
    }
    return result;
  }

  if (include.kind === 'subfile') {
    const base = state.importDirectory ?? state.rootDirectory;
    const resolved = resolveLatexProjectPathFromDirectory(
      base,
      include.normalizedPath,
    );
    if (!resolved.ok) {
      return [];
    }
    const importDirectory = latexProjectDirectory(resolved.path);
    return [{
      ok: true,
      path: resolved.path,
      state: latexProjectImportedPathState(state, importDirectory),
    }];
  }

  const directoryRawPath = include.directoryRawPath;
  if (directoryRawPath === undefined) {
    return [];
  }
  const base = include.kind === 'import'
    ? state.rootDirectory
    : state.importDirectory ?? state.rootDirectory;
  const importDirectory = resolveLatexProjectImportDirectory(
    base,
    directoryRawPath,
  );
  if (importDirectory === undefined) {
    return [];
  }
  const filename = source.slice(include.pathRange.start, include.pathRange.end).trim();
  const resolved = resolveLatexProjectPathFromDirectory(importDirectory, filename);
  if (!resolved.ok) {
    return [];
  }
  return [{
    ok: true,
    path: resolved.path,
    state: latexProjectImportedPathState(state, importDirectory),
  }];
}

function latexProjectImportedPathState(
  previous: LatexProjectExecutionPathState,
  importDirectory: string,
): LatexProjectExecutionPathState {
  return {
    rootDirectory: previous.rootDirectory,
    importDirectory,
    inputDirectories: Object.freeze(uniqueLatexProjectDirectories([
      importDirectory,
      ...previous.inputDirectories,
    ])),
  };
}

function resolveLatexProjectImportDirectory(
  baseDirectory: string,
  requestedDirectory: string,
): string | undefined {
  const marker = joinImportPath(
    requestedDirectory,
    '__texleaf_import_base__.tex',
  );
  const resolved = resolveLatexProjectPathFromDirectory(
    baseDirectory,
    marker,
    false,
  );
  return resolved.ok ? latexProjectDirectory(resolved.path) : undefined;
}

function resolveLatexProjectPathFromDirectory(
  directory: string,
  requestedPath: string,
  appendTexExtension = true,
): LatexProjectPathResolution {
  const containingFile = directory.length === 0
    ? '__texleaf_path_base__.tex'
    : `${directory}/__texleaf_path_base__.tex`;
  return resolveLatexProjectPath(containingFile, requestedPath, {
    appendTexExtension,
  });
}

function latexProjectDirectory(filePath: string): string {
  const slash = filePath.lastIndexOf('/');
  return slash < 0 ? '' : filePath.slice(0, slash);
}

function uniqueLatexProjectDirectories(
  directories: readonly string[],
): readonly string[] {
  return [...new Set(directories)];
}

function finishGraph(
  rootPath: string | undefined,
  files: readonly LatexProjectGraphFile[],
  edges: readonly LatexProjectGraphEdge[],
  cycles: readonly (readonly string[])[],
  diagnostics: LatexProjectDiagnostic[],
  graphIncomplete: boolean,
  diagnosticsTruncated: boolean,
  maxDiagnostics: number,
): LatexProjectGraph {
  if (diagnosticsTruncated && diagnostics.length > 0) {
    const last = diagnostics.at(-1);
    if (last?.code !== 'diagnostic-limit') {
      diagnostics[diagnostics.length - 1] = {
        code: 'diagnostic-limit',
        message: `Project diagnostics were truncated at ${maxDiagnostics} entries.`,
        ...(last?.range === undefined ? {} : { range: last.range }),
        ...(last?.filePath === undefined ? {} : { filePath: last.filePath }),
      };
    }
  }
  return {
    rootPath,
    files,
    edges,
    cycles,
    diagnostics,
    graphIncomplete,
  };
}

function parseRootDirective(
  source: string,
  commentStart: number,
  lineEnd: number,
): LatexProjectRootDirective | undefined {
  const lineStart = source.lastIndexOf('\n', Math.max(0, commentStart - 1)) + 1;
  if (!/^[ \t]*$/u.test(source.slice(lineStart, commentStart))) {
    return undefined;
  }
  let commentEnd = lineEnd;
  if (source[commentEnd - 1] === '\n') {
    commentEnd -= 1;
  }
  if (source[commentEnd - 1] === '\r') {
    commentEnd -= 1;
  }
  const comment = source.slice(commentStart, commentEnd);
  const prefix = /^%[ \t]*![ \t]*TEX[ \t]+root[ \t]*=[ \t]*/iu.exec(comment);
  if (prefix === null) {
    return undefined;
  }
  let pathStart = commentStart + prefix[0].length;
  let pathEnd = commentStart + comment.length;
  while (pathEnd > pathStart && /[ \t]/u.test(source[pathEnd - 1] ?? '')) {
    pathEnd -= 1;
  }
  while (pathStart < pathEnd && /[ \t]/u.test(source[pathStart] ?? '')) {
    pathStart += 1;
  }
  const first = source[pathStart];
  const last = source[pathEnd - 1];
  if ((first === '"' || first === "'") && last === first && pathEnd - pathStart >= 2) {
    pathStart += 1;
    pathEnd -= 1;
  }
  const rawPath = source.slice(pathStart, pathEnd);
  return {
    rawPath,
    normalizedPath: parseLiteralProjectPath(rawPath).normalizedPath,
    range: { start: commentStart, end: lineEnd },
    pathRange: { start: pathStart, end: pathEnd },
  };
}

function parseInclude(
  source: string,
  control: ControlSequence,
  kind: LatexProjectIncludeKind,
  phase: LatexProjectPhase,
  scanEnd: number,
): LatexProjectInclude | undefined {
  const firstArgument = kind === 'input'
    ? readRequiredArgument(source, control.range.end, scanEnd) ??
      readUnbracedInputArgument(source, control.range.end, scanEnd)
    : readRequiredArgument(source, control.range.end, scanEnd);
  if (firstArgument === undefined) {
    return undefined;
  }
  if (kind !== 'import' && kind !== 'subimport') {
    const path = trimmedSource(source, firstArgument.contentRange);
    return {
      kind,
      phase,
      range: { start: control.range.start, end: firstArgument.range.end },
      commandRange: control.range,
      pathRange: path.range,
      rawPath: path.text,
      normalizedPath: parseLiteralProjectPath(path.text).normalizedPath,
      directoryRawPath: undefined,
      directoryRange: undefined,
    };
  }

  const secondArgument = readRequiredArgument(
    source,
    firstArgument.range.end,
    scanEnd,
  );
  if (secondArgument === undefined) {
    return undefined;
  }
  const directory = trimmedSource(source, firstArgument.contentRange);
  const filename = trimmedSource(source, secondArgument.contentRange);
  const rawPath = joinImportPath(directory.text, filename.text);
  return {
    kind,
    phase,
    range: { start: control.range.start, end: secondArgument.range.end },
    commandRange: control.range,
    pathRange: filename.range,
    rawPath,
    normalizedPath: parseLiteralProjectPath(rawPath).normalizedPath,
    directoryRawPath: directory.text,
    directoryRange: directory.range,
  };
}

function isProjectDefinitionCommand(name: string): boolean {
  return PROJECT_NEW_COMMAND_DEFINITIONS.has(name) ||
    PROJECT_XPARSE_COMMAND_DEFINITIONS.has(name) ||
    PROJECT_NEW_ENVIRONMENT_DEFINITIONS.has(name) ||
    PROJECT_XPARSE_ENVIRONMENT_DEFINITIONS.has(name) ||
    PROJECT_TEX_DEFINITIONS.has(name);
}

function skipProjectDefinition(
  source: string,
  control: ControlSequence,
  limit: number,
): number | undefined {
  let cursor = control.range.end;
  if (source[cursor] === '*') {
    cursor += 1;
  }
  if (PROJECT_TEX_DEFINITIONS.has(control.name)) {
    cursor = skipTeXWhitespaceAndComments(source, cursor, limit);
    const target = readControlSequence(source, cursor, limit);
    if (target === undefined) {
      return undefined;
    }
    cursor = target.range.end;
    while (cursor < limit) {
      if (source[cursor] === '%' && !isEscapedAt(source, cursor)) {
        cursor = endOfLine(source, cursor, limit);
        continue;
      }
      if (source[cursor] === '{') {
        return readDelimitedArgument(source, cursor, limit, '{', '}')?.range.end;
      }
      const nested = source[cursor] === '\\'
        ? readControlSequence(source, cursor, limit)
        : undefined;
      cursor = nested?.range.end ?? cursor + 1;
    }
    return undefined;
  }

  const targetEnd = readProjectDefinitionTarget(source, cursor, limit);
  if (targetEnd === undefined) {
    return undefined;
  }
  cursor = targetEnd;
  if (PROJECT_NEW_COMMAND_DEFINITIONS.has(control.name)) {
    const argumentCount = readOptionalArgument(source, cursor, limit);
    cursor = argumentCount?.range.end ?? cursor;
    const optionalDefault = readOptionalArgument(source, cursor, limit);
    cursor = optionalDefault?.range.end ?? cursor;
    return readRequiredArgument(source, cursor, limit)?.range.end;
  }
  if (PROJECT_XPARSE_COMMAND_DEFINITIONS.has(control.name)) {
    const signature = readRequiredArgument(source, cursor, limit);
    return signature === undefined
      ? undefined
      : readRequiredArgument(source, signature.range.end, limit)?.range.end;
  }
  if (PROJECT_NEW_ENVIRONMENT_DEFINITIONS.has(control.name)) {
    const argumentCount = readOptionalArgument(source, cursor, limit);
    cursor = argumentCount?.range.end ?? cursor;
    const optionalDefault = readOptionalArgument(source, cursor, limit);
    cursor = optionalDefault?.range.end ?? cursor;
    const beginBody = readRequiredArgument(source, cursor, limit);
    return beginBody === undefined
      ? undefined
      : readRequiredArgument(source, beginBody.range.end, limit)?.range.end;
  }
  const signature = readRequiredArgument(source, cursor, limit);
  const beginBody = signature === undefined
    ? undefined
    : readRequiredArgument(source, signature.range.end, limit);
  return beginBody === undefined
    ? undefined
    : readRequiredArgument(source, beginBody.range.end, limit)?.range.end;
}

function readProjectDefinitionTarget(
  source: string,
  requestedStart: number,
  limit: number,
): number | undefined {
  const cursor = skipTeXWhitespaceAndComments(source, requestedStart, limit);
  const grouped = readRequiredArgument(source, cursor, limit);
  return grouped?.range.end ?? readControlSequence(source, cursor, limit)?.range.end;
}

function skipLiteralFalseProjectConditional(
  source: string,
  requestedStart: number,
  limit: number,
): {
  readonly end: number;
  readonly hasElse: boolean;
  readonly hasProjectCommand: boolean;
  readonly terminated: boolean;
} {
  let depth = 1;
  let index = requestedStart;
  let hasElse = false;
  let hasProjectCommand = false;
  while (index < limit) {
    if (source[index] === '%' && !isEscapedAt(source, index)) {
      index = endOfLine(source, index, limit);
      continue;
    }
    if (source[index] !== '\\') {
      index += 1;
      continue;
    }
    const control = readControlSequence(source, index, limit);
    if (control === undefined) {
      index += 1;
      continue;
    }
    if (control.name === 'verb') {
      index = skipInlineVerb(source, control.range.end, limit) ?? control.range.end;
      continue;
    }
    if (control.name === 'newif') {
      const declarationEnd = skipProjectNewIfDeclaration(
        source,
        control.range.end,
        limit,
      );
      if (declarationEnd === undefined) {
        hasProjectCommand = true;
        index = control.range.end;
      } else {
        index = declarationEnd;
      }
      continue;
    }
    if (isProjectConditionalControl(control.name)) {
      depth += 1;
    } else if (control.name === 'else' && depth === 1) {
      hasElse = true;
    } else if (control.name === 'fi') {
      depth -= 1;
      if (depth === 0) {
        return {
          end: control.range.end,
          hasElse,
          hasProjectCommand,
          terminated: true,
        };
      }
    } else if (
      INCLUDE_COMMANDS.has(control.name as LatexProjectIncludeKind) ||
      control.name === 'documentclass' ||
      control.name === 'label' ||
      control.name === 'endinput'
    ) {
      hasProjectCommand = true;
    } else if (control.name === 'begin' || control.name === 'end') {
      const environment = readRequiredArgument(source, control.range.end, limit);
      if (
        environment !== undefined &&
        trimmedSource(source, environment.contentRange).text === 'document'
      ) {
        hasProjectCommand = true;
      }
    }
    index = control.range.end;
  }
  return { end: limit, hasElse, hasProjectCommand, terminated: false };
}

/**
 * TeX's conventional custom conditionals are created with names beginning in
 * `if` (for example `\ifdraft`). Counting those names is essential while
 * balancing a skipped branch: otherwise an inner custom `\if...\fi` can make
 * the outer branch appear to end early and expose dead `\input` commands.
 */
function isProjectConditionalControl(name: string): boolean {
  return name !== "iff" &&
    (PROJECT_CONDITIONAL_PRIMITIVES.has(name) || /^if[A-Za-z@]+$/u.test(name));
}

function skipProjectNewIfDeclaration(
  source: string,
  requestedStart: number,
  limit: number,
): number | undefined {
  const targetStart = skipTeXWhitespaceAndComments(source, requestedStart, limit);
  const target = readControlSequence(source, targetStart, limit);
  return target !== undefined && /^if[A-Za-z@]+$/u.test(target.name)
    ? target.range.end
    : undefined;
}

function projectFunctionalConditionalArgumentCount(name: string): number | undefined {
  if (
    name === 'ifthenelse' ||
    name === 'IfFileExists' ||
    name === 'InputIfFileExists'
  ) {
    return 3;
  }
  if (/^If[A-Za-z@]*TF$/u.test(name)) {
    return 3;
  }
  if (/^If[A-Za-z@]*[TF]$/u.test(name)) {
    return 2;
  }
  if (/^@if(?:package|class)later$/u.test(name)) {
    return 4;
  }
  if (/^@if[A-Za-z@]+$/u.test(name)) {
    return 3;
  }
  return undefined;
}

function readProjectFunctionalConditional(
  source: string,
  requestedStart: number,
  limit: number,
  argumentCount: number,
): { readonly end: number; readonly hasProjectCommand: boolean } | undefined {
  let cursor = requestedStart;
  let hasProjectCommand = false;
  for (let argumentIndex = 0; argumentIndex < argumentCount; argumentIndex += 1) {
    const argument = readRequiredArgument(source, cursor, limit);
    if (argument === undefined) {
      return undefined;
    }
    hasProjectCommand ||= projectRangeHasAuthorityCommand(
      source,
      argument.contentRange.start,
      argument.contentRange.end,
    );
    cursor = argument.range.end;
  }
  return { end: cursor, hasProjectCommand };
}

function projectRangeHasAuthorityCommand(
  source: string,
  requestedStart: number,
  limit: number,
): boolean {
  let index = requestedStart;
  while (index < limit) {
    if (source[index] === '%' && !isEscapedAt(source, index)) {
      index = endOfLine(source, index, limit);
      continue;
    }
    if (source[index] !== '\\') {
      index += 1;
      continue;
    }
    const control = readControlSequence(source, index, limit);
    if (control === undefined) {
      index += 1;
      continue;
    }
    if (control.name === 'verb') {
      index = skipInlineVerb(source, control.range.end, limit) ?? control.range.end;
      continue;
    }
    if (control.name === 'newif') {
      index = skipProjectNewIfDeclaration(source, control.range.end, limit) ?? control.range.end;
      continue;
    }
    if (isProjectDefinitionCommand(control.name)) {
      const definitionEnd = skipProjectDefinition(source, control, limit);
      if (definitionEnd === undefined) {
        return true;
      }
      index = definitionEnd;
      continue;
    }
    if (
      INCLUDE_COMMANDS.has(control.name as LatexProjectIncludeKind) ||
      control.name === 'documentclass' ||
      control.name === 'label' ||
      control.name === 'endinput'
    ) {
      return true;
    }
    if (control.name === 'begin' || control.name === 'end') {
      const environment = readRequiredArgument(source, control.range.end, limit);
      if (environment !== undefined) {
        const name = trimmedSource(source, environment.contentRange).text;
        if (name === 'document') {
          return true;
        }
        if (control.name === 'begin' && VERBATIM_ENVIRONMENTS.has(name)) {
          index = findLatexOpaqueEnvironmentEnd(
            source,
            environment.range.end,
            limit,
            name,
          ) ?? limit;
          continue;
        }
        index = environment.range.end;
        continue;
      }
    }
    index = control.range.end;
  }
  return false;
}

function joinImportPath(directory: string, filename: string): string {
  const left = directory.replace(/\/+$/u, '');
  const right = filename.replace(/^\/+/u, '');
  return left.length === 0 ? right : `${left}/${right}`;
}

function readControlSequence(
  source: string,
  start: number,
  limit: number,
): ControlSequence | undefined {
  if (source[start] !== '\\' || start + 1 >= limit) {
    return undefined;
  }
  let end = start + 1;
  if (/[A-Za-z@]/u.test(source[end] ?? '')) {
    end += 1;
    while (end < limit && /[A-Za-z@]/u.test(source[end] ?? '')) {
      end += 1;
    }
  } else {
    end += 1;
  }
  return {
    name: source.slice(start + 1, end),
    range: { start, end },
  };
}

function readRequiredArgument(
  source: string,
  requestedStart: number,
  limit: number,
): SourceArgument | undefined {
  const start = skipTeXWhitespaceAndComments(source, requestedStart, limit);
  return source[start] === '{'
    ? readDelimitedArgument(source, start, limit, '{', '}')
    : undefined;
}

function readOptionalArgument(
  source: string,
  requestedStart: number,
  limit: number,
): SourceArgument | undefined {
  const start = skipTeXWhitespaceAndComments(source, requestedStart, limit);
  return source[start] === '['
    ? readDelimitedArgument(source, start, limit, '[', ']')
    : undefined;
}

function readDelimitedArgument(
  source: string,
  start: number,
  limit: number,
  open: '{' | '[',
  close: '}' | ']',
): SourceArgument | undefined {
  let delimiterDepth = 1;
  let braceDepth = 0;
  let index = start + 1;
  while (index < limit) {
    const character = source[index];
    if (character === '%' && !isEscapedAt(source, index)) {
      index = endOfLine(source, index, limit);
      continue;
    }
    if (character === '\\') {
      const control = readControlSequence(source, index, limit);
      index = Math.max(index + 1, control?.range.end ?? index + 1);
      continue;
    }
    if (open === '[') {
      if (character === '{') {
        braceDepth += 1;
        index += 1;
        continue;
      }
      if (character === '}' && braceDepth > 0) {
        braceDepth -= 1;
        index += 1;
        continue;
      }
    }
    if (braceDepth === 0 && character === open) {
      delimiterDepth += 1;
    } else if (braceDepth === 0 && character === close) {
      delimiterDepth -= 1;
      if (delimiterDepth === 0) {
        return {
          range: { start, end: index + 1 },
          contentRange: { start: start + 1, end: index },
        };
      }
    }
    index += 1;
  }
  return undefined;
}

function readUnbracedInputArgument(
  source: string,
  requestedStart: number,
  limit: number,
): SourceArgument | undefined {
  const start = skipTeXWhitespaceAndComments(source, requestedStart, limit);
  if (start >= limit || source[start] === '\\') {
    return undefined;
  }
  let end = start;
  while (end < limit && !/[\s%{}]/u.test(source[end] ?? '')) {
    end += 1;
  }
  return end > start
    ? {
        range: { start, end },
        contentRange: { start, end },
      }
    : undefined;
}

function skipTeXWhitespaceAndComments(
  source: string,
  requestedStart: number,
  limit: number,
): number {
  let index = requestedStart;
  while (index < limit) {
    if (/\s/u.test(source[index] ?? '')) {
      index += 1;
      continue;
    }
    if (source[index] === '%' && !isEscapedAt(source, index)) {
      index = endOfLine(source, index, limit);
      continue;
    }
    break;
  }
  return index;
}

function skipInlineVerb(
  source: string,
  controlEnd: number,
  limit: number,
): number | undefined {
  let delimiterIndex = controlEnd;
  if (source[delimiterIndex] === '*') {
    delimiterIndex += 1;
  }
  const delimiter = source[delimiterIndex];
  if (delimiter === undefined || /[\sA-Za-z]/u.test(delimiter)) {
    return undefined;
  }
  const lineEnd = endOfLine(source, delimiterIndex + 1, limit);
  const closing = source.indexOf(delimiter, delimiterIndex + 1);
  return closing >= 0 && closing < lineEnd ? closing + 1 : undefined;
}

function trimmedSource(source: string, requestedRange: LatexProjectRange): TrimmedSource {
  let start = requestedRange.start;
  let end = requestedRange.end;
  while (start < end && /\s/u.test(source[start] ?? '')) {
    start += 1;
  }
  while (end > start && /\s/u.test(source[end - 1] ?? '')) {
    end -= 1;
  }
  return {
    text: source.slice(start, end),
    range: { start, end },
  };
}

function parseLiteralProjectPath(value: string): LiteralPathParse {
  if (value.length === 0 || value.trim().length === 0) {
    return { normalizedPath: undefined, reason: 'empty' };
  }
  if (
    value !== value.trim() ||
    value.length > MAX_PATH_LENGTH ||
    /[\u0000-\u001F\u007F]/u.test(value) ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.startsWith('~') ||
    value.includes('\\') ||
    value.includes('//') ||
    /[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) ||
    /[{}\[\]$&#?*|<>"']/u.test(value)
  ) {
    return { normalizedPath: undefined, reason: 'unsafe-syntax' };
  }
  const segments: string[] = [];
  for (const segment of value.split('/')) {
    if (segment.length === 0 || segment === '.') {
      continue;
    }
    if (segment.length > MAX_PATH_SEGMENT_LENGTH) {
      return { normalizedPath: undefined, reason: 'unsafe-syntax' };
    }
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') {
        segments.pop();
      } else {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0
    ? { normalizedPath: undefined, reason: 'empty' }
    : { normalizedPath: segments.join('/'), reason: undefined };
}

function isEscapedAt(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function endOfLine(source: string, from: number, limit: number): number {
  const newline = source.indexOf('\n', from);
  return newline < 0 || newline >= limit ? limit : newline + 1;
}

function boundedLimit(
  requested: number | undefined,
  fallback: number,
  ceiling: number,
): number {
  return requested === undefined || !Number.isFinite(requested)
    ? fallback
    : Math.max(1, Math.min(ceiling, Math.trunc(requested)));
}

function boundedDisplay(value: string): string {
  return value.length <= 160 ? value : `${value.slice(0, 157)}…`;
}
