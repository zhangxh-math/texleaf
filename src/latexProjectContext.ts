/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { createHash } from "node:crypto";
import * as vscode from "vscode";
import {
  isSafeLatexProjectRelativePath,
  resolveLatexProjectPath,
  scanLatexProjectSource,
  type LatexProjectInclude,
  type LatexProjectIncludeKind,
  type LatexProjectPhase,
  type LatexProjectRange,
  type LatexProjectSourceScan,
} from "./core/latexProject";
import {
  detectVisualDocumentLanguage,
  findVisualLabelsInRange,
  type VisualDocumentLanguage,
  type VisualLabelTarget,
} from "./core/visualStructure";
import { normalizeVisualText } from "./core/visualTextCoordinates";

const DEFAULT_MAX_DEPTH = 24;
const DEFAULT_MAX_FILES = 256;
const DEFAULT_MAX_EDGES = 2_048;
const DEFAULT_MAX_TOTAL_SOURCE_LENGTH = 8_000_000;
const DEFAULT_MAX_PREAMBLE_LENGTH = 1_000_000;
const DEFAULT_MAX_LABELS = 8_192;
const DEFAULT_MAX_ROOT_SEARCH_FILES = 512;
const DEFAULT_MAX_ROOT_SEARCH_FILE_LENGTH = 1_000_000;
const DEFAULT_MAX_ROOT_SEARCH_TOTAL_LENGTH = 16_000_000;
const DEFAULT_MAX_DIAGNOSTICS = 256;
const ROOT_SEARCH_EXCLUDE = "**/{.git,node_modules,.svn,.hg}/**";

export type LatexProjectFileRole = "standalone" | "body" | "preamble";

export type LatexProjectRootResolution =
  | "configured"
  | "magic"
  | "subfiles"
  | "self"
  | "reverse-include"
  | "standalone"
  | "ambiguous"
  | "unresolved"
  | "invalid-configured"
  | "invalid-magic";

export type LatexProjectIncludeStatus =
  | "resolved"
  | "dynamic"
  | "missing"
  | "outside-workspace"
  | "unsupported"
  | "cycle"
  | "depth-limit"
  | "file-limit"
  | "source-limit"
  | "read-error"
  | "ignored-standalone-preamble"
  | "ignored-after-document";

export type LatexProjectDiagnosticSeverity = "warning" | "error";

export interface LatexProjectContextDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: LatexProjectDiagnosticSeverity;
  readonly uri: vscode.Uri | undefined;
  readonly range: LatexProjectRange | undefined;
  readonly relatedUri: vscode.Uri | undefined;
}

export interface LatexProjectIncludeEdge {
  readonly kind: LatexProjectIncludeKind;
  readonly phase: LatexProjectPhase;
  readonly sourceRole: LatexProjectFileRole;
  readonly targetRole: LatexProjectFileRole | undefined;
  readonly sourceUri: vscode.Uri;
  readonly targetUri: vscode.Uri | undefined;
  readonly rawPath: string;
  readonly range: LatexProjectRange;
  readonly commandRange: LatexProjectRange;
  readonly pathRange: LatexProjectRange;
  readonly status: LatexProjectIncludeStatus;
}

export interface LatexProjectFile {
  readonly uri: vscode.Uri;
  readonly text: string;
  /** Content-addressed and therefore valid for both dirty buffers and files. */
  readonly contentRevision: string;
  readonly documentVersion: number | undefined;
  readonly dirty: boolean;
  readonly sourceKind: "open-document" | "workspace-fs";
  /** False only for the requested buffer retained beside an unrelated root. */
  readonly reachableFromRoot: boolean;
  /** The preferred role when a physical file is reached in multiple roles. */
  readonly role: LatexProjectFileRole;
  readonly roles: readonly LatexProjectFileRole[];
  /** Saturates at 2: 1 is unique, 2 means executed more than once. */
  readonly occurrenceCount: 1 | 2;
  readonly texOrder: number;
  readonly sourceScan: LatexProjectSourceScan;
  readonly includes: readonly LatexProjectIncludeEdge[];
}

export interface LatexProjectLabelTarget {
  readonly key: string;
  readonly uri: vscode.Uri;
  readonly from: number;
  readonly to: number;
  readonly keyFrom: number;
  readonly keyTo: number;
  readonly fileRole: LatexProjectFileRole;
  readonly fileRoles: readonly LatexProjectFileRole[];
  /** Saturates at 2 so consumers can fail closed on repeated execution. */
  readonly occurrenceCount: 1 | 2;
}

export interface LatexProjectContext {
  /** Stable for one workspace/root selection, independent of file contents. */
  readonly contextId: string;
  /** Project generation shared by every context built after one invalidation. */
  readonly revision: number;
  readonly requestedUri: vscode.Uri;
  readonly requestedRole: LatexProjectFileRole;
  readonly workspaceUri: vscode.Uri | undefined;
  /** Undefined when an explicit root is invalid or reverse lookup is ambiguous. */
  readonly rootUri: vscode.Uri | undefined;
  readonly rootResolution: LatexProjectRootResolution;
  readonly rootLanguage: VisualDocumentLanguage;
  readonly numberingRoot: "chapter" | "section";
  readonly documentClass: string | undefined;
  /**
   * Root preamble with resolved literal preamble edges expanded in lexical
   * source order. This is a bounded static approximation, not TeX execution.
   */
  readonly preambleSource: string;
  readonly files: readonly LatexProjectFile[];
  readonly labels: readonly LatexProjectLabelTarget[];
  readonly labelsByKey: ReadonlyMap<string, readonly LatexProjectLabelTarget[]>;
  readonly diagnostics: readonly LatexProjectContextDiagnostic[];
  readonly graphIncomplete: boolean;
}

export interface LatexProjectContextInvalidation {
  readonly resource: vscode.Uri | undefined;
  readonly contextIds: readonly string[];
  readonly revision: number;
}

/**
 * The one adaptation point between VS Code I/O and the pure project scanner.
 * Tests may inject a scanner without loading the extension's parser module.
 */
export interface LatexProjectSourceScanner {
  scan(source: string): LatexProjectSourceScan;
}

export type LatexProjectRootFileProvider = (
  resource: vscode.Uri,
) => string | undefined | PromiseLike<string | undefined>;

export interface LatexProjectContextServiceOptions {
  readonly scanner?: LatexProjectSourceScanner;
  readonly rootFileProvider?: LatexProjectRootFileProvider;
  readonly maxDepth?: number;
  readonly maxFiles?: number;
  readonly maxEdges?: number;
  readonly maxTotalSourceLength?: number;
  readonly maxPreambleLength?: number;
  readonly maxLabels?: number;
  readonly maxRootSearchFiles?: number;
  readonly maxRootSearchFileLength?: number;
  readonly maxRootSearchTotalLength?: number;
  readonly maxDiagnostics?: number;
}

interface NormalizedOptions {
  readonly scanner: LatexProjectSourceScanner;
  readonly rootFileProvider: LatexProjectRootFileProvider;
  readonly maxDepth: number;
  readonly maxFiles: number;
  readonly maxEdges: number;
  readonly maxTotalSourceLength: number;
  readonly maxPreambleLength: number;
  readonly maxLabels: number;
  readonly maxRootSearchFiles: number;
  readonly maxRootSearchFileLength: number;
  readonly maxRootSearchTotalLength: number;
  readonly maxDiagnostics: number;
}

interface CacheEntry {
  readonly epoch: number;
  readonly openDocumentVersion: number | undefined;
  readonly promise: Promise<LatexProjectContext>;
  contextId: string | undefined;
}

interface SourceRecord {
  readonly uri: vscode.Uri;
  readonly text: string;
  readonly contentRevision: string;
  readonly documentVersion: number | undefined;
  readonly dirty: boolean;
  readonly sourceKind: "open-document" | "workspace-fs";
  readonly scan: LatexProjectSourceScan;
  readonly scanError: string | undefined;
}

type SourceReadResult =
  | { readonly ok: true; readonly record: SourceRecord }
  | {
      readonly ok: false;
      readonly reason: "missing" | "decode-error" | "read-error";
      readonly message: string;
    };

interface FileBuilder {
  readonly record: SourceRecord;
  readonly roles: Set<LatexProjectFileRole>;
  readonly includes: LatexProjectIncludeEdge[];
  readonly texOrder: number;
  readonly expansionAllowed: boolean;
  reachableFromRoot: boolean;
  occurrenceCount: 1 | 2;
}

interface BuildState {
  readonly epoch: number;
  readonly revision: number;
  readonly requestedUri: vscode.Uri;
  readonly seedDocument: vscode.TextDocument | undefined;
  readonly workspaceFolder: vscode.WorkspaceFolder | undefined;
  readonly loads: Map<string, Promise<SourceReadResult>>;
  readonly diagnostics: LatexProjectContextDiagnostic[];
  readonly files: Map<string, FileBuilder>;
  readonly fileOrder: string[];
  readonly expandedExecutions: Set<string>;
  readonly executionNodes: Map<string, ProjectExecutionNode>;
  readonly executionEdges: ProjectExecutionEdge[];
  projectSourceLength: number;
  edgeCount: number;
  graphIncomplete: boolean;
  rootResolution: LatexProjectRootResolution | undefined;
  diagnosticLimitReported: boolean;
}

interface ProjectExecutionPathState {
  readonly rootDirectory: string;
  readonly importDirectory: string | undefined;
  readonly inputDirectories: readonly string[];
}

interface ProjectExecutionFlow {
  phase: "preamble" | "body" | "terminated";
}

interface ProjectExecutionNode {
  readonly uri: vscode.Uri;
  readonly role: LatexProjectFileRole;
  readonly pathState: ProjectExecutionPathState | undefined;
  readonly stripStandalonePreamble: boolean;
}

interface ProjectExecutionEdge {
  readonly sourceExecutionKey: string;
  readonly targetExecutionKey: string | undefined;
  readonly targetPathState: ProjectExecutionPathState | undefined;
  readonly edge: LatexProjectIncludeEdge;
}

type ProjectIncludeResolution =
  | {
      readonly ok: true;
      readonly uri: vscode.Uri;
      readonly projectPath: string;
      readonly nextPathState: ProjectExecutionPathState;
    }
  | {
      readonly ok: false;
      readonly reason: ProjectUriFailureReason;
    };

interface RootDecision {
  readonly uri: vscode.Uri | undefined;
  readonly resolution: LatexProjectRootResolution;
}

type ProjectUriFailureReason =
  | "outside-workspace"
  | "unsafe-path"
  | "workspace-escape"
  | "unsupported-extension";

type ProjectUriResolution =
  | { readonly ok: true; readonly uri: vscode.Uri; readonly projectPath: string }
  | {
      readonly ok: false;
      readonly reason: ProjectUriFailureReason;
    };

type VisitResult =
  | "resolved"
  | "missing"
  | "read-error"
  | "depth-limit"
  | "file-limit"
  | "source-limit";

const DEFAULT_SCANNER: LatexProjectSourceScanner = {
  scan: (source) => scanLatexProjectSource(source),
};

/**
 * Builds bounded, workspace-contained project snapshots. The provider is
 * expected to call `invalidate` from document/file/configuration listeners;
 * keeping listeners outside this class avoids duplicate workspace watchers.
 */
export class LatexProjectContextService implements vscode.Disposable {
  private readonly options: NormalizedOptions;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly sourceCache = new Map<string, SourceRecord>();
  private sourceCacheLength = 0;
  private readonly invalidationEmitter =
    new vscode.EventEmitter<LatexProjectContextInvalidation>();
  private epoch = 0;
  private revision = 1;
  private disposed = false;

  public readonly onDidInvalidate = this.invalidationEmitter.event;

  public constructor(options: LatexProjectContextServiceOptions = {}) {
    this.options = normalizeOptions(options);
  }

  /** Alias kept deliberately small for consumers that prefer resolver naming. */
  public resolveContext(
    resource: vscode.TextDocument | vscode.Uri,
  ): Promise<LatexProjectContext> {
    return this.getContext(resource);
  }

  public async getContext(
    resource: vscode.TextDocument | vscode.Uri,
  ): Promise<LatexProjectContext> {
    if (this.disposed) {
      throw new Error("The LaTeX project context service has been disposed.");
    }
    const document = isTextDocument(resource) ? resource : findOpenDocument(resource);
    const uri = isTextDocument(resource) ? resource.uri : resource;
    const key = uriKey(uri);
    const openDocumentVersion = document?.version;
    const cached = this.cache.get(key);
    if (
      cached !== undefined &&
      cached.epoch === this.epoch &&
      cached.openDocumentVersion === openDocumentVersion
    ) {
      return cached.promise;
    }

    if (cached !== undefined) {
      // A requested buffer changed even if the provider has not delivered its
      // listener callback yet. Invalidate every context because this file may
      // also be a dependency or a newly introduced reverse-include parent.
      this.invalidate(uri);
    }
    const epoch = this.epoch;
    const revision = this.revision;
    const promise = this.buildContext(uri, document, epoch, revision);
    const entry: CacheEntry = {
      epoch,
      openDocumentVersion,
      promise,
      contextId: undefined,
    };
    this.cache.set(key, entry);
    void promise.then(
      (context) => {
        if (this.cache.get(key) === entry) {
          entry.contextId = context.contextId;
        }
      },
      () => {
        if (this.cache.get(key) === entry) {
          this.cache.delete(key);
        }
      },
    );
    const context = await promise;
    if (epoch !== this.epoch) {
      return this.getContext(resource);
    }
    return context;
  }

  /**
   * Invalidating one resource clears snapshots globally. This is intentional:
   * a newly created or edited file can introduce a reverse include without
   * having appeared in the old dependency set.
   */
  public invalidate(resource?: vscode.Uri): void {
    if (this.disposed) {
      return;
    }
    const contextIds = [...new Set(
      [...this.cache.values()].flatMap((entry) =>
        entry.contextId === undefined ? [] : [entry.contextId]
      ),
    )];
    this.epoch += 1;
    this.revision += 1;
    this.cache.clear();
    if (resource === undefined) {
      this.sourceCache.clear();
      this.sourceCacheLength = 0;
    } else {
      this.deleteCachedSource(uriKey(resource));
    }
    this.invalidationEmitter.fire({
      resource,
      contextIds,
      revision: this.revision,
    });
  }

  public invalidateAll(): void {
    this.invalidate();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.epoch += 1;
    this.cache.clear();
    this.sourceCache.clear();
    this.sourceCacheLength = 0;
    this.invalidationEmitter.dispose();
  }

  private async buildContext(
    requestedUri: vscode.Uri,
    seedDocument: vscode.TextDocument | undefined,
    epoch: number,
    revision: number,
  ): Promise<LatexProjectContext> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(requestedUri);
    const state: BuildState = {
      epoch,
      revision,
      requestedUri,
      seedDocument,
      workspaceFolder,
      loads: new Map(),
      diagnostics: [],
      files: new Map(),
      fileOrder: [],
      expandedExecutions: new Set(),
      executionNodes: new Map(),
      executionEdges: [],
      projectSourceLength: 0,
      edgeCount: 0,
      graphIncomplete: false,
      rootResolution: undefined,
      diagnosticLimitReported: false,
    };

    const requestedRead = await this.readSource(state, requestedUri);
    if (!requestedRead.ok) {
      this.report(state, {
        code: requestedRead.reason,
        message: requestedRead.message,
        severity: "error",
        uri: requestedUri,
        range: undefined,
        relatedUri: undefined,
      }, true);
      return this.emptyContext(state, revision, requestedRead.reason);
    }

    const root = await this.resolveRoot(state, requestedRead.record);
    state.rootResolution = root.resolution;
    const graphRoot = root.uri ?? requestedUri;
    const graphRootRole: LatexProjectFileRole = root.uri === undefined
      ? "body"
      : "standalone";
    const graphRootPathState = this.initialExecutionPathState(state, graphRoot);
    const executionSeeds: ProjectExecutionNode[] = [{
      uri: graphRoot,
      role: graphRootRole,
      pathState: graphRootPathState,
      stripStandalonePreamble: false,
    }];
    const graphExecutionFlow: ProjectExecutionFlow = {
      phase: graphRootRole === "body" ? "body" : "preamble",
    };
    await this.visitProjectFile(
      state,
      graphRoot,
      graphRootRole,
      graphRootPathState,
      graphExecutionFlow,
      false,
      true,
      0,
      [],
    );

    // An invalid/ambiguous root still exposes the requested dirty buffer, but
    // does not pretend that it is an executable project root.
    if (!state.files.has(uriKey(requestedUri))) {
      if (root.uri !== undefined) {
        this.report(state, {
          code: "requested-file-not-reachable",
          message: "The selected project root does not reach the requested file through a literal include.",
          severity: "warning",
          uri: requestedUri,
          range: undefined,
          relatedUri: root.uri,
        }, true);
      }
      const requestedPathState = this.initialExecutionPathState(state, requestedUri);
      const requestedExecutionFlow: ProjectExecutionFlow = { phase: "body" };
      await this.visitProjectFile(
        state,
        requestedUri,
        "body",
        requestedPathState,
        requestedExecutionFlow,
        false,
        false,
        0,
        [],
      );
      executionSeeds.push({
        uri: requestedUri,
        role: "body",
        pathState: requestedPathState,
        stripStandalonePreamble: false,
      });
    }

    this.computeExecutionOccurrences(state, executionSeeds);
    const preambleSource = root.uri === undefined
      ? ""
      : this.assemblePreamble(
          state,
          root.uri,
          graphRootPathState,
          root.resolution !== "standalone",
        );
    const rootRead = root.uri === undefined
      ? requestedRead
      : await this.readSource(state, root.uri);
    const rootRecord = rootRead.ok ? rootRead.record : requestedRead.record;
    const languageSource = preambleSource.length > 0
      ? preambleSource
      : rootRecord.text;
    const rootLanguage = detectVisualDocumentLanguage(languageSource);
    let effectiveDocumentClass = rootRecord.scan.documentClass;
    if (effectiveDocumentClass === undefined && preambleSource.length > 0) {
      try {
        effectiveDocumentClass = this.options.scanner.scan(preambleSource).documentClass;
      } catch (error: unknown) {
        this.report(state, {
          code: "preamble-scan-error",
          message: `The expanded project preamble could not be scanned: ${safeErrorMessage(error)}`,
          severity: "warning",
          uri: root.uri,
          range: undefined,
          relatedUri: undefined,
        }, true);
      }
    }
    const documentClass = effectiveDocumentClass?.name.trim() || undefined;
    const numberingRoot = chapterNumberingClass(documentClass)
      ? "chapter" as const
      : "section" as const;
    const files = this.finishFiles(state);
    const requestedRole = files.find((file) => sameUri(file.uri, requestedUri))?.role ??
      (root.uri !== undefined && sameUri(root.uri, requestedUri) ? "standalone" : "body");
    const { labels, labelsByKey } = this.buildLabelIndex(
      state,
      files,
      root.uri !== undefined,
    );
    const workspaceUri = workspaceFolder?.uri;
    const contextId = projectContextId(
      workspaceUri,
      root.uri,
      requestedUri,
      root.resolution,
    );

    return {
      contextId,
      revision,
      requestedUri,
      requestedRole,
      workspaceUri,
      rootUri: root.uri,
      rootResolution: root.resolution,
      rootLanguage,
      numberingRoot,
      documentClass,
      preambleSource,
      files,
      labels,
      labelsByKey,
      diagnostics: state.diagnostics,
      graphIncomplete: state.graphIncomplete,
    };
  }

  private emptyContext(
    state: BuildState,
    revision: number,
    resolutionSalt: string,
  ): LatexProjectContext {
    return {
      contextId: projectContextId(
        state.workspaceFolder?.uri,
        undefined,
        state.requestedUri,
        `unresolved:${resolutionSalt}`,
      ),
      revision,
      requestedUri: state.requestedUri,
      requestedRole: "body",
      workspaceUri: state.workspaceFolder?.uri,
      rootUri: undefined,
      rootResolution: "unresolved",
      rootLanguage: "en",
      numberingRoot: "section",
      documentClass: undefined,
      preambleSource: "",
      files: [],
      labels: [],
      labelsByKey: new Map(),
      diagnostics: state.diagnostics,
      graphIncomplete: true,
    };
  }

  private async resolveRoot(
    state: BuildState,
    requested: SourceRecord,
  ): Promise<RootDecision> {
    let configuredRoot: string | undefined;
    try {
      configuredRoot = (await this.options.rootFileProvider(state.requestedUri))?.trim();
    } catch (error: unknown) {
      this.report(state, {
        code: "configured-root-read-error",
        message: `Could not read texleaf.project.rootFile: ${safeErrorMessage(error)}`,
        severity: "error",
        uri: state.requestedUri,
        range: undefined,
        relatedUri: undefined,
      }, true);
      return { uri: undefined, resolution: "invalid-configured" };
    }
    if (configuredRoot !== undefined && configuredRoot.length > 0) {
      const configured = this.resolveConfiguredRoot(state, configuredRoot);
      if (!configured.ok) {
        this.report(state, {
          code: "invalid-configured-root",
          message: rootResolutionFailureMessage(
            "The configured texleaf.project.rootFile",
            configured.reason,
          ),
          severity: "error",
          uri: state.requestedUri,
          range: undefined,
          relatedUri: undefined,
        }, true);
        return { uri: undefined, resolution: "invalid-configured" };
      }
      const exists = await this.readSource(state, configured.uri);
      if (!exists.ok) {
        this.report(state, {
          code: "missing-configured-root",
          message: `The configured project root could not be read: ${exists.message}`,
          severity: "error",
          uri: state.requestedUri,
          range: undefined,
          relatedUri: configured.uri,
        }, true);
        return { uri: undefined, resolution: "invalid-configured" };
      }
      return { uri: configured.uri, resolution: "configured" };
    }

    if (requested.scan.rootDirectives.length > 1) {
      this.report(state, {
        code: "ambiguous-magic-root",
        message: "Multiple TeX root directives were found; no root was guessed.",
        severity: "error",
        uri: requested.uri,
        range: requested.scan.rootDirectives[1]?.range,
        relatedUri: undefined,
      }, true);
      return { uri: undefined, resolution: "ambiguous" };
    }
    const directive = requested.scan.rootDirectives[0];
    if (directive !== undefined) {
      if (directive.normalizedPath === undefined) {
        this.report(state, {
          code: "invalid-magic-root",
          message: "The TeX root directive is not a literal project-relative path.",
          severity: "error",
          uri: requested.uri,
          range: directive.pathRange,
          relatedUri: undefined,
        }, true);
        return { uri: undefined, resolution: "invalid-magic" };
      }
      const magic = this.resolveSourceRequest(
        state,
        requested.uri,
        directive.normalizedPath,
      );
      if (!magic.ok) {
        this.report(state, {
          code: "invalid-magic-root",
          message: rootResolutionFailureMessage("The TeX root directive", magic.reason),
          severity: "error",
          uri: requested.uri,
          range: directive.pathRange,
          relatedUri: undefined,
        }, true);
        return { uri: undefined, resolution: "invalid-magic" };
      }
      const exists = await this.readSource(state, magic.uri);
      if (!exists.ok) {
        this.report(state, {
          code: "missing-magic-root",
          message: `The TeX root directive target could not be read: ${exists.message}`,
          severity: "error",
          uri: requested.uri,
          range: directive.pathRange,
          relatedUri: magic.uri,
        }, true);
        return { uri: undefined, resolution: "invalid-magic" };
      }
      return { uri: magic.uri, resolution: "magic" };
    }

    if (requested.scan.documentClass !== undefined) {
      if (requested.scan.documentClass.name.trim() === "subfiles") {
        const subfilesRoot = requested.scan.documentClass.options?.trim();
        if (subfilesRoot !== undefined && subfilesRoot.length > 0) {
          const resolved = this.resolveSourceRequest(
            state,
            requested.uri,
            subfilesRoot,
          );
          if (resolved.ok) {
            const exists = await this.readSource(state, resolved.uri);
            if (exists.ok) {
              return { uri: resolved.uri, resolution: "subfiles" };
            }
          }
          this.report(state, {
            code: "invalid-subfiles-root",
            message: "The subfiles document class does not name a readable literal main TeX file inside the workspace.",
            severity: "warning",
            uri: requested.uri,
            range: requested.scan.documentClass.optionsRange,
            relatedUri: resolved.ok ? resolved.uri : undefined,
          }, true);
          return { uri: undefined, resolution: "unresolved" };
        }
        this.report(state, {
          code: "invalid-subfiles-root",
          message: "The subfiles document class must name a readable literal main TeX file inside the workspace.",
          severity: "warning",
          uri: requested.uri,
          range: requested.scan.documentClass.range,
          relatedUri: undefined,
        }, true);
        return { uri: undefined, resolution: "unresolved" };
      }
      return { uri: requested.uri, resolution: "self" };
    }
    if (state.workspaceFolder === undefined) {
      return { uri: requested.uri, resolution: "standalone" };
    }
    return this.resolveReverseIncludeRoot(state, requested);
  }

  private resolveConfiguredRoot(
    state: BuildState,
    requestedPath: string,
  ): ProjectUriResolution {
    const workspaceUri = state.workspaceFolder?.uri;
    if (workspaceUri === undefined) {
      return { ok: false, reason: "outside-workspace" };
    }
    if (!isSafeLatexProjectRelativePath(requestedPath)) {
      return { ok: false, reason: "unsafe-path" };
    }
    const resolution = resolveLatexProjectPath(
      "__texleaf_project_root__.tex",
      requestedPath,
    );
    if (!resolution.ok) {
      return {
        ok: false,
        reason: resolution.reason === "workspace-escape"
          ? "workspace-escape"
          : "unsafe-path",
      };
    }
    if (!resolution.path.toLowerCase().endsWith(".tex")) {
      return { ok: false, reason: "unsupported-extension" };
    }
    return {
      ok: true,
      uri: vscode.Uri.joinPath(workspaceUri, ...resolution.path.split("/")),
      projectPath: resolution.path,
    };
  }

  private resolveSourceRequest(
    state: BuildState,
    containingUri: vscode.Uri,
    requestedPath: string,
  ): ProjectUriResolution {
    const workspaceUri = state.workspaceFolder?.uri;
    if (workspaceUri === undefined) {
      return { ok: false, reason: "outside-workspace" };
    }
    const containingPath = projectRelativeUriPath(workspaceUri, containingUri);
    if (containingPath === undefined) {
      return { ok: false, reason: "outside-workspace" };
    }
    const resolution = resolveLatexProjectPath(containingPath, requestedPath);
    if (!resolution.ok) {
      return {
        ok: false,
        reason: resolution.reason === "workspace-escape"
          ? "workspace-escape"
          : "unsafe-path",
      };
    }
    if (!resolution.path.toLowerCase().endsWith(".tex")) {
      return { ok: false, reason: "unsupported-extension" };
    }
    const uri = vscode.Uri.joinPath(workspaceUri, ...resolution.path.split("/"));
    return uriWithin(uri, workspaceUri)
      ? { ok: true, uri, projectPath: resolution.path }
      : { ok: false, reason: "workspace-escape" };
  }

  private initialExecutionPathState(
    state: BuildState,
    rootUri: vscode.Uri,
  ): ProjectExecutionPathState | undefined {
    const workspaceUri = state.workspaceFolder?.uri;
    if (workspaceUri === undefined) {
      return undefined;
    }
    const rootPath = projectRelativeUriPath(workspaceUri, rootUri);
    if (rootPath === undefined) {
      return undefined;
    }
    return {
      rootDirectory: projectPathDirectory(rootPath),
      importDirectory: undefined,
      inputDirectories: Object.freeze([]),
    };
  }

  private async resolveProjectIncludeRequest(
    state: BuildState,
    source: SourceRecord,
    include: LatexProjectInclude,
    pathState: ProjectExecutionPathState | undefined,
  ): Promise<ProjectIncludeResolution> {
    if (pathState === undefined || include.normalizedPath === undefined) {
      return { ok: false, reason: "outside-workspace" };
    }

    const selectFirstExisting = async (
      candidates: readonly {
        readonly resolution: ProjectUriResolution;
        readonly nextPathState: ProjectExecutionPathState;
      }[],
    ): Promise<ProjectIncludeResolution> => {
      let first: ProjectIncludeResolution | undefined;
      for (const candidate of candidates) {
        if (!candidate.resolution.ok) {
          // Search bases are ordered. Crossing the workspace boundary before a
          // known existing candidate means TeX may have selected an external
          // file, so a later in-workspace fallback must never be guessed.
          return { ok: false, reason: candidate.resolution.reason };
        }
        const resolved: ProjectIncludeResolution = {
          ok: true,
          uri: candidate.resolution.uri,
          projectPath: candidate.resolution.projectPath,
          nextPathState: candidate.nextPathState,
        };
        first ??= resolved;
        const read = await this.readSource(state, resolved.uri);
        if (read.ok || read.reason !== "missing") {
          return resolved;
        }
      }
      return first ?? { ok: false, reason: "unsafe-path" };
    };

    if (include.kind === "input" || include.kind === "include") {
      const directories = uniqueProjectPathDirectories([
        ...pathState.inputDirectories,
        pathState.rootDirectory,
      ]);
      return selectFirstExisting(directories.map((directory) => ({
        resolution: this.resolveSourceFromProjectDirectory(
          state,
          directory,
          include.normalizedPath!,
        ),
        nextPathState: pathState,
      })));
    }

    if (include.kind === "subfile") {
      const base = pathState.importDirectory ?? pathState.rootDirectory;
      const target = this.resolveSourceFromProjectDirectory(
        state,
        base,
        include.normalizedPath,
      );
      if (!target.ok) {
        return target;
      }
      const nextPathState = importedProjectExecutionPathState(
        pathState,
        projectPathDirectory(target.projectPath),
      );
      return selectFirstExisting([{ resolution: target, nextPathState }]);
    }

    const rawDirectory = include.directoryRawPath;
    if (rawDirectory === undefined) {
      return { ok: false, reason: "unsafe-path" };
    }
    const base = include.kind === "import"
      ? pathState.rootDirectory
      : pathState.importDirectory ?? pathState.rootDirectory;
    const importDirectory = this.resolveProjectDirectory(
      state,
      base,
      rawDirectory,
    );
    if (!importDirectory.ok) {
      return importDirectory;
    }
    const filename = source.text
      .slice(include.pathRange.start, include.pathRange.end)
      .trim();
    const target = this.resolveSourceFromProjectDirectory(
      state,
      importDirectory.projectPath,
      filename,
    );
    if (!target.ok) {
      return target;
    }
    const nextPathState = importedProjectExecutionPathState(
      pathState,
      importDirectory.projectPath,
    );
    return selectFirstExisting([{ resolution: target, nextPathState }]);
  }

  private resolveProjectDirectory(
    state: BuildState,
    baseDirectory: string,
    requestedDirectory: string,
  ): ProjectUriResolution {
    const markerRequest = joinProjectPath(
      requestedDirectory,
      "__texleaf_import_base__.tex",
    );
    const marker = this.resolveSourceFromProjectDirectory(
      state,
      baseDirectory,
      markerRequest,
    );
    if (!marker.ok) {
      return marker;
    }
    const projectPath = projectPathDirectory(marker.projectPath);
    const workspaceUri = state.workspaceFolder?.uri;
    return workspaceUri === undefined
      ? { ok: false, reason: "outside-workspace" }
      : {
          ok: true,
          uri: projectDirectoryUri(workspaceUri, projectPath),
          projectPath,
        };
  }

  private resolveSourceFromProjectDirectory(
    state: BuildState,
    baseDirectory: string,
    requestedPath: string,
  ): ProjectUriResolution {
    const workspaceUri = state.workspaceFolder?.uri;
    if (workspaceUri === undefined) {
      return { ok: false, reason: "outside-workspace" };
    }
    const containingPath = baseDirectory.length === 0
      ? "__texleaf_path_base__.tex"
      : `${baseDirectory}/__texleaf_path_base__.tex`;
    const resolution = resolveLatexProjectPath(containingPath, requestedPath);
    if (!resolution.ok) {
      return {
        ok: false,
        reason: resolution.reason === "workspace-escape"
          ? "workspace-escape"
          : "unsafe-path",
      };
    }
    if (!resolution.path.toLowerCase().endsWith(".tex")) {
      return { ok: false, reason: "unsupported-extension" };
    }
    const uri = vscode.Uri.joinPath(workspaceUri, ...resolution.path.split("/"));
    return uriWithin(uri, workspaceUri)
      ? { ok: true, uri, projectPath: resolution.path }
      : { ok: false, reason: "workspace-escape" };
  }

  private async resolveReverseIncludeRoot(
    state: BuildState,
    requested: SourceRecord,
  ): Promise<RootDecision> {
    const workspaceFolder = state.workspaceFolder;
    if (workspaceFolder === undefined) {
      return { uri: requested.uri, resolution: "standalone" };
    }
    let found: vscode.Uri[];
    let searchTruncated = false;
    try {
      found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceFolder, "**/*.tex"),
        ROOT_SEARCH_EXCLUDE,
        this.options.maxRootSearchFiles + 1,
      );
    } catch (error: unknown) {
      this.report(state, {
        code: "root-search-error",
        message: `Could not search the workspace for a project root: ${safeErrorMessage(error)}`,
        severity: "warning",
        uri: requested.uri,
        range: undefined,
        relatedUri: undefined,
      }, true);
      return { uri: undefined, resolution: "unresolved" };
    }

    const candidates = new Map<string, vscode.Uri>();
    for (const uri of found) {
      candidates.set(uriKey(uri), uri);
    }
    for (const document of vscode.workspace.textDocuments) {
      if (
        isTexUri(document.uri) &&
        uriWithin(document.uri, workspaceFolder.uri)
      ) {
        candidates.set(uriKey(document.uri), document.uri);
      }
    }
    candidates.set(uriKey(requested.uri), requested.uri);
    let candidateUris = [...candidates.values()].sort((left, right) =>
      uriKey(left).localeCompare(uriKey(right))
    );
    if (candidateUris.length > this.options.maxRootSearchFiles) {
      candidateUris = candidateUris.slice(0, this.options.maxRootSearchFiles);
      searchTruncated = true;
    }

    const records = new Map<string, SourceRecord>();
    let searchSourceLength = 0;
    let skippedFiles = 0;
    const batchSize = 24;
    for (let start = 0; start < candidateUris.length; start += batchSize) {
      const batch = candidateUris.slice(start, start + batchSize);
      const results = await Promise.all(batch.map(async (uri) => ({
        uri,
        read: await this.readSource(state, uri),
      })));
      for (const { uri, read } of results) {
        if (!read.ok) {
          skippedFiles += 1;
          continue;
        }
        if (
          read.record.scanError !== undefined ||
          read.record.text.length > this.options.maxRootSearchFileLength ||
          searchSourceLength + read.record.text.length >
            this.options.maxRootSearchTotalLength
        ) {
          skippedFiles += 1;
          continue;
        }
        searchSourceLength += read.record.text.length;
        const sourceKey = uriKey(uri);
        records.set(sourceKey, read.record);
      }
    }

    if (searchTruncated || skippedFiles > 0) {
      this.report(state, {
        code: "root-search-incomplete",
        message: searchTruncated
          ? `Reverse root search exceeded ${this.options.maxRootSearchFiles} TeX files; no root was guessed from incomplete results.`
          : `${skippedFiles} TeX file(s) could not be scanned during reverse root search; no root was guessed from incomplete results.`,
        severity: "warning",
        uri: requested.uri,
        range: undefined,
        relatedUri: undefined,
      }, true);
      return { uri: undefined, resolution: "unresolved" };
    }

    const documentRootCandidates = [...records.values()]
      .filter((record) => record.scan.documentClass !== undefined)
      .sort((left, right) => uriKey(left.uri).localeCompare(uriKey(right.uri)));
    const documentRoots: SourceRecord[] = [];
    const invalidSubfilesRoots = new Set<SourceRecord>();
    for (const candidate of documentRootCandidates) {
      const documentClass = candidate.scan.documentClass;
      if (documentClass?.name.trim() !== "subfiles") {
        documentRoots.push(candidate);
        continue;
      }
      const declaredRoot = documentClass.options?.trim();
      if (declaredRoot !== undefined && declaredRoot.length > 0) {
        const resolved = this.resolveSourceRequest(state, candidate.uri, declaredRoot);
        if (resolved.ok) {
          const read = await this.readSource(state, resolved.uri);
          if (read.ok) {
            // A subfiles child is a standalone compilation entry point, but its
            // literal class option explicitly canonicalizes project semantics
            // to the declared main file. Treating both as independent reverse
            // roots would make every transitive child fragment ambiguous.
            continue;
          }
        }
      }
      // Keep an invalid declaration only as a conservative uncertainty probe:
      // if it can reach the requested fragment, root discovery must fail closed
      // instead of silently treating that fragment as standalone.
      invalidSubfilesRoots.add(candidate);
    }
    const matchingRoots: SourceRecord[] = [];
    let candidateSearchIncomplete = false;
    for (const candidate of [...documentRoots, ...invalidSubfilesRoots]) {
      const result = await this.reverseCandidateReachesRequested(
        state,
        candidate,
        requested.uri,
        records,
      );
      if (invalidSubfilesRoots.has(candidate)) {
        if (result.reachesRequested || !result.complete) {
          candidateSearchIncomplete = true;
        }
        continue;
      }
      if (result.reachesRequested && result.complete) {
        matchingRoots.push(candidate);
      }
      if (!result.complete) {
        candidateSearchIncomplete = true;
      }
    }

    if (matchingRoots.length > 1) {
      for (const candidate of matchingRoots.slice(0, 8)) {
        this.report(state, {
          code: "ambiguous-root-candidate",
          message: "This file is reachable from more than one project root candidate.",
          severity: "warning",
          uri: requested.uri,
          range: undefined,
          relatedUri: candidate.uri,
        }, true);
      }
      return { uri: undefined, resolution: "ambiguous" };
    }
    if (candidateSearchIncomplete) {
      this.report(state, {
        code: "root-search-incomplete",
        message: "Candidate-specific forward root search reached an unsupported or bounded dependency; no unique root was guessed.",
        severity: "warning",
        uri: requested.uri,
        range: undefined,
        relatedUri: matchingRoots[0]?.uri,
      }, true);
      return { uri: undefined, resolution: "unresolved" };
    }
    if (matchingRoots.length === 1) {
      return {
        uri: matchingRoots[0]!.uri,
        resolution: "reverse-include",
      };
    }
    return { uri: requested.uri, resolution: "standalone" };
  }

  private async reverseCandidateReachesRequested(
    state: BuildState,
    root: SourceRecord,
    requestedUri: vscode.Uri,
    records: ReadonlyMap<string, SourceRecord>,
  ): Promise<{
    readonly reachesRequested: boolean;
    readonly complete: boolean;
  }> {
    const rootPathState = this.initialExecutionPathState(state, root.uri);
    if (rootPathState === undefined) {
      return { reachesRequested: false, complete: false };
    }
    const requestedKey = uriKey(requestedUri);
    if (uriKey(root.uri) === requestedKey) {
      return { reachesRequested: true, complete: true };
    }

    interface ReverseExecutionFrame {
      readonly record: SourceRecord;
      readonly pathState: ProjectExecutionPathState;
      readonly role: LatexProjectFileRole;
      readonly stripStandalonePreamble: boolean;
      readonly depth: number;
    }

    // Root discovery must replay the same ordered execution semantics as the
    // forward graph. In particular, a complete document included from a
    // wrapper can move the shared flow to `terminated`; a later sibling input
    // is then inert and must not make that wrapper look like a candidate root.
    const flow: ProjectExecutionFlow = { phase: "preamble" };
    const expanded = new Set<string>();
    let traversedEdges = 0;
    let complete = true;
    const visit = async (
      current: ReverseExecutionFrame,
      ancestry: readonly string[],
    ): Promise<boolean> => {
      const executionKey = projectExecutionNodeKey(
        current.record.uri,
        current.role,
        current.pathState,
        current.stripStandalonePreamble,
      );
      if (expanded.has(executionKey)) {
        return false;
      }
      expanded.add(executionKey);

      // An incomplete record only makes candidates that actually traverse it
      // uncertain. It must not veto root discovery merely because some
      // unrelated TeX test/example elsewhere in the workspace uses a dynamic
      // conditional.
      if (
        current.record.scanError !== undefined ||
        current.record.scan.graphIncomplete
      ) {
        complete = false;
      }

      if (current.depth >= this.options.maxDepth) {
        const hasExecutableInclude = current.record.scan.includes.some((include) =>
          include.phase !== "after-document" &&
          !(
            current.stripStandalonePreamble &&
            current.record.scan.beginDocument !== undefined &&
            include.phase === "preamble"
          )
        );
        complete &&= !hasExecutableInclude;
        return false;
      }

      for (const include of current.record.scan.includes) {
        if (
          current.stripStandalonePreamble &&
          current.record.scan.beginDocument !== undefined &&
          include.phase === "preamble"
        ) {
          continue;
        }
        if (
          current.role !== "body" &&
          flow.phase === "preamble" &&
          include.phase === "body"
        ) {
          flow.phase = "body";
        }
        const targetRole: LatexProjectFileRole = flow.phase === "preamble"
          ? effectiveIncludedRole(current.role, include.phase)
          : "body";
        if (flow.phase === "terminated" || include.phase === "after-document") {
          continue;
        }
        if (traversedEdges >= this.options.maxEdges) {
          complete = false;
          return false;
        }
        traversedEdges += 1;
        if (include.normalizedPath === undefined) {
          complete = false;
          continue;
        }
        const resolved = await this.resolveProjectIncludeRequest(
          state,
          current.record,
          include,
          current.pathState,
        );
        if (!resolved.ok) {
          complete = false;
          continue;
        }
        const targetKey = uriKey(resolved.uri);
        const targetStripStandalonePreamble = include.kind === "subfile" &&
          targetRole === "body";
        const targetExecutionKey = projectExecutionNodeKey(
          resolved.uri,
          targetRole,
          resolved.nextPathState,
          targetStripStandalonePreamble,
        );
        if (ancestry.includes(targetExecutionKey)) {
          complete = false;
          continue;
        }
        if (targetKey === requestedKey) {
          return true;
        }
        const target = records.get(targetKey);
        if (target === undefined) {
          const read = await this.readSource(state, resolved.uri);
          if (read.ok || read.reason !== "missing") {
            complete = false;
          }
          continue;
        }
        if (await visit({
          record: target,
          pathState: resolved.nextPathState,
          role: targetRole,
          stripStandalonePreamble: targetStripStandalonePreamble,
          depth: current.depth + 1,
        }, [...ancestry, executionKey])) {
          return true;
        }
      }
      if (current.role !== "body") {
        if (current.record.scan.endDocument !== undefined) {
          flow.phase = "terminated";
        } else if (
          current.record.scan.beginDocument !== undefined &&
          flow.phase === "preamble"
        ) {
          flow.phase = "body";
        }
      }
      return false;
    };

    const reachesRequested = await visit({
      record: root,
      pathState: rootPathState,
      role: "standalone",
      stripStandalonePreamble: false,
      depth: 0,
    }, []);
    return { reachesRequested, complete };
  }

  private async visitProjectFile(
    state: BuildState,
    uri: vscode.Uri,
    role: LatexProjectFileRole,
    pathState: ProjectExecutionPathState | undefined,
    flow: ProjectExecutionFlow,
    stripStandalonePreamble: boolean,
    reachableFromRoot: boolean,
    depth: number,
    ancestry: readonly string[],
  ): Promise<VisitResult> {
    const key = uriKey(uri);
    const read = await this.readSource(state, uri);
    if (!read.ok) {
      return read.reason === "missing" ? "missing" : "read-error";
    }
    let file = state.files.get(key);
    if (file === undefined) {
      if (state.files.size >= this.options.maxFiles) {
        this.report(state, {
          code: "file-limit",
          message: `The project exceeded ${this.options.maxFiles} reachable TeX files.`,
          severity: "warning",
          uri,
          range: undefined,
          relatedUri: undefined,
        }, true);
        return "file-limit";
      }
      const exceedsSourceLimit = state.projectSourceLength + read.record.text.length >
        this.options.maxTotalSourceLength;
      const requiredForCurrentContext = state.files.size === 0 ||
        sameUri(uri, state.requestedUri);
      if (exceedsSourceLimit && !requiredForCurrentContext) {
        this.report(state, {
          code: "source-limit",
          message: `The project exceeded ${this.options.maxTotalSourceLength} UTF-16 source code units.`,
          severity: "warning",
          uri,
          range: undefined,
          relatedUri: undefined,
        }, true);
        return "source-limit";
      }
      state.projectSourceLength += read.record.text.length;
      file = {
        record: read.record,
        roles: new Set(),
        includes: [],
        texOrder: state.fileOrder.length,
        expansionAllowed: !exceedsSourceLimit,
        reachableFromRoot,
        occurrenceCount: 1,
      };
      state.files.set(key, file);
      state.fileOrder.push(key);
      if (read.record.scanError !== undefined) {
        this.report(state, {
          code: "scanner-error",
          message: read.record.scanError,
          severity: "error",
          uri,
          range: undefined,
          relatedUri: undefined,
        }, true);
      }
      for (const diagnostic of read.record.scan.diagnostics) {
        this.report(state, {
          code: `source:${diagnostic.code}`,
          message: diagnostic.message,
          severity: "warning",
          uri,
          range: diagnostic.range,
          relatedUri: undefined,
        }, sourceDiagnosticAffectsResolvedProjectGraph(
          diagnostic.code,
          state.rootResolution,
        ));
      }
      if (sourceScanRemainsIncompleteForResolvedProject(
        read.record.scan,
        state.rootResolution,
      )) {
        state.graphIncomplete = true;
      }
      if (exceedsSourceLimit) {
        this.report(state, {
          code: "source-limit",
          message: `The required TeX file is exposed, but project expansion stopped at the ${this.options.maxTotalSourceLength} UTF-16 source limit.`,
          severity: "warning",
          uri,
          range: undefined,
          relatedUri: undefined,
        }, true);
      }
    }
    file.reachableFromRoot ||= reachableFromRoot;
    file.roles.add(role);
    // Wrapper roots sometimes \input a complete document from their preamble,
    // and subfiles children contain their own document wrapper. Preserve the
    // include occurrence role for preamble expansion while exposing the
    // physical document body as standalone for Visual Editor and label ranges.
    if (read.record.scan.beginDocument !== undefined) {
      file.roles.add("standalone");
    }
    const executionKey = projectExecutionNodeKey(
      uri,
      role,
      pathState,
      stripStandalonePreamble,
    );
    state.executionNodes.set(executionKey, {
      uri,
      role,
      pathState,
      stripStandalonePreamble,
    });
    if (!file.expansionAllowed) {
      return "source-limit";
    }

    if (depth >= this.options.maxDepth) {
      this.report(state, {
        code: "depth-limit",
        message: `The include graph exceeded depth ${this.options.maxDepth}.`,
        severity: "warning",
        uri,
        range: undefined,
        relatedUri: undefined,
      }, true);
      return "depth-limit";
    }
    if (state.expandedExecutions.has(executionKey)) {
      return "resolved";
    }
    state.expandedExecutions.add(executionKey);

    const nextAncestry = [...ancestry, executionKey];
    for (const include of read.record.scan.includes) {
      if (state.edgeCount >= this.options.maxEdges) {
        this.report(state, {
          code: "edge-limit",
          message: `The project exceeded ${this.options.maxEdges} include edges.`,
          severity: "warning",
          uri,
          range: include.range,
          relatedUri: undefined,
        }, true);
        break;
      }
      state.edgeCount += 1;
      if (
        stripStandalonePreamble &&
        read.record.scan.beginDocument !== undefined &&
        include.phase === "preamble"
      ) {
        file.includes.push(projectEdge(
          uri,
          role,
          "body",
          include,
          undefined,
          "ignored-standalone-preamble",
        ));
        continue;
      }
      if (
        role !== "body" &&
        flow.phase === "preamble" &&
        include.phase === "body"
      ) {
        flow.phase = "body";
      }
      const targetRole: LatexProjectFileRole = flow.phase === "preamble"
        ? effectiveIncludedRole(role, include.phase)
        : "body";
      if (flow.phase === "terminated" || include.phase === "after-document") {
        file.includes.push(projectEdge(
          uri,
          role,
          targetRole,
          include,
          undefined,
          "ignored-after-document",
        ));
        continue;
      }
      if (include.normalizedPath === undefined) {
        file.includes.push(projectEdge(
          uri,
          role,
          targetRole,
          include,
          undefined,
          "dynamic",
        ));
        this.report(state, {
          code: "dynamic-include",
          message: `The \\${include.kind} target is dynamic or unsafe and was not followed.`,
          severity: "warning",
          uri,
          range: include.pathRange,
          relatedUri: undefined,
        }, true);
        continue;
      }
      const resolved = await this.resolveProjectIncludeRequest(
        state,
        read.record,
        include,
        pathState,
      );
      if (!resolved.ok) {
        const status: LatexProjectIncludeStatus = resolved.reason === "outside-workspace" ||
          resolved.reason === "workspace-escape"
          ? "outside-workspace"
          : "unsupported";
        file.includes.push(projectEdge(
          uri,
          role,
          targetRole,
          include,
          undefined,
          status,
        ));
        this.report(state, {
          code: status,
          message: rootResolutionFailureMessage("The include", resolved.reason),
          severity: "warning",
          uri,
          range: include.pathRange,
          relatedUri: undefined,
        }, true);
        continue;
      }
      const targetStripStandalonePreamble = include.kind === "subfile" &&
        targetRole === "body";
      const targetExecutionKey = projectExecutionNodeKey(
        resolved.uri,
        targetRole,
        resolved.nextPathState,
        targetStripStandalonePreamble,
      );
      if (nextAncestry.includes(targetExecutionKey)) {
        const edge = projectEdge(
          uri,
          role,
          targetRole,
          include,
          resolved.uri,
          "cycle",
        );
        file.includes.push(edge);
        state.executionEdges.push({
          sourceExecutionKey: executionKey,
          targetExecutionKey,
          targetPathState: resolved.nextPathState,
          edge,
        });
        this.report(state, {
          code: "include-cycle",
          message: "A cycle was detected in the TeX include graph.",
          severity: "warning",
          uri,
          range: include.range,
          relatedUri: resolved.uri,
        }, true);
        continue;
      }
      const visit = await this.visitProjectFile(
        state,
        resolved.uri,
        targetRole,
        resolved.nextPathState,
        flow,
        targetStripStandalonePreamble,
        reachableFromRoot,
        depth + 1,
        nextAncestry,
      );
      const status = visitStatus(visit);
      const edge = projectEdge(
        uri,
        role,
        targetRole,
        include,
        resolved.uri,
        status,
      );
      file.includes.push(edge);
      state.executionEdges.push({
        sourceExecutionKey: executionKey,
        targetExecutionKey,
        targetPathState: resolved.nextPathState,
        edge,
      });
      if (visit === "missing" || visit === "read-error") {
        this.report(state, {
          code: visit === "missing" ? "missing-include" : "include-read-error",
          message: visit === "missing"
            ? "The literal TeX include target does not exist."
            : "The literal TeX include target could not be read.",
          severity: "warning",
          uri,
          range: include.pathRange,
          relatedUri: resolved.uri,
        }, true);
      }
    }
    if (role !== "body") {
      if (read.record.scan.endDocument !== undefined) {
        flow.phase = "terminated";
      } else if (
        read.record.scan.beginDocument !== undefined &&
        flow.phase === "preamble"
      ) {
        flow.phase = "body";
      }
    }
    return "resolved";
  }

  private assemblePreamble(
    state: BuildState,
    rootUri: vscode.Uri,
    rootPathState: ProjectExecutionPathState | undefined,
    allowWrapperRoot: boolean,
  ): string {
    const root = state.files.get(uriKey(rootUri));
    if (root === undefined) {
      return "";
    }
    if (
      root.record.scan.documentClass === undefined &&
      root.record.scan.beginDocument === undefined &&
      !allowWrapperRoot
    ) {
      return "";
    }
    const chunks: string[] = [];
    let length = 0;
    let truncated = false;
    let documentStarted = false;
    const append = (value: string): void => {
      if (value.length === 0 || truncated) {
        return;
      }
      const available = this.options.maxPreambleLength - length;
      if (available <= 0) {
        truncated = true;
        return;
      }
      const next = value.slice(0, available);
      chunks.push(next);
      length += next.length;
      if (next.length < value.length) {
        truncated = true;
      }
    };
    const expand = (
      uri: vscode.Uri,
      pathState: ProjectExecutionPathState | undefined,
      depth: number,
      ancestry: readonly string[],
    ): void => {
      if (depth > this.options.maxDepth || truncated || documentStarted) {
        return;
      }
      const key = uriKey(uri);
      const sourceRole: LatexProjectFileRole = depth === 0
        ? "standalone"
        : "preamble";
      const executionKey = projectExecutionNodeKey(
        uri,
        sourceRole,
        pathState,
        false,
      );
      if (ancestry.includes(executionKey)) {
        return;
      }
      const file = state.files.get(key);
      if (file === undefined || !file.roles.has(depth === 0 ? "standalone" : "preamble")) {
        return;
      }
      const text = file.record.text;
      const limit = Math.min(
        text.length,
        file.record.scan.beginDocument?.start ?? text.length,
        file.record.scan.endInput?.start ?? text.length,
      );
      const includes = file.record.scan.includes
        .filter((include) =>
          include.phase === "preamble" &&
          include.range.start < limit
        )
        .sort((left, right) => left.range.start - right.range.start);
      let cursor = 0;
      for (const include of includes) {
        if (include.range.start < cursor || include.range.end > limit) {
          continue;
        }
        append(text.slice(cursor, include.range.start));
        const executionEdge = state.executionEdges.find((candidate) =>
          candidate.sourceExecutionKey === executionKey &&
          candidate.edge.range.start === include.range.start &&
          candidate.edge.range.end === include.range.end
        );
        const edge = executionEdge?.edge;
        if (
          include.normalizedPath === undefined ||
          edge?.status !== "resolved" ||
          edge.targetUri === undefined
        ) {
          append(text.slice(include.range.start, include.range.end));
          cursor = include.range.end;
          continue;
        }
        if (!state.files.get(uriKey(edge.targetUri))?.roles.has("preamble")) {
          append(text.slice(include.range.start, include.range.end));
          cursor = include.range.end;
          continue;
        }
        append("\n");
        expand(
          edge.targetUri,
          executionEdge?.targetPathState,
          depth + 1,
          [...ancestry, executionKey],
        );
        if (documentStarted) {
          return;
        }
        append("\n");
        cursor = include.range.end;
      }
      append(text.slice(cursor, limit));
      if (file.record.scan.beginDocument !== undefined) {
        documentStarted = true;
      }
    };
    expand(rootUri, rootPathState, 0, []);
    if (truncated) {
      this.report(state, {
        code: "preamble-limit",
        message: `Expanded preamble exceeded ${this.options.maxPreambleLength} UTF-16 source code units.`,
        severity: "warning",
        uri: rootUri,
        range: undefined,
        relatedUri: undefined,
      }, true);
    }
    return chunks.join("");
  }

  private finishFiles(state: BuildState): readonly LatexProjectFile[] {
    return state.fileOrder.flatMap((key) => {
      const file = state.files.get(key);
      if (file === undefined) {
        return [];
      }
      const roles = orderedRoles(file.roles);
      return [{
        uri: file.record.uri,
        text: file.record.text,
        contentRevision: file.record.contentRevision,
        documentVersion: file.record.documentVersion,
        dirty: file.record.dirty,
        sourceKind: file.record.sourceKind,
        reachableFromRoot: file.reachableFromRoot,
        role: preferredRole(roles),
        roles,
        occurrenceCount: file.occurrenceCount,
        texOrder: file.texOrder,
        sourceScan: file.record.scan,
        includes: file.includes,
      }];
    });
  }

  private computeExecutionOccurrences(
    state: BuildState,
    seeds: readonly ProjectExecutionNode[],
  ): void {
    const seedCounts = new Map<string, 1 | 2>();
    for (const seed of seeds) {
      const key = projectExecutionNodeKey(
        seed.uri,
        seed.role,
        seed.pathState,
        seed.stripStandalonePreamble,
      );
      seedCounts.set(key, saturatedOccurrence((seedCounts.get(key) ?? 0) + 1));
    }
    const nodes = [...state.executionNodes.keys()];
    let counts = new Map<string, 1 | 2>(seedCounts);
    const maximumIterations = Math.max(1, nodes.length * 2 + 1);
    for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
      const next = new Map<string, 1 | 2>(seedCounts);
      for (const executionEdge of state.executionEdges) {
        if (
          executionEdge.targetExecutionKey === undefined ||
          !includeStatusExecutesTarget(executionEdge.edge.status)
        ) {
          continue;
        }
        const sourceCount = counts.get(executionEdge.sourceExecutionKey) ?? 0;
        if (sourceCount === 0) {
          continue;
        }
        const targetKey = executionEdge.targetExecutionKey;
        next.set(targetKey, saturatedOccurrence(
          (next.get(targetKey) ?? 0) + sourceCount,
        ));
      }
      if (sameOccurrenceCounts(counts, next)) {
        counts = next;
        break;
      }
      counts = next;
    }
    for (const file of state.files.values()) {
      let occurrences = 0;
      for (const [nodeKey, node] of state.executionNodes) {
        if (sameUri(node.uri, file.record.uri)) {
          occurrences += counts.get(nodeKey) ?? 0;
        }
      }
      file.occurrenceCount = saturatedOccurrence(Math.max(1, occurrences));
    }
  }

  private buildLabelIndex(
    state: BuildState,
    files: readonly LatexProjectFile[],
    authoritativeProjectOnly: boolean,
  ): {
    readonly labels: readonly LatexProjectLabelTarget[];
    readonly labelsByKey: ReadonlyMap<string, readonly LatexProjectLabelTarget[]>;
  } {
    const labels: LatexProjectLabelTarget[] = [];
    let limited = false;
    for (const file of files) {
      if (authoritativeProjectOnly && !file.reachableFromRoot) {
        continue;
      }
      const remaining = this.options.maxLabels - labels.length;
      if (remaining <= 0) {
        limited = true;
        break;
      }
      const labelRange = executableLabelRange(file);
      if (labelRange === undefined) {
        continue;
      }
      const targets = allVisualLabels(
        file.text.slice(0, this.options.maxTotalSourceLength),
        remaining,
        labelRange.from,
        labelRange.to,
      );
      for (const target of targets) {
        labels.push(projectLabel(file, target));
      }
      if (targets.length >= remaining) {
        limited = true;
        break;
      }
    }
    if (limited) {
      this.report(state, {
        code: "label-limit",
        message: `The project label index was truncated at ${this.options.maxLabels} labels.`,
        severity: "warning",
        uri: state.requestedUri,
        range: undefined,
        relatedUri: undefined,
      }, true);
    }
    const mutableByKey = new Map<string, LatexProjectLabelTarget[]>();
    for (const label of labels) {
      const targets = mutableByKey.get(label.key) ?? [];
      targets.push(label);
      mutableByKey.set(label.key, targets);
    }
    const labelsByKey = new Map<string, readonly LatexProjectLabelTarget[]>(
      [...mutableByKey].map(([key, targets]) => [key, targets]),
    );
    return { labels, labelsByKey };
  }

  private readSource(
    state: BuildState,
    uri: vscode.Uri,
  ): Promise<SourceReadResult> {
    const key = uriKey(uri);
    const cached = state.loads.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const pending = this.readSourceUncached(state, uri);
    state.loads.set(key, pending);
    return pending;
  }

  private async readSourceUncached(
    state: BuildState,
    uri: vscode.Uri,
  ): Promise<SourceReadResult> {
    const document = state.seedDocument !== undefined && sameUri(state.seedDocument.uri, uri)
      ? state.seedDocument
      : findOpenDocument(uri);
    const cached = this.sourceCache.get(uriKey(uri));
    if (
      cached !== undefined &&
      (
        (document === undefined && cached.sourceKind === "workspace-fs") ||
        (
          document !== undefined &&
          cached.sourceKind === "open-document" &&
          cached.documentVersion === document.version
        )
      )
    ) {
      return { ok: true, record: cached };
    }
    let text: string;
    let documentVersion: number | undefined;
    let dirty = false;
    let sourceKind: "open-document" | "workspace-fs";
    if (document !== undefined) {
      text = document.getText();
      documentVersion = document.version;
      dirty = document.isDirty;
      sourceKind = "open-document";
    } else {
      let bytes: Uint8Array;
      try {
        bytes = await vscode.workspace.fs.readFile(uri);
      } catch (error: unknown) {
        if (isFileNotFound(error)) {
          return {
            ok: false,
            reason: "missing",
            message: "The file does not exist.",
          };
        }
        return {
          ok: false,
          reason: "read-error",
          message: safeErrorMessage(error),
        };
      }
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (error: unknown) {
        return {
          ok: false,
          reason: "decode-error",
          message: `The file is not valid UTF-8: ${safeErrorMessage(error)}`,
        };
      }
      documentVersion = undefined;
      sourceKind = "workspace-fs";
    }

    // Project scans feed visual structures, labels and cross-file navigation.
    // Normalize once here so every project range shares CodeMirror's one-LF
    // coordinate space, regardless of how each physical file stores EOLs.
    text = normalizeVisualText(text);

    let scan: LatexProjectSourceScan;
    let scanError: string | undefined;
    try {
      scan = this.options.scanner.scan(text);
    } catch (error: unknown) {
      scanError = `The TeX project scanner failed: ${safeErrorMessage(error)}`;
      scan = emptySourceScan();
    }
    const record: SourceRecord = {
      uri,
      text,
      contentRevision: contentRevision(text, documentVersion),
      documentVersion,
      dirty,
      sourceKind,
      scan,
      scanError,
    };
    // A stale build may finish I/O after invalidate() has started a newer
    // generation. Its local record is still usable by that build, but must
    // never overwrite the shared source cache observed by the newer build.
    if (state.epoch === this.epoch && state.revision === this.revision) {
      this.cacheSourceRecord(record);
    }
    return {
      ok: true,
      record,
    };
  }

  private report(
    state: BuildState,
    diagnostic: LatexProjectContextDiagnostic,
    incomplete: boolean,
  ): void {
    if (incomplete) {
      state.graphIncomplete = true;
    }
    if (state.diagnostics.length < this.options.maxDiagnostics) {
      state.diagnostics.push(diagnostic);
      return;
    }
    state.graphIncomplete = true;
    if (!state.diagnosticLimitReported && state.diagnostics.length > 0) {
      state.diagnosticLimitReported = true;
      state.diagnostics[state.diagnostics.length - 1] = {
        code: "diagnostic-limit",
        message: `Project diagnostics were truncated at ${this.options.maxDiagnostics} entries.`,
        severity: "warning",
        uri: state.requestedUri,
        range: undefined,
        relatedUri: undefined,
      };
    }
  }

  private cacheSourceRecord(record: SourceRecord): void {
    if (record.text.length > this.options.maxRootSearchFileLength) {
      return;
    }
    const key = uriKey(record.uri);
    this.deleteCachedSource(key);
    while (
      this.sourceCache.size > 0 &&
      this.sourceCacheLength + record.text.length >
        this.options.maxRootSearchTotalLength
    ) {
      const oldestKey = this.sourceCache.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        break;
      }
      this.deleteCachedSource(oldestKey);
    }
    this.sourceCache.set(key, record);
    this.sourceCacheLength += record.text.length;
  }

  private deleteCachedSource(key: string): void {
    const cached = this.sourceCache.get(key);
    if (cached === undefined) {
      return;
    }
    this.sourceCache.delete(key);
    this.sourceCacheLength = Math.max(0, this.sourceCacheLength - cached.text.length);
  }
}

function normalizeOptions(
  options: LatexProjectContextServiceOptions,
): NormalizedOptions {
  return {
    scanner: options.scanner ?? DEFAULT_SCANNER,
    rootFileProvider: options.rootFileProvider ?? ((resource) =>
      vscode.workspace
        .getConfiguration("texleaf.project", resource)
        .get<string>("rootFile")),
    maxDepth: boundedLimit(options.maxDepth, DEFAULT_MAX_DEPTH, 128),
    maxFiles: boundedLimit(options.maxFiles, DEFAULT_MAX_FILES, 2_048),
    maxEdges: boundedLimit(options.maxEdges, DEFAULT_MAX_EDGES, 16_384),
    maxTotalSourceLength: boundedLimit(
      options.maxTotalSourceLength,
      DEFAULT_MAX_TOTAL_SOURCE_LENGTH,
      64_000_000,
    ),
    maxPreambleLength: boundedLimit(
      options.maxPreambleLength,
      DEFAULT_MAX_PREAMBLE_LENGTH,
      8_000_000,
    ),
    maxLabels: boundedLimit(options.maxLabels, DEFAULT_MAX_LABELS, 65_536),
    maxRootSearchFiles: boundedLimit(
      options.maxRootSearchFiles,
      DEFAULT_MAX_ROOT_SEARCH_FILES,
      4_096,
    ),
    maxRootSearchFileLength: boundedLimit(
      options.maxRootSearchFileLength,
      DEFAULT_MAX_ROOT_SEARCH_FILE_LENGTH,
      8_000_000,
    ),
    maxRootSearchTotalLength: boundedLimit(
      options.maxRootSearchTotalLength,
      DEFAULT_MAX_ROOT_SEARCH_TOTAL_LENGTH,
      128_000_000,
    ),
    maxDiagnostics: boundedLimit(
      options.maxDiagnostics,
      DEFAULT_MAX_DIAGNOSTICS,
      2_048,
    ),
  };
}

function projectEdge(
  sourceUri: vscode.Uri,
  sourceRole: LatexProjectFileRole,
  targetRole: LatexProjectFileRole,
  include: LatexProjectInclude,
  targetUri: vscode.Uri | undefined,
  status: LatexProjectIncludeStatus,
): LatexProjectIncludeEdge {
  return {
    kind: include.kind,
    phase: include.phase,
    sourceRole,
    targetRole,
    sourceUri,
    targetUri,
    rawPath: include.rawPath,
    range: include.range,
    commandRange: include.commandRange,
    pathRange: include.pathRange,
    status,
  };
}

function effectiveIncludedRole(
  parentRole: LatexProjectFileRole,
  phase: LatexProjectPhase,
): LatexProjectFileRole {
  if (parentRole === "body") {
    return "body";
  }
  return phase === "preamble" ? "preamble" : "body";
}

function visitStatus(result: VisitResult): LatexProjectIncludeStatus {
  switch (result) {
    case "resolved":
      return "resolved";
    case "missing":
      return "missing";
    case "read-error":
      return "read-error";
    case "depth-limit":
      return "depth-limit";
    case "file-limit":
      return "file-limit";
    case "source-limit":
      return "source-limit";
  }
}

function includeStatusExecutesTarget(status: LatexProjectIncludeStatus): boolean {
  return status === "resolved" ||
    status === "cycle" ||
    status === "depth-limit" ||
    status === "source-limit";
}

function projectExecutionNodeKey(
  uri: vscode.Uri,
  role: LatexProjectFileRole,
  pathState: ProjectExecutionPathState | undefined,
  stripStandalonePreamble: boolean,
): string {
  const pathKey = pathState === undefined
    ? "<no-project-path>"
    : JSON.stringify([
        pathState.rootDirectory,
        pathState.importDirectory ?? null,
        ...pathState.inputDirectories,
      ]);
  const sourceMode = stripStandalonePreamble ? "body-only" : "complete-source";
  return `${uriKey(uri)}\u0000${role}\u0000${sourceMode}\u0000${pathKey}`;
}

function importedProjectExecutionPathState(
  previous: ProjectExecutionPathState,
  importDirectory: string,
): ProjectExecutionPathState {
  return {
    rootDirectory: previous.rootDirectory,
    importDirectory,
    inputDirectories: Object.freeze(uniqueProjectPathDirectories([
      importDirectory,
      ...previous.inputDirectories,
    ])),
  };
}

function uniqueProjectPathDirectories(
  directories: readonly string[],
): readonly string[] {
  return [...new Set(directories)];
}

function projectPathDirectory(projectPath: string): string {
  const slash = projectPath.lastIndexOf("/");
  return slash < 0 ? "" : projectPath.slice(0, slash);
}

function joinProjectPath(directory: string, filename: string): string {
  const left = directory.replace(/\/+$/u, "");
  const right = filename.replace(/^\/+/u, "");
  return left.length === 0 ? right : `${left}/${right}`;
}

function projectDirectoryUri(
  workspaceUri: vscode.Uri,
  projectDirectory: string,
): vscode.Uri {
  return projectDirectory.length === 0
    ? workspaceUri
    : vscode.Uri.joinPath(workspaceUri, ...projectDirectory.split("/"));
}

function saturatedOccurrence(value: number): 1 | 2 {
  return value > 1 ? 2 : 1;
}

function sameOccurrenceCounts(
  left: ReadonlyMap<string, 1 | 2>,
  right: ReadonlyMap<string, 1 | 2>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false;
    }
  }
  return true;
}

function orderedRoles(
  roles: ReadonlySet<LatexProjectFileRole>,
): readonly LatexProjectFileRole[] {
  return (["standalone", "body", "preamble"] as const)
    .filter((role) => roles.has(role));
}

function preferredRole(
  roles: readonly LatexProjectFileRole[],
): LatexProjectFileRole {
  return roles.includes("standalone")
    ? "standalone"
    : roles.includes("body")
      ? "body"
      : "preamble";
}

function projectLabel(
  file: LatexProjectFile,
  target: VisualLabelTarget,
): LatexProjectLabelTarget {
  return {
    key: target.key,
    uri: file.uri,
    from: target.from,
    to: target.to,
    keyFrom: target.keyFrom,
    keyTo: target.keyTo,
    fileRole: file.role,
    fileRoles: file.roles,
    occurrenceCount: file.occurrenceCount,
  };
}

function allVisualLabels(
  text: string,
  maximum: number,
  requestedFrom = 0,
  requestedTo = text.length,
): readonly VisualLabelTarget[] {
  const targets: VisualLabelTarget[] = [];
  let from = Math.max(0, Math.min(text.length, Math.trunc(requestedFrom)));
  const to = Math.max(from, Math.min(text.length, Math.trunc(requestedTo)));
  while (from < to && targets.length < maximum) {
    const batch = findVisualLabelsInRange(text, from, to);
    const available = maximum - targets.length;
    targets.push(...batch.slice(0, available));
    if (batch.length < 256 || batch.length > available) {
      break;
    }
    const next = batch.at(-1)?.to ?? text.length;
    if (next <= from) {
      break;
    }
    from = next;
  }
  return targets;
}

/**
 * Labels become authoritative only in source that this bounded model can show
 * is document body. A preamble-only file contributes no labels; a standalone
 * document is restricted to begin/end document; an included body fragment
 * without its own wrapper uses its whole physical source.
 */
function executableLabelRange(
  file: LatexProjectFile,
): { readonly from: number; readonly to: number } | undefined {
  if (file.role === "preamble") {
    return undefined;
  }
  const begin = file.sourceScan.beginDocument;
  const end = file.sourceScan.endDocument;
  const endInput = file.sourceScan.endInput;
  if (begin === undefined && file.role === "standalone") {
    return undefined;
  }
  const from = begin?.end ?? 0;
  const to = Math.max(from, Math.min(
    file.text.length,
    end?.start ?? file.text.length,
    endInput?.start ?? file.text.length,
  ));
  return from < to ? { from, to } : undefined;
}

function projectRelativeUriPath(
  workspaceUri: vscode.Uri,
  uri: vscode.Uri,
): string | undefined {
  if (!uriWithin(uri, workspaceUri)) {
    return undefined;
  }
  const rootPath = normalizedUriPath(workspaceUri);
  const childPath = normalizedUriPath(uri);
  const prefix = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  const relative = childPath === rootPath ? "" : childPath.slice(prefix.length);
  return relative.length > 0 ? relative : undefined;
}

function uriWithin(uri: vscode.Uri, root: vscode.Uri): boolean {
  if (
    uri.scheme.toLowerCase() !== root.scheme.toLowerCase() ||
    uri.authority.toLowerCase() !== root.authority.toLowerCase()
  ) {
    return false;
  }
  const rootPath = normalizedUriPath(root);
  const childPath = normalizedUriPath(uri);
  return childPath === rootPath ||
    childPath.startsWith(rootPath.endsWith("/") ? rootPath : `${rootPath}/`);
}

function normalizedUriPath(uri: vscode.Uri): string {
  const path = uri.path.replace(/\/+$/u, "") || "/";
  return uri.scheme.toLowerCase() === "file" && process.platform === "win32"
    ? path.toLowerCase()
    : path;
}

function uriKey(uri: vscode.Uri): string {
  if (uri.scheme.toLowerCase() !== "file") {
    // Query and fragment may be part of a virtual/custom filesystem resource's
    // identity. Dropping them would merge distinct dirty buffers and caches.
    return uri.toString(true);
  }
  const normalized = uri.with({ query: "", fragment: "" }).toString(true);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  return uriKey(left) === uriKey(right);
}

function findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  const matches = vscode.workspace.textDocuments.filter((document) =>
    sameUri(document.uri, uri)
  );
  return matches.find((document) => document.isDirty) ?? matches[0];
}

function isTextDocument(
  value: vscode.TextDocument | vscode.Uri,
): value is vscode.TextDocument {
  return "getText" in value && "version" in value && "uri" in value;
}

function isTexUri(uri: vscode.Uri): boolean {
  return uri.path.toLowerCase().endsWith(".tex");
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === "FileNotFound";
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 240 ? message : `${message.slice(0, 237)}…`;
}

function contentRevision(text: string, documentVersion: number | undefined): string {
  const digest = createHash("sha256").update(text, "utf8").digest("hex");
  return documentVersion === undefined
    ? `fs:${digest}`
    : `document:${documentVersion}:${digest}`;
}

function projectContextId(
  workspaceUri: vscode.Uri | undefined,
  rootUri: vscode.Uri | undefined,
  requestedUri: vscode.Uri,
  resolution: string,
): string {
  return `latex-project:${createHash("sha256").update([
    "v1",
    workspaceUri === undefined ? "<no-workspace>" : uriKey(workspaceUri),
    rootUri === undefined ? uriKey(requestedUri) : uriKey(rootUri),
    rootUri === undefined ? resolution : "<resolved-root>",
  ].join("\u0000"), "utf8").digest("hex").slice(0, 24)}`;
}

function chapterNumberingClass(documentClass: string | undefined): boolean {
  return /^(?:book|report|memoir|ctexbook|ctexrep|thuthesis)$/iu.test(
    documentClass ?? "",
  );
}

function rootResolutionFailureMessage(
  subject: string,
  reason: ProjectUriFailureReason,
): string {
  switch (reason) {
    case "outside-workspace":
      return `${subject} cannot be resolved without an owning workspace.`;
    case "workspace-escape":
      return `${subject} would escape the owning workspace.`;
    case "unsupported-extension":
      return `${subject} must resolve to a .tex file.`;
    case "unsafe-path":
      return `${subject} must be a literal relative TeX path.`;
  }
}

/**
 * Root directives are editor metadata, not executable include edges. Once a
 * real project root has already been selected (most importantly by the
 * explicit texleaf.project.rootFile setting), a malformed fallback directive
 * in an included chapter must remain visible as a warning without poisoning
 * every otherwise deterministic cross-file label and preview operation.
 */
function sourceDiagnosticAffectsResolvedProjectGraph(
  code: string,
  rootResolution: LatexProjectRootResolution | undefined,
): boolean {
  return !hasResolvedProjectRoot(rootResolution) ||
    !isRootMetadataOnlyDiagnostic(code);
}

function sourceScanRemainsIncompleteForResolvedProject(
  scan: LatexProjectSourceScan,
  rootResolution: LatexProjectRootResolution | undefined,
): boolean {
  if (!scan.graphIncomplete) {
    return false;
  }
  if (!hasResolvedProjectRoot(rootResolution) || scan.diagnostics.length === 0) {
    return true;
  }
  return scan.diagnostics.some((diagnostic) =>
    !isRootMetadataOnlyDiagnostic(diagnostic.code)
  );
}

function hasResolvedProjectRoot(
  resolution: LatexProjectRootResolution | undefined,
): boolean {
  return resolution !== undefined &&
    resolution !== "ambiguous" &&
    resolution !== "unresolved" &&
    resolution !== "invalid-configured" &&
    resolution !== "invalid-magic";
}

function isRootMetadataOnlyDiagnostic(code: string): boolean {
  return code === "invalid-root-path" || code === "too-many-root-directives";
}

function emptySourceScan(): LatexProjectSourceScan {
  return {
    rootDirectives: [],
    documentClass: undefined,
    beginDocument: undefined,
    endDocument: undefined,
    endInput: undefined,
    includes: [],
    diagnostics: [],
    graphIncomplete: true,
  };
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  ceiling: number,
): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(1, Math.min(ceiling, Math.trunc(value)));
}
