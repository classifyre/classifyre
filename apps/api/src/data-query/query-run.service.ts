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
import { PrismaService } from '../prisma.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { ActorContextService } from '../identity/actor-context.service';
import { AuditTrailService } from '../identity/audit-trail.service';
import {
  QueryCatalogService,
  type CatalogTable,
} from './query-catalog.service';
import { mentionedSourceNames } from './sql-names';
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
/** Queries one person may have waiting or running at once. */
const MAX_ACTIVE_PER_ACTOR = 3;
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
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
  timings: Record<string, number> | null;
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
  error?: { code?: string; message?: string };
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
  ) {}

  async create(sql: string, format?: string): Promise<QueryRunView> {
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
    const active = await this.prisma.queryRun.count({
      where: {
        actorRef: actor.ref ?? null,
        status: { in: [QueryRunStatus.PENDING, QueryRunStatus.RUNNING] },
      },
    });
    if (active >= MAX_ACTIVE_PER_ACTOR) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'TOO_MANY_QUERIES',
        message: `You have ${active} queries running. Wait for one to finish or cancel it.`,
      });
    }

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
          assetIds: [],
          sourceIds: [],
          error: { code: refusal.code, message: refusal.message },
          resultFormat: exportFormat ?? null,
          finishedAt: new Date(),
          expiresAt: new Date(Date.now() + RESULT_TTL_MS),
        },
      });
      return this.view(refused);
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
    void this.purgeExpired().catch(() => undefined);
    const token = randomBytes(32).toString('base64url');
    // `assetIds` starts as the tables named in code and is replaced with the
    // job's authoritative table list on success (received in `receiveResult`);
    // per-table audit is recorded there, never here, so refusals and failures
    // audit nothing and successes audit exactly what was read.
    const run = await this.prisma.queryRun.create({
      data: {
        sql: text,
        status: QueryRunStatus.PENDING,
        actorRef: actor.ref ?? null,
        assetIds: tablesNamedInCode.map(({ table }) => table.assetId),
        sourceIds: used.map((entry) => entry.source.id),
        callbackTokenHash: tokenHash(token),
        resultFormat: exportFormat ?? null,
        expiresAt: new Date(Date.now() + RESULT_TTL_MS),
      },
    });

    const sources = await this.prisma.source.findMany({
      where: { id: { in: used.map((entry) => entry.source.id) } },
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
      sql: text,
      maxRows: exportFormat ? settings.exportMaxRows : settings.maxRows,
      maxResultBytes: exportFormat ? MAX_EXPORT_BYTES : MAX_RESULT_BYTES,
      ...(exportFormat ? { exportFormat } : {}),
      timeoutSeconds: settings.timeoutSeconds,
      callbackUrl: `${this.cliRunner.queryCallbackBaseUrl(this.actors.workspaceId())}/query-runs/${run.id}/result`,
      callbackToken: token,
      sources: used.map((entry) => ({
        alias: entry.source.sqlName,
        sourceId: entry.source.id,
        recipe: recipes.get(entry.source.id),
      })),
      tables: tablesWithSource.map(({ entrySourceSqlName, table }) => ({
        source: entrySourceSqlName,
        schema: table.schema,
        table: table.table,
        assetId: table.assetId,
        location: table.location,
      })),
    };

    void this.execute(run.id, request, settings.timeoutSeconds);
    return this.view(run);
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
        const actor = {
          id: null,
          displayName: null,
          kind: 'person' as const,
          via: 'none' as const,
          ref: run.actorRef,
        };
        const names = await this.sqlNamesFor(assetIds);
        const isExport = Boolean(run.resultFormat);
        for (const assetId of assetIds) {
          void this.audit.record({
            actor,
            channel: 'rest',
            capability: isExport ? 'data.export' : 'data.query',
            operation: isExport
              ? `query-runs.export-table.${run.resultFormat}`
              : 'query-runs.read-table',
            entityType: 'asset',
            entityId: assetId,
            entityName: names.get(assetId) ?? null,
            fields: [],
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

  private async assetIdsFor(sqlNames: string[]): Promise<string[]> {
    const { tables } = await this.catalog.tables();
    const wanted = new Set(sqlNames);
    return tables.filter((t) => wanted.has(t.sqlName)).map((t) => t.assetId);
  }

  private async sqlNamesFor(assetIds: string[]): Promise<Map<string, string>> {
    const { tables } = await this.catalog.tables();
    const wanted = new Set(assetIds);
    return new Map(
      tables.filter((t) => wanted.has(t.assetId)).map((t) => [t.assetId, t.sqlName]),
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
      where: { actorRef: this.actors.current().ref ?? null },
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
        timings: true,
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
    timings: Prisma.JsonValue;
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
      timings: (run.timings as QueryRunView['timings']) ?? null,
      error: (run.error as QueryRunView['error']) ?? null,
      resultBytes: run.resultBytes,
      resultFormat: run.resultFormat,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };
  }
}
