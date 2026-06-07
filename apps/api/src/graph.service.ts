import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

interface SeedNode {
  type: string;
  id: string;
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
        for (const key of ['id', 'assetId', 'url', 'href', 'target', 'externalUrl']) {
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

    const allTargets = Array.from(
      new Set(perAsset.flatMap((a) => a.targets)),
    );
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
  async upsertEdges(dto: BulkIngestEdgesDto): Promise<BulkIngestEdgesResponseDto> {
    // Collect all hashes that need UUID resolution.
    const fromHashes = dto.edges.filter((e) => e.fromHash).map((e) => e.fromHash!);
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
      const fromId = e.fromId ?? (e.fromHash ? hashToId.get(e.fromHash) : undefined);
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
    const result = await this.prisma.edge.createMany({ data: rows, skipDuplicates: true });
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
        return this.traverse([seed], depth, 'in', ['ACCESSED', 'READS', 'EXECUTED', 'WRITES']);
      case 'upstream_lineage':
        return this.traverse([seed], depth, 'in', ['GENERATED_FROM', 'READS', 'OWNS']);
      case 'downstream_lineage':
        return this.traverse([seed], depth, 'out', ['GENERATED_FROM', 'EXPORTED_TO', 'WRITES']);
      case 'access':
        return this.traverse([seed], depth, 'both', ['OWNS', 'ACCESSED', 'READS', 'WRITES']);
      case 'emails':
        return this.traverse([seed], depth, 'both', ['ATTACHED_TO', 'SENT_TO', 'MENTIONS']);
      case 'similar_findings':
        return this.traverse([seed], depth, 'both', ['CONTAINS']);
      default:
        return this.traverse([seed], depth, 'both');
    }
  }

  // ─── Phase 2: Manual edges ───────────────────────────────────────

  private static readonly BUILTIN_RELATION_TYPES = [
    'CONTAINS', 'REFERENCES', 'OWNS', 'ACCESSED', 'READS', 'WRITES',
    'GENERATED_FROM', 'EXPORTED_TO', 'ATTACHED_TO', 'SENT_TO', 'EXECUTED', 'MENTIONS',
  ];

  async getRelationTypes(): Promise<RelationTypesResponseDto> {
    const rows = await this.prisma.$queryRaw<{ relation_type: string; cnt: bigint }[]>`
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
    inUse.filter((t) => !builtinSet.has(t)).forEach((t) => {
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
    return this.rawRowToDetail(rows[0]!);
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
    return this.rawRowToDetail(rows[0]!);
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

  /** Build the neighbourhood graph seeded from all evidence of a case. */
  async caseGraph(caseId: string, depth = 1): Promise<GraphResponseDto> {
    const evidence = await this.prisma.caseEvidence.findMany({
      where: { caseId },
      select: { entityType: true, entityId: true },
    });
    if (evidence.length === 0) {
      return { nodes: [], edges: [], truncated: false };
    }

    // Ensure inferred edges exist for the assets involved so the graph is
    // immediately useful without a global rebuild.
    const assetIds = new Set<string>();
    for (const e of evidence) {
      if (e.entityType === 'asset') assetIds.add(e.entityId);
    }
    const findingIds = evidence
      .filter((e) => e.entityType === 'finding')
      .map((e) => e.entityId);
    if (findingIds.length > 0) {
      const findings = await this.prisma.finding.findMany({
        where: { id: { in: findingIds } },
        select: { assetId: true },
      });
      findings.forEach((f) => assetIds.add(f.assetId));
    }
    for (const assetId of assetIds) {
      await this.inferEdgesForAsset(assetId);
    }

    const seeds: SeedNode[] = evidence.map((e) => ({
      type: e.entityType,
      id: e.entityId,
    }));
    const result = await this.traverse(seeds, Math.min(depth, MAX_DEPTH), 'both');
    return this.annotateWithHypotheses(caseId, result);
  }

  /**
   * Enrich graph nodes with hypothesis affiliation and mark edges that bridge
   * nodes belonging to different hypothesis sets (cross-lineage).
   */
  private async annotateWithHypotheses(
    caseId: string,
    graph: GraphResponseDto,
  ): Promise<GraphResponseDto> {
    if (graph.nodes.length === 0) return graph;

    // Load all evidence for this case including their findings.
    const evidenceRows = await this.prisma.caseEvidence.findMany({
      where: { caseId },
      select: {
        id: true,
        entityId: true,
        entityType: true,
        findings: { select: { findingId: true } },
      },
    });

    const evidenceIds = evidenceRows.map((e) => e.id);

    // Load hypothesis support rows for these evidence records.
    const supportRows = await this.prisma.caseHypothesisSupport.findMany({
      where: { targetType: 'evidence', targetId: { in: evidenceIds } },
      select: { targetId: true, hypothesisId: true },
    });

    // evidenceId → hypothesisId[]
    const evidenceToHyps = new Map<string, string[]>();
    for (const row of supportRows) {
      const arr = evidenceToHyps.get(row.targetId) ?? [];
      arr.push(row.hypothesisId);
      evidenceToHyps.set(row.targetId, arr);
    }

    // assetId → hypothesisId[]  (for evidence nodes)
    const assetToHyps = new Map<string, string[]>();
    // findingId → hypothesisId[]  (for explicit CaseFinding rows)
    const findingToHyps = new Map<string, string[]>();

    for (const ev of evidenceRows) {
      const hyps = evidenceToHyps.get(ev.id) ?? [];
      if (ev.entityType === 'asset') {
        assetToHyps.set(ev.entityId, hyps);
      }
      for (const cf of ev.findings) {
        findingToHyps.set(cf.findingId, hyps);
      }
    }

    // Annotate nodes.
    const nodeKey = (type: string, id: string) => `${type}:${id}`;
    const nodeHypMap = new Map<string, string[]>();

    const nodes: GraphNodeDto[] = graph.nodes.map((n) => {
      const hyps =
        n.type === 'asset'
          ? (assetToHyps.get(n.id) ?? [])
          : (findingToHyps.get(n.id) ?? []);
      nodeHypMap.set(nodeKey(n.type, n.id), hyps);
      return { ...n, hypothesisIds: hyps };
    });

    // Mark edges that bridge different hypothesis sets.
    const edges: GraphEdgeDto[] = graph.edges.map((e) => {
      const fromHyps = new Set(nodeHypMap.get(nodeKey(e.fromType, e.fromId)) ?? []);
      const toHyps = new Set(nodeHypMap.get(nodeKey(e.toType, e.toId)) ?? []);
      const bothAffiliated = fromHyps.size > 0 && toHyps.size > 0;
      const noOverlap = bothAffiliated && ![...fromHyps].some((h) => toHyps.has(h));
      return { ...e, crossHypothesis: noOverlap };
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
    const assetIds = rows.filter((r) => r.node_type === 'asset').map((r) => r.node_id);
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
          status: true,
          assetId: true,
        },
      }),
    ]);

    // Fetch parent asset names for findings whose asset isn't already in the graph.
    const findingAssetIds = findings
      .map((f) => f.assetId)
      .filter((id) => !assetIds.includes(id));
    const findingAssets = findingAssetIds.length > 0
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
      const truncated = f?.matchedContent
        ? f.matchedContent.length > 35
          ? `${f.matchedContent.slice(0, 35)}…`
          : f.matchedContent
        : null;
      return {
        id: r.node_id,
        type: 'finding',
        depth,
        label: f
          ? truncated
            ? `${f.findingType}: ${truncated}`
            : f.findingType
          : '(deleted finding)',
        severity: f ? String(f.severity) : undefined,
        detectorType: f ? String(f.detectorType) : undefined,
        status: f ? String(f.status) : undefined,
        matchedContent: f?.matchedContent ?? undefined,
        assetId: f?.assetId ?? undefined,
        assetName: parentAsset?.name ?? undefined,
        missing: !f,
      };
    });
  }
}
