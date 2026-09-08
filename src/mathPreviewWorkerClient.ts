/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { Worker } from "node:worker_threads";
import type * as vscode from "vscode";
import type {
  MathPreviewWorkerRequest,
  MathPreviewWorkerResponse,
  MathPreviewWorkerSuccess,
} from "./mathPreviewProtocol";

const WORKER_TIMEOUT_MS = 5_000;
const WORKER_QUEUE_SIZE = 32;

interface PendingRender {
  readonly resolve: (value: MathPreviewWorkerSuccess) => void;
  readonly reject: (reason: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface QueuedRender {
  readonly id: number;
  readonly request: MathPreviewWorkerRequest;
  readonly resolve: (value: MathPreviewWorkerSuccess) => void;
  readonly reject: (reason: Error) => void;
}

/** Bounded, restartable client for TeXLeaf's isolated MathJax worker. */
export class MathPreviewWorkerClient implements vscode.Disposable {
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRender>();
  private readonly queued: QueuedRender[] = [];
  private activeId: number | undefined;
  private disposed = false;

  public constructor(
    private readonly workerPath: string,
    private readonly engineCacheLimit = 12,
  ) {}

  public render(
    request: Omit<MathPreviewWorkerRequest, "type" | "id">,
  ): Promise<MathPreviewWorkerSuccess> {
    return this.enqueue(request, false);
  }

  /**
   * Queue an interactive frame while discarding older frames that have not
   * entered MathJax yet. The active worker remains warm between requests.
   */
  public renderLatest(
    request: Omit<MathPreviewWorkerRequest, "type" | "id">,
  ): Promise<MathPreviewWorkerSuccess> {
    return this.enqueue(request, true);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.failAll(new Error("Math Preview renderer stopped."));
    void this.worker?.terminate();
    this.worker = undefined;
  }

  private enqueue(
    request: Omit<MathPreviewWorkerRequest, "type" | "id">,
    replaceQueued: boolean,
  ): Promise<MathPreviewWorkerSuccess> {
    if (this.disposed) {
      return Promise.reject(new Error("Math Preview renderer is disposed."));
    }
    const id = this.nextId++;
    return new Promise<MathPreviewWorkerSuccess>((resolve, reject) => {
      if (replaceQueued) {
        for (const obsolete of this.queued.splice(0)) {
          obsolete.reject(
            new Error("Math Preview dropped an obsolete interactive render."),
          );
        }
      }
      this.queued.push({
        id,
        request: { type: "render", id, ...request },
        resolve,
        reject,
      });
      while (this.queued.length > WORKER_QUEUE_SIZE) {
        this.queued.shift()?.reject(
          new Error("Math Preview dropped an obsolete queued render."),
        );
      }
      this.pump();
    });
  }

  /** Keep at most one request inside MathJax; queued work stays bounded here. */
  private pump(): void {
    if (this.disposed || this.activeId !== undefined) {
      return;
    }
    const queued = this.queued.shift();
    if (queued === undefined) {
      return;
    }

    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (error: unknown) {
      queued.reject(error instanceof Error ? error : new Error(String(error)));
      this.pump();
      return;
    }

    const timeout = setTimeout(() => {
      const pending = this.pending.get(queued.id);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(queued.id);
      this.activeId = undefined;
      pending.reject(new Error("MathJax render timed out."));
      this.restartWorker();
    }, WORKER_TIMEOUT_MS);
    this.activeId = queued.id;
    this.pending.set(queued.id, {
      resolve: queued.resolve,
      reject: queued.reject,
      timeout,
    });
    worker.postMessage(queued.request);
  }

  private ensureWorker(): Worker {
    if (this.worker !== undefined) {
      return this.worker;
    }
    const worker = new Worker(this.workerPath, {
      name: "TeXLeaf Math Preview",
      workerData: {
        engineCacheLimit: Math.max(1, Math.min(16, Math.trunc(this.engineCacheLimit))),
      },
    });
    worker.unref();
    worker.on("message", (value: unknown) => this.handleMessage(value));
    worker.on("error", (error) => {
      if (worker === this.worker) {
        this.worker = undefined;
        this.failAll(error);
      }
    });
    worker.on("exit", (code) => {
      if (worker === this.worker) {
        this.worker = undefined;
        if (code !== 0 && !this.disposed) {
          this.failAll(new Error(`Math Preview worker exited with code ${code}.`));
        }
      }
    });
    this.worker = worker;
    return worker;
  }

  private handleMessage(value: unknown): void {
    if (!isWorkerResponse(value)) {
      return;
    }
    const pending = this.pending.get(value.id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(value.id);
    if (this.activeId === value.id) {
      this.activeId = undefined;
    }
    clearTimeout(pending.timeout);
    if (value.type === "result") {
      pending.resolve(value);
    } else {
      pending.reject(new Error(value.message));
    }
    this.pump();
  }

  private restartWorker(): void {
    const worker = this.worker;
    this.worker = undefined;
    void worker?.terminate();
    this.failAll(new Error("Math Preview worker restarted after a timeout."));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.activeId = undefined;
    for (const queued of this.queued.splice(0)) {
      queued.reject(error);
    }
  }
}

function isWorkerResponse(value: unknown): value is MathPreviewWorkerResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<MathPreviewWorkerResponse>;
  return Number.isSafeInteger(candidate.id) &&
    (candidate.type === "result" || candidate.type === "error");
}
