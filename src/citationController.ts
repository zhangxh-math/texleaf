import * as vscode from "vscode";
import {
  findCitationContext,
  findIncompleteBibTeXEntry,
  formatBibTeXAppendBlock,
  getCitationCompletionEdit,
  normalizeReferenceSearchText,
  parseBibTeX,
  referenceMatchesQuery,
  SerialTaskQueue,
  type BibTeXEntry,
  type CitationCompletionEdit,
  type CitationContext,
} from "./core";
import { CitationRepository } from "./citationRepository";
import { readConfig, type TeXLeafConfig } from "./config";
import {
  createBibIdentityIndex,
  findEquivalentBibEntry,
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

interface ZoteroSnapshot {
  readonly cacheKey: string;
  readonly expiresAt: number;
  readonly client: ZoteroClient;
  readonly ready: ZoteroReady;
  readonly library: ZoteroLibrary;
  readonly references: readonly ZoteroReference[];
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
  readonly cacheKey: string;
  readonly reference: ZoteroReference;
}

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
        this.clearZoteroState();
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

  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    completionContext: vscode.CompletionContext,
  ): Promise<vscode.CompletionList<vscode.CompletionItem> | undefined> {
    const located = this.locateCitation(document, position);
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

    let bibliographyUri: vscode.Uri;
    let bibliographyText: string;
    try {
      bibliographyUri = await this.repository.resolveBibliographyUri(
        document,
        located.config.bibliographyFile,
      );
      bibliographyText = (await this.repository.read(bibliographyUri)).text;
    } catch (error: unknown) {
      this.output.error(`读取 bibliography 失败：${errorMessage(error)}`);
      return undefined;
    }
    if (token.isCancellationRequested) {
      return undefined;
    }

    const bibEntries = parseBibTeX(bibliographyText);
    const duplicateKeys = findDuplicateKeys(bibEntries);
    const excludedKeys = new Set(
      located.completionEdit.mode === "insert-at-cursor"
        ? located.context.keys
        : located.context.otherKeys,
    );
    const range = completionRange(document, located.completionEdit);
    const query = located.completionEdit.prefixQuery;
    const items: vscode.CompletionItem[] = [];

    for (const entry of bibEntries) {
      if (
        excludedKeys.has(entry.key) ||
        !isSafeCitationKey(entry.key) ||
        duplicateKeys.has(entry.key) ||
        !referenceMatchesQuery(entry, query)
      ) {
        continue;
      }
      items.push(
        this.createExistingCompletion(entry, bibliographyUri, range, query),
      );
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
    if (needsRefresh && !retryCoolingDown) {
      this.startBackgroundZoteroLoad(located.config, document.uri);
    }

    if (cached !== undefined) {
      const bibIdentity = createBibIdentityIndex(bibEntries);
      const seen = new Set<string>();
      for (const reference of cached.references) {
        if (
          seen.has(reference.citekey) ||
          excludedKeys.has(reference.citekey) ||
          !isSafeCitationKey(reference.citekey) ||
          findEquivalentBibEntry(reference, bibIdentity) !== undefined ||
          !zoteroReferenceMatchesQuery(reference, query)
        ) {
          continue;
        }
        seen.add(reference.citekey);
        items.push(
          this.createZoteroCompletion(
            located,
            reference,
            cached.cacheKey,
            bibliographyUri,
            range,
            query,
          ),
        );
      }
    }

    // The provider performs title/author/year/key substring matching itself.
    // Keeping the list incomplete makes VS Code ask again after every typed
    // character instead of locally filtering only by the visible title.
    return new vscode.CompletionList(items, true);
  }

  private createExistingCompletion(
    entry: BibTeXEntry,
    bibliographyUri: vscode.Uri,
    range: vscode.Range,
    query: string,
  ): vscode.CompletionItem {
    const bibliographyName = fileName(bibliographyUri);
    const authors = splitBibAuthors(entry.authors);
    const item = new vscode.CompletionItem(
      {
        label: displayTitle(entry.title),
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
    item.sortText = `0:${normalizedSortTitle(entry.title)}:${entry.key}`;
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
    bibliographyUri: vscode.Uri,
    range: vscode.Range,
    query: string,
  ): vscode.CompletionItem {
    const bibliographyName = fileName(bibliographyUri);
    const item = new vscode.CompletionItem(
      {
        label: displayTitle(reference.title),
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
    item.sortText = `1:${normalizedSortTitle(reference.title)}:${reference.citekey}`;
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
        cacheKey,
        reference,
      } satisfies CitationCompletionArgument],
    };
    return item;
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
    const located = this.locateCitation(editor.document, editor.selection.active);
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
      const snapshot: ZoteroSnapshot = {
        cacheKey,
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
      };
      this.zoteroCache = snapshot;
      this.zoteroFailure = undefined;
      this.output.info(
        `Zotero ${ready.zotero} / ${ready.betterbibtex}：${library.name} 加载 ${references.length} 条参考文献。`,
      );
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

  private async acceptZoteroCompletion(
    argument: CitationCompletionArgument,
  ): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (
      editor === undefined ||
      editor.document.uri.toString() !== argument.documentUri
    ) {
      void vscode.window.showErrorMessage(
        "TeXLeaf：接受引用后活动文档发生了变化，请重试。",
      );
      return;
    }
    const located = this.locateCitation(editor.document, editor.selection.active);
    if (located === undefined) {
      void vscode.window.showErrorMessage(
        "TeXLeaf：当前光标已经不在 citation 大括号内，请重试。",
      );
      return;
    }
    // The primary completion edit deliberately restores the original query.
    // Record its new document version immediately so the auto-trigger timer
    // does not reopen Suggest while Zotero export is still in progress.
    this.activeCitationIdentity = citationIdentity(located);
    const configKey = zoteroCacheKey(located.config);
    try {
      if (argument.cacheKey !== configKey) {
        throw new Error("Zotero 引用设置已变化，请重新选择文献。");
      }
      if (!isSafeCitationKey(argument.reference.citekey)) {
        throw new Error("Zotero 返回了不安全的 citation key。");
      }
      let snapshot = this.zoteroCache;
      if (snapshot === undefined || snapshot.cacheKey !== configKey) {
        snapshot = await this.loadZotero(located.config, false);
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
          editor,
          located,
          reference,
          raw,
          exportedEntries[0]!,
        ),
      );
      this.markCurrentCitationHandled();
      if (result.imported) {
        const savedSuffix = result.saved ? "" : "；bibliography 保持未保存状态";
        void vscode.window.showInformationMessage(
          `TeXLeaf 已导入“${reference.citekey}”${savedSuffix}。`,
        );
      }
    } catch (error: unknown) {
      const message = errorMessage(error);
      this.output.error(`引用补全提交失败：${message}`);
      void vscode.window.showErrorMessage(
        `TeXLeaf 未修改引用：${message}`,
      );
    }
  }

  private async commitImportedReference(
    editor: vscode.TextEditor,
    located: LocatedCitation,
    reference: ZoteroReference,
    rawEntry: string,
    exportedEntry: BibTeXEntry,
  ): Promise<{ readonly imported: boolean; readonly saved: boolean }> {
    const texDocument = editor.document;
    const texVersion = texDocument.version;
    const cursorOffset = texDocument.offsetAt(editor.selection.active);
    const bibliographyUri = await this.repository.resolveBibliographyUri(
      texDocument,
      located.config.bibliographyFile,
    );
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
      const equivalent = findEquivalentBibEntry(
        reference,
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
        const reopenedEquivalent = findEquivalentBibEntry(
          reference,
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
    editor.selection = new vscode.Selection(caret, caret);
    this.markCurrentCitationHandled();

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
    return { imported: appendText.length > 0, saved };
  }
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

function zoteroReferenceMatchesQuery(
  reference: ZoteroReference,
  query: string,
): boolean {
  return referenceMatchesQuery(
    {
      key: reference.citekey,
      title: reference.title,
      authors: reference.authors.join(" "),
      container: reference.container,
      year: reference.year,
    },
    query,
  );
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
    config.bibliographyFile,
  ]);
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

function compactText(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, Math.max(1, maximum - 1))}…`;
}

function normalizedSortTitle(title: string): string {
  return normalizeReferenceSearchText(title).slice(0, 160);
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
