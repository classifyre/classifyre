import { stableJsonHash } from './stable-json';

/**
 * The optimistic-concurrency token for a source's configuration.
 *
 * Deliberately a hash of the configuration itself rather than the row's
 * `updatedAt`. `Source.updatedAt` is `@updatedAt`, so it moves on *any* write
 * to the row — and the adaptive scheduler writes `scheduleNextAt` on every scan
 * claim and `autoPhase`/`autoReason` after every run. On a source scanning
 * every two minutes that meant the token expired roughly once a minute for
 * reasons having nothing to do with configuration, while the agent holding it
 * was still deciding what to change. Measured on a live instance: four of the
 * seven tool failures in one afternoon were `config.tune_source` refusing a
 * valid patch because the scheduler had touched the row 30 seconds earlier.
 *
 * Hashing the config means only a real configuration change invalidates a
 * token, which is the property the guard was always meant to have: it exists to
 * stop an agent overwriting an operator's edit, not to stop it writing at all.
 *
 * Computed over the DECRYPTED config so a credential re-encryption (which
 * produces different ciphertext for identical plaintext) does not read as a
 * change either.
 */
export function configVersion(config: unknown): string {
  return stableJsonHash(config ?? {});
}
