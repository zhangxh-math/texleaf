/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

/** A failure-tolerant FIFO queue that assigns a monotonic epoch to each task. */
export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();
  private nextEpoch = 0;

  public enqueue<T>(task: (epoch: number) => Promise<T>): Promise<T> {
    const epoch = ++this.nextEpoch;
    const run = this.tail.then(() => task(epoch));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
