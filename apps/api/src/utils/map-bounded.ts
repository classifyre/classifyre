/**
 * Map over items with at most `concurrency` handlers in flight. Prevents
 * unbounded Promise.all fan-outs from monopolising the shared Prisma
 * connection pool.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  handler: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await handler(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
