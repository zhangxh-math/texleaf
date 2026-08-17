import { createHash, randomBytes } from "node:crypto";
import * as vscode from "vscode";

import {
  MAX_PERSISTED_AI_RECORD_BYTES,
  parsePersistedAiIssueRecord,
  shouldCommitPersistedAiIssueRecord,
  type PersistedAiIssueRecord,
} from "./core";

const DIRECTORY_NAME = "ai-writing-issues-v1";
const WRITE_DEBOUNCE_MS = 750;
const MAX_DOCUMENT_RECORDS = 256;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const STALE_TEMP_FILE_MS = 24 * 60 * 60 * 1_000;

interface PendingRecord {
  readonly uriText: string;
  readonly record: PersistedAiIssueRecord;
}

/**
 * Profile-local, non-synced persistence for validated AI issue records.
 * Each URI has an independent hashed file, so unrelated documents and VS Code
 * windows never rewrite a shared index. Writes use temp-file + rename.
 */
export class AiIssuePersistenceStore implements vscode.Disposable {
  private readonly directory: vscode.Uri;
  private readonly pending = new Map<string, PendingRecord>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly lastSavedAt = new Map<string, number>();
  private maintenance: Promise<void> = Promise.resolve();
  private disposed = false;
  private shutdownPromise: Promise<void> | undefined;

  public constructor(
    globalStorageUri: vscode.Uri,
    private readonly output: vscode.LogOutputChannel,
  ) {
    this.directory = vscode.Uri.joinPath(globalStorageUri, DIRECTORY_NAME);
  }

  public async read(uriText: string): Promise<PersistedAiIssueRecord | undefined> {
    await this.maintenance;
    // Reopening a document must not race a queued close-time write in this
    // extension host. Otherwise an old on-disk snapshot could be restored and
    // then queued again after the newer write.
    if (
      this.pending.has(uriText) ||
      this.timers.has(uriText) ||
      this.writes.has(uriText)
    ) {
      await this.flush(uriText);
    }
    return this.readDisk(uriText);
  }

  private async readDisk(
    uriText: string,
  ): Promise<PersistedAiIssueRecord | undefined> {
    const target = this.targetFor(uriText);
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(target);
      if (stat.type !== vscode.FileType.File || stat.size > MAX_PERSISTED_AI_RECORD_BYTES) {
        await this.deleteIfUnchanged(target, stat);
        return undefined;
      }
      const bytes = await vscode.workspace.fs.readFile(target);
      if (bytes.byteLength > MAX_PERSISTED_AI_RECORD_BYTES) {
        await this.deleteIfUnchanged(target, stat);
        return undefined;
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        await this.deleteIfUnchanged(target, stat);
        return undefined;
      }
      const record = parsePersistedAiIssueRecord(
        text,
        uriText,
      );
      if (record === undefined) {
        await this.deleteIfUnchanged(target, stat);
      } else {
        this.rememberSavedAt(record);
      }
      return record;
    } catch {
      // Missing, unreadable and concurrently replaced files all fail closed.
      // None is a reason to log document-derived content.
      return undefined;
    }
  }

  public schedule(record: PersistedAiIssueRecord): void {
    if (this.disposed) {
      return;
    }
    const uriText = record.uri;
    const previousSavedAt = this.lastSavedAt.get(uriText) ?? -1;
    const scheduled = record.savedAt > previousSavedAt
      ? record
      : { ...record, savedAt: previousSavedAt + 1 };
    this.lastSavedAt.set(uriText, scheduled.savedAt);
    this.pending.set(uriText, { uriText, record: scheduled });
    const previous = this.timers.get(uriText);
    if (previous !== undefined) {
      clearTimeout(previous);
    }
    this.timers.set(uriText, setTimeout(() => {
      this.timers.delete(uriText);
      void this.flush(uriText);
    }, WRITE_DEBOUNCE_MS));
  }

  public flush(uriText: string): Promise<void> {
    const timer = this.timers.get(uriText);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(uriText);
    }
    const previous = this.writes.get(uriText) ?? Promise.resolve();
    const maintenance = this.maintenance;
    const next = previous.catch(() => undefined).then(() => maintenance).then(async () => {
      // A state mutation which arrives during I/O remains in the map. Drain it
      // in this same per-URI chain rather than recursively waiting on ourself.
      while (true) {
        const pending = this.pending.get(uriText);
        if (pending === undefined) {
          return;
        }
        this.pending.delete(uriText);
        await this.writeRecord(pending);
      }
    }).catch((error: unknown) => {
      this.output.debug(
        `AI 问题本地快照写入失败；将在后续状态变化时重试。${safeFsError(error)}`,
      );
    }).finally(() => {
      if (this.writes.get(uriText) === next) {
        this.writes.delete(uriText);
      }
    });
    this.writes.set(uriText, next);
    return next;
  }

  public async flushAll(): Promise<void> {
    await this.maintenance;
    await Promise.allSettled([
      ...new Set([...this.pending.keys(), ...this.writes.keys()])
    ].map((uriText) => this.flush(uriText)));
  }

  /**
   * Durably invalidate every cached document in this profile. Pending writes
   * which existed before the clear are discarded or awaited before deletion;
   * reads and writes started afterwards wait for the maintenance barrier.
   */
  public clearAllRecords(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.pending.clear();

    const previousMaintenance = this.maintenance;
    const activeWrites = [...this.writes.values()];
    const operation = previousMaintenance.catch(() => undefined).then(async () => {
      await Promise.allSettled(activeWrites);
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(this.directory);
      } catch {
        return;
      }
      await Promise.allSettled(entries
        .filter(([name, type]) =>
          type === vscode.FileType.File &&
          (name.endsWith(".json") || name.endsWith(".tmp"))
        )
        .map(([name]) => this.deleteQuietly(
          vscode.Uri.joinPath(this.directory, name),
        )));
    }).catch((error: unknown) => {
      this.output.debug(
        `AI 问题本地缓存全局清理失败；所有在途恢复仍已失效。${safeFsError(error)}`,
      );
    });
    this.maintenance = operation;
    return operation;
  }

  public shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) {
      return this.shutdownPromise;
    }
    this.disposed = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.shutdownPromise = this.flushAll();
    return this.shutdownPromise;
  }

  public dispose(): void {
    void this.shutdown();
  }

  private async writeRecord(pending: PendingRecord): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.directory);
    const target = this.targetFor(pending.uriText);

    // Fail closed when this pre-commit read observes an equal or newer state.
    // This is not a cross-host lock: it merely avoids promoting the stale
    // payload to `existing.savedAt + 1` after observing a clear/ignore
    // tombstone. readDisk records the high-water mark so a genuinely later
    // local mutation can still be scheduled by the in-process per-URI queue.
    const existing = await this.readDisk(pending.uriText);
    if (!shouldCommitPersistedAiIssueRecord(pending.record, existing)) {
      return;
    }

    let record = pending.record;
    let bytes = encodeRecord(record);
    if (bytes.byteLength > MAX_PERSISTED_AI_RECORD_BYTES) {
      // Do not leave an older, apparently valid issue list behind when a newer
      // state exceeds the persistence budget. An empty current-source record
      // is a durable fail-closed tombstone.
      record = { ...record, issues: [] };
      bytes = encodeRecord(record);
      this.output.warn(
        "AI 问题本地快照超过 2 MiB；已写入空记录，旧问题不会在重启后复活。",
      );
    }

    const temporary = vscode.Uri.joinPath(
      this.directory,
      `.${target.path.split("/").at(-1)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
    );
    try {
      await vscode.workspace.fs.writeFile(temporary, bytes);
      await vscode.workspace.fs.rename(temporary, target, { overwrite: true });
    } finally {
      await this.deleteQuietly(temporary);
    }
    await this.enforceDirectoryLimits(target);
  }

  private async enforceDirectoryLimits(current: vscode.Uri): Promise<void> {
    try {
      const directoryEntries = await vscode.workspace.fs.readDirectory(this.directory);
      const temporaryEntries = directoryEntries.filter(([name, type]) =>
        type === vscode.FileType.File && name.endsWith(".tmp")
      );
      const now = Date.now();
      await Promise.allSettled(temporaryEntries.map(async ([name]) => {
        const uri = vscode.Uri.joinPath(this.directory, name);
        const stat = await vscode.workspace.fs.stat(uri);
        if (now - stat.mtime >= STALE_TEMP_FILE_MS) {
          await this.deleteIfUnchanged(uri, stat);
        }
      }));

      const entries = directoryEntries.filter(([name, type]) =>
        type === vscode.FileType.File && name.endsWith(".json")
      );
      const stats = await Promise.all(entries.map(async ([name]) => {
        const uri = vscode.Uri.joinPath(this.directory, name);
        const stat = await vscode.workspace.fs.stat(uri);
        return {
          uri,
          size: stat.size,
          mtime: stat.mtime,
          current: uri.toString() === current.toString(),
        };
      }));
      // Reserve the first slot and its bytes for the just-written record even
      // on filesystems with coarse or missing mtimes, then retain newest first.
      stats.sort((left, right) =>
        Number(right.current) - Number(left.current) || right.mtime - left.mtime
      );
      let total = 0;
      for (let index = 0; index < stats.length; index += 1) {
        const entry = stats[index]!;
        if (index >= MAX_DOCUMENT_RECORDS || total + entry.size > MAX_TOTAL_BYTES) {
          await this.deleteQuietly(entry.uri);
        } else {
          total += entry.size;
        }
      }
    } catch {
      // Retention cleanup is best effort and cannot invalidate the atomic write.
    }
  }

  private targetFor(uriText: string): vscode.Uri {
    const name = createHash("sha256").update(uriText, "utf8").digest("hex");
    return vscode.Uri.joinPath(this.directory, `${name}.json`);
  }

  private async deleteQuietly(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uri, { useTrash: false });
    } catch {
      // Missing files and races are harmless.
    }
  }

  private async deleteIfUnchanged(
    uri: vscode.Uri,
    expected: vscode.FileStat,
  ): Promise<void> {
    try {
      const current = await vscode.workspace.fs.stat(uri);
      if (
        current.type === expected.type &&
        current.size === expected.size &&
        current.ctime === expected.ctime &&
        current.mtime === expected.mtime
      ) {
        await vscode.workspace.fs.delete(uri, { useTrash: false });
      }
    } catch {
      // Missing and concurrently replaced files are harmless.
    }
  }

  private rememberSavedAt(record: PersistedAiIssueRecord): void {
    this.lastSavedAt.set(
      record.uri,
      Math.max(this.lastSavedAt.get(record.uri) ?? -1, record.savedAt),
    );
  }
}

function encodeRecord(record: PersistedAiIssueRecord): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(record)}\n`);
}

function safeFsError(error: unknown): string {
  if (!(error instanceof Error) || error.message.length === 0) {
    return "";
  }
  // Filesystem messages contain paths, not paper text. Keep them bounded.
  return `（${error.message.slice(0, 256)}）`;
}
