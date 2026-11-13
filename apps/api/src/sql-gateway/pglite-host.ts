import { extname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

/** PGlite's own setup for every workspace: the error helper data queries fail through. */
const WORKSPACE_SETUP = `
CREATE SCHEMA classifyre;
CREATE FUNCTION classifyre.fail(state text, msg text) RETURNS void
  LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION USING ERRCODE = state, MESSAGE = msg; END$$;
-- What a statement reads, as ["schema|relation", ...] from its plan; null
-- when it cannot be planned. Errors are caught in a subtransaction, so asking
-- never aborts the client's transaction.
CREATE FUNCTION classifyre.reads(q text, q_nulls text) RETURNS text
  LANGUAGE plpgsql AS $$
DECLARE
  plan jsonb;
BEGIN
  BEGIN
    EXECUTE 'EXPLAIN (VERBOSE, GENERIC_PLAN, FORMAT JSON) ' || q INTO plan;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      EXECUTE 'EXPLAIN (VERBOSE, FORMAT JSON) ' || q_nulls INTO plan;
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END;
  RETURN (
    SELECT coalesce(json_agg(DISTINCT (node ->> 'Schema') || '|' || (node ->> 'Relation Name')), '[]'::json)::text
      FROM jsonb_path_query(plan, 'strict $.**') AS node
     WHERE jsonb_typeof(node) = 'object' AND node ? 'Relation Name'
  );
END$$;
REVOKE ALL ON SCHEMA classifyre FROM PUBLIC;
`;

const TEMPLATE_TTL_MS = 6 * 60 * 60 * 1000;

/** A session's PGlite, in its worker thread. */
export class PgliteSession {
  private next = 1;
  private readonly waiting = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  private closed = false;

  constructor(private readonly worker: Worker) {
    worker.on('message', (message: Record<string, unknown>) => {
      const id = message.id as number | undefined;
      if (id === undefined) return;
      const entry = this.waiting.get(id);
      if (!entry) return;
      this.waiting.delete(id);
      if (typeof message.error === 'string')
        entry.reject(new Error(message.error));
      else entry.resolve(message);
    });
    worker.on('exit', () =>
      this.fail(new Error('The catalog worker stopped.')),
    );
    worker.on('error', (error: unknown) =>
      this.fail(error instanceof Error ? error : new Error(String(error))),
    );
  }

  private fail(error: Error): void {
    this.closed = true;
    for (const entry of this.waiting.values()) entry.reject(error);
    this.waiting.clear();
  }

  private call(request: Record<string, unknown>, transfer: ArrayBuffer[] = []) {
    if (this.closed)
      return Promise.reject(new Error('The catalog worker stopped.'));
    const id = this.next++;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...request }, transfer);
    });
  }

  /** Protocol messages in, the backend's reply out (PGlite's execProtocolRaw). */
  async raw(bytes: Buffer): Promise<Buffer> {
    const copy = new Uint8Array(bytes);
    const reply = await this.call({ kind: 'raw', bytes: copy }, [copy.buffer]);
    const out = reply.bytes as Uint8Array;
    return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  }

  async exec(sql: string): Promise<void> {
    await this.call({ kind: 'exec', sql });
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const reply = await this.call({ kind: 'query', sql, params });
    return reply.rows as T[];
  }

  async dump(): Promise<ArrayBuffer> {
    return (await this.call({ kind: 'dump' })).dump as ArrayBuffer;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.worker.terminate().catch(() => undefined);
  }
}

/**
 * Starts session PGlites from a template per workspace: a data directory
 * whose database is named after the workspace, with Classifyre's helper
 * function, built once (a few seconds) and kept for hours. A session then
 * starts in well under a second, plus its catalog.
 */
export class PgliteHost {
  private readonly templates = new Map<
    string,
    { at: number; dir: Promise<ArrayBuffer> }
  >();

  private spawn(
    data: Record<string, unknown>,
    transfer: ArrayBuffer[] = [],
  ): Promise<PgliteSession> {
    const file = join(__dirname, `pglite-worker${extname(__filename)}`);
    const worker = new Worker(file, {
      workerData: data,
      transferList: transfer,
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    return new Promise((resolve, reject) => {
      const onMessage = (message: Record<string, unknown>) => {
        if (message.ready) {
          worker.off('message', onMessage);
          resolve(new PgliteSession(worker));
        } else if (typeof message.fatal === 'string') {
          worker.off('message', onMessage);
          void worker.terminate();
          reject(new Error(message.fatal));
        }
      };
      worker.on('message', onMessage);
      worker.once('error', reject);
    });
  }

  private template(database: string): Promise<ArrayBuffer> {
    const hit = this.templates.get(database);
    if (hit && Date.now() - hit.at < TEMPLATE_TTL_MS) return hit.dir;
    const dir = (async () => {
      const base = await this.spawn({
        setup: `CREATE DATABASE "${database.replace(/"/g, '""')}"`,
      });
      const baseDir = await base.dump();
      await base.close();
      const ws = await this.spawn(
        { template: baseDir, database, setup: WORKSPACE_SETUP },
        [baseDir],
      );
      const out = await ws.dump();
      await ws.close();
      return out;
    })();
    this.templates.set(database, { at: Date.now(), dir });
    dir.catch(() => this.templates.delete(database));
    return dir;
  }

  /** A session's PGlite for `database`, its catalog created by `setup`. */
  async open(database: string, setup: string): Promise<PgliteSession> {
    const template = (await this.template(database)).slice(0);
    return this.spawn({ template, database, setup }, [template]);
  }
}
