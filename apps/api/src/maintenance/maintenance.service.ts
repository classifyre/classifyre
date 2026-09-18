import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  CLS_NAMESPACE_ID,
  CLS_SCHEMA,
  pgBossSchemaForId,
} from '../namespace/namespace.constants';
import { NamespacePauseService } from '../namespace/namespace-pause.service';
import { RunnerLogStorageService } from '../cli-runner/runner-log-storage.service';
import {
  CLEANABLE_DATASETS,
  PROTECTED_DATASETS,
  isCleanupKey,
  type CleanableDataset,
  type CleanupKey,
} from './maintenance.datasets';

export interface TableStat {
  table: string;
  /** Planner estimate (pg_class.reltuples): instant, approximate. */
  rowsEstimate: number;
  sizeBytes: number;
}

export interface DatasetStat {
  /** Stable dataset key for display (`sources`, `scans`, …). */
  key: string;
  /** Null for protected datasets, which have no cleanup action. */
  cleanupKey: CleanupKey | null;
  tables: string[];
  rowsEstimate: number;
  sizeBytes: number;
  cleanable: boolean;
}

export interface MaintenanceOverview {
  schemaSizeBytes: number;
  bossSchemaSizeBytes: number;
  tableStats: TableStat[];
  datasets: DatasetStat[];
  /** Tables in the schema that no dataset lists (config, migrations, ...). */
  unlistedTables: string[];
  unlistedSizeBytes: number;
  /**
   * Pending/running scans right now. Cleaning while this is non-zero races
   * the workers — the UI nudges towards pausing the workspace first.
   */
  activeJobs: number;
}

export interface CleanupResult {
  key: CleanupKey;
  /** Rows removed per table (or job state). */
  deleted: Record<string, number>;
  /** Work deliberately left alone, e.g. running scans. */
  skipped: Record<string, number>;
  durationMs: number;
}

export type CleanupRunStatus = 'running' | 'done' | 'failed';

/** Immediate answer of POST /maintenance/cleanup/:key: the wipe runs on. */
export interface CleanupRunStarted {
  runId: string;
  key: CleanupKey;
  status: Extract<CleanupRunStatus, 'running'>;
}

/**
 * Pollable progress of a running (or finished) cleanup. `totalEstimate` is
 * the planner guess at start — approximate, null when unknowable — while
 * `processed` counts rows actually removed so far.
 */
export interface CleanupProgress {
  runId: string;
  key: CleanupKey;
  status: CleanupRunStatus;
  totalEstimate: number | null;
  processed: number;
  currentTable: string | null;
  tablesTotal: number;
  tablesDone: number;
  result?: CleanupResult;
  error?: string;
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
/** Rows per DELETE round-trip: small enough to never bloat a transaction. */
const DELETE_CHUNK = 2000;
/** Runner ids per Asset-null-out round-trip. */
const RUNNER_ID_CHUNK = 500;

/** Runner states whose history may be wiped; anything else is live work. */
const TERMINAL_RUNNER_STATES = ['COMPLETED', 'WARNING', 'ERROR'];
const LIVE_RUNNER_STATES = ['PENDING', 'RUNNING'];

const TERMINAL_TRANSFER_STATES = ['COMPLETED', 'FAILED', 'CANCELLED'];
const FINISHED_JOB_STATES = ['completed', 'failed', 'cancelled'];

/** TRUNCATE waits at most this long for writers, then falls back to DELETE. */
const TRUNCATE_LOCK_TIMEOUT = '15s';
/** Recent runs kept for progress polling (in-memory; single API replica). */
const MAX_KEPT_RUNS = 50;

/** Per-chunk progress sink; strategies call it as rows actually go away. */
type ProgressTick = (removed: number, table: string) => void;
const NO_PROGRESS: ProgressTick = () => undefined;

/**
 * Storage overview + safe cleanup for one workspace.
 *
 * Safety rules, enforced for every key:
 * - Only tables listed in `maintenance.datasets.ts` are ever touched, and
 *   identifiers are validated before interpolation — the protected datasets
 *   (sources, findings, assets, cases, inquiries, glossary) have no cleanup
 *   path at all, so a typo cannot become a data-loss bug.
 * - Whole-dataset wipes prefer TRUNCATE (O(1), space freed instantly) when
 *   no outside table references the dataset — checked live against
 *   pg_constraint, with a bounded lock wait and automatic fallback to
 *   chunked DELETE. Whatever remains a DELETE runs in `DELETE_CHUNK`-sized
 *   statements with `ctid` positionals (no PK assumption, no long
 *   transaction, no table lock beyond row locks), so even 10M-row tables
 *   drain without wedging the database.
 * - Every wipe ends with VACUUM (ANALYZE): DELETE leaves dead tuples behind
 *   (disk stays full, planner stats go stale), the vacuum pass reclaims the
 *   pages and refreshes the estimates the overview shows.
 * - Wipes run as background runs with pollable progress (POST returns 202
 *   immediately), because a million-row drain takes minutes, not seconds.
 * - Live work is never deleted: running/pending scans, queued or active
 *   queue jobs, unfinished transfers are counted under `skipped` instead.
 * - FK dependants are handled in dependency order (children before parents;
 *   nullable references nulled first; auto-cascade/SET NULL left to
 *   Postgres), so cleanup cannot leave dangling references.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private readonly runs = new Map<string, CleanupProgress>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    @Optional() private readonly pause?: NamespacePauseService,
    @Optional() private readonly runnerLogs?: RunnerLogStorageService,
  ) {}

  private schema(): string {
    const schema = this.cls.get<string>(CLS_SCHEMA);
    if (!schema || !IDENT_RE.test(schema)) {
      throw new NotFoundException('Unknown workspace schema');
    }
    return schema;
  }

  private bossSchema(): string {
    const namespaceId = this.cls.get<string>(CLS_NAMESPACE_ID);
    if (!namespaceId) throw new NotFoundException('Unknown workspace');
    const schema = pgBossSchemaForId(namespaceId);
    if (!IDENT_RE.test(schema)) {
      throw new NotFoundException('Unknown worker schema');
    }
    return schema;
  }

  // ── Overview ────────────────────────────────────────────────────────────

  async overview(): Promise<MaintenanceOverview> {
    const schema = this.schema();
    const tableStats = await this.tableStats(schema);
    const byTable = new Map(tableStats.map((s) => [s.table, s]));
    const sum = (tables: string[]) =>
      tables.reduce(
        (acc, t) => {
          const s = byTable.get(t);
          return {
            rows: acc.rows + (s?.rowsEstimate ?? 0),
            size: acc.size + (s?.sizeBytes ?? 0),
          };
        },
        { rows: 0, size: 0 },
      );

    const datasets: DatasetStat[] = [
      ...PROTECTED_DATASETS.map((d) => {
        const s = sum(d.tables);
        return {
          key: d.key,
          cleanupKey: null,
          tables: d.tables,
          rowsEstimate: s.rows,
          sizeBytes: s.size,
          cleanable: false as const,
        };
      }),
      ...CLEANABLE_DATASETS.map((d) => {
        const s = sum(d.tables);
        return {
          key: d.key,
          cleanupKey: d.key,
          tables: d.tables,
          rowsEstimate: s.rows,
          sizeBytes: s.size,
          cleanable: true as const,
        };
      }),
    ];

    // Scheduler sizes live in the boss schema, not the app schema.
    const boss = await this.bossStats().catch(() => ({
      tables: [] as TableStat[],
      total: 0,
    }));
    const scheduler = datasets.find((d) => d.cleanupKey === 'scheduler');
    if (scheduler) {
      scheduler.rowsEstimate = boss.tables.reduce(
        (a, t) => a + t.rowsEstimate,
        0,
      );
      scheduler.sizeBytes = boss.total;
      scheduler.tables = boss.tables.map((t) => t.table);
    }

    const listed = new Set<string>();
    for (const d of datasets) for (const t of d.tables) listed.add(t);
    const unlisted = tableStats.filter((s) => !listed.has(s.table));
    const schemaSizeBytes = tableStats.reduce((a, t) => a + t.sizeBytes, 0);
    // Live scans race a cleanup (workers re-insert while the wipe drains),
    // so the overview carries the count and the UI can nudge towards pause.
    const activeJobs = byTable.has('runners')
      ? await this.countWhere(
          'runners',
          `WHERE status IN (${LIVE_RUNNER_STATES.map(quoteLiteral).join(', ')})`,
        ).catch(() => 0)
      : 0;

    return {
      schemaSizeBytes,
      bossSchemaSizeBytes: boss.total,
      tableStats,
      datasets,
      unlistedTables: unlisted.map((s) => s.table),
      unlistedSizeBytes: unlisted.reduce((a, t) => a + t.sizeBytes, 0),
      activeJobs,
    };
  }

  private async tableStats(schema: string): Promise<TableStat[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ table: string; rows_estimate: bigint; size_bytes: bigint }>
    >`
      SELECT c.relname AS table,
             (c.reltuples)::bigint AS rows_estimate,
             pg_total_relation_size(c.oid)::bigint AS size_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ${schema}
         AND c.relkind IN ('r', 'p')
       ORDER BY pg_total_relation_size(c.oid) DESC`;
    return rows.map((r) => ({
      table: r.table,
      rowsEstimate: Number(r.rows_estimate),
      sizeBytes: Number(r.size_bytes),
    }));
  }

  private async bossStats(): Promise<{ tables: TableStat[]; total: number }> {
    const schema = this.bossSchema();
    const wanted = CLEANABLE_DATASETS.find((d) => d.key === 'scheduler');
    const roots = (wanted?.bossTables ?? []).filter((t) => IDENT_RE.test(t));
    if (roots.length === 0) return { tables: [], total: 0 };
    // pg-boss partitions `job` by time: the parent reports 0 pages and -1
    // tuples, so aggregate each listed root with its whole partition tree
    // (row estimates are per-partition planner guesses, summed).
    const rows = await this.prisma.$queryRaw<
      Array<{ table: string; rows_estimate: bigint; size_bytes: bigint }>
    >`
      WITH RECURSIVE tree AS (
        SELECT c.oid, c.relname AS root
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = ${schema}
           AND c.relname IN (${Prisma.join(roots)})
        UNION
        SELECT c.oid, t.root
          FROM tree t
          JOIN pg_inherits i ON i.inhparent = t.oid
          JOIN pg_class c ON c.oid = i.inhrelid
      )
      SELECT t.root AS table,
             SUM((c.reltuples)::bigint) AS rows_estimate,
             SUM(pg_total_relation_size(c.oid))::bigint AS size_bytes
        FROM tree t
        JOIN pg_class c ON c.oid = t.oid
       GROUP BY t.root`;
    const tables = rows.map((r) => ({
      table: r.table,
      rowsEstimate: Number(r.rows_estimate),
      sizeBytes: Number(r.size_bytes),
    }));
    return { tables, total: tables.reduce((a, t) => a + t.sizeBytes, 0) };
  }

  // ── Cleanup runs ────────────────────────────────────────────────────────

  /**
   * Start wiping one dataset in the background and return immediately: big
   * wipes take minutes, so the client polls `cleanupProgress(runId)`.
   * The fork keeps the request's CLS context (schema, pause guard), and the
   * run record is the only shared state — strategies report into it.
   */
  startCleanup(key: string): CleanupRunStarted {
    if (!isCleanupKey(key)) {
      throw new NotFoundException(`Unknown cleanup '${key}'`);
    }
    // Deliberately NOT pause-guarded: the endpoint carries
    // @AllowWhenPaused, because a frozen workspace is the ideal quiet
    // window — no worker can re-insert rows while the wipe drains. The
    // pause service stays injected for future non-HTTP triggers.
    const dataset = CLEANABLE_DATASETS.find((d) => d.key === key);
    if (!dataset) throw new NotFoundException(`Unknown cleanup '${key}'`);

    const run: CleanupProgress = {
      runId: randomUUID(),
      key,
      status: 'running',
      totalEstimate: null,
      processed: 0,
      currentTable: null,
      tablesTotal: dataset.tables.length + (dataset.bossTables?.length ?? 0),
      tablesDone: 0,
      result: undefined,
      error: undefined,
    };
    this.rememberRun(run);
    this.logger.log(`Storage cleanup '${key}' started (run ${run.runId})`);
    // Deliberately un-awaited: the response is the run id, progress polls.
    void this.executeRun(run, dataset).catch((error: unknown) => {
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      run.currentTable = null;
      this.logger.error(
        `Storage cleanup '${key}' (run ${run.runId}) failed: ${run.error}`,
      );
    });
    return { runId: run.runId, key, status: 'running' };
  }

  /** Pollable snapshot of a run; 404 once the run aged out of memory. */
  cleanupProgress(runId: string): CleanupProgress {
    const run = this.runs.get(runId);
    if (!run) throw new NotFoundException(`Unknown cleanup run '${runId}'`);
    return { ...run };
  }

  private rememberRun(run: CleanupProgress): void {
    this.runs.set(run.runId, run);
    if (this.runs.size <= MAX_KEPT_RUNS) return;
    // Evict the oldest finished run first, else the oldest run outright.
    for (const [id, kept] of this.runs) {
      if (kept.status !== 'running') {
        this.runs.delete(id);
        return;
      }
    }
    const oldest = this.runs.keys().next();
    if (!oldest.done) this.runs.delete(oldest.value);
  }

  private tick(run: CleanupProgress, table: string): ProgressTick {
    return (removed: number, tableName: string) => {
      run.processed += removed;
      run.currentTable = tableName || table;
    };
  }

  private tableDone(run: CleanupProgress, table: string): void {
    run.tablesDone += 1;
    run.currentTable = table;
  }

  private async executeRun(
    run: CleanupProgress,
    dataset: CleanableDataset,
  ): Promise<void> {
    const started = Date.now();
    const key = run.key;
    run.totalEstimate = await this.estimateDataset(dataset).catch(() => null);

    let result: Omit<CleanupResult, 'key' | 'durationMs'>;
    // touched tracks app-schema tables for the closing VACUUM (boss tables
    // are handled with the scheduler key explicitly).
    let touched: string[] = [];
    switch (key) {
      case 'scans':
        result = await this.cleanupScans(this.tick(run, 'runners'));
        touched = ['runners', 'runner_assets'];
        break;
      case 'duplicates':
        result = await this.wipeTables(
          dataset,
          ['asset_cluster_members', 'asset_clusters'],
          this.tick(run, dataset.tables[0] ?? 'duplicates'),
        );
        touched = [...dataset.tables];
        break;
      case 'embeddings':
        result = await this.wipeTables(
          dataset,
          [],
          this.tick(run, dataset.tables[0] ?? 'embeddings'),
        );
        touched = [...dataset.tables];
        break;
      case 'harness':
        result = await this.wipeTables(
          dataset,
          [
            'agent_logs',
            'agent_decisions',
            'supervisor_inbox_events',
            'supervisor_journal_entries',
            'agent_runs',
          ],
          this.tick(run, dataset.tables[0] ?? 'harness'),
        );
        touched = [...dataset.tables];
        break;
      case 'scheduler':
        result = await this.cleanupSchedulerJobs(this.tick(run, 'job'));
        for (const t of dataset.bossTables ?? []) this.tableDone(run, t);
        await this.vacuumBossTables();
        break;
      case 'stats':
        result = await this.wipeTables(
          dataset,
          [],
          this.tick(run, dataset.tables[0] ?? 'stats'),
        );
        touched = [...dataset.tables];
        break;
      case 'graph':
        result = await this.wipeTables(
          dataset,
          [],
          this.tick(run, dataset.tables[0] ?? 'graph'),
        );
        touched = [...dataset.tables];
        break;
      case 'transfers':
        result = await this.cleanupTransfers(this.tick(run, 'transfers'));
        touched = ['data_transfer_jobs', 'data_transfer_chunks'];
        break;
      default:
        assertNever(key);
    }

    if (touched.length > 0) await this.vacuumTables(touched);
    for (const t of touched) this.tableDone(run, t);

    const full: CleanupResult = {
      key,
      ...result,
      durationMs: Date.now() - started,
    };
    run.status = 'done';
    run.result = full;
    run.currentTable = null;
    this.logger.log(
      `Storage cleanup '${key}' (run ${run.runId}) finished in ` +
        `${full.durationMs}ms: ${JSON.stringify(full.deleted)} ` +
        `skipped=${JSON.stringify(full.skipped)}`,
    );
  }

  /** Rough row guess for the progress bar (planner estimates, may be 0). */
  private async estimateDataset(
    dataset: CleanableDataset,
  ): Promise<number | null> {
    const counts = await this.countEstimates(dataset.tables);
    let total = 0;
    for (const t of dataset.tables) total += Math.max(0, counts.get(t) ?? 0);
    if (dataset.bossTables?.length) {
      const boss = await this.bossStats().catch(() => null);
      if (boss) total += boss.tables.reduce((a, t) => a + t.rowsEstimate, 0);
    }
    return total;
  }

  /**
   * Wipe whole tables, fastest safe method first. TRUNCATE is O(1) and frees
   * disk pages immediately, but Postgres refuses it while an outside table
   * references the dataset — so the pg_constraint check runs live, the
   * TRUNCATE itself waits at most TRUNCATE_LOCK_TIMEOUT for writers, and any
   * refusal falls back to chunked DELETE. A single multi-table TRUNCATE
   * statement absorbs FKs *inside* the dataset, so `childFirst` only orders
   * the DELETE fallback path.
   */
  private async wipeTables(
    dataset: CleanableDataset,
    childFirst: string[],
    onProgress: ProgressTick = NO_PROGRESS,
  ): Promise<Omit<CleanupResult, 'key' | 'durationMs'>> {
    const ordered = [
      ...childFirst,
      ...dataset.tables.filter((t) => !childFirst.includes(t)),
    ];
    const counts = await this.countEstimates(ordered);
    const deletedOf = (t: string) => Math.max(0, counts.get(t) ?? 0);

    if (!(await this.hasExternalReferences(ordered))) {
      const quoted = ordered.map((t) => `"${this.assertIdent(t)}"`).join(', ');
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL lock_timeout = '${TRUNCATE_LOCK_TIMEOUT}'`,
          );
          await tx.$executeRawUnsafe(`TRUNCATE ${quoted}`);
        });
        const deleted: Record<string, number> = {};
        for (const t of ordered) {
          deleted[t] = deletedOf(t);
          onProgress(deleted[t], t);
        }
        return { deleted, skipped: {} };
      } catch (error) {
        // Locked by a writer, or a reference appeared mid-flight: drain by
        // DELETE instead of failing the run.
        this.logger.warn(
          `TRUNCATE refused for [${ordered.join(', ')}], ` +
            `falling back to chunked DELETE: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const deleted: Record<string, number> = {};
    for (const table of ordered) {
      const n = await this.deleteChunks(table, '', false, 'ctid', onProgress);
      deleted[table] = n;
    }
    return { deleted, skipped: {} };
  }

  /**
   * True when some table OUTSIDE the wipe set references a table inside it —
   * exactly the condition under which TRUNCATE would refuse. Internal
   * references are fine (one multi-table statement covers them).
   */
  private async hasExternalReferences(tables: string[]): Promise<boolean> {
    const schema = this.schema();
    const names = tables.filter((t) => IDENT_RE.test(t));
    if (names.length === 0) return false;
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      WITH targets AS (
        SELECT c.oid FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${schema} AND c.relname IN (${Prisma.join(names)})
      )
      SELECT COUNT(*)::bigint AS n FROM pg_constraint k
      WHERE k.contype = 'f'
        AND k.confrelid IN (SELECT oid FROM targets)
        AND k.conrelid NOT IN (SELECT oid FROM targets)`;
    return Number(rows[0]?.n ?? 0) > 0;
  }

  /**
   * Reclaim the dead tuples a chunked DELETE leaves behind and refresh the
   * planner stats, or the overview keeps reporting the old size and row
   * counts. Plain VACUUM (never FULL): no blocking lock, safe beside live
   * traffic; VACUUM cannot run inside a transaction block, so each table is
   * its own statement.
   */
  private async vacuumTables(tables: string[]): Promise<void> {
    for (const table of tables) {
      const name = `"${this.assertIdent(table)}"`;
      await this.prisma.$executeRawUnsafe(`VACUUM (ANALYZE) ${name}`);
    }
  }

  /** Same reclaim pass for the pg-boss queue tables (partitioned parents). */
  private async vacuumBossTables(): Promise<void> {
    const schema = this.bossSchema();
    const dataset = CLEANABLE_DATASETS.find((d) => d.key === 'scheduler');
    for (const table of dataset?.bossTables ?? []) {
      if (!IDENT_RE.test(table)) continue;
      if (table === 'archive' && !(await this.tableExists(schema, table))) {
        continue;
      }
      await this.prisma.$executeRawUnsafe(
        `VACUUM (ANALYZE) "${schema}"."${table}"`,
      );
    }
  }

  // ── scans ───────────────────────────────────────────────────────────────

  private async cleanupScans(
    onProgress: ProgressTick = NO_PROGRESS,
  ): Promise<Omit<CleanupResult, 'key' | 'durationMs'>> {
    // Statuses are module constants, not user input; quote once, reuse.
    const terminal = TERMINAL_RUNNER_STATES.map(quoteLiteral).join(', ');
    const live = LIVE_RUNNER_STATES.map(quoteLiteral).join(', ');
    // Physical columns are snake_case (the migrations quote them); Prisma
    // model names do not apply in raw SQL.
    const doomed = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; sourceId: string }>
    >(
      `SELECT id, "source_id" AS "sourceId" FROM runners WHERE status IN (${terminal})`,
    );
    const skippedRunning = await this.countWhere(
      'runners',
      `WHERE status IN (${live})`,
    );

    let deletedRunners = 0;
    let deletedRunnerAssets = 0;
    let logErrors = 0;
    for (let i = 0; i < doomed.length; i += RUNNER_ID_CHUNK) {
      const batch = doomed.slice(i, i + RUNNER_ID_CHUNK);
      const idList = batch.map((r) => quoteLiteral(r.id)).join(', ');
      // Assets point at their last-seen runner (nullable, no cascade): clear
      // the pointer first or the runner delete is refused.
      await this.prisma.$executeRawUnsafe(
        `UPDATE assets SET "runner_id" = NULL WHERE "runner_id" IN (${idList})`,
      );
      deletedRunnerAssets += await this.deleteChunks(
        'runner_assets',
        `WHERE "runner_id" IN (${idList})`,
        false,
        'ctid',
        onProgress,
      );
      // Notifications null themselves (SET NULL), runner_assets cascade;
      // both were handled above so this delete cannot strand references.
      const runnersBatch = Number(
        await this.prisma.$executeRawUnsafe(
          `DELETE FROM runners WHERE id IN (${idList})`,
        ),
      );
      deletedRunners += runnersBatch;
      onProgress(runnersBatch, 'runners');
      if (this.runnerLogs) {
        for (const r of batch) {
          try {
            await this.runnerLogs.deleteRunnerLogs(r.sourceId, r.id);
          } catch {
            logErrors += 1;
          }
        }
      }
    }
    const skipped: Record<string, number> = {};
    if (skippedRunning > 0)
      skipped['runners (pending/running)'] = skippedRunning;
    const deleted: Record<string, number> = {
      runners: deletedRunners,
      runner_assets: deletedRunnerAssets,
    };
    if (logErrors > 0) skipped['runner log files (kept on error)'] = logErrors;
    return { deleted, skipped };
  }

  // ── scheduler ───────────────────────────────────────────────────────────

  private async cleanupSchedulerJobs(
    onProgress: ProgressTick = NO_PROGRESS,
  ): Promise<Omit<CleanupResult, 'key' | 'durationMs'>> {
    const schema = this.bossSchema();
    const deleted: Record<string, number> = {};
    // Finished jobs only. Created/retry/active rows are live schedules and
    // in-flight work; the cron `schedule` table is never touched. Chunked by
    // `id`: `job` is time-partitioned and refuses `ctid` on the parent.
    deleted['job (finished)'] = await this.deleteChunks(
      `${schema}.job`,
      `WHERE state IN (${FINISHED_JOB_STATES.map((s) => `'${s}'`).join(', ')})`,
      true,
      'id',
      onProgress,
    );
    if (await this.tableExists(schema, 'archive')) {
      // Same partitioning caveat as `job` above.
      deleted['archive'] = await this.deleteChunks(
        `${schema}.archive`,
        '',
        true,
        'id',
        onProgress,
      );
    }
    const skipped: Record<string, number> = {
      'job (live: created/retry/active)': await this.countWhere(
        `${schema}.job`,
        `WHERE state NOT IN (${FINISHED_JOB_STATES.map((s) => `'${s}'`).join(', ')})`,
        true,
      ),
    };
    return { deleted, skipped };
  }

  // ── transfers ───────────────────────────────────────────────────────────

  private async cleanupTransfers(
    onProgress: ProgressTick = NO_PROGRESS,
  ): Promise<Omit<CleanupResult, 'key' | 'durationMs'>> {
    const states = TERMINAL_TRANSFER_STATES.map((s) => `'${s}'`).join(', ');
    // Chunks carry a composite (job_id, ordinal) key with no `id`, so they
    // are removed per finished-job batch; the job delete cascades any
    // remainder, and both passes stay small.
    const finished = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM data_transfer_jobs WHERE status IN (${states})`,
    );
    let chunks = 0;
    for (let i = 0; i < finished.length; i += RUNNER_ID_CHUNK) {
      const batch = finished
        .slice(i, i + RUNNER_ID_CHUNK)
        .map((r) => quoteLiteral(r.id))
        .join(', ');
      const n = Number(
        await this.prisma.$executeRawUnsafe(
          `DELETE FROM "data_transfer_chunks" WHERE "job_id" IN (${batch})`,
        ),
      );
      chunks += n;
      onProgress(n, 'data_transfer_chunks');
    }
    const jobs = await this.deleteChunks(
      'data_transfer_jobs',
      `WHERE status IN (${states})`,
      false,
      'ctid',
      onProgress,
    );
    const live = await this.countWhere(
      'data_transfer_jobs',
      `WHERE status NOT IN (${states})`,
    );
    return {
      deleted: { data_transfer_jobs: jobs, data_transfer_chunks: chunks },
      skipped:
        live > 0 ? { 'data_transfer_jobs (staged/pending/running)': live } : {},
    };
  }

  // ── SQL helpers ─────────────────────────────────────────────────────────

  private assertIdent(value: string): string {
    if (!IDENT_RE.test(value)) throw new NotFoundException('Bad table name');
    return value;
  }

  private async tableExists(schema: string, table: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema} AND c.relname = ${table}
        AND c.relkind IN ('r', 'p')`;
    return Number(rows[0]?.n ?? 0) > 0;
  }

  private async countEstimates(tables: string[]): Promise<Map<string, number>> {
    const schema = this.schema();
    const rows = await this.prisma.$queryRaw<
      Array<{ table: string; rows_estimate: bigint }>
    >`
      SELECT c.relname AS table, (c.reltuples)::bigint AS rows_estimate
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ${schema} AND c.relkind IN ('r', 'p')`;
    const map = new Map(rows.map((r) => [r.table, Number(r.rows_estimate)]));
    return new Map(tables.map((t) => [t, map.get(t) ?? 0]));
  }

  private async countWhere(
    table: string,
    where: string,
    qualified = false,
  ): Promise<number> {
    const name = qualified ? table : `"${this.assertIdent(table)}"`;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM ${name} ${where}`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Delete matching rows `DELETE_CHUNK` at a time via `ctid` positionals —
   * deliberately key-agnostic, because several large tables carry composite
   * primary keys and no `id` at all (`content_embeddings`, `runner_assets`).
   * Each chunk is its own short statement with row locks only;
   * `$executeRawUnsafe` returns the affected count directly, so no RETURNING
   * flood crosses the wire. Returns the total removed.
   *
   * The one exception is pg-boss's partitioned `job`, where `ctid`
   * positionals are refused on the parent: pass `key: 'id'` there (its PK).
   */
  private async deleteChunks(
    table: string,
    where: string,
    qualified = false,
    key: 'ctid' | 'id' = 'ctid',
    onProgress: ProgressTick = NO_PROGRESS,
  ): Promise<number> {
    const name = qualified
      ? this.assertQualified(table)
      : `"${this.assertIdent(table)}"`;
    const short =
      qualified && table.includes('.') ? table.split('.')[1] : table;
    let total = 0;
    for (;;) {
      const n = Number(
        await this.prisma.$executeRawUnsafe(
          `DELETE FROM ${name} WHERE ${key} IN ` +
            `(SELECT ${key} FROM ${name} ${where} LIMIT ${DELETE_CHUNK})`,
        ),
      );
      total += n;
      if (n > 0) onProgress(n, short);
      if (n < DELETE_CHUNK) break;
    }
    return total;
  }

  private assertQualified(value: string): string {
    const parts = value.split('.');
    if (parts.length !== 2 || !parts.every((p) => IDENT_RE.test(p))) {
      throw new NotFoundException('Bad table name');
    }
    return `"${parts[0]}"."${parts[1]}"`;
  }
}

function assertNever(value: never): never {
  throw new NotFoundException(`Unknown cleanup '${String(value)}'`);
}

/** Single-quote a string literal fragment (constants and UUIDs only). */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
