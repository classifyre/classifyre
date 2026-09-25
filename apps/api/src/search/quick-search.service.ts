import { BadRequestException, Injectable } from '@nestjs/common';
import { DetectorType, FindingStatus, Prisma, Severity } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import {
  QuickSearchKind,
  type QuickSearchAssetDto,
  type QuickSearchFindingDto,
  type QuickSearchResponseDto,
  type QuickSearchSeverityCountsDto,
} from '../dto/quick-search.dto';

/**
 * Search as you type, cheap enough to run on every keystroke of a big
 * workspace. The general asset and finding searches paginate, count every
 * match and OR a dozen substring matches across joins — fine for a results
 * page, but on 1.1M findings a burst of them saturated the database. This one:
 *
 *  - never counts; it asks for `limit` rows and lets Postgres stop there;
 *  - matches asset names and finding content through full-text indexes
 *    (whole words, and prefixes of them), so a query that matches nothing
 *    costs an index lookup, not a scan;
 *  - looks for asset names that contain the query mid-word (file names,
 *    compounds) only when the words left room, and on a shorter leash, since
 *    that is a scan;
 *  - runs each step in its own short transaction under a statement timeout,
 *    so a slow one returns what it has with `truncated` instead of holding a
 *    connection, and never takes the other kind down with it.
 */

const LIMIT_DEFAULT = 8;
/** SET takes no bind parameters, so the timeouts are literals. */
const TIMEOUT_SQL = Prisma.sql`SET LOCAL statement_timeout = '4s'`;
const SCAN_TIMEOUT_SQL = Prisma.sql`SET LOCAL statement_timeout = '1500ms'`;
/** Below this, a mid-word match is noise and the scan is not worth it. */
const SUBSTRING_MIN = 3;
/** Index hits read before filtering; more than any page of results needs. */
const CANDIDATES = 200;

type AssetRow = {
  id: string;
  name: string;
  externalUrl: string;
  assetType: string;
  sourceType: string;
  sourceId: string;
};

const SETTLED: FindingStatus[] = [
  FindingStatus.RESOLVED,
  FindingStatus.FALSE_POSITIVE,
  FindingStatus.IGNORED,
];

export const QuickSearchSchema = z.strictObject({
  q: z.string().trim().min(2).max(200),
  kinds: z.array(z.enum(QuickSearchKind)).min(1).max(2).optional(),
  sourceId: z.string().trim().min(1).max(200).optional(),
  severity: z.array(z.enum(Severity)).max(5).optional(),
  detectorType: z.array(z.enum(DetectorType)).max(50).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});
export type QuickSearchInput = z.infer<typeof QuickSearchSchema>;

type Kind<T> = { items: T[]; truncated: boolean };

function isStatementTimeout(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes('57014') || /statement timeout/i.test(text);
}

/**
 * Words of the query as a prefix tsquery: "fn 8q" → `fn:* & 8q:*`. Anything
 * but letters and digits separates words — as the `simple` parser splits
 * "firmenbuch-test-2" — so the input can never be tsquery syntax; null when
 * nothing is left.
 */
export function prefixTsQuery(q: string): string | null {
  const words = q
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 8);
  return words.length > 0 ? words.map((w) => `${w}:*`).join(' & ') : null;
}

const emptyCounts = (): QuickSearchSeverityCountsDto => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
});

@Injectable()
export class QuickSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(body: unknown): Promise<QuickSearchResponseDto> {
    const parsed = QuickSearchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid search',
        issues: parsed.error.issues.slice(0, 10).map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const input = parsed.data;
    const kinds = new Set(input.kinds ?? Object.values(QuickSearchKind));
    const limit = input.limit ?? LIMIT_DEFAULT;
    const [assets, findings] = await Promise.all([
      kinds.has(QuickSearchKind.ASSETS)
        ? this.assets(input, limit)
        : { items: [], truncated: false },
      kinds.has(QuickSearchKind.FINDINGS)
        ? this.bounded((tx) => this.findings(tx, input, limit))
        : { items: [], truncated: false },
    ]);
    return {
      assets: assets.items,
      findings: findings.items,
      truncated: assets.truncated || findings.truncated,
    };
  }

  /** One step, in its own transaction under a statement timeout. */
  private async bounded<T>(
    query: (tx: Prisma.TransactionClient) => Promise<T[]>,
    timeout: Prisma.Sql = TIMEOUT_SQL,
  ): Promise<Kind<T>> {
    try {
      const items = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw(timeout);
          return query(tx);
        },
        // Above the statement timeout, so Postgres reports a slow query as a
        // timeout instead of Prisma closing the transaction first (P2028).
        { timeout: 8_000, maxWait: 3_000 },
      );
      return { items, truncated: false };
    } catch (error) {
      if (isStatementTimeout(error)) return { items: [], truncated: true };
      throw error;
    }
  }

  private async assets(
    input: QuickSearchInput,
    limit: number,
  ): Promise<Kind<QuickSearchAssetDto>> {
    const byWord = await this.bounded((tx) =>
      this.assetsByWord(tx, input, limit),
    );
    let rows = byWord.items;
    let truncated = byWord.truncated;
    if (rows.length < limit && input.q.length >= SUBSTRING_MIN) {
      const bySubstring = await this.bounded(
        (tx) =>
          this.assetsBySubstring(
            tx,
            input,
            limit - rows.length,
            rows.map((r) => r.id),
          ),
        SCAN_TIMEOUT_SQL,
      );
      rows = [...rows, ...bySubstring.items];
      truncated ||= bySubstring.truncated;
    }
    if (rows.length === 0) return { items: [], truncated };
    const shaped = await this.bounded((tx) =>
      this.shapeAssets(tx, rows, input.q),
    );
    return { items: shaped.items, truncated: truncated || shaped.truncated };
  }

  /** Filters every asset match shares: live assets, one source, findings of a kind. */
  private assetWhere(input: QuickSearchInput): Prisma.AssetWhereInput {
    const findingFilter: Prisma.FindingWhereInput | null =
      input.severity?.length || input.detectorType?.length
        ? {
            status: { notIn: SETTLED },
            ...(input.severity?.length
              ? { severity: { in: input.severity } }
              : {}),
            ...(input.detectorType?.length
              ? { detectorType: { in: input.detectorType } }
              : {}),
          }
        : null;
    return {
      status: { not: 'DELETED' },
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      ...(findingFilter ? { findings: { some: findingFilter } } : {}),
    };
  }

  private readonly assetSelect = {
    id: true,
    name: true,
    externalUrl: true,
    assetType: true,
    sourceType: true,
    sourceId: true,
  } as const;

  /** Names with a word starting with each word of the query, through the index. */
  private async assetsByWord(
    tx: Prisma.TransactionClient,
    input: QuickSearchInput,
    limit: number,
  ): Promise<AssetRow[]> {
    const tsquery = prefixTsQuery(input.q);
    if (!tsquery) return [];
    const source = input.sourceId
      ? Prisma.sql`AND source_id = ${input.sourceId}`
      : Prisma.empty;
    const candidates = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM assets
        WHERE to_tsvector('simple', name) @@ to_tsquery('simple', ${tsquery})
          AND status <> 'DELETED' ${source}
        LIMIT ${CANDIDATES}
      `;
    if (candidates.length === 0) return [];
    const rows = await tx.asset.findMany({
      where: {
        id: { in: candidates.map((c) => c.id) },
        ...this.assetWhere(input),
      },
      take: limit,
      select: this.assetSelect,
    });
    return rows.map((r) => ({ ...r, sourceType: String(r.sourceType) }));
  }

  /**
   * Names containing the query anywhere, for what whole words miss. No index
   * helps a substring, so no ORDER BY either: the scan stops at `limit`.
   */
  private async assetsBySubstring(
    tx: Prisma.TransactionClient,
    input: QuickSearchInput,
    limit: number,
    exclude: string[],
  ): Promise<AssetRow[]> {
    const rows = await tx.asset.findMany({
      where: {
        name: { contains: input.q, mode: 'insensitive' },
        ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}),
        ...this.assetWhere(input),
      },
      take: limit,
      select: this.assetSelect,
    });
    return rows.map((r) => ({ ...r, sourceType: String(r.sourceType) }));
  }

  /** Open findings per severity and source names for the assets found. */
  private async shapeAssets(
    tx: Prisma.TransactionClient,
    rows: AssetRow[],
    query: string,
  ): Promise<QuickSearchAssetDto[]> {
    const ids = rows.map((r) => r.id);
    const [counts, sources] = await Promise.all([
      tx.finding.groupBy({
        by: ['assetId', 'severity'],
        where: { assetId: { in: ids }, status: { notIn: SETTLED } },
        _count: { _all: true },
      }),
      tx.source.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.sourceId))] } },
        select: { id: true, name: true },
      }),
    ]);
    const sourceName = new Map(sources.map((s) => [s.id, s.name]));
    const byAsset = new Map<string, QuickSearchSeverityCountsDto>();
    for (const c of counts) {
      const entry = byAsset.get(c.assetId) ?? emptyCounts();
      const key =
        c.severity.toLowerCase() as keyof QuickSearchSeverityCountsDto;
      entry[key] += c._count._all;
      byAsset.set(c.assetId, entry);
    }
    const q = query.toLowerCase();
    return rows
      .map((r) => {
        const severityCounts = byAsset.get(r.id) ?? emptyCounts();
        return {
          id: r.id,
          name: r.name,
          externalUrl: r.externalUrl || null,
          assetType: r.assetType,
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          sourceName: sourceName.get(r.sourceId) ?? null,
          openFindings: Object.values(severityCounts).reduce(
            (a, b) => a + b,
            0,
          ),
          severityCounts,
        };
      })
      .sort((a, b) => {
        // Names that start with the query first, then the shorter ones.
        const pa = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const pb = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return pa - pb || a.name.length - b.name.length;
      });
  }

  private async findings(
    tx: Prisma.TransactionClient,
    input: QuickSearchInput,
    limit: number,
  ): Promise<QuickSearchFindingDto[]> {
    const tsquery = prefixTsQuery(input.q);
    if (!tsquery) return [];
    // The full-text GIN index finds candidates; the typed query filters
    // and shapes at most a couple of hundred of them.
    const candidates = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM findings
        WHERE to_tsvector('simple', matched_content) @@ to_tsquery('simple', ${tsquery})
        LIMIT ${CANDIDATES}
      `;
    if (candidates.length === 0) return [];
    const rows = await tx.finding.findMany({
      where: {
        id: { in: candidates.map((c) => c.id) },
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        ...(input.severity?.length ? { severity: { in: input.severity } } : {}),
        ...(input.detectorType?.length
          ? { detectorType: { in: input.detectorType } }
          : {}),
      },
      take: limit,
      orderBy: [{ severity: 'asc' }, { lastDetectedAt: 'desc' }],
      select: {
        id: true,
        assetId: true,
        findingType: true,
        matchedContent: true,
        severity: true,
        detectorType: true,
        customDetectorName: true,
        status: true,
        asset: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      assetId: r.assetId,
      assetName: r.asset?.name ?? null,
      findingType: r.findingType,
      matchedContent: r.matchedContent ? r.matchedContent.slice(0, 200) : null,
      severity: r.severity,
      detectorType: r.detectorType,
      customDetectorName: r.customDetectorName,
      status: r.status,
    }));
  }
}
