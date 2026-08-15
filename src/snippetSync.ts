import { createHash } from "node:crypto";
import type * as vscode from "vscode";
import { parse, type ParseError } from "jsonc-parser";
import { serializeDefaultSnippetLibrary } from "./defaultLibrary";

/**
 * Files under ExtensionContext.globalStorageUri are deliberately not part of
 * VS Code Settings Sync.  TeXLeaf therefore mirrors the one editable global
 * file into one explicitly-synchronised globalState value.  Keeping the whole
 * envelope under one key also makes VS Code's per-key merge atomic.
 */
export const SNIPPET_SYNC_STATE_KEY = "texleaf.snippetLibrarySync.v1";

/** Local-only three-way merge metadata.  Do not add this key to setKeysForSync. */
export const SNIPPET_SYNC_METADATA_KEY =
  "texleaf.snippetLibrarySyncMetadata.v1";

/**
 * Stay comfortably below VS Code's 512 KiB extension-state warning.  This is
 * measured after JSON serialisation, so escaping-heavy snippet libraries do
 * not accidentally exceed the budget.
 */
export const DEFAULT_MAX_SYNC_PAYLOAD_BYTES = 256 * 1024;
export const DEFAULT_SYNC_CHECK_INTERVAL_MS = 15_000;
export const DEFAULT_INITIAL_SYNC_GRACE_MS = 30_000;
export const MAX_SYNC_ANCESTOR_HASHES = 32;

export interface SyncedSnippetEnvelope {
  readonly schemaVersion: 1;
  readonly content: string;
  readonly contentHash: string;
  /** Newest-first lineage used to distinguish descendants from sibling edits. */
  readonly ancestorHashes?: readonly string[];
}

interface LocalSyncMetadata {
  readonly schemaVersion: 1;
  readonly baseHash?: string;
  /** An upload is only locally committed; Settings Sync exposes no cloud ack. */
  readonly pendingUpload?: boolean;
  readonly pendingParentHash?: string;
  readonly bootstrapStartedAt?: number;
}

export interface SnippetSyncRepository {
  readonly globalSnippetUri: vscode.Uri;
  readonly onDidChange: vscode.Event<unknown>;
  reload(): Promise<void>;
  isGlobalSnippetFileCurrent(): Promise<boolean>;
  replaceGlobalSnippetFile(
    bytes: Uint8Array,
    expectedHash: string,
  ): Promise<"written" | "changed">;
}

export interface SnippetSyncLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SnippetSyncControllerOptions {
  readonly logger?: SnippetSyncLogger;
  /** True while the custom Webview editor holds changes not yet on disk. */
  readonly isEditing?: () => boolean;
  readonly checkIntervalMs?: number;
  readonly initialSyncGraceMs?: number;
  readonly maxPayloadBytes?: number;
  readonly factoryContent?: string;
  /** Injectable only to keep timing semantics deterministic in focused tests. */
  readonly now?: () => number;
}

export interface SnippetSyncDecisionInput {
  readonly localHash: string;
  readonly remoteHash?: string;
  readonly remoteAncestorHashes?: readonly string[];
  readonly baseHash?: string;
  readonly pendingUpload?: boolean;
  readonly pendingParentHash?: string;
  readonly factoryHash?: string;
  readonly initializationReady?: boolean;
}

export type SnippetSyncDecision =
  | { readonly kind: "settled" }
  | { readonly kind: "publish-local" }
  | { readonly kind: "apply-remote" }
  | { readonly kind: "conflict" }
  | { readonly kind: "defer" };

export type DecodedSyncedEnvelope =
  | { readonly kind: "none" }
  | {
      readonly kind: "valid";
      readonly envelope: SyncedSnippetEnvelope;
      readonly bytes: Uint8Array;
    }
  | { readonly kind: "invalid"; readonly reason: string };

export type CreatedSyncedEnvelope =
  | {
      readonly kind: "valid";
      readonly envelope: SyncedSnippetEnvelope;
      readonly payloadBytes: number;
    }
  | {
      readonly kind: "too-large";
      readonly payloadBytes: number;
      readonly maximumBytes: number;
    };

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const KEEP_LOCAL = "保留本机版本并同步";
const USE_SYNCED = "使用已同步版本";
const HANDLE_LATER = "稍后处理";
const CONFLICT_SNOOZE_MS = 5 * 60_000;

/** Pure three-way merge decision used by the controller and unit tests. */
export function decideSnippetSync(
  input: SnippetSyncDecisionInput,
): SnippetSyncDecision {
  const {
    localHash,
    remoteHash,
    baseHash,
    factoryHash,
    pendingParentHash,
  } = input;

  if (remoteHash === localHash) {
    return { kind: "settled" };
  }

  if (remoteHash === undefined) {
    if (baseHash === undefined && input.initializationReady === false) {
      return { kind: "defer" };
    }
    return { kind: "publish-local" };
  }

  if (baseHash === undefined) {
    // This is the normal first-start path on a second machine: initialization
    // created the deterministic factory file before Settings Sync delivered a
    // previously customised library.  An existing non-factory local library
    // is never guessed away.
    if (factoryHash !== undefined && localHash === factoryHash) {
      return { kind: "apply-remote" };
    }
    return { kind: "conflict" };
  }

  if (input.pendingUpload === true && localHash === baseHash) {
    // Updating globalState only commits the local Memento. There is no API
    // that acknowledges the cloud write, so the uploaded hash must remain
    // pending. If another machine publishes a sibling from the same parent,
    // its lineage does not contain our pending hash and must be surfaced as a
    // conflict instead of being mistaken for a one-sided remote edit.
    if (
      pendingParentHash !== undefined &&
      remoteHash === pendingParentHash
    ) {
      return { kind: "publish-local" };
    }
    if (input.remoteAncestorHashes?.includes(localHash) === true) {
      return { kind: "apply-remote" };
    }
    return { kind: "conflict" };
  }

  if (localHash === baseHash) {
    return { kind: "apply-remote" };
  }
  if (remoteHash === baseHash) {
    return { kind: "publish-local" };
  }
  return { kind: "conflict" };
}

export function hashSnippetBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hashSnippetContent(content: string): string {
  return hashSnippetBytes(new TextEncoder().encode(content));
}

export function createSyncedSnippetEnvelope(
  content: string,
  maximumBytes = DEFAULT_MAX_SYNC_PAYLOAD_BYTES,
  ancestorHashes: readonly string[] = [],
): CreatedSyncedEnvelope {
  const contentHash = hashSnippetContent(content);
  const normalizedAncestors = normalizeAncestorHashes(
    ancestorHashes,
    contentHash,
  );
  const envelope: SyncedSnippetEnvelope = {
    schemaVersion: 1,
    content,
    contentHash,
    ...(normalizedAncestors.length === 0
      ? {}
      : { ancestorHashes: normalizedAncestors }),
  };
  const payloadBytes = new TextEncoder().encode(
    JSON.stringify(envelope),
  ).byteLength;
  if (payloadBytes > maximumBytes) {
    return { kind: "too-large", payloadBytes, maximumBytes };
  }
  return { kind: "valid", envelope, payloadBytes };
}

/**
 * Treat a remote value as untrusted state.  Integrity, size, JSONC syntax and
 * the repository's accepted top-level shapes are checked before any disk
 * replacement is attempted.
 */
export function decodeSyncedSnippetEnvelope(
  value: unknown,
  maximumBytes = DEFAULT_MAX_SYNC_PAYLOAD_BYTES,
): DecodedSyncedEnvelope {
  if (value === undefined) {
    return { kind: "none" };
  }
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return { kind: "invalid", reason: "同步数据的版本或结构无效" };
  }
  if (
    typeof value.content !== "string" ||
    typeof value.contentHash !== "string" ||
    !HASH_PATTERN.test(value.contentHash)
  ) {
    return { kind: "invalid", reason: "同步数据缺少有效的内容或哈希" };
  }

  let ancestorHashes: readonly string[] = [];
  if (value.ancestorHashes !== undefined) {
    if (
      !Array.isArray(value.ancestorHashes) ||
      value.ancestorHashes.length > MAX_SYNC_ANCESTOR_HASHES ||
      !value.ancestorHashes.every(
        (candidate): candidate is string =>
          typeof candidate === "string" && HASH_PATTERN.test(candidate),
      ) ||
      new Set(value.ancestorHashes).size !== value.ancestorHashes.length ||
      value.ancestorHashes.includes(value.contentHash)
    ) {
      return { kind: "invalid", reason: "同步数据的版本谱系无效" };
    }
    ancestorHashes = value.ancestorHashes;
  }

  const created = createSyncedSnippetEnvelope(
    value.content,
    maximumBytes,
    ancestorHashes,
  );
  if (created.kind === "too-large") {
    return {
      kind: "invalid",
      reason: `同步数据超过 ${formatKiB(maximumBytes)} KiB 上限`,
    };
  }
  if (created.envelope.contentHash !== value.contentHash) {
    return { kind: "invalid", reason: "同步数据的内容哈希不匹配" };
  }
  if (!isSnippetLibraryText(value.content)) {
    return { kind: "invalid", reason: "同步数据不是有效的 Snippet JSONC" };
  }
  return {
    kind: "valid",
    envelope: created.envelope,
    bytes: new TextEncoder().encode(value.content),
  };
}

export function isSnippetLibraryText(content: string): boolean {
  const errors: ParseError[] = [];
  let value: unknown;
  try {
    value = parse(content, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    }) as unknown;
  } catch {
    return false;
  }
  if (errors.length > 0) {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  if (Array.isArray(value.snippets)) {
    return true;
  }
  if (typeof value.snippets !== "string") {
    return false;
  }

  // The repository supports the legacy representation where `snippets` is a
  // JSON/JSONC array encoded as a string.  Validate the nested value too;
  // merely having a string property is not enough for a sync-safe library.
  const nestedErrors: ParseError[] = [];
  try {
    const nested = parse(value.snippets, nestedErrors, {
      allowTrailingComma: true,
      disallowComments: false,
    }) as unknown;
    return nestedErrors.length === 0 && Array.isArray(nested);
  } catch {
    return false;
  }
}

/**
 * Synchronises the repository's global JSONC file without ever making the
 * public settings.json the storage surface.  No VS Code API exposes a global
 * state change event, so focus changes and a modest timer are both used.
 */
export class SnippetSyncController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly warned = new Set<string>();
  private readonly conflictSnoozeUntil = new Map<string, number>();
  private readonly logger: SnippetSyncLogger | undefined;
  private readonly isEditing: () => boolean;
  private readonly checkIntervalMs: number;
  private readonly initialSyncGraceMs: number;
  private readonly maxPayloadBytes: number;
  private readonly factoryHash: string;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private bootstrapTimer: ReturnType<typeof setTimeout> | undefined;
  private checkPromise: Promise<void> | undefined;
  private checkAgain = false;
  private suppressRepositoryEvent = false;
  private started = false;
  private disposed = false;

  public constructor(
    private readonly api: typeof vscode,
    private readonly context: vscode.ExtensionContext,
    private readonly repository: SnippetSyncRepository,
    options: SnippetSyncControllerOptions = {},
  ) {
    this.logger = options.logger;
    this.isEditing = options.isEditing ?? (() => false);
    this.checkIntervalMs =
      options.checkIntervalMs ?? DEFAULT_SYNC_CHECK_INTERVAL_MS;
    this.initialSyncGraceMs =
      options.initialSyncGraceMs ?? DEFAULT_INITIAL_SYNC_GRACE_MS;
    this.maxPayloadBytes =
      options.maxPayloadBytes ?? DEFAULT_MAX_SYNC_PAYLOAD_BYTES;
    this.factoryHash = hashSnippetContent(
      options.factoryContent ?? serializeDefaultSnippetLibrary(),
    );
    this.now = options.now ?? Date.now;
  }

  public async start(): Promise<void> {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;

    // Calling this with the complete set on every activation is intentional:
    // VS Code stores the registration per extension version.
    this.context.globalState.setKeysForSync([SNIPPET_SYNC_STATE_KEY]);

    this.disposables.push(
      this.repository.onDidChange(() => {
        if (!this.suppressRepositoryEvent) {
          void this.checkNow();
        }
      }),
      this.api.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          void this.checkNow();
        }
      }),
      this.api.workspace.onDidSaveTextDocument((document) => {
        if (this.sameUri(document.uri, this.repository.globalSnippetUri)) {
          void this.checkNow();
        }
      }),
      this.api.workspace.onDidCloseTextDocument((document) => {
        if (this.sameUri(document.uri, this.repository.globalSnippetUri)) {
          void this.checkNow();
        }
      }),
    );

    this.timer = setInterval(() => {
      void this.checkNow();
    }, this.checkIntervalMs);
    this.timer.unref?.();
    await this.checkNow();
  }

  public checkNow(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    this.checkAgain = true;
    if (this.checkPromise === undefined) {
      const running = this.drainChecks();
      this.checkPromise = running;
      void running.finally(() => {
        if (this.checkPromise === running) {
          this.checkPromise = undefined;
        }
        if (this.checkAgain && !this.disposed) {
          void this.checkNow();
        }
      });
    }
    return this.checkPromise;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.checkAgain = false;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.bootstrapTimer !== undefined) {
      clearTimeout(this.bootstrapTimer);
      this.bootstrapTimer = undefined;
    }
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.conflictSnoozeUntil.clear();
    this.warned.clear();
  }

  private async drainChecks(): Promise<void> {
    while (this.checkAgain && !this.disposed) {
      this.checkAgain = false;
      try {
        await this.reconcile();
      } catch (error) {
        this.logger?.error(`Snippet Settings Sync 检查失败：${errorMessage(error)}`);
      }
    }
  }

  private async reconcile(): Promise<void> {
    if (this.disposed || this.hasUnsavedChanges()) {
      return;
    }

    const remote = this.readRemoteEnvelope();
    if (remote.kind === "invalid") {
      this.warnOnce(
        `invalid-remote:${diagnosticHash(
          this.context.globalState.get<unknown>(SNIPPET_SYNC_STATE_KEY),
        )}`,
        `TeXLeaf 未使用损坏的 Settings Sync 片段数据：${remote.reason}。本机文件未被覆盖。`,
        true,
      );
      return;
    }

    const local = await this.readValidLocalFile();
    if (local === undefined || this.disposed || this.hasUnsavedChanges()) {
      return;
    }

    const metadata = this.readMetadata();
    const initializationReady = await this.initializationIsReady(
      metadata,
      remote,
    );
    if (this.disposed) {
      return;
    }

    const decision = decideSnippetSync({
      localHash: local.hash,
      ...(remote.kind === "valid"
        ? {
            remoteHash: remote.envelope.contentHash,
            remoteAncestorHashes: remote.envelope.ancestorHashes ?? [],
          }
        : {}),
      ...(metadata.baseHash === undefined
        ? {}
        : { baseHash: metadata.baseHash }),
      ...(metadata.pendingUpload === true
        ? {
            pendingUpload: true,
            ...(metadata.pendingParentHash === undefined
              ? {}
              : { pendingParentHash: metadata.pendingParentHash }),
          }
        : {}),
      factoryHash: this.factoryHash,
      initializationReady,
    });

    switch (decision.kind) {
      case "defer":
        return;
      case "settled":
        // Equality with the local Memento is not a cloud acknowledgement. A
        // pending upload remains pending until a value with descendant lineage
        // is observed or the user explicitly resolves a conflict.
        if (metadata.pendingUpload !== true) {
          await this.setBaseHash(local.hash);
        }
        return;
      case "publish-local":
        await this.publishLocal(local, remote);
        return;
      case "apply-remote":
        if (remote.kind === "valid") {
          await this.applyRemote(local.hash, remote);
        }
        return;
      case "conflict":
        if (remote.kind === "valid") {
          await this.resolveConflict(local, remote, metadata.baseHash);
        }
        return;
    }
  }

  private async readValidLocalFile(): Promise<LocalFile | undefined> {
    let bytes: Uint8Array;
    try {
      bytes = await this.api.workspace.fs.readFile(
        this.repository.globalSnippetUri,
      );
    } catch (error) {
      this.logger?.warn(`无法读取全局 Snippet 文件：${errorMessage(error)}`);
      return undefined;
    }
    let hash = hashSnippetBytes(bytes);

    let current = await this.repository.isGlobalSnippetFileCurrent();
    if (!current) {
      // Watchers are advisory and can be delayed by remote file providers.
      // One guarded reload ensures a valid save is not ignored indefinitely.
      this.suppressRepositoryEvent = true;
      try {
        await this.repository.reload();
      } finally {
        this.suppressRepositoryEvent = false;
      }
      current = await this.repository.isGlobalSnippetFileCurrent();
    }
    if (!current) {
      this.warnOnce(
        `invalid-local:${hash}`,
        "全局 Snippet 文件尚未通过 JSONC 校验；修复并保存前不会上传或覆盖同步数据。",
        false,
      );
      return undefined;
    }

    // isGlobalSnippetFileCurrent() performs its own disk read.  Capture the
    // bytes once more afterwards so a save racing the first read cannot make a
    // stale snapshot reach conflict UI or an upload attempt.
    try {
      const latestBytes = await this.api.workspace.fs.readFile(
        this.repository.globalSnippetUri,
      );
      const latestHash = hashSnippetBytes(latestBytes);
      if (latestHash !== hash) {
        if (!(await this.repository.isGlobalSnippetFileCurrent())) {
          this.checkAgain = true;
          return undefined;
        }
        bytes = latestBytes;
        hash = latestHash;
      }
    } catch {
      this.checkAgain = true;
      return undefined;
    }

    const content = decodeUtf8Losslessly(bytes);
    if (content === undefined) {
      this.warnOnce(
        `invalid-utf8:${hash}`,
        "全局 Snippet 文件不是可无损同步的 UTF-8 文本；同步已暂停。",
        true,
      );
      return undefined;
    }
    if (!isSnippetLibraryText(content)) {
      this.warnOnce(
        `invalid-structure:${hash}`,
        "全局 Snippet 文件缺少有效的 snippets 数组；修复前不会上传到 Settings Sync。",
        false,
      );
      return undefined;
    }
    return { bytes, content, hash };
  }

  private async publishLocal(
    local: LocalFile,
    expectedRemote: DecodedSyncedEnvelope,
  ): Promise<void> {
    const pendingParentHash =
      expectedRemote.kind === "valid"
        ? expectedRemote.envelope.contentHash
        : undefined;
    const ancestorHashes =
      expectedRemote.kind === "valid"
        ? [
            expectedRemote.envelope.contentHash,
            ...(expectedRemote.envelope.ancestorHashes ?? []),
          ]
        : [];
    const created = createSyncedSnippetEnvelope(
      local.content,
      this.maxPayloadBytes,
      ancestorHashes,
    );
    if (created.kind === "too-large") {
      this.warnTooLarge(local.hash, created);
      return;
    }
    if (
      this.disposed ||
      this.hasUnsavedChanges() ||
      !(await this.localStillMatches(local.hash)) ||
      !this.remoteStillMatches(expectedRemote)
    ) {
      this.checkAgain = true;
      return;
    }

    await this.context.globalState.update(
      SNIPPET_SYNC_STATE_KEY,
      created.envelope,
    );
    if (this.disposed) {
      return;
    }
    const published = this.readRemoteEnvelope();
    if (
      (await this.localStillMatches(local.hash)) &&
      published.kind === "valid" &&
      envelopesMatch(published.envelope, created.envelope)
    ) {
      await this.setPendingUpload(local.hash, pendingParentHash);
      this.logger?.info(
        `已把全局 Snippet 文件镜像到 Settings Sync（${formatKiB(
          created.payloadBytes,
        )} KiB）。`,
      );
    } else {
      this.checkAgain = true;
    }
  }

  private async applyRemote(
    expectedLocalHash: string,
    remote: Extract<DecodedSyncedEnvelope, { kind: "valid" }>,
  ): Promise<void> {
    if (
      this.disposed ||
      this.hasUnsavedChanges() ||
      !(await this.localStillMatches(expectedLocalHash)) ||
      !this.remoteStillMatches(remote)
    ) {
      this.checkAgain = true;
      return;
    }

    const result = await this.repository.replaceGlobalSnippetFile(
      remote.bytes,
      expectedLocalHash,
    );
    if (result === "changed") {
      this.checkAgain = true;
      return;
    }

    this.suppressRepositoryEvent = true;
    try {
      await this.repository.reload();
    } finally {
      this.suppressRepositoryEvent = false;
    }
    if (
      this.disposed ||
      !(await this.repository.isGlobalSnippetFileCurrent()) ||
      !(await this.localStillMatches(remote.envelope.contentHash)) ||
      !this.remoteStillMatches(remote)
    ) {
      this.logger?.error(
        "已同步的 Snippet 文件写入后未通过复核；未推进同步基线。",
      );
      this.checkAgain = true;
      return;
    }
    await this.setBaseHash(remote.envelope.contentHash);
    this.logger?.info("已从 VS Code Settings Sync 更新全局 Snippet 文件。");
  }

  private async resolveConflict(
    local: LocalFile,
    remote: Extract<DecodedSyncedEnvelope, { kind: "valid" }>,
    baseHash: string | undefined,
  ): Promise<void> {
    const signature = `${local.hash}:${remote.envelope.contentHash}:${
      baseHash ?? "none"
    }`;
    const now = this.now();
    const snoozeUntil = this.conflictSnoozeUntil.get(signature) ?? 0;
    if (snoozeUntil > now) {
      return;
    }

    const localEnvelope = createSyncedSnippetEnvelope(
      local.content,
      this.maxPayloadBytes,
      [
        remote.envelope.contentHash,
        ...(remote.envelope.ancestorHashes ?? []),
      ],
    );
    const message =
      localEnvelope.kind === "valid"
        ? "TeXLeaf 检测到本机与 Settings Sync 中的 Snippet 都已修改。为避免静默覆盖，请选择要保留的版本。"
        : `TeXLeaf 检测到 Snippet 同步冲突；本机文件超过 ${formatKiB(
            this.maxPayloadBytes,
          )} KiB 同步上限，只能保留本机文件不处理，或改用已同步版本。`;
    const choices =
      localEnvelope.kind === "valid"
        ? ([KEEP_LOCAL, USE_SYNCED, HANDLE_LATER] as const)
        : ([USE_SYNCED, HANDLE_LATER] as const);
    const choice = await this.api.window.showWarningMessage(
      message,
      ...choices,
    );
    if (this.disposed) {
      return;
    }

    if (choice === KEEP_LOCAL) {
      await this.publishLocal(local, remote);
      return;
    }
    if (choice === USE_SYNCED) {
      await this.applyRemote(local.hash, remote);
      return;
    }
    this.conflictSnoozeUntil.set(
      signature,
      this.now() + CONFLICT_SNOOZE_MS,
    );
  }

  private async initializationIsReady(
    metadata: LocalSyncMetadata,
    remote: DecodedSyncedEnvelope,
  ): Promise<boolean> {
    if (remote.kind !== "none" || metadata.baseHash !== undefined) {
      return true;
    }

    const now = this.now();
    if (metadata.bootstrapStartedAt === undefined) {
      await this.context.globalState.update(SNIPPET_SYNC_METADATA_KEY, {
        schemaVersion: 1,
        bootstrapStartedAt: now,
      } satisfies LocalSyncMetadata);
      this.scheduleBootstrapCheck(this.initialSyncGraceMs);
      return this.initialSyncGraceMs <= 0;
    }
    const remaining =
      metadata.bootstrapStartedAt + this.initialSyncGraceMs - now;
    if (remaining > 0) {
      this.scheduleBootstrapCheck(remaining);
      return false;
    }
    return true;
  }

  private scheduleBootstrapCheck(delayMs: number): void {
    if (this.bootstrapTimer !== undefined || this.disposed) {
      return;
    }
    this.bootstrapTimer = setTimeout(() => {
      this.bootstrapTimer = undefined;
      void this.checkNow();
    }, Math.max(0, delayMs));
    this.bootstrapTimer.unref?.();
  }

  private readRemoteEnvelope(): DecodedSyncedEnvelope {
    return decodeSyncedSnippetEnvelope(
      this.context.globalState.get<unknown>(SNIPPET_SYNC_STATE_KEY),
      this.maxPayloadBytes,
    );
  }

  private remoteStillMatches(expected: DecodedSyncedEnvelope): boolean {
    const current = this.readRemoteEnvelope();
    if (expected.kind === "none") {
      return current.kind === "none";
    }
    return (
      expected.kind === "valid" &&
      current.kind === "valid" &&
      envelopesMatch(current.envelope, expected.envelope)
    );
  }

  private readMetadata(): LocalSyncMetadata {
    const value = this.context.globalState.get<unknown>(
      SNIPPET_SYNC_METADATA_KEY,
    );
    if (!isRecord(value) || value.schemaVersion !== 1) {
      return { schemaVersion: 1 };
    }
    const baseHash =
      typeof value.baseHash === "string" && HASH_PATTERN.test(value.baseHash)
        ? value.baseHash
        : undefined;
    const bootstrapStartedAt =
      typeof value.bootstrapStartedAt === "number" &&
      Number.isFinite(value.bootstrapStartedAt) &&
      value.bootstrapStartedAt >= 0
        ? value.bootstrapStartedAt
        : undefined;
    const pendingUpload = value.pendingUpload === true && baseHash !== undefined;
    const pendingParentHash =
      pendingUpload &&
      typeof value.pendingParentHash === "string" &&
      HASH_PATTERN.test(value.pendingParentHash)
        ? value.pendingParentHash
        : undefined;
    return {
      schemaVersion: 1,
      ...(baseHash === undefined ? {} : { baseHash }),
      ...(pendingUpload ? { pendingUpload: true } : {}),
      ...(pendingParentHash === undefined ? {} : { pendingParentHash }),
      ...(bootstrapStartedAt === undefined ? {} : { bootstrapStartedAt }),
    };
  }

  private async setBaseHash(baseHash: string): Promise<void> {
    const current = this.readMetadata();
    if (
      current.baseHash === baseHash &&
      current.pendingUpload !== true &&
      current.bootstrapStartedAt === undefined
    ) {
      return;
    }
    await this.context.globalState.update(SNIPPET_SYNC_METADATA_KEY, {
      schemaVersion: 1,
      baseHash,
    } satisfies LocalSyncMetadata);
  }

  private async setPendingUpload(
    baseHash: string,
    pendingParentHash: string | undefined,
  ): Promise<void> {
    const current = this.readMetadata();
    if (
      current.baseHash === baseHash &&
      current.pendingUpload === true &&
      current.pendingParentHash === pendingParentHash &&
      current.bootstrapStartedAt === undefined
    ) {
      return;
    }
    await this.context.globalState.update(SNIPPET_SYNC_METADATA_KEY, {
      schemaVersion: 1,
      baseHash,
      pendingUpload: true,
      ...(pendingParentHash === undefined ? {} : { pendingParentHash }),
    } satisfies LocalSyncMetadata);
  }

  private hasUnsavedChanges(): boolean {
    const dirtyTextDocument = this.api.workspace.textDocuments.some(
      (document) => this.isGlobalDocument(document),
    );
    if (dirtyTextDocument) {
      return true;
    }
    try {
      return this.isEditing();
    } catch (error) {
      // A broken editor dirty-state hook must fail closed: applying a remote
      // file would otherwise risk overwriting text that only exists in UI.
      this.logger?.warn(
        `无法确认 Snippet 编辑器是否有未保存内容；同步暂缓：${errorMessage(error)}`,
      );
      return true;
    }
  }

  private isGlobalDocument(document: vscode.TextDocument): boolean {
    return (
      document.isDirty &&
      this.sameUri(document.uri, this.repository.globalSnippetUri)
    );
  }

  private sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
    return left.toString() === right.toString();
  }

  private async localStillMatches(expectedHash: string): Promise<boolean> {
    try {
      return (
        hashSnippetBytes(
          await this.api.workspace.fs.readFile(
            this.repository.globalSnippetUri,
          ),
        ) === expectedHash
      );
    } catch {
      return false;
    }
  }

  private warnTooLarge(
    hash: string,
    result: Extract<CreatedSyncedEnvelope, { kind: "too-large" }>,
  ): void {
    this.warnOnce(
      `too-large:${hash}`,
      `TeXLeaf 全局 Snippet 文件序列化后为 ${formatKiB(
        result.payloadBytes,
      )} KiB，超过 ${formatKiB(
        result.maximumBytes,
      )} KiB 同步上限；本机片段仍可正常使用，但不会上传到 Settings Sync。`,
      true,
    );
  }

  private warnOnce(key: string, message: string, visible: boolean): void {
    if (this.warned.has(key)) {
      return;
    }
    this.warned.add(key);
    this.logger?.warn(message);
    if (visible) {
      void this.api.window.showWarningMessage(message);
    }
  }
}

interface LocalFile {
  readonly bytes: Uint8Array;
  readonly content: string;
  readonly hash: string;
}

function decodeUtf8Losslessly(bytes: Uint8Array): string | undefined {
  try {
    // ignoreBOM=true means the BOM is retained as U+FEFF, which lets the
    // encode/decode round trip preserve the original bytes exactly.
    const content = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    const encoded = new TextEncoder().encode(content);
    if (encoded.byteLength !== bytes.byteLength) {
      return undefined;
    }
    for (let index = 0; index < bytes.byteLength; index += 1) {
      if (encoded[index] !== bytes[index]) {
        return undefined;
      }
    }
    return content;
  } catch {
    return undefined;
  }
}

function diagnosticHash(value: unknown): string {
  try {
    return hashSnippetContent(JSON.stringify(value));
  } catch {
    return "unserializable";
  }
}

function normalizeAncestorHashes(
  hashes: readonly string[],
  contentHash: string,
): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>([contentHash]);
  for (const hash of hashes) {
    if (!HASH_PATTERN.test(hash)) {
      throw new Error("Snippet sync ancestor hash is invalid.");
    }
    if (seen.has(hash)) {
      continue;
    }
    seen.add(hash);
    result.push(hash);
    if (result.length >= MAX_SYNC_ANCESTOR_HASHES) {
      break;
    }
  }
  return result;
}

function envelopesMatch(
  left: SyncedSnippetEnvelope,
  right: SyncedSnippetEnvelope,
): boolean {
  if (
    left.contentHash !== right.contentHash ||
    left.content !== right.content
  ) {
    return false;
  }
  const leftAncestors = left.ancestorHashes ?? [];
  const rightAncestors = right.ancestorHashes ?? [];
  return (
    leftAncestors.length === rightAncestors.length &&
    leftAncestors.every((hash, index) => hash === rightAncestors[index])
  );
}

function formatKiB(bytes: number): string {
  return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
