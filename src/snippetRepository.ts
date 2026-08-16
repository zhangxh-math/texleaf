import { createHash, randomUUID } from "node:crypto";
import * as vscode from "vscode";
import {
  applyEdits,
  modify,
  parse,
  type FormattingOptions,
  type ParseError,
  printParseErrorCode,
} from "jsonc-parser";
import { readConfig } from "./config";
import {
  createDefaultSnippetLibrary,
  DEFAULT_VARIABLES,
  FACTORY_DEFAULTS_REVISION,
  serializeDefaultSnippetLibrary,
  THEOREM_ENVIRONMENT_FACTORY_SNIPPET_IDS,
  upgradeRevisionTwoTheoremFactorySnippet,
} from "./defaultLibrary";
import {
  optimisticRevisionStatus,
  selectScopedResources,
  SerialTaskQueue,
  toPortableSnippetObject,
  validateMigratableSnippetLibraryText,
} from "./core";

export type SnippetSourceKind = "global" | "workspace";

export interface SnippetRecord {
  readonly id: string;
  /** Stable ID as written by the user, without source/URI namespacing. */
  readonly portableId: string;
  readonly trigger: string;
  readonly replacement: string;
  readonly options: string;
  readonly priority: number;
  readonly description?: string;
  readonly category: string;
  readonly flags?: string;
  readonly syntaxVersion: 1 | 2;
  readonly enabled: boolean;
  readonly source: SnippetSourceKind;
  readonly sourceLabel: string;
  readonly sourceUri?: vscode.Uri;
  readonly order: number;
}

export interface SnippetLibrarySnapshot {
  readonly snippets: readonly SnippetRecord[];
  readonly variables: Readonly<Record<string, string>>;
  readonly revision: number;
}

export interface RestoreDefaultsResult {
  readonly status: "restored" | "cancelled";
  readonly count?: number;
  readonly backupUri?: vscode.Uri;
}

/** Serializable user-level record exposed to the integrated manager. */
export interface ManagedSnippet {
  readonly id: string;
  readonly trigger: string;
  readonly replacement: string;
  readonly options: string;
  readonly priority: number;
  readonly description?: string;
  readonly category: string;
  readonly flags?: string;
  readonly syntaxVersion: 1 | 2;
  readonly enabled: boolean;
}

/**
 * Revision is the SHA-256 of the exact canonical JSONC bytes. It gives the
 * Webview an optimistic-concurrency token without making the file a public UI.
 */
export interface ManagedSnippetLibrary {
  readonly revision: string;
  readonly defaultsRevision?: number;
  readonly variables: Readonly<Record<string, string>>;
  readonly snippets: readonly ManagedSnippet[];
}

interface RawSnippetObject {
  readonly id?: unknown;
  readonly trigger?: unknown;
  readonly replacement?: unknown;
  readonly options?: unknown;
  readonly priority?: unknown;
  readonly description?: unknown;
  readonly category?: unknown;
  readonly flags?: unknown;
  readonly syntaxVersion?: unknown;
  readonly version?: unknown;
  readonly enabled?: unknown;
}

interface ParsedLibrary {
  readonly snippets: readonly RawSnippetObject[];
  readonly variables: Readonly<Record<string, string>>;
  readonly defaultsRevision?: number;
}

interface CachedLibrary {
  readonly snippets: readonly SnippetRecord[];
  readonly variables: Readonly<Record<string, string>>;
}

interface CachedFile extends CachedLibrary {
  readonly source: "global" | "workspace";
  readonly contentHash: string;
  readonly ownerFolderKey?: string;
}

interface ConfiguredSnippetFile {
  readonly uri: vscode.Uri;
  readonly source: "global" | "workspace";
  readonly ownerFolderKey?: string;
}

interface SelfWriteMarker {
  readonly contentHash: string;
  readonly expiresAt: number;
}

interface ReplaceWithBackupResult {
  readonly status: "written" | "changed";
  readonly backupUri?: vscode.Uri;
}

type InitialGlobalFileCreateStatus =
  | "created"
  | "exists"
  | "dirty"
  | "source-changed";

type LegacyPublisherMigrationResult =
  | { readonly status: "absent" | "target-exists" }
  | { readonly status: "copied"; readonly sourceChangedAfterCopy: boolean }
  | { readonly status: "deferred"; readonly reason: string }
  | { readonly status: "invalid" | "failed"; readonly reason: string };

const GLOBAL_SNIPPET_FILE_NAME = "texleaf-snippets.jsonc";
const LEGACY_PUBLISHER_EXTENSION_ID = "local-lab.texleaf";
const SELF_WRITE_MARKER_LIFETIME_MS = 2_000;
const GLOBAL_BACKUP_DIRECTORY_NAME = "backups";
const MAX_MANAGED_LIBRARY_BYTES = 10_000_000;
const MAX_MANAGED_SNIPPETS = 100_000;
const REVISION_TWO_FACTORY_SNIPPET_IDS = new Set<string>(
  THEOREM_ENVIRONMENT_FACTORY_SNIPPET_IDS,
);
const REVISION_ONE_FACTORY_INLINE_KEYS = new Set([
  "id",
  "trigger",
  "replacement",
  "options",
  "description",
  "category",
]);

export class SnippetRepository implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<SnippetLibrarySnapshot>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("texleaf");
  private readonly globalStorageUri: vscode.Uri;
  private readonly watchers: vscode.FileSystemWatcher[] = [];
  private readonly fileCache = new Map<string, CachedFile>();
  private readonly resourceSnapshotCache = new Map<
    string,
    SnippetLibrarySnapshot
  >();
  private readonly selfWriteMarkers = new Map<string, SelfWriteMarker>();
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly reloadQueue = new SerialTaskQueue();
  private appliedReloadEpoch = 0;
  private revision = 0;
  private currentSnapshot: SnippetLibrarySnapshot;
  private warnedDirtyEnsure = false;
  private warnedLegacyPublisherEnsure = false;

  public readonly onDidChange = this.changeEmitter.event;
  public readonly globalSnippetUri: vscode.Uri;

  public constructor(context: vscode.ExtensionContext) {
    this.globalStorageUri = context.globalStorageUri;
    this.globalSnippetUri = vscode.Uri.joinPath(
      this.globalStorageUri,
      GLOBAL_SNIPPET_FILE_NAME,
    );
    this.currentSnapshot = this.makeSnapshot(undefined, true);
  }

  public get snapshot(): SnippetLibrarySnapshot {
    return this.currentSnapshot;
  }

  /**
   * Return the library visible to one resource. Workspace snippet files are
   * intentionally selected from only the owning (longest-matching) workspace
   * folder; resources outside all workspace folders receive user-level sources
   * only.
   */
  public resourceSnapshot(resourceUri?: vscode.Uri): SnippetLibrarySnapshot {
    const ownerFolderKey =
      resourceUri === undefined
        ? undefined
        : vscode.workspace.getWorkspaceFolder(resourceUri)?.uri.toString();
    const cacheKey = ownerFolderKey ?? "<user-level>";
    const cached = this.resourceSnapshotCache.get(cacheKey);
    if (cached !== undefined && cached.revision === this.revision) {
      return cached;
    }
    const snapshot = this.makeSnapshot(ownerFolderKey, false);
    this.resourceSnapshotCache.set(cacheKey, snapshot);
    return snapshot;
  }

  public async initialize(): Promise<void> {
    // Create the user-level library before any UI entry point can open it.
    // Legacy workspace files are deliberately never discovered or promoted
    // automatically; importing one is an explicit user action.
    await this.ensureGlobalSnippetFile();
    this.rebuildWatchers();
    await this.reload();
  }

  public async reload(): Promise<void> {
    return this.reloadQueue.enqueue((epoch) => this.performReload(epoch));
  }

  private async performReload(epoch: number): Promise<void> {
    const files = this.configuredFiles();
    const configuredKeys = new Set(files.map(({ uri }) => uri.toString()));
    const nextFileCache = new Map(this.fileCache);

    for (const key of [...nextFileCache.keys()]) {
      if (!configuredKeys.has(key)) {
        nextFileCache.delete(key);
      }
    }

    await Promise.all(
      files.map(async (file) => this.reloadUri(file, nextFileCache)),
    );
    // performReload calls are serialized, nevertheless retaining the epoch
    // makes the commit invariant explicit and protects future implementations
    // that may coalesce queued reads.
    if (epoch <= this.appliedReloadEpoch) {
      return;
    }
    this.appliedReloadEpoch = epoch;
    this.fileCache.clear();
    for (const [key, value] of nextFileCache) {
      this.fileCache.set(key, value);
    }
    this.revision += 1;
    this.resourceSnapshotCache.clear();
    this.currentSnapshot = this.makeSnapshot(undefined, true);
    this.changeEmitter.fire(this.currentSnapshot);
  }

  public scheduleReload(): void {
    if (this.reloadTimer !== undefined) {
      clearTimeout(this.reloadTimer);
    }
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined;
      void this.reload().catch((error: unknown) => {
        void vscode.window.showErrorMessage(
          `TeXLeaf 自动重载片段失败：${errorMessage(error)}`,
        );
      });
    }, 180);
  }

  public rebuildWatchers(): void {
    for (const watcher of this.watchers.splice(0)) {
      watcher.dispose();
    }

    this.watchFile(
      new vscode.RelativePattern(this.globalStorageUri, GLOBAL_SNIPPET_FILE_NAME),
    );

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const paths = readConfig(folder.uri).snippetFiles;
      for (const relativePath of paths) {
        if (!isSafeRelativePath(relativePath)) {
          continue;
        }
        this.watchFile(
          new vscode.RelativePattern(folder, normalizeSlashes(relativePath)),
        );
      }
    }
  }

  private watchFile(pattern: vscode.GlobPattern): void {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate((uri) => {
      void this.handleWatchedFileChange(uri);
    });
    watcher.onDidChange((uri) => {
      void this.handleWatchedFileChange(uri);
    });
    watcher.onDidDelete((uri) => {
      this.selfWriteMarkers.delete(uri.toString());
      this.scheduleReload();
    });
    this.watchers.push(watcher);
  }

  private async handleWatchedFileChange(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    const marker = this.selfWriteMarkers.get(key);
    if (marker !== undefined) {
      if (marker.expiresAt >= Date.now()) {
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (hashBytes(bytes) === marker.contentHash) {
            // All repository-owned writes explicitly call reload(). File
            // providers can emit both create and change events for one write,
            // so retain this short-lived marker and ignore either event.
            return;
          }
        } catch {
          // Fall through: a failed read or a fast delete must be reloaded.
        }
      }
      this.selfWriteMarkers.delete(key);
    }
    this.scheduleReload();
  }

  public async openGlobalSnippetFile(): Promise<void> {
    await this.ensureGlobalSnippetFile();
    if (!(await uriExists(this.globalSnippetUri))) {
      // A dirty legacy-publisher document deliberately defers initialization.
      // ensureGlobalSnippetFile already explains the required save/reload step;
      // do not follow that warning with an opaque openTextDocument error.
      return;
    }
    await this.reload();
    const document = await vscode.workspace.openTextDocument(this.globalSnippetUri);
    await vscode.window.showTextDocument(document);
  }

  /** Read the canonical user library as structured data for the manager UI. */
  public async readGlobalLibraryModel(): Promise<ManagedSnippetLibrary> {
    await this.ensureGlobalSnippetFile();
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(this.globalSnippetUri);
    } catch (error) {
      throw new Error(`无法读取内部片段库：${errorMessage(error)}`);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return managedLibraryFromText(
      text,
      this.globalSnippetUri,
      hashBytes(bytes),
    );
  }

  /**
   * Commit one complete structured edit with byte-level CAS, verified backup,
   * atomic disk replacement, runtime reload, and post-write validation.
   */
  public async replaceGlobalLibraryModel(
    model: Omit<ManagedSnippetLibrary, "revision">,
    expectedRevision: string,
  ): Promise<ManagedSnippetLibrary> {
    const current = await this.readGlobalLibraryModel();
    if (current.revision !== expectedRevision) {
      throw new Error(
        "片段库已在另一个窗口、磁盘编辑器或同步设备中变化。未覆盖新内容，请重新加载后保存。",
      );
    }
    const bytes = serializeManagedLibrary(
      model,
      model.defaultsRevision ??
        current.defaultsRevision ??
        FACTORY_DEFAULTS_REVISION,
      this.globalSnippetUri,
    );
    const desiredRevision = hashBytes(bytes);
    const result = await this.replaceGlobalSnippetFileWithBackup(
      bytes,
      expectedRevision,
      "edit",
    );
    if (result.status === "changed") {
      throw new Error(
        "片段库在保存过程中发生变化或原生 JSONC 编辑器仍有未保存内容；本次结构化保存已取消。",
      );
    }
    await this.reload();
    const committed = await this.readGlobalLibraryModel();
    if (
      optimisticRevisionStatus(desiredRevision, committed.revision) ===
      "changed"
    ) {
      throw new Error(
        "片段库写入后又被另一个窗口、磁盘编辑器或同步设备替换；未把其他版本误报为本次保存成功，当前草稿仍应保留。",
      );
    }
    if (!(await this.isGlobalSnippetFileCurrent())) {
      throw new Error(
        "片段库已经写入，但重新加载验证失败；保存前备份仍然保留。",
      );
    }
    return committed;
  }

  /** Whether the current on-disk global file is the version held in cache. */
  public async isGlobalSnippetFileCurrent(): Promise<boolean> {
    const cached = this.fileCache.get(this.globalSnippetUri.toString());
    if (cached === undefined) {
      return false;
    }
    try {
      return (
        hashBytes(await vscode.workspace.fs.readFile(this.globalSnippetUri)) ===
        cached.contentHash
      );
    } catch {
      return false;
    }
  }

  /** @deprecated Use openGlobalSnippetFile(). */
  public async openWorkspaceSnippetFile(): Promise<void> {
    await this.openGlobalSnippetFile();
  }

  public async importSnippets(): Promise<void> {
    const target = await this.ensureGlobalSnippetFile();
    if (this.rejectDirtyGlobalDocument("导入")) {
      return;
    }
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      filters: {
        "TeXLeaf / JSON": ["json", "jsonc"],
      },
      title: "导入 TeXLeaf、Snippetleaf 或 Obsidian 片段",
    });
    if (selected === undefined || selected.length === 0) {
      return;
    }

    const imported: RawSnippetObject[] = [];
    const variables: Record<string, string> = {};
    const problems: string[] = [];
    for (const uri of selected) {
      if (urisReferToSameResource(uri, target)) {
        problems.push(
          `${uri.path}: 已跳过当前全局片段文件；它已经是导入目标。`,
        );
        continue;
      }
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        const parsed = parseLibraryText(text, uri, problems);
        imported.push(...parsed.snippets);
        Object.assign(variables, parsed.variables);
      } catch (error) {
        problems.push(`${uri.path}: ${errorMessage(error)}`);
      }
    }

    if (imported.length === 0) {
      void vscode.window.showErrorMessage(
        problems.length > 0
          ? `没有可导入的安全字符串片段：${problems[0]}`
          : "所选文件中没有片段。",
      );
      return;
    }

    if (this.rejectDirtyGlobalDocument("导入")) {
      return;
    }
    let baselineBytes: Uint8Array;
    let baselineText: string;
    let existing: ParsedLibrary;
    try {
      baselineBytes = await vscode.workspace.fs.readFile(target);
      baselineText = new TextDecoder().decode(baselineBytes);
      existing = parseLibraryText(baselineText, target, []);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `TeXLeaf 无法读取全局片段库，未执行导入：${errorMessage(error)}`,
      );
      return;
    }
    const baselineHash = hashBytes(baselineBytes);
    const outputText = mergeLibraryTextPreservingJsonc(
      baselineText,
      existing,
      imported,
      variables,
    );

    if (this.rejectDirtyGlobalDocument("导入")) {
      return;
    }
    try {
      const currentBytes = await vscode.workspace.fs.readFile(target);
      if (hashBytes(currentBytes) !== baselineHash) {
        void vscode.window.showErrorMessage(
          "TeXLeaf: 导入期间全局片段文件已在磁盘上发生变化；为避免覆盖修改，本次导入已取消。请重新执行导入。",
        );
        return;
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `TeXLeaf 无法复核全局片段文件，未执行导入：${errorMessage(error)}`,
      );
      return;
    }
    await this.writeGlobalSnippetFile(
      target,
      new TextEncoder().encode(outputText),
    );
    await this.reload();

    const skippedSuffix =
      problems.length > 0 ? `；另有 ${problems.length} 个问题（函数片段不会执行）` : "";
    void vscode.window.showInformationMessage(
      `已向全局片段库导入 ${imported.length} 条片段${skippedSuffix}。`,
    );
  }

  public async exportSnippets(): Promise<void> {
    await this.ensureGlobalSnippetFile();
    if (this.rejectDirtyGlobalDocument("导出")) {
      return;
    }
    await this.reload();
    const globalFile = this.fileCache.get(this.globalSnippetUri.toString());
    let diskHash: string;
    try {
      diskHash = hashBytes(
        await vscode.workspace.fs.readFile(this.globalSnippetUri),
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        `TeXLeaf 无法读取全局片段库，未执行导出：${errorMessage(error)}`,
      );
      return;
    }
    if (globalFile === undefined || globalFile.contentHash !== diskHash) {
      void vscode.window.showErrorMessage(
        "TeXLeaf: 当前全局片段文件不是有效 JSONC；未导出上一次缓存的旧内容。请先修复文件中的错误。",
      );
      return;
    }
    const globalSnippets = globalFile.snippets;
    const globalVariables = globalFile.variables;
    const destination = await vscode.window.showSaveDialog({
      filters: { JSON: ["json"] },
      saveLabel: "导出",
      title: "导出 TeXLeaf 全局片段",
    });
    if (destination === undefined) {
      return;
    }
    if (urisReferToSameResource(destination, this.globalSnippetUri)) {
      void vscode.window.showErrorMessage(
        "TeXLeaf: 导出目标不能是正在使用的全局 Snippet 配置文件；请选择另一个文件名。",
      );
      return;
    }
    if (this.rejectDirtyGlobalDocument("导出")) {
      return;
    }
    try {
      const currentHash = hashBytes(
        await vscode.workspace.fs.readFile(this.globalSnippetUri),
      );
      if (currentHash !== diskHash) {
        void vscode.window.showErrorMessage(
          "TeXLeaf: 选择导出位置期间全局片段文件已发生变化；为避免导出旧内容，本次导出已取消。请重新执行导出。",
        );
        return;
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `TeXLeaf 无法复核全局片段文件，未执行导出：${errorMessage(error)}`,
      );
      return;
    }

    const output = {
      version: 1,
      variables: globalVariables,
      snippets: globalSnippets.map(toPortableSnippetObject),
    };
    await vscode.workspace.fs.writeFile(
      destination,
      new TextEncoder().encode(`${JSON.stringify(output, null, 2)}\n`),
    );
    void vscode.window.showInformationMessage(
      `已导出 ${globalSnippets.length} 条全局片段。`,
    );
  }

  public dispose(): void {
    if (this.reloadTimer !== undefined) {
      clearTimeout(this.reloadTimer);
    }
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers.length = 0;
    this.selfWriteMarkers.clear();
    this.resourceSnapshotCache.clear();
    this.changeEmitter.dispose();
    this.diagnostics.dispose();
  }

  private async reloadUri(
    file: ConfiguredSnippetFile,
    targetCache: Map<string, CachedFile>,
  ): Promise<void> {
    const { uri, source } = file;
    const key = uri.toString();
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const contentHash = hashBytes(bytes);
      const errors: ParseError[] = [];
      const value = parse(new TextDecoder().decode(bytes), errors, {
        allowTrailingComma: true,
        disallowComments: false,
      }) as unknown;
      if (errors.length > 0) {
        this.reportParseErrors(uri, errors);
        return;
      }

      const problems: string[] = [];
      const library = coerceLibrary(value, problems);
      const snippets = library.snippets
        .map((snippet, index) =>
          normalizeSnippet(snippet, source, uri, index, problems),
        )
        .filter((snippet): snippet is SnippetRecord => snippet !== undefined);
      targetCache.set(key, {
        snippets,
        variables: library.variables,
        source,
        contentHash,
        ...(file.ownerFolderKey === undefined
          ? {}
          : { ownerFolderKey: file.ownerFolderKey }),
      });
      this.reportProblems(uri, problems);
    } catch (error) {
      if (isFileNotFound(error)) {
        targetCache.delete(key);
        this.diagnostics.delete(uri);
      } else {
        this.reportProblems(uri, [errorMessage(error)]);
      }
    }
  }

  private makeSnapshot(
    ownerFolderKey: string | undefined,
    includeAllWorkspaceFiles: boolean,
  ): SnippetLibrarySnapshot {
    const orderedFiles = this.configuredFiles().flatMap(({ uri }) => {
      const cached = this.fileCache.get(uri.toString());
      return cached === undefined ? [] : [cached];
    });
    const selectedFiles = selectScopedResources(
      orderedFiles.map((file) => ({
        scope:
          file.source === "global"
            ? ("user" as const)
            : ("workspace" as const),
        ...(file.ownerFolderKey === undefined
          ? {}
          : { ownerKey: file.ownerFolderKey }),
        value: file,
      })),
      ownerFolderKey,
      includeAllWorkspaceFiles,
    );
    const globalFiles = selectedFiles.filter(
      (file) => file.source === "global",
    );
    const workspaceFiles = selectedFiles.filter(
      (file) => file.source === "workspace",
    );
    const global = globalFiles.flatMap((file) => file.snippets);
    const workspace = workspaceFiles.flatMap((file) => file.snippets);
    const variables: Record<string, string> = {};
    for (const file of globalFiles) {
      Object.assign(variables, file.variables);
    }
    for (const file of workspaceFiles) {
      Object.assign(variables, file.variables);
    }
    return Object.freeze({
      snippets: Object.freeze([
        ...global,
        ...workspace,
      ]),
      variables: Object.freeze(variables),
      revision: this.revision,
    });
  }

  private configuredFiles(): ConfiguredSnippetFile[] {
    const files: ConfiguredSnippetFile[] = [
      { uri: this.globalSnippetUri, source: "global" },
    ];
    const seen = new Set<string>([this.globalSnippetUri.toString()]);
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const ownerFolderKey = folder.uri.toString();
      for (const relativePath of readConfig(folder.uri).snippetFiles) {
        if (isSafeRelativePath(relativePath)) {
          const uri = joinRelativePath(folder.uri, relativePath);
          const key = uri.toString();
          if (!seen.has(key)) {
            seen.add(key);
            files.push({ uri, source: "workspace", ownerFolderKey });
          }
        }
      }
    }
    return files;
  }

  private reportParseErrors(uri: vscode.Uri, errors: readonly ParseError[]): void {
    const diagnostics = errors.slice(0, 20).map(
      (error) =>
        new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 1),
          `JSONC 解析失败：${printParseErrorCode(error.error)}（偏移 ${error.offset}）`,
          vscode.DiagnosticSeverity.Error,
        ),
    );
    this.diagnostics.set(uri, diagnostics);
  }

  private reportProblems(uri: vscode.Uri, problems: readonly string[]): void {
    if (problems.length === 0) {
      this.diagnostics.delete(uri);
      return;
    }
    this.diagnostics.set(
      uri,
      problems.slice(0, 50).map(
        (problem) =>
          new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 1),
            problem,
            vscode.DiagnosticSeverity.Warning,
          ),
      ),
    );
  }

  public async ensureGlobalSnippetFile(): Promise<vscode.Uri> {
    if (this.isGlobalSnippetDocumentDirty()) {
      if (!this.warnedDirtyEnsure) {
        this.warnedDirtyEnsure = true;
        void vscode.window.showWarningMessage(
          "TeXLeaf: 新版全局 Snippet 文件有尚未保存的内容；初始化已暂缓。请先保存或撤销，再重新加载窗口。",
        );
      }
      return this.globalSnippetUri;
    }
    this.warnedDirtyEnsure = false;
    await vscode.workspace.fs.createDirectory(this.globalStorageUri);
    if (!(await uriExists(this.globalSnippetUri))) {
      const publisherMigration =
        await this.tryMigrateLegacyPublisherGlobalSnippetFile();
      if (publisherMigration.status === "deferred") {
        if (!this.warnedLegacyPublisherEnsure) {
          this.warnedLegacyPublisherEnsure = true;
          void vscode.window.showWarningMessage(publisherMigration.reason);
        }
        return this.globalSnippetUri;
      }
      this.warnedLegacyPublisherEnsure = false;

      if (
        publisherMigration.status === "absent" ||
        publisherMigration.status === "invalid" ||
        publisherMigration.status === "failed"
      ) {
        const legacySettingsText = readLegacyCustomSnippetsSetting();
        const problems: string[] = [];
        const initialText =
          legacySettingsText.trim().length === 0
            ? serializeDefaultSnippetLibrary()
            : migrateLibraryTextToFactoryDefaults(
                '{\n  "version": 1,\n  "variables": {},\n  "snippets": []\n}\n',
                this.globalSnippetUri,
                legacySettingsText,
                problems,
              ) ?? serializeDefaultSnippetLibrary();
        const createStatus = await this.createGlobalSnippetFileIfAbsent(
          new TextEncoder().encode(initialText),
        );
        if (createStatus === "dirty") {
          if (!this.warnedDirtyEnsure) {
            this.warnedDirtyEnsure = true;
            void vscode.window.showWarningMessage(
              "TeXLeaf: 全局 Snippet 文件在初始化期间出现未保存内容；未写入或覆盖文件。请保存或撤销后重新加载。",
            );
          }
          return this.globalSnippetUri;
        }
        if (publisherMigration.status === "invalid") {
          void vscode.window.showWarningMessage(
            `TeXLeaf 未复制旧 ${LEGACY_PUBLISHER_EXTENSION_ID} 全局片段：${publisherMigration.reason}。旧文件保持不变；新扩展已创建默认库，可修复旧文件后使用“TeXLeaf: 导入片段”。`,
          );
        } else if (publisherMigration.status === "failed") {
          void vscode.window.showWarningMessage(
            `TeXLeaf 读取或复制旧 ${LEGACY_PUBLISHER_EXTENSION_ID} 全局片段失败：${publisherMigration.reason}。旧文件保持不变；新扩展已创建默认库。`,
          );
        }
        if (problems.length > 0) {
          void vscode.window.showWarningMessage(
            `TeXLeaf 已创建完整全局片段库，但旧 texleaf.customSnippets 设置中有 ${problems.length} 个问题；无效定义未迁移。`,
          );
        }
      } else if (publisherMigration.status === "copied") {
        if (publisherMigration.sourceChangedAfterCopy) {
          void vscode.window.showWarningMessage(
            `TeXLeaf 已复制 ${LEGACY_PUBLISHER_EXTENSION_ID} 的一个已验证快照，但旧文件随后又发生了变化。两个文件均未删除；如需后续改动，请使用“TeXLeaf: 导入片段”。`,
          );
        } else {
          void vscode.window.showInformationMessage(
            `TeXLeaf 已把 ${LEGACY_PUBLISHER_EXTENSION_ID} 的全局 Snippet 复制到新扩展身份；旧文件已原样保留，不会删除。`,
          );
        }
      }
    }

    if (await uriExists(this.globalSnippetUri)) {
      await this.migrateGlobalSnippetFileIfNeeded();
    }
    return this.globalSnippetUri;
  }

  /**
   * Copy the previous publisher ID's profile-local library exactly once. The
   * source lives next to (not inside) this extension's globalStorageUri, so the
   * current VS Code profile remains the hard boundary of this migration.
   */
  private async tryMigrateLegacyPublisherGlobalSnippetFile(): Promise<
    LegacyPublisherMigrationResult
  > {
    const legacyUri = vscode.Uri.joinPath(
      this.globalStorageUri,
      "..",
      LEGACY_PUBLISHER_EXTENSION_ID,
      GLOBAL_SNIPPET_FILE_NAME,
    );
    if (urisReferToSameResource(legacyUri, this.globalSnippetUri)) {
      return { status: "absent" };
    }
    if (this.isSnippetDocumentDirty(legacyUri)) {
      return {
        status: "deferred",
        reason:
          `TeXLeaf: 旧 ${LEGACY_PUBLISHER_EXTENSION_ID} 全局 Snippet 文件有未保存内容；` +
          "为避免复制过期磁盘快照，迁移已暂缓且未创建新文件。请先保存或撤销，再重新加载窗口。",
      };
    }

    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(legacyUri);
    } catch (error) {
      if (isFileNotFound(error)) {
        return { status: "absent" };
      }
      return { status: "failed", reason: errorMessage(error) };
    }
    if (bytes.byteLength > MAX_MANAGED_LIBRARY_BYTES) {
      return {
        status: "invalid",
        reason: `旧片段库超过 ${Math.floor(MAX_MANAGED_LIBRARY_BYTES / 1_000_000)} MB 安全上限`,
      };
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      return {
        status: "invalid",
        reason: `旧片段库不是有效 UTF-8：${errorMessage(error)}`,
      };
    }
    const validation = validateMigratableSnippetLibraryText(text);
    if (!validation.ok) {
      return { status: "invalid", reason: validation.reason };
    }
    if (validation.snippetCount > MAX_MANAGED_SNIPPETS) {
      return {
        status: "invalid",
        reason: `旧片段数量超过 ${MAX_MANAGED_SNIPPETS} 条安全上限`,
      };
    }

    const sourceHash = hashBytes(bytes);
    let createStatus: InitialGlobalFileCreateStatus;
    try {
      createStatus = await this.createGlobalSnippetFileIfAbsent(bytes, {
        uri: legacyUri,
        expectedHash: sourceHash,
      });
    } catch (error) {
      return { status: "failed", reason: errorMessage(error) };
    }
    if (createStatus === "exists") {
      return { status: "target-exists" };
    }
    if (createStatus === "dirty") {
      return {
        status: "deferred",
        reason:
          "TeXLeaf: 迁移期间片段编辑器出现了未保存内容；未创建或覆盖新文件。请保存或撤销后重新加载。",
      };
    }
    if (createStatus === "source-changed") {
      return {
        status: "deferred",
        reason:
          `TeXLeaf: 旧 ${LEGACY_PUBLISHER_EXTENSION_ID} 全局 Snippet 在迁移期间发生变化；` +
          "未创建或覆盖新文件。请等待保存完成后重新加载。",
      };
    }

    let sourceChangedAfterCopy = false;
    try {
      sourceChangedAfterCopy =
        hashBytes(await vscode.workspace.fs.readFile(legacyUri)) !== sourceHash;
    } catch {
      // The exclusive target create already committed a verified snapshot. A
      // later source delete/read failure cannot be rolled back safely, so make
      // that snapshot semantics explicit to the user instead.
      sourceChangedAfterCopy = true;
    }
    return { status: "copied", sourceChangedAfterCopy };
  }

  /**
   * Atomically create the canonical global file without replacing a winner.
   * When `source` is supplied, its exact bytes are rechecked immediately before
   * the exclusive rename so a save racing first activation is deferred.
   */
  private async createGlobalSnippetFileIfAbsent(
    bytes: Uint8Array,
    source?: { readonly uri: vscode.Uri; readonly expectedHash: string },
  ): Promise<InitialGlobalFileCreateStatus> {
    if (
      this.isGlobalSnippetDocumentDirty() ||
      (source !== undefined && this.isSnippetDocumentDirty(source.uri))
    ) {
      return "dirty";
    }
    if (await uriExists(this.globalSnippetUri)) {
      return "exists";
    }

    const temporaryUri = vscode.Uri.joinPath(
      this.globalStorageUri,
      `.texleaf-snippets.${randomUUID()}.initial.tmp`,
    );
    const desiredHash = hashBytes(bytes);
    await vscode.workspace.fs.writeFile(temporaryUri, bytes);
    try {
      const verification = await vscode.workspace.fs.readFile(temporaryUri);
      if (hashBytes(verification) !== desiredHash) {
        throw new Error("首次初始化的临时文件写入后校验失败");
      }
      if (
        this.isGlobalSnippetDocumentDirty() ||
        (source !== undefined && this.isSnippetDocumentDirty(source.uri))
      ) {
        return "dirty";
      }
      if (await uriExists(this.globalSnippetUri)) {
        return "exists";
      }
      if (source !== undefined) {
        let latestSource: Uint8Array;
        try {
          latestSource = await vscode.workspace.fs.readFile(source.uri);
        } catch {
          return "source-changed";
        }
        if (hashBytes(latestSource) !== source.expectedHash) {
          return "source-changed";
        }
      }

      const marker: SelfWriteMarker = {
        contentHash: desiredHash,
        expiresAt: Date.now() + SELF_WRITE_MARKER_LIFETIME_MS,
      };
      this.selfWriteMarkers.set(this.globalSnippetUri.toString(), marker);
      try {
        await vscode.workspace.fs.rename(temporaryUri, this.globalSnippetUri, {
          overwrite: false,
        });
      } catch (error) {
        if (this.selfWriteMarkers.get(this.globalSnippetUri.toString()) === marker) {
          this.selfWriteMarkers.delete(this.globalSnippetUri.toString());
        }
        if (await uriExists(this.globalSnippetUri)) {
          return "exists";
        }
        throw error;
      }

      const committed = await vscode.workspace.fs.readFile(this.globalSnippetUri);
      if (hashBytes(committed) !== desiredHash) {
        // An external writer replaced the just-created file. Never overwrite
        // that newer winner merely to make this initialization appear to win.
        if (this.selfWriteMarkers.get(this.globalSnippetUri.toString()) === marker) {
          this.selfWriteMarkers.delete(this.globalSnippetUri.toString());
        }
        return "exists";
      }
      return "created";
    } finally {
      try {
        await vscode.workspace.fs.delete(temporaryUri, { recursive: false });
      } catch (error) {
        if (!isFileNotFound(error)) {
          // A uniquely named orphan is safer than any broad cleanup attempt.
        }
      }
    }
  }

  /**
   * Replace the canonical library only if it still matches `expectedHash`.
   * Every changed file is backed up byte-for-byte before the atomic replace.
   * This is the only write path used by the Settings Sync mirror.
   */
  public async replaceGlobalSnippetFile(
    bytes: Uint8Array,
    expectedHash: string,
  ): Promise<"written" | "changed"> {
    const result = await this.replaceGlobalSnippetFileWithBackup(
      bytes,
      expectedHash,
      "sync",
    );
    return result.status;
  }

  public async restoreDefaultSnippets(): Promise<RestoreDefaultsResult> {
    await this.ensureGlobalSnippetFile();
    if (this.rejectDirtyGlobalDocument("恢复默认片段")) {
      return { status: "cancelled" };
    }

    let baselineBytes: Uint8Array;
    try {
      baselineBytes = await vscode.workspace.fs.readFile(this.globalSnippetUri);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `TeXLeaf 无法读取全局片段文件，未恢复默认：${errorMessage(error)}`,
      );
      return { status: "cancelled" };
    }
    const baselineHash = hashBytes(baselineBytes);
    const confirmation = "恢复默认并创建备份";
    const selected = await vscode.window.showWarningMessage(
      "恢复 TeXLeaf 默认片段？",
      {
        modal: true,
        detail:
          "这会用当前版本附带的完整默认库替换全局 Snippet 文件。现有内容会先原样备份；如果已启用 VS Code Settings Sync，恢复结果也会同步到其他设备。",
      },
      confirmation,
    );
    if (selected !== confirmation || this.rejectDirtyGlobalDocument("恢复默认片段")) {
      return { status: "cancelled" };
    }

    let result: ReplaceWithBackupResult;
    try {
      result = await this.replaceGlobalSnippetFileWithBackup(
        new TextEncoder().encode(serializeDefaultSnippetLibrary()),
        baselineHash,
        "restore",
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        `TeXLeaf 恢复默认片段失败；原文件未被替换：${errorMessage(error)}`,
      );
      return { status: "cancelled" };
    }
    if (result.status === "changed") {
      void vscode.window.showErrorMessage(
        "TeXLeaf: 确认期间全局片段文件已发生变化。为避免覆盖修改，本次恢复已取消，请重试。",
      );
      return { status: "cancelled" };
    }

    await this.reload();
    if (!(await this.isGlobalSnippetFileCurrent())) {
      void vscode.window.showErrorMessage(
        "TeXLeaf 已写入默认文件，但重新加载验证失败。请打开全局 Snippet 文件检查；恢复前备份仍然保留。",
      );
      return { status: "cancelled" };
    }

    return {
      status: "restored",
      count: createDefaultSnippetLibrary().snippets.length,
      ...(result.backupUri === undefined ? {} : { backupUri: result.backupUri }),
    };
  }

  public isGlobalSnippetDocumentDirty(): boolean {
    return this.isSnippetDocumentDirty(this.globalSnippetUri);
  }

  private isSnippetDocumentDirty(uri: vscode.Uri): boolean {
    return vscode.workspace.textDocuments.some(
      (document) =>
        document.isDirty &&
        urisReferToSameResource(document.uri, uri),
    );
  }

  private async migrateGlobalSnippetFileIfNeeded(): Promise<void> {
    let baselineBytes: Uint8Array;
    let baselineText: string;
    try {
      baselineBytes = await vscode.workspace.fs.readFile(this.globalSnippetUri);
      baselineText = new TextDecoder("utf-8", { fatal: true }).decode(baselineBytes);
    } catch (error) {
      void vscode.window.showWarningMessage(
        `TeXLeaf 无法检查全局片段库迁移：${errorMessage(error)}`,
      );
      return;
    }

    const legacySettingsText = readLegacyCustomSnippetsSetting();
    const problems: string[] = [];
    let migratedText: string | undefined;
    try {
      migratedText = migrateLibraryTextToFactoryDefaults(
        baselineText,
        this.globalSnippetUri,
        legacySettingsText,
        problems,
      );
    } catch (error) {
      void vscode.window.showWarningMessage(
        "TeXLeaf 未修改现有全局 Snippet 文件，因为它不是有效 JSONC。请修复该文件，或运行“TeXLeaf: 恢复默认片段”。",
      );
      this.reportProblems(this.globalSnippetUri, [errorMessage(error)]);
      return;
    }
    if (migratedText === undefined) {
      return;
    }

    try {
      const result = await this.replaceGlobalSnippetFileWithBackup(
        new TextEncoder().encode(migratedText),
        hashBytes(baselineBytes),
        "migration",
      );
      if (result.status === "changed") {
        // Another window won the first-run race. Its next reload/activation will
        // inspect the winning file, so never overwrite it here.
        return;
      }
      if (problems.length > 0) {
        void vscode.window.showWarningMessage(
          `TeXLeaf 已把默认片段合并到全局文件，但旧片段数据中有 ${problems.length} 个问题；无效定义未迁移。`,
        );
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `TeXLeaf 无法把默认片段迁移到全局文件；原文件保持不变：${errorMessage(error)}`,
      );
    }
  }

  private async replaceGlobalSnippetFileWithBackup(
    bytes: Uint8Array,
    expectedHash: string,
    reason: "migration" | "restore" | "sync" | "edit",
  ): Promise<ReplaceWithBackupResult> {
    // Reject malformed or structurally unrelated sync/reset payloads before a
    // backup or target write is attempted.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parseLibraryText(text, this.globalSnippetUri, []);

    if (this.isGlobalSnippetDocumentDirty()) {
      return { status: "changed" };
    }
    const currentBytes = await vscode.workspace.fs.readFile(this.globalSnippetUri);
    if (hashBytes(currentBytes) !== expectedHash) {
      return { status: "changed" };
    }
    if (hashBytes(currentBytes) === hashBytes(bytes)) {
      return { status: "written" };
    }

    const backupUri = await this.createVerifiedBackup(currentBytes, reason);
    if (this.isGlobalSnippetDocumentDirty()) {
      return { status: "changed" };
    }
    const latestBytes = await vscode.workspace.fs.readFile(this.globalSnippetUri);
    if (hashBytes(latestBytes) !== expectedHash) {
      return { status: "changed" };
    }
    await this.atomicWriteGlobalSnippetFile(bytes);
    return { status: "written", backupUri };
  }

  private async createVerifiedBackup(
    bytes: Uint8Array,
    reason: "migration" | "restore" | "sync" | "edit",
  ): Promise<vscode.Uri> {
    const directory = vscode.Uri.joinPath(
      this.globalStorageUri,
      GLOBAL_BACKUP_DIRECTORY_NAME,
    );
    await vscode.workspace.fs.createDirectory(directory);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupUri = vscode.Uri.joinPath(
      directory,
      `texleaf-snippets.${reason}.${timestamp}.${randomUUID()}.jsonc`,
    );
    await vscode.workspace.fs.writeFile(backupUri, bytes);
    const verification = await vscode.workspace.fs.readFile(backupUri);
    if (hashBytes(verification) !== hashBytes(bytes)) {
      throw new Error("备份写入后校验失败");
    }
    return backupUri;
  }

  private async atomicWriteGlobalSnippetFile(bytes: Uint8Array): Promise<void> {
    if (this.isGlobalSnippetDocumentDirty()) {
      throw new Error("全局 Snippet 文件在替换前出现未保存内容");
    }
    const temporaryUri = vscode.Uri.joinPath(
      this.globalStorageUri,
      `.texleaf-snippets.${randomUUID()}.tmp`,
    );
    await vscode.workspace.fs.writeFile(temporaryUri, bytes);
    try {
      const verification = await vscode.workspace.fs.readFile(temporaryUri);
      if (hashBytes(verification) !== hashBytes(bytes)) {
        throw new Error("临时文件写入后校验失败");
      }
      const desiredHash = hashBytes(bytes);
      const marker: SelfWriteMarker = {
        contentHash: desiredHash,
        expiresAt: Date.now() + SELF_WRITE_MARKER_LIFETIME_MS,
      };
      this.selfWriteMarkers.set(this.globalSnippetUri.toString(), marker);
      try {
        await vscode.workspace.fs.rename(temporaryUri, this.globalSnippetUri, {
          overwrite: true,
        });
        const committed = await vscode.workspace.fs.readFile(
          this.globalSnippetUri,
        );
        if (hashBytes(committed) !== desiredHash) {
          throw new Error(
            "全局 Snippet 文件在替换后立即被其他写入覆盖；未确认本次保存。",
          );
        }
      } catch (error) {
        if (this.selfWriteMarkers.get(this.globalSnippetUri.toString()) === marker) {
          this.selfWriteMarkers.delete(this.globalSnippetUri.toString());
        }
        throw error;
      }
    } finally {
      try {
        await vscode.workspace.fs.delete(temporaryUri, { recursive: false });
      } catch (error) {
        if (!isFileNotFound(error)) {
          // The target replace already succeeded or failed independently; a
          // stranded uniquely named temp file is safer than deleting broadly.
        }
      }
    }
  }

  private async writeGlobalSnippetFile(
    uri: vscode.Uri,
    bytes: Uint8Array,
  ): Promise<void> {
    const key = uri.toString();
    const marker: SelfWriteMarker = {
      contentHash: hashBytes(bytes),
      expiresAt: Date.now() + SELF_WRITE_MARKER_LIFETIME_MS,
    };
    this.selfWriteMarkers.set(key, marker);
    try {
      await vscode.workspace.fs.writeFile(uri, bytes);
    } catch (error) {
      if (this.selfWriteMarkers.get(key) === marker) {
        this.selfWriteMarkers.delete(key);
      }
      throw error;
    }
  }

  private rejectDirtyGlobalDocument(action: string): boolean {
    const dirty = this.isGlobalSnippetDocumentDirty();
    if (dirty) {
      void vscode.window.showWarningMessage(
        `TeXLeaf: 全局 Snippet 配置文件有未保存的修改。请先保存或撤销这些修改，再执行“${action}”。`,
      );
    }
    return dirty;
  }
}

function managedLibraryFromText(
  text: string,
  uri: vscode.Uri,
  revision: string,
): ManagedSnippetLibrary {
  const errors: ParseError[] = [];
  const root = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  const firstError = errors[0];
  if (firstError !== undefined) {
    throw new Error(
      `内部片段库 JSONC 解析失败：${printParseErrorCode(firstError.error)}（偏移 ${firstError.offset}）。`,
    );
  }

  const problems: string[] = [];
  const parsed = coerceLibrary(root, problems);
  const rawCount = rawSnippetEntryCount(root);
  if (rawCount !== undefined && rawCount !== parsed.snippets.length) {
    problems.push("片段数组中含非对象条目；请在高级 JSONC 编辑器中修复。");
  }
  const records = parsed.snippets.map((snippet, index) =>
    normalizeSnippet(snippet, "global", uri, index, problems),
  );
  if (records.some((record) => record === undefined)) {
    problems.push("至少一个片段无法转换为结构化记录。");
  }
  if (problems.length > 0) {
    throw new Error(
      `内部片段库含无法安全结构化编辑的内容：${problems[0]} 原文件未被修改，可使用高级 JSONC 编辑器修复。`,
    );
  }

  const ids = new Set<string>();
  const snippets: ManagedSnippet[] = [];
  for (const record of records) {
    if (record === undefined) {
      continue;
    }
    if (ids.has(record.portableId)) {
      throw new Error(
        `内部片段库含重复 id：${record.portableId}。原文件未被修改，请先在高级 JSONC 编辑器中修复。`,
      );
    }
    ids.add(record.portableId);
    snippets.push({
      id: record.portableId,
      trigger: record.trigger,
      replacement: record.replacement,
      options: record.options,
      priority: record.priority,
      ...(record.description === undefined
        ? {}
        : { description: record.description }),
      category: record.category,
      ...(record.flags === undefined ? {} : { flags: record.flags }),
      syntaxVersion: record.syntaxVersion,
      enabled: record.enabled,
    });
  }
  return {
    revision,
    ...(parsed.defaultsRevision === undefined
      ? {}
      : { defaultsRevision: parsed.defaultsRevision }),
    variables: { ...parsed.variables },
    snippets,
  };
}

function serializeManagedLibrary(
  model: Omit<ManagedSnippetLibrary, "revision">,
  defaultsRevision: number,
  uri: vscode.Uri,
): Uint8Array {
  if (
    !Number.isInteger(defaultsRevision) ||
    defaultsRevision < 0 ||
    defaultsRevision > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("片段库 defaultsRevision 无效。");
  }
  if (!isObject(model.variables) || !Array.isArray(model.snippets)) {
    throw new Error("结构化片段库缺少 variables 对象或 snippets 数组。");
  }
  if (model.snippets.length > MAX_MANAGED_SNIPPETS) {
    throw new Error(`片段数量不能超过 ${MAX_MANAGED_SNIPPETS} 条。`);
  }

  const variables: Record<string, string> = {};
  const variableEntries = Object.entries(model.variables);
  if (variableEntries.length > 10_000) {
    throw new Error("片段变量不能超过 10000 个。");
  }
  for (const [name, value] of variableEntries) {
    if (
      name.length === 0 ||
      name.length > 256 ||
      typeof value !== "string" ||
      value.length > 1_000_000 ||
      name.includes("\0") ||
      value.includes("\0")
    ) {
      throw new Error(`片段变量 ${JSON.stringify(name)} 的名称或值无效。`);
    }
    variables[name] = value;
  }

  const ids = new Set<string>();
  const snippets: Record<string, unknown>[] = [];
  for (let index = 0; index < model.snippets.length; index += 1) {
    const candidate = model.snippets[index];
    if (!isObject(candidate)) {
      throw new Error(`第 ${index + 1} 条片段不是对象。`);
    }
    const id = candidate.id;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > 256 ||
      id !== id.trim() ||
      id.includes("\0")
    ) {
      throw new Error(`第 ${index + 1} 条片段的 id 无效。`);
    }
    if (ids.has(id)) {
      throw new Error(`片段 id 重复：${id}。`);
    }
    ids.add(id);

    if (
      typeof candidate.trigger !== "string" ||
      candidate.trigger.length === 0 ||
      candidate.trigger.length > 4_096 ||
      candidate.trigger.includes("\0") ||
      typeof candidate.replacement !== "string" ||
      candidate.replacement.length > 1_000_000 ||
      candidate.replacement.includes("\0") ||
      typeof candidate.options !== "string" ||
      candidate.options.length > 32 ||
      typeof candidate.priority !== "number" ||
      !Number.isFinite(candidate.priority) ||
      typeof candidate.category !== "string" ||
      candidate.category.length > 256 ||
      candidate.category.includes("\0") ||
      (candidate.description !== undefined &&
        (typeof candidate.description !== "string" ||
          candidate.description.length > 16_384 ||
          candidate.description.includes("\0"))) ||
      (candidate.flags !== undefined &&
        (typeof candidate.flags !== "string" ||
          candidate.flags.length > 16 ||
          candidate.flags.includes("\0"))) ||
      (candidate.syntaxVersion !== 1 && candidate.syntaxVersion !== 2) ||
      typeof candidate.enabled !== "boolean"
    ) {
      throw new Error(`第 ${index + 1} 条片段包含无效字段。`);
    }

    const raw: RawSnippetObject = {
      id,
      trigger: candidate.trigger,
      replacement: candidate.replacement,
      options: candidate.options,
      priority: candidate.priority,
      ...(candidate.description === undefined
        ? {}
        : { description: candidate.description }),
      category: candidate.category,
      ...(candidate.flags === undefined ? {} : { flags: candidate.flags }),
      syntaxVersion: candidate.syntaxVersion,
      enabled: candidate.enabled,
    };
    const problems: string[] = [];
    const normalized = normalizeSnippet(raw, "global", uri, index, problems);
    if (normalized === undefined || problems.length > 0) {
      throw new Error(
        `第 ${index + 1} 条片段无效：${problems[0] ?? "无法规范化"}`,
      );
    }
    if (normalized.options.includes("r")) {
      let regex: RegExp;
      try {
        regex = new RegExp(
          `(?:${normalized.trigger})(?![\\s\\S])`,
          normalized.flags ?? "",
        );
      } catch (error) {
        throw new Error(
          `正则触发词 ${JSON.stringify(normalized.trigger)} 无效：${errorMessage(error)}`,
        );
      }
      if (regex.test("")) {
        throw new Error(
          `正则触发词 ${JSON.stringify(normalized.trigger)} 不能匹配空字符串。`,
        );
      }
    }
    snippets.push({
      id: normalized.portableId,
      trigger: normalized.trigger,
      replacement: normalized.replacement,
      options: normalized.options,
      ...(normalized.priority === 0 ? {} : { priority: normalized.priority }),
      ...(normalized.description === undefined
        ? {}
        : { description: normalized.description }),
      // Structured edits must round-trip even a user-chosen category named
      // "Workspace"; the generic portable exporter omits that source default.
      category: normalized.category,
      ...(normalized.flags === undefined ? {} : { flags: normalized.flags }),
      ...(normalized.syntaxVersion === 2
        ? {}
        : { syntaxVersion: normalized.syntaxVersion }),
      ...(normalized.enabled ? {} : { enabled: false }),
    });
  }

  const output = {
    version: 1,
    defaultsRevision,
    variables,
    snippets,
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(output, null, 2)}\n`);
  if (bytes.byteLength > MAX_MANAGED_LIBRARY_BYTES) {
    throw new Error(
      `片段库超过 ${Math.floor(MAX_MANAGED_LIBRARY_BYTES / 1_000_000)} MB 安全上限。`,
    );
  }
  parseLibraryText(new TextDecoder().decode(bytes), uri, []);
  return bytes;
}

function rawSnippetEntryCount(root: unknown): number | undefined {
  if (Array.isArray(root)) {
    return root.length;
  }
  if (!isObject(root)) {
    return undefined;
  }
  if (Array.isArray(root.snippets)) {
    return root.snippets.length;
  }
  if (typeof root.snippets !== "string") {
    return undefined;
  }
  const errors: ParseError[] = [];
  const nested = parse(root.snippets, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  return errors.length === 0 && Array.isArray(nested)
    ? nested.length
    : undefined;
}

function normalizeSnippet(
  input: RawSnippetObject,
  source: SnippetSourceKind,
  uri: vscode.Uri,
  order: number,
  problems: string[],
): SnippetRecord | undefined {
  if (typeof input.trigger !== "string" || input.trigger.length === 0) {
    problems.push(`第 ${order + 1} 条片段缺少非空 trigger。`);
    return undefined;
  }
  if (typeof input.replacement !== "string") {
    problems.push(
      `触发器 ${JSON.stringify(input.trigger)} 的 replacement 不是字符串；为安全起见已跳过函数片段。`,
    );
    return undefined;
  }

  const options = typeof input.options === "string" ? input.options : "";
  const illegalOptions = [...options].filter(
    (option) => !"tMmnrAvw".includes(option),
  );
  if (illegalOptions.length > 0) {
    problems.push(
      `触发器 ${JSON.stringify(input.trigger)} 含未知 options：${illegalOptions.join("")}。`,
    );
    return undefined;
  }
  if (options.includes("r") && options.includes("v")) {
    problems.push(`触发器 ${JSON.stringify(input.trigger)} 不能同时使用 r 和 v。`);
    return undefined;
  }

  const rawVersion = input.syntaxVersion ?? input.version;
  const syntaxVersion: 1 | 2 = rawVersion === 1 ? 1 : 2;
  const baseId =
    typeof input.id === "string" && input.id.trim().length > 0
      ? input.id.trim()
      : `${slugify(input.trigger)}-${shortHash(
          `${input.trigger}\u0000${input.replacement}\u0000${options}`,
        )}`;
  return {
    id: `${source}:${uri.toString()}:${baseId}`,
    portableId: baseId,
    trigger: input.trigger,
    replacement: input.replacement,
    options,
    priority:
      typeof input.priority === "number" && Number.isFinite(input.priority)
        ? input.priority
        : 0,
    ...(typeof input.description === "string"
      ? { description: input.description }
      : {}),
    category:
      typeof input.category === "string" && input.category.trim().length > 0
        ? input.category.trim()
        : source === "global"
          ? "User"
          : "Workspace",
    ...(typeof input.flags === "string" ? { flags: input.flags } : {}),
    syntaxVersion,
    enabled: input.enabled !== false,
    source,
    sourceLabel: snippetSourceLabel(source, uri),
    sourceUri: uri,
    order,
  };
}

function snippetSourceLabel(source: SnippetSourceKind, uri: vscode.Uri): string {
  switch (source) {
    case "global":
      return "全局片段";
    case "workspace": {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      return folder === undefined
        ? "工作区附加片段"
        : `${folder.name} · 工作区附加片段`;
    }
  }
}

function parseLibraryText(
  text: string,
  uri: vscode.Uri,
  problems: string[],
): ParsedLibrary {
  const errors: ParseError[] = [];
  const value = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0) {
    const firstError = errors[0];
    throw new Error(
      firstError === undefined
        ? `${uri.path}: JSONC 解析失败`
        : `${uri.path}: ${printParseErrorCode(firstError.error)} at ${firstError.offset}`,
    );
  }
  return coerceLibrary(value, problems);
}

function coerceLibrary(value: unknown, problems: string[]): ParsedLibrary {
  if (Array.isArray(value)) {
    return {
      snippets: value.filter(isObject),
      variables: {},
    };
  }
  if (!isObject(value)) {
    throw new Error("片段文件顶层必须是数组或包含 snippets 的对象。");
  }

  const rawSnippets = Array.isArray(value.snippets)
    ? value.snippets
    : typeof value.snippets === "string"
      ? parseLegacyJsonSnippetString(value.snippets, problems)
      : [];
  if (!Array.isArray(value.snippets) && typeof value.snippets !== "string") {
    problems.push("顶层对象缺少 snippets 数组。");
  }

  const variables: Record<string, string> = {};
  const rawVariables = value.variables ?? value.snippetVariables;
  if (isObject(rawVariables)) {
    for (const [rawKey, rawValue] of Object.entries(rawVariables)) {
      if (typeof rawValue !== "string") {
        problems.push(`变量 ${rawKey} 的值不是字符串，已忽略。`);
        continue;
      }
      variables[rawKey.replace(/^\$\{(.+)\}$/, "$1")] = rawValue;
    }
  }
  return {
    snippets: rawSnippets.filter(isObject),
    variables,
    ...(typeof value.defaultsRevision === "number" &&
    Number.isInteger(value.defaultsRevision)
      ? { defaultsRevision: value.defaultsRevision }
      : {}),
  };
}

function parseLegacyJsonSnippetString(
  value: string,
  problems: string[],
): RawSnippetObject[] {
  const errors: ParseError[] = [];
  const parsed = parse(value, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length === 0 && Array.isArray(parsed)) {
    return parsed.filter(isObject);
  }
  problems.push(
    "检测到 JavaScript/TypeScript 片段字符串；TeXLeaf 不执行代码，仅可导入有效 JSON 数组。",
  );
  return [];
}

/**
 * One-time 0.2.x migration into the single editable global library. Existing
 * entries and variables always win; legacy user-setting entries come next;
 * factory entries are appended only when their stable identity is absent.
 */
function migrateLibraryTextToFactoryDefaults(
  baselineText: string,
  uri: vscode.Uri,
  legacySettingsText: string,
  problems: string[],
): string | undefined {
  const rootErrors: ParseError[] = [];
  const root = parse(baselineText, rootErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (rootErrors.length > 0) {
    const first = rootErrors[0];
    throw new Error(
      first === undefined
        ? `${uri.path}: JSONC 解析失败`
        : `${uri.path}: ${printParseErrorCode(first.error)} at ${first.offset}`,
    );
  }
  const existing = coerceLibrary(root, problems);
  if (
    existing.defaultsRevision !== undefined &&
    existing.defaultsRevision >= FACTORY_DEFAULTS_REVISION
  ) {
    return undefined;
  }

  const upgradingMaterializedRevisionOne = existing.defaultsRevision === 1;
  const upgradingMaterializedRevisionTwo = existing.defaultsRevision === 2;
  const hasMaterializedFactoryRevision =
    existing.defaultsRevision !== undefined && existing.defaultsRevision >= 1;
  let legacy: ParsedLibrary = { snippets: [], variables: {} };
  // A materialized library has already consumed the retired setting. Re-reading
  // it on a later revision could resurrect a user-deleted legacy snippet.
  if (!hasMaterializedFactoryRevision && legacySettingsText.trim().length > 0) {
    try {
      legacy = parseLibraryText(
        legacySettingsText,
        vscode.Uri.parse("texleaf-settings:/custom-snippets.jsonc"),
        problems,
      );
    } catch (error) {
      problems.push(`旧 texleaf.customSnippets 设置未迁移：${errorMessage(error)}`);
    }
  }

  // Revision 2 renamed the untouched factory inline-math trigger from `mk` to
  // `lm`. Stable IDs normally make user entries win over factory updates, so
  // handle this one intentional rename narrowly: only the exact revision-1
  // factory record is changed. A disabled, renamed, reworded, or otherwise
  // customized entry is preserved byte-for-byte.
  const inlineTriggerUpgradeIndex = existing.defaultsRevision === 1
    ? existing.snippets.findIndex(isRevisionOneFactoryInlineSnippet)
    : -1;
  const inlineTriggerUpgradeRawIndex =
    existing.defaultsRevision === 1 && isObject(root) && Array.isArray(root.snippets)
      ? root.snippets.findIndex(
          (snippet) =>
            isObject(snippet) && isRevisionOneFactoryInlineSnippet(snippet),
        )
      : -1;
  const migratedExistingSnippets = existing.snippets.map((snippet, index) => {
    if (index === inlineTriggerUpgradeIndex) {
      return { ...snippet, trigger: "lm" };
    }
    if (upgradingMaterializedRevisionTwo) {
      const upgraded = upgradeRevisionTwoTheoremFactorySnippet(
        snippet,
        existing.snippets,
      );
      if (upgraded !== undefined) {
        return { ...upgraded };
      }
    }
    return snippet;
  });

  const theoremTriggerUpgrades: Array<{
    readonly rawIndex: number;
    readonly trigger: string;
    readonly options: string;
  }> = [];
  if (
    upgradingMaterializedRevisionTwo &&
    isObject(root) &&
    Array.isArray(root.snippets)
  ) {
    root.snippets.forEach((snippet, rawIndex) => {
      const upgraded = upgradeRevisionTwoTheoremFactorySnippet(
        snippet,
        root.snippets as readonly unknown[],
      );
      if (
        upgraded !== undefined &&
        typeof upgraded.trigger === "string" &&
        typeof upgraded.options === "string"
      ) {
        theoremTriggerUpgrades.push({
          rawIndex,
          trigger: upgraded.trigger,
          options: upgraded.options,
        });
      }
    });
  }

  const factory = createDefaultSnippetLibrary();
  const factorySnippets = factory.snippets.filter(isObject);
  const existingKeys = new Set(migratedExistingSnippets.map(rawSnippetKey));
  const additions: RawSnippetObject[] = [];
  const factoryCandidates = upgradingMaterializedRevisionOne
    ? factorySnippets.filter(
        (snippet) =>
          typeof snippet.id === "string" &&
          REVISION_TWO_FACTORY_SNIPPET_IDS.has(snippet.id),
      )
    : hasMaterializedFactoryRevision
      ? []
      : factorySnippets;
  for (const snippet of [...legacy.snippets, ...factoryCandidates]) {
    const key = rawSnippetKey(snippet);
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      additions.push(snippet);
    }
  }
  // Missing variables in a materialized file may be an intentional deletion.
  // Revisions 2 and 3 introduce no variables, so leave that map alone.
  const variablesToAdd = hasMaterializedFactoryRevision
    ? {}
    : { ...DEFAULT_VARIABLES, ...legacy.variables };
  const mergedVariables = { ...variablesToAdd, ...existing.variables };
  const mergedSnippets = [...migratedExistingSnippets, ...additions];
  const formattingOptions = inferFormattingOptions(baselineText);

  if (isObject(root) && Array.isArray(root.snippets)) {
    let output = baselineText;
    if (inlineTriggerUpgradeRawIndex >= 0) {
      output = applyEdits(
        output,
        modify(
          output,
          ["snippets", inlineTriggerUpgradeRawIndex, "trigger"],
          "lm",
          { formattingOptions },
        ),
      );
    }
    for (const upgrade of theoremTriggerUpgrades) {
      output = applyEdits(
        output,
        modify(
          output,
          ["snippets", upgrade.rawIndex, "trigger"],
          upgrade.trigger,
          { formattingOptions },
        ),
      );
      output = applyEdits(
        output,
        modify(
          output,
          ["snippets", upgrade.rawIndex, "options"],
          upgrade.options,
          { formattingOptions },
        ),
      );
    }
    for (const snippet of additions) {
      output = applyEdits(
        output,
        modify(output, ["snippets", -1], snippet, {
          formattingOptions,
          isArrayInsertion: true,
        }),
      );
    }
    if (isObject(root.variables)) {
      for (const [name, value] of Object.entries(variablesToAdd)) {
        if (typeof root.variables[name] !== "string") {
          output = applyEdits(
            output,
            modify(output, ["variables", name], value, { formattingOptions }),
          );
        }
      }
    } else {
      output = applyEdits(
        output,
        modify(output, ["variables"], mergedVariables, { formattingOptions }),
      );
    }
    if (root.version !== 1) {
      output = applyEdits(
        output,
        modify(output, ["version"], 1, { formattingOptions }),
      );
    }
    output = applyEdits(
      output,
      modify(output, ["defaultsRevision"], FACTORY_DEFAULTS_REVISION, {
        formattingOptions,
      }),
    );
    return output.endsWith("\n") || output.endsWith("\r")
      ? output
      : `${output}${formattingOptions.eol ?? "\n"}`;
  }

  // Top-level arrays and legacy string-valued snippet lists cannot carry the
  // revision marker or be patched entry-by-entry. The exact original bytes are
  // backed up before this normalized representation is installed.
  const eol = formattingOptions.eol ?? "\n";
  const indent =
    formattingOptions.insertSpaces === false
      ? "\t"
      : formattingOptions.tabSize ?? 2;
  const preservedRoot = isObject(root) ? root : {};
  return `${JSON.stringify(
    {
      ...preservedRoot,
      version: 1,
      defaultsRevision: FACTORY_DEFAULTS_REVISION,
      variables: mergedVariables,
      snippets: mergedSnippets,
    },
    null,
    indent,
  )}${eol}`;
}

function mergeRawSnippets(
  existing: readonly RawSnippetObject[],
  imported: readonly RawSnippetObject[],
): RawSnippetObject[] {
  const result = [...existing];
  const indices = new Map<string, number>();
  result.forEach((snippet, index) => indices.set(rawSnippetKey(snippet), index));
  for (const snippet of imported) {
    const key = rawSnippetKey(snippet);
    const existingIndex = indices.get(key);
    if (existingIndex === undefined) {
      indices.set(key, result.length);
      result.push(snippet);
    } else {
      result[existingIndex] = snippet;
    }
  }
  return result;
}

function mergeLibraryTextPreservingJsonc(
  baselineText: string,
  existing: ParsedLibrary,
  importedSnippets: readonly RawSnippetObject[],
  importedVariables: Readonly<Record<string, string>>,
): string {
  const root = parse(baselineText, [], {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  const formattingOptions = inferFormattingOptions(baselineText);

  const mergedSnippets = mergeRawSnippets(existing.snippets, importedSnippets);
  const mergedVariables = { ...existing.variables, ...importedVariables };

  if (isObject(root) && Array.isArray(root.snippets)) {
    // Apply narrow edits so comments on unchanged snippet entries, unknown
    // top-level metadata, key ordering, and untouched whitespace all survive.
    let output = baselineText;
    const existingIndices = new Map<string, number>();
    root.snippets.forEach((candidate, index) => {
      if (isObject(candidate)) {
        existingIndices.set(rawSnippetKey(candidate), index);
      }
    });
    const finalImports = new Map<string, RawSnippetObject>();
    for (const snippet of importedSnippets) {
      finalImports.set(rawSnippetKey(snippet), snippet);
    }
    for (const [key, snippet] of finalImports) {
      const existingIndex = existingIndices.get(key);
      output = applyEdits(
        output,
        modify(
          output,
          existingIndex === undefined
            ? ["snippets", -1]
            : ["snippets", existingIndex],
          snippet,
          {
            formattingOptions,
            ...(existingIndex === undefined ? { isArrayInsertion: true } : {}),
          },
        ),
      );
    }

    if (isObject(root.variables)) {
      for (const [name, value] of Object.entries(importedVariables)) {
        output = applyEdits(
          output,
          modify(output, ["variables", name], value, { formattingOptions }),
        );
      }
    } else if (Object.keys(mergedVariables).length > 0) {
      output = applyEdits(
        output,
        modify(output, ["variables"], mergedVariables, { formattingOptions }),
      );
    }
    return output;
  }

  // Legacy top-level arrays and string-valued `snippets` cannot be safely
  // patched entry-by-entry. This is the sole fallback that reserializes text.
  const eol = formattingOptions.eol ?? "\n";
  const indent =
    formattingOptions.insertSpaces === false
      ? "\t"
      : formattingOptions.tabSize ?? 2;
  return `${JSON.stringify(
    { version: 1, variables: mergedVariables, snippets: mergedSnippets },
    null,
    indent,
  )}${eol}`;
}

function inferFormattingOptions(text: string): FormattingOptions {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /(?:^|\r?\n)([\t ]+)"/.exec(text)?.[1];
  const insertSpaces = indent?.includes("\t") !== true;
  return {
    eol,
    insertSpaces,
    tabSize:
      insertSpaces && indent !== undefined ? Math.max(1, indent.length) : 2,
  };
}

function rawSnippetKey(snippet: RawSnippetObject): string {
  return typeof snippet.id === "string" && snippet.id.length > 0
    ? `id:${snippet.id}`
    : `trigger:${String(snippet.trigger)}:${String(snippet.options ?? "")}`;
}

function isRevisionOneFactoryInlineSnippet(
  snippet: RawSnippetObject,
): boolean {
  const actualKeys = Object.keys(snippet);
  return (
    actualKeys.length === REVISION_ONE_FACTORY_INLINE_KEYS.size &&
    actualKeys.every((key) => REVISION_ONE_FACTORY_INLINE_KEYS.has(key)) &&
    snippet.id === "mode.inline" &&
    snippet.trigger === "mk" &&
    snippet.replacement === "\\(@0\\)" &&
    snippet.options === "tA" &&
    snippet.description === "Inline math" &&
    snippet.category === "Math mode" &&
    snippet.priority === undefined &&
    snippet.flags === undefined &&
    snippet.syntaxVersion === undefined &&
    snippet.version === undefined &&
    snippet.enabled === undefined
  );
}

function joinRelativePath(base: vscode.Uri, relativePath: string): vscode.Uri {
  return vscode.Uri.joinPath(base, ...normalizeSlashes(relativePath).split("/"));
}

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function readLegacyCustomSnippetsSetting(): string {
  // Read only the user-level value during the 0.2.x one-time migration. A
  // workspace value must never be promoted into a cross-workspace global file.
  return (
    vscode.workspace
      .getConfiguration("texleaf")
      .inspect<string>("customSnippets")?.globalValue ?? ""
  );
}

function isSafeRelativePath(value: string): boolean {
  const normalized = normalizeSlashes(value.trim());
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.split("/").includes("..")
  );
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    return !isFileNotFound(error);
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === "FileNotFound";
}

function urisReferToSameResource(left: vscode.Uri, right: vscode.Uri): boolean {
  if (
    process.platform === "win32" &&
    left.scheme.toLowerCase() === "file" &&
    right.scheme.toLowerCase() === "file"
  ) {
    return left.fsPath.toLowerCase() === right.fsPath.toLowerCase();
  }
  return left.toString() === right.toString();
}

function isObject(
  value: unknown,
): value is RawSnippetObject & Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slugify(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
  return result.length > 0 ? result : "snippet";
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
