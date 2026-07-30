import { createHash } from 'node:crypto';

/**
 * Gives every imported row a fresh identity, so an import is always purely
 * additive and can never collide with — or overwrite — what is already in the
 * target namespace.
 *
 * The remap is a deterministic function, `uuidv5(oldId, seed)`, rather than a
 * lookup table built as rows arrive. That matters for three reasons:
 *
 *  - **Memory.** A table would hold one entry per row; importing a namespace
 *    with a million assets would cost hundreds of megabytes of live heap for
 *    the duration of the import. This API has already been taken down once by
 *    heap exhaustion, and a function costs nothing.
 *  - **Order independence.** A foreign key can be rewritten without having seen
 *    the row it points at, so nothing depends on the archive's ordering beyond
 *    what the database's own constraints already require.
 *  - **Retries.** The seed is the import job's own id, so re-running a failed
 *    import produces exactly the same identities: rows that already landed
 *    collide on their primary key and are skipped, instead of being duplicated.
 *
 * Values that are not UUIDs pass through untouched. That is deliberate and load
 * bearing: content hashes (`Asset.hash`, `ExtractionPayload.contentHash`,
 * `RunnerAsset.assetHash`), enum keys and the fixed integer ids of singleton
 * configuration rows are *natural* keys. They identify a thing by what it is
 * rather than by an arbitrary label, they stay valid across instances, and
 * rewriting them would break the very correspondence they exist to express.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IdRemapper = (value: unknown) => unknown;

/**
 * Build the remapper for one import. `seed` must be a UUID unique to that
 * import — the job's own id is exactly that.
 */
export function createIdRemapper(seed: string): IdRemapper {
  if (!UUID_RE.test(seed)) {
    throw new Error(`Import id seed must be a UUID, got '${seed}'`);
  }

  // Same input, same output, for the life of the import.
  const cache = new Map<string, string>();

  return (value: unknown): unknown => {
    if (typeof value !== 'string' || !UUID_RE.test(value)) return value;

    const hit = cache.get(value);
    if (hit) return hit;

    const mapped = uuidv5(value, seed);
    // Bounded so a huge import cannot grow this without limit; it is only a
    // speed-up, and the function is pure, so eviction costs nothing but a
    // recomputation.
    if (cache.size >= 10_000) cache.clear();
    cache.set(value, mapped);
    return mapped;
  };
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * RFC 4122 name-based UUID, version 5 (SHA-1 of the namespace's bytes followed
 * by the name's).
 *
 * Written out rather than taken from the `uuid` package: that package is
 * ESM-only from v14, which the API's CommonJS Jest setup cannot load, and the
 * algorithm is a dozen lines of `node:crypto`. Same output as `uuid`'s `v5`.
 */
export function uuidv5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(namespaceBytes)
    .update(Buffer.from(name, 'utf8'))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  // Version 5 in the high nibble of byte 6, RFC 4122 variant in byte 8.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
