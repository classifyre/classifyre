import { Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/** Header the CLI (and any other in-cluster caller) presents to prove it is
 * not public traffic. Stripped from inbound requests by the web proxy, so the
 * only way to set it is to talk to the API service directly. */
export const INTERNAL_API_KEY_HEADER = 'x-classifyre-internal-key';

/**
 * Shared secret between the API and the processes it launches (CLI scan jobs,
 * detector-evaluation jobs). It exists because the API has no user
 * authentication: the CLI's callback endpoints (bulk asset ingest, runner
 * status, graph edges, …) would otherwise be writable by anyone who can reach
 * the web proxy.
 *
 * The key is supplied via `CLASSIFYRE_INTERNAL_KEY`: Helm generates and
 * persists one per release, the desktop app generates one per install, and the
 * API forwards it into every CLI job's environment.
 *
 * When the variable is unset the guard fails OPEN and logs a warning once.
 * That keeps `bun dev`, tests, and pre-existing deployments working exactly as
 * before; every packaged deployment path sets it.
 */
// Nest instantiates this service once per module that provides it, and once
// per module under test, so warn at most once per process.
let warnedMissingKey = false;

@Injectable()
export class InternalApiKeyService {
  private readonly logger = new Logger(InternalApiKeyService.name);
  private readonly key: string;

  constructor() {
    this.key = (process.env.CLASSIFYRE_INTERNAL_KEY ?? '').trim();
    if (!this.key && !warnedMissingKey && process.env.NODE_ENV !== 'test') {
      warnedMissingKey = true;
      this.logger.warn(
        'CLASSIFYRE_INTERNAL_KEY is not set — CLI callback endpoints are NOT restricted to internal callers. Set it in any deployment reachable from a network you do not control.',
      );
    }
  }

  /** False when no key is configured, in which case @InternalOnly() is inert. */
  get isEnforced(): boolean {
    return this.key.length > 0;
  }

  /** The configured key, or null. Used to propagate it into CLI job envs. */
  get value(): string | null {
    return this.key || null;
  }

  /** True when the request carries the configured key. Always false when no
   * key is configured, so callers can treat "internal" as a positive signal. */
  isInternalRequest(headers: Record<string, unknown> | undefined): boolean {
    if (!this.isEnforced || !headers) {
      return false;
    }

    const raw = headers[INTERNAL_API_KEY_HEADER];
    const presented = Array.isArray(raw) ? raw[0] : raw;
    if (typeof presented !== 'string' || presented.length === 0) {
      return false;
    }

    const a = Buffer.from(presented);
    const b = Buffer.from(this.key);
    // timingSafeEqual throws on length mismatch, which is itself a leak-free
    // signal only because the key length is not secret.
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
