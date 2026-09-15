import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RunnerStatus } from '@prisma/client';

import {
  metadataPredicateSql,
  parseMetadataPath,
  parseMetadataWhere,
} from '../assets/asset-metadata-predicate';
import { PrismaService } from '../prisma.service';

/** Calls one run may make. A connector pages a cohort, it does not poll. */
export const ASSET_QUERY_CALLS_PER_RUN = 100;
export const ASSET_QUERY_MAX_LIMIT = 5000;
export const ASSET_QUERY_DEFAULT_LIMIT = 1000;
export const ASSET_QUERY_MAX_SELECT = 20;
/**
 * Long enough for a cohort over the largest source measured (110k records,
 * 2.8 s with the anti-join), short enough that a bad query cannot hold a
 * connection for the rest of the run. Spelled out again in the SET statement.
 */
export const ASSET_QUERY_STATEMENT_TIMEOUT = '15s';

export interface RunnerAssetQueryItem {
  assetHash: string;
  externalId: string | null;
  name: string;
  kind: string;
  url: string;
  metadata: Record<string, unknown>;
}

export interface RunnerAssetQueryResponse {
  items: RunnerAssetQueryItem[];
  nextCursor: string | null;
  callsRemaining: number;
}

interface QueryInput {
  source: string;
  kind: string | null;
  where: ReturnType<typeof parseMetadataWhere>;
  excludeVisited: { path: string[]; sinceDays: number } | null;
  select: Array<{ key: string; path: string[] }>;
  limit: number;
  cursor: string | null;
}

/**
 * What a running connector may read of the namespace it writes to.
 *
 * `ctx.query_assets()` in a CUSTOM notebook lands here, through the parent CLI
 * process that holds the internal key — the notebook itself never sees the API.
 * Read-only, scoped to one source, bounded in rows, time and calls, and only
 * for a run that is actually RUNNING, so a finished job's credentials cannot be
 * replayed to read the namespace later.
 */
@Injectable()
export class RunnerAssetQueryService {
  private readonly callsByRunner = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async query(
    runnerId: string,
    body: unknown,
  ): Promise<RunnerAssetQueryResponse> {
    const input = parseInput(body);

    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: { id: true, status: true, sourceId: true },
    });
    if (!runner) throw new NotFoundException(`Runner ${runnerId} not found`);
    if (runner.status !== RunnerStatus.RUNNING) {
      throw new ConflictException(
        `Assets can be queried only while the run is RUNNING (it is ${runner.status}).`,
      );
    }

    const calls = (this.callsByRunner.get(runnerId) ?? 0) + 1;
    if (calls > ASSET_QUERY_CALLS_PER_RUN) {
      throw new HttpException(
        `This run has used its ${ASSET_QUERY_CALLS_PER_RUN} asset queries. ` +
          'Page with a larger limit rather than more calls.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.remember(runnerId, calls);

    const target = await this.resolveSource(input.source);
    const rows = await this.run(target.id, runner.sourceId, input);
    const page = rows.slice(0, input.limit);
    return {
      items: page.map((row) => ({
        assetHash: row.hash,
        externalId: row.externalId,
        name: row.name,
        kind: row.kind,
        url: row.url,
        metadata: row.selected ?? {},
      })),
      nextCursor:
        rows.length > input.limit ? (page[page.length - 1]?.id ?? null) : null,
      callsRemaining: ASSET_QUERY_CALLS_PER_RUN - calls,
    };
  }

  private remember(runnerId: string, calls: number): void {
    // Bounded: the counter only needs to outlive one run, and a long-lived
    // API process sees many.
    if (!this.callsByRunner.has(runnerId) && this.callsByRunner.size >= 1000) {
      const oldest = this.callsByRunner.keys().next().value;
      if (oldest !== undefined) this.callsByRunner.delete(oldest);
    }
    this.callsByRunner.set(runnerId, calls);
  }

  private async resolveSource(
    source: string,
  ): Promise<{ id: string; name: string }> {
    const matches = await this.prisma.source.findMany({
      where: { OR: [{ id: source }, { name: source }] },
      select: { id: true, name: true },
      take: 2,
    });
    const byId = matches.find((match) => match.id === source);
    if (byId) return byId;
    if (matches.length > 1) {
      throw new BadRequestException(
        `More than one source is named ${JSON.stringify(source)}; pass its id.`,
      );
    }
    if (matches.length === 0) {
      throw new NotFoundException(
        `No source ${JSON.stringify(source)} in this namespace.`,
      );
    }
    return matches[0];
  }

  private async run(
    targetSourceId: string,
    callingSourceId: string,
    input: QueryInput,
  ): Promise<
    Array<{
      id: string;
      hash: string;
      name: string;
      kind: string;
      url: string;
      externalId: string | null;
      selected: Record<string, unknown> | null;
    }>
  > {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`a.source_id = ${targetSourceId}`,
      Prisma.sql`a.status <> 'DELETED'::"AssetStatus"`,
    ];
    if (input.kind) conditions.push(Prisma.sql`a.asset_type = ${input.kind}`);
    if (input.cursor) conditions.push(Prisma.sql`a.id > ${input.cursor}`);
    if (input.where.length > 0) {
      conditions.push(metadataPredicateSql(input.where, 'a'));
    }
    if (input.excludeVisited) {
      // Text on both sides: `#>>`, not `#>`, so the anti-join hashes a short
      // string instead of comparing jsonb values.
      const { path, sinceDays } = input.excludeVisited;
      conditions.push(Prisma.sql`NOT EXISTS (
        SELECT 1 FROM assets v
        WHERE v.source_id = ${callingSourceId}
          AND v.last_scanned_at >= now() - make_interval(days => ${sinceDays})
          AND (v.metadata #>> ${path}::text[]) = (a.metadata #>> ${path}::text[])
      )`);
    }
    const selected =
      input.select.length > 0
        ? Prisma.sql`jsonb_build_object(${Prisma.join(
            input.select.map(
              ({ key, path }) =>
                Prisma.sql`${key}::text, a.metadata #> ${path}::text[]`,
            ),
          )})`
        : Prisma.sql`NULL::jsonb`;

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // SET takes no bind parameters, hence literals (see the constant).
          await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
          // Row estimates for predicates inside jsonb are guesses — 1 row
          // estimated, 28,162 actual, measured on firmenbuch-test-2 — and with
          // that guess the planner anti-joined through a nested loop over a
          // materialized copy of the calling source: 40 s. Without nested
          // loops the same query is a parallel hash anti-join in 2.8 s.
          await tx.$executeRaw`SET LOCAL enable_nestloop = off`;
          return tx.$queryRaw<
            Array<{
              id: string;
              hash: string;
              name: string;
              kind: string;
              url: string;
              externalId: string | null;
              selected: Record<string, unknown> | null;
            }>
          >`
          SELECT a.id, a.hash, a.name, a.asset_type AS kind,
                 a.external_url AS url,
                 a.metadata ->> 'external_id' AS "externalId",
                 ${selected} AS selected
          FROM assets a
          WHERE ${Prisma.join(conditions, ' AND ')}
          ORDER BY a.id
          LIMIT ${input.limit + 1}
        `;
        },
        // Above the statement timeout, so Postgres reports a slow query as a
        // timeout instead of Prisma closing the transaction first (P2028).
        { timeout: 20_000, maxWait: 5_000 },
      );
    } catch (error) {
      if (isStatementTimeout(error)) {
        throw new BadRequestException(
          `The asset query ran past ${ASSET_QUERY_STATEMENT_TIMEOUT}. Narrow it: ` +
            'set kind, add where conditions, or lower the limit.',
        );
      }
      throw error;
    }
  }
}

function isStatementTimeout(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`
      : String(error);
  return text.includes('57014') || /statement timeout/i.test(text);
}

function parseInput(body: unknown): QueryInput {
  const raw =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const source = typeof raw.source === 'string' ? raw.source.trim() : '';
  if (!source) {
    throw new BadRequestException(
      'source is required: the id or name of the source whose assets to read.',
    );
  }

  let kind: string | null = null;
  if (raw.kind !== undefined && raw.kind !== null) {
    if (typeof raw.kind !== 'string' || !/^[a-z0-9_-]{1,50}$/i.test(raw.kind)) {
      throw new BadRequestException(
        'kind must be an asset kind like "record".',
      );
    }
    kind = raw.kind.toLowerCase();
  }

  let excludeVisited: QueryInput['excludeVisited'] = null;
  if (raw.excludeVisited !== undefined && raw.excludeVisited !== null) {
    const visited = raw.excludeVisited as Record<string, unknown>;
    const sinceDays = Number(visited?.sinceDays);
    if (
      typeof visited !== 'object' ||
      typeof visited.key !== 'string' ||
      !Number.isInteger(sinceDays) ||
      sinceDays < 1 ||
      sinceDays > 3650
    ) {
      throw new BadRequestException(
        'excludeVisited must be {"key": "<metadata key>", "sinceDays": 1..3650}.',
      );
    }
    excludeVisited = { path: parseMetadataPath(visited.key), sinceDays };
  }

  const selectRaw = raw.select ?? [];
  if (
    !Array.isArray(selectRaw) ||
    selectRaw.length > ASSET_QUERY_MAX_SELECT ||
    selectRaw.some((key) => typeof key !== 'string')
  ) {
    throw new BadRequestException(
      `select must be at most ${ASSET_QUERY_MAX_SELECT} metadata keys.`,
    );
  }
  const select = [...new Set(selectRaw as string[])].map((key) => {
    const path = parseMetadataPath(key);
    return { key: path.join('.'), path };
  });

  const limit =
    raw.limit === undefined || raw.limit === null
      ? ASSET_QUERY_DEFAULT_LIMIT
      : Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > ASSET_QUERY_MAX_LIMIT) {
    throw new BadRequestException(
      `limit must be an integer from 1 to ${ASSET_QUERY_MAX_LIMIT}.`,
    );
  }

  let cursor: string | null = null;
  if (raw.cursor !== undefined && raw.cursor !== null) {
    if (typeof raw.cursor !== 'string' || raw.cursor.length > 200) {
      throw new BadRequestException(
        'cursor must be the nextCursor of a previous page.',
      );
    }
    cursor = raw.cursor;
  }

  return {
    source,
    kind,
    where: parseMetadataWhere(raw.where),
    excludeVisited,
    select,
    limit,
    cursor,
  };
}
