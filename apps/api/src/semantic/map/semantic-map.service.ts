import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { withStatementTimeout } from '../semantic-sql';
import { VocabularyService } from '../vocabulary/vocabulary.service';

const SOURCE_FILTER_TIMEOUT_MS = 3_000;
const SOURCE_FILTER_CACHE_MS = 60_000;
const COOCCURRENCE_PER_NODE = 3;
const REBUILD_TIMEOUT_MS = 120_000;

type SeverityCounts = Record<string, number>;

export interface SemanticMapNode {
  termId: string;
  key: string;
  name: string;
  kind: string;
  definition: string | null;
  scheme: { id: string; key: string; name: string; color: string | null } | null;
  directAssetCount: number;
  totalAssetCount: number;
  findingCount: number;
  sourceCount: number;
  severityCounts: SeverityCounts;
  lastLinkedAt: Date | null;
  pendingProposals: number;
  broaderIds: string[];
  /** Kept only to connect a tree: an ancestor below `minAssets`. */
  context: boolean;
}

export interface SemanticMapLink {
  a: string;
  b: string;
  kind: string;
  label: string;
  assetCount: number;
  lift: number | null;
}

const sourceCountCache = new Map<string, { at: number; rows: Map<string, { total: number; direct: number; severity: SeverityCounts; sources: number }> }>();

/**
 * The workspace semantic map (SL5 Part B): concepts sized by evidence, ringed
 * by severity, joined by taxonomy, relations and co-occurrence. Built like the
 * source connection map — aggregation never leaves Postgres and the rollups
 * keep the response small whatever the corpus size. Derived and cleanable.
 */
@Injectable()
export class SemanticMapService {
  private readonly logger = new Logger(SemanticMapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vocabulary: VocabularyService,
  ) {}

  async isBuilt(): Promise<boolean> {
    const state = await this.prisma.termGraphState.findUnique({ where: { id: 'singleton' } });
    return Boolean(state?.isBuilt);
  }

  /** Rebuild every rollup. ≤ 30 s at 4 M asset_terms rows (SL5 B6). */
  async rebuild(): Promise<{ nodes: number; links: number; durationMs: number }> {
    const started = Date.now();
    const settings = await this.prisma.instanceSettings.findUnique({ where: { id: 1 } });
    const minSupport = settings?.suggestionCooccurrenceMinSupport ?? 20;
    const result = await withStatementTimeout(this.prisma, REBUILD_TIMEOUT_MS, async (tx) => {
      await tx.$executeRaw`TRUNCATE TABLE term_graph_nodes`;
      await tx.$executeRaw`TRUNCATE TABLE term_graph_links`;
      const nodes = await tx.$executeRaw`
        INSERT INTO term_graph_nodes (term_id, scheme_id, direct_asset_count, total_asset_count,
                                      finding_count, source_count, severity_counts, last_linked_at)
        WITH RECURSIVE closure(root, term_id, depth) AS (
          SELECT id, id, 0 FROM glossary_terms WHERE status = 'APPROVED'
          UNION
          SELECT c.root, r.from_term_id, c.depth + 1
            FROM closure c
            JOIN glossary_relations r ON r.to_term_id = c.term_id
             AND r.type = 'BROADER' AND r.status = 'APPROVED'
           WHERE c.depth < 10
        ),
        per_asset AS (
          SELECT c.root, l.asset_id, min(l.source_id) AS source_id,
                 min(l.max_severity) AS severity,
                 coalesce(sum(l.support_count) FILTER (WHERE l.method IN ('BINDING', 'MANUAL')), 0) AS findings,
                 max(l.last_linked_at) AS last_linked_at,
                 bool_or(l.term_id = c.root) AS direct
            FROM closure c
            JOIN asset_terms l ON l.term_id = c.term_id AND l.gone_at IS NULL
           GROUP BY c.root, l.asset_id
        ),
        rolled AS (
          SELECT root,
                 count(*) FILTER (WHERE direct) AS direct_assets,
                 count(*) AS total_assets,
                 sum(findings) AS findings,
                 count(DISTINCT source_id) AS sources,
                 max(last_linked_at) AS last_linked_at
            FROM per_asset
           GROUP BY root
        ),
        severities AS (
          SELECT root, jsonb_object_agg(coalesce(severity::text, 'NONE'), n) AS severity_counts
            FROM (SELECT root, severity, count(*) AS n FROM per_asset GROUP BY root, severity) s
           GROUP BY root
        )
        SELECT g.id, g.scheme_id,
               coalesce(r.direct_assets, 0), coalesce(r.total_assets, 0),
               coalesce(r.findings, 0), coalesce(r.sources, 0),
               coalesce(s.severity_counts, '{}'::jsonb), r.last_linked_at
          FROM glossary_terms g
          LEFT JOIN rolled r ON r.root = g.id
          LEFT JOIN severities s ON s.root = g.id
         WHERE g.status = 'APPROVED'`;
      const relations = await tx.$executeRaw`
        INSERT INTO term_graph_links (term_a_id, term_b_id, kind, label, asset_count, lift)
        SELECT r.from_term_id, r.to_term_id, r.type::text, r.label, 0, NULL
          FROM glossary_relations r
          JOIN glossary_terms a ON a.id = r.from_term_id AND a.status = 'APPROVED'
          JOIN glossary_terms b ON b.id = r.to_term_id AND b.status = 'APPROVED'
         WHERE r.status = 'APPROVED'
        ON CONFLICT DO NOTHING`;
      const cooccurrence = await tx.$executeRaw`
        INSERT INTO term_graph_links (term_a_id, term_b_id, kind, label, asset_count, lift)
        WITH current AS (
          SELECT DISTINCT t.asset_id, t.term_id FROM asset_terms t
            JOIN glossary_terms g ON g.id = t.term_id AND g.status = 'APPROVED'
           WHERE t.gone_at IS NULL
        ),
        per_term AS (SELECT term_id, count(*) AS n FROM current GROUP BY term_id),
        total AS (SELECT greatest(count(DISTINCT asset_id), 1) AS n FROM current),
        pairs AS (
          SELECT x.term_id AS a, y.term_id AS b, count(*) AS support
            FROM current x JOIN current y ON y.asset_id = x.asset_id AND x.term_id < y.term_id
           GROUP BY 1, 2 HAVING count(*) >= ${minSupport}
        ),
        scored AS (
          SELECT p.a, p.b, p.support,
                 (p.support::float8 * (SELECT n FROM total)) / greatest(pa.n * pb.n, 1) AS lift
            FROM pairs p JOIN per_term pa ON pa.term_id = p.a JOIN per_term pb ON pb.term_id = p.b
        ),
        ranked AS (
          SELECT *, row_number() OVER (PARTITION BY a ORDER BY lift DESC) AS ra,
                    row_number() OVER (PARTITION BY b ORDER BY lift DESC) AS rb
            FROM scored WHERE lift > 1
        )
        SELECT a, b, 'CO_OCCURRENCE', '', support, round(lift::numeric, 3)
          FROM ranked WHERE ra <= ${COOCCURRENCE_PER_NODE} OR rb <= ${COOCCURRENCE_PER_NODE}
        ON CONFLICT DO NOTHING`;
      return { nodes, links: relations + cooccurrence };
    });
    const durationMs = Date.now() - started;
    await this.prisma.termGraphState.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', isBuilt: true, refreshedAt: new Date(), durationMs },
      update: { isBuilt: true, refreshedAt: new Date(), durationMs },
    });
    sourceCountCache.clear();
    this.logger.log(`Semantic map rebuilt: ${result.nodes} nodes, ${result.links} links in ${durationMs} ms.`);
    return { ...result, durationMs };
  }

  /** Live per-term counts for a source filter (3 s timeout, 60 s cache). */
  private async sourceCounts(sourceIds: string[]) {
    const key = [...sourceIds].sort().join(',');
    const cached = sourceCountCache.get(key);
    if (cached && Date.now() - cached.at < SOURCE_FILTER_CACHE_MS) return cached.rows;
    const rows = await withStatementTimeout(this.prisma, SOURCE_FILTER_TIMEOUT_MS, (tx) =>
      tx.$queryRaw<Array<{ root: string; direct: boolean; severity: string | null; n: bigint }>>`
        WITH RECURSIVE closure(root, term_id, depth) AS (
          SELECT id, id, 0 FROM glossary_terms WHERE status = 'APPROVED'
          UNION
          SELECT c.root, r.from_term_id, c.depth + 1 FROM closure c
            JOIN glossary_relations r ON r.to_term_id = c.term_id AND r.type = 'BROADER' AND r.status = 'APPROVED'
           WHERE c.depth < 10
        ),
        per_asset AS (
          SELECT c.root, l.asset_id, min(l.max_severity) AS severity,
                 bool_or(l.term_id = c.root) AS direct
            FROM closure c JOIN asset_terms l ON l.term_id = c.term_id AND l.gone_at IS NULL
           WHERE l.source_id = ANY(${sourceIds}::text[])
           GROUP BY c.root, l.asset_id
        )
        SELECT root, direct, severity::text AS severity, count(*) AS n
          FROM per_asset GROUP BY root, direct, severity`,
    );
    const out = new Map<string, { total: number; direct: number; severity: SeverityCounts; sources: number }>();
    for (const row of rows) {
      const entry = out.get(row.root) ?? { total: 0, direct: 0, severity: {}, sources: 0 };
      const n = Number(row.n);
      entry.total += n;
      if (row.direct) entry.direct += n;
      const sev = row.severity ?? 'NONE';
      entry.severity[sev] = (entry.severity[sev] ?? 0) + n;
      out.set(row.root, entry);
    }
    sourceCountCache.set(key, { at: Date.now(), rows: out });
    return out;
  }

  async map(params: {
    schemeIds?: string[];
    sourceIds?: string[];
    minAssets?: number;
    cooccurrence?: boolean;
    caseId?: string;
    includeEntities?: boolean;
  }) {
    let liveBuild = false;
    if (!(await this.isBuilt())) {
      await this.rebuild();
      liveBuild = true;
    }
    const minAssets = Math.max(Number(params.minAssets ?? 1) || 0, 0);
    const [rows, terms, relations, state, pending] = await Promise.all([
      this.prisma.termGraphNode.findMany(),
      this.prisma.glossaryTerm.findMany({
        where: {
          status: 'APPROVED',
          kind: params.includeEntities ? undefined : 'CONCEPT',
          ...(params.schemeIds?.length ? { schemeId: { in: params.schemeIds } } : {}),
        },
        select: {
          id: true,
          key: true,
          term: true,
          kind: true,
          definition: true,
          scheme: { select: { id: true, key: true, name: true, color: true } },
        },
      }),
      this.prisma.termGraphLink.findMany(),
      this.prisma.termGraphState.findUnique({ where: { id: 'singleton' } }),
      this.prisma.semanticSuggestion.groupBy({
        by: ['termId'],
        where: { status: 'PROPOSED', termId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const filtered = params.sourceIds?.length ? await this.sourceCounts(params.sourceIds).catch(() => null) : null;
    const rowById = new Map(rows.map((row) => [row.termId, row]));
    const pendingById = new Map(pending.map((p) => [p.termId ?? '', p._count._all]));
    const broaderOf = new Map<string, string[]>();
    for (const link of relations) {
      if (link.kind === 'BROADER') {
        broaderOf.set(link.termAId, [...(broaderOf.get(link.termAId) ?? []), link.termBId]);
      }
    }
    const nodes = new Map<string, SemanticMapNode>();
    const termById = new Map(terms.map((t) => [t.id, t]));
    const build = (termId: string, context: boolean): SemanticMapNode | null => {
      const term = termById.get(termId);
      if (!term) return null;
      const row = rowById.get(termId);
      const live = filtered?.get(termId);
      return {
        termId,
        key: term.key,
        name: term.term,
        kind: term.kind,
        definition: term.definition ? term.definition.slice(0, 300) : null,
        scheme: term.scheme,
        directAssetCount: filtered ? (live?.direct ?? 0) : (row?.directAssetCount ?? 0),
        totalAssetCount: filtered ? (live?.total ?? 0) : (row?.totalAssetCount ?? 0),
        findingCount: row?.findingCount ?? 0,
        sourceCount: filtered ? (params.sourceIds?.length ?? 0) : (row?.sourceCount ?? 0),
        severityCounts: filtered ? (live?.severity ?? {}) : ((row?.severityCounts as SeverityCounts | null) ?? {}),
        lastLinkedAt: row?.lastLinkedAt ?? null,
        pendingProposals: pendingById.get(termId) ?? 0,
        broaderIds: broaderOf.get(termId) ?? [],
        context,
      };
    };
    for (const term of terms) {
      const node = build(term.id, false);
      if (node && node.totalAssetCount >= minAssets) nodes.set(term.id, node);
    }
    // Broader ancestors stay, even when empty, so trees stay connected.
    const queue = [...nodes.keys()];
    while (queue.length) {
      const id = queue.pop()!;
      for (const parent of broaderOf.get(id) ?? []) {
        if (nodes.has(parent)) continue;
        const node = build(parent, true);
        if (node) {
          nodes.set(parent, node);
          queue.push(parent);
        }
      }
    }
    const links: SemanticMapLink[] = relations
      .filter((link) => nodes.has(link.termAId) && nodes.has(link.termBId))
      .filter((link) => params.cooccurrence || link.kind !== 'CO_OCCURRENCE')
      .map((link) => ({
        a: link.termAId,
        b: link.termBId,
        kind: link.kind,
        label: link.label,
        assetCount: link.assetCount,
        lift: link.lift === null ? null : Number(link.lift),
      }));
    let overlay: { caseId: string; termIds: string[] } | undefined;
    if (params.caseId) {
      const overlayRows = await this.prisma.$queryRaw<Array<{ term_id: string }>>`
        SELECT DISTINCT t.term_id FROM case_evidence ce
          JOIN asset_terms t ON t.asset_id = ce.entity_id AND t.gone_at IS NULL
         WHERE ce.case_id = ${params.caseId} AND ce.entity_type = 'asset'
        UNION
        SELECT r.glossary_term_id FROM glossary_references r
         WHERE r.role = 'ABOUT' AND r.entity_type = 'case' AND r.entity_id = ${params.caseId}`;
      overlay = { caseId: params.caseId, termIds: overlayRows.map((r) => r.term_id) };
    }
    const coverage = await this.vocabulary.coverage().catch(() => null);
    const [conceptCount, linkedTerms] = await Promise.all([
      this.prisma.glossaryTerm.count({ where: { kind: 'CONCEPT' } }),
      this.prisma.termGraphNode.count({ where: { directAssetCount: { gt: 0 } } }),
    ]);
    return {
      nodes: [...nodes.values()],
      links,
      overlay,
      unbound: {
        outputs: coverage?.unboundOutputs ?? 0,
        findings: coverage?.unboundFindings ?? 0,
      },
      coverage: coverage
        ? { share: coverage.share, openFindings: coverage.openFindings, findingsWithMeaning: coverage.findingsWithMeaning }
        : null,
      freshness: {
        refreshedAt: state?.refreshedAt ?? null,
        durationMs: state?.durationMs ?? null,
        isBuilt: Boolean(state?.isBuilt),
        liveBuild,
        sourceFilterTimedOut: Boolean(params.sourceIds?.length) && filtered === null,
      },
      empty: conceptCount === 0 ? 'NO_CONCEPTS' : linkedTerms === 0 ? 'NO_LINKS' : null,
    };
  }

  /** The rail for one concept (SL5 B3). */
  async termRail(termId: string) {
    const term = await this.prisma.glossaryTerm.findUnique({
      where: { id: termId },
      select: {
        id: true,
        key: true,
        term: true,
        kind: true,
        status: true,
        definition: true,
        scheme: { select: { id: true, key: true, name: true, color: true } },
      },
    });
    if (!term) throw new NotFoundException(`Glossary term ${termId} not found`);
    const [node, bySource, bindings, narrower, cooccurring, pending] = await Promise.all([
      this.prisma.termGraphNode.findUnique({ where: { termId } }),
      this.prisma.$queryRaw<Array<{ source_id: string; name: string; assets: bigint }>>`
        SELECT t.source_id, s.name, count(DISTINCT t.asset_id) AS assets
          FROM asset_terms t JOIN sources s ON s.id = t.source_id
         WHERE t.term_id = ${termId} AND t.gone_at IS NULL
         GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`,
      this.prisma.glossaryBinding.count({ where: { termId, status: 'APPROVED' } }),
      this.prisma.glossaryRelation.findMany({
        where: { toTermId: termId, type: 'BROADER', status: 'APPROVED' },
        include: { from: { select: { id: true, key: true, term: true } } },
      }),
      this.prisma.termGraphLink.findMany({
        where: { kind: 'CO_OCCURRENCE', OR: [{ termAId: termId }, { termBId: termId }] },
        orderBy: { lift: 'desc' },
        take: 5,
      }),
      this.prisma.semanticSuggestion.count({ where: { termId, status: 'PROPOSED' } }),
    ]);
    const otherIds = cooccurring.map((c) => (c.termAId === termId ? c.termBId : c.termAId));
    const others = await this.prisma.glossaryTerm.findMany({
      where: { id: { in: otherIds } },
      select: { id: true, key: true, term: true },
    });
    const otherById = new Map(others.map((o) => [o.id, o]));
    return {
      term: { ...term, definition: term.definition?.slice(0, 300) ?? null },
      counts: {
        assets: node?.totalAssetCount ?? 0,
        directAssets: node?.directAssetCount ?? 0,
        findings: node?.findingCount ?? 0,
        sources: node?.sourceCount ?? 0,
      },
      bySource: bySource.map((r) => ({ sourceId: r.source_id, name: r.name, assets: Number(r.assets) })),
      bindings,
      narrower: narrower.map((r) => r.from),
      cooccurring: cooccurring.map((c) => ({
        term: otherById.get(c.termAId === termId ? c.termBId : c.termAId) ?? null,
        assets: c.assetCount,
        lift: c.lift === null ? null : Number(c.lift),
      })),
      pendingProposals: pending,
    };
  }

  /** A compact summary for agents (MCP get_semantic_map). */
  async summary(limit = 30) {
    const map = await this.map({ minAssets: 1, cooccurrence: true });
    const top = [...map.nodes].sort((a, b) => b.totalAssetCount - a.totalAssetCount).slice(0, limit);
    const ids = new Set(top.map((n) => n.termId));
    const name = new Map(map.nodes.map((n) => [n.termId, n.name]));
    return {
      concepts: top.map((n) => ({
        key: n.key,
        name: n.name,
        scheme: n.scheme?.name ?? null,
        assets: n.totalAssetCount,
        directAssets: n.directAssetCount,
        findings: n.findingCount,
        broader: n.broaderIds.map((id) => name.get(id)).filter(Boolean),
      })),
      relations: map.links
        .filter((l) => ids.has(l.a) || ids.has(l.b))
        .slice(0, 100)
        .map((l) => ({ from: name.get(l.a), to: name.get(l.b), kind: l.kind, label: l.label || undefined, assets: l.assetCount || undefined, lift: l.lift ?? undefined })),
      unbound: map.unbound,
      coverage: map.coverage,
      freshness: map.freshness,
    };
  }
}
