import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, QueryRunStatus } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { tableFromIPC } from 'apache-arrow';
import { PrismaService } from '../prisma.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { ActorContextService } from '../identity/actor-context.service';
import {
  AuditTrailService,
  type AuditChannel,
  asAuditChannel,
  channelOfRef,
  viaOfChannel,
} from '../identity/audit-trail.service';
import type { Actor } from '../identity/actor';
import { parseActorRef, personOf } from '../identity/actor-ref';
import {
  datasetResource,
  tableReadResources,
} from '../identity/audit-resources';
import { scanStatsOf, type ScanStat } from './scan-stats';
import {
  QueryCatalogService,
  type CatalogTable,
} from './query-catalog.service';
import { SHARED_DATASET_SOURCE_TYPE, mentionedSourceNames } from './sql-names';
import {
  SharedDatasetResolver,
  type ResolvedDataset,
} from './shared-dataset-resolver';
import type { DescribedLineage } from './dataset-floor';
import {
  maskSalt,
  parseRunMasks,
  runMasksOf,
  type RunMask,
} from './column-masks';
import {
  parseRunRowFilters,
  runRowFiltersOf,
  type RunRowFilter,
} from './row-filters';
import { resolveApplicationSecretKey } from '../secret-key.util';
import {
  extractThreePartNames,
  precheckSql,
  stripLiteralsAndComments,
} from './sql-precheck';
import { ACCESS_POLICY, type AccessPolicy } from '../identity/access-policy';
import { Inject } from '@nestjs/common';

/** Sources one query may attach: each is a connection the job opens. */
export const MAX_SOURCES_PER_QUERY = 8;
/** Bytes of Arrow a result may hold (the job cuts rows to fit). */
export const MAX_RESULT_BYTES = 32 * 1024 * 1024;
/** Bytes an exported file may be; larger exports are refused, not cut. */
export const MAX_EXPORT_BYTES = 256 * 1024 * 1024;

export const EXPORT_FORMATS = ['xlsx', 'csv', 'parquet'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_MEDIA_TYPES: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  parquet: 'application/vnd.apache.parquet',
};
/**
 * Queries one person may have waiting or running at once, whichever way they
 * came (app, MCP, SQL connections). A guard against one runaway client, not a
 * capacity limit: the query worker's slots and the Jobs it overflows to are
 * that. `QUERY_MAX_ACTIVE_PER_PERSON` (Helm `queryWorker.maxActivePerPerson`).
 */
export const DEFAULT_MAX_ACTIVE_PER_PERSON = 100;

export function maxActivePerPerson(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = Number.parseInt(env.QUERY_MAX_ACTIVE_PER_PERSON ?? '', 10);
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_MAX_ACTIVE_PER_PERSON;
}

const MAX_ACTIVE_PER_ACTOR = maxActivePerPerson();
/** System queries (quality rules) running at once per workspace. */
const MAX_ACTIVE_SYSTEM = 2;
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * A run still waiting or running this long after it was created was lost: no
 * query lives past the longest timeout a workspace may set (900 s) plus what a
 * Job or the query worker adds to start and deliver it. It happens when the
 * API restarts mid-run (nothing is left to settle it); such a run would
 * otherwise count against its person's cap for good.
 */
const LOST_AFTER_MS = 20 * 60 * 1000;
const RESULT_MARKER = '__CLASSIFYRE_QUERY_RESULT__';

const TERMINAL: QueryRunStatus[] = [
  QueryRunStatus.SUCCESS,
  QueryRunStatus.ERROR,
  QueryRunStatus.TIMEOUT,
  QueryRunStatus.CANCELLED,
];

export interface QueryRunView {
  id: string;
  sql: string;
  status: QueryRunStatus;
  actorRef: string | null;
  assetIds: string[];
  rowCount: number | null;
  truncated: boolean;
  truncatedReason: string | null;
  columns: { name: string; type: string }[] | null;
  /** Masked and hidden columns of the tables it names (DQ §5.8). */
  masks: RunMask[];
  /** Row filters of the tables it names (DQ §5.10). */
  rowFilters: RunRowFilter[];
  timings: Record<string, number> | null;
  /** What each connector table cost (QC §5.9); empty for other tables. */
  scans: ScanStat[];
  error: { code: string; message: string } | null;
  resultBytes: number | null;
  /** Null for rows shown in the app; the file format for an export. */
  resultFormat: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface QueryCallbackMeta {
  format?: string;
  status?: string;
  rowCount?: number;
  truncated?: boolean;
  truncatedReason?: string | null;
  columns?: { name: string; type: string }[];
  timings?: Record<string, number>;
  tables?: string[];
  /** Connector tables (QC §5.3): requests, rows and filters sent per table. */
  scans?: unknown;
  error?: { code?: string; message?: string };
  /** A describe run's answer (§5.12): output columns and their lineage. */
  describe?: {
    columns: { name: string; type: string }[];
    lineage: DescribedLineage[];
  };
}

/** What a query would return and where each column comes from (§5.12). */
export interface QueryDescription {
  columns: { name: string; type: string }[];
  lineage: DescribedLineage[];
  /** `source.schema.table` of every table it reads. */
  tables: string[];
}

/** Who a run is for and how it came: the cap counts people, the audit names the channel. */
interface RunOrigin {
  actorRef: string | null;
  personRef: string | null;
  channel: AuditChannel;
  connectionId: string | null;
}

export function runOrigin(actor: Actor): RunOrigin {
  const via = actor.ref ? parseActorRef(actor.ref).via : undefined;
  return {
    actorRef: actor.ref ?? null,
    personRef: personOf(actor.ref),
    channel: channelOfRef(actor.ref),
    connectionId: via?.kind === 'sql' ? via.id : null,
  };
}

/** A value of a result row as JSON can carry it. */
function jsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) &&
      value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    return `<${value.byteLength} bytes>`;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === 'object') {
    const plain =
      typeof (value as { toJSON?: () => unknown }).toJSON === 'function'
        ? (value as { toJSON: () => unknown }).toJSON()
        : value;
    if (plain && typeof plain === 'object' && !Array.isArray(plain)) {
      return Object.fromEntries(
        Object.entries(plain as Record<string, unknown>).map(([k, v]) => [
          k,
          jsonValue(v),
        ]),
      );
    }
    return jsonValue(plain);
  }
  return value;
}

/** Up to `maxRows` rows of an Arrow IPC stream, as JSON-safe objects. */
export function readArrowRows(
  bytes: Buffer,
  maxRows: number,
): {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
} {
  const table = tableFromIPC(bytes);
  const fields = table.schema.fields;
  const columns = fields.map((field) => ({
    name: field.name,
    type: String(field.type),
  }));
  const vectors = fields.map((_, i) => table.getChildAt(i));
  const rows: Record<string, unknown>[] = [];
  const count = Math.min(table.numRows, maxRows);
  for (let r = 0; r < count; r++) {
    const row: Record<string, unknown> = {};
    fields.forEach((field, i) => {
      row[field.name] = jsonValue(vectors[i]?.get(r));
    });
    rows.push(row);
  }
  return { columns, rows };
}

/**
 * One table of a job request: where it lives, and the masks and rows of
 * whoever reads it (DQ §5.8, §5.10). `known` overrides the recorded columns
 * (a shared dataset's output, which is always projected to them).
 */
function tableEntry(
  sourceSqlName: string,
  table: CatalogTable,
  known?: string[],
): Record<string, unknown> {
  const masks = table.masks ?? [];
  const knownColumns = known
    ? [...known, ...masks.map((mask) => mask.column)]
    : masks.length && table.columns.length
      ? [
          ...table.columns.map((column) => column.name),
          ...masks.map((mask) => mask.column),
        ]
      : undefined;
  return {
    source: sourceSqlName,
    schema: table.schema,
    table: table.table,
    assetId: table.assetId,
    location: table.location,
    // DQ §5.8: the job's view of this table hides and masks these, and
    // hides any column the scan did not record (renamed since), which no
    // mask can be known not to be for.
    ...(masks.length ? { columns: masks } : {}),
    ...(knownColumns ? { knownColumns } : {}),
    // DQ §5.10: the view shows only the rows these select.
    ...(table.rowFilter ? { rows: table.rowFilter } : {}),
  };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Runs SQL as short-lived CLI jobs and keeps their results for a day
 * (docs/prd/DQ-data-query.md §5).
 *
 * The API decides what a query may read: only the tables the catalog says
 * this person may query are put in the request, and only the recipes of
 * their sources leave the API. The job's SQL gate then refuses every other
 * name. The caller polls the run; the job posts its result with a token that
 * is good for that one run.
 */
@Injectable()
export class QueryRunService {
  private readonly logger = new Logger(QueryRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: QueryCatalogService,
    private readonly cliRunner: CliRunnerService,
    private readonly crypto: MaskedConfigCryptoService,
    private readonly actors: ActorContextService,
    private readonly audit: AuditTrailService,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
    private readonly datasets: SharedDatasetResolver,
  ) {}

  async create(sql: string, format?: string): Promise<QueryRunView> {
    return (await this.begin(sql, format)).view;
  }

  /**
   * A query for an AI agent working for a person (MCP `query_data`, DQ
   * §5.11): the same run as the SQL page's — the person's catalog, masks,
   * row filters, caps and audit, channel `mcp` — awaited, with at most
   * `maxRows` rows decoded from its Arrow result.
   */
  async runAndRead(
    sql: string,
    maxRows: number,
  ): Promise<{
    run: QueryRunView;
    columns: { name: string; type: string }[];
    rows: Record<string, unknown>[];
  }> {
    const { view, done } = await this.begin(sql);
    await done;
    const run = await this.get(view.id);
    if (run.status !== QueryRunStatus.SUCCESS) {
      return { run, columns: [], rows: [] };
    }
    const { bytes } = await this.result(view.id);
    return { run, ...readArrowRows(bytes, maxRows) };
  }

  /**
   * What a query returns, without reading a row (§5.12: a query about to be
   * shared as a dataset): its output columns and their column lineage, run
   * as the person over the tables they may query (masked as they read them).
   */
  async describe(
    sql: string,
  ): Promise<
    | { description: QueryDescription }
    | { error: { code: string; message: string } }
  > {
    const { view, done } = await this.begin(sql, undefined, true);
    await done;
    const run = await this.prisma.queryRun.findUnique({
      where: { id: view.id },
      select: { status: true, error: true, result: true },
    });
    if (!run || run.status !== QueryRunStatus.SUCCESS || !run.result) {
      const error = (run?.error ?? null) as {
        code?: string;
        message?: string;
      } | null;
      return {
        error: {
          code: error?.code ?? 'execution_error',
          message: error?.message ?? 'The query could not be described.',
        },
      };
    }
    await this.prisma.queryRun
      .update({ where: { id: view.id }, data: { result: null } })
      .catch(() => undefined);
    return {
      description: JSON.parse(
        Buffer.from(run.result).toString('utf8'),
      ) as QueryDescription,
    };
  }

  private async begin(
    sql: string,
    format?: string,
    describe = false,
  ): Promise<{ view: QueryRunView; done: Promise<void> }> {
    const text = (sql ?? '').trim();
    const exportFormat = format
      ? EXPORT_FORMATS.find((f) => f === format.toLowerCase())
      : undefined;
    if (format && !exportFormat) {
      throw new BadRequestException(
        `Export as ${EXPORT_FORMATS.join(', ')}, not ${format}.`,
      );
    }
    if (!text) throw new BadRequestException('Write a SELECT statement.');
    if (text.length > 100_000) {
      throw new BadRequestException(
        'The SQL is longer than 100,000 characters.',
      );
    }
    const settings = await this.catalog.settings();
    const actor = this.actors.current();
    if (exportFormat) {
      // A file leaves the app: that is data.export, on top of the right to
      // read the tables (docs/prd/IAM §6.1, "Data out").
      const decision = await this.policy.check(actor, 'data.export');
      if (!decision.allow) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          code: 'EXPORT_NOT_ALLOWED',
          capability: 'data.export',
          message:
            'Exporting needs the right to take data out of the workspace (data.export).',
        });
      }
    }
    const origin = runOrigin(actor);
    await this.assertBelowCap(origin);

    const catalog = await this.catalog.catalog();
    const allowed = catalog.sources
      .map((source) => ({
        source,
        tables: source.tables.filter((t) => t.canQuery && t.location),
      }))
      .filter((entry) => entry.tables.length);
    if (!allowed.length) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'NO_QUERYABLE_TABLES',
        message: 'There is no table here you can query.',
      });
    }
    const refusal = precheckSql(
      text,
      new Set(allowed.flatMap((entry) => entry.tables.map((t) => t.sqlName))),
      new Set(catalog.sources.map((source) => source.sqlName)),
    );
    if (refusal) {
      // Refused here, as the job would: no job, but a run all the same, so
      // the editor, history and status read the same either way.
      const refused = await this.prisma.queryRun.create({
        data: {
          sql: text,
          status: QueryRunStatus.ERROR,
          actorRef: actor.ref ?? null,
          personRef: origin.personRef,
          channel: origin.channel,
          assetIds: [],
          sourceIds: [],
          error: { code: refusal.code, message: refusal.message },
          resultFormat: exportFormat ?? null,
          finishedAt: new Date(),
          expiresAt: new Date(Date.now() + RESULT_TTL_MS),
        },
      });
      return { view: this.view(refused), done: Promise.resolve() };
    }
    const mentioned = mentionedSourceNames(
      text,
      allowed.map((entry) => entry.source.sqlName),
    );
    const used = allowed.filter((entry) => mentioned.has(entry.source.sqlName));
    if (used.length > MAX_SOURCES_PER_QUERY) {
      throw new BadRequestException(
        `One query can read from at most ${MAX_SOURCES_PER_QUERY} sources.`,
      );
    }

    // Tables of the used sources, each carrying its source's SQL name so the
    // job request never re-derives it from `sqlName.split('.')`.
    const tablesWithSource: {
      entrySourceSqlName: string;
      table: CatalogTable;
    }[] = used.flatMap((entry) =>
      entry.tables.map((table) => ({
        entrySourceSqlName: entry.source.sqlName,
        table,
      })),
    );
    // Only names in executable code count: literals and comments are blanked
    // first, so `'shop.public.orders'` in a string neither attaches a source
    // (above) nor marks a table as read (here).
    const namesInCode = new Set(
      extractThreePartNames(stripLiteralsAndComments(text).toLowerCase()),
    );
    const tablesNamedInCode = tablesWithSource.filter(({ table }) =>
      namesInCode.has(table.sqlName),
    );
    const { run, done } = await this.launch({
      actor,
      origin,
      sql: text,
      used: used.map((entry) => entry.source),
      tables: tablesWithSource,
      namedAssetIds: tablesNamedInCode.map(({ table }) => table.assetId),
      maxRows: exportFormat ? settings.exportMaxRows : settings.maxRows,
      maxResultBytes: exportFormat ? MAX_EXPORT_BYTES : MAX_RESULT_BYTES,
      exportFormat,
      timeoutSeconds: settings.timeoutSeconds,
      ...(describe ? { describe: true, extra: { describe: true } } : {}),
    });
    return { view: this.view(run), done };
  }

  /**
   * A query from a SQL connection (docs/prd/DQ-data-query.md §5.7): SQL as a
   * PostgreSQL client wrote it, over the tables the gateway found it reads.
   * Runs in the context the gateway set up for the connection's person, so
   * the catalog already says what they may read through this connection;
   * a table outside it is refused here, and the job's gate refuses it again.
   * `done` settles once the job has ended (its result arrived, or it failed).
   */
  async createForConnection(input: {
    sql: string;
    tables: string[];
    database: string;
    searchPath: string[];
    maxRows: number;
  }): Promise<
    | { runId: string; done: Promise<void> }
    | { refused: { code: string; message: string; sqlState: string } }
  > {
    const actor = this.actors.current();
    const origin = runOrigin(actor);
    const atCap = await this.capRefusal(origin);
    if (atCap) {
      return {
        refused: {
          code: 'too_many_queries',
          sqlState: '53000',
          message: atCap,
        },
      };
    }
    const settings = await this.catalog.settings();
    const catalog = await this.catalog.catalog();
    const wanted = new Set(input.tables.map((name) => name.toLowerCase()));
    const used = catalog.sources
      .map((source) => ({
        source,
        tables: source.tables.filter(
          (t) => wanted.has(t.sqlName) && t.canQuery && t.location,
        ),
      }))
      .filter((entry) => entry.tables.length);
    const found = new Set(
      used.flatMap((entry) => entry.tables.map((t) => t.sqlName)),
    );
    const missing = [...wanted].filter((name) => !found.has(name));
    if (missing.length || !used.length) {
      return {
        refused: {
          code: 'table_not_available',
          sqlState: '42501',
          message: missing.length
            ? `You cannot query ${missing.join(', ')} through this connection.`
            : 'This statement reads no table.',
        },
      };
    }
    if (used.length > MAX_SOURCES_PER_QUERY) {
      return {
        refused: {
          code: 'too_many_sources',
          sqlState: '54000',
          message: `One query can read from at most ${MAX_SOURCES_PER_QUERY} sources.`,
        },
      };
    }
    const tables = used.flatMap((entry) =>
      entry.tables.map((table) => ({
        entrySourceSqlName: entry.source.sqlName,
        table,
      })),
    );
    const { run, done } = await this.launch({
      actor,
      origin,
      sql: input.sql,
      used: used.map((entry) => entry.source),
      tables,
      namedAssetIds: tables.map(({ table }) => table.assetId),
      maxRows: input.maxRows,
      maxResultBytes: MAX_EXPORT_BYTES,
      timeoutSeconds: settings.timeoutSeconds,
      extra: {
        dialect: 'postgres',
        database: input.database,
        searchPath: input.searchPath,
      },
    });
    return { runId: run.id, done };
  }

  /**
   * A connection's finished run, taken once: the Arrow bytes leave the
   * database as they are read, since a BI tool never asks for them again.
   */
  async takeConnectionResult(runId: string): Promise<{
    status: QueryRunStatus;
    error: { code: string; message: string } | null;
    arrow: Buffer | null;
    truncated: boolean;
  }> {
    const run = await this.prisma.queryRun.findUnique({
      where: { id: runId },
      select: { status: true, error: true, result: true, truncated: true },
    });
    if (!run) {
      return {
        status: QueryRunStatus.ERROR,
        error: { code: 'no_result', message: 'The query run is gone.' },
        arrow: null,
        truncated: false,
      };
    }
    if (run.result) {
      await this.prisma.queryRun
        .update({
          where: { id: runId },
          data: { result: null },
        })
        .catch(() => undefined);
    }
    return {
      status: run.status,
      error: (run.error as { code: string; message: string } | null) ?? null,
      arrow: run.result ? Buffer.from(run.result) : null,
      truncated: run.truncated,
    };
  }

  /** Stops a connection's run (a client's CancelRequest, a closed session). */
  async cancelConnectionRun(runId: string): Promise<void> {
    // Cancelled first, then the job stopped: the job's exit must not be
    // recorded as a failure before the cancel is.
    await this.prisma.queryRun
      .updateMany({
        where: { id: runId, status: { notIn: TERMINAL } },
        data: {
          status: QueryRunStatus.CANCELLED,
          finishedAt: new Date(),
          callbackTokenHash: null,
        },
      })
      .catch(() => undefined);
    await this.cliRunner.cancelQueryExecution(runId).catch(() => undefined);
  }

  /**
   * The workspace's key for `hash` masks. A person's run always has a
   * workspace; without one there is no key to give, rather than a key
   * every workspace would share.
   */
  private maskSalt(): string {
    const workspaceId = this.actors.workspaceId();
    if (!workspaceId) {
      throw new Error('A masked query needs its workspace for the hash key.');
    }
    return maskSalt(resolveApplicationSecretKey(), workspaceId);
  }

  /** Settle runs nothing will settle any more (see {@link LOST_AFTER_MS}). */
  private async expireLostRuns(): Promise<void> {
    await this.prisma.queryRun
      .updateMany({
        where: {
          status: { in: [QueryRunStatus.PENDING, QueryRunStatus.RUNNING] },
          createdAt: { lt: new Date(Date.now() - LOST_AFTER_MS) },
        },
        data: {
          status: QueryRunStatus.ERROR,
          error: {
            code: 'lost',
            message:
              'The query never finished: the service running it restarted. Run it again.',
          },
          finishedAt: new Date(),
          callbackTokenHash: null,
        },
      })
      .catch((error: unknown) =>
        this.logger.warn(
          `Could not settle lost query runs: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }

  private async activeRuns(origin: RunOrigin): Promise<number> {
    await this.expireLostRuns();
    return this.prisma.queryRun.count({
      where: {
        ...(origin.personRef
          ? { personRef: origin.personRef }
          : { actorRef: origin.actorRef }),
        status: { in: [QueryRunStatus.PENDING, QueryRunStatus.RUNNING] },
      },
    });
  }

  /**
   * One person's queries at once, whichever way they came (app, MCP, SQL
   * connection): the refusal text when the person is at the cap, else null.
   */
  private async capRefusal(origin: RunOrigin): Promise<string | null> {
    const active = await this.activeRuns(origin);
    return active >= MAX_ACTIVE_PER_ACTOR
      ? `You have ${active} queries running. Wait for one to finish or cancel it.`
      : null;
  }

  private async assertBelowCap(origin: RunOrigin): Promise<void> {
    const refusal = await this.capRefusal(origin);
    if (refusal) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'TOO_MANY_QUERIES',
        message: refusal,
      });
    }
  }

  /** Creates the run and starts its job: the part every person's query shares. */
  private async launch(input: {
    actor: Actor;
    origin: RunOrigin;
    sql: string;
    used: { id: string; sqlName: string; type?: string }[];
    tables: { entrySourceSqlName: string; table: CatalogTable }[];
    namedAssetIds: string[];
    maxRows: number;
    maxResultBytes: number;
    exportFormat?: ExportFormat;
    timeoutSeconds: number;
    /** Describe the SQL (columns and lineage) instead of running it. */
    describe?: boolean;
    extra?: Record<string, unknown>;
  }) {
    void this.purgeExpired().catch(() => undefined);
    const named = input.tables
      .map(({ table }) => table)
      .filter((table) => input.namedAssetIds.includes(table.assetId));

    // DQ §5.12: a shared dataset the SQL names is expanded into its SQL over
    // its inputs, read with its owning group's rights (checked now, on every
    // read). Its built-in source has nothing to attach.
    const datasetIds = named
      .filter((table) => table.location?.kind === 'dataset')
      .map((table) => table.assetId);
    let resolved: ResolvedDataset[] = [];
    if (datasetIds.length) {
      const expanded = await this.datasets.resolve(datasetIds);
      if ('refused' in expanded) {
        return this.refusedRun(input, expanded.refused);
      }
      resolved = expanded.datasets;
    }
    const attach = new Map<string, { id: string; sqlName: string }>();
    for (const source of input.used) {
      if (source.type !== SHARED_DATASET_SOURCE_TYPE) {
        attach.set(source.id, { id: source.id, sqlName: source.sqlName });
      }
    }
    for (const dataset of resolved) {
      for (const { source } of dataset.inputs) {
        attach.set(source.id, { id: source.id, sqlName: source.sqlName });
      }
    }
    if (attach.size > MAX_SOURCES_PER_QUERY) {
      return this.refusedRun(input, {
        code: 'too_many_sources',
        message: `One query can read from at most ${MAX_SOURCES_PER_QUERY} sources, shared datasets' tables included.`,
      });
    }
    const attached = [...attach.values()];
    const token = randomBytes(32).toString('base64url');
    // `assetIds` starts as the tables named in code and is replaced with the
    // job's authoritative table list on success (received in `receiveResult`);
    // per-table audit is recorded there, never here, so refusals and failures
    // audit nothing and successes audit exactly what was read.
    const run = await this.prisma.queryRun.create({
      data: {
        sql: input.sql,
        status: QueryRunStatus.PENDING,
        actorRef: input.actor.ref ?? null,
        personRef: input.origin.personRef,
        channel: input.origin.channel,
        connectionId: input.origin.connectionId,
        assetIds: input.namedAssetIds,
        sourceIds: attached.map((source) => source.id),
        masks: runMasksOf(named),
        rowFilters: runRowFiltersOf(named),
        callbackTokenHash: tokenHash(token),
        resultFormat: input.describe
          ? 'describe'
          : (input.exportFormat ?? null),
        ...(input.describe ? { purpose: 'describe' } : {}),
        expiresAt: new Date(Date.now() + RESULT_TTL_MS),
      },
    });

    const sources = await this.prisma.source.findMany({
      where: { id: { in: attached.map((source) => source.id) } },
      select: { id: true, type: true, config: true },
    });
    const recipes = new Map(
      sources.map((source) => {
        const config = this.crypto.decryptMaskedConfig(
          (source.config ?? {}) as Record<string, unknown>,
        );
        return [source.id, { ...config, type: config.type ?? source.type }];
      }),
    );
    const request = {
      runId: run.id,
      sql: input.sql,
      maxRows: input.maxRows,
      maxResultBytes: input.maxResultBytes,
      ...(input.exportFormat ? { exportFormat: input.exportFormat } : {}),
      ...(input.extra ?? {}),
      timeoutSeconds: input.timeoutSeconds,
      callbackUrl: `${this.cliRunner.queryCallbackBaseUrl(this.actors.workspaceId())}/query-runs/${run.id}/result`,
      callbackToken: token,
      sources: attached.map((source) => ({
        alias: source.sqlName,
        sourceId: source.id,
        recipe: recipes.get(source.id),
      })),
      tables: input.tables
        .map(({ entrySourceSqlName, table }) => {
          const dataset = resolved.find((d) => d.assetId === table.assetId);
          if (dataset) {
            return {
              ...tableEntry(entrySourceSqlName, table, dataset.columns),
              dataset: {
                sql: dataset.sql,
                inputs: dataset.inputs.map((i) =>
                  tableEntry(i.source.sqlName, i.table),
                ),
              },
            };
          }
          if (table.location?.kind === 'dataset') {
            // Not named in the SQL: nothing to expand, nothing to read.
            return null;
          }
          return tableEntry(entrySourceSqlName, table);
        })
        .filter((entry) => entry !== null),
      ...(input.tables.some(({ table }) => table.masks?.length) ||
      resolved.some((d) => d.inputs.some((i) => i.table.masks?.length))
        ? {
            maskSalt: this.maskSalt(),
          }
        : {}),
    };

    // Settles once the job has ended: its result arrived, or it failed.
    const done = this.execute(run.id, request, input.timeoutSeconds);
    return { run, done };
  }

  /** A run refused before any job (a dataset that cannot be read now). */
  private async refusedRun(
    input: {
      actor: Actor;
      origin: RunOrigin;
      sql: string;
      exportFormat?: ExportFormat;
      describe?: boolean;
    },
    refusal: { code: string; message: string },
  ) {
    const run = await this.prisma.queryRun.create({
      data: {
        sql: input.sql,
        status: QueryRunStatus.ERROR,
        actorRef: input.actor.ref ?? null,
        personRef: input.origin.personRef,
        channel: input.origin.channel,
        connectionId: input.origin.connectionId,
        assetIds: [],
        sourceIds: [],
        error: refusal,
        resultFormat: input.describe
          ? 'describe'
          : (input.exportFormat ?? null),
        ...(input.describe ? { purpose: 'describe' } : {}),
        finishedAt: new Date(),
        expiresAt: new Date(Date.now() + RESULT_TTL_MS),
      },
    });
    return { run, done: Promise.resolve() };
  }

  /**
   * A query the platform runs itself, over one table, for a purpose such as
   * measuring quality rules (docs/prd/GOV-governed-data-assets.md §5.4). No
   * person's grants apply: the caller decided this table may be measured.
   * The result is CSV; `onDone` gets the run once the job has ended (its
   * result arrived, or it failed). At most `MAX_ACTIVE_SYSTEM` run at once
   * per workspace; beyond that it is refused, and the caller retries later.
   */
  async createSystem(input: {
    assetId: string;
    sql: string;
    purpose: 'quality';
    actorRef: string;
    onDone: (runId: string) => Promise<void>;
  }): Promise<{ runId: string } | { refused: string; busy?: boolean }> {
    const cached = await this.catalog.tables();
    const table = cached.tables.find((t) => t.assetId === input.assetId);
    if (!table) return { refused: 'This asset is not a table SQL can read.' };
    if (!table.queryable || !table.location) {
      return {
        refused: table.reason ?? 'This table cannot be read with SQL.',
      };
    }
    const source = cached.sources.find((s) => s.id === table.sourceId);
    if (!source) return { refused: 'The table has no source.' };
    await this.expireLostRuns();
    const active = await this.prisma.queryRun.count({
      where: {
        purpose: input.purpose,
        status: { in: [QueryRunStatus.PENDING, QueryRunStatus.RUNNING] },
      },
    });
    if (active >= MAX_ACTIVE_SYSTEM) {
      return {
        refused: `${active} quality queries are already running here; this one runs next time.`,
        busy: true,
      };
    }
    // A shared dataset (§5.12) is measured as its owning group reads it.
    let dataset: ResolvedDataset | null = null;
    if (table.location.kind === 'dataset') {
      const expanded = await this.datasets.resolve([table.assetId]);
      if ('refused' in expanded) return { refused: expanded.refused.message };
      dataset = expanded.datasets[0] ?? null;
      if (!dataset)
        return { refused: 'This shared dataset has no definition.' };
    }
    const settings = await this.catalog.settings();
    const token = randomBytes(32).toString('base64url');
    const run = await this.prisma.queryRun.create({
      data: {
        sql: input.sql,
        status: QueryRunStatus.PENDING,
        actorRef: input.actorRef,
        purpose: input.purpose,
        assetIds: [table.assetId],
        sourceIds: [source.id],
        callbackTokenHash: tokenHash(token),
        resultFormat: 'csv',
        expiresAt: new Date(Date.now() + RESULT_TTL_MS),
      },
    });
    const attach = dataset
      ? [
          ...new Map(
            dataset.inputs.map((i) => [i.source.id, i.source.sqlName]),
          ),
        ].map(([id, sqlName]) => ({ id, sqlName }))
      : [{ id: source.id, sqlName: source.sqlName }];
    const rows = await this.prisma.source.findMany({
      where: { id: { in: attach.map((a) => a.id) } },
      select: { id: true, type: true, config: true },
    });
    const recipeOf = (id: string) => {
      const row = rows.find((r) => r.id === id);
      const config = this.crypto.decryptMaskedConfig(
        (row?.config ?? {}) as Record<string, unknown>,
      );
      return { ...config, type: config.type ?? row?.type };
    };
    const request = {
      runId: run.id,
      sql: input.sql,
      maxRows: 10,
      maxResultBytes: MAX_RESULT_BYTES,
      exportFormat: 'csv',
      timeoutSeconds: settings.timeoutSeconds,
      callbackUrl: `${this.cliRunner.queryCallbackBaseUrl(this.actors.workspaceId())}/query-runs/${run.id}/result`,
      callbackToken: token,
      sources: attach.map((a) => ({
        alias: a.sqlName,
        sourceId: a.id,
        recipe: recipeOf(a.id),
      })),
      tables: [
        dataset
          ? {
              source: source.sqlName,
              schema: table.schema,
              table: table.table,
              assetId: table.assetId,
              location: table.location,
              knownColumns: dataset.columns,
              dataset: {
                sql: dataset.sql,
                inputs: dataset.inputs.map((i) =>
                  tableEntry(i.source.sqlName, i.table),
                ),
              },
            }
          : {
              source: source.sqlName,
              schema: table.schema,
              table: table.table,
              assetId: table.assetId,
              location: table.location,
            },
      ],
      ...(dataset?.inputs.some((i) => i.table.masks?.length)
        ? { maskSalt: this.maskSalt() }
        : {}),
    };
    void this.execute(run.id, request, settings.timeoutSeconds).then(() =>
      input
        .onDone(run.id)
        .catch((error: unknown) =>
          this.logger.warn(
            `After system query ${run.id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ),
    );
    return { runId: run.id };
  }

  /** The SQL name of a table (`source.schema.table`), or null when SQL cannot read it. */
  async tableName(assetId: string): Promise<string | null> {
    const cached = await this.catalog.tables();
    const table = cached.tables.find((t) => t.assetId === assetId);
    return table?.queryable && table.location ? table.sqlName : null;
  }

  /** A finished system run: its status, error and CSV text. */
  async systemResult(runId: string): Promise<{
    status: QueryRunStatus;
    error: string | null;
    csv: string | null;
  }> {
    const run = await this.prisma.queryRun.findUnique({
      where: { id: runId },
      select: { status: true, error: true, result: true },
    });
    if (!run)
      return {
        status: QueryRunStatus.ERROR,
        error: 'Run not found.',
        csv: null,
      };
    const error = run.error as { message?: string } | null;
    return {
      status: run.status,
      error: error?.message ?? null,
      csv: run.result ? Buffer.from(run.result).toString('utf8') : null,
    };
  }

  private async execute(
    runId: string,
    request: Record<string, unknown>,
    timeoutSeconds: number,
  ): Promise<void> {
    try {
      await this.prisma.queryRun.update({
        where: { id: runId },
        data: { status: QueryRunStatus.RUNNING, startedAt: new Date() },
      });
      const { output, exitCode } = await this.cliRunner.runQueryExecution({
        runId,
        request,
        timeoutSeconds,
        onJobCreated: async ({ jobName, namespace }) => {
          await this.prisma.queryRun.update({
            where: { id: runId },
            data: { jobName, jobNamespace: namespace },
          });
        },
      });
      await this.settleFromOutput(runId, output, exitCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Query run ${runId} failed to start: ${message}`);
      await this.fail(runId, 'job_failed', message);
    }
  }

  /**
   * The job has ended. When its callback already settled the run there is
   * nothing to do; otherwise the printed status line says what happened.
   */
  private async settleFromOutput(
    runId: string,
    output: string,
    exitCode: number,
  ): Promise<void> {
    const run = await this.prisma.queryRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (!run || TERMINAL.includes(run.status)) return;
    const line = output
      .split('\n')
      .reverse()
      .find((l) => l.startsWith(RESULT_MARKER));
    let meta: QueryCallbackMeta | null = null;
    if (line) {
      try {
        meta = JSON.parse(line.slice(RESULT_MARKER.length).trim());
      } catch {
        meta = null;
      }
    }
    if (meta?.status === 'error') {
      await this.fail(
        runId,
        meta.error?.code ?? 'execution_error',
        meta.error?.message ?? 'The query failed.',
      );
      return;
    }
    await this.fail(
      runId,
      'no_result',
      exitCode === 0
        ? 'The query finished but its result never reached the API.'
        : `The query job ended with exit code ${exitCode}${
            /OOMKilled/.test(output) ? ' (out of memory)' : ''
          }.`,
    );
  }

  private async fail(runId: string, code: string, message: string) {
    await this.prisma.queryRun
      .updateMany({
        where: { id: runId, status: { notIn: TERMINAL } },
        data: {
          status:
            code === 'timeout' ? QueryRunStatus.TIMEOUT : QueryRunStatus.ERROR,
          error: { code, message: message.slice(0, 4000) },
          finishedAt: new Date(),
          callbackTokenHash: null,
        },
      })
      .catch(() => undefined);
  }

  /** The job's callback: an Arrow stream on success, JSON on failure. */
  async receiveResult(
    runId: string,
    token: string | undefined,
    body: Buffer | Record<string, unknown> | undefined,
    metaHeader: string | undefined,
  ): Promise<void> {
    const run = await this.prisma.queryRun.findUnique({
      where: { id: runId },
      select: {
        callbackTokenHash: true,
        status: true,
        sourceIds: true,
        actorRef: true,
        resultFormat: true,
        purpose: true,
        channel: true,
        connectionId: true,
      },
    });
    const expected = run?.callbackTokenHash;
    const given = token ? tokenHash(token) : '';
    if (
      !run ||
      !expected ||
      expected.length !== given.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(given))
    ) {
      throw new UnauthorizedException('Unknown query run or token.');
    }
    if (TERMINAL.includes(run.status)) return;

    if (
      !Buffer.isBuffer(body) &&
      body?.status === 'success' &&
      body.format === 'describe'
    ) {
      // A describe (§5.12): columns and lineage, no rows, nothing read.
      const meta = body as QueryCallbackMeta;
      const description: QueryDescription = {
        columns: meta.describe?.columns ?? meta.columns ?? [],
        lineage: meta.describe?.lineage ?? [],
        tables: (meta.tables ?? []).map((t) => t.toLowerCase()),
      };
      const bytes = Buffer.from(JSON.stringify(description), 'utf8');
      await this.prisma.queryRun.update({
        where: { id: runId },
        data: {
          status: QueryRunStatus.SUCCESS,
          result: new Uint8Array(bytes),
          resultBytes: bytes.length,
          rowCount: 0,
          columns: description.columns,
          timings: meta.timings ?? {},
          finishedAt: new Date(),
          callbackTokenHash: null,
        },
      });
      return;
    }

    if (Buffer.isBuffer(body)) {
      let meta: QueryCallbackMeta = {};
      try {
        meta = metaHeader
          ? JSON.parse(Buffer.from(metaHeader, 'base64').toString('utf8'))
          : {};
      } catch {
        meta = {};
      }
      const tables = (meta.tables ?? []).map((t) => t.toLowerCase());
      const assetIds = tables.length
        ? await this.assetIdsFor(tables)
        : undefined;
      await this.prisma.queryRun.update({
        where: { id: runId },
        data: {
          status: QueryRunStatus.SUCCESS,
          result: new Uint8Array(body),
          resultBytes: body.length,
          rowCount: meta.rowCount ?? null,
          truncated: Boolean(meta.truncated),
          truncatedReason: meta.truncatedReason ?? null,
          columns: meta.columns ?? [],
          timings: meta.timings ?? {},
          ...(scanStatsOf(meta.scans).length
            ? {
                scanStats: scanStatsOf(
                  meta.scans,
                ) as unknown as Prisma.InputJsonValue,
              }
            : {}),
          ...(assetIds ? { assetIds } : {}),
          finishedAt: new Date(),
          callbackTokenHash: null,
        },
      });
      // R6: audit exactly the tables the job validated and read, attributed
      // to the run's actor. Refusals and failures read nothing, so they
      // record no per-table event; the run row itself keeps the attribution.
      // The SQL name goes along (`shop_lake.shop.orders`), so the trail
      // reads without resolving asset ids — and the per-table tab filters
      // on names, not just ids.
      if (assetIds?.length && run.actorRef) {
        const channel = asAuditChannel(run.channel);
        const actor: Actor = {
          id: null,
          displayName: null,
          kind: run.purpose ? 'system' : 'person',
          via: run.purpose ? 'none' : viaOfChannel(channel),
          ref: run.actorRef,
        };
        const tables = await this.tablesFor(assetIds);
        // A system measurement is not a person's export: it reads as itself,
        // and stays out of the table's usage (GOV §5.3).
        const isExport = Boolean(run.resultFormat) && !run.purpose;
        for (const assetId of assetIds) {
          void this.audit.record({
            actor,
            channel,
            capability: isExport ? 'data.export' : 'data.query',
            operation: run.purpose
              ? `${run.purpose}.read-table`
              : isExport
                ? `query-runs.export-table.${run.resultFormat}`
                : 'query-runs.read-table',
            entityType: 'asset',
            entityId: assetId,
            entityName: tables.get(assetId)?.sqlName ?? null,
            resources: tableReadResources({
              assetId,
              sourceId: tables.get(assetId)?.sourceId,
              connectionId: run.connectionId,
            }),
            fields: [],
          });
        }
        if (!run.purpose) {
          await this.auditDatasetInputs(assetIds, {
            actor,
            channel,
            isExport,
            format: run.resultFormat,
            connectionId: run.connectionId,
          });
        }
      }
      return;
    }
    const error = (body?.error ?? {}) as { code?: string; message?: string };
    await this.fail(
      runId,
      error.code ?? 'execution_error',
      error.message ?? 'The query failed.',
    );
  }

  /**
   * A read of a shared dataset reached its inputs (§5.12): one event per
   * input, tagged with the dataset, so the input's owner sees who received
   * their data and through which dataset.
   */
  private async auditDatasetInputs(
    assetIds: string[],
    context: {
      actor: Actor;
      channel: AuditChannel;
      isExport: boolean;
      format: string | null;
      connectionId: string | null;
    },
  ): Promise<void> {
    const datasets = await this.prisma.sharedDataset.findMany({
      where: { assetId: { in: assetIds } },
      select: { assetId: true, inputs: true, domain: true, name: true },
    });
    if (!datasets.length) return;
    const tables = await this.tablesFor(datasets.flatMap((d) => d.inputs));
    for (const dataset of datasets) {
      const via = `shared.${dataset.domain}.${dataset.name}`;
      for (const inputId of dataset.inputs) {
        void this.audit.record({
          actor: context.actor,
          channel: context.channel,
          capability: context.isExport ? 'data.export' : 'data.query',
          operation: context.isExport
            ? `query-runs.export-table.${context.format}`
            : 'query-runs.read-table',
          entityType: 'asset',
          entityId: inputId,
          entityName: tables.get(inputId)?.sqlName ?? null,
          resources: [
            ...tableReadResources({
              assetId: inputId,
              sourceId: tables.get(inputId)?.sourceId,
              connectionId: context.connectionId,
            }),
            datasetResource(dataset.assetId),
          ],
          fields: [],
          changes: [{ field: 'via', to: via }],
        });
      }
    }
  }

  private async assetIdsFor(sqlNames: string[]): Promise<string[]> {
    const { tables } = await this.catalog.tables();
    const wanted = new Set(sqlNames);
    return tables.filter((t) => wanted.has(t.sqlName)).map((t) => t.assetId);
  }

  /** SQL name and source of each table read, for its audit row. */
  private async tablesFor(
    assetIds: string[],
  ): Promise<Map<string, { sqlName: string; sourceId: string }>> {
    const { tables } = await this.catalog.tables();
    const wanted = new Set(assetIds);
    return new Map(
      tables
        .filter((t) => wanted.has(t.assetId))
        .map((t) => [t.assetId, { sqlName: t.sqlName, sourceId: t.sourceId }]),
    );
  }

  async get(runId: string): Promise<QueryRunView> {
    return this.view(await this.own(runId));
  }

  /** The bytes of a finished run: Arrow, or the exported file. */
  async result(
    runId: string,
  ): Promise<{ bytes: Buffer; format: string | null; createdAt: Date }> {
    const run = await this.own(runId);
    if (run.status !== QueryRunStatus.SUCCESS || !run.result) {
      throw new NotFoundException('This run has no result.');
    }
    return {
      bytes: Buffer.from(run.result),
      format: run.resultFormat,
      createdAt: run.createdAt,
    };
  }

  async list(limit = 20): Promise<QueryRunView[]> {
    const runs = await this.prisma.queryRun.findMany({
      // A person's own queries: describes (§5.12) and system runs are not history.
      where: { actorRef: this.actors.current().ref ?? null, purpose: null },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        sql: true,
        status: true,
        actorRef: true,
        assetIds: true,
        rowCount: true,
        truncated: true,
        truncatedReason: true,
        columns: true,
        masks: true,
        rowFilters: true,
        timings: true,
        scanStats: true,
        error: true,
        resultBytes: true,
        resultFormat: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    return runs.map((run) => this.view(run));
  }

  async cancel(runId: string): Promise<QueryRunView> {
    const run = await this.own(runId);
    if (TERMINAL.includes(run.status)) return this.view(run);
    await this.cliRunner.cancelQueryExecution(runId).catch(() => undefined);
    const updated = await this.prisma.queryRun.update({
      where: { id: runId },
      data: {
        status: QueryRunStatus.CANCELLED,
        finishedAt: new Date(),
        callbackTokenHash: null,
      },
    });
    return this.view(updated);
  }

  /** Drop expired results; called by the scheduler. */
  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.queryRun.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  }

  /** A run of the current actor; anyone else's answers 404. */
  private async own(runId: string) {
    const run = await this.prisma.queryRun.findUnique({ where: { id: runId } });
    if (!run || run.actorRef !== (this.actors.current().ref ?? null)) {
      throw new NotFoundException('No such query run.');
    }
    return run;
  }

  private view(run: {
    id: string;
    sql: string;
    status: QueryRunStatus;
    actorRef: string | null;
    assetIds: string[];
    rowCount: number | null;
    truncated: boolean;
    truncatedReason: string | null;
    columns: Prisma.JsonValue;
    masks: Prisma.JsonValue;
    rowFilters: Prisma.JsonValue;
    timings: Prisma.JsonValue;
    scanStats: Prisma.JsonValue;
    error: Prisma.JsonValue;
    resultBytes: number | null;
    resultFormat: string | null;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  }): QueryRunView {
    return {
      id: run.id,
      sql: run.sql,
      status: run.status,
      actorRef: run.actorRef,
      assetIds: run.assetIds ?? [],
      rowCount: run.rowCount,
      truncated: run.truncated,
      truncatedReason: run.truncatedReason,
      columns: (run.columns as QueryRunView['columns']) ?? null,
      masks: parseRunMasks(run.masks),
      rowFilters: parseRunRowFilters(run.rowFilters),
      timings: (run.timings as QueryRunView['timings']) ?? null,
      scans: scanStatsOf(run.scanStats),
      error: (run.error as QueryRunView['error']) ?? null,
      resultBytes: run.resultBytes,
      resultFormat: run.resultFormat,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };
  }
}
