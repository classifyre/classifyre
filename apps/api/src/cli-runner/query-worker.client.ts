import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';

/** The status line a query Job prints; settleFromOutput reads it. */
export const QUERY_RESULT_MARKER = '__CLASSIFYRE_QUERY_RESULT__';

/** Past the query's own timeout, as long as the worker's own backstop and more. */
const RESPONSE_MARGIN_SECONDS = 90;
/** Connecting to a worker in the cluster takes milliseconds; past this it is gone. */
const CONNECT_TIMEOUT_MS = 3_000;
/**
 * A busy pod answers at once; the Service picks a pod per connection, so a
 * second or third try usually reaches another replica before a Job is started.
 */
const BUSY_ATTEMPTS = 3;
/** How often a running query checks whether another replica cancelled it. */
const CANCEL_POLL_MS = 3_000;
const MIN_TOKEN_LENGTH = 16;

export type QueryWorkerOverflow = 'job' | 'refuse';

export interface QueryWorkerConfig {
  url: URL;
  /** The token, or (the chart) the file that holds it, read again when it changes. */
  token: string;
  tokenFile: string | null;
  /** What happens to a query no worker takes: a Job runs it, or it fails. */
  overflow: QueryWorkerOverflow;
}

/** One query for the worker: what a query Job would be given. */
export interface QueryWorkerRun {
  runId: string;
  request: Record<string, unknown>;
  timeoutSeconds: number;
  /** Polled while it runs: true once the run was cancelled, by any replica. */
  isCancelled?: () => Promise<boolean>;
}

/**
 * How a query the worker took ended (apps/cli/src/query/worker.py,
 * `OutcomeKind`): `done` carries the status payload a Job prints; the others
 * are what only the worker saw.
 */
export type WorkerOutcome =
  | 'done'
  | 'timeout'
  | 'cancelled'
  | 'crashed'
  | 'memory'
  | 'stopped';

/** What the worker answers when it ran (or tried to run) the query. */
interface WorkerAnswer {
  outcome: WorkerOutcome;
  exitCode: number | null;
  payload: Record<string, unknown> | null;
  worker?: string;
  ms?: number;
}

/**
 * The worker did not take the query: nothing ran. `job_only`: the query reads
 * a source that only a Job may run (it loads native drivers).
 */
export interface NotTakenResult {
  notTaken: 'busy' | 'unavailable' | 'job_only';
}

export interface QueryWorkerResult {
  output: string;
  exitCode: number;
  worker: string | null;
}

/** Read from the environment the chart sets; null when there is no worker. */
export function queryWorkerConfig(
  env: NodeJS.ProcessEnv,
): QueryWorkerConfig | null {
  const raw = env.QUERY_WORKER_URL?.trim();
  if (!raw) return null;
  const tokenFile = env.QUERY_WORKER_TOKEN_FILE?.trim() || null;
  const token = tokenFile
    ? readToken(tokenFile)
    : (env.QUERY_WORKER_TOKEN?.trim() ?? '');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`QUERY_WORKER_URL is not a URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('QUERY_WORKER_URL must be http:// or https://');
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      'QUERY_WORKER_TOKEN_FILE (or QUERY_WORKER_TOKEN) must give a token of at least 16 characters with QUERY_WORKER_URL',
    );
  }
  const overflow = env.QUERY_WORKER_OVERFLOW?.trim() || 'job';
  if (overflow !== 'job' && overflow !== 'refuse') {
    throw new Error('QUERY_WORKER_OVERFLOW must be job or refuse');
  }
  return { url: new URL('/v1/queries', url), token, tokenFile, overflow };
}

function readToken(path: string): string {
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch (error) {
    throw new Error(
      `QUERY_WORKER_TOKEN_FILE ${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The error payload a Job would have printed, for what only the worker saw. */
export function queryErrorLine(code: string, message: string): string {
  return `${QUERY_RESULT_MARKER} ${JSON.stringify({
    status: 'error',
    error: { code, message },
  })}`;
}

/** A failure before the worker took the query: run it as a Job instead. */
class NotTaken extends Error {}

/**
 * The warm query worker (apps/cli/src/query/worker.py): the CLI image as a
 * Deployment that forks a process per query from a warmed-up fork server, so
 * a query does not wait for a pod to start (docs/prd/DQ-data-query.md §5.3).
 *
 * The request is the one a query Job gets, and the worker answers with the
 * status payload a Job prints, so {@link run} returns what a Job run returns.
 * When the worker cannot take the query (every slot busy, draining,
 * unreachable) {@link run} returns null before anything ran, and the caller
 * runs it as a Job. Cancelling drops the HTTP request; the worker stops the
 * query when its client goes away.
 */
@Injectable()
export class QueryWorkerClient {
  private readonly logger = new Logger(QueryWorkerClient.name);
  private readonly config: QueryWorkerConfig | null;
  private readonly inFlight = new Map<string, AbortController>();
  private readonly agent: http.Agent;
  private tokenStamp: number | null = null;

  constructor() {
    this.config = queryWorkerConfig(process.env);
    // One connection per running query; no keep-alive, since a dropped
    // connection is how a cancel reaches the worker.
    const options = { keepAlive: false, maxSockets: Infinity };
    this.agent =
      this.config?.url.protocol === 'https:'
        ? new https.Agent(options)
        : new http.Agent(options);
    if (this.config) {
      this.logger.log(
        `Queries run on the query worker at ${this.config.url.origin}`,
      );
    }
  }

  get enabled(): boolean {
    return this.config !== null;
  }

  /**
   * Run one query on a worker. Not taken (`notTaken`): nothing ran; run it as
   * a Job. With `overflow: refuse` a busy or missing worker is a "busy" error
   * instead; a `job_only` query always goes to a Job. Null without a worker.
   */
  async run(
    params: QueryWorkerRun,
  ): Promise<QueryWorkerResult | NotTakenResult | null> {
    if (!this.config) return null;
    const result = await this.attempt(this.config, params);
    if (!('notTaken' in result)) return result;
    if (this.config.overflow === 'job' || result.notTaken === 'job_only') {
      return result;
    }
    const message =
      result.notTaken === 'busy'
        ? 'Every query slot is taken. Run the query again in a moment.'
        : 'No query worker is available. Run the query again in a moment.';
    return {
      output: queryErrorLine('busy', message),
      exitCode: 1,
      worker: null,
    };
  }

  /** The token to sign with; from the file when there is one, as it is now. */
  private token(config: QueryWorkerConfig): string {
    if (!config.tokenFile) return config.token;
    try {
      const stat = fs.statSync(config.tokenFile);
      if (stat.mtimeMs !== this.tokenStamp) {
        const value = fs.readFileSync(config.tokenFile, 'utf8').trim();
        if (value.length >= MIN_TOKEN_LENGTH) {
          config.token = value;
          this.tokenStamp = stat.mtimeMs;
        }
      }
    } catch {
      // A Secret update swaps the file; keep the last token meanwhile.
    }
    return config.token;
  }

  private async attempt(
    config: QueryWorkerConfig,
    params: QueryWorkerRun,
  ): Promise<QueryWorkerResult | NotTakenResult> {
    const controller = new AbortController();
    this.inFlight.set(params.runId, controller);
    const body = JSON.stringify(params.request);
    const poll = params.isCancelled
      ? setInterval(() => {
          params.isCancelled!()
            .then((cancelled) => {
              if (cancelled) controller.abort();
            })
            .catch(() => undefined);
        }, CANCEL_POLL_MS)
      : null;
    try {
      let answer: { status: number; body: string } | null = null;
      for (let attempt = 1; attempt <= BUSY_ATTEMPTS; attempt++) {
        answer = await this.post(
          config,
          body,
          (Math.max(1, params.timeoutSeconds) + RESPONSE_MARGIN_SECONDS) * 1000,
          controller.signal,
        );
        if (answer.status === 401 && config.tokenFile && attempt === 1) {
          // The worker may have read a new Secret first: read ours again.
          this.tokenStamp = null;
          continue;
        }
        if (answer.status !== 503 || this.parse(answer.body)?.code !== 'busy') {
          break;
        }
      }
      const { status } = answer!;
      if (status === 503) {
        const code = this.parse(answer!.body)?.code ?? 'busy';
        this.logger.log(
          `Query ${params.runId}: query worker ${code}, not taken`,
        );
        return {
          notTaken:
            code === 'busy'
              ? 'busy'
              : code === 'job_only'
                ? 'job_only'
                : 'unavailable',
        };
      }
      if (status === 401) {
        this.logger.error(
          'The query worker refused the API token (the API and the worker read different query-worker tokens); queries run as Jobs until they agree',
        );
        return { notTaken: 'unavailable' };
      }
      if (status !== 200) {
        this.logger.warn(
          `Query ${params.runId}: query worker answered HTTP ${status}, not taken`,
        );
        return { notTaken: 'unavailable' };
      }
      const parsed = this.parse(answer!.body) as WorkerAnswer | null;
      if (!parsed?.outcome) {
        return {
          output: queryErrorLine(
            'job_failed',
            'The query worker sent no result.',
          ),
          exitCode: 1,
          worker: null,
        };
      }
      return this.toResult(parsed, params.timeoutSeconds);
    } catch (error) {
      if (error instanceof NotTaken) {
        this.logger.warn(
          `Query ${params.runId}: query worker unreachable (${error.message}), not taken`,
        );
        return { notTaken: 'unavailable' };
      }
      if (controller.signal.aborted) {
        // Cancelled: the run is being marked cancelled by whoever aborted.
        return { output: '', exitCode: 1, worker: null };
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        output: queryErrorLine(
          'job_failed',
          `The query worker stopped answering while the query ran (${message}).`,
        ),
        exitCode: 1,
        worker: null,
      };
    } finally {
      if (poll) clearInterval(poll);
      this.inFlight.delete(params.runId);
    }
  }

  /** Stop a query running on a worker; false when none runs here. */
  cancel(runId: string): boolean {
    const controller = this.inFlight.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  private toResult(
    answer: WorkerAnswer,
    timeoutSeconds: number,
  ): QueryWorkerResult {
    const worker = answer.worker ?? null;
    switch (answer.outcome) {
      case 'done':
        return {
          output: `${QUERY_RESULT_MARKER} ${JSON.stringify(answer.payload ?? {})}`,
          exitCode: answer.exitCode ?? 1,
          worker,
        };
      case 'timeout':
        return {
          output: queryErrorLine(
            'timeout',
            `The query took longer than ${timeoutSeconds} s and was stopped.`,
          ),
          exitCode: 1,
          worker,
        };
      case 'cancelled':
        return { output: '', exitCode: 1, worker };
      case 'memory':
        return {
          output: queryErrorLine(
            'out_of_memory',
            'The query needed more memory than one query may use and was stopped. Select fewer rows or columns, or aggregate first.',
          ),
          exitCode: 1,
          worker,
        };
      case 'stopped':
        return {
          output: queryErrorLine(
            'job_failed',
            'The query worker shut down while the query ran. Run it again.',
          ),
          exitCode: 1,
          worker,
        };
      default: {
        const signal =
          answer.exitCode !== null && answer.exitCode < 0
            ? -answer.exitCode
            : null;
        const message =
          signal === 9
            ? 'The query process was killed (signal 9), most often because it ran out of memory.'
            : `The query process ended unexpectedly (exit ${answer.exitCode ?? 'unknown'}).`;
        return {
          output: queryErrorLine('job_failed', message),
          exitCode: 1,
          worker,
        };
      }
    }
  }

  private parse(body: string): Record<string, any> | null {
    try {
      const value: unknown = JSON.parse(body);
      return value && typeof value === 'object'
        ? (value as Record<string, any>)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * POST with node:http rather than fetch: fetch's built-in headers timeout
   * (five minutes in undici) would cut a long query, and node:http tells a
   * failed connect (nothing ran, NotTaken) from a connection lost mid-query.
   */
  private post(
    config: QueryWorkerConfig,
    body: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<{ status: number; body: string }> {
    const transport = config.url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      let connected = false;
      const request = transport.request(
        config.url,
        {
          method: 'POST',
          agent: this.agent,
          signal,
          headers: {
            Authorization: `Bearer ${this.token(config)}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
          response.on('error', reject);
        },
      );
      const connectTimer = setTimeout(() => {
        if (!connected) {
          request.destroy(new NotTaken('connect timeout'));
        }
      }, CONNECT_TIMEOUT_MS);
      request.setTimeout(timeoutMs, () =>
        request.destroy(new Error('no answer in time')),
      );
      request.on('socket', (socket) => {
        const onConnect = () => {
          connected = true;
          clearTimeout(connectTimer);
        };
        if ((socket as { connecting?: boolean }).connecting) {
          socket.once(
            config.url.protocol === 'https:' ? 'secureConnect' : 'connect',
            onConnect,
          );
        } else {
          onConnect();
        }
      });
      request.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(connectTimer);
        if (error instanceof NotTaken) return reject(error);
        if (!connected && !signal.aborted) {
          return reject(new NotTaken(error.code ?? error.message));
        }
        reject(error);
      });
      request.on('close', () => clearTimeout(connectTimer));
      request.end(body);
    });
  }
}
