import http from "http";

/**
 * Watches the two things the app cannot work without — the embedded Postgres
 * and the API — and puts them back up when they stop answering.
 *
 * The process supervisor in process-manager only reacts to a child that
 * *exits*. Two real failure modes never produce an exit:
 *
 *  - Postgres is a separate postmaster the app starts and then forgets. If the
 *    OS kills it, or its data directory goes read-only, `isRunning()` still
 *    says true and every API request fails forever.
 *  - The API process survives but stops serving — an event loop wedged on a
 *    dying embedding worker, a heap that is thrashing GC just short of the
 *    abort, a pool with every connection stuck against a database that went
 *    away. The port is open, nothing exits, and the window sits on failed
 *    requests.
 *
 * Both look identical to the user: the app is "running" and does nothing. The
 * monitor turns them into a restart instead of a support question.
 */

export const CHECK_INTERVAL_MS = 20_000;
/** Consecutive failed probes before acting. One blip is not an outage. */
export const API_FAILURES_BEFORE_RESTART = 3;
export const DB_FAILURES_BEFORE_RESTART = 2;
/** A probe that hangs is a failure; the API being pinned is the symptom. */
export const PROBE_TIMEOUT_MS = 8_000;
/**
 * Quiet period after a restart before probes count again. A cold API boot runs
 * migrations and can take minutes, and a restart that is already in flight must
 * not be restarted again on top of itself.
 */
export const GRACE_AFTER_RESTART_MS = 3 * 60_000;

export interface HealthMonitorDeps {
  /** Base URL of the shared API, re-read each tick (the port can change). */
  apiBaseUrl: () => string | null;
  /** False while starting up, quitting, or otherwise not to be touched. */
  isWatchable: () => boolean;
  probeApi?: (url: string) => Promise<boolean>;
  pingDatabase: () => Promise<boolean>;
  /** Restart Postgres *and* everything holding a pool against it. */
  recoverDatabase: () => Promise<void>;
  restartApi: () => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
}

/** Plain GET on the API root; any 2xx/3xx/4xx answer proves it is serving. */
export function probeHttp(
  url: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export class HealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private apiFailures = 0;
  private dbFailures = 0;
  private quietUntil = 0;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly probeApi: (url: string) => Promise<boolean>;

  constructor(private readonly deps: HealthMonitorDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? ((message) => process.stderr.write(`${message}\n`));
    this.probeApi = deps.probeApi ?? ((url) => probeHttp(url));
  }

  start(intervalMs = CHECK_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Suppresses probes for the grace period — call around deliberate restarts. */
  pause(forMs = GRACE_AFTER_RESTART_MS): void {
    this.quietUntil = this.now() + forMs;
    this.apiFailures = 0;
    this.dbFailures = 0;
  }

  /** One check. Exposed so the policy can be driven directly in tests. */
  async tick(): Promise<void> {
    // Ticks never overlap: a recovery takes minutes and its own probes would
    // otherwise pile a second restart on top of the first.
    if (this.ticking) return;
    if (!this.deps.isWatchable()) {
      this.apiFailures = 0;
      this.dbFailures = 0;
      return;
    }
    if (this.now() < this.quietUntil) return;

    this.ticking = true;
    try {
      // Database first: an API that cannot reach its database will fail its
      // own probe too, and restarting it would fix nothing.
      const dbAlive = await this.deps.pingDatabase().catch(() => false);
      if (!dbAlive) {
        this.dbFailures += 1;
        this.log(
          `[health] database did not answer (${this.dbFailures}/${DB_FAILURES_BEFORE_RESTART})`,
        );
        if (this.dbFailures >= DB_FAILURES_BEFORE_RESTART) {
          this.dbFailures = 0;
          this.apiFailures = 0;
          this.pause();
          this.log("[health] restarting the database and the service");
          try {
            await this.deps.recoverDatabase();
            this.log("[health] database recovered");
          } catch (err) {
            // Left for the next tick: the grace period has already been armed,
            // so this retries on a slow loop rather than hammering.
            this.log(`[health] database recovery failed: ${message(err)}`);
          }
        }
        return;
      }
      this.dbFailures = 0;

      const baseUrl = this.deps.apiBaseUrl();
      if (!baseUrl) return;
      const alive = await this.probeApi(`${baseUrl}/`).catch(() => false);
      if (alive) {
        this.apiFailures = 0;
        return;
      }

      this.apiFailures += 1;
      this.log(
        `[health] service did not answer (${this.apiFailures}/${API_FAILURES_BEFORE_RESTART})`,
      );
      if (this.apiFailures < API_FAILURES_BEFORE_RESTART) return;

      this.apiFailures = 0;
      this.pause();
      this.log("[health] service is up but not serving; restarting it");
      try {
        await this.deps.restartApi();
        this.log("[health] service restarted");
      } catch (err) {
        this.log(`[health] service restart failed: ${message(err)}`);
      }
    } finally {
      this.ticking = false;
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
