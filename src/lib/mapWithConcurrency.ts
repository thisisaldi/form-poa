/**
 * Like `Promise.all(items.map(fn))`, but runs at most `limit` calls at a time.
 * Use for fan-out to external APIs (Canvasser, etc.) so a POA with 100+ outlets
 * doesn't fire hundreds of simultaneous requests.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker)
  );
  return results;
}
