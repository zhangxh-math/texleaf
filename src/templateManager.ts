import { createHash, randomUUID } from "node:crypto";
import * as vscode from "vscode";
import {
  materializeReplacement,
  parseReplacementTemplate,
  type ReplacementPart,
} from "./core";
import {
  DEFAULT_TEMPLATES,
  type TemplateDefinition,
} from "./defaultTemplates";
import {
  ARTICLE_TEMPLATE_TRIGGER_MIGRATION_STATE_KEY,
  createManagedTemplateCatalog,
  decodeManagedTemplateCatalog,
  MAX_TEMPLATE_CONTENT_BYTES,
  TEMPLATE_LIBRARY_STATE_KEY,
  toStoredTemplateCatalog,
  type ManagedTemplate,
  type ManagedTemplateCatalog,
  type ManagedTemplateInput,
} from "./templateLibrary";
import { migrateLegacyFactoryTemplateTriggers } from "./templateTriggerMigration";

export type {
  ManagedTemplate,
  ManagedTemplateCatalog,
  ManagedTemplateInput,
} from "./templateLibrary";
export { TEMPLATE_LIBRARY_STATE_KEY } from "./templateLibrary";

const LEGACY_TEMPLATE_DIRECTORY_NAME = "templates";
const TEMPLATE_BACKUP_DIRECTORY_NAME = "backups";
const STATE_POLL_INTERVAL_MS = 15_000;

interface LoadedTemplate {
  readonly definition: ManagedTemplate;
  readonly parts: readonly ReplacementPart[];
}

export interface TemplateMatch {
  readonly definition: ManagedTemplate;
  readonly parts: readonly ReplacementPart[];
  readonly range: vscode.Range;
}

/**
 * Manages a profile-local, synchronisable template catalog in extension
 * globalState. The old globalStorageUri/templates/*.tex copies are read once
 * when no catalog exists, so existing customisations migrate without becoming
 * a permanent runtime dependency. They remain untouched as recovery sources.
 */
export class TemplateManager implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly loaded = new Map<string, LoadedTemplate>();
  private readonly factoryIds = new Set(DEFAULT_TEMPLATES.map(({ id }) => id));
  private currentCatalog: ManagedTemplateCatalog | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  public readonly onDidChange = this.changeEmitter.event;
  /** Kept public only so old diagnostics/tests can locate migration sources. */
  public readonly templateDirectoryUri: vscode.Uri;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: vscode.LogOutputChannel,
  ) {
    this.templateDirectoryUri = vscode.Uri.joinPath(
      context.globalStorageUri,
      LEGACY_TEMPLATE_DIRECTORY_NAME,
    );
  }

  public async initialize(): Promise<void> {
    try {
      this.applyCatalog(await this.ensureCatalog());
    } catch (error) {
      // Damaged synchronised state must not take down all TeXLeaf editing.
      this.logger.error(`模板目录初始化失败：${errorMessage(error)}`);
      this.applyCatalog(await this.createFactoryCatalog());
    }
    this.disposables.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          void this.reloadFromState();
        }
      }),
    );
    this.pollTimer = setInterval(() => {
      void this.reloadFromState();
    }, STATE_POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }

  public dispose(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.loaded.clear();
    this.currentCatalog = undefined;
    this.changeEmitter.dispose();
  }

  public match(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): TemplateMatch | undefined {
    return this.matchText(
      document,
      document.getText(),
      document.offsetAt(position),
    );
  }

  /** Match as though `typedText` had just been inserted at the cursor. */
  public matchAfterType(
    document: vscode.TextDocument,
    position: vscode.Position,
    typedText: string,
  ): TemplateMatch | undefined {
    if (typedText.length === 0 || /[\r\n]/u.test(typedText)) {
      return undefined;
    }
    const cursorOffset = document.offsetAt(position);
    const documentText = document.getText();
    const prospectiveText = `${documentText.slice(0, cursorOffset)}${typedText}${documentText.slice(cursorOffset)}`;
    return this.matchText(
      document,
      prospectiveText,
      cursorOffset + typedText.length,
    );
  }

  private matchText(
    document: vscode.TextDocument,
    documentText: string,
    cursorOffset: number,
  ): TemplateMatch | undefined {
    if (
      document.isUntitled ||
      !document.uri.path.toLocaleLowerCase("en-US").endsWith(".tex")
    ) {
      return undefined;
    }
    const candidates = [...this.loaded.values()].sort(
      (left, right) =>
        right.definition.trigger.length - left.definition.trigger.length,
    );
    for (const loaded of candidates) {
      const startOffset = cursorOffset - loaded.definition.trigger.length;
      if (
        startOffset < 0 ||
        documentText.slice(startOffset, cursorOffset) !==
          loaded.definition.trigger
      ) {
        continue;
      }
      if (
        documentText.slice(0, startOffset).trim().length > 0 ||
        documentText.slice(cursorOffset).trim().length > 0
      ) {
        continue;
      }
      return {
        definition: loaded.definition,
        parts: loaded.parts,
        range: new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        ),
      };
    }
    return undefined;
  }

  /** The old command now opens the integrated manager instead of a disk file. */
  public async openTemplateFile(): Promise<void> {
    await vscode.commands.executeCommand("texleaf.openSnippetEditor", "templates");
  }

  public async listTemplates(): Promise<ManagedTemplateCatalog> {
    try {
      const catalog = await this.readStoredCatalog();
      this.applyCatalogIfChanged(catalog);
      return cloneCatalog(catalog);
    } catch (error) {
      // initialize() deliberately keeps an in-memory factory fallback when a
      // synced value is malformed. Returning that fallback keeps the manager
      // reachable so its explicit “restore defaults” action can repair state;
      // ordinary Save still goes through readStoredCatalog() and refuses to
      // overwrite the malformed value implicitly.
      if (this.currentCatalog !== undefined) {
        this.logger.warn(
          `模板管理器正在显示可恢复的内存副本：${errorMessage(error)}`,
        );
        return cloneCatalog(this.currentCatalog);
      }
      throw error;
    }
  }

  /** Atomically replace the complete catalog from one manager Save action. */
  public async replaceTemplates(
    templates: readonly ManagedTemplate[],
    expectedCatalogRevision: string,
  ): Promise<ManagedTemplateCatalog> {
    const current = await this.readStoredCatalog();
    if (current.revision !== expectedCatalogRevision) {
      throw new Error(
        "模板目录已在另一个窗口或设备中发生变化。未覆盖新内容，请重新加载后再保存。",
      );
    }
    const next = createManagedTemplateCatalog(
      templates,
      randomUUID(),
      this.factoryIds,
    );
    await this.commitCatalog(next, current);
    return cloneCatalog(next);
  }

  public async createTemplate(
    input: ManagedTemplateInput,
    expectedCatalogRevision?: string,
  ): Promise<ManagedTemplate> {
    const current = await this.readStoredCatalog();
    if (
      expectedCatalogRevision !== undefined &&
      expectedCatalogRevision !== current.revision
    ) {
      throw new Error("模板目录已经变化，请重新加载后再添加。");
    }
    const id = `template.user.${randomUUID()}`;
    const candidate: ManagedTemplate = {
      id,
      name: input.name,
      trigger: input.trigger,
      description: input.description ?? "",
      content: input.content,
      isFactory: false,
    };
    const next = createManagedTemplateCatalog(
      [...current.templates, candidate],
      randomUUID(),
      this.factoryIds,
    );
    await this.commitCatalog(next, current);
    return { ...next.templates.find((template) => template.id === id)! };
  }

  public async updateTemplate(
    id: string,
    input: ManagedTemplateInput,
    expectedCatalogRevision?: string,
  ): Promise<ManagedTemplate> {
    const current = await this.readStoredCatalog();
    if (
      expectedCatalogRevision !== undefined &&
      expectedCatalogRevision !== current.revision
    ) {
      throw new Error("模板目录已经变化，请重新加载后再修改。");
    }
    const index = current.templates.findIndex((template) => template.id === id);
    if (index < 0) {
      throw new Error(`找不到模板：${id}。`);
    }
    const templates = current.templates.map((template, candidateIndex) =>
      candidateIndex === index
        ? {
            id: template.id,
            name: input.name,
            trigger: input.trigger,
            description: input.description ?? "",
            content: input.content,
            isFactory: template.isFactory,
          }
        : template,
    );
    const next = createManagedTemplateCatalog(
      templates,
      randomUUID(),
      this.factoryIds,
    );
    await this.commitCatalog(next, current);
    return { ...next.templates[index]! };
  }

  public async deleteTemplate(
    id: string,
    expectedCatalogRevision?: string,
  ): Promise<void> {
    const current = await this.readStoredCatalog();
    if (
      expectedCatalogRevision !== undefined &&
      expectedCatalogRevision !== current.revision
    ) {
      throw new Error("模板目录已经变化，请重新加载后再删除。");
    }
    const templates = current.templates.filter((template) => template.id !== id);
    if (templates.length === current.templates.length) {
      throw new Error(`找不到模板：${id}。`);
    }
    const next = createManagedTemplateCatalog(
      templates,
      randomUUID(),
      this.factoryIds,
    );
    await this.commitCatalog(next, current);
  }

  public async restoreDefaultTemplates(): Promise<ManagedTemplateCatalog> {
    const current = await this.readStoredCatalogAllowInvalid();
    const next = await this.createFactoryCatalog();
    await this.commitCatalog(next, current);
    return cloneCatalog(next);
  }

  private async ensureCatalog(): Promise<ManagedTemplateCatalog> {
    const decoded = decodeManagedTemplateCatalog(
      this.context.globalState.get<unknown>(TEMPLATE_LIBRARY_STATE_KEY),
      this.factoryIds,
    );
    if (decoded.kind === "valid") {
      return this.migrateLegacyFactoryTriggers(decoded.catalog);
    }
    if (decoded.kind === "invalid") {
      throw new Error(
        `已保存或已同步的模板目录无效：${decoded.reason}。请在模板管理器中恢复默认模板。`,
      );
    }

    const migrated = await this.createCatalogFromLegacyFiles();
    // Settings Sync may hydrate globalState while packaged/legacy files are
    // being read. Re-check immediately before the first write so a newly
    // arrived catalog is never replaced by deterministic factory content.
    const beforeCreate = decodeManagedTemplateCatalog(
      this.context.globalState.get<unknown>(TEMPLATE_LIBRARY_STATE_KEY),
      this.factoryIds,
    );
    if (beforeCreate.kind === "valid") {
      return this.migrateLegacyFactoryTriggers(beforeCreate.catalog);
    }
    if (beforeCreate.kind === "invalid") {
      throw new Error(
        `同步到达的模板目录无效：${beforeCreate.reason}。未用默认模板覆盖。`,
      );
    }
    await this.context.globalState.update(
      TEMPLATE_LIBRARY_STATE_KEY,
      toStoredTemplateCatalog(migrated),
    );
    const observed = decodeManagedTemplateCatalog(
      this.context.globalState.get<unknown>(TEMPLATE_LIBRARY_STATE_KEY),
      this.factoryIds,
    );
    if (observed.kind !== "valid") {
      throw new Error("模板目录写入扩展内部存储后未通过复核。");
    }
    return observed.catalog;
  }

  /**
   * Consider the legacy article trigger rename once per synced Profile. Only
   * factory entries whose trigger still equals an old default are candidates;
   * any other user-selected trigger remains authoritative. The acknowledgement
   * is written before the best-effort catalog commit, so a temporary failure or
   * a later deliberate choice of a legacy name cannot cause repeated rewrites.
   */
  private async migrateLegacyFactoryTriggers(
    catalog: ManagedTemplateCatalog,
  ): Promise<ManagedTemplateCatalog> {
    return migrateLegacyFactoryTemplateTriggers(catalog, DEFAULT_TEMPLATES, {
      isAcknowledged: () =>
        this.context.globalState.get<boolean>(
          ARTICLE_TEMPLATE_TRIGGER_MIGRATION_STATE_KEY,
        ) === true,
      acknowledge: () =>
        this.context.globalState.update(
          ARTICLE_TEMPLATE_TRIGGER_MIGRATION_STATE_KEY,
          true,
        ),
      createCatalog: (templates) =>
        createManagedTemplateCatalog(
          templates,
          randomUUID(),
          this.factoryIds,
        ),
      commitCatalog: (next, previous) => this.commitCatalog(next, previous),
      readLatestCatalog: () => {
        const latest = decodeManagedTemplateCatalog(
          this.context.globalState.get<unknown>(TEMPLATE_LIBRARY_STATE_KEY),
          this.factoryIds,
        );
        return latest.kind === "valid" ? latest.catalog : undefined;
      },
      logger: this.logger,
    });
  }

  private async readStoredCatalog(): Promise<ManagedTemplateCatalog> {
    return this.ensureCatalog();
  }

  private async readStoredCatalogAllowInvalid(): Promise<
    ManagedTemplateCatalog | undefined
  > {
    const decoded = decodeManagedTemplateCatalog(
      this.context.globalState.get<unknown>(TEMPLATE_LIBRARY_STATE_KEY),
      this.factoryIds,
    );
    return decoded.kind === "valid" ? decoded.catalog : undefined;
  }

  private async commitCatalog(
    next: ManagedTemplateCatalog,
    previous: ManagedTemplateCatalog | undefined,
  ): Promise<void> {
    if (previous !== undefined) {
      const latest = decodeManagedTemplateCatalog(
        this.context.globalState.get<unknown>(TEMPLATE_LIBRARY_STATE_KEY),
        this.factoryIds,
      );
      if (latest.kind !== "valid" || latest.catalog.revision !== previous.revision) {
        throw new Error(
          "模板目录在保存前已经变化。未覆盖其他窗口或设备的内容，请重新加载。",
        );
      }
      await this.createVerifiedBackup(previous);
      const afterBackup = decodeManagedTemplateCatalog(
        this.context.globalState.get<unknown>(TEMPLATE_LIBRARY_STATE_KEY),
        this.factoryIds,
      );
      if (
        afterBackup.kind !== "valid" ||
        afterBackup.catalog.revision !== previous.revision
      ) {
        throw new Error(
          "创建备份期间模板目录已经变化。备份已保留，但没有覆盖新的目录内容。",
        );
      }
    }

    await this.context.globalState.update(
      TEMPLATE_LIBRARY_STATE_KEY,
      toStoredTemplateCatalog(next),
    );
    const observed = decodeManagedTemplateCatalog(
      this.context.globalState.get<unknown>(TEMPLATE_LIBRARY_STATE_KEY),
      this.factoryIds,
    );
    if (observed.kind !== "valid" || observed.catalog.revision !== next.revision) {
      throw new Error(
        "模板目录保存后未通过复核；可能有另一个窗口同时写入。请重新加载检查。",
      );
    }
    this.applyCatalog(next);
  }

  private async createVerifiedBackup(
    catalog: ManagedTemplateCatalog,
  ): Promise<void> {
    const directory = vscode.Uri.joinPath(
      this.context.globalStorageUri,
      TEMPLATE_BACKUP_DIRECTORY_NAME,
    );
    await vscode.workspace.fs.createDirectory(directory);
    const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const uri = vscode.Uri.joinPath(
      directory,
      `texleaf-templates.edit.${timestamp}.${randomUUID()}.json`,
    );
    const bytes = new TextEncoder().encode(
      `${JSON.stringify(toStoredTemplateCatalog(catalog), null, 2)}\n`,
    );
    await vscode.workspace.fs.writeFile(uri, bytes);
    const verification = await vscode.workspace.fs.readFile(uri);
    if (hashBytes(verification) !== hashBytes(bytes)) {
      throw new Error("模板目录备份写入后校验失败；未保存新内容。");
    }
  }

  private async createCatalogFromLegacyFiles(): Promise<ManagedTemplateCatalog> {
    const templates: ManagedTemplate[] = [];
    for (const definition of DEFAULT_TEMPLATES) {
      templates.push({
        id: definition.id,
        name: definition.label,
        trigger: definition.trigger,
        description: definition.description,
        content: await this.readLegacyOrFactoryContent(definition),
        isFactory: true,
      });
    }
    return createManagedTemplateCatalog(
      templates,
      randomUUID(),
      this.factoryIds,
    );
  }

  private async createFactoryCatalog(): Promise<ManagedTemplateCatalog> {
    const templates = await Promise.all(
      DEFAULT_TEMPLATES.map(async (definition) => ({
        id: definition.id,
        name: definition.label,
        trigger: definition.trigger,
        description: definition.description,
        content: await this.readPackagedTemplate(definition),
        isFactory: true,
      })),
    );
    return createManagedTemplateCatalog(
      templates,
      randomUUID(),
      this.factoryIds,
    );
  }

  private async readLegacyOrFactoryContent(
    definition: TemplateDefinition,
  ): Promise<string> {
    const legacyUri = vscode.Uri.joinPath(
      this.templateDirectoryUri,
      definition.fileName,
    );
    try {
      if (await uriExists(legacyUri)) {
        return decodeTemplateBytes(
          await vscode.workspace.fs.readFile(legacyUri),
          definition.fileName,
        );
      }
    } catch (error) {
      this.logger.warn(
        `旧模板 ${definition.fileName} 无法迁移，将使用插件默认值：${errorMessage(error)}`,
      );
    }
    return this.readPackagedTemplate(definition);
  }

  private async readPackagedTemplate(
    definition: TemplateDefinition,
  ): Promise<string> {
    const source = vscode.Uri.joinPath(
      this.context.extensionUri,
      LEGACY_TEMPLATE_DIRECTORY_NAME,
      definition.fileName,
    );
    return decodeTemplateBytes(
      await vscode.workspace.fs.readFile(source),
      definition.fileName,
    );
  }

  private applyCatalogIfChanged(catalog: ManagedTemplateCatalog): void {
    if (this.currentCatalog?.revision !== catalog.revision) {
      this.applyCatalog(catalog);
    }
  }

  private applyCatalog(catalog: ManagedTemplateCatalog): void {
    const next = new Map<string, LoadedTemplate>();
    for (const definition of catalog.templates) {
      next.set(definition.id, {
        definition,
        parts: materializeReplacement(
          parseReplacementTemplate(definition.content, 2),
        ),
      });
    }
    this.loaded.clear();
    for (const [id, loaded] of next) {
      this.loaded.set(id, loaded);
    }
    this.currentCatalog = catalog;
    this.changeEmitter.fire();
  }

  private async reloadFromState(): Promise<void> {
    try {
      const decoded = decodeManagedTemplateCatalog(
        this.context.globalState.get<unknown>(TEMPLATE_LIBRARY_STATE_KEY),
        this.factoryIds,
      );
      if (decoded.kind === "valid") {
        const catalog = await this.migrateLegacyFactoryTriggers(decoded.catalog);
        this.applyCatalogIfChanged(catalog);
      } else if (decoded.kind === "invalid") {
        this.logger.warn(
          `忽略无效的已同步模板目录并继续使用上一次有效内容：${decoded.reason}`,
        );
      }
    } catch (error) {
      this.logger.warn(`重新检查模板目录失败：${errorMessage(error)}`);
    }
  }
}

function cloneCatalog(catalog: ManagedTemplateCatalog): ManagedTemplateCatalog {
  return {
    revision: catalog.revision,
    templates: catalog.templates.map((template) => ({ ...template })),
  };
}

function decodeTemplateBytes(bytes: Uint8Array, label: string): string {
  if (bytes.byteLength > MAX_TEMPLATE_CONTENT_BYTES) {
    throw new Error(
      `${label} 超过 ${Math.floor(MAX_TEMPLATE_CONTENT_BYTES / 1024)} KiB 上限`,
    );
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) {
    throw new Error(`${label} 包含 NUL 字符`);
  }
  return text;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    return !(
      error instanceof vscode.FileSystemError && error.code === "FileNotFound"
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
