/**
 * One PGlite (PostgreSQL in WebAssembly) per SQL-gateway session, in its own
 * worker thread (docs/prd/DQ-data-query.md §5.7). It holds the session's
 * catalog — empty tables shaped like the person's readable tables — and
 * answers every catalog query, prepared statement and description. It never
 * holds rows: data queries run as query jobs. Terminating the thread frees its
 * memory, which a closed PGlite in a long-lived thread does not.
 */
import { parentPort, workerData } from 'node:worker_threads';

type Request =
  | { id: number; kind: 'raw'; bytes: Uint8Array }
  | { id: number; kind: 'exec'; sql: string }
  | { id: number; kind: 'query'; sql: string; params?: unknown[] }
  | { id: number; kind: 'dump' };

interface Init {
  /** A data directory to start from (a workspace template), or none for a fresh one. */
  template?: ArrayBuffer;
  database?: string;
  /** Run once after start, as the superuser: the session's catalog. */
  setup?: string;
}

async function main(): Promise<void> {
  const { PGlite } = await import('@electric-sql/pglite');
  const init = workerData as Init;
  const db = await PGlite.create({
    ...(init.template ? { loadDataDir: new Blob([init.template]) } : {}),
    ...(init.database ? { database: init.database } : {}),
  });
  if (init.setup) await db.exec(init.setup);
  parentPort!.on('message', (request: Request) => {
    void (async () => {
      try {
        if (request.kind === 'raw') {
          const bytes = await db.execProtocolRaw(request.bytes);
          parentPort!.postMessage({ id: request.id, bytes }, [
            bytes.buffer as ArrayBuffer,
          ]);
        } else if (request.kind === 'exec') {
          await db.exec(request.sql);
          parentPort!.postMessage({ id: request.id });
        } else if (request.kind === 'query') {
          const result = await db.query(request.sql, request.params ?? []);
          parentPort!.postMessage({ id: request.id, rows: result.rows });
        } else {
          const dump = await (await db.dumpDataDir('none')).arrayBuffer();
          parentPort!.postMessage({ id: request.id, dump }, [dump]);
        }
      } catch (error) {
        parentPort!.postMessage({
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });
  parentPort!.postMessage({ ready: true });
}

main().catch((error: unknown) => {
  parentPort!.postMessage({
    fatal: error instanceof Error ? error.message : String(error),
  });
});
