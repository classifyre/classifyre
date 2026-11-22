import { createHmac } from 'node:crypto';
import { SCRAM_ITERATIONS, type ScramVerifier } from '../sql-connections/scram';

/**
 * Sign-in decisions of the SQL gateway (docs/prd/DQ-data-query.md §5.7),
 * kept apart so they can be tested: nothing here may let a client learn
 * whether a user name exists, or what state its connection is in, without
 * the right password.
 */

const hmac = (key: Buffer, text: string) =>
  createHmac('sha256', key).update(text, 'utf8').digest();

/**
 * The verifier an unknown (or not yet revealed) user name is challenged
 * with. Derived from the server secret, so the same name always gets the
 * same salt — as a real name does — and computed with HMACs only, so it
 * costs what looking up a real verifier costs. No password can match it.
 */
export function decoyVerifier(
  secret: Buffer,
  namespaceId: string,
  username: string,
): ScramVerifier {
  const seed = `${namespaceId}\u0000${username.toLowerCase()}`;
  return {
    salt: hmac(secret, `scram-decoy-salt\u0000${seed}`)
      .subarray(0, 16)
      .toString('base64'),
    iterations: SCRAM_ITERATIONS,
    storedKey: hmac(secret, `scram-decoy-stored\u0000${seed}`).toString(
      'base64',
    ),
    serverKey: hmac(secret, `scram-decoy-server\u0000${seed}`).toString(
      'base64',
    ),
  };
}

export interface SignInCandidate {
  status: 'active' | 'pending' | 'expired' | 'revoked';
  verifier: ScramVerifier | null;
}

/** The verifier to challenge with: the connection's, or the name's decoy. */
export function challengeVerifier(
  candidate: SignInCandidate | null,
  decoy: () => ScramVerifier,
): ScramVerifier {
  return candidate?.verifier ?? decoy();
}

/**
 * What a refused client is told. Only a correct password earns more than
 * "password authentication failed": a wrong one says nothing about whether
 * the name exists or its connection was revoked or has expired.
 */
export function refusalMessage(
  username: string,
  proofOk: boolean,
  status: SignInCandidate['status'] | null,
): string {
  if (proofOk && status === 'revoked')
    return 'This SQL connection was revoked.';
  if (proofOk && status === 'expired')
    return 'This SQL connection has expired.';
  return `password authentication failed for user "${username}"`;
}

/** Why a refused sign-in was refused, for the audit trail (never shown to the client). */
export function refusalReason(
  proofOk: boolean,
  status: SignInCandidate['status'] | null,
  failure: string,
): string {
  if (!status) return 'unknown user';
  if (status === 'pending') {
    return 'pending: its person has not revealed the password yet';
  }
  if (!proofOk) return failure;
  return status;
}

const PRUNE_AT = 10_000;

/** Sign-ins that may wait on one key (an address, a name) at once. */
export const MAX_WAITERS_PER_KEY = 8;
/** Sign-ins that may wait at once, all keys together. */
export const MAX_WAITERS = 256;

/**
 * Failed sign-ins per key (a user name, a client address): ten within 15
 * minutes lock the key for the rest of the window. In memory, per gateway
 * pod. A locked-out attempt is worth one audit row per key per window, not
 * one per attempt (which would let a client fill the trail).
 */
export class SignInLockout {
  private readonly failures = new Map<string, number[]>();
  private readonly reported = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private readonly waiting = new Set<() => void>();
  /** Sign-ins waiting on each key. */
  private readonly waiters = new Map<string, number>();

  constructor(
    private readonly windowMs = 15 * 60_000,
    private readonly limit = 10,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const at = this.now();
    const recent = (this.failures.get(key) ?? []).filter(
      (t) => at - t < this.windowMs,
    );
    if (recent.length) this.failures.set(key, recent);
    else this.failures.delete(key);
    return recent;
  }

  isLocked(key: string): boolean {
    return this.recent(key).length >= this.limit;
  }

  fail(key: string): void {
    this.failures.set(key, [...this.recent(key), this.now()]);
    if (this.failures.size + this.reported.size > PRUNE_AT) this.prune();
  }

  /**
   * Claims the keys for one sign-in, waiting (up to `waitMs`) while another
   * sign-in holds one of them; false when it waited that long. Sign-ins with
   * a key in common run one after another, so N started together cannot all
   * pass `isLocked` and get N guesses before the first failure is counted.
   * They wait rather than fail: a BI tool's connection pool opens several
   * connections at once, from one address (Metabase, BIC M0).
   */
  async begin(
    keys: readonly string[],
    waitMs = 10_000,
    maxWaiters = MAX_WAITERS_PER_KEY,
    /** Told when the sign-in starts and stops waiting (`SignInTicket.waiting`). */
    onWait?: (waiting: boolean) => void,
  ): Promise<boolean> {
    const until = this.now() + waitMs;
    while (keys.some((key) => this.inFlight.has(key))) {
      const left = until - this.now();
      if (left <= 0) return false;
      // A pool opens a handful at once; more waiting on one key is one
      // address holding sign-in slots everyone shares (review c5).
      const blocked = keys.filter((key) => this.inFlight.has(key));
      if (
        blocked.some((key) => (this.waiters.get(key) ?? 0) >= maxWaiters) ||
        this.waiting.size >= MAX_WAITERS
      ) {
        return false;
      }
      blocked.forEach((key) =>
        this.waiters.set(key, (this.waiters.get(key) ?? 0) + 1),
      );
      onWait?.(true);
      try {
        await new Promise<void>((resolve) => {
          const done = (): void => {
            clearTimeout(timer);
            this.waiting.delete(done);
            resolve();
          };
          const timer = setTimeout(done, left);
          this.waiting.add(done);
        });
      } finally {
        onWait?.(false);
        for (const key of blocked) {
          const count = (this.waiters.get(key) ?? 1) - 1;
          if (count > 0) this.waiters.set(key, count);
          else this.waiters.delete(key);
        }
      }
    }
    keys.forEach((key) => this.inFlight.add(key));
    return true;
  }

  end(keys: readonly string[]): void {
    keys.forEach((key) => this.inFlight.delete(key));
    // Every waiter checks its own keys again; the ones still blocked wait on.
    const waiting = [...this.waiting];
    this.waiting.clear();
    waiting.forEach((wake) => wake());
  }

  /** Drops keys whose window has passed (names tried once and never again). */
  private prune(): void {
    for (const key of [...this.failures.keys()]) this.recent(key);
    const at = this.now();
    for (const [key, last] of [...this.reported]) {
      if (at - last >= this.windowMs) this.reported.delete(key);
    }
  }

  /** True the first time a locked key is refused in its window: audit that one. */
  shouldReport(key: string): boolean {
    const last = this.reported.get(key);
    if (last !== undefined && this.now() - last < this.windowMs) return false;
    this.reported.set(key, this.now());
    return true;
  }
}
