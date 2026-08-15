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
