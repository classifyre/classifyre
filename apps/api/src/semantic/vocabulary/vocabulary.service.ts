import { Injectable, Logger } from '@nestjs/common';
import { DetectorType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { withStatementTimeout } from '../semantic-sql';
import {
  isOutputMode,
  outputKey,
  vocabularyLabel,
} from '../bindings/binding-spec';
import { glossaryNorm } from '../../glossary/glossary-norm';

/** Value statistics only below this many open findings, unless categorical by runner. */
const VALUE_STATS_MAX_FINDINGS = 50_000;
/** distinctValues is capped here; 1,001 reads "more than 1,000". */
const DISTINCT_CAP = 1_001;
/** At most this many distinct values make an output categorical (SL2 §3). */
export const CATEGORICAL_MAX_DISTINCT = 50;
const TOP_VALUES = 25;
const MAX_FIELDS_PER_SOURCE = 200;
const STATEMENT_TIMEOUT_MS = 30_000;
/** Keys the platform writes itself, never vocabulary (SL2 §5.2). */
const PLATFORM_FIELDS = new Set(['content_reference']);
const CATEGORICAL_PIPELINES = new Set([
  'TAG',
  'LLM',
  'TEXT_CLASSIFICATION',
  'IMAGE_CLASSIFICATION',
]);

export type TopValue = { value: string; count: number };

/** Whether an output is categorical by its runner, before any statistics. */
export function categoricalByRunner(
  findingType: string,
  pipelineType: string | null | undefined,
): boolean {
  if (
    findingType.startsWith('tag:') ||
    findingType.startsWith('classification:')
  ) {
    return true;
  }
  return Boolean(pipelineType && CATEGORICAL_PIPELINES.has(pipelineType));
}

export interface VocabularyRow {
  kind: 'output' | 'field';
  /** Stable identity: `DETECTOR|key|type` or `field:path`. */
  id: string;
  output?: {
    detectorType: DetectorType;
    customDetectorKey: string | null;
    customDetectorName: string | null;
    findingType: string;
    pipelineType: string | null;
  };
  field?: string;
  label: { label: string; detail: string };
  sources: Array<{ id: string; name: string }>;
  openCount: number;
  assetCount: number;
  distinctValues: number | null;
  categorical: boolean;
  topValues: TopValue[];
  lastSeenAt: Date | null;
  refreshedAt: Date | null;
  bindings: Array<{
    id: string;
    mode: string;
    status: string;
    noMeaning: boolean;
    term: { id: string; key: string; term: string } | null;
    lookupScheme: { id: string; key: string; name: string } | null;
  }>;
  bound: boolean;
}

/**
 * The observed data dictionary (F8): what the detectors and connectors in this
 * workspace actually say, with counts. Refreshed per source after a run and on
 * demand, never computed on page load. Bindings are built from it — a binding
 * is a choice from this vocabulary, never a pattern.
 */
@Injectable()
export class VocabularyService {
  private readonly logger = new Logger(VocabularyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async refreshAll(): Promise<{ sources: number }> {
    const sources = await this.prisma.source.findMany({ select: { id: true } });
    for (const source of sources) {
      try {
        await this.refreshSource(source.id);
      } catch (error) {
        this.logger.warn(
          `Vocabulary refresh failed for source ${source.id}: ${String(error)}`,
        );
      }
    }
    return { sources: sources.length };
  }

  async refreshSource(
    sourceId: string,
  ): Promise<{ outputs: number; fields: number }> {
    const now = new Date();
    const detectors = await this.prisma.customDetector.findMany({
      select: { key: true, name: true, pipelineSchema: true },
    });
    const pipelineOf = new Map(
      detectors.map((d) => [
        d.key,
        ((d.pipelineSchema as Record<string, unknown> | null)?.type as
          | string
          | undefined) ?? 'GLINER2',
      ]),
    );
    const outputs = await withStatementTimeout(
      this.prisma,
      STATEMENT_TIMEOUT_MS,
      (tx) =>
        tx.$queryRaw<
          Array<{
            detector_type: DetectorType;
            custom_detector_key: string;
            finding_type: string;
            custom_detector_name: string | null;
            open_count: bigint;
            asset_count: bigint;
            first_seen: Date | null;
            last_seen: Date | null;
          }>
        >`
        SELECT f.detector_type, COALESCE(f.custom_detector_key, '') AS custom_detector_key,
               f.finding_type, max(f.custom_detector_name) AS custom_detector_name,
               count(*) AS open_count, count(DISTINCT f.asset_id) AS asset_count,
               min(COALESCE(f.first_detected_at, f.detected_at)) AS first_seen,
               max(COALESCE(f.last_detected_at, f.detected_at)) AS last_seen
          FROM findings f
         WHERE f.source_id = ${sourceId} AND f.status = 'OPEN'
         GROUP BY 1, 2, 3
      `,
    );

    const rows: Prisma.VocabularyItemCreateManyInput[] = [];
    for (const output of outputs) {
      const open = Number(output.open_count);
      const runnerCategorical = categoricalByRunner(
        output.finding_type,
        output.custom_detector_key
          ? pipelineOf.get(output.custom_detector_key)
          : null,
      );
      let distinct: number | null = null;
      let top: TopValue[] | null = null;
      if (runnerCategorical || open < VALUE_STATS_MAX_FINDINGS) {
        try {
          const stats = await this.outputValueStats(sourceId, output);
          distinct = stats.distinct;
          top = stats.top;
        } catch (error) {
          this.logger.warn(
            `Value statistics skipped for ${output.finding_type} on ${sourceId}: ${String(error)}`,
          );
        }
      }
      rows.push({
        sourceId,
        detectorType: output.detector_type,
        customDetectorKey: output.custom_detector_key,
        findingType: output.finding_type,
        customDetectorName: output.custom_detector_name,
        openCount: open,
        assetCount: Number(output.asset_count),
        distinctValues: distinct,
        topValues: top ?? undefined,
        firstSeenAt: output.first_seen ?? now,
        lastSeenAt: output.last_seen ?? now,
        refreshedAt: now,
      });
    }
    const fields = await this.fieldRows(sourceId, now);
    await this.prisma.$transaction([
      this.prisma.vocabularyItem.deleteMany({ where: { sourceId } }),
      this.prisma.vocabularyItem.createMany({ data: rows }),
      this.prisma.vocabularyField.deleteMany({ where: { sourceId } }),
      this.prisma.vocabularyField.createMany({ data: fields }),
    ]);
    return { outputs: rows.length, fields: fields.length };
  }

  private async outputValueStats(
    sourceId: string,
    output: {
      detector_type: DetectorType;
      custom_detector_key: string;
      finding_type: string;
    },
  ): Promise<{ distinct: number; top: TopValue[] }> {
    return withStatementTimeout(
      this.prisma,
      STATEMENT_TIMEOUT_MS,
      async (tx) => {
        const where = Prisma.sql`
        f.source_id = ${sourceId} AND f.status = 'OPEN'
        AND f.detector_type = ${output.detector_type}::"DetectorType"
        AND COALESCE(f.custom_detector_key, '') = ${output.custom_detector_key}
        AND f.finding_type = ${output.finding_type}`;
        const [distinct] = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT count(*) AS n FROM (
          SELECT DISTINCT glossary_norm(f.matched_content) FROM findings f
           WHERE ${where} LIMIT ${DISTINCT_CAP}
        ) d`);
        const top = await tx.$queryRaw<
          Array<{ value: string; count: bigint }>
        >(Prisma.sql`
        SELECT mode() WITHIN GROUP (ORDER BY f.matched_content) AS value, count(*) AS count
          FROM findings f WHERE ${where}
         GROUP BY glossary_norm(f.matched_content)
         ORDER BY count(*) DESC LIMIT ${TOP_VALUES}`);
        return {
          distinct: Number(distinct?.n ?? 0),
          top: top.map((row) => ({
            value: row.value,
            count: Number(row.count),
          })),
        };
      },
    );
  }

  private async fieldRows(
    sourceId: string,
    now: Date,
  ): Promise<Prisma.VocabularyFieldCreateManyInput[]> {
    let paths: Array<{ path: string; asset_count: bigint }> = [];
    try {
      paths = await withStatementTimeout(
        this.prisma,
        STATEMENT_TIMEOUT_MS,
        (tx) =>
          tx.$queryRaw<Array<{ path: string; asset_count: bigint }>>`
          SELECT path, count(DISTINCT asset_id) AS asset_count FROM (
            SELECT a.id AS asset_id, e.key AS path
              FROM assets a CROSS JOIN LATERAL jsonb_each(a.metadata) e
             WHERE a.source_id = ${sourceId} AND jsonb_typeof(a.metadata) = 'object'
               AND a.status <> 'DELETED'
               AND jsonb_typeof(e.value) IN ('string', 'number', 'boolean', 'array')
            UNION ALL
            SELECT a.id, e.key || '.' || e2.key
              FROM assets a
              CROSS JOIN LATERAL jsonb_each(a.metadata) e
              CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(e.value) = 'object' THEN e.value ELSE '{}'::jsonb END) e2
             WHERE a.source_id = ${sourceId} AND jsonb_typeof(a.metadata) = 'object'
               AND a.status <> 'DELETED'
               AND jsonb_typeof(e2.value) IN ('string', 'number', 'boolean', 'array')
          ) p
          WHERE path NOT LIKE '\\_%' ESCAPE '\\' AND path NOT LIKE '%.\\_%' ESCAPE '\\'
          GROUP BY path
          ORDER BY count(DISTINCT asset_id) DESC
          LIMIT ${MAX_FIELDS_PER_SOURCE}
        `,
      );
    } catch (error) {
      this.logger.warn(
        `Metadata fields skipped for ${sourceId}: ${String(error)}`,
      );
      return [];
    }
    const out: Prisma.VocabularyFieldCreateManyInput[] = [];
    for (const row of paths) {
      if (PLATFORM_FIELDS.has(row.path.split('.')[0])) continue;
      let distinct: number | null = null;
      let top: TopValue[] | null = null;
      try {
        const segments = row.path.split('.');
        const stats = await withStatementTimeout(
          this.prisma,
          STATEMENT_TIMEOUT_MS,
          async (tx) => {
            const values = Prisma.sql`(
            SELECT e #>> '{}' AS v FROM assets a
              CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(a.metadata #> ${segments}::text[]) = 'array'
                     THEN a.metadata #> ${segments}::text[] ELSE '[]'::jsonb END) e
             WHERE a.source_id = ${sourceId} AND a.status <> 'DELETED'
               AND jsonb_typeof(e) IN ('string', 'number', 'boolean')
            UNION ALL
            SELECT a.metadata #>> ${segments}::text[] FROM assets a
             WHERE a.source_id = ${sourceId} AND a.status <> 'DELETED'
               AND jsonb_typeof(a.metadata #> ${segments}::text[]) IN ('string', 'number', 'boolean')
          )`;
            const [d] = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
            SELECT count(*) AS n FROM (SELECT DISTINCT glossary_norm(v) FROM ${values} vals LIMIT ${DISTINCT_CAP}) d`);
            const t = await tx.$queryRaw<
              Array<{ value: string; count: bigint }>
            >(Prisma.sql`
            SELECT mode() WITHIN GROUP (ORDER BY v) AS value, count(*) AS count
              FROM ${values} vals GROUP BY glossary_norm(v)
             ORDER BY count(*) DESC LIMIT ${TOP_VALUES}`);
            return {
              distinct: Number(d?.n ?? 0),
              top: t.map((r) => ({ value: r.value, count: Number(r.count) })),
            };
          },
        );
        distinct = stats.distinct;
        top = stats.top;
      } catch (error) {
        this.logger.debug(
          `Field statistics skipped for ${row.path}: ${String(error)}`,
        );
      }
      out.push({
        sourceId,
        path: row.path,
        assetCount: Number(row.asset_count),
        distinctValues: distinct,
        topValues: top ?? undefined,
        refreshedAt: now,
      });
    }
    return out;
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  /**
   * Inventory rows across sources, merged per output or field, with their
   * bindings. `bound=false` is the *Unbound vocabulary* worklist (SL2 §6.3):
   * outputs with open findings and no APPROVED binding, by volume.
   */
  async list(params: {
    kind?: 'outputs' | 'fields' | 'all';
    sourceId?: string;
    detectorType?: string;
    customDetectorKey?: string;
    bound?: 'true' | 'false' | 'any';
    q?: string;
    take?: number;
    skip?: number;
  }): Promise<{
    rows: VocabularyRow[];
    total: number;
    refreshedAt: Date | null;
  }> {
    const kind = params.kind ?? 'outputs';
    const sources = await this.prisma.source.findMany({
      select: { id: true, name: true },
    });
    const sourceName = new Map(sources.map((s) => [s.id, s.name]));
    const bindings = await this.prisma.glossaryBinding.findMany({
      where: { status: { in: ['APPROVED', 'DRAFT'] } },
      include: {
        term: { select: { id: true, key: true, term: true } },
        lookupScheme: { select: { id: true, key: true, name: true } },
      },
    });
    const detectors = await this.prisma.customDetector.findMany({
      select: { key: true, name: true, pipelineSchema: true },
    });
    const detectorByKey = new Map(detectors.map((d) => [d.key, d]));
    const rows: VocabularyRow[] = [];
    let refreshedAt: Date | null = null;

    if (kind === 'outputs' || kind === 'all') {
      const items = await this.prisma.vocabularyItem.findMany({
        where: {
          ...(params.sourceId ? { sourceId: params.sourceId } : {}),
          ...(params.detectorType
            ? { detectorType: params.detectorType as DetectorType }
            : {}),
          ...(params.customDetectorKey
            ? { customDetectorKey: params.customDetectorKey }
            : {}),
        },
      });
      const merged = new Map<
        string,
        VocabularyRow & { topMap: Map<string, TopValue> }
      >();
      for (const item of items) {
        if (!refreshedAt || item.refreshedAt > refreshedAt)
          refreshedAt = item.refreshedAt;
        const id = outputKey(item);
        const detector = item.customDetectorKey
          ? detectorByKey.get(item.customDetectorKey)
          : undefined;
        const pipelineType = detector
          ? (((detector.pipelineSchema as Record<string, unknown> | null)
              ?.type as string | undefined) ?? 'GLINER2')
          : null;
        let row = merged.get(id);
        if (!row) {
          const customDetectorName =
            detector?.name ?? item.customDetectorName ?? null;
          row = {
            kind: 'output',
            id,
            output: {
              detectorType: item.detectorType,
              customDetectorKey: item.customDetectorKey || null,
              customDetectorName,
              findingType: item.findingType,
              pipelineType,
            },
            label: vocabularyLabel({
              detectorType: item.detectorType,
              customDetectorKey: item.customDetectorKey || null,
              customDetectorName,
              findingType: item.findingType,
            }),
            sources: [],
            openCount: 0,
            assetCount: 0,
            distinctValues: 0,
            categorical: false,
            topValues: [],
            lastSeenAt: null,
            refreshedAt: item.refreshedAt,
            bindings: [],
            bound: false,
            topMap: new Map(),
          };
          merged.set(id, row);
        }
        row.sources.push({
          id: item.sourceId,
          name: sourceName.get(item.sourceId) ?? item.sourceId,
        });
        row.openCount += item.openCount;
        row.assetCount += item.assetCount;
        if (item.distinctValues === null || row.distinctValues === null) {
          row.distinctValues = null;
        } else {
          row.distinctValues = Math.min(
            DISTINCT_CAP,
            Math.max(row.distinctValues, item.distinctValues),
          );
        }
        for (const top of (item.topValues as TopValue[] | null) ?? []) {
          const key = glossaryNorm(top.value);
          const entry = row.topMap.get(key) ?? { value: top.value, count: 0 };
          entry.count += top.count;
          row.topMap.set(key, entry);
        }
        if (!row.lastSeenAt || item.lastSeenAt > row.lastSeenAt)
          row.lastSeenAt = item.lastSeenAt;
      }
      for (const row of merged.values()) {
        row.topValues = [...row.topMap.values()]
          .sort((a, b) => b.count - a.count)
          .slice(0, TOP_VALUES);
        row.categorical =
          categoricalByRunner(
            row.output!.findingType,
            row.output!.pipelineType,
          ) ||
          (row.distinctValues !== null &&
            row.distinctValues <= CATEGORICAL_MAX_DISTINCT);
        row.bindings = bindings
          .filter(
            (b) =>
              isOutputMode(b.mode) &&
              b.detectorType === row.output!.detectorType &&
              (b.customDetectorKey ?? null) ===
                (row.output!.customDetectorKey ?? null) &&
              b.findingType === row.output!.findingType,
          )
          .map((b) => this.bindingRef(b));
        row.bound = row.bindings.some((b) => b.status === 'APPROVED');
        const { topMap: _topMap, ...rest } = row;
        void _topMap;
        rows.push(rest);
      }
    }

    if (kind === 'fields' || kind === 'all') {
      const fields = await this.prisma.vocabularyField.findMany({
        where: params.sourceId ? { sourceId: params.sourceId } : {},
      });
      const merged = new Map<
        string,
        VocabularyRow & { topMap: Map<string, TopValue> }
      >();
      for (const field of fields) {
        if (!refreshedAt || field.refreshedAt > refreshedAt)
          refreshedAt = field.refreshedAt;
        const id = `field:${field.path}`;
        let row = merged.get(id);
        if (!row) {
          row = {
            kind: 'field',
            id,
            field: field.path,
            label: { label: field.path, detail: 'metadata' },
            sources: [],
            openCount: 0,
            assetCount: 0,
            distinctValues: 0,
            categorical: false,
            topValues: [],
            lastSeenAt: null,
            refreshedAt: field.refreshedAt,
            bindings: [],
            bound: false,
            topMap: new Map(),
          };
          merged.set(id, row);
        }
        row.sources.push({
          id: field.sourceId,
          name: sourceName.get(field.sourceId) ?? field.sourceId,
        });
        row.assetCount += field.assetCount;
        if (field.distinctValues === null || row.distinctValues === null)
          row.distinctValues = null;
        else
          row.distinctValues = Math.min(
            DISTINCT_CAP,
            Math.max(row.distinctValues, field.distinctValues),
          );
        for (const top of (field.topValues as TopValue[] | null) ?? []) {
          const key = glossaryNorm(top.value);
          const entry = row.topMap.get(key) ?? { value: top.value, count: 0 };
          entry.count += top.count;
          row.topMap.set(key, entry);
        }
      }
      for (const row of merged.values()) {
        row.topValues = [...row.topMap.values()]
          .sort((a, b) => b.count - a.count)
          .slice(0, TOP_VALUES);
        row.categorical =
          row.distinctValues !== null &&
          row.distinctValues <= CATEGORICAL_MAX_DISTINCT;
        row.bindings = bindings
          .filter((b) => !isOutputMode(b.mode) && b.metadataPath === row.field)
          .map((b) => this.bindingRef(b));
        row.bound = row.bindings.some((b) => b.status === 'APPROVED');
        const { topMap: _topMap, ...rest } = row;
        void _topMap;
        rows.push(rest);
      }
    }

    let filtered = rows;
    if (params.bound === 'true') filtered = filtered.filter((row) => row.bound);
    if (params.bound === 'false')
      filtered = filtered.filter((row) => !row.bound);
    if (params.q) {
      const needle = glossaryNorm(params.q);
      filtered = filtered.filter((row) =>
        glossaryNorm(
          `${row.label.label} ${row.label.detail} ${row.id}`,
        ).includes(needle),
      );
    }
    filtered.sort(
      (a, b) => b.openCount - a.openCount || b.assetCount - a.assetCount,
    );
    const take = Math.min(Math.max(Number(params.take ?? 100) || 100, 1), 500);
    const skip = Math.max(Number(params.skip ?? 0) || 0, 0);
    return {
      rows: filtered.slice(skip, skip + take),
      total: filtered.length,
      refreshedAt,
    };
  }

  private bindingRef(b: {
    id: string;
    mode: string;
    status: string;
    noMeaning: boolean;
    term: { id: string; key: string; term: string } | null;
    lookupScheme: { id: string; key: string; name: string } | null;
  }) {
    return {
      id: b.id,
      mode: b.mode,
      status: b.status,
      noMeaning: b.noMeaning,
      term: b.term,
      lookupScheme: b.lookupScheme,
    };
  }

  /**
   * Top values with counts for the dialog's pickers. Served from the
   * inventory; live (3 s timeout) only for outputs below 50,000 findings.
   */
  async values(params: {
    detectorType?: DetectorType;
    customDetectorKey?: string | null;
    findingType?: string;
    field?: string;
    sourceIds?: string[];
    limit?: number;
  }): Promise<{ values: TopValue[]; live: boolean; distinct: number | null }> {
    const limit = Math.min(Math.max(Number(params.limit ?? 50) || 50, 1), 200);
    if (params.field) {
      const rows = await this.prisma.vocabularyField.findMany({
        where: {
          path: params.field,
          ...(params.sourceIds?.length
            ? { sourceId: { in: params.sourceIds } }
            : {}),
        },
      });
      return {
        values: this.mergeTop(
          rows.map((r) => r.topValues),
          limit,
        ),
        live: false,
        distinct: rows[0]?.distinctValues ?? null,
      };
    }
    if (!params.detectorType || !params.findingType)
      return { values: [], live: false, distinct: null };
    const items = await this.prisma.vocabularyItem.findMany({
      where: {
        detectorType: params.detectorType,
        customDetectorKey: params.customDetectorKey ?? '',
        findingType: params.findingType,
        ...(params.sourceIds?.length
          ? { sourceId: { in: params.sourceIds } }
          : {}),
      },
    });
    const open = items.reduce((sum, item) => sum + item.openCount, 0);
    if (items.length && open >= VALUE_STATS_MAX_FINDINGS) {
      return {
        values: this.mergeTop(
          items.map((i) => i.topValues),
          limit,
        ),
        live: false,
        distinct: items[0]?.distinctValues ?? null,
      };
    }
    try {
      const rows = await withStatementTimeout(this.prisma, 3_000, (tx) =>
        tx.$queryRaw<Array<{ value: string; count: bigint }>>(Prisma.sql`
          SELECT mode() WITHIN GROUP (ORDER BY f.matched_content) AS value, count(*) AS count
            FROM findings f
           WHERE f.status = 'OPEN'
             AND f.detector_type = ${params.detectorType}::"DetectorType"
             AND COALESCE(f.custom_detector_key, '') = ${params.customDetectorKey ?? ''}
             AND f.finding_type = ${params.findingType}
             ${params.sourceIds?.length ? Prisma.sql`AND f.source_id = ANY(${params.sourceIds}::text[])` : Prisma.empty}
           GROUP BY glossary_norm(f.matched_content)
           ORDER BY count(*) DESC LIMIT ${limit}`),
      );
      return {
        values: rows.map((r) => ({ value: r.value, count: Number(r.count) })),
        live: true,
        distinct: null,
      };
    } catch {
      return {
        values: this.mergeTop(
          items.map((i) => i.topValues),
          limit,
        ),
        live: false,
        distinct: items[0]?.distinctValues ?? null,
      };
    }
  }

  private mergeTop(
    lists: Array<Prisma.JsonValue | null>,
    limit: number,
  ): TopValue[] {
    const merged = new Map<string, TopValue>();
    for (const list of lists) {
      for (const top of (list as TopValue[] | null) ?? []) {
        const key = glossaryNorm(top.value);
        const entry = merged.get(key) ?? { value: top.value, count: 0 };
        entry.count += top.count;
        merged.set(key, entry);
      }
    }
    return [...merged.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /** "Semantic coverage: 73% of open findings carry a meaning" (SL2 §6.3). */
  async coverage() {
    const latest = await this.prisma.semanticStat.findFirst({
      orderBy: { day: 'desc' },
    });
    const unbound = await this.list({
      kind: 'outputs',
      bound: 'false',
      take: 500,
    });
    return {
      openFindings: latest?.openFindings ?? null,
      findingsWithMeaning: latest?.findingsWithMeaning ?? null,
      assetsWithMeaning: latest?.assetsWithMeaning ?? null,
      share:
        latest && latest.openFindings > 0
          ? latest.findingsWithMeaning / latest.openFindings
          : null,
      computedAt: latest?.computedAt ?? null,
      unboundOutputs: unbound.total,
      unboundFindings: unbound.rows.reduce(
        (sum, row) => sum + row.openCount,
        0,
      ),
    };
  }

  async coverageHistory(days = 90) {
    const since = new Date(Date.now() - days * 86_400_000);
    return this.prisma.semanticStat.findMany({
      where: { day: { gte: since } },
      orderBy: { day: 'asc' },
    });
  }
}
