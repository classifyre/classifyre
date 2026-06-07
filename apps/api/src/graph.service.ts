import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import {
  ExpandGraphDto,
  GraphDirection,
  GraphEdgeDto,
  GraphNodeDto,
  GraphResponseDto,
  RebuildEdgesResponseDto,
} from './dto/graph.dto';

/** Upper bound on nodes returned by a single traversal to keep the graph curated. */
const NODE_CAP = 200;
const MAX_DEPTH = 3;

interface SeedNode {
  type: string;
  id: string;
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
    return this.traverse(seeds, Math.min(depth, MAX_DEPTH), 'both');
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
          severity: true,
          detectorType: true,
          status: true,
        },
      }),
    ]);

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
      return {
        id: r.node_id,
        type: 'finding',
        depth,
        label: f?.findingType ?? '(deleted finding)',
        severity: f ? String(f.severity) : undefined,
        detectorType: f ? String(f.detectorType) : undefined,
        status: f ? String(f.status) : undefined,
        missing: !f,
      };
    });
  }
}
