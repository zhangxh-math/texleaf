/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import {
  findCitationContext,
  findIncompleteBibTeXEntry,
  formatBibTeXAppendBlock,
  getCitationCompletionEdit,
  normalizeReferenceSearchText,
  parseBibTeX,
  scanVisualDocumentStructure,
  citationSearchMatchSortText,
  compareCitationSearchMatches,
  prepareCitationSearchReference,
  rankCitationReferences,
  SerialTaskQueue,
  type BibTeXEntry,
  type CitationReference,
  type CitationSearchMatch,
  type CitationCompletionEdit,
  type CitationContext,
  type PreparedCitationSearchReference,
} from "./core";
import {
  CitationRepository,
  type BibliographySnapshot,
} from "./citationRepository";
import { readConfig, type TeXLeafConfig } from "./config";
import {
  createBibIdentityIndex,
  findEquivalentBibEntry,
  findImportCompatibleBibEntry,
  isSafeCitationKey,
  referencesClearlyConflict,
} from "./referenceMatcher";
import { SnippetRuntime } from "./snippetRuntime";
import {
  ZoteroClient,
  ZoteroClientError,
  type ZoteroLibrary,
  type ZoteroReady,
  type ZoteroReference,
} from "./zoteroClient";

const COMMIT_COMPLETION_COMMAND = "texleaf.commitCitationCompletion";
const MARK_COMPLETION_ACCEPTED_COMMAND = "texleaf.markCitationCompletionAccepted";
const AUTO_TRIGGER_DELAY_MS = 100;
const MINIMUM_ZOTERO_CACHE_MS = 1_000;
const ZOTERO_FAILURE_RETRY_MS = 5_000;
const MAX_CITATION_COMPLETION_ITEMS = 100;

export interface CitationBibliographyPreview {
  readonly configuredPath: string;
  readonly uri: vscode.Uri;
  readonly exists: boolean;
  readonly entries: readonly BibTeXEntry[];
}

export interface VisualBibliographyRevealResult {
  readonly status: "found" | "missing" | "duplicate";
  readonly uri: vscode.Uri;
}

export interface ProjectBibliographyRevealResult {
  readonly status: "found" | "missing" | "duplicate";
  readonly matchedUri?: vscode.Uri;
  readonly searchedUris: readonly vscode.Uri[];
}

const MAX_PROJECT_BIBLIOGRAPHY_FILES = 64;
const MAX_PROJECT_BIBLIOGRAPHY_CHARACTERS = 32 * 1024 * 1024;
const MAX_PROJECT_BIBLIOGRAPHY_TOTAL_CHARACTERS = 64 * 1024 * 1024;

interface ZoteroSnapshot {
  readonly cacheKey: string;
  /** Unique identity of this exact fetched library snapshot. */
  readonly snapshotId: string;
  readonly expiresAt: number;
  readonly client: ZoteroClient;
  readonly ready: ZoteroReady;
  readonly library: ZoteroLibrary;
  readonly references: readonly ZoteroReference[];
  /** Every duplicate citekey is excluded rather than ambiguously importing one. */
  readonly duplicateCitekeys: ReadonlySet<string>;
  readonly searchReferences: readonly PreparedCitationSearchReference<ZoteroCitationReference>[];
}

interface ZoteroLoadState {
  readonly cacheKey: string;
  readonly promise: Promise<ZoteroSnapshot>;
}

interface ZoteroFailure {
  readonly cacheKey: string;
  readonly message: string;
  readonly retryAfter: number;
}

interface LocatedCitation {
  readonly document: vscode.TextDocument;
  readonly position: vscode.Position;
  readonly config: TeXLeafConfig;
  readonly context: CitationContext;
  readonly completionEdit: CitationCompletionEdit;
}

interface CitationCompletionArgument {
  readonly documentUri: string;
  /** Exact bibliography resolved while this candidate was constructed. */
  readonly bibliographyUri: string;
  /** Relative bibliography path used to resolve bibliographyUri. */
  readonly bibliographyPath: string;
  readonly snapshotKey: string;
  readonly snapshotId: string;
  readonly contextKey: string;
  readonly reference: ZoteroReference;
}

interface VisualCitationCompletionOptions {
  readonly requestedBibliographyPath?: string;
  readonly bibliographyUris?: readonly vscode.Uri[];
}

interface CitationCompletionTarget {
  readonly document: vscode.TextDocument;
  readonly position: vscode.Position;
  readonly setSelection?: (position: vscode.Position) => void;
}

interface ZoteroCitationReference extends CitationReference {
  readonly zotero: ZoteroReference;
}

interface BibliographySearchSnapshot {
  readonly uriText: string;
  readonly text: string;
  readonly entries: readonly BibTeXEntry[];
  readonly duplicateKeys: ReadonlySet<string>;
  readonly identity: ReturnType<typeof createBibIdentityIndex>;
  readonly searchReferences: readonly PreparedCitationSearchReference<BibTeXEntry>[];
}

interface RankedCompletionCandidateBase {
  readonly sourceRank: 0 | 1;
  readonly match: CitationSearchMatch;
  readonly tieBreak: string;
}

interface RankedExistingCompletionCandidate extends RankedCompletionCandidateBase {
  readonly sourceRank: 0;
  readonly entry: BibTeXEntry;
  readonly bibliographyUri: vscode.Uri;
}

interface RankedZoteroCompletionCandidate extends RankedCompletionCandidateBase {
  readonly sourceRank: 1;
  readonly zotero: ZoteroReference;
  readonly cacheKey: string;
  readonly snapshotId: string;
}

type RankedCompletionCandidate =
  | RankedExistingCompletionCandidate
  | RankedZoteroCompletionCandidate;

/**
 * Supplies citation references through VS Code's native suggest widget and
 * imports Zotero entries only after the user accepts a completion.
 */
export class CitationController
  implements vscode.Disposable, vscode.CompletionItemProvider<vscode.CompletionItem>
{
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repository = new CitationRepository();
  private readonly commitQueue = new SerialTaskQueue();
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  private activeCitationIdentity: string | undefined;
  private zoteroCache: ZoteroSnapshot | undefined;
  private zoteroLoad: ZoteroLoadState | undefined;
  private zoteroFailure: ZoteroFailure | undefined;
  private zoteroGeneration = 0;
  private bibliographySearchCache: BibliographySearchSnapshot | undefined;
  private applying = false;

  public constructor(
    private readonly runtime: SnippetRuntime,
    private readonly output: vscode.LogOutputChannel,
  ) {}

  public register(): void {
    this.disposables.push(
      vscode.languages.registerCompletionItemProvider(
        [
          { language: "latex" },
          { language: "tex" },
        ],
        this,
        "{",
        ",",
      ),
      vscode.commands.registerCommand("texleaf.pickCitation", () =>
        this.triggerNativeSuggestions(true),
      ),
      vscode.commands.registerCommand("texleaf.refreshZotero", () =>
        this.refreshZotero(),
      ),
      vscode.commands.registerCommand(
        COMMIT_COMPLETION_COMMAND,
        (argument: CitationCompletionArgument) =>
          this.acceptZoteroCompletion(argument),
      ),
      vscode.commands.registerCommand(MARK_COMPLETION_ACCEPTED_COMMAND, () =>
        this.markCurrentCitationHandled(),
      ),
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleAutoTrigger()),
      vscode.window.onDidChangeTextEditorSelection(() => this.scheduleAutoTrigger()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
          this.scheduleAutoTrigger();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("texleaf")) {
          return;
        }
        if (zoteroSnapshotConfigurationChanged(event)) {
          this.clearZoteroState();
        }
        if (event.affectsConfiguration("texleaf.bibliographyFile")) {
          this.bibliographySearchCache = undefined;
        }
        this.activeCitationIdentity = undefined;
        this.scheduleAutoTrigger();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.activeCitationIdentity = undefined;
        this.scheduleAutoTrigger();
      }),
    );
    this.scheduleAutoTrigger();
  }

  public dispose(): void {
    if (this.autoTimer !== undefined) {
      clearTimeout(this.autoTimer);
      this.autoTimer = undefined;
    }
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  /** Read the bibliography metadata needed by the visual editor without writing. */
  public async readBibliographyPreview(
    document: vscode.TextDocument,
    requestedPath?: string,
  ): Promise<CitationBibliographyPreview> {
    const configuredPath = visualBibliographyPath(
      requestedPath,
      readConfig(document.uri).bibliographyFile,
    );
    const uri = await this.repository.resolveBibliographyUri(document, configuredPath);
    const snapshot = await this.repository.read(uri);
    return {
      configuredPath,
      uri,
      exists: snapshot.exists,
      entries: this.prepareBibliographySearch(snapshot).entries,
    };
  }

  /** Read a bounded, host-resolved set. Duplicate keys are not guessed. */
  public async readProjectBibliographyPreview(uris: readonly vscode.Uri[]): Promise<{
    readonly entries: readonly BibTeXEntry[];
    readonly sources: ReadonlyMap<string, vscode.Uri>;
    readonly duplicateKeys: ReadonlySet<string>;
  }> {
    const unique = uniqueBibliographyUris(uris);
    if (unique.length > MAX_PROJECT_BIBLIOGRAPHY_FILES) throw new Error("参考文献文件超过 64 个安全上限。");
    const entries: BibTeXEntry[] = [];
    const sources = new Map<string, vscode.Uri>();
    let total = 0;
    for (const uri of unique) {
      const snapshot = await this.repository.read(uri);
      total += snapshot.text.length;
      if (snapshot.text.length > MAX_PROJECT_BIBLIOGRAPHY_CHARACTERS || total > MAX_PROJECT_BIBLIOGRAPHY_TOTAL_CHARACTERS) {
        throw new Error("参考文献总内容超过安全扫描上限。");
      }
      for (const entry of this.prepareBibliographySearch(snapshot).entries) {
        entries.push(entry); sources.set(entry.key, uri);
      }
    }
    const duplicateKeys = findDuplicateKeys(entries);
    return { entries: entries.filter((entry) => !duplicateKeys.has(entry.key)), sources, duplicateKeys };
  }

  /** Open the exact bibliography represented by the visual bibliography card. */
  public async openVisualBibliography(
    document: vscode.TextDocument,
    requestedPath?: string,
  ): Promise<void> {
    const configuredPath = visualBibliographyPath(
      requestedPath,
      readConfig(document.uri).bibliographyFile,
    );
    const uri = await this.repository.resolveBibliographyUri(document, configuredPath);
    const snapshot = await this.repository.read(uri);
    const bibliography = await this.repository.openForEditing(snapshot);
    await vscode.window.showTextDocument(bibliography, {
      preview: false,
      preserveFocus: false,
    });
  }

  /** Resolve one citation key and reveal its exact BibTeX entry without writing. */
  public async revealVisualBibliographyEntry(
    document: vscode.TextDocument,
    requestedPath: string | undefined,
    key: string,
  ): Promise<VisualBibliographyRevealResult> {
    const configuredPath = visualBibliographyPath(
      requestedPath,
      readConfig(document.uri).bibliographyFile,
    );
    const uri = await this.repository.resolveBibliographyUri(document, configuredPath);
    const snapshot = await this.repository.read(uri);
    if (!snapshot.exists) {
      return { status: "missing", uri };
    }
    const matches = parseBibTeX(snapshot.text).filter((entry) => entry.key === key);
    if (matches.length !== 1) {
      return {
        status: matches.length === 0 ? "missing" : "duplicate",
        uri,
      };
    }
    const bibliography = await this.repository.openForEditing(snapshot);
    const editor = await vscode.window.showTextDocument(bibliography, {
      preview: false,
      preserveFocus: false,
    });
    const match = matches[0]!;
    const start = bibliography.positionAt(match.range.start);
    const end = bibliography.positionAt(match.range.end);
    editor.selection = new vscode.Selection(start, start);
    editor.revealRange(
      new vscode.Range(start, end),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
    return { status: "found", uri };
  }

  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    completionContext: vscode.CompletionContext,
    visualOptions?: VisualCitationCompletionOptions,
  ): Promise<vscode.CompletionList<vscode.CompletionItem> | undefined> {
    const initialLocated = this.locateCitation(document, position);
    const located = initialLocated === undefined
      ? undefined
      : withVisualBibliographyPath(
          initialLocated,
          visualOptions?.requestedBibliographyPath,
        );
    if (located === undefined || token.isCancellationRequested) {
      return undefined;
    }
    if (
      !located.config.autoShowCitationPicker &&
      completionContext.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter
    ) {
      return undefined;
    }
    this.activeCitationIdentity = citationIdentity(located);

    // In surrounding whitespace beside a real token, a zero-width native
    // completion would concatenate keys. Wait until the user places the caret
    // in the token or creates a comma-delimited empty segment.
    if (
      located.completionEdit.mode === "insert-at-cursor" &&
      located.context.query.length > 0
    ) {
      return undefined;
    }

    let defaultBibliographyUri: vscode.Uri | undefined;
    let bibliography: BibliographySearchSnapshot;
    let bibliographySources: ReadonlyMap<string, vscode.Uri> | undefined;
    try {
      if (visualOptions?.bibliographyUris !== undefined) {
        const combined = await this.readProjectBibliographyPreview(visualOptions.bibliographyUris);
        bibliographySources = combined.sources;
        bibliography = {
          uriText: "project-bibliography-set", text: "", entries: combined.entries,
          duplicateKeys: combined.duplicateKeys, identity: createBibIdentityIndex(combined.entries),
          searchReferences: combined.entries.map((entry) => prepareCitationSearchReference(entry, {
            doi: entry.fields.doi ?? "", isbn: entry.fields.isbn ?? "",
          })),
        };
      } else {
        defaultBibliographyUri = await this.repository.resolveBibliographyUri(
          document,
          located.config.bibliographyFile,
        );
        bibliography = this.prepareBibliographySearch(
          await this.repository.read(defaultBibliographyUri),
        );
      }
    } catch (error: unknown) {
      this.output.error(`读取 bibliography 失败：${errorMessage(error)}`);
      return undefined;
    }
    if (token.isCancellationRequested) {
      return undefined;
    }

    const excludedKeys = new Set(
      located.completionEdit.mode === "insert-at-cursor"
        ? located.context.keys
        : located.context.otherKeys,
    );
    const range = completionRange(document, located.completionEdit);
    const query = located.completionEdit.prefixQuery;
    // An empty citation segment is the project bibliography picker. Do not
    // mix a previously cached Zotero library into `\cite{}`: apart from being
    // noisy, a large Zotero cache can consume the UI cap and make the user's
    // already-collected references appear to be missing. Zotero joins the
    // search only after the user supplies a non-whitespace term.
    // Never import into a default file outside the displayed bibliography set.
    // Resolving that default is unnecessary for existing project references,
    // and an invalid global default must not make an explicit multi-file set
    // disappear. Resolve it lazily only when a non-empty query could surface
    // a Zotero import candidate.
    let zoteroBibliographyUri = defaultBibliographyUri;
    if (query.trim().length > 0 && visualOptions?.bibliographyUris !== undefined) {
      try {
        const resolved = await this.repository.resolveBibliographyUri(
          document,
          located.config.bibliographyFile,
        );
        if (visualOptions.bibliographyUris.some((uri) => uri.toString() === resolved.toString())) {
          zoteroBibliographyUri = resolved;
        }
      } catch (error: unknown) {
        this.output.warn(`无法解析 Zotero 导入目标；将仅显示项目已收录文献：${errorMessage(error)}`);
      }
      if (token.isCancellationRequested) {
        return undefined;
      }
    }
    const includeZotero = query.trim().length > 0 && zoteroBibliographyUri !== undefined;
    const candidates: RankedCompletionCandidate[] = [];
    const eligibleBibliography = bibliography.searchReferences.filter(({ reference }) =>
      !excludedKeys.has(reference.key) &&
      isSafeCitationKey(reference.key) &&
      !bibliography.duplicateKeys.has(reference.key)
    );
    for (const ranked of rankCitationReferences(eligibleBibliography, query)) {
      const sourceUri = bibliographySources?.get(ranked.prepared.reference.key) ?? defaultBibliographyUri;
      if (sourceUri === undefined) {
        // readProjectBibliographyPreview records the exact origin for every
        // retained key. Fail closed if that invariant is ever broken.
        continue;
      }
      candidates.push({
        sourceRank: 0,
        match: ranked.match,
        tieBreak: ranked.prepared.tieBreak,
        entry: ranked.prepared.reference,
        bibliographyUri: sourceUri,
      });
    }

    const configCacheKey = zoteroCacheKey(located.config);
    const cached = this.zoteroCache?.cacheKey === configCacheKey
      ? this.zoteroCache
      : undefined;
    const needsRefresh = cached === undefined || cached.expiresAt <= Date.now();
    const failure = this.zoteroFailure?.cacheKey === configCacheKey
      ? this.zoteroFailure
      : undefined;
    const retryCoolingDown =
      failure !== undefined && failure.retryAfter > Date.now();
    if (includeZotero && needsRefresh && !retryCoolingDown) {
      this.startBackgroundZoteroLoad(located.config, document.uri);
    }

    if (includeZotero && cached !== undefined) {
      const eligibleZotero = cached.searchReferences.filter(({ reference }) => {
        const zotero = reference.zotero;
        if (
          excludedKeys.has(zotero.citekey) ||
          !isSafeCitationKey(zotero.citekey) ||
          cached.duplicateCitekeys.has(zotero.citekey) ||
          findEquivalentBibEntry(zotero, bibliography.identity) !== undefined
        ) {
          return false;
        }
        return true;
      });
      const seenKeys = new Set<string>();
      const seenIdentities = new Set<string>();
      for (const ranked of rankCitationReferences(eligibleZotero, query)) {
        const zotero = ranked.prepared.reference.zotero;
        const identity = zoteroSearchIdentity(zotero, ranked.prepared);
        if (
          seenKeys.has(zotero.citekey) ||
          (identity !== undefined && seenIdentities.has(identity))
        ) {
          continue;
        }
        seenKeys.add(zotero.citekey);
        if (identity !== undefined) {
          seenIdentities.add(identity);
        }
        candidates.push({
          sourceRank: 1,
          match: ranked.match,
          tieBreak: ranked.prepared.tieBreak,
          zotero,
          cacheKey: cached.cacheKey,
          snapshotId: cached.snapshotId,
        });
      }
    }

    candidates.sort(compareRankedCompletionCandidates);
    const limited = candidates.slice(0, MAX_CITATION_COMPLETION_ITEMS);
    const items = limited.map((candidate, index) => {
      const sortText = [
        candidate.sourceRank,
        citationSearchMatchSortText(candidate.match),
        String(index).padStart(3, "0"),
      ].join(":");
      const preselect = index === 0 && isHighConfidenceCitationMatch(candidate.match);
      if (candidate.sourceRank === 0) {
        return this.createExistingCompletion(
          candidate.entry,
          candidate.bibliographyUri,
          range,
          query,
          sortText,
          preselect,
        );
      }
      return this.createZoteroCompletion(
        located,
        candidate.zotero,
        candidate.cacheKey,
        candidate.snapshotId,
        zoteroBibliographyUri!,
        range,
        query,
        sortText,
        preselect,
      );
    });

    // TeXLeaf performs normalized, field-aware matching and ranking itself.
    // Keeping the list incomplete makes VS Code ask again after every typed
    // character, so a reference outside the current top 100 can enter as the
    // query becomes more specific instead of being filtered only by its label.
    return new vscode.CompletionList(items, true);
  }

  /**
   * Only these two internally-created completion commands may cross the
   * custom-editor bridge. The Webview receives an opaque one-shot token rather
   * than either the command name or its arguments.
   */
  public isVisualCompletionCommand(
    command: vscode.Command | undefined,
  ): command is vscode.Command {
    return command?.command === MARK_COMPLETION_ACCEPTED_COMMAND ||
      command?.command === COMMIT_COMPLETION_COMMAND;
  }

  /** Execute one allow-listed citation completion follow-up without requiring
   * a native TextEditor to be focused. */
  public async acceptVisualCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    command: vscode.Command,
  ): Promise<vscode.Position | undefined> {
    if (command.command === MARK_COMPLETION_ACCEPTED_COMMAND) {
      this.markCitationHandled(document, position);
      return position;
    }
    if (command.command !== COMMIT_COMPLETION_COMMAND) {
      throw new Error("拒绝执行非引用补全动作。");
    }
    const argument = command.arguments?.[0] as CitationCompletionArgument | undefined;
    if (!validCitationCompletionArgument(argument)) {
      throw new Error("引用补全动作参数无效，请重新触发补全。");
    }
    return this.acceptZoteroCompletion(argument, { document, position });
  }

  private createExistingCompletion(
    entry: BibTeXEntry,
    bibliographyUri: vscode.Uri,
    range: vscode.Range,
    query: string,
    sortText: string,
    preselect: boolean,
  ): vscode.CompletionItem {
    const bibliographyName = fileName(bibliographyUri);
    const authors = splitBibAuthors(entry.authors);
    const item = new vscode.CompletionItem(
      {
        label: displayCitationTitle(entry.title, authors, entry.year),
        description: bibliographyName,
      },
      vscode.CompletionItemKind.Reference,
    );
    item.documentation = completionDocumentation({
      title: entry.title,
      authors,
      container: entry.container,
      year: entry.year,
      key: entry.key,
      source: `${bibliographyName} · 已收录`,
      action: "接受后直接插入现有 citation key，不会改写 bibliography。",
    });
    setManualFilterText(item, query);
    item.sortText = sortText;
    item.preselect = preselect;
    item.range = range;
    item.insertText = snippetText(entry.key);
    item.command = {
      command: MARK_COMPLETION_ACCEPTED_COMMAND,
      title: "记录已接受的文献补全",
    };
    return item;
  }

  private createZoteroCompletion(
    located: LocatedCitation,
    reference: ZoteroReference,
    cacheKey: string,
    snapshotId: string,
    bibliographyUri: vscode.Uri,
    range: vscode.Range,
    query: string,
    sortText: string,
    preselect: boolean,
  ): vscode.CompletionItem {
    const bibliographyName = fileName(bibliographyUri);
    const item = new vscode.CompletionItem(
      {
        label: displayCitationTitle(
          reference.title,
          reference.authors,
          reference.year,
        ),
        description: "Zotero",
      },
      vscode.CompletionItemKind.Reference,
    );
    item.documentation = completionDocumentation({
      title: reference.title,
      authors: reference.authors,
      container: reference.container,
      year: reference.year,
      key: reference.citekey,
      source: `Zotero · 未导入（目标：${bibliographyName}）`,
      action: `接受后按 ${located.config.bibliographyFormat === "biblatex" ? "BibLaTeX" : "BibTeX"} 格式导入 ${bibliographyName}。`,
    });
    setManualFilterText(item, query);
    item.sortText = sortText;
    item.preselect = preselect;
    item.range = range;

    // Completion commands run after the primary edit. Reinsert the exact
    // original token so that accepting a Zotero item is a no-op first; the
    // command can then atomically edit both TeX and bibliography. An export
    // failure therefore leaves the citation exactly as the user typed it.
    const originalText = located.document.getText(range);
    item.insertText = snippetText(originalText);
    item.command = {
      command: COMMIT_COMPLETION_COMMAND,
      title: "导入 Zotero 文献并插入引用",
      arguments: [{
        documentUri: located.document.uri.toString(),
        bibliographyUri: bibliographyUri.toString(),
        bibliographyPath: located.config.bibliographyFile,
        snapshotKey: cacheKey,
        snapshotId,
        contextKey: zoteroCompletionContextKey(located.config),
        reference,
      } satisfies CitationCompletionArgument],
    };
    return item;
  }

  /** Resolve the configured project bibliography with the repository's safe path rules. */
  public resolveProjectBibliographyUri(
    document: vscode.TextDocument,
    configuredPath: string,
  ): Promise<vscode.Uri> {
    return this.repository.resolveBibliographyUri(document, configuredPath);
  }

  /** Resolve one key across an explicit, bounded project bibliography set. */
  public async revealProjectBibliographyEntry(
    bibliographyUris: readonly vscode.Uri[],
    key: string,
    viewColumn?: vscode.ViewColumn,
  ): Promise<ProjectBibliographyRevealResult> {
    const searchedUris = uniqueBibliographyUris(bibliographyUris);
    if (searchedUris.length > MAX_PROJECT_BIBLIOGRAPHY_FILES) {
      throw new Error("项目声明的 bibliography 文件过多，已拒绝无界扫描。");
    }
    if (!isSafeCitationKey(key)) {
      return { status: "missing", searchedUris };
    }
    const matches: Array<{
      readonly snapshot: BibliographySnapshot;
      readonly entry: BibTeXEntry;
    }> = [];
    let scannedCharacters = 0;
    for (const uri of searchedUris) {
      const snapshot = await this.repository.read(uri);
      if (!snapshot.exists) {
        continue;
      }
      if (
        snapshot.text.length > MAX_PROJECT_BIBLIOGRAPHY_CHARACTERS ||
        scannedCharacters + snapshot.text.length > MAX_PROJECT_BIBLIOGRAPHY_TOTAL_CHARACTERS
      ) {
        throw new Error("项目 bibliography 超过安全扫描上限，已停止反向定位。");
      }
      scannedCharacters += snapshot.text.length;
      for (const entry of this.prepareBibliographySearch(snapshot).entries) {
        if (entry.key === key) {
          matches.push({ snapshot, entry });
          if (matches.length > 1) {
            return { status: "duplicate", searchedUris };
          }
        }
      }
    }
    const match = matches[0];
    if (match === undefined) {
      return { status: "missing", searchedUris };
    }
    const bibliography = await this.repository.openForEditing(match.snapshot);
    const editor = await vscode.window.showTextDocument(bibliography, {
      preview: false,
      preserveFocus: false,
      ...(viewColumn === undefined ? {} : { viewColumn }),
    });
    const start = bibliography.positionAt(match.entry.range.start);
    const end = bibliography.positionAt(match.entry.range.end);
    editor.selection = new vscode.Selection(start, start);
    editor.revealRange(
      new vscode.Range(start, end),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
    return {
      status: "found",
      matchedUri: match.snapshot.uri,
      searchedUris,
    };
  }

  /**
   * Return project-bibliography candidates immediately. Zotero is loaded in
   * the shared background path below, so an unavailable Zotero instance never
   * holds existing `.bib` entries behind its request timeout.
   */
  public provideVisualCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    requestedBibliographyPath?: string,
    bibliographyUris?: readonly vscode.Uri[],
  ): Promise<vscode.CompletionList<vscode.CompletionItem> | undefined> {
    return this.provideCompletionItems(
      document,
      position,
      token,
      {
        triggerKind: vscode.CompletionTriggerKind.Invoke,
        triggerCharacter: undefined,
      },
      {
        ...(bibliographyUris === undefined ? {} : { bibliographyUris }),
        ...(requestedBibliographyPath === undefined
          ? {}
          : { requestedBibliographyPath }),
      },
    );
  }

  /**
   * Wait for the background Zotero snapshot started by a visual completion
   * request. The custom editor uses the boolean result to retrigger its picker
   * only when a genuinely newer snapshot became available.
   */
  public async waitForVisualZoteroCompletionRefresh(
    document: vscode.TextDocument,
  ): Promise<boolean> {
    const config = readConfig(document.uri);
    if (
      !config.enabled ||
      !config.zoteroCitations ||
      !vscode.workspace.isTrusted
    ) {
      return false;
    }
    const cacheKey = zoteroCacheKey(config);
    const cached = this.zoteroCache?.cacheKey === cacheKey
      ? this.zoteroCache
      : undefined;
    // A visual picker that already received any Zotero snapshot can use it
    // immediately.  In particular, a zero-second cache is useful for QA and
    // explicit freshness, but must not turn into an endless
    // load -> completionRefresh -> load loop that keeps replacing the active
    // completion just before Enter is pressed.  Background refresh still runs
    // from provideCompletionItems; the next query observes that newer cache.
    if (cached !== undefined) {
      return false;
    }
    const failure = this.zoteroFailure?.cacheKey === cacheKey
      ? this.zoteroFailure
      : undefined;
    if (failure !== undefined && failure.retryAfter > Date.now()) {
      return false;
    }
    try {
      const snapshot = await this.loadZotero(config, false);
      return snapshot.cacheKey === cacheKey;
    } catch {
      // Existing bibliography candidates have already been returned. A failed
      // Zotero refresh is therefore a soft, logged fallback rather than an
      // empty visual completion list.
      return false;
    }
  }

  private scheduleAutoTrigger(): void {
    if (this.autoTimer !== undefined) {
      clearTimeout(this.autoTimer);
    }
    this.autoTimer = setTimeout(() => {
      this.autoTimer = undefined;
      void this.maybeAutoTrigger();
    }, AUTO_TRIGGER_DELAY_MS);
  }

  private async maybeAutoTrigger(): Promise<void> {
    if (this.applying) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      this.activeCitationIdentity = undefined;
      return;
    }
    const located = this.locateCitation(editor.document, editor.selection.active);
    if (located === undefined || !located.config.autoShowCitationPicker) {
      this.activeCitationIdentity = undefined;
      return;
    }
    if (
      located.completionEdit.mode === "insert-at-cursor" &&
      located.context.query.length > 0
    ) {
      return;
    }
    const identity = citationIdentity(located);
    if (identity === this.activeCitationIdentity) {
      return;
    }
    this.activeCitationIdentity = identity;
    await vscode.commands.executeCommand("editor.action.triggerSuggest");
  }

  private async triggerNativeSuggestions(manual: boolean): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      if (manual) {
        void vscode.window.showInformationMessage(
          "请先打开一个已经保存的 .tex 文件。",
        );
      }
      return;
    }
    const located = this.locateCitation(editor.document, editor.selection.active);
    if (located === undefined) {
      if (manual) {
        void vscode.window.showInformationMessage(
          "请把光标放在 \\cite{…} 类命令的大括号内。",
        );
      }
      return;
    }
    this.activeCitationIdentity = citationIdentity(located);
    await vscode.commands.executeCommand("editor.action.triggerSuggest");
  }

  private markCurrentCitationHandled(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      this.activeCitationIdentity = undefined;
      return;
    }
    this.markCitationHandled(editor.document, editor.selection.active);
  }

  private markCitationHandled(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): void {
    const located = this.locateCitation(document, position);
    this.activeCitationIdentity = located === undefined
      ? undefined
      : citationIdentity(located);
  }

  private locateCitation(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): LocatedCitation | undefined {
    const config = readConfig(document.uri);
    if (
      !config.enabled ||
      !config.zoteroCitations ||
      !vscode.workspace.isTrusted ||
      !isCitationDocument(document, config)
    ) {
      return undefined;
    }
    const latexContext = this.runtime.contextAt(document, position);
    if (
      latexContext.inComment ||
      latexContext.inVerbatim ||
      latexContext.environments.some((environment) =>
        config.excludedEnvironments.includes(environment),
      )
    ) {
      return undefined;
    }
    const text = document.getText();
    const cursorOffset = document.offsetAt(position);
    const context = findCitationContext(
      text,
      cursorOffset,
      config.citationCommands,
    );
    if (context === undefined) {
      return undefined;
    }
    const completionEdit = getCitationCompletionEdit(text, cursorOffset, context);
    return completionEdit === undefined
      ? undefined
      : { document, position, config, context, completionEdit };
  }

  private startBackgroundZoteroLoad(
    config: TeXLeafConfig,
    documentUri: vscode.Uri,
  ): void {
    const cacheKey = zoteroCacheKey(config);
    if (this.zoteroLoad?.cacheKey === cacheKey) {
      return;
    }
    void this.loadZotero(config, false)
      .then(() => this.refreshNativeSuggestions(documentUri))
      // The failure is logged and remembered by loadZotero. Do not retrigger
      // Suggest on failure: the next provider call will retain existing .bib
      // results, and the failure gate prevents an automatic retry loop.
      .catch(() => undefined);
  }

  private async loadZotero(
    config: TeXLeafConfig,
    force: boolean,
  ): Promise<ZoteroSnapshot> {
    const cacheKey = zoteroCacheKey(config);
    const generation = this.zoteroGeneration;
    if (!force) {
      const cached = this.zoteroCache;
      if (
        cached !== undefined &&
        cached.cacheKey === cacheKey &&
        cached.expiresAt > Date.now()
      ) {
        return cached;
      }
      if (this.zoteroLoad?.cacheKey === cacheKey) {
        return this.zoteroLoad.promise;
      }
    }

    const promise = (async (): Promise<ZoteroSnapshot> => {
      const client = new ZoteroClient({
        port: config.zoteroPort,
        timeoutMs: config.zoteroRequestTimeoutMs,
        library: config.zoteroLibrary,
        exportFormat: config.bibliographyFormat,
      });
      const ready = await client.ready();
      const library = await client.selectLibrary();
      const references = await client.search("", library.id);
      if (generation !== this.zoteroGeneration) {
        throw new Error("Zotero 引用设置已变化，请重新打开补全列表。");
      }
      const duplicateCitekeys = findDuplicateZoteroCitekeys(references);
      const snapshot: ZoteroSnapshot = {
        cacheKey,
        snapshotId: randomUUID(),
        expiresAt:
          Date.now() +
          Math.max(
            MINIMUM_ZOTERO_CACHE_MS,
            config.zoteroCacheSeconds * 1_000,
          ),
        client,
        ready,
        library,
        references,
        duplicateCitekeys,
        searchReferences: references.map(prepareZoteroCitationSearchReference),
      };
      this.zoteroCache = snapshot;
      this.zoteroFailure = undefined;
      this.output.info(
        `Zotero ${ready.zotero} / ${ready.betterbibtex}：${library.name} 加载 ${references.length} 条参考文献。`,
      );
      if (duplicateCitekeys.size > 0) {
        this.output.warn(
          `Zotero 当前库有 ${duplicateCitekeys.size} 组重复 citation key；为避免导入错文献，这些组不会显示在补全中。`,
        );
      }
      return snapshot;
    })();
    this.zoteroLoad = { cacheKey, promise };
    try {
      return await promise;
    } catch (error: unknown) {
      if (generation === this.zoteroGeneration) {
        const message = friendlyZoteroError(error);
        this.zoteroFailure = {
          cacheKey,
          message,
          retryAfter: Date.now() + ZOTERO_FAILURE_RETRY_MS,
        };
        this.output.warn(
          `Zotero 引用列表不可用：${message}（${errorMessage(error)}）`,
        );
      }
      throw error;
    } finally {
      if (this.zoteroLoad?.promise === promise) {
        this.zoteroLoad = undefined;
      }
    }
  }

  private async refreshNativeSuggestions(documentUri: vscode.Uri): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (
      editor === undefined ||
      editor.document.uri.toString() !== documentUri.toString()
    ) {
      return;
    }
    const located = this.locateCitation(editor.document, editor.selection.active);
    if (located === undefined) {
      return;
    }
    await vscode.commands.executeCommand("editor.action.triggerSuggest");
  }

  private async refreshZotero(): Promise<void> {
    this.clearZoteroState();
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showInformationMessage(
        "请先在 .tex 文件的 citation 大括号内运行刷新命令。",
      );
      return;
    }
    const located = this.locateCitation(editor.document, editor.selection.active);
    if (located === undefined) {
      void vscode.window.showInformationMessage(
        "请把光标放在 \\cite{…} 类命令的大括号内。",
      );
      return;
    }
    try {
      await this.loadZotero(located.config, true);
      await vscode.commands.executeCommand("editor.action.triggerSuggest");
    } catch (error: unknown) {
      void vscode.window.showErrorMessage(
        `TeXLeaf：${friendlyZoteroError(error)}`,
      );
    }
  }

  private clearZoteroState(): void {
    this.zoteroGeneration += 1;
    this.zoteroCache = undefined;
    this.zoteroLoad = undefined;
    this.zoteroFailure = undefined;
  }

  private prepareBibliographySearch(
    snapshot: BibliographySnapshot,
  ): BibliographySearchSnapshot {
    const uriText = snapshot.uri.toString();
    const cached = this.bibliographySearchCache;
    if (
      cached !== undefined &&
      cached.uriText === uriText &&
      cached.text === snapshot.text
    ) {
      return cached;
    }
    const entries = /\.bbl$/iu.test(snapshot.uri.path)
      ? scanVisualDocumentStructure(snapshot.text, { fragmentKind: "body" }).records.flatMap((record) =>
          record.kind !== "bibliography" || !record.manual ? [] : record.entries.flatMap((entry): BibTeXEntry[] =>
            entry.sourceFrom === undefined || entry.sourceTo === undefined ? [] : [{
              key: entry.key, title: entry.title, authors: entry.authors,
              author: entry.authors, year: entry.year, container: entry.container,
              type: "bibitem", entryType: "bibitem", journal: "", fields: {},
              raw: snapshot.text.slice(entry.sourceFrom, entry.sourceTo),
              range: { start: entry.sourceFrom, end: entry.sourceTo },
            }]))
      : parseBibTeX(snapshot.text);
    const prepared: BibliographySearchSnapshot = {
      uriText,
      text: snapshot.text,
      entries,
      duplicateKeys: findDuplicateKeys(entries),
      identity: createBibIdentityIndex(entries),
      searchReferences: entries.map((entry) =>
        prepareCitationSearchReference(entry, {
          doi: entry.fields.doi ?? "",
          isbn: entry.fields.isbn ?? "",
        })
      ),
    };
    this.bibliographySearchCache = prepared;
    return prepared;
  }

  private async acceptZoteroCompletion(
    argument: CitationCompletionArgument,
    visualTarget?: CitationCompletionTarget,
  ): Promise<vscode.Position | undefined> {
    const editor = visualTarget === undefined
      ? vscode.window.activeTextEditor
      : undefined;
    const target: CitationCompletionTarget | undefined = visualTarget ?? (
      editor === undefined
        ? undefined
        : {
            document: editor.document,
            position: editor.selection.active,
            setSelection: (position) => {
              editor.selection = new vscode.Selection(position, position);
            },
          }
    );
    if (
      target === undefined ||
      target.document.uri.toString() !== argument.documentUri
    ) {
      void vscode.window.showErrorMessage(
        "TeXLeaf：接受引用后活动文档发生了变化，请重试。",
      );
      return undefined;
    }
    const initialLocated = this.locateCitation(target.document, target.position);
    if (initialLocated === undefined) {
      void vscode.window.showErrorMessage(
        "TeXLeaf：当前光标已经不在 citation 大括号内，请重试。",
      );
      return undefined;
    }
    const located = withVisualBibliographyPath(
      initialLocated,
      argument.bibliographyPath,
    );
    // The primary completion edit deliberately restores the original query.
    // Record its new document version immediately so the auto-trigger timer
    // does not reopen Suggest while Zotero export is still in progress.
    this.activeCitationIdentity = citationIdentity(located);
    const configKey = zoteroCacheKey(located.config);
    const contextKey = zoteroCompletionContextKey(located.config);
    try {
      if (
        argument.snapshotKey !== configKey ||
        argument.contextKey !== contextKey
      ) {
        throw new Error("Zotero 引用设置已变化，请重新选择文献。");
      }
      if (!isSafeCitationKey(argument.reference.citekey)) {
        throw new Error("Zotero 返回了不安全的 citation key。");
      }
      const currentBibliographyUri = await this.repository.resolveBibliographyUri(
        target.document,
        located.config.bibliographyFile,
      );
      if (currentBibliographyUri.toString() !== argument.bibliographyUri) {
        throw new Error(
          "当前项目解析到的 bibliography 已变化，请从当前补全列表重新选择。",
        );
      }
      const snapshot = this.zoteroCache;
      if (
        snapshot === undefined ||
        snapshot.cacheKey !== configKey ||
        snapshot.snapshotId !== argument.snapshotId
      ) {
        throw new Error("Zotero 文献列表已刷新，请从当前补全列表重新选择。");
      }
      if (snapshot.duplicateCitekeys.has(argument.reference.citekey)) {
        throw new Error(
          "该 citation key 在 Zotero 当前库中重复；请先在 Zotero 中消除冲突。",
        );
      }
      const reference = snapshot.references.find(
        (candidate) =>
          candidate.citekey === argument.reference.citekey &&
          candidate.libraryID === argument.reference.libraryID,
      );
      if (reference === undefined) {
        throw new Error("该 Zotero 文献已不在当前文献库中，请刷新后重试。");
      }
      const raw = await snapshot.client.exportBibTeX(
        reference,
        located.config.bibliographyFormat,
      );
      const exportedEntries = parseBibTeX(raw);
      if (
        findIncompleteBibTeXEntry(raw) !== undefined ||
        exportedEntries.length !== 1 ||
        exportedEntries[0]?.key !== reference.citekey
      ) {
        throw new Error(
          `Zotero 对“${reference.citekey}”的导出不是恰好一个同名条目。`,
        );
      }
      const result = await this.commitQueue.enqueue(() =>
        this.commitImportedReference(
          target,
          located,
          reference,
          raw,
          exportedEntries[0]!,
          currentBibliographyUri,
        ),
      );
      target.setSelection?.(result.caret);
      this.markCitationHandled(target.document, result.caret);
      if (result.imported) {
        const savedSuffix = result.saved ? "" : "；bibliography 保持未保存状态";
        void vscode.window.showInformationMessage(
          `TeXLeaf 已导入“${reference.citekey}”${savedSuffix}。`,
        );
      }
      return result.caret;
    } catch (error: unknown) {
      const message = errorMessage(error);
      this.output.error(`引用补全提交失败：${message}`);
      void vscode.window.showErrorMessage(
        `TeXLeaf 未修改引用：${message}`,
      );
      return undefined;
    }
  }

  private async commitImportedReference(
    target: CitationCompletionTarget,
    located: LocatedCitation,
    reference: ZoteroReference,
    rawEntry: string,
    exportedEntry: BibTeXEntry,
    expectedBibliographyUri: vscode.Uri,
  ): Promise<{
    readonly imported: boolean;
    readonly saved: boolean;
    readonly caret: vscode.Position;
  }> {
    const texDocument = target.document;
    const texVersion = texDocument.version;
    const cursorOffset = texDocument.offsetAt(target.position);
    const resolvedBibliographyUri = await this.repository.resolveBibliographyUri(
      texDocument,
      located.config.bibliographyFile,
    );
    if (resolvedBibliographyUri.toString() !== expectedBibliographyUri.toString()) {
      throw new Error(
        "导出期间项目解析到的 bibliography 已变化，请重新选择文献。",
      );
    }
    const bibliographyUri = expectedBibliographyUri;
    let bibliography = await this.repository.read(bibliographyUri);
    let bibliographyDocument: vscode.TextDocument | undefined;

    const freshEntries = validateBibliographyText(
      bibliography.text,
      bibliographyUri,
    );

    const byKey = new Map(freshEntries.map((entry) => [entry.key, entry]));
    const exact = byKey.get(reference.citekey);
    let resolvedKey: string;
    let appendText = "";
    if (exact !== undefined) {
      if (referencesClearlyConflict(exact, exportedEntry)) {
        throw new Error(
          `citation key “${reference.citekey}” 已用于另一条文献；不会覆盖。`,
        );
      }
      resolvedKey = exact.key;
    } else {
      const equivalent = findImportCompatibleBibEntry(
        reference,
        exportedEntry,
        createBibIdentityIndex(freshEntries),
      );
      if (equivalent !== undefined) {
        resolvedKey = equivalent.key;
      } else {
        resolvedKey = reference.citekey;
        appendText = formatBibTeXAppendBlock(bibliography.text, rawEntry);
      }
    }
    if (appendText.length > 0) {
      // Re-read immediately before constructing the WorkspaceEdit. This does
      // not create a missing file, so creation and both text edits can remain
      // in one cross-resource edit.
      bibliography = await this.repository.read(bibliographyUri);
      if (bibliography.exists) {
        bibliographyDocument = await this.repository.openForEditing(bibliography);
      }
      bibliography = {
        uri: bibliography.uri,
        exists: bibliography.exists,
        text: bibliographyDocument?.getText() ?? bibliography.text,
        document: bibliographyDocument,
        wasDirty: bibliography.wasDirty,
      };
      // Re-read after opening an existing document. Another operation may
      // have imported the item between the earlier snapshot and this point.
      const reopenedEntries = validateBibliographyText(
        bibliography.text,
        bibliographyUri,
      );
      const reopenedExact = reopenedEntries.find(
        (entry) => entry.key === reference.citekey,
      );
      if (reopenedExact !== undefined) {
        if (referencesClearlyConflict(reopenedExact, exportedEntry)) {
          throw new Error(
            `citation key “${reference.citekey}” 刚刚被另一条文献占用。`,
          );
        }
        resolvedKey = reopenedExact.key;
        appendText = "";
      } else {
        const reopenedEquivalent = findImportCompatibleBibEntry(
          reference,
          exportedEntry,
          createBibIdentityIndex(reopenedEntries),
        );
        if (reopenedEquivalent !== undefined) {
          resolvedKey = reopenedEquivalent.key;
          appendText = "";
        } else {
          appendText = formatBibTeXAppendBlock(bibliography.text, rawEntry);
        }
      }
    }

    if (!isSafeCitationKey(resolvedKey)) {
      throw new Error(`bibliography 中匹配到不安全的 citation key “${resolvedKey}”。`);
    }
    if (located.context.otherKeys.includes(resolvedKey)) {
      throw new Error(`“${resolvedKey}” 已经存在于当前 citation 中。`);
    }
    if (appendText.length > 0 && !bibliography.exists) {
      // WorkspaceEdit can atomically create the .bib file and edit both
      // resources, but createFile does not recursively create directories.
      // Creating only the parent directory here leaves file contents and the
      // TeX replacement within the single WorkspaceEdit below.
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(bibliographyUri, ".."),
      );
    }

    validateCitationContext(
      texDocument,
      texVersion,
      cursorOffset,
      located.context,
      located.config.citationCommands,
    );
    const replaceRange = new vscode.Range(
      texDocument.positionAt(located.context.replacementRange.start),
      texDocument.positionAt(located.context.replacementRange.end),
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(texDocument.uri, replaceRange, resolvedKey);
    if (appendText.length > 0) {
      if (bibliography.exists) {
        bibliographyDocument ??= await this.repository.openForEditing(bibliography);
        edit.insert(
          bibliographyUri,
          bibliographyDocument.positionAt(bibliography.text.length),
          appendText,
        );
      } else {
        edit.createFile(bibliographyUri, {
          ignoreIfExists: false,
          overwrite: false,
        });
        edit.insert(bibliographyUri, new vscode.Position(0, 0), appendText);
      }
    }

    this.applying = true;
    let applied: boolean;
    try {
      applied = await vscode.workspace.applyEdit(edit);
    } finally {
      this.applying = false;
    }
    if (!applied) {
      throw new Error("VS Code 拒绝了跨文件引用编辑，请检查文件状态后重试。");
    }
    const caret = texDocument.positionAt(
      located.context.replacementRange.start + resolvedKey.length,
    );

    let saved = false;
    if (appendText.length > 0) {
      try {
        bibliographyDocument ??= await vscode.workspace.openTextDocument(
          bibliographyUri,
        );
        if (!bibliography.wasDirty) {
          saved = await bibliographyDocument.save();
        }
      } catch (error: unknown) {
        // The atomic WorkspaceEdit already succeeded. A subsequent save error
        // must not be reported as though the citation was left untouched.
        this.output.warn(
          `引用已写入，但 bibliography 自动保存失败：${errorMessage(error)}`,
        );
      }
    }
    return { imported: appendText.length > 0, saved, caret };
  }
}

function validCitationCompletionArgument(
  value: CitationCompletionArgument | undefined,
): value is CitationCompletionArgument {
  return value !== undefined &&
    typeof value.documentUri === "string" &&
    typeof value.bibliographyUri === "string" &&
    typeof value.bibliographyPath === "string" &&
    typeof value.snapshotKey === "string" &&
    typeof value.snapshotId === "string" &&
    typeof value.contextKey === "string" &&
    typeof value.reference === "object" &&
    value.reference !== null &&
    typeof value.reference.citekey === "string";
}

function isCitationDocument(
  document: vscode.TextDocument,
  config: TeXLeafConfig,
): boolean {
  return (
    !document.isClosed &&
    document.uri.scheme.toLocaleLowerCase() !== "untitled" &&
    /\.tex$/iu.test(document.uri.path) &&
    config.languageIds.includes(document.languageId)
  );
}

function completionRange(
  document: vscode.TextDocument,
  edit: CitationCompletionEdit,
): vscode.Range {
  return new vscode.Range(
    document.positionAt(edit.replacingRange.start),
    document.positionAt(edit.replacingRange.end),
  );
}

function snippetText(value: string): vscode.SnippetString {
  const snippet = new vscode.SnippetString();
  snippet.appendText(value);
  return snippet;
}

function setManualFilterText(
  item: vscode.CompletionItem,
  query: string,
): void {
  if (query.length > 0) {
    // The provider has already performed normalized substring matching. Using
    // the exact typed prefix prevents VS Code's label-only fuzzy pass from
    // hiding a title that matched through its author metadata.
    item.filterText = query;
  }
}

function prepareZoteroCitationSearchReference(
  reference: ZoteroReference,
): PreparedCitationSearchReference<ZoteroCitationReference> {
  return prepareCitationSearchReference(
    {
      key: reference.citekey,
      title: reference.title,
      authors: reference.authors.join(" "),
      container: reference.container,
      year: reference.year,
      zotero: reference,
    },
    { doi: reference.doi, isbn: reference.isbn },
  );
}

function zoteroSearchIdentity(
  reference: ZoteroReference,
  prepared: PreparedCitationSearchReference,
): string | undefined {
  if (prepared.canonicalDoi.length > 0) {
    return `doi:${prepared.canonicalDoi}`;
  }
  const isbn = prepared.canonicalIsbns[0];
  const title = normalizeReferenceSearchText(reference.title);
  const year = normalizeReferenceSearchText(reference.year);
  const firstAuthor = normalizeReferenceSearchText(reference.authors[0] ?? "");
  if (
    isbn !== undefined &&
    title.length > 0 &&
    firstAuthor.length > 0
  ) {
    return `isbn:${isbn}\u0000${title}\u0000${firstAuthor}\u0000${year}`;
  }
  return title.length > 0 && year.length > 0 && firstAuthor.length > 0
    ? `fallback:${title}\u0000${firstAuthor}\u0000${year}`
    : undefined;
}

interface CompletionDocumentationFields {
  readonly title: string;
  readonly authors: readonly string[];
  readonly container: string;
  readonly year: string;
  readonly key: string;
  readonly source: string;
  readonly action: string;
}

function completionDocumentation(
  fields: CompletionDocumentationFields,
): vscode.MarkdownString {
  const documentation = new vscode.MarkdownString();
  documentation.appendMarkdown("### ");
  documentation.appendText(displayTitle(fields.title));
  documentation.appendMarkdown("\n\n**作者：** ");
  documentation.appendText(fullAuthorDetail(fields.authors));
  documentation.appendMarkdown("\n\n**期刊 / 出版物：** ");
  documentation.appendText(compactText(fields.container, 240) || "未知出版物");
  documentation.appendMarkdown("\n\n**年份：** ");
  documentation.appendText(compactText(fields.year, 20) || "无年份");
  documentation.appendMarkdown(
    `\n\n**Citation key：** \`${escapeMarkdownCode(fields.key)}\``,
  );
  documentation.appendMarkdown("\n\n**来源：** ");
  documentation.appendText(fields.source);
  documentation.appendMarkdown("\n\n---\n\n");
  documentation.appendText(fields.action);
  return documentation;
}

function citationIdentity(located: LocatedCitation): string {
  // The document version is intentionally included. Native Suggest can close
  // when Backspace returns a non-empty citation segment to empty; the text is
  // then identical to an earlier state, but it is still a new edit that must
  // be allowed to reopen the widget. The cursor and prefix also distinguish
  // movements within the same comma-delimited segment.
  return JSON.stringify([
    located.document.uri.toString(),
    located.document.version,
    located.document.offsetAt(located.position),
    located.context.openingBrace,
    located.context.replacementRange.start,
    located.completionEdit.prefixQuery,
  ]);
}

function zoteroCacheKey(config: TeXLeafConfig): string {
  return JSON.stringify([
    config.zoteroPort,
    config.zoteroLibrary,
    config.zoteroRequestTimeoutMs,
    config.bibliographyFormat,
  ]);
}

function zoteroCompletionContextKey(config: TeXLeafConfig): string {
  return JSON.stringify([
    zoteroCacheKey(config),
    config.bibliographyFile,
  ]);
}

function visualBibliographyPath(
  requestedPath: string | undefined,
  configuredPath: string,
): string {
  const requested = requestedPath?.trim().replaceAll("\\", "/") ?? "";
  if (
    requested.length === 0 ||
    requested.includes("#") ||
    requested.includes("{") ||
    requested.includes("}") ||
    requested.includes("..") ||
    requested.startsWith("/") ||
    /^[A-Za-z]:/u.test(requested)
  ) {
    return configuredPath;
  }
  return /\.bib$/iu.test(requested) ? requested : `${requested}.bib`;
}

function uniqueBibliographyUris(values: readonly vscode.Uri[]): readonly vscode.Uri[] {
  const seen = new Set<string>();
  const result: vscode.Uri[] = [];
  for (const value of values) {
    if (value.scheme !== "file" || !/\.(?:bib|bbl)$/iu.test(value.fsPath)) {
      continue;
    }
    const key = process.platform === "win32"
      ? value.fsPath.toLocaleLowerCase("en-US")
      : value.fsPath;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function withVisualBibliographyPath(
  located: LocatedCitation,
  requestedPath: string | undefined,
): LocatedCitation {
  const bibliographyFile = visualBibliographyPath(
    requestedPath,
    located.config.bibliographyFile,
  );
  return bibliographyFile === located.config.bibliographyFile
    ? located
    : {
        ...located,
        config: {
          ...located.config,
          bibliographyFile,
        },
      };
}

function zoteroSnapshotConfigurationChanged(
  event: vscode.ConfigurationChangeEvent,
): boolean {
  return [
    "texleaf.enabled",
    "texleaf.zoteroCitations",
    "texleaf.zoteroPort",
    "texleaf.zoteroLibrary",
    "texleaf.zoteroRequestTimeoutMs",
    "texleaf.zoteroCacheSeconds",
    "texleaf.bibliographyFormat",
  ].some((setting) => event.affectsConfiguration(setting));
}

function compareRankedCompletionCandidates(
  left: RankedCompletionCandidate,
  right: RankedCompletionCandidate,
): number {
  return (
    left.sourceRank - right.sourceRank ||
    compareCitationSearchMatches(left.match, right.match) ||
    compareCitationStrings(left.tieBreak, right.tieBreak)
  );
}

function compareCitationStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isHighConfidenceCitationMatch(match: CitationSearchMatch): boolean {
  return (
    match.kind === "key-exact" ||
    match.kind === "doi-exact" ||
    match.kind === "isbn-exact"
  );
}

function validateBibliographyText(
  text: string,
  uri: vscode.Uri,
): readonly BibTeXEntry[] {
  const incompleteOffset = findIncompleteBibTeXEntry(text);
  if (incompleteOffset !== undefined) {
    throw new Error(
      `${fileName(uri)} 第 ${lineNumberAt(text, incompleteOffset)} 行附近有未闭合的 BibTeX 条目。`,
    );
  }
  const entries = parseBibTeX(text);
  const duplicates = findDuplicateKeys(entries);
  if (duplicates.size > 0) {
    throw new Error(
      `${fileName(uri)} 含重复 citation key：${[...duplicates].join(", ")}。`,
    );
  }
  return entries;
}

function findDuplicateKeys(entries: readonly BibTeXEntry[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      duplicates.add(entry.key);
    }
    seen.add(entry.key);
  }
  return duplicates;
}

function findDuplicateZoteroCitekeys(
  references: readonly ZoteroReference[],
): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const reference of references) {
    if (seen.has(reference.citekey)) {
      duplicates.add(reference.citekey);
    }
    seen.add(reference.citekey);
  }
  return duplicates;
}

function splitBibAuthors(authors: string): readonly string[] {
  return authors
    .split(/\s+and\s+/iu)
    .map((author) => compactText(author, 80))
    .filter((author) => author.length > 0);
}

function fullAuthorDetail(authors: readonly string[]): string {
  const names = authors
    .map((author) => compactText(author, 120))
    .filter((author) => author.length > 0);
  return names.length > 0 ? names.join("、") : "未知作者";
}

function displayTitle(title: string): string {
  return compactText(title, 220) || "[无标题]";
}

function displayCitationTitle(
  title: string,
  authors: readonly string[],
  year: string,
): string {
  const displayedTitle = compactText(title, 220);
  if (displayedTitle.length > 0) {
    return displayedTitle;
  }
  const author = compactText(authors[0] ?? "", 160);
  const displayedYear = compactText(year, 20);
  const fallback = [author, displayedYear].filter((value) => value.length > 0);
  return fallback.length > 0 ? fallback.join(" · ") : "[无标题]";
}

function compactText(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, Math.max(1, maximum - 1))}…`;
}

function fileName(uri: vscode.Uri): string {
  const segments = uri.path.split("/");
  return segments[segments.length - 1] || "reference.bib";
}

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  const end = Math.max(0, Math.min(offset, text.length));
  for (let index = 0; index < end; index += 1) {
    if (text[index] === "\n") {
      line += 1;
    }
  }
  return line;
}

function friendlyZoteroError(error: unknown): string {
  if (!(error instanceof ZoteroClientError)) {
    return errorMessage(error);
  }
  switch (error.kind) {
    case "connection":
      return "无法连接 Zotero；请确认 Zotero 正在运行且端口正确";
    case "not-found":
      return "Zotero 本地 API 或 Better BibTeX 接口不可用";
    case "timeout":
      return "Zotero 请求超时；它可能仍在启动或文献库较大";
    case "library-not-found":
      return "配置的 Zotero 库不存在或名称不唯一";
    case "rpc":
      return `Better BibTeX 错误 ${error.rpcCode ?? error.code}`;
    case "configuration":
      return "Zotero 引用设置无效";
    case "http":
      if (error.status === 403) {
        return "Zotero 已拒绝本机访问；请在 Zotero 设置中允许本机其他应用通信";
      }
      return `Zotero 返回 HTTP ${error.status ?? error.code}`;
    case "invalid-response":
      return "Zotero 返回了无效数据";
  }
}

function validateCitationContext(
  document: vscode.TextDocument,
  expectedVersion: number,
  cursorOffset: number,
  expected: CitationContext,
  commands: readonly string[],
): void {
  if (document.version !== expectedVersion) {
    throw new Error("导出期间 TeX 文档已经变化，请重新选择文献。");
  }
  const current = findCitationContext(document.getText(), cursorOffset, commands);
  if (
    current === undefined ||
    current.command !== expected.command ||
    current.commandStart !== expected.commandStart ||
    current.openingBrace !== expected.openingBrace ||
    current.closingBrace !== expected.closingBrace ||
    current.closed !== expected.closed ||
    current.argumentRange.start !== expected.argumentRange.start ||
    current.argumentRange.end !== expected.argumentRange.end ||
    current.replacementRange.start !== expected.replacementRange.start ||
    current.replacementRange.end !== expected.replacementRange.end ||
    current.query !== expected.query ||
    !sameStrings(current.keys, expected.keys) ||
    !sameStrings(current.otherKeys, expected.otherKeys)
  ) {
    throw new Error("当前 citation 上下文已经变化，请重新选择文献。");
  }
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function escapeMarkdownCode(value: string): string {
  return value.replaceAll("`", "\\`");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
