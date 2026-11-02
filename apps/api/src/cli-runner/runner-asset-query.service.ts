import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  metadataPredicateSql,
  parseMetadataPath,
  parseMetadataWhere,
} from '../assets/asset-metadata-predicate';
import { SemanticSearchMode } from '../dto/search-findings-request.dto';
import { EmbeddingService } from '../embedding/embedding.service';
import { fuseHybridRanks } from '../embedding/hybrid-rank';
import { QueryEmbeddingService } from '../embedding/query-embedding.service';
import { PrismaService } from '../prisma.service';
import {
  assertKnownTermKeys,
  ensureTermSnapshot,
  resolveTermKeys,
} from '../semantic/term-snapshot';
import {
  boundedRead,
  findingConditions,
  parseFindingFilter,
  parseIdCursor,
  parseLimit,
  QUERY_MAX_LIMIT,
  QUERY_STATEMENT_TIMEOUT,
  raw as asRecord,
  requireRunningRunner,
  stringList,
  upperList,
  type FindingFilter,
} from './runner-query-common';

export const ASSET_QUERY_MAX_LIMIT = QUERY_MAX_LIMIT;
export const ASSET_QUERY_MAX_SELECT = 20;
export const ASSET_QUERY_STATEMENT_TIMEOUT = QUERY_STATEMENT_TIMEOUT;

export interface RunnerAssetFindingSummary {
  id: string;
  detectorType: string;
  customDetectorKey: string | null;
  findingType: string;
  severity: string;
  status: string;
  assertedBySourceId: string | null;
}

export interface RunnerAssetQueryItem {
  id: string;
  assetHash: string;
  urn: string | null;
  sourceId: string;
  sourceName: string;
  externalId: string | null;
  name: string;
  kind: string;
  url: string;
  metadata: Record<string, unknown>;
  /** Present only when the caller asked to `include` findings. */
  findings?: RunnerAssetFindingSummary[];
}

export interface RunnerAssetQueryResponse {
  items: RunnerAssetQueryItem[];
  nextCursor: string | null;
}

/** Findings listed per asset when `include: ["findings"]`; the rest are counted out. */
const INCLUDED_FINDINGS_PER_ASSET = 50;
/** The ranked list a semantic query pages through. */
const SEMANTIC_CANDIDATES = 200;
const ASSET_STATUSES = ['NEW', 'UPDATED', 'UNCHANGED', 'DELETED'];
const MEANING_METHODS = ['DECLARED', 'DERIVED', 'INFERRED', 'MANUAL'];

interface QueryInput {
  /** Null reads every source in the namespace. */
  source: string | null;
  kind: string | null;
  search: string | null;
  status: string[] | null;
  where: ReturnType<typeof parseMetadataWhere>;
  excludeVisited: { path: string[]; sinceDays: number } | null;
  term: { keys: string[]; includeNarrower: boolean; methods: string[] } | null;
  findings: FindingFilter | null;
  semantic: { query: string; mode: SemanticSearchMode } | null;
  includeFindings: boolean;
  select: Array<{ key: string; path: string[] }>;
  limit: number;
  /** An asset id, or `r:<n>` into a semantic ranking. */
  cursor: string | null;
}

type Row = {
  id: string;
  hash: string;
  urn: string | null;
  sourceId: string;
  sourceName: string;
  name: string;
  kind: string;
  url: string;
  externalId: string | null;
  selected: Record<string, unknown> | null;
};

/**
 * What a running connector may read of the namespace it writes to.
 *
 * `ctx.query_assets()` in a CUSTOM notebook lands here, through the parent CLI
 * process that holds the internal key — the notebook itself never sees the API.
 * Read-only, scoped to the run's namespace (one source, or all), bounded in
 * rows per page and in time (every read pages by cursor), and only for a run
 * that is actually RUNNING, so a finished job's credentials cannot be replayed
 * to read the namespace later. Nothing here returns a source's configuration.
 */
@Injectable()
export class RunnerAssetQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingService,
    private readonly queryEmbeddings: QueryEmbeddingService,
  ) {}

  async query(
    runnerId: string,
    body: unknown,
  ): Promise<RunnerAssetQueryResponse> {
    const input = parseInput(body);
    const runner = await requireRunningRunner(this.prisma, runnerId, 'read');

    // Unknown names 404 before the heavy query runs.
    const target = input.source ? await this.resolveSource(input.source) : null;
    const termIds = input.term ? await this.resolveTerms(input.term) : null;

    const ranked = input.semantic ? await this.rank(input, target?.id) : null;
    const offset = ranked ? parseRankCursor(input.cursor) : 0;

    const rows = await this.run(
      target?.id ?? null,
      runner.sourceId,
      input,
      termIds,
      ranked,
    );

    let page: Row[];
    let nextCursor: string | null;
    if (ranked) {
      const order = new Map(ranked.map((id, index) => [id, index]));
      const ordered = [...rows].sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
      );
      page = ordered.slice(offset, offset + input.limit);
      nextCursor =
        ordered.length > offset + input.limit
          ? `r:${offset + input.limit}`
          : null;
    } else {
      page = rows.slice(0, input.limit);
      nextCursor =
        rows.length > input.limit ? (page[page.length - 1]?.id ?? null) : null;
    }

    const findings = input.includeFindings
      ? await this.findingsFor(page.map((row) => row.id))
      : null;

    return {
      items: page.map((row) => ({
        id: row.id,
        assetHash: row.hash,
        urn: row.urn,
        sourceId: row.sourceId,
        sourceName: row.sourceName,
        externalId: row.externalId,
        name: row.name,
        kind: row.kind,
        url: row.url,
        metadata: row.selected ?? {},
        ...(findings ? { findings: findings.get(row.id) ?? [] } : {}),
      })),
      nextCursor,
    };
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

  private async resolveTerms(
    term: NonNullable<QueryInput['term']>,
  ): Promise<string[]> {
    const snapshot = await ensureTermSnapshot(this.prisma);
    const { termIds, unknown } = resolveTermKeys(
      snapshot,
      term.keys,
      term.includeNarrower,
    );
    assertKnownTermKeys(unknown);
    return termIds;
  }

  /**
   * Asset ids best-first for a meaning query. The same hybrid ranking the
   * asset search uses; capped, so the cursor is a position in that list.
   */
  private async rank(
    input: QueryInput,
    sourceId: string | undefined,
  ): Promise<string[]> {
    const semantic = input.semantic as NonNullable<QueryInput['semantic']>;
    const vector =
      semantic.mode === SemanticSearchMode.VECTOR
        ? await this.queryEmbeddings.embed(semantic.query)
        : await this.queryEmbeddings.embedIfAvailable(semantic.query);
    const meaning = vector
      ? await this.embeddings.semanticAssetIds(
          vector,
          SEMANTIC_CANDIDATES,
          sourceId,
        )
      : [];
    const hybrid = semantic.mode !== SemanticSearchMode.VECTOR;
    const passages = hybrid
      ? await this.embeddings.lexicalAssetIds(
          semantic.query,
          SEMANTIC_CANDIDATES,
          sourceId,
        )
      : [];
    const names = hybrid
      ? await this.prisma.asset.findMany({
          where: {
            name: { contains: semantic.query, mode: 'insensitive' },
            ...(sourceId ? { sourceId } : {}),
            status: { not: 'DELETED' },
          },
          select: { id: true },
          take: SEMANTIC_CANDIDATES,
        })
      : [];
    return fuseHybridRanks(meaning, passages, names).map(([id]) => id);
  }

  private async findingsFor(
    assetIds: string[],
  ): Promise<Map<string, RunnerAssetFindingSummary[]>> {
    const byAsset = new Map<string, RunnerAssetFindingSummary[]>();
    if (assetIds.length === 0) return byAsset;
    const rows = await boundedRead(
      this.prisma,
      (tx) =>
        tx.$queryRaw<Array<RunnerAssetFindingSummary & { assetId: string }>>`
        SELECT x."assetId", x.id, x."detectorType", x."customDetectorKey",
               x."findingType", x.severity, x.status, x."assertedBySourceId"
        FROM (
          SELECT f.asset_id AS "assetId", f.id,
                 f.detector_type::text AS "detectorType",
                 f.custom_detector_key AS "customDetectorKey",
                 f.finding_type AS "findingType",
                 f.severity::text AS severity, f.status::text AS status,
                 f.asserted_by_source_id AS "assertedBySourceId",
                 row_number() OVER (PARTITION BY f.asset_id ORDER BY f.id) AS n
          FROM findings f
          WHERE f.asset_id = ANY(${assetIds}::text[])
            AND f.status = 'OPEN'::"FindingStatus"
        ) x
        WHERE x.n <= ${INCLUDED_FINDINGS_PER_ASSET}
      `,
    );
    for (const { assetId, ...finding } of rows) {
      const list = byAsset.get(assetId) ?? [];
      list.push(finding);
      byAsset.set(assetId, list);
    }
    return byAsset;
  }

  private async run(
    targetSourceId: string | null,
    callingSourceId: string,
    input: QueryInput,
    termIds: string[] | null,
    ranked: string[] | null,
  ): Promise<Row[]> {
    const conditions: Prisma.Sql[] = [
      input.status
        ? Prisma.sql`a.status::text = ANY(${input.status}::text[])`
        : Prisma.sql`a.status <> 'DELETED'::"AssetStatus"`,
    ];
    if (targetSourceId) {
      conditions.push(Prisma.sql`a.source_id = ${targetSourceId}`);
    }
    if (input.kind) conditions.push(Prisma.sql`a.asset_type = ${input.kind}`);
    if (input.search) {
      conditions.push(
        Prisma.sql`a.name ILIKE ${'%' + escapeLike(input.search) + '%'}`,
      );
    }
    if (ranked) {
      conditions.push(Prisma.sql`a.id = ANY(${ranked}::text[])`);
    } else if (input.cursor) {
      conditions.push(Prisma.sql`a.id > ${input.cursor}`);
    }
    if (input.where.length > 0) {
      conditions.push(metadataPredicateSql(input.where, 'a'));
    }
    if (termIds && input.term) {
      const methodFilter = input.term.methods.length
        ? Prisma.sql`AND t.method::text = ANY(${input.term.methods}::text[])`
        : Prisma.empty;
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM asset_terms t
        WHERE t.asset_id = a.id AND t.term_id = ANY(${termIds}::text[])
          AND t.gone_at IS NULL ${methodFilter}
      )`);
    }
    if (input.findings) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM findings f
        WHERE f.asset_id = a.id AND ${Prisma.join(findingConditions(input.findings), ' AND ')}
      )`);
    }
    if (input.excludeVisited) {
      // Strict JSON equality on both sides (`#>`, not `#>>`): the `where`
      // predicates compare as JSON, so "5" must not equal 5 here either. jsonb
      // `=` stays hash-joinable, and NULL never equals NULL, so an asset
      // missing the key is never "visited".
      const { path, sinceDays } = input.excludeVisited;
      conditions.push(Prisma.sql`NOT EXISTS (
        SELECT 1 FROM assets v
        WHERE v.source_id = ${callingSourceId}
          AND v.last_scanned_at >= now() - make_interval(days => ${sinceDays})
          AND (v.metadata #> ${path}::text[]) = (a.metadata #> ${path}::text[])
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

    return boundedRead(
      this.prisma,
      (tx) =>
        tx.$queryRaw<Row[]>`
          SELECT a.id, a.hash, a.urn, a.source_id AS "sourceId",
                 s.name AS "sourceName", a.name, a.asset_type AS kind,
                 a.external_url AS url,
                 a.metadata ->> 'external_id' AS "externalId",
                 ${selected} AS selected
          FROM assets a
          JOIN sources s ON s.id = a.source_id
          WHERE ${Prisma.join(conditions, ' AND ')}
          ${ranked ? Prisma.empty : Prisma.sql`ORDER BY a.id LIMIT ${input.limit + 1}`}
        `,
      {
        // Only for the anti-join shape this was measured on. Row estimates
        // for predicates inside jsonb are guesses — 1 row estimated, 28,162
        // actual, measured on firmenbuch-test-2 — and with that guess the
        // planner anti-joined through a nested loop over a materialized copy
        // of the calling source: 40 s. Without nested loops that query is a
        // parallel hash anti-join in 2.8 s. Other shapes keep the planner's
        // own choice: a selective keyset page is a nested loop's best case.
        tuning: input.excludeVisited
          ? async (tx) => {
              await tx.$executeRaw`SET LOCAL enable_nestloop = off`;
            }
          : undefined,
      },
    );
  }
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function parseRankCursor(cursor: string | null): number {
  if (cursor === null) return 0;
  const match = /^r:(\d{1,6})$/.exec(cursor);
  if (!match) {
    throw new BadRequestException(
      'cursor must be the nextCursor of a previous page of this query.',
    );
  }
  return Number(match[1]);
}

function parseInput(body: unknown): QueryInput {
  const input = asRecord(body);

  let source: string | null = null;
  if (input.source !== undefined && input.source !== null) {
    source = typeof input.source === 'string' ? input.source.trim() : '';
    if (!source) {
      throw new BadRequestException(
        'source must be the id or exact name of a source, or left out to read every source.',
      );
    }
  }

  let kind: string | null = null;
  if (input.kind !== undefined && input.kind !== null) {
    if (
      typeof input.kind !== 'string' ||
      !/^[a-z0-9_-]{1,50}$/i.test(input.kind)
    ) {
      throw new BadRequestException(
        'kind must be an asset kind like "record".',
      );
    }
    kind = input.kind.toLowerCase();
  }

  let search: string | null = null;
  if (input.search !== undefined && input.search !== null) {
    if (typeof input.search !== 'string' || input.search.length > 200) {
      throw new BadRequestException(
        'search must be text of at most 200 characters.',
      );
    }
    search = input.search.trim() || null;
  }

  let excludeVisited: QueryInput['excludeVisited'] = null;
  if (input.excludeVisited !== undefined && input.excludeVisited !== null) {
    const visited = input.excludeVisited as Record<string, unknown>;
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

  const selectRaw = input.select ?? [];
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

  let term: QueryInput['term'] = null;
  if (input.term !== undefined && input.term !== null) {
    const spec = asRecord(input.term);
    const keys = stringList(spec.keys, 'term.keys');
    if (!keys?.length) {
      throw new BadRequestException(
        'term must be {"keys": ["<glossary term key>"], "includeNarrower"?: bool, "methods"?: [...]}.',
      );
    }
    term = {
      keys,
      includeNarrower: Boolean(spec.includeNarrower),
      methods: upperList(spec.methods, 'term.methods', MEANING_METHODS) ?? [],
    };
  }

  let semantic: QueryInput['semantic'] = null;
  if (input.semantic !== undefined && input.semantic !== null) {
    const spec = asRecord(input.semantic);
    const query = typeof spec.query === 'string' ? spec.query.trim() : '';
    const mode =
      typeof spec.mode === 'string'
        ? spec.mode.toLowerCase()
        : SemanticSearchMode.HYBRID;
    if (
      !query ||
      query.length > 500 ||
      ![SemanticSearchMode.HYBRID, SemanticSearchMode.VECTOR].includes(
        mode as SemanticSearchMode,
      )
    ) {
      throw new BadRequestException(
        'semantic must be {"query": "<=500 characters", "mode"?: "hybrid" | "vector"}.',
      );
    }
    semantic = { query, mode: mode as SemanticSearchMode };
  }

  const includeRaw = stringList(input.include, 'include', 5) ?? [];
  const unknownInclude = includeRaw.filter((item) => item !== 'findings');
  if (unknownInclude.length > 0) {
    throw new BadRequestException(
      `include accepts "findings"; got ${unknownInclude.join(', ')}.`,
    );
  }

  const cursorRaw = input.cursor;
  const cursor =
    semantic && typeof cursorRaw === 'string' && cursorRaw.startsWith('r:')
      ? cursorRaw
      : semantic && cursorRaw !== undefined && cursorRaw !== null
        ? (() => {
            throw new BadRequestException(
              'cursor must be the nextCursor of a previous page of this query.',
            );
          })()
        : parseIdCursor(cursorRaw);

  return {
    source,
    kind,
    search,
    status: upperList(input.status, 'status', ASSET_STATUSES),
    where: parseMetadataWhere(input.where),
    excludeVisited,
    term,
    findings:
      input.findings !== undefined && input.findings !== null
        ? parseFindingFilter(input.findings)
        : null,
    semantic,
    includeFindings: includeRaw.includes('findings'),
    select,
    limit: parseLimit(input.limit),
    cursor,
  };
}
