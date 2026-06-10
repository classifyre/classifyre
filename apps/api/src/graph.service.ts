import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import {
  BulkIngestEdgesDto,
  BulkIngestEdgesResponseDto,
  CreateManualEdgeDto,
  EdgeDetailDto,
  ExpandGraphDto,
  GraphDirection,
  GraphEdgeDto,
  GraphNodeDto,
  GraphResponseDto,
  PivotGraphDto,
  RebuildEdgesResponseDto,
  RelationTypesResponseDto,
  UpdateEdgeDto,
} from './dto/graph.dto';

/** Upper bound on nodes returned by a single traversal to keep the graph curated. */
const NODE_CAP = 200;
const MAX_DEPTH = 3;

/** Compose a finding node label from its type and (optionally) a truncated match. */
function findingLabel(type: string, matched?: string | null): string {
  if (!matched) return type;
  const t = matched.length > 35 ? `${matched.slice(0, 35)}…` : matched;
  return `${type}: ${t}`;
}

interface SeedNode {
  type: string;
  id: string;
}

interface CaseFindingSnapshot {
  id: string;
  findingId: string;
  label: string;
  severity: string | null;
  detectorType: string | null;
  customDetectorName: string | null;
  matchedContent: string | null;
}

interface CaseEvidenceWithFindings {
  id: string;
  entityType: string;
  entityId: string;
  label: string | null;
  assetType: string | null;
  sourceType: string | null;
  findings: CaseFindingSnapshot[];
}

interface RawEdgeRow {
  id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation_type: string;
  confidence: number;
  origin: string;
}

interface TraversalRow {
  node_type: string;
  node_id: string;
  depth: number | bigint;
}

interface EdgeRow {
  id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation_type: string;
  confidence: string | number;
  origin: GraphEdgeDto['origin'];
}

@Injectable()
export class GraphService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Edge inference ──────────────────────────────────────────────

  /**
   * Rebuild all inferred edges from existing data:
   *  - CONTAINS: asset → finding (one per finding)
   *  - REFERENCES: asset → asset (resolved from Asset.links)
   * Idempotent via the unique constraint on edges.
   */
  async rebuildEdges(): Promise<RebuildEdgesResponseDto> {
    await this.insertContainsEdges();

    const assetsWithLinks = await this.prisma.asset.findMany({
      where: { NOT: { links: { equals: [] } } },
      select: { id: true, links: true },
    });
    await this.createReferenceEdges(assetsWithLinks);

    const edgeCount = await this.prisma.edge.count();
    return { edgeCount };
  }

  /** Ensure inferred edges exist for a single asset (used when opening a case). */
  async inferEdgesForAsset(assetId: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO edges (id, from_type, from_id, to_type, to_id, relation_type, confidence, origin, created_at)
      SELECT gen_random_uuid(), 'asset', f.asset_id, 'finding', f.id, 'CONTAINS', f.confidence, 'INFERRED'::"EdgeOrigin", now()
      FROM findings f
      WHERE f.asset_id = ${assetId}
      ON CONFLICT (from_type, from_id, to_type, to_id, relation_type) DO NOTHING
    `;

    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, links: true },
    });
    if (asset) {
      await this.createReferenceEdges([asset]);
    }
  }

  private async insertContainsEdges(): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO edges (id, from_type, from_id, to_type, to_id, relation_type, confidence, origin, created_at)
      SELECT gen_random_uuid(), 'asset', f.asset_id, 'finding', f.id, 'CONTAINS', f.confidence, 'INFERRED'::"EdgeOrigin", now()
      FROM findings f
      ON CONFLICT (from_type, from_id, to_type, to_id, relation_type) DO NOTHING
    `;
  }

  /** Pull candidate target identifiers (ids or urls) out of an Asset.links JSONB value. */
  private extractLinkTargets(links: unknown): string[] {
    if (!Array.isArray(links)) return [];
    const out: string[] = [];
    for (const entry of links) {
      if (typeof entry === 'string') {
        out.push(entry);
      } else if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        for (const key of [
          'id',
          'assetId',
          'url',
          'href',
          'target',
          'externalUrl',
        ]) {
          const val = obj[key];
          if (typeof val === 'string' && val.length > 0) out.push(val);
        }
      }
    }
    return out;
  }

  private async createReferenceEdges(
    assets: { id: string; links: unknown }[],
  ): Promise<void> {
    const perAsset = assets
      .map((a) => ({ id: a.id, targets: this.extractLinkTargets(a.links) }))
      .filter((a) => a.targets.length > 0);
    if (perAsset.length === 0) return;

    const allTargets = Array.from(new Set(perAsset.flatMap((a) => a.targets)));
    const matches = await this.prisma.asset.findMany({
      where: {
        OR: [{ id: { in: allTargets } }, { externalUrl: { in: allTargets } }],
      },
      select: { id: true, externalUrl: true },
    });

    const byId = new Set(matches.map((m) => m.id));
    const byUrl = new Map(matches.map((m) => [m.externalUrl, m.id]));

    const rows: Prisma.EdgeCreateManyInput[] = [];
    const seen = new Set<string>();
    for (const a of perAsset) {
      for (const target of a.targets) {
        const targetId = byId.has(target) ? target : byUrl.get(target);
        if (!targetId || targetId === a.id) continue;
        const dedupe = `${a.id}->${targetId}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        rows.push({
          fromType: 'asset',
          fromId: a.id,
          toType: 'asset',
          toId: targetId,
          relationType: 'REFERENCES',
        });
      }
    }
    if (rows.length > 0) {
      await this.prisma.edge.createMany({ data: rows, skipDuplicates: true });
    }
  }

  // ─── Phase 1: Source-derived edges ───────────────────────────────

  /**
   * Bulk-upsert source-derived edges from a CLI connector.
   * Accepts either UUID-based (fromId/toId) or hash-based (fromHash/toHash) references.
   * Hash references are resolved to UUIDs before insertion; unresolvable hashes are skipped.
   * Idempotent via the unique constraint on edges.
   */
  async upsertEdges(
    dto: BulkIngestEdgesDto,
  ): Promise<BulkIngestEdgesResponseDto> {
    // Collect all hashes that need UUID resolution.
    const fromHashes = dto.edges
      .filter((e) => e.fromHash)
      .map((e) => e.fromHash!);
    const toHashes = dto.edges.filter((e) => e.toHash).map((e) => e.toHash!);
    const allHashes = Array.from(new Set([...fromHashes, ...toHashes]));

    let hashToId = new Map<string, string>();
    if (allHashes.length > 0) {
      // Assets use a base64-encoded hash stored in their `hash` column (via deterministic UUID).
      // The asset table uses `id` (UUID) as PK but the CLI-generated hash is the `hash` column.
      const assets = await this.prisma.asset.findMany({
        where: { hash: { in: allHashes } },
        select: { id: true, hash: true },
      });
      hashToId = new Map(assets.map((a) => [a.hash, a.id]));
    }

    const rows: Prisma.EdgeCreateManyInput[] = [];
    for (const e of dto.edges) {
      const fromId =
        e.fromId ?? (e.fromHash ? hashToId.get(e.fromHash) : undefined);
      const toId = e.toId ?? (e.toHash ? hashToId.get(e.toHash) : undefined);
      if (!fromId || !toId) continue; // skip unresolvable

      rows.push({
        fromType: e.fromType,
        fromId,
        toType: e.toType,
        toId,
        relationType: e.relationType,
        confidence: e.confidence ?? 1,
        origin: 'SOURCE_DERIVED',
      });
    }

    if (rows.length === 0) return { upserted: 0 };
    const result = await this.prisma.edge.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return { upserted: result.count };
  }

  /**
   * Named pivot questions on a node (Phase 1 / Phase 2 foundation).
   * Returns a sub-graph answering the chosen investigation question.
   */
  async pivot(dto: PivotGraphDto): Promise<GraphResponseDto> {
    const seed: SeedNode = { type: dto.entityType, id: dto.entityId };
    const depth = Math.min(dto.depth ?? 1, MAX_DEPTH);

    switch (dto.pivot) {
      case 'who_touched':
        // Incoming ACCESSED / READS / EXECUTED / WRITES edges
        return this.traverse([seed], depth, 'in', [
          'ACCESSED',
          'READS',
          'EXECUTED',
          'WRITES',
        ]);
      case 'upstream_lineage':
        return this.traverse([seed], depth, 'in', [
          'GENERATED_FROM',
          'READS',
          'OWNS',
        ]);
      case 'downstream_lineage':
        return this.traverse([seed], depth, 'out', [
          'GENERATED_FROM',
          'EXPORTED_TO',
          'WRITES',
        ]);
      case 'access':
        return this.traverse([seed], depth, 'both', [
          'OWNS',
          'ACCESSED',
          'READS',
          'WRITES',
        ]);
      case 'emails':
        return this.traverse([seed], depth, 'both', [
          'ATTACHED_TO',
          'SENT_TO',
          'MENTIONS',
        ]);
      case 'similar_findings':
        return this.traverse([seed], depth, 'both', ['CONTAINS']);
      default:
        return this.traverse([seed], depth, 'both');
    }
  }

  // ─── Phase 2: Manual edges ───────────────────────────────────────

  private static readonly BUILTIN_RELATION_TYPES = [
    'CONTAINS',
    'REFERENCES',
    'OWNS',
    'ACCESSED',
    'READS',
    'WRITES',
    'GENERATED_FROM',
    'EXPORTED_TO',
    'ATTACHED_TO',
    'SENT_TO',
    'EXECUTED',
    'MENTIONS',
  ];

  async getRelationTypes(): Promise<RelationTypesResponseDto> {
    const rows = await this.prisma.$queryRaw<
      { relation_type: string; cnt: bigint }[]
    >`
      SELECT relation_type, COUNT(*) AS cnt
      FROM edges
      GROUP BY relation_type
      ORDER BY cnt DESC
      LIMIT 100
    `;
    const inUse = rows.map((r) => r.relation_type);
    const builtinSet = new Set(GraphService.BUILTIN_RELATION_TYPES);
    const inUseSet = new Set(inUse);
    const suggestions = [
      ...inUse,
      ...GraphService.BUILTIN_RELATION_TYPES.filter((t) => !inUseSet.has(t)),
    ].filter((v, i, arr) => arr.indexOf(v) === i);
    // also include any custom types not in builtin list
    inUse
      .filter((t) => !builtinSet.has(t))
      .forEach((t) => {
        if (!suggestions.includes(t)) suggestions.push(t);
      });
    return { inUse, suggestions };
  }

  async createManualEdge(dto: CreateManualEdgeDto): Promise<EdgeDetailDto> {
    // Use raw SQL so the MANUAL enum value works regardless of the Prisma client
    // version loaded in the running server process (the enum was added post-startup).
    const confidence = dto.confidence ?? 1;
    const rows = await this.prisma.$queryRaw<RawEdgeRow[]>`
      INSERT INTO edges (id, from_type, from_id, to_type, to_id, relation_type, confidence, origin, created_at)
      VALUES (gen_random_uuid(), ${dto.fromType}, ${dto.fromId}, ${dto.toType}, ${dto.toId},
              ${dto.relationType}, ${confidence}, 'MANUAL'::"EdgeOrigin", now())
      ON CONFLICT (from_type, from_id, to_type, to_id, relation_type) DO UPDATE
        SET origin = EXCLUDED.origin
      RETURNING id, from_type, from_id, to_type, to_id, relation_type,
                confidence::float AS confidence, origin::text AS origin
    `;
    if (rows.length === 0) throw new Error('Edge insert returned no row');
    return this.rawRowToDetail(rows[0]);
  }

  async updateEdge(id: string, dto: UpdateEdgeDto): Promise<EdgeDetailDto> {
    const existing = await this.prisma.edge.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Edge ${id} not found`);
    if (existing.origin === 'INFERRED') {
      throw new BadRequestException(
        'Inferred edges are re-created automatically and cannot be renamed. ' +
          'Create a manual edge with the desired label instead.',
      );
    }
    // Delete+insert atomically because relationType is part of the unique key.
    const rows = await this.prisma.$queryRaw<RawEdgeRow[]>`
      WITH deleted AS (
        DELETE FROM edges WHERE id = ${id} RETURNING from_type, from_id, to_type, to_id, confidence, origin
      )
      INSERT INTO edges (id, from_type, from_id, to_type, to_id, relation_type, confidence, origin, created_at)
      SELECT gen_random_uuid(), from_type, from_id, to_type, to_id,
             ${dto.relationType}, confidence, origin, now()
      FROM deleted
      ON CONFLICT (from_type, from_id, to_type, to_id, relation_type) DO UPDATE
        SET origin = EXCLUDED.origin
      RETURNING id, from_type, from_id, to_type, to_id, relation_type,
                confidence::float AS confidence, origin::text AS origin
    `;
    if (rows.length === 0) throw new Error('Edge rename returned no row');
    return this.rawRowToDetail(rows[0]);
  }

  async deleteEdge(id: string): Promise<void> {
    const existing = await this.prisma.edge.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Edge ${id} not found`);
    if (existing.origin === 'INFERRED') {
      throw new BadRequestException(
        'Inferred edges are re-created automatically and cannot be deleted. ' +
          'You can rename or delete manual edges only.',
      );
    }
    await this.prisma.edge.delete({ where: { id } });
  }

  private rawRowToDetail(row: RawEdgeRow): EdgeDetailDto {
    return {
      id: row.id,
      fromType: row.from_type,
      fromId: row.from_id,
      toType: row.to_type,
      toId: row.to_id,
      relationType: row.relation_type,
      confidence: Number(row.confidence),
      origin: row.origin,
    };
  }

  // ─── Traversal ───────────────────────────────────────────────────

  async expand(dto: ExpandGraphDto): Promise<GraphResponseDto> {
    const depth = Math.min(dto.depth ?? 1, MAX_DEPTH);
    return this.traverse(
      [{ type: dto.entityType, id: dto.entityId }],
      depth,
      dto.direction ?? 'both',
      dto.relationTypes,
    );
  }

  /**
   * Build the question graph. The question's own records (question_evidence +
   * question_findings) are the source of truth: their denormalized snapshots make
   * every linked node survive deletion of the underlying asset/finding, and let
   * sandbox evidence — which has no asset/finding rows — appear as first-class
   * nodes. The live edge neighbourhood of real assets is layered on top for
   * relationships and unlinked findings.
   */
  async caseGraph(caseId: string, depth = 1): Promise<GraphResponseDto> {
    const evidence = await this.prisma.caseEvidence.findMany({
      where: { caseId },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        label: true,
        assetType: true,
        sourceType: true,
        findings: {
          select: {
            id: true,
            findingId: true,
            label: true,
            severity: true,
            detectorType: true,
            customDetectorName: true,
            matchedContent: true,
          },
        },
      },
    });
    if (evidence.length === 0) {
      return { nodes: [], edges: [], truncated: false };
    }

    // Refresh inferred edges for real assets so the live neighbourhood is current.
    const assetEvidence = evidence.filter((e) => e.entityType === 'asset');
    for (const e of assetEvidence) {
      await this.inferEdgesForAsset(e.entityId);
    }

    // Live neighbourhood of the real assets (relationships + unlinked findings).
    const base =
      assetEvidence.length > 0
        ? await this.traverse(
            assetEvidence.map((e) => ({ type: 'asset', id: e.entityId })),
            Math.min(depth, MAX_DEPTH),
            'both',
          )
        : { nodes: [], edges: [], truncated: false };

    return this.mergeCaseGraph(caseId, evidence, base);
  }

  /**
   * Overlay the case's denormalized evidence/finding snapshots onto the live
   * base graph (filling in nodes for deleted assets), then annotate hypothesis
   * affiliation and mark cross-hypothesis edges.
   */
  private async mergeCaseGraph(
    caseId: string,
    evidence: CaseEvidenceWithFindings[],
    base: GraphResponseDto,
  ): Promise<GraphResponseDto> {
    const key = (type: string, id: string) => `${type}:${id}`;
    const nodes = new Map(base.nodes.map((n) => [key(n.type, n.id), n]));
    const edges = [...base.edges];

    // Evidence nodes — add missing/deleted nodes, refresh labels from snapshots.
    for (const e of evidence) {
      const k = key(e.entityType, e.entityId);
      const existing = nodes.get(k);
      if (existing && !existing.missing) continue;
      nodes.set(k, {
        id: e.entityId,
        type: e.entityType,
        depth: 0,
        label: e.label ?? e.entityId,
        assetType: e.assetType ?? undefined,
        sourceType: e.sourceType ?? undefined,
      });
    }

    // Linked finding nodes — snapshot labels survive deletion; synthesize the
    // CONTAINS edge for findings whose asset was deleted (no live edge).
    for (const e of evidence) {
      for (const cf of e.findings) {
        const k = key('finding', cf.findingId);
        const existing = nodes.get(k);
        if (!existing || existing.missing) {
          nodes.set(k, {
            id: cf.findingId,
            type: 'finding',
            depth: 1,
            label: findingLabel(cf.label, cf.matchedContent),
            severity: cf.severity ?? undefined,
            detectorType: cf.detectorType ?? undefined,
            customDetectorName: cf.customDetectorName ?? undefined,
            matchedContent: cf.matchedContent ?? undefined,
            assetId: e.entityId,
            assetName: e.label ?? undefined,
          });
          edges.push({
            id: `synthetic:contains:${e.entityId}:${cf.findingId}`,
            fromType: e.entityType,
            fromId: e.entityId,
            toType: 'finding',
            toId: cf.findingId,
            relationType: 'CONTAINS',
            confidence: 1,
            origin: 'INFERRED',
          });
        }
      }
    }

    return this.annotateWithHypotheses(evidence, {
      nodes: [...nodes.values()],
      edges,
      truncated: base.truncated,
    });
  }

  /**
   * Enrich graph nodes with thread affiliation (hypothesisIds field — same UUIDs as
   * old hypothesis rows, preserved by migration) and mark cross-thread edges.
   */
  private async annotateWithHypotheses(
    evidence: CaseEvidenceWithFindings[],
    graph: GraphResponseDto,
  ): Promise<GraphResponseDto> {
    const key = (type: string, id: string) => `${type}:${id}`;

    const caseFindingIds = evidence.flatMap((e) =>
      e.findings.map((cf) => cf.id),
    );
    const supportRows = await this.prisma.caseThreadSupport.findMany({
      where: {
        thread: { kind: 'HYPOTHESIS' },
        OR: [
          {
            targetType: 'evidence',
            targetId: { in: evidence.map((e) => e.id) },
          },
          ...(caseFindingIds.length > 0
            ? [{ targetType: 'finding', targetId: { in: caseFindingIds } }]
            : []),
        ],
      },
      select: { targetId: true, targetType: true, threadId: true },
    });
    const evidenceToThreads = new Map<string, string[]>();
    const caseFindingToThreads = new Map<string, string[]>();
    for (const row of supportRows) {
      const map =
        row.targetType === 'evidence'
          ? evidenceToThreads
          : caseFindingToThreads;
      const arr = map.get(row.targetId) ?? [];
      arr.push(row.threadId);
      map.set(row.targetId, arr);
    }

    // node key → threadId[]. Evidence nodes carry their own support; findings
    // combine their parent evidence's support (inherited) with links that
    // target the CaseFinding record directly.
    const nodeToThreads = new Map<string, string[]>();
    const findingToCaseFindingId = new Map<string, string>();
    for (const e of evidence) {
      const threads = evidenceToThreads.get(e.id) ?? [];
      nodeToThreads.set(key(e.entityType, e.entityId), threads);
      for (const cf of e.findings) {
        const own = caseFindingToThreads.get(cf.id) ?? [];
        nodeToThreads.set(key('finding', cf.findingId), [
          ...new Set([...threads, ...own]),
        ]);
        findingToCaseFindingId.set(cf.findingId, cf.id);
      }
    }

    const nodes: GraphNodeDto[] = graph.nodes.map((n) => {
      const hypothesisIds = nodeToThreads.get(key(n.type, n.id)) ?? [];
      const caseFindingId =
        n.type === 'finding' ? findingToCaseFindingId.get(n.id) : undefined;
      return {
        ...n,
        hypothesisIds,
        ...(caseFindingId ? { caseFindingId } : {}),
      };
    });

    const edges: GraphEdgeDto[] = graph.edges.map((e) => {
      const fromThreads = new Set(
        nodeToThreads.get(key(e.fromType, e.fromId)) ?? [],
      );
      const toThreads = new Set(nodeToThreads.get(key(e.toType, e.toId)) ?? []);
      const crossHypothesis =
        fromThreads.size > 0 &&
        toThreads.size > 0 &&
        ![...fromThreads].some((h) => toThreads.has(h));
      return { ...e, crossHypothesis };
    });

    return { nodes, edges, truncated: graph.truncated };
  }

  private async traverse(
    seeds: SeedNode[],
    depth: number,
    direction: GraphDirection,
    relationTypes?: string[],
  ): Promise<GraphResponseDto> {
    if (seeds.length === 0) {
      return { nodes: [], edges: [], truncated: false };
    }

    const seedValues = Prisma.join(
      seeds.map((s) => Prisma.sql`(${s.type}, ${s.id})`),
    );
    const relFilter =
      relationTypes && relationTypes.length > 0
        ? Prisma.sql`AND e.relation_type IN (${Prisma.join(relationTypes)})`
        : Prisma.empty;

    const outward = Prisma.sql`
      SELECT e.to_type AS node_type, e.to_id AS node_id
      FROM edges e
      WHERE e.from_type = t.node_type AND e.from_id = t.node_id ${relFilter}`;
    const inward = Prisma.sql`
      SELECT e.from_type AS node_type, e.from_id AS node_id
      FROM edges e
      WHERE e.to_type = t.node_type AND e.to_id = t.node_id ${relFilter}`;
    const neighbor =
      direction === 'out'
        ? outward
        : direction === 'in'
          ? inward
          : Prisma.sql`${outward} UNION ${inward}`;

    const nodeRows = await this.prisma.$queryRaw<TraversalRow[]>(Prisma.sql`
      WITH RECURSIVE traversal(node_type, node_id, depth) AS (
        SELECT seed.node_type::text, seed.node_id::text, 0
        FROM (VALUES ${seedValues}) AS seed(node_type, node_id)
        UNION
        SELECT nb.node_type, nb.node_id, t.depth + 1
        FROM traversal t
        JOIN LATERAL (
          ${neighbor}
        ) nb ON true
        WHERE t.depth < ${depth}
      )
      SELECT node_type, node_id, MIN(depth) AS depth
      FROM traversal
      GROUP BY node_type, node_id
      ORDER BY MIN(depth) ASC
      LIMIT ${NODE_CAP}
    `);

    const truncated = nodeRows.length >= NODE_CAP;
    const nodes = await this.hydrateNodes(nodeRows);

    const nodeTuples = Prisma.join(
      nodeRows.map((n) => Prisma.sql`(${n.node_type}, ${n.node_id})`),
    );
    const edgeRows = await this.prisma.$queryRaw<EdgeRow[]>(Prisma.sql`
      SELECT id, from_type, from_id, to_type, to_id, relation_type, confidence, origin
      FROM edges e
      WHERE (e.from_type, e.from_id) IN (${nodeTuples})
        AND (e.to_type, e.to_id) IN (${nodeTuples})
    `);

    const edges: GraphEdgeDto[] = edgeRows.map((e) => ({
      id: e.id,
      fromType: e.from_type,
      fromId: e.from_id,
      toType: e.to_type,
      toId: e.to_id,
      relationType: e.relation_type,
      confidence: Number(e.confidence),
      origin: e.origin,
    }));

    return { nodes, edges, truncated };
  }

  private async hydrateNodes(rows: TraversalRow[]): Promise<GraphNodeDto[]> {
    const assetIds = rows
      .filter((r) => r.node_type === 'asset')
      .map((r) => r.node_id);
    const findingIds = rows
      .filter((r) => r.node_type === 'finding')
      .map((r) => r.node_id);

    const [assets, findings] = await Promise.all([
      this.prisma.asset.findMany({
        where: { id: { in: assetIds } },
        select: {
          id: true,
          name: true,
          assetType: true,
          sourceType: true,
          status: true,
        },
      }),
      this.prisma.finding.findMany({
        where: { id: { in: findingIds } },
        select: {
          id: true,
          findingType: true,
          matchedContent: true,
          severity: true,
          detectorType: true,
          customDetectorName: true,
          status: true,
          assetId: true,
        },
      }),
    ]);

    // Fetch parent asset names for findings whose asset isn't already in the graph.
    const findingAssetIds = findings
      .map((f) => f.assetId)
      .filter((id) => !assetIds.includes(id));
    const findingAssets =
      findingAssetIds.length > 0
        ? await this.prisma.asset.findMany({
            where: { id: { in: findingAssetIds } },
            select: { id: true, name: true },
          })
        : [];
    const findingAssetMap = new Map(findingAssets.map((a) => [a.id, a]));
    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const findingMap = new Map(findings.map((f) => [f.id, f]));

    return rows.map((r) => {
      const depth = Number(r.depth);
      if (r.node_type === 'asset') {
        const a = assetMap.get(r.node_id);
        return {
          id: r.node_id,
          type: 'asset',
          depth,
          label: a?.name ?? '(deleted asset)',
          assetType: a?.assetType,
          sourceType: a ? String(a.sourceType) : undefined,
          status: a ? String(a.status) : undefined,
          missing: !a,
        };
      }
      const f = findingMap.get(r.node_id);
      const parentAsset = f
        ? (assetMap.get(f.assetId) ?? findingAssetMap.get(f.assetId))
        : undefined;
      return {
        id: r.node_id,
        type: 'finding',
        depth,
        label: f
          ? findingLabel(f.findingType, f.matchedContent)
          : '(deleted finding)',
        severity: f ? String(f.severity) : undefined,
        detectorType: f ? String(f.detectorType) : undefined,
        customDetectorName: f?.customDetectorName ?? undefined,
        status: f ? String(f.status) : undefined,
        matchedContent: f?.matchedContent ?? undefined,
        assetId: f?.assetId ?? undefined,
        assetName: parentAsset?.name ?? undefined,
        missing: !f,
      };
    });
  }
}
