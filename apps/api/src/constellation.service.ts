import { Injectable, Logger } from '@nestjs/common';
import { EdgeClass } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { SourceGraphService } from './stats/source-graph.service';
import { SourceGraphScheduler } from './stats/source-graph-scheduler.service';
import { EXTERNAL_PEER } from './stats/source-graph.constants';
import type {
  ConstellationBoundaryAssetDto,
  ConstellationBundleDto,
  ConstellationLinkDto,
  ConstellationResponseDto,
  ConstellationSourceDto,
} from './dto/constellation.dto';

/**
 * Above this many boundary assets on a single source pairing, the assets fold
 * into one bundle node instead of being listed individually.
 *
 * This is not a cap: nothing is dropped, the bundle carries the full count, and
 * expanding it fetches the members. It exists because the aggregate is both
 * smaller and clearer — measured on a real corpus, 44,452 of 69,350 assets
 * touch something outside their own source, and drawing forty thousand dots
 * between two bubbles says less than one line labelled with the number.
 */
const BUNDLE_THRESHOLD = 12;

const emptyClassCounts = () => ({
  flow: 0,
  containment: 0,
  identity: 0,
  reference: 0,
  usage: 0,
});

/** Stored enum → the DTO field carrying its count. */
const CLASS_FIELD: Record<EdgeClass, keyof ReturnType<typeof emptyClassCounts>> = {
  [EdgeClass.FLOW]: 'flow',
  [EdgeClass.CONTAINMENT]: 'containment',
  [EdgeClass.IDENTITY]: 'identity',
  [EdgeClass.REFERENCE]: 'reference',
  [EdgeClass.USAGE]: 'usage',
};

const emptySeverityMix = () => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
});

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Assembles the workspace connection map from the source-graph rollup.
 *
 * Everything expensive already happened in the rebuild; this is three indexed
 * reads plus a join to `sources` for names, and some grouping in memory over
 * rows that number in the tens.
 */
@Injectable()
export class ConstellationService {
  private readonly logger = new Logger(ConstellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sourceGraph: SourceGraphService,
    private readonly scheduler: SourceGraphScheduler,
  ) {}

  async getMap(): Promise<ConstellationResponseDto> {
    const freshness = await this.sourceGraph.getFreshness();

    // Promise.all rather than $transaction: these are independent reads and an
    // interactive transaction would hold a pooled connection for all of them.
    const [sources, duplicatePairs] = await Promise.all([
      this.prisma.source.findMany({
        select: { id: true, name: true, type: true },
        orderBy: { name: 'asc' },
      }),
      // Populated only after a duplicate-review index rebuild. Missing means
      // "not measured", which is why its absence is a zero and not an error.
      this.prisma.correlationSourcePair
        .findMany()
        .catch(() => [] as Array<{ sourceAId: string; sourceBId: string; pairCount: number }>),
    ]);

    if (!freshness.isBuilt) {
      // Nothing to draw yet. Return the sources so the canvas can show the
      // bubbles greyed out while the first build runs, rather than an empty
      // panel that reads as "you have no sources".
      await this.scheduler.scheduleRebuild('constellation requested before first build');
      return {
        sources: sources.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          assetCount: 0,
          connectedAssetCount: 0,
          isolatedAssetCount: 0,
          internalEdgeCount: 0,
          findingCount: 0,
          severityCounts: emptySeverityMix(),
        })),
        links: [],
        boundaryAssets: [],
        bundles: [],
        totals: {
          sources: sources.length,
          assets: 0,
          connectedAssets: 0,
          isolatedAssets: 0,
          crossSourceLinks: 0,
        },
        stats: {
          refreshedAt: freshness.refreshedAt,
          isBuilt: false,
          source: 'live',
        },
      };
    }

    const map = await this.sourceGraph.readMap(BUNDLE_THRESHOLD);
    const nodeBySource = new Map(map.nodes.map((n) => [n.sourceId, n]));

    const sourceDtos: ConstellationSourceDto[] = sources.map((s) => {
      const node = nodeBySource.get(s.id);
      const assetCount = node?.assetCount ?? 0;
      const connected = node?.connectedAssetCount ?? 0;
      return {
        id: s.id,
        name: s.name,
        type: s.type,
        assetCount,
        connectedAssetCount: connected,
        isolatedAssetCount: Math.max(0, assetCount - connected),
        internalEdgeCount: node?.internalEdgeCount ?? 0,
        findingCount: node?.findingCount ?? 0,
        severityCounts: this.toSeverityMix(node?.severityCounts ?? {}),
      };
    });

    const duplicateByPair = new Map<string, number>(
      duplicatePairs.map(
        (p) => [pairKey(p.sourceAId, p.sourceBId), p.pairCount] as const,
      ),
    );

    // Rollup rows are one per (pair, class); the canvas draws one line per pair.
    const linkByPair = new Map<string, ConstellationLinkDto>();
    for (const row of map.links) {
      // Intra-source edges are already reported as internalEdgeCount on the
      // bubble; drawing a self-loop would say the same thing twice.
      if (row.sourceAId === row.sourceBId) continue;
      const key = pairKey(row.sourceAId, row.sourceBId);
      const link: ConstellationLinkDto = linkByPair.get(key) ?? {
        sourceAId: row.sourceAId,
        sourceBId: row.sourceBId,
        total: 0,
        byClass: emptyClassCounts(),
        assetCount: 0,
        duplicatePairCount: duplicateByPair.get(key) ?? 0,
      };
      linkByPair.set(key, link);
      link.total += row.edgeCount;
      link.assetCount += row.assetCount;
      const cls = row.relationClass as EdgeClass;
      const field = CLASS_FIELD[cls];
      if (field) link.byClass[field] += row.edgeCount;
    }

    const boundaryAssets = await this.hydrateBoundary(map.boundary);
    const bundles: ConstellationBundleDto[] = map.bundles.map((b) => ({
      id: `bundle:${pairKey(b.sourceId, b.peerSourceId)}`,
      sourceAId: b.sourceId,
      sourceBId: b.peerSourceId === EXTERNAL_PEER ? null : b.peerSourceId,
      assetCount: b.assetCount,
      edgeCount: b.edgeCount,
    }));

    const totals = sourceDtos.reduce(
      (acc, s) => {
        acc.assets += s.assetCount;
        acc.connectedAssets += s.connectedAssetCount;
        acc.isolatedAssets += s.isolatedAssetCount;
        return acc;
      },
      {
        sources: sourceDtos.length,
        assets: 0,
        connectedAssets: 0,
        isolatedAssets: 0,
        crossSourceLinks: linkByPair.size,
      },
    );

    return {
      sources: sourceDtos,
      links: [...linkByPair.values()],
      boundaryAssets,
      bundles,
      totals,
      stats: {
        refreshedAt: freshness.refreshedAt,
        isBuilt: true,
        source: 'rollup',
      },
    };
  }

  /**
   * Hydrate the boundary assets the map draws individually.
   *
   * The decision about which pairings are drawable already happened in SQL, so
   * this only ever sees rows for pairings under the threshold — bounded by
   * (pairings x threshold), never by corpus size.
   */
  private async hydrateBoundary(
    rows: Awaited<ReturnType<SourceGraphService['readMap']>>['boundary'],
  ): Promise<ConstellationBoundaryAssetDto[]> {
    const assetIds = [...new Set(rows.map((r) => r.assetId))];
    const assets = assetIds.length
      ? await this.prisma.asset.findMany({
          where: { id: { in: assetIds } },
          select: {
            id: true,
            name: true,
            externalUrl: true,
            assetType: true,
            sourceId: true,
          },
        })
      : [];
    const assetById = new Map(assets.map((a) => [a.id, a]));

    const byAsset = new Map<string, ConstellationBoundaryAssetDto>();
    for (const row of rows) {
      const asset = assetById.get(row.assetId);
      // An edge can outlive the asset it points at; skip rather than invent one.
      if (!asset) continue;
      let entry = byAsset.get(row.assetId);
      if (!entry) {
        entry = {
          assetId: asset.id,
          assetName: asset.name || asset.externalUrl || 'Unknown asset',
          assetType: asset.assetType || 'OTHER',
          sourceId: asset.sourceId,
          edges: [],
        };
        byAsset.set(row.assetId, entry);
      }
      entry.edges.push({
        peerSourceId:
          row.peerSourceId === EXTERNAL_PEER ? null : row.peerSourceId,
        relationClass: row.relationClass as EdgeClass,
        edgeCount: row.edgeCount,
      });
    }
    return [...byAsset.values()];
  }

  private toSeverityMix(counts: Record<string, number>) {
    return {
      critical: counts.CRITICAL ?? 0,
      high: counts.HIGH ?? 0,
      medium: counts.MEDIUM ?? 0,
      low: counts.LOW ?? 0,
      info: counts.INFO ?? 0,
    };
  }
}
