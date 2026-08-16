import { createHash, randomBytes } from "node:crypto";
import * as vscode from "vscode";
import {
  parse,
  type ParseError,
  printParseErrorCode,
} from "jsonc-parser";
import type {
  ManagedSnippet,
  ManagedSnippetLibrary,
} from "./snippetRepository";
import type {
  ManagedTemplate,
  ManagedTemplateCatalog,
} from "./templateManager";
import { renderSnippetManagerWebview } from "./snippetManagerWebview";

export const OPEN_SNIPPET_EDITOR_COMMAND = "texleaf.openSnippetEditor";
export const RESTORE_DEFAULT_SNIPPETS_COMMAND =
  "texleaf.restoreDefaultSnippets";

const PANEL_VIEW_TYPE = "texleaf.snippetEditor";
const MAX_EDITABLE_CHARACTERS = 10_000_000;
const MANAGER_LOAD_TIMEOUT_MS = 15_000;
const EMPTY_LIBRARY = `{
  "version": 1,
  "variables": {},
  "snippets": []
}
`;

export interface SnippetEditorPanelOptions {
  /**
   * Prepares the global library before the panel reads it. The repository uses
   * this hook to create the user-level file without consulting project files.
   */
  readonly onWillOpen?: () => unknown | Thenable<unknown>;
  /**
   * Called after the file has been written successfully. The extension can use
   * this hook to reload its repository immediately instead of waiting for its
   * file-system watcher.
   */
  readonly onDidSave?: (uri: vscode.Uri) => void | Thenable<void>;
  /**
   * Replaces the global library through the repository's guarded reset path.
   * The panel owns only the UI coordination; it never writes reset content
   * directly, so Command Palette, tree-title, and Webview entry points all use
   * the same confirmation, backup, watcher, and reload implementation.
   */
  readonly onRestoreDefaults?: () => Promise<RestoreDefaultsResult>;
  /** Structured, revisioned access used by the built-in manager UI. */
  readonly onReadLibrary?: () => Promise<ManagedSnippetLibrary>;
  readonly onReplaceLibrary?: (
    model: Omit<ManagedSnippetLibrary, "revision">,
    expectedRevision: string,
  ) => Promise<ManagedSnippetLibrary>;
  /** Atomic template catalog access. Template bodies never enter snippet JSONC. */
  readonly onListTemplates?: () => Promise<ManagedTemplateCatalog>;
  readonly onReplaceTemplates?: (
    templates: readonly ManagedTemplate[],
    expectedRevision: string,
  ) => Promise<ManagedTemplateCatalog>;
  readonly onRestoreTemplates?: () => Promise<ManagedTemplateCatalog>;
}

export interface RestoreDefaultsResult {
  readonly status: "restored" | "cancelled";
  readonly count?: number;
  readonly backupUri?: vscode.Uri;
}

interface PanelSession {
  readonly key: string;
  readonly directory: vscode.Uri;
  readonly uri: vscode.Uri;
  readonly panel: vscode.WebviewPanel;
  readonly subscriptions: vscode.Disposable[];
  ready: boolean;
  webviewDirty: boolean;
  snippetRevision: string | undefined;
  templateRevision: string | undefined;
  initialTab: "snippets" | "templates";
}

type WebviewMessage =
  | { readonly protocol: 1; readonly type: "ready" }
  | { readonly protocol: 1; readonly type: "dirty"; readonly dirty: boolean }
  | { readonly protocol: 1; readonly type: "reload"; readonly requestId: string }
  | {
      readonly protocol: 1;
      readonly type: "restoreDefaults";
      readonly requestId: string;
    }
  | {
      readonly protocol: 1;
      readonly type: "saveLibrary";
      readonly requestId: string;
      readonly expectedRevision: string;
      readonly library: Omit<ManagedSnippetLibrary, "revision">;
    }
  | {
      readonly protocol: 1;
      readonly type: "saveTemplates";
      readonly requestId: string;
      readonly expectedRevision: string;
      readonly templates: readonly ManagedTemplate[];
    }
  | {
      readonly protocol: 1;
      readonly type: "runCommand";
      readonly requestId: string;
      readonly command: "import" | "export" | "openJson";
    }
  | {
      readonly protocol: 1;
      readonly type: "restoreTemplates";
      readonly requestId: string;
    };

interface FileContent {
  readonly text: string;
  readonly exists: boolean;
}

/**
 * Owns the single editor for the extension's user-level snippet library.
 * `globalStorageUri` is scoped to the current VS Code profile rather than the
 * current workspace, so the same snippets follow the user between projects.
 */
export class SnippetEditorPanel implements vscode.Disposable {
  private readonly sessions = new Map<string, PanelSession>();
  private opening: Promise<void> | undefined;
  private operationQueue: Promise<void> = Promise.resolve();
  private disposed = false;

  public constructor(
    private readonly globalStorageUri: vscode.Uri,
    private readonly options: SnippetEditorPanelOptions = {},
  ) {}

  /** Used by background sync so it never overwrites unsaved Webview text. */
  public hasUnsavedChanges(): boolean {
    return [...this.sessions.values()].some(
      (session) => this.isCurrentSession(session) && session.webviewDirty,
    );
  }

  /** Refresh clean panels after a watcher or Settings Sync changes the file. */
  public refreshCleanSessions(): Promise<void> {
    return this.enqueueOperation(
      async () => {
        for (const session of this.sessions.values()) {
          if (
            this.isCurrentSession(session) &&
            session.ready &&
            !session.webviewDirty
          ) {
            await this.loadIntoPanel(session, null);
          }
        }
      },
      async () => {
        // A transient refresh failure is already surfaced by loadIntoPanel;
        // retain the panel's last-loaded baseline so a later save stays CAS-safe.
      },
    );
  }

  public async open(initialTab: "snippets" | "templates" = "snippets"): Promise<void> {
    if (this.disposed) {
      throw new Error("SnippetEditorPanel has already been disposed.");
    }

    const uri = vscode.Uri.joinPath(
      this.globalStorageUri,
      "texleaf-snippets.jsonc",
    );
    const key = uri.toString();
    const existing = this.sessions.get(key);
    if (existing !== undefined) {
      existing.initialTab = initialTab;
      existing.panel.reveal(vscode.ViewColumn.Active, true);
      await postMessage(existing, {
        protocol: 1,
        type: "activateTab",
        tab: initialTab,
      });
      return;
    }

    if (this.opening !== undefined) {
      await this.opening;
      const opened = this.sessions.get(key);
      if (opened !== undefined) {
        opened.initialTab = initialTab;
        await postMessage(opened, {
          protocol: 1,
          type: "activateTab",
          tab: initialTab,
        });
      }
      return;
    }

    const opening = this.openSession(uri, key, initialTab);
    this.opening = opening;
    try {
      await opening;
    } finally {
      if (this.opening === opening) {
        this.opening = undefined;
      }
    }
  }

  /**
   * Runs the same guarded restore flow for Command Palette and tree-title
   * callers. Webview callers are routed to performRestoreDefaults from the
   * shared class-level operation queue as well.
   */
  public restoreDefaults(): Promise<void> {
    return this.enqueueOperation(
      () => this.performRestoreDefaults(undefined, null),
      async (error) => {
        await this.setPanelsBusy(false);
        void vscode.window.showErrorMessage(
          `TeXLeaf 恢复默认片段失败：${errorMessage(error)}`,
        );
      },
    );
  }

  private async openSession(
    uri: vscode.Uri,
    key: string,
    initialTab: "snippets" | "templates",
  ): Promise<void> {
    try {
      await this.options.onWillOpen?.();
    } catch (error) {
      void vscode.window.showErrorMessage(
        `无法准备 TeXLeaf 全局用户片段文件：${errorMessage(error)}`,
      );
      return;
    }

    if (this.disposed) {
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      "TeXLeaf Snippet 与模板管理器",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    const session: PanelSession = {
      key,
      directory: this.globalStorageUri,
      uri,
      panel,
      subscriptions: [],
      ready: false,
      webviewDirty: false,
      snippetRevision: undefined,
      templateRevision: undefined,
      initialTab,
    };
    this.sessions.set(key, session);

    session.subscriptions.push(
      panel.webview.onDidReceiveMessage((message: unknown) => {
        const parsed = parseWebviewMessage(message);
        if (parsed === undefined) {
          if (
            isRecord(message) &&
            message.protocol === 1 &&
            typeof message.type === "string" &&
            message.type !== "ready" &&
            message.type !== "dirty" &&
            isRequestId(message.requestId)
          ) {
            void postMessage(session, {
              protocol: 1,
              type: "error",
              requestId: message.requestId,
              message:
                "请求内容未通过安全校验（字段类型、数量或大小超出限制），未写入任何更改。",
            });
          }
          return;
        }
        // The Webview retries `ready` until it receives the first content
        // payload. Claim the handshake synchronously so retries cannot enqueue
        // an unbounded number of duplicate initial loads behind a slow remote
        // file-system read.
        if (parsed.type === "ready") {
          if (!this.isCurrentSession(session) || session.ready) {
            return;
          }
          session.ready = true;
          void this.enqueueOperation(
            () => this.loadIntoPanel(session, null),
            async (error: unknown) => {
              await postMessage(session, {
                protocol: 1,
                type: "error",
                message: `初始载入失败：${errorMessage(error)}`,
              });
            },
          );
          return;
        }
        // Dirty notifications are intentionally applied immediately instead
        // of waiting behind a save/reset operation. This lets an external
        // Command Palette or tree-title invocation observe unsaved Webview
        // edits before it is allowed to replace the file.
        if (parsed.type === "dirty") {
          if (this.isCurrentSession(session) && session.ready) {
            session.webviewDirty = parsed.dirty;
          }
          return;
        }
        void this.enqueueOperation(
          () => this.handleMessage(session, parsed),
          async (error: unknown) => {
            await postMessage(session, {
              type: "error",
              message: `操作失败：${errorMessage(error)}`,
            });
          },
        );
      }),
      panel.onDidDispose(() => this.disposeSession(session)),
    );
    panel.webview.html = renderHtml();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const session of [...this.sessions.values()]) {
      session.panel.dispose();
    }
    this.sessions.clear();
  }

  private async handleMessage(
    session: PanelSession,
    message: WebviewMessage,
  ): Promise<void> {
    if (!this.isCurrentSession(session)) {
      return;
    }
    if (!session.ready) {
      return;
    }

    switch (message.type) {
      case "reload":
        await this.loadIntoPanel(session, message.requestId);
        return;
      case "restoreDefaults":
        await this.performRestoreDefaults(session, message.requestId);
        return;
      case "saveLibrary":
        await this.saveLibraryFromPanel(session, message);
        return;
      case "saveTemplates":
        await this.saveTemplatesFromPanel(session, message);
        return;
      case "runCommand":
        await this.runManagerCommand(session, message);
        return;
      case "restoreTemplates":
        await this.restoreTemplatesFromPanel(session, message.requestId);
        return;
      case "ready":
        return;
    }
  }

  private async loadIntoPanel(
    session: PanelSession,
    requestId: string | null,
  ): Promise<void> {
    try {
      const contentPromise = readSnippetFile(session.uri);
      const [content, library, templates] = await withTimeout(
        Promise.all([
          contentPromise,
          this.options.onReadLibrary === undefined
            ? contentPromise.then((loaded) =>
                parseManagedSnippetLibrary(loaded.text, loaded.exists),
              )
            : this.options.onReadLibrary(),
          this.options.onListTemplates === undefined
            ? Promise.resolve({ revision: "unavailable", templates: [] })
            : this.options.onListTemplates(),
        ]),
        MANAGER_LOAD_TIMEOUT_MS,
        "载入内部 Snippet/模板库超时",
      );
      session.snippetRevision = library.revision;
      session.templateRevision = templates.revision;
      session.webviewDirty = false;
      await postMessage(session, {
        type: "content",
        protocol: 1,
        requestId,
        exists: content.exists,
        location: formatSnippetLocation(session.uri),
        library,
        templateCatalog: templates,
        templatesAvailable: this.options.onReplaceTemplates !== undefined,
        initialTab: session.initialTab,
      });
    } catch (error) {
      await postMessage(session, {
        type: "result",
        requestId,
        action: "reload",
        ok: false,
        tone: "error",
        message: `无法读取片段文件：${errorMessage(error)}`,
      });
    }
  }

  private async saveLibraryFromPanel(
    session: PanelSession,
    message: Extract<WebviewMessage, { readonly type: "saveLibrary" }>,
  ): Promise<void> {
    if (
      session.snippetRevision === undefined ||
      message.expectedRevision !== session.snippetRevision
    ) {
      await postManagerResult(session, message.requestId, "saveLibrary", false, {
        tone: "warning",
        message: "片段库版本已变化。请先重新加载，再合并修改。",
      });
      return;
    }

    const validation = validateManagedSnippetLibrary(message.library);
    if (validation !== undefined) {
      await postManagerResult(session, message.requestId, "saveLibrary", false, {
        tone: "error",
        message: `${validation} 未写入任何更改。`,
      });
      return;
    }
    const replace = this.options.onReplaceLibrary;
    if (replace === undefined) {
      await postManagerResult(session, message.requestId, "saveLibrary", false, {
        tone: "error",
        message: "结构化片段存储尚未完成初始化，请重新加载 VS Code 窗口。",
      });
      return;
    }

    try {
      const saved = await replace(message.library, message.expectedRevision);
      session.snippetRevision = saved.revision;
      await this.options.onDidSave?.(session.uri);
      await postManagerResult(session, message.requestId, "saveLibrary", true, {
        tone: "success",
        message: `已保存并启用 ${saved.snippets.length} 条片段。`,
        library: saved,
      });
    } catch (error) {
      await postManagerResult(session, message.requestId, "saveLibrary", false, {
        tone: "error",
        message: `保存片段失败：${errorMessage(error)}`,
      });
    }
  }

  private async saveTemplatesFromPanel(
    session: PanelSession,
    message: Extract<WebviewMessage, { readonly type: "saveTemplates" }>,
  ): Promise<void> {
    if (
      session.templateRevision === undefined ||
      message.expectedRevision !== session.templateRevision
    ) {
      await postManagerResult(session, message.requestId, "saveTemplates", false, {
        tone: "warning",
        message: "模板目录已在其他窗口发生变化。请先重新加载。",
      });
      return;
    }
    const validation = validateManagedTemplates(message.templates);
    if (validation !== undefined) {
      await postManagerResult(session, message.requestId, "saveTemplates", false, {
        tone: "error",
        message: `${validation} 未写入任何更改。`,
      });
      return;
    }
    const replace = this.options.onReplaceTemplates;
    if (replace === undefined) {
      await postManagerResult(session, message.requestId, "saveTemplates", false, {
        tone: "error",
        message: "此版本尚未启用模板目录写入功能。",
      });
      return;
    }
    try {
      const saved = await replace(message.templates, message.expectedRevision);
      session.templateRevision = saved.revision;
      await postManagerResult(session, message.requestId, "saveTemplates", true, {
        tone: "success",
        message: `已保存 ${saved.templates.length} 个模板。`,
        templateCatalog: saved,
      });
    } catch (error) {
      await postManagerResult(session, message.requestId, "saveTemplates", false, {
        tone: "error",
        message: `保存模板失败：${errorMessage(error)}`,
      });
    }
  }

  private async runManagerCommand(
    session: PanelSession,
    message: Extract<WebviewMessage, { readonly type: "runCommand" }>,
  ): Promise<void> {
    if (session.webviewDirty && message.command !== "export") {
      await postManagerResult(session, message.requestId, "runCommand", false, {
        tone: "warning",
        message: "请先保存或撤销管理器中的修改，再执行该操作。",
      });
      return;
    }
    const commandId = {
      import: "texleaf.importSnippets",
      export: "texleaf.exportSnippets",
      openJson: "texleaf.openSnippetFile",
    }[message.command];
    try {
      await vscode.commands.executeCommand(commandId);
      if (message.command === "import") {
        await this.loadIntoPanel(session, null);
      }
      await postManagerResult(session, message.requestId, "runCommand", true, {
        tone: "success",
        message:
          message.command === "export"
            ? "导出操作已完成或取消。"
            : message.command === "import"
              ? "导入操作已完成或取消；管理器已重新载入。"
              : "已在文本编辑器中打开高级 JSONC 配置。",
      });
    } catch (error) {
      await postManagerResult(session, message.requestId, "runCommand", false, {
        tone: "error",
        message: `命令执行失败：${errorMessage(error)}`,
      });
    }
  }

  private async restoreTemplatesFromPanel(
    session: PanelSession,
    requestId: string,
  ): Promise<void> {
    if (session.webviewDirty) {
      await postManagerResult(session, requestId, "restoreTemplates", false, {
        tone: "warning",
        message: "请先保存或撤销未保存的修改，再恢复默认模板。",
      });
      return;
    }
    if (this.options.onRestoreTemplates === undefined) {
      await postManagerResult(session, requestId, "restoreTemplates", false, {
        tone: "error",
        message: "恢复默认模板功能尚未完成初始化。",
      });
      return;
    }
    try {
      const catalog = await this.options.onRestoreTemplates();
      session.templateRevision = catalog.revision;
      await postManagerResult(session, requestId, "restoreTemplates", true, {
        tone: "success",
        message: `已恢复 ${catalog.templates.length} 个默认模板。`,
        templateCatalog: catalog,
      });
    } catch (error) {
      await postManagerResult(session, requestId, "restoreTemplates", false, {
        tone: "error",
        message: `恢复默认模板失败：${errorMessage(error)}`,
      });
    }
  }

  private async performRestoreDefaults(
    sourceSession: PanelSession | undefined,
    requestId: string | null,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }

    const dirtySession = [...this.sessions.values()].find(
      (session) => this.isCurrentSession(session) && session.webviewDirty,
    );
    if (dirtySession !== undefined) {
      const message =
        "全局片段编辑面板中还有未保存的修改。请先保存，或从磁盘重新加载后再恢复默认片段。";
      if (
        sourceSession !== undefined &&
        this.isCurrentSession(sourceSession) &&
        requestId !== null
      ) {
        await postMessage(sourceSession, {
          type: "result",
          requestId,
          action: "restore",
          ok: false,
          tone: "warning",
          message,
        });
      } else {
        void vscode.window.showWarningMessage(`TeXLeaf: ${message}`);
      }
      return;
    }

    const restore = this.options.onRestoreDefaults;
    if (restore === undefined) {
      const message = "恢复默认片段功能尚未完成初始化，请重新加载 VS Code 窗口。";
      if (
        sourceSession !== undefined &&
        this.isCurrentSession(sourceSession) &&
        requestId !== null
      ) {
        await postMessage(sourceSession, {
          type: "result",
          requestId,
          action: "restore",
          ok: false,
          tone: "error",
          message,
        });
      } else {
        void vscode.window.showErrorMessage(`TeXLeaf: ${message}`);
      }
      return;
    }

    // The Webview button disables itself before sending its request. External
    // command invocations need the host to freeze every visible panel so the
    // user cannot create a new unsaved edit while the modal confirmation and
    // guarded repository mutation are in progress.
    await this.setPanelsBusy(true, "正在准备恢复默认片段…");
    const result = await restore();
    if (result.status === "cancelled") {
      await this.postRestoreResultToPanels(
        sourceSession,
        requestId,
        false,
        "",
        "已取消恢复默认片段。",
      );
      return;
    }

    for (const session of [...this.sessions.values()]) {
      if (this.isCurrentSession(session)) {
        await this.loadIntoPanel(
          session,
          session === sourceSession ? requestId : null,
        );
      }
    }

    const message = formatRestoreSuccessMessage(result);
    await this.postRestoreResultToPanels(
      sourceSession,
      requestId,
      true,
      "success",
      message,
    );
    void showRestoreSuccessNotification(result, message);
  }

  private async postRestoreResultToPanels(
    sourceSession: PanelSession | undefined,
    requestId: string | null,
    ok: boolean,
    tone: "" | "success" | "warning" | "error",
    message: string,
  ): Promise<void> {
    const sessions = [...this.sessions.values()].filter((session) =>
      this.isCurrentSession(session),
    );
    if (sessions.length === 0) {
      return;
    }
    await Promise.all(
      sessions.map((session) =>
        postMessage(session, {
          type: "result",
          requestId: session === sourceSession ? requestId : null,
          action: "restore",
          ok,
          tone,
          message,
        }),
      ),
    );
  }

  private async setPanelsBusy(value: boolean, message?: string): Promise<void> {
    await Promise.all(
      [...this.sessions.values()]
        .filter((session) => this.isCurrentSession(session))
        .map((session) =>
          postMessage(session, {
            type: "busy",
            value,
            ...(message === undefined ? {} : { message }),
          }),
        ),
    );
  }

  private enqueueOperation(
    action: () => Promise<void>,
    onError: (error: unknown) => void | Promise<void>,
  ): Promise<void> {
    const operation = this.operationQueue.then(action);
    const handled = operation.catch(onError);
    this.operationQueue = handled;
    return handled;
  }

  private isCurrentSession(session: PanelSession): boolean {
    return !this.disposed && this.sessions.get(session.key) === session;
  }

  private disposeSession(session: PanelSession): void {
    if (this.sessions.get(session.key) === session) {
      this.sessions.delete(session.key);
    }
    for (const subscription of session.subscriptions.splice(0)) {
      subscription.dispose();
    }
  }
}

/**
 * Registers the command and puts both the command and panel owner into the
 * extension context. The package manifest still needs to contribute the
 * command if it should appear in the Command Palette or a setting link.
 */
export function registerSnippetEditorPanel(
  context: vscode.ExtensionContext,
  options: SnippetEditorPanelOptions = {},
): SnippetEditorPanel {
  const editor = new SnippetEditorPanel(context.globalStorageUri, options);
  context.subscriptions.push(
    editor,
    vscode.commands.registerCommand(OPEN_SNIPPET_EDITOR_COMMAND, (tab: unknown) =>
      editor.open(tab === "templates" ? "templates" : "snippets"),
    ),
    vscode.commands.registerCommand(RESTORE_DEFAULT_SNIPPETS_COMMAND, () =>
      editor.restoreDefaults(),
    ),
  );
  return editor;
}

async function readSnippetFile(uri: vscode.Uri): Promise<FileContent> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.length > MAX_EDITABLE_CHARACTERS) {
      throw new Error(
        "文件超过 1000 万字符，Webview 编辑器拒绝载入。请改用文本编辑器。",
      );
    }
    return { text, exists: true };
  } catch (error) {
    if (isFileNotFound(error)) {
      return { text: EMPTY_LIBRARY, exists: false };
    }
    throw error;
  }
}

function formatSnippetLocation(uri: vscode.Uri): string {
  return uri.scheme === "file"
    ? uri.fsPath
    : uri.toString(true);
}

function formatRestoreSuccessMessage(result: RestoreDefaultsResult): string {
  const count =
    result.count === undefined ? "" : ` ${Math.max(0, result.count)} 条`;
  const backup =
    result.backupUri === undefined
      ? ""
      : `；原配置已备份到 ${formatSnippetLocation(result.backupUri)}`;
  return `已恢复${count}默认片段${backup}。`;
}

async function showRestoreSuccessNotification(
  result: RestoreDefaultsResult,
  message: string,
): Promise<void> {
  const openBackup = "打开备份";
  const selected = await vscode.window.showInformationMessage(
    `TeXLeaf: ${message}`,
    ...(result.backupUri === undefined ? [] : [openBackup]),
  );
  if (selected !== openBackup || result.backupUri === undefined) {
    return;
  }
  try {
    const document = await vscode.workspace.openTextDocument(result.backupUri);
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (error) {
    void vscode.window.showErrorMessage(
      `TeXLeaf 无法打开片段备份：${errorMessage(error)}`,
    );
  }
}

function parseManagedSnippetLibrary(
  text: string,
  exists: boolean,
): ManagedSnippetLibrary {
  const errors: ParseError[] = [];
  const value = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  const firstError = errors[0];
  if (firstError !== undefined) {
    throw new Error(
      `JSONC 解析失败：${printParseErrorCode(firstError.error)}（偏移 ${firstError.offset}）。`,
    );
  }
  const root = Array.isArray(value)
    ? { snippets: value, variables: {} }
    : isRecord(value)
      ? value
      : undefined;
  if (root === undefined || !Array.isArray(root.snippets)) {
    throw new Error("片段库必须是数组，或包含 snippets 数组的对象。");
  }
  const variables: Record<string, string> = {};
  if (isRecord(root.variables)) {
    for (const [name, variableValue] of Object.entries(root.variables)) {
      if (typeof variableValue === "string") {
        variables[name] = variableValue;
      }
    }
  }
  const snippets: ManagedSnippet[] = [];
  for (let index = 0; index < root.snippets.length; index += 1) {
    const raw = root.snippets[index];
    if (
      !isRecord(raw) ||
      typeof raw.trigger !== "string" ||
      typeof raw.replacement !== "string"
    ) {
      continue;
    }
    const generatedId = `managed.${index}.${createHash("sha256")
      .update(`${raw.trigger}\0${raw.replacement}`)
      .digest("hex")
      .slice(0, 12)}`;
    snippets.push({
      id:
        typeof raw.id === "string" && raw.id.length > 0 ? raw.id : generatedId,
      trigger: raw.trigger,
      replacement: raw.replacement,
      options: typeof raw.options === "string" ? raw.options : "",
      priority:
        typeof raw.priority === "number" && Number.isFinite(raw.priority)
          ? raw.priority
          : 0,
      ...(typeof raw.description === "string"
        ? { description: raw.description }
        : {}),
      category: typeof raw.category === "string" ? raw.category : "User",
      ...(typeof raw.flags === "string" ? { flags: raw.flags } : {}),
      syntaxVersion:
        raw.syntaxVersion === 1 || raw.version === 1 ? (1 as const) : (2 as const),
      enabled: raw.enabled !== false,
    });
  }
  const defaultsRevision = root.defaultsRevision;
  return {
    revision: `${exists ? "file" : "new"}:${createHash("sha256")
      .update(text)
      .digest("base64url")}`,
    ...(typeof defaultsRevision === "number" &&
    Number.isInteger(defaultsRevision)
      ? { defaultsRevision }
      : {}),
    variables,
    snippets,
  };
}

function validateManagedSnippetLibrary(
  library: Omit<ManagedSnippetLibrary, "revision">,
): string | undefined {
  if (JSON.stringify(library).length > MAX_EDITABLE_CHARACTERS) {
    return "片段库超过 1000 万字符安全上限。";
  }
  const ids = new Set<string>();
  for (let index = 0; index < library.snippets.length; index += 1) {
    const snippet = library.snippets[index]!;
    if (ids.has(snippet.id)) {
      return `第 ${index + 1} 条片段的 id 与其他片段重复：${snippet.id}。`;
    }
    ids.add(snippet.id);
    const invalidOptions = [...snippet.options].filter(
      (option) => !"tMmnrAvw".includes(option),
    );
    if (invalidOptions.length > 0) {
      return `触发词 ${JSON.stringify(snippet.trigger)} 含未知 options：${invalidOptions.join("")}。`;
    }
    if (snippet.options.includes("r") && snippet.options.includes("v")) {
      return `触发词 ${JSON.stringify(snippet.trigger)} 不能同时使用正则 r 与 Visual v。`;
    }
    if (snippet.options.includes("r")) {
      try {
        const regex = new RegExp(
          `(?:${snippet.trigger})(?![\\s\\S])`,
          snippet.flags ?? "",
        );
        if (regex.test("")) {
          return `正则触发词 ${JSON.stringify(snippet.trigger)} 不能匹配空字符串。`;
        }
      } catch (error) {
        return `正则触发词 ${JSON.stringify(snippet.trigger)} 无效：${errorMessage(error)}。`;
      }
    }
  }
  return undefined;
}

function validateManagedTemplates(
  templates: readonly ManagedTemplate[],
): string | undefined {
  if (templates.length > 128) {
    return "模板数量不能超过 128 个。";
  }
  if (new TextEncoder().encode(JSON.stringify(templates)).byteLength > 256 * 1024) {
    return "模板目录超过 256 KiB 安全上限。";
  }
  const ids = new Set<string>();
  const triggers = new Set<string>();
  for (const template of templates) {
    if (ids.has(template.id)) {
      return `模板 id 重复：${template.id}。`;
    }
    ids.add(template.id);
    if (triggers.has(template.trigger)) {
      return `模板 trigger 重复：${template.trigger}。`;
    }
    triggers.add(template.trigger);
  }
  const ordered = [...triggers].sort(
    (left, right) => left.length - right.length || left.localeCompare(right),
  );
  for (let index = 0; index < ordered.length; index += 1) {
    const shorter = ordered[index]!;
    for (let candidate = index + 1; candidate < ordered.length; candidate += 1) {
      const longer = ordered[candidate]!;
      if (longer.startsWith(shorter)) {
        return `模板 trigger 前缀冲突：${JSON.stringify(shorter)} 会在 ${JSON.stringify(longer)} 输入完成前提前展开。`;
      }
    }
  }
  return undefined;
}

async function postManagerResult(
  session: PanelSession,
  requestId: string,
  action:
    | "saveLibrary"
    | "saveTemplates"
    | "runCommand"
    | "restoreTemplates",
  ok: boolean,
  details: Readonly<Record<string, unknown>>,
): Promise<void> {
  await postMessage(session, {
    protocol: 1,
    type: "result",
    requestId,
    action,
    ok,
    ...details,
  });
}

function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (
    !isRecord(value) ||
    value.protocol !== 1 ||
    typeof value.type !== "string"
  ) {
    return undefined;
  }

  switch (value.type) {
    case "ready":
      return hasOnlyKeys(value, ["protocol", "type"])
        ? { protocol: 1, type: "ready" }
        : undefined;
    case "dirty":
      return hasOnlyKeys(value, ["protocol", "type", "dirty"]) &&
        typeof value.dirty === "boolean"
        ? { protocol: 1, type: "dirty", dirty: value.dirty }
        : undefined;
    case "reload": {
      if (
        !hasOnlyKeys(value, ["protocol", "type", "requestId"]) ||
        !isRequestId(value.requestId)
      ) {
        return undefined;
      }
      return { protocol: 1, type: "reload", requestId: value.requestId };
    }
    case "restoreDefaults": {
      if (
        !hasOnlyKeys(value, ["protocol", "type", "requestId"]) ||
        !isRequestId(value.requestId)
      ) {
        return undefined;
      }
      return {
        protocol: 1,
        type: "restoreDefaults",
        requestId: value.requestId,
      };
    }
    case "saveLibrary": {
      if (
        !hasOnlyKeys(value, [
          "protocol",
          "type",
          "requestId",
          "expectedRevision",
          "library",
        ]) ||
        !isRequestId(value.requestId) ||
        !isRevision(value.expectedRevision)
      ) {
        return undefined;
      }
      const library = parseManagedSnippetLibraryMessage(value.library);
      return library === undefined
        ? undefined
        : {
            protocol: 1,
            type: "saveLibrary",
            requestId: value.requestId,
            expectedRevision: value.expectedRevision,
            library,
          };
    }
    case "saveTemplates": {
      if (
        !hasOnlyKeys(value, [
          "protocol",
          "type",
          "requestId",
          "expectedRevision",
          "templates",
        ]) ||
        !isRequestId(value.requestId) ||
        !isRevision(value.expectedRevision) ||
        !Array.isArray(value.templates) ||
        value.templates.length > 128
      ) {
        return undefined;
      }
      const templates: ManagedTemplate[] = [];
      let payloadBytes = 32;
      for (const candidate of value.templates) {
        const template = parseManagedTemplateMessage(candidate);
        if (template === undefined) {
          return undefined;
        }
        payloadBytes += utf8ByteLength(JSON.stringify(template)) + 1;
        if (payloadBytes > 256 * 1024) {
          return undefined;
        }
        templates.push(template);
      }
      return {
        protocol: 1,
        type: "saveTemplates",
        requestId: value.requestId,
        expectedRevision: value.expectedRevision,
        templates,
      };
    }
    case "runCommand": {
      if (
        !hasOnlyKeys(value, ["protocol", "type", "requestId", "command"]) ||
        !isRequestId(value.requestId) ||
        (value.command !== "import" &&
          value.command !== "export" &&
          value.command !== "openJson")
      ) {
        return undefined;
      }
      return {
        protocol: 1,
        type: "runCommand",
        requestId: value.requestId,
        command: value.command,
      };
    }
    case "restoreTemplates": {
      if (
        !hasOnlyKeys(value, ["protocol", "type", "requestId"]) ||
        !isRequestId(value.requestId)
      ) {
        return undefined;
      }
      return {
        protocol: 1,
        type: "restoreTemplates",
        requestId: value.requestId,
      };
    }
    default:
      return undefined;
  }
}

function parseManagedSnippetLibraryMessage(
  value: unknown,
): Omit<ManagedSnippetLibrary, "revision"> | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyAllowedKeys(value, ["defaultsRevision", "variables", "snippets"]) ||
    (value.defaultsRevision !== undefined &&
      (typeof value.defaultsRevision !== "number" ||
        !Number.isInteger(value.defaultsRevision) ||
        value.defaultsRevision < 0)) ||
    !isRecord(value.variables) ||
    !Array.isArray(value.snippets) ||
    value.snippets.length > 100_000
  ) {
    return undefined;
  }
  let payloadBytes = 64;
  const variables: Record<string, string> = {};
  if (Object.keys(value.variables).length > 10_000) {
    return undefined;
  }
  for (const [name, variableValue] of Object.entries(value.variables)) {
    if (
      name.length === 0 ||
      name.length > 256 ||
      typeof variableValue !== "string" ||
      variableValue.length > 1_000_000
    ) {
      return undefined;
    }
    payloadBytes += utf8ByteLength(name) + utf8ByteLength(variableValue) + 8;
    if (payloadBytes > MAX_EDITABLE_CHARACTERS) {
      return undefined;
    }
    variables[name] = variableValue;
  }
  const snippets: ManagedSnippet[] = [];
  for (const candidate of value.snippets) {
    const snippet = parseManagedSnippetMessage(candidate);
    if (snippet === undefined) {
      return undefined;
    }
    payloadBytes += utf8ByteLength(JSON.stringify(snippet)) + 1;
    if (payloadBytes > MAX_EDITABLE_CHARACTERS) {
      return undefined;
    }
    snippets.push(snippet);
  }
  const result: Omit<ManagedSnippetLibrary, "revision"> = {
    variables,
    snippets,
  };
  return value.defaultsRevision === undefined
    ? result
    : { ...result, defaultsRevision: value.defaultsRevision };
}

function parseManagedSnippetMessage(value: unknown): ManagedSnippet | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyAllowedKeys(value, [
      "id",
      "trigger",
      "replacement",
      "options",
      "priority",
      "description",
      "category",
      "flags",
      "syntaxVersion",
      "enabled",
    ]) ||
    !isBoundedString(value.id, 1, 256) ||
    !isBoundedString(value.trigger, 1, 4_096) ||
    !isBoundedString(value.replacement, 0, 1_000_000) ||
    !isBoundedString(value.options, 0, 32) ||
    typeof value.priority !== "number" ||
    !Number.isFinite(value.priority) ||
    !isBoundedString(value.category, 0, 256) ||
    (value.description !== undefined &&
      !isBoundedString(value.description, 0, 16_384)) ||
    (value.flags !== undefined && !isBoundedString(value.flags, 0, 16)) ||
    (value.syntaxVersion !== 1 && value.syntaxVersion !== 2) ||
    typeof value.enabled !== "boolean"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    trigger: value.trigger,
    replacement: value.replacement,
    options: value.options,
    priority: value.priority,
    ...(value.description === undefined
      ? {}
      : { description: value.description }),
    category: value.category,
    ...(value.flags === undefined ? {} : { flags: value.flags }),
    syntaxVersion: value.syntaxVersion,
    enabled: value.enabled,
  };
}

function parseManagedTemplateMessage(value: unknown): ManagedTemplate | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "name",
      "trigger",
      "description",
      "content",
      "isFactory",
    ]) ||
    !isBoundedString(value.id, 1, 128) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.id) ||
    !isBoundedString(value.name, 1, 128) ||
    !isBoundedString(value.trigger, 1, 80) ||
    /[\s\u0000-\u001f\u007f]/u.test(value.trigger) ||
    !isBoundedString(value.description, 0, 2_048) ||
    !isBoundedString(value.content, 0, 192 * 1024) ||
    typeof value.isFactory !== "boolean"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    name: value.name,
    trigger: value.trigger,
    description: value.description,
    content: value.content,
    isFactory: value.isFactory,
  };
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowedKeys.has(key));
}

function hasOnlyAllowedKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isBoundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !value.includes("\0")
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 64 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isRevision(value: unknown): value is string {
  return isBoundedString(value, 1, 256) && /^[A-Za-z0-9._:+/=-]+$/u.test(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === "FileNotFound";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}（${Math.ceil(timeoutMs / 1_000)} 秒）。`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function postMessage(
  session: PanelSession,
  message: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (!session.ready) {
    return;
  }
  try {
    await session.panel.webview.postMessage(message);
  } catch {
    // The panel can be disposed while a remote workspace file operation is in flight.
  }
}

function renderHtml(): string {
  return renderSnippetManagerWebview(randomBytes(24).toString("hex"));
}
