import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import {
  parse,
  type ParseError,
  printParseErrorCode,
} from "jsonc-parser";

export const OPEN_SNIPPET_EDITOR_COMMAND = "texleaf.openSnippetEditor";
export const RESTORE_DEFAULT_SNIPPETS_COMMAND =
  "texleaf.restoreDefaultSnippets";

const PANEL_VIEW_TYPE = "texleaf.snippetEditor";
const MAX_EDITABLE_CHARACTERS = 10_000_000;
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
  lastLoaded: FileContent | undefined;
}

type WebviewMessage =
  | { readonly type: "ready" }
  | { readonly type: "dirty"; readonly dirty: boolean }
  | { readonly type: "reload"; readonly requestId: string }
  | { readonly type: "restoreDefaults"; readonly requestId: string }
  | {
      readonly type: "save";
      readonly requestId: string;
      readonly text: string;
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

  public async open(): Promise<void> {
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
      existing.panel.reveal(vscode.ViewColumn.Active, true);
      return;
    }

    if (this.opening !== undefined) {
      await this.opening;
      return;
    }

    const opening = this.openSession(uri, key);
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

  private async openSession(uri: vscode.Uri, key: string): Promise<void> {
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
      "TeXLeaf 全局片段",
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
      lastLoaded: undefined,
    };
    this.sessions.set(key, session);

    session.subscriptions.push(
      panel.webview.onDidReceiveMessage((message: unknown) => {
        const parsed = parseWebviewMessage(message);
        if (parsed === undefined) {
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
    if (message.type !== "ready" && !session.ready) {
      return;
    }

    switch (message.type) {
      case "ready":
        if (session.ready) {
          return;
        }
        session.ready = true;
        await this.loadIntoPanel(session, null);
        return;
      case "reload":
        await this.loadIntoPanel(session, message.requestId);
        return;
      case "restoreDefaults":
        await this.performRestoreDefaults(session, message.requestId);
        return;
      case "save":
        await this.saveFromPanel(session, message.requestId, message.text);
    }
  }

  private async loadIntoPanel(
    session: PanelSession,
    requestId: string | null,
  ): Promise<void> {
    try {
      const content = await readSnippetFile(session.uri);
      session.lastLoaded = content;
      session.webviewDirty = false;
      await postMessage(session, {
        type: "content",
        requestId,
        text: content.text,
        exists: content.exists,
        location: formatSnippetLocation(session.uri),
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

  private async saveFromPanel(
    session: PanelSession,
    requestId: string,
    text: string,
  ): Promise<void> {
    if (text.length > MAX_EDITABLE_CHARACTERS) {
      await postMessage(session, {
        type: "result",
        requestId,
        action: "save",
        ok: false,
        tone: "error",
        message: "内容超过 1000 万字符，未写入文件。",
      });
      return;
    }

    if (session.lastLoaded === undefined) {
      await postMessage(session, {
        type: "result",
        requestId,
        action: "save",
        ok: false,
        tone: "error",
        message: "尚未成功读取磁盘文件，未保存。请先重新加载。",
      });
      return;
    }

    const validationProblem = validateSnippetEditorText(text);
    if (validationProblem !== undefined) {
      await postMessage(session, {
        type: "result",
        requestId,
        action: "save",
        ok: false,
        tone: "error",
        message: `${validationProblem} 文件尚未写入，请在面板中修正后重试。`,
      });
      return;
    }

    const dirtyDocument = vscode.workspace.textDocuments.find(
      (document) =>
        document.isDirty && document.uri.toString() === session.uri.toString(),
    );
    if (dirtyDocument !== undefined) {
      await postMessage(session, {
        type: "result",
        requestId,
        action: "save",
        ok: false,
        tone: "error",
        message: "该文件在文本编辑器中还有未保存的更改；请先处理这些更改。",
      });
      return;
    }

    try {
      const diskContent = await readSnippetFile(session.uri);
      if (
        diskContent.exists !== session.lastLoaded.exists ||
        diskContent.text !== session.lastLoaded.text
      ) {
        await postMessage(session, {
          type: "result",
          requestId,
          action: "save",
          ok: false,
          tone: "error",
          message: "磁盘文件已在编辑器外发生变化。请先从磁盘重新加载，再合并修改。",
        });
        return;
      }
    } catch (error) {
      await postMessage(session, {
        type: "result",
        requestId,
        action: "save",
        ok: false,
        tone: "error",
        message: `无法确认磁盘文件状态，未保存：${errorMessage(error)}`,
      });
      return;
    }

    try {
      await vscode.workspace.fs.createDirectory(session.directory);
      await vscode.workspace.fs.writeFile(
        session.uri,
        new TextEncoder().encode(text),
      );
      session.lastLoaded = { text, exists: true };
      session.webviewDirty = false;
    } catch (error) {
      await postMessage(session, {
        type: "result",
        requestId,
        action: "save",
        ok: false,
        tone: "error",
        message: `保存失败：${errorMessage(error)}`,
      });
      return;
    }

    try {
      await this.options.onDidSave?.(session.uri);
      await postMessage(session, {
        type: "result",
        requestId,
        action: "save",
        ok: true,
        tone: "success",
        message: "已保存并重新加载 TeXLeaf 片段。",
      });
    } catch (error) {
      await postMessage(session, {
        type: "result",
        requestId,
        action: "save",
        ok: true,
        tone: "warning",
        message: `文件已保存，但片段重新加载失败：${errorMessage(error)}`,
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

function validateSnippetEditorText(text: string): string | undefined {
  const errors: ParseError[] = [];
  const value = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  const firstError = errors[0];
  if (firstError !== undefined) {
    return `JSONC 解析失败：${printParseErrorCode(firstError.error)}（偏移 ${firstError.offset}）。`;
  }
  if (Array.isArray(value)) {
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return "片段库顶层必须是数组，或包含 snippets 的对象。";
  }
  const snippets = (value as Record<string, unknown>).snippets;
  if (Array.isArray(snippets)) {
    return undefined;
  }
  if (typeof snippets === "string") {
    const nestedErrors: ParseError[] = [];
    const nested = parse(snippets, nestedErrors, {
      allowTrailingComma: true,
      disallowComments: false,
    }) as unknown;
    if (nestedErrors.length === 0 && Array.isArray(nested)) {
      return undefined;
    }
    return "旧格式 snippets 字符串必须包含有效的 JSON/JSONC 数组。";
  }
  return "片段库对象必须包含 snippets 数组。";
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
    vscode.commands.registerCommand(OPEN_SNIPPET_EDITOR_COMMAND, () => editor.open()),
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

function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }

  switch (value.type) {
    case "ready":
      return hasOnlyKeys(value, ["type"]) ? { type: "ready" } : undefined;
    case "dirty":
      return hasOnlyKeys(value, ["type", "dirty"]) &&
        typeof value.dirty === "boolean"
        ? { type: "dirty", dirty: value.dirty }
        : undefined;
    case "reload": {
      if (
        !hasOnlyKeys(value, ["type", "requestId"]) ||
        !isRequestId(value.requestId)
      ) {
        return undefined;
      }
      return { type: "reload", requestId: value.requestId };
    }
    case "restoreDefaults": {
      if (
        !hasOnlyKeys(value, ["type", "requestId"]) ||
        !isRequestId(value.requestId)
      ) {
        return undefined;
      }
      return { type: "restoreDefaults", requestId: value.requestId };
    }
    case "save": {
      if (
        !hasOnlyKeys(value, ["type", "requestId", "text"]) ||
        !isRequestId(value.requestId) ||
        typeof value.text !== "string"
      ) {
        return undefined;
      }
      return { type: "save", requestId: value.requestId, text: value.text };
    }
    default:
      return undefined;
  }
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowedKeys.has(key));
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 64 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
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
  const nonce = randomBytes(24).toString("hex");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TeXLeaf 全局用户片段</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 20px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    main {
      display: grid;
      grid-template-rows: auto auto minmax(320px, 1fr) auto;
      gap: 14px;
      min-height: calc(100vh - 40px);
      max-width: 1200px;
      margin: 0 auto;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    h1, h2, p {
      margin-top: 0;
    }
    h1 {
      margin-bottom: 5px;
      font-size: 1.35rem;
    }
    h2 {
      margin-bottom: 6px;
      font-size: 1rem;
    }
    .target {
      margin-bottom: 0;
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      flex: 0 0 auto;
      gap: 8px;
    }
    button {
      border: 1px solid transparent;
      border-radius: 2px;
      padding: 6px 12px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      cursor: pointer;
    }
    button:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      border-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    button:focus-visible,
    textarea:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.65;
    }
    aside {
      border-left: 3px solid var(--vscode-editorInfo-foreground);
      padding: 10px 12px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-textBlockQuote-background);
    }
    aside ul {
      margin: 0;
      padding-left: 20px;
    }
    aside li + li {
      margin-top: 3px;
    }
    .editor-wrap {
      display: grid;
      grid-template-rows: auto minmax(300px, 1fr);
      gap: 6px;
      min-height: 0;
    }
    label {
      font-weight: 600;
    }
    textarea {
      width: 100%;
      min-height: 360px;
      resize: vertical;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      padding: 12px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.5;
      tab-size: 2;
      white-space: pre;
    }
    footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      min-height: 20px;
      color: var(--vscode-descriptionForeground);
    }
    #status.success {
      color: var(--vscode-testing-iconPassed, var(--vscode-foreground));
    }
    #status.warning {
      color: var(--vscode-editorWarning-foreground, var(--vscode-foreground));
    }
    #status.error {
      color: var(--vscode-errorForeground);
    }
    kbd {
      border: 1px solid var(--vscode-widget-border);
      border-radius: 3px;
      padding: 1px 4px;
      font-family: inherit;
    }
    @media (max-width: 640px) {
      header {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>TeXLeaf 全局用户片段</h1>
        <p id="target" class="target">正在读取用户级全局配置…</p>
      </div>
      <div class="actions">
        <button id="save" type="button" disabled>保存</button>
        <button id="reload" class="secondary" type="button" disabled>从磁盘重新加载</button>
        <button id="restore-defaults" class="secondary" type="button" disabled>恢复默认片段…</button>
      </div>
    </header>

    <aside role="note" aria-labelledby="safety-title">
      <h2 id="safety-title">安全说明</h2>
      <ul>
        <li>这里只读写 VS Code 当前用户配置中的固定文件 <code>texleaf-snippets.jsonc</code>；所有工作区共用，文件必须是 JSON 或 JSONC。</li>
        <li><code>replacement</code> 必须是字符串；TeXLeaf 不执行函数 replacement，也不执行任意 JavaScript。</li>
        <li>从他人项目复制片段前请先检查内容；无法通过结构校验的定义会被跳过。</li>
      </ul>
    </aside>

    <div class="editor-wrap">
      <label for="editor">片段文件内容</label>
      <textarea id="editor" aria-describedby="status" autocomplete="off" autocapitalize="off" spellcheck="false" wrap="off" readonly></textarea>
    </div>

    <footer>
      <span id="status" role="status" aria-live="polite">等待载入…</span>
      <span><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>S</kbd> 保存</span>
    </footer>
  </main>

  <script nonce="${nonce}">
    (() => {
      "use strict";

      const vscode = acquireVsCodeApi();
      const editor = document.getElementById("editor");
      const saveButton = document.getElementById("save");
      const reloadButton = document.getElementById("reload");
      const restoreDefaultsButton = document.getElementById("restore-defaults");
      const target = document.getElementById("target");
      const status = document.getElementById("status");

      let baseline = "";
      let busy = true;
      let discardConfirmation = false;
      let lastReportedDirty = false;
      let requestCounter = 0;
      const pendingSaves = new Map();

      const nextRequestId = () => {
        requestCounter += 1;
        return "webview-" + requestCounter;
      };

      const isDirty = () => editor.value !== baseline;

      const setStatus = (message, tone) => {
        status.textContent = message;
        status.className = tone || "";
      };

      const updateDirtyState = () => {
        discardConfirmation = false;
        const dirty = isDirty();
        if (dirty !== lastReportedDirty) {
          lastReportedDirty = dirty;
          vscode.postMessage({ type: "dirty", dirty });
        }
        if (!busy) {
          setStatus(dirty ? "有尚未保存的更改。" : "内容已与磁盘同步。", "");
        }
      };

      const setBusy = (value, message) => {
        busy = value;
        saveButton.disabled = value;
        reloadButton.disabled = value;
        restoreDefaultsButton.disabled = value;
        editor.readOnly = value;
        if (message) {
          setStatus(message, "");
        }
      };

      const requestSave = () => {
        if (busy) {
          return;
        }
        discardConfirmation = false;
        const requestId = nextRequestId();
        pendingSaves.set(requestId, editor.value);
        setBusy(true, "正在保存…");
        vscode.postMessage({ type: "save", requestId, text: editor.value });
      };

      const requestReload = () => {
        if (busy) {
          return;
        }
        if (isDirty() && !discardConfirmation) {
          discardConfirmation = true;
          setStatus("再次点击“从磁盘重新加载”以丢弃尚未保存的更改。", "warning");
          return;
        }
        discardConfirmation = false;
        const requestId = nextRequestId();
        setBusy(true, "正在从磁盘重新加载…");
        vscode.postMessage({ type: "reload", requestId });
      };

      const requestRestoreDefaults = () => {
        if (busy) {
          return;
        }
        if (isDirty()) {
          setStatus("请先保存或重新加载尚未保存的更改，再恢复默认片段。", "warning");
          return;
        }
        discardConfirmation = false;
        const requestId = nextRequestId();
        setBusy(true, "正在准备恢复默认片段…");
        vscode.postMessage({ type: "restoreDefaults", requestId });
      };

      saveButton.addEventListener("click", requestSave);
      reloadButton.addEventListener("click", requestReload);
      restoreDefaultsButton.addEventListener("click", requestRestoreDefaults);
      editor.addEventListener("input", updateDirtyState);
      document.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          requestSave();
        }
      });

      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || typeof message !== "object" || typeof message.type !== "string") {
          return;
        }

        if (
          message.type === "content" &&
          typeof message.text === "string" &&
          typeof message.location === "string" &&
          typeof message.exists === "boolean"
        ) {
          editor.value = message.text;
          baseline = message.text;
          lastReportedDirty = false;
          target.textContent = "用户级全局配置 / " + message.location;
          setBusy(false);
          setStatus(
            message.exists
              ? "已从磁盘载入。"
              : "文件尚不存在；保存时会创建安全的 JSONC 文件。",
            message.exists ? "success" : "warning",
          );
          return;
        }

        if (
          message.type === "result" &&
          typeof message.requestId !== "undefined" &&
          typeof message.action === "string" &&
          typeof message.ok === "boolean" &&
          typeof message.message === "string"
        ) {
          if (message.action === "save") {
            const savedText = pendingSaves.get(message.requestId);
            pendingSaves.delete(message.requestId);
            if (message.ok && typeof savedText === "string") {
              baseline = savedText;
              const dirty = isDirty();
              if (dirty !== lastReportedDirty) {
                lastReportedDirty = dirty;
                vscode.postMessage({ type: "dirty", dirty });
              }
            }
          }
          setBusy(false);
          setStatus(message.message, typeof message.tone === "string" ? message.tone : "");
          if (message.ok && isDirty()) {
            setStatus("已保存提交的版本；编辑框中仍有新的未保存更改。", "warning");
          }
          return;
        }

        if (
          message.type === "busy" &&
          typeof message.value === "boolean" &&
          (typeof message.message === "undefined" ||
            typeof message.message === "string")
        ) {
          setBusy(message.value, message.message);
          return;
        }

        if (message.type === "error" && typeof message.message === "string") {
          setBusy(false);
          setStatus(message.message, "error");
        }
      });

      vscode.postMessage({ type: "ready" });
    })();
  </script>
</body>
</html>`;
}
