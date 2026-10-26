/**
 * A simple async counter that should be safely incremented
 * across multiple concurrent callers.
 *
 * Bug: the counter reads and writes are not atomic — concurrent
 * increments can race and lose updates.
 */
export class AsyncCounter {
  private count = 0;

  async increment(): Promise<void> {
    const current = this.count;          // read
    await new Promise(r => setTimeout(r, 0)); // simulate async work (yields event loop)
    this.count = current + 1;            // write — BUG: another increment may have run between read and write
  }

  getCount(): number {
    return this.count;
  }
}

/**
 * Runs `n` concurrent increments and returns the final count.
 * Should always return n, but due to the race bug, often returns 1.
 */
export async function concurrentIncrement(n: number): Promise<number> {
  const counter = new AsyncCounter();
  await Promise.all(Array.from({ length: n }, () => counter.increment()));
  return counter.getCount();
}
