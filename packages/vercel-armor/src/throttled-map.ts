/**
 * Bounded-concurrency map. Runs at most `concurrency` promises at once,
 * preserving input order in the output array.
 *
 * Used when a serverless handler needs to fan out N external calls (e.g. 41
 * warehouse lookups against a legacy ERP): unbounded Promise.all can saturate
 * the upstream and blow your function budget.
 */
export async function throttledMap<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
  }
  if (items.length === 0) return [];

  const out: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  });

  await Promise.all(workers);
  return out;
}
