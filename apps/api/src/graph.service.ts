import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { SourceGraphScheduler } from './stats/source-graph-scheduler.service';
// Value import, not `import type` — see the constructor.
import { InquiryMatchingService } from './matching/inquiry-matching.service';
import { resolveEdgeClass } from './graph/edge-class';
import {
  TRACE_KIND_SQL,
  TRACE_PER_NODE,
  walkTrace,
  type TraceDirection,
  type TraceEdgeRow,
  type TraceKind,
  type TraceNodeRef,
  type TraceSide,
} from './graph-trace';
import { tryNormalizeUrn } from './graph/urn';
import {
  BulkIngestEdgesDto,
  BulkIngestEdgesResponseDto,
  ColumnLineageDto,
  ColumnLineageResponseDto,
  ColumnLineageStepDto,
  FieldMappingDto,
  LineageGraphDto,
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

/**
 * Edges above which a lineage walk draws a node but does not expand through it.
 *
 * 40 is well above an ordinary table's neighbourhood and well below a hub's:
 * the GENESIS table that broke this fed ~900 assets (field report P13).
 */
const DEFAULT_LINEAGE_HUB_FAN_OUT = 40;
const MAX_DEPTH = 3;

/**
 * Entity kind for an endpoint that names a URN instead of an ingested asset.
 *
 * Reusing the existing free-form `fromType`/`toType` rather than adding nullable
 * endpoint columns: the unique constraint, the recursive traversal and the
 * transfer scopes all keep working untouched, and the id column already holds
 * an opaque string.
 */
const EXTERNAL_NODE = 'external';

/** A trace's nodes and edges, as the board draws them (see `trace`). */
export interface GraphTraceResult {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    assetType: string | null;
    sourceType: string | null;
    sourceName: string | null;
    status: string | null;
    missing: boolean;
    depth: number;
    side: TraceSide;
    via: string | null;
    viaKind: TraceKind | null;
  }>;
  edges: Array<{
    id: string;
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    relationType: string;
    relationClass: string | null;
    kind: TraceKind;
    confidence: number | null;
  }>;
  truncated: boolean;
}

const EDGE_METHODS = new Set([
  'RUNTIME_OBSERVED',
  'SYSTEM_CATALOG',
  'SQL_PARSED',
  'HEURISTIC',
  'MANUAL',
]);

/** Unknown or absent methods fall back to the catalog default. */
function normalizeMethod(method: string | null | undefined): string {
  return method && EDGE_METHODS.has(method) ? method : 'SYSTEM_CATALOG';
}

/**
 * Readable label for an unresolved URN endpoint.
 *
 * The last segment is the object's own name, which is what a person is looking
 * for; the platform says which system it lives in. The middle of a fully
 * qualified name is the least useful part on a crowded canvas.
 */
function externalLabel(urn: string): string {
  const [platform, rest] = urn.split('://');
  if (!rest) return urn;
  const segments = rest.split('/').filter(Boolean);
  const name = segments[segments.length - 1] ?? rest;
  return `${name} (${platform})`;
}

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
  relation_class?: string;
  granularity?: string;
  method?: string;
  field_mappings?: unknown;
  evidence?: unknown;
  last_seen_at?: Date | string | null;
}

/** One row of the edges table as the UI wants it. */
function toGraphEdge(e: EdgeRow): GraphEdgeDto {
  const mappings = Array.isArray(e.field_mappings)
    ? e.field_mappings
    : undefined;
  return {
    id: e.id,
    fromType: e.from_type,
    fromId: e.from_id,
    toType: e.to_type,
    toId: e.to_id,
    relationType: e.relation_type,
    confidence: Number(e.confidence),
    origin: e.origin,
    relationClass: resolveEdgeClass(e.relation_class, e.relation_type),
    granularity: e.granularity ?? 'DATASET',
    method: e.method ?? 'SYSTEM_CATALOG',
    fieldMappings: mappings as GraphEdgeDto['fieldMappings'],
    evidence: (e.evidence ?? undefined) as GraphEdgeDto['evidence'],
  };
}

/** `type:id`, the key both rewrites use to identify a node. */
function nodeKey(type: string, id: string): string {
  return `${type}:${id}`;
}

function splitKey(key: string): { type: string; id: string } {
  const idx = key.indexOf(':');
  return { type: key.slice(0, idx), id: key.slice(idx + 1) };
}

function nodeTupleList(nodes: GraphNodeDto[]): Prisma.Sql {
  return Prisma.join(nodes.map((n) => Prisma.sql`(${n.type}, ${n.id})`));
}

/**
 * Map every node onto a representative and rebuild the graph around it.
 *
 * Shared by the two lineage controls, because collapsing into containers and
 * merging identical nodes are the same operation with a different choice of
 * representative. Self-edges are dropped (a node does not flow into itself
 * once its parts are folded together) and parallel edges collapse to the
 * strongest one, so a rolled-up schema shows one arrow rather than forty.
 */
function rewriteGraph(
  graph: GraphResponseDto,
  representativeOf: (node: GraphNodeDto) => string,
): GraphResponseDto {
  const mapping = new Map<string, string>();
  const survivors = new Map<string, GraphNodeDto>();

  for (const node of graph.nodes) {
    const key = nodeKey(node.type, node.id);
    const rep = representativeOf(node);
    mapping.set(key, rep);
    if (rep === key) survivors.set(rep, node);
  }
  // A representative that was not itself in the traversal (a container pulled
  // in from outside) still needs a node; depth is inherited from the shallowest
  // member so ordering by distance stays meaningful.
  for (const [key, rep] of mapping) {
    if (survivors.has(rep)) continue;
    const member = graph.nodes.find((n) => nodeKey(n.type, n.id) === key);
    const { type, id } = splitKey(rep);
    survivors.set(rep, {
      id,
      type,
      label: '',
      depth: member?.depth ?? 0,
    });
  }
  for (const [key, rep] of mapping) {
    const member = graph.nodes.find((n) => nodeKey(n.type, n.id) === key);
    const survivor = survivors.get(rep);
    if (member && survivor && member.depth < survivor.depth) {
      survivor.depth = member.depth;
    }
  }

  const edges = new Map<string, GraphEdgeDto>();
  for (const edge of graph.edges) {
    const from = mapping.get(nodeKey(edge.fromType, edge.fromId));
    const to = mapping.get(nodeKey(edge.toType, edge.toId));
    if (!from || !to || from === to) continue;
    const fromParts = splitKey(from);
    const toParts = splitKey(to);
    const dedupe = `${from}->${to}:${edge.relationType}`;
    const existing = edges.get(dedupe);
    if (existing && existing.confidence >= edge.confidence) continue;
    edges.set(dedupe, {
      ...edge,
      fromType: fromParts.type,
      fromId: fromParts.id,
      toType: toParts.type,
      toId: toParts.id,
    });
  }

  return {
    nodes: [...survivors.values()],
    edges: [...edges.values()],
    truncated: graph.truncated,
  };
}

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Value import, not `import type` — a type-only import of an injected class
    // leaves Nest with no metadata to resolve and injects undefined silently.
    private readonly sourceGraphScheduler: SourceGraphScheduler,
    // Optional so the graph specs can construct this service without the whole
    // matching stack; a case graph simply goes unbadged without it.
    @Optional() private readonly matching?: InquiryMatchingService,
  ) {}

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
    await this.sourceGraphScheduler.scheduleRebuild('edges rebuilt');
    return { edgeCount };
  }

  /**
   * {@link inferEdgesForAsset} for many assets in three statements instead of
   * three per asset. Opening a case refreshes every evidence asset, and a board
   * with a few hundred bubbles would otherwise spend its whole open budget on
   * round trips.
   */
  async inferEdgesForAssets(assetIds: string[]): Promise<void> {
    const ids = [...new Set(assetIds)];
    if (ids.length === 0) return;
    if (ids.length === 1) return this.inferEdgesForAsset(ids[0]);
    await this.prisma.$executeRaw`
      INSERT INTO edges (id, from_type, from_id, to_type, to_id, relation_type, confidence, origin, created_at)
      SELECT gen_random_uuid(), 'asset', f.asset_id, 'finding', f.id, 'CONTAINS', f.confidence, 'INFERRED'::"EdgeOrigin", now()
      FROM findings f
      WHERE f.asset_id = ANY(${ids}::text[])
      ON CONFLICT (from_type, from_id, to_type, to_id, relation_type) DO NOTHING
    `;
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: ids } },
      select: { id: true, links: true },
    });
    if (assets.length > 0) await this.createReferenceEdges(assets);
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
    // CLI connectors populate Asset.links with asset *hashes* (generate_hash_id
    // output), so hash is the primary resolution key; id/externalUrl remain for
    // links written by other producers.
    const matches = await this.prisma.asset.findMany({
      where: {
        OR: [
          { hash: { in: allTargets } },
          { id: { in: allTargets } },
          { externalUrl: { in: allTargets } },
        ],
      },
      select: { id: true, hash: true, externalUrl: true },
    });

    const byId = new Set(matches.map((m) => m.id));
    const byHash = new Map(matches.map((m) => [m.hash, m.id]));
    const byUrl = new Map(matches.map((m) => [m.externalUrl, m.id]));

    const rows: Prisma.EdgeCreateManyInput[] = [];
    const seen = new Set<string>();
    for (const a of perAsset) {
      for (const target of a.targets) {
        const targetId = byHash.has(target)
          ? byHash.get(target)
          : byId.has(target)
            ? target
            : byUrl.get(target);
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
    const edges = dto.edges ?? [];
    if (edges.length === 0) return { upserted: 0, external: 0, dropped: 0 };

    // An asset hash is only unique per source (`@@unique([sourceId, hash])`),
    // so resolving one globally picks an arbitrary winner when two sources
    // share a hash. Scope it to the source that emitted the batch; naming an
    // asset in *another* source is what a URN is for.
    const hashes = new Set<string>();
    const urns = new Set<string>();
    for (const e of edges) {
      if (e.fromHash) hashes.add(e.fromHash);
      if (e.toHash) hashes.add(e.toHash);
      if (e.viaId) hashes.add(e.viaId);
      for (const raw of [e.fromUrn, e.toUrn, e.viaUrn]) {
        const normalized = tryNormalizeUrn(raw);
        if (normalized) urns.add(normalized);
      }
    }

    const [hashToId, urnToId] = await Promise.all([
      this.resolveHashes([...hashes], dto.sourceId),
      this.resolveUrns([...urns], dto.sourceId),
    ]);

    interface Endpoint {
      type: string;
      id: string;
      external: boolean;
    }

    const endpointOf = (
      kind: string,
      id?: string,
      hash?: string,
      urn?: string,
    ): Endpoint | null => {
      if (id) return { type: kind, id, external: false };
      if (hash) {
        const resolved = hashToId.get(hash);
        if (resolved) return { type: kind, id: resolved, external: false };
        // A hash the emitting source produced should exist. If it does not,
        // the asset was filtered out of this run and there is nothing to point
        // at — unlike a URN, there is no later scan that will supply it.
        return null;
      }
      const normalized = tryNormalizeUrn(urn);
      if (!normalized) return null;
      const resolved = urnToId.get(normalized);
      return resolved
        ? { type: kind, id: resolved, external: false }
        : // Kept, not dropped: the other system simply has not been scanned
          // yet. `stitchExternalEdges` binds it whenever that happens, so the
          // two scans can run in either order.
          { type: EXTERNAL_NODE, id: normalized, external: true };
    };

    // Keyed by the unique constraint's own tuple. Postgres refuses an
    // `ON CONFLICT DO UPDATE` whose VALUES list names the same conflict
    // target twice ("command cannot affect row a second time", SQLSTATE
    // 21000) and it fails the WHOLE statement, so one repeated edge inside a
    // batch used to lose every other edge in that batch. The last occurrence
    // wins, matching the re-ingest semantics of the upsert itself.
    const rows = new Map<string, Prisma.Sql>();
    let external = 0;
    let dropped = 0;
    let duplicates = 0;

    for (const e of edges) {
      const from = endpointOf(e.fromType, e.fromId, e.fromHash, e.fromUrn);
      const to = endpointOf(e.toType, e.toId, e.toHash, e.toUrn);
      if (!from || !to) {
        dropped += 1;
        continue;
      }
      if (from.external || to.external) external += 1;

      const relationClass = resolveEdgeClass(e.relationClass, e.relationType);
      const mappings = Array.isArray(e.fieldMappings) ? e.fieldMappings : null;
      const granularity =
        e.granularity === 'FIELD' || (mappings && mappings.length > 0)
          ? 'FIELD'
          : 'DATASET';
      const via = e.viaId
        ? hashToId.get(e.viaId)
        : tryNormalizeUrn(e.viaUrn)
          ? urnToId.get(tryNormalizeUrn(e.viaUrn)!)
          : undefined;

      // Every column is cast explicitly. Postgres types an untyped placeholder
      // inside a VALUES list as `text`, so without these the numeric and
      // timestamp columns fail the insert outright — and the enum columns
      // would too.
      const conflictKey = `${from.type}\u0000${from.id}\u0000${to.type}\u0000${to.id}\u0000${e.relationType}`;
      if (rows.has(conflictKey)) duplicates += 1;
      rows.set(
        conflictKey,
        Prisma.sql`(
        ${from.type}::text, ${from.id}::text, ${to.type}::text, ${to.id}::text,
        ${e.relationType}::text,
        ${e.confidence ?? 1}::numeric(3,2),
        'SOURCE_DERIVED'::"EdgeOrigin",
        ${relationClass}::"EdgeClass",
        ${granularity}::"EdgeGranularity",
        ${normalizeMethod(e.method)}::"EdgeMethod",
        ${mappings ? JSON.stringify(mappings) : null}::jsonb,
        ${e.evidence ? JSON.stringify(e.evidence) : null}::jsonb,
        ${via ? 'asset' : null}::text, ${via ?? null}::text,
        now()::timestamp(3)
      )`,
      );
    }

    if (duplicates > 0) {
      this.logger.debug(
        `${duplicates} edge(s) in this batch repeated a (from, to, relation) ` +
          'already present in the same batch; the last one won.',
      );
    }

    if (rows.size === 0) return { upserted: 0, external, dropped };

    // Raw upsert rather than createMany({ skipDuplicates }): skipping a
    // duplicate silently discards the re-ingest, so a changed confidence, a
    // newly-discovered column mapping, or a refreshed last_seen_at would never
    // land. Expiry and provenance both depend on the refresh happening.
    //
    // MANUAL origin is preserved: a person drew that edge, and a connector
    // later deriving the same relationship should not erase who put it there.
    const upserted = await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "edges" (
        "id", "from_type", "from_id", "to_type", "to_id",
        "relation_type", "confidence", "origin",
        "relation_class", "granularity", "method",
        "field_mappings", "evidence", "via_type", "via_id", "last_seen_at"
      )
      SELECT gen_random_uuid(), v.* FROM (VALUES ${Prisma.join([...rows.values()])}) AS v
      ON CONFLICT ("from_type", "from_id", "to_type", "to_id", "relation_type")
      DO UPDATE SET
        "confidence"     = EXCLUDED."confidence",
        "relation_class" = EXCLUDED."relation_class",
        "granularity"    = EXCLUDED."granularity",
        "method"         = EXCLUDED."method",
        "field_mappings" = COALESCE(EXCLUDED."field_mappings", "edges"."field_mappings"),
        "evidence"       = COALESCE(EXCLUDED."evidence", "edges"."evidence"),
        "via_type"       = COALESCE(EXCLUDED."via_type", "edges"."via_type"),
        "via_id"         = COALESCE(EXCLUDED."via_id", "edges"."via_id"),
        "last_seen_at"   = EXCLUDED."last_seen_at",
        "origin"         = CASE
          WHEN "edges"."origin" = 'MANUAL'::"EdgeOrigin" THEN "edges"."origin"
          ELSE EXCLUDED."origin"
        END
    `);

    // The connection map is keyed on these edges; a batch that changed any of
    // them makes it stale. Coalesced upstream, so a scan emitting relationships
    // for an hour produces a trickle of rebuilds rather than one per batch.
    if (upserted > 0) {
      await this.sourceGraphScheduler.scheduleRebuild('edges ingested');
    }

    return { upserted, external, dropped };
  }

  // ─── Lineage ─────────────────────────────────────────────────────────
  //
  // "Lineage" here means everything this asset is connected to — data flow,
  // link references, and cross-source identity matches alike — the same
  // full picture the namespace-wide asset map and a source's links view
  // already draw. It used to walk the FLOW subset only, but that made a
  // connector-declared SAME_AS/REFERENCE edge invisible on the one page an
  // investigator actually looks at an asset from. Containment and identity
  // still double as *controls* (collapsing the picture / merging duplicated
  // nodes) on top of being walked as hops now.

  async lineage(dto: LineageGraphDto): Promise<GraphResponseDto> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: dto.assetId },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    const depth = Math.min(dto.depth ?? 2, MAX_DEPTH);
    // Flow edges point the way the data moves, so "where did this come from"
    // is an inward walk and "what breaks if I change it" is an outward one.
    // Non-flow edges (links, identity) aren't directional in that sense, but
    // the same in/out split still just means "which end of the edge is the seed".
    const direction: GraphDirection =
      dto.direction === 'up' ? 'in' : dto.direction === 'down' ? 'out' : 'both';

    // A hub feeding hundreds of assets is what makes depth 2 return the whole
    // namespace. Above this many edges a node is drawn but not expanded
    // through; `fanOut` on the node says how many it really has, so the UI can
    // show "collapsed hub" instead of silently losing the rest of the graph.
    const fanOutCap =
      dto.hubFanOut === undefined
        ? DEFAULT_LINEAGE_HUB_FAN_OUT
        : Math.max(0, Number(dto.hubFanOut));

    let graph = await this.traverse(
      [{ type: 'asset', id: dto.assetId }],
      depth,
      direction,
      undefined,
      undefined,
      fanOutCap,
    );
    if (fanOutCap > 0) {
      graph = await this.markHubNodes(graph, dto.assetId, fanOutCap);
    }

    if (dto.mergeIdentity === true) {
      graph = await this.mergeIdentityNodes(graph, dto.assetId);
    }
    if (dto.collapseContainers) {
      graph = await this.collapseIntoContainers(graph, dto.assetId);
    }
    return graph;
  }

  /**
   * Stamp `fanOut` on the nodes the walk refused to expand through.
   *
   * Without it a collapsed hub is indistinguishable from a leaf: the graph
   * simply stops there, which is a quieter version of the bug it fixes. With
   * it the UI can say "this feeds 900 more" and offer to open that node on its
   * own page.
   */
  private async markHubNodes(
    graph: GraphResponseDto,
    seedId: string,
    fanOutCap: number,
  ): Promise<GraphResponseDto> {
    const candidates = graph.nodes.filter((n) => n.id !== seedId);
    if (candidates.length === 0) return graph;

    // The VALUES list is not compared against a typed column here, so the
    // parameters carry their own casts — without them Postgres cannot
    // determine the type and the statement fails at runtime.
    const tuples = Prisma.join(
      candidates.map((n) => Prisma.sql`(${n.type}::text, ${n.id}::text)`),
    );
    const degrees = await this.prisma.$queryRaw<
      { node_type: string; node_id: string; degree: bigint }[]
    >(Prisma.sql`
      SELECT node_type, node_id, degree FROM (
        SELECT n.node_type, n.node_id,
               (SELECT count(*) FROM edges e
                 WHERE e.from_type = n.node_type AND e.from_id = n.node_id)
             + (SELECT count(*) FROM edges e
                 WHERE e.to_type = n.node_type AND e.to_id = n.node_id)
               AS degree
        FROM (VALUES ${tuples}) AS n(node_type, node_id)
      ) d
      WHERE degree > ${fanOutCap}
    `);
    if (degrees.length === 0) return graph;

    const byKey = new Map(
      degrees.map((row) => [
        nodeKey(row.node_type, row.node_id),
        Number(row.degree),
      ]),
    );
    return {
      ...graph,
      nodes: graph.nodes.map((node) => {
        const fanOut = byKey.get(nodeKey(node.type, node.id));
        return fanOut === undefined ? node : { ...node, fanOut };
      }),
    };
  }

  /**
   * Fold nodes joined by an IDENTITY edge into a single node.
   *
   * A dbt model and the warehouse table it is are one thing described twice.
   * Left alone they appear as two hops in every path that crosses them, which
   * both doubles the graph and makes "how far upstream is this?" wrong.
   */
  private async mergeIdentityNodes(
    graph: GraphResponseDto,
    seedId: string,
  ): Promise<GraphResponseDto> {
    const keys = graph.nodes.map((n) => nodeKey(n.type, n.id));
    if (keys.length < 2) return graph;

    const identityRows = await this.prisma.$queryRaw<
      { from_type: string; from_id: string; to_type: string; to_id: string }[]
    >(Prisma.sql`
      SELECT from_type, from_id, to_type, to_id FROM "edges"
      WHERE relation_class = 'IDENTITY'::"EdgeClass"
        AND (from_type, from_id) IN (${nodeTupleList(graph.nodes)})
        AND (to_type, to_id) IN (${nodeTupleList(graph.nodes)})
    `);
    if (identityRows.length === 0) return graph;

    // Union-find over the identity pairs, with the seed pinned as its own
    // representative so the node the user asked about never disappears.
    const parent = new Map<string, string>(keys.map((k) => [k, k]));
    const find = (k: string): string => {
      let root = k;
      while (parent.get(root) !== root) root = parent.get(root)!;
      return root;
    };
    const seedKey = nodeKey('asset', seedId);
    for (const row of identityRows) {
      const a = find(nodeKey(row.from_type, row.from_id));
      const b = find(nodeKey(row.to_type, row.to_id));
      if (a === b) continue;
      // Keep the seed's root as the survivor wherever it is involved.
      const [winner, loser] = b === seedKey ? [b, a] : [a, b];
      parent.set(loser, winner);
    }

    return rewriteGraph(graph, (node) => find(nodeKey(node.type, node.id)));
  }

  /**
   * Roll each node up into whatever contains it.
   *
   * The point is scale, not tidiness: a warehouse lineage graph is unreadable
   * at table granularity and obvious at schema granularity, and it is the same
   * data either way.
   */
  private async collapseIntoContainers(
    graph: GraphResponseDto,
    seedId: string,
  ): Promise<GraphResponseDto> {
    if (graph.nodes.length === 0) return graph;
    const parents = await this.prisma.$queryRaw<
      { child_id: string; parent_type: string; parent_id: string }[]
    >(Prisma.sql`
      SELECT to_id AS child_id, from_type AS parent_type, from_id AS parent_id
      FROM "edges"
      WHERE relation_class = 'CONTAINMENT'::"EdgeClass"
        AND (to_type, to_id) IN (${nodeTupleList(graph.nodes)})
    `);
    if (parents.length === 0) return graph;

    const parentOf = new Map(
      parents.map((r) => [r.child_id, nodeKey(r.parent_type, r.parent_id)]),
    );
    // The seed stays itself: collapsing the node the user is standing on into
    // its container answers a question they did not ask.
    parentOf.delete(seedId);

    const collapsed = rewriteGraph(graph, (node) =>
      node.type === 'asset'
        ? (parentOf.get(node.id) ?? nodeKey(node.type, node.id))
        : nodeKey(node.type, node.id),
    );

    // Containers pulled in as representatives are not in the traversal result,
    // so they have no label yet.
    const unlabelled = collapsed.nodes.filter((n) => !n.label);
    if (unlabelled.length > 0) {
      const hydrated = await this.hydrateNodes(
        unlabelled.map((n) => ({
          node_type: n.type,
          node_id: n.id,
          depth: BigInt(n.depth),
        })),
      );
      const byKey = new Map(hydrated.map((n) => [nodeKey(n.type, n.id), n]));
      collapsed.nodes = collapsed.nodes.map(
        (n) => byKey.get(nodeKey(n.type, n.id)) ?? n,
      );
    }
    return collapsed;
  }

  /**
   * Trace one column back through the field mappings on flow edges.
   *
   * Column lineage rides on the dataset edges rather than living in its own
   * node type: a column graph has one to two orders of magnitude more nodes
   * than a table graph, and materialising it is what made the column-as-entity
   * catalogs expensive enough that nobody repeated the design.
   */
  async columnLineage(
    dto: ColumnLineageDto,
  ): Promise<ColumnLineageResponseDto> {
    const maxDepth = Math.min(dto.depth ?? 3, 5);
    const steps: ColumnLineageStepDto[] = [];
    const indirect: ColumnLineageStepDto[] = [];

    // (assetId, column) pairs still to explain.
    let frontier: { id: string; column: string }[] = [
      { id: dto.assetId, column: dto.column },
    ];
    const seen = new Set<string>([`${dto.assetId}::${dto.column}`]);

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const rows = await this.prisma.$queryRaw<
        {
          from_type: string;
          from_id: string;
          to_id: string;
          field_mappings: unknown;
        }[]
      >(Prisma.sql`
        SELECT from_type, from_id, to_id, field_mappings FROM "edges"
        WHERE relation_class = 'FLOW'::"EdgeClass"
          AND granularity = 'FIELD'::"EdgeGranularity"
          AND to_type = 'asset'
          AND to_id IN (${Prisma.join(frontier.map((f) => f.id))})
      `);
      if (rows.length === 0) break;

      const upstreamIds = rows
        .filter((r) => r.from_type === 'asset')
        .map((r) => r.from_id);
      const labels = await this.labelsFor(upstreamIds);

      const next: { id: string; column: string }[] = [];
      for (const row of rows) {
        const wanted = frontier
          .filter((f) => f.id === row.to_id)
          .map((f) => f.column);
        const mappings = Array.isArray(row.field_mappings)
          ? (row.field_mappings as FieldMappingDto[])
          : [];
        const external = row.from_type === EXTERNAL_NODE;

        for (const mapping of mappings) {
          const isIndirect =
            mapping.downstream == null || mapping.type === 'INDIRECT';
          if (!isIndirect && !wanted.includes(mapping.downstream!)) continue;

          const step: ColumnLineageStepDto = {
            assetId: row.from_id,
            assetLabel: external
              ? externalLabel(row.from_id)
              : (labels.get(row.from_id) ?? '(deleted asset)'),
            urn: external ? row.from_id : undefined,
            column: mapping.downstream ?? '(rows)',
            upstreams: mapping.upstreams ?? [],
            transform: mapping.transform ?? null,
            type: mapping.type ?? 'TRANSFORMED',
            depth,
          };

          if (isIndirect) {
            // An ORDER BY column shaped the result without feeding this
            // column's values. Reported apart so it does not read as if the
            // value was computed from it.
            indirect.push(step);
            continue;
          }
          steps.push(step);

          if (external) continue; // nothing further to walk into yet
          for (const upstream of step.upstreams) {
            const key = `${row.from_id}::${upstream}`;
            if (seen.has(key)) continue;
            seen.add(key);
            next.push({ id: row.from_id, column: upstream });
          }
        }
      }
      frontier = next;
    }

    return { steps, indirect };
  }

  private async labelsFor(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(assets.map((a) => [a.id, a.name]));
  }

  /** Asset hashes to UUIDs, scoped to one source when the caller named one. */
  private async resolveHashes(
    hashes: string[],
    sourceId?: string,
  ): Promise<Map<string, string>> {
    if (hashes.length === 0) return new Map();
    const assets = await this.prisma.asset.findMany({
      where: { hash: { in: hashes }, ...(sourceId ? { sourceId } : {}) },
      select: { id: true, hash: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
    });
    // Ordered oldest-first so the last write wins: without a sourceId this is
    // the most recently updated asset carrying that hash.
    return new Map(assets.map((a) => [a.hash, a.id]));
  }

  /**
   * Platform URNs to asset UUIDs.
   *
   * `assets.urn` is deliberately not unique — two source configs may
   * legitimately scan the same warehouse — so a URN can match several assets.
   * Prefer one in the emitting source, then the most recently updated, so the
   * choice is at least deterministic and points at live data.
   */
  private async resolveUrns(
    urns: string[],
    sourceId?: string,
  ): Promise<Map<string, string>> {
    if (urns.length === 0) return new Map();
    const assets = await this.prisma.asset.findMany({
      where: { urn: { in: urns } },
      select: { id: true, urn: true, sourceId: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
    });
    const resolved = new Map<string, string>();
    const fromSameSource = new Set<string>();
    for (const asset of assets) {
      if (!asset.urn) continue;
      const preferred = sourceId != null && asset.sourceId === sourceId;
      if (fromSameSource.has(asset.urn) && !preferred) continue;
      resolved.set(asset.urn, asset.id);
      if (preferred) fromSameSource.add(asset.urn);
    }
    return resolved;
  }

  /**
   * Bind `external` endpoints whose URN now resolves to a real asset.
   *
   * This is what makes cross-system lineage independent of scan order: a
   * Tableau scan can name a Snowflake table months before anyone scans
   * Snowflake, and the edge completes itself when they do.
   *
   * Called after a bulk asset ingest, with the URNs that run produced.
   */
  async stitchExternalEdges(urns: string[]): Promise<number> {
    const normalized = urns
      .map((value) => tryNormalizeUrn(value))
      .filter((value): value is string => value !== null);
    if (normalized.length === 0) return 0;

    const resolved = await this.resolveUrns(normalized);
    if (resolved.size === 0) return 0;

    let stitched = 0;
    for (const [urn, assetId] of resolved) {
      // Rewrite, then delete whatever could not be rewritten because the same
      // edge already existed in resolved form. Doing it the other way round
      // would hit the unique constraint and abort the batch.
      stitched += await this.prisma.$transaction(async (tx) => {
        const outgoing = await tx.$executeRaw`
          UPDATE "edges" SET "from_type" = 'asset', "from_id" = ${assetId}
          WHERE "from_type" = ${EXTERNAL_NODE} AND "from_id" = ${urn}
            AND NOT EXISTS (
              SELECT 1 FROM "edges" existing
              WHERE existing."from_type" = 'asset'
                AND existing."from_id" = ${assetId}
                AND existing."to_type" = "edges"."to_type"
                AND existing."to_id" = "edges"."to_id"
                AND existing."relation_type" = "edges"."relation_type"
            )
        `;
        const incoming = await tx.$executeRaw`
          UPDATE "edges" SET "to_type" = 'asset', "to_id" = ${assetId}
          WHERE "to_type" = ${EXTERNAL_NODE} AND "to_id" = ${urn}
            AND NOT EXISTS (
              SELECT 1 FROM "edges" existing
              WHERE existing."to_type" = 'asset'
                AND existing."to_id" = ${assetId}
                AND existing."from_type" = "edges"."from_type"
                AND existing."from_id" = "edges"."from_id"
                AND existing."relation_type" = "edges"."relation_type"
            )
        `;
        // Anything still external for this URN is now a duplicate of a
        // resolved edge, so it carries no information.
        await tx.$executeRaw`
          DELETE FROM "edges"
          WHERE ("from_type" = ${EXTERNAL_NODE} AND "from_id" = ${urn})
             OR ("to_type" = ${EXTERNAL_NODE} AND "to_id" = ${urn})
        `;
        return outgoing + incoming;
      });
    }
    return stitched;
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

  // The suggested vocabulary, grouped by what each type means. GENERATED_FROM
  // is gone: it pointed downstream -> upstream while every other flow type
  // points the way the data moves, and the migration flipped the rows it had
  // into TRANSFORM. Offering it again would reintroduce the inconsistency.
  private static readonly BUILTIN_RELATION_TYPES = [
    // FLOW — lineage
    'TRANSFORM',
    'VIEW',
    'COPY',
    'WRITE',
    'EXPORT',
    'SEND',
    // CONTAINMENT
    'CONTAINS',
    'ATTACHED_TO',
    // IDENTITY
    'SAME_AS',
    // REFERENCE
    'REFERENCES',
    'MENTIONS',
    'FOREIGN_KEY',
    // USAGE
    'OWNS',
    'ACCESSED',
    'READS',
    'EXECUTED',
    // Retained for compatibility with edges already drawn under these names.
    'WRITES',
    'EXPORTED_TO',
    'SENT_TO',
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
    const counts = new Map(rows.map((r) => [r.relation_type, Number(r.cnt)]));
    const classified = suggestions.map((type) => ({
      type,
      relationClass: resolveEdgeClass(null, type),
      count: counts.get(type) ?? 0,
    }));
    return { inUse, suggestions, classified };
  }

  async createManualEdge(
    dto: CreateManualEdgeDto,
    tx?: Prisma.TransactionClient,
  ): Promise<EdgeDetailDto> {
    // Use raw SQL so the MANUAL enum value works regardless of the Prisma client
    // version loaded in the running server process (the enum was added post-startup).
    const confidence = dto.confidence ?? 1;
    const rows = await (tx ?? this.prisma).$queryRaw<RawEdgeRow[]>`
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

  /**
   * Trace assets' connections hop by hop (see graph-trace.ts): upstream,
   * downstream and sideways, over the chosen kinds of edge. Every hop is one
   * query that reads a bounded number of edges per node under a statement
   * timeout; a hop that runs out of time ends the walk with what it has and
   * marks it truncated, rather than holding a connection.
   */
  async trace(input: {
    seeds: TraceNodeRef[];
    depth: number;
    direction: TraceDirection;
    kinds: TraceKind[];
    limit: number;
  }): Promise<GraphTraceResult> {
    let timedOut = false;
    const walk = await walkTrace(input.seeds, input, async (frontier) => {
      if (timedOut || frontier.length === 0) return [];
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
            return tx.$queryRaw<TraceEdgeRow[]>(
              this.traceLevelSql(frontier, input.kinds),
            );
          },
          { timeout: 10_000, maxWait: 3_000 },
        );
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!text.includes('57014') && !/statement timeout/i.test(text)) {
          throw error;
        }
        timedOut = true;
        return [];
      }
    });
    const found = [...walk.found.values()];
    const hydrated = await this.hydrateNodes(
      found.map((f) => ({ node_type: f.type, node_id: f.id, depth: f.depth })),
    );
    const byKey = new Map(hydrated.map((n) => [`${n.type}:${n.id}`, n]));
    return {
      nodes: found.map((f) => {
        const n = byKey.get(`${f.type}:${f.id}`);
        return {
          id: f.id,
          type: f.type,
          label: n?.label ?? f.id,
          assetType: n?.assetType ?? null,
          sourceType: n?.sourceType ?? null,
          sourceName: n?.sourceName ?? null,
          status: n?.status ?? null,
          missing: n?.missing ?? false,
          depth: f.depth,
          side: f.side,
          via: f.via ? f.via.slice(f.via.indexOf(':') + 1) : null,
          viaKind: f.viaKind,
        };
      }),
      edges: [...walk.edges.values()].map((e) => ({
        id: e.id,
        fromType: e.from_type,
        fromId: e.from_id,
        toType: e.to_type,
        toId: e.to_id,
        relationType: e.relation_type,
        relationClass: e.relation_class,
        kind: e.kind,
        confidence: e.confidence === null ? null : Number(e.confidence),
      })),
      truncated: walk.truncated || timedOut,
    };
  }

  /** One hop of a trace: each frontier node's edges out and in, capped per node. */
  private traceLevelSql(frontier: TraceNodeRef[], kinds: TraceKind[]) {
    const types = frontier.map((f) => f.type);
    const ids = frontier.map((f) => f.id);
    const columns = Prisma.sql`e.id, e.from_type, e.from_id, e.to_type, e.to_id,
      e.relation_type, e.relation_class::text AS relation_class,
      e.confidence::float8 AS confidence, ${TRACE_KIND_SQL} AS kind`;
    return Prisma.sql`
      SELECT f.node_type AS src_type, f.node_id AS src_id, x.*
      FROM unnest(${types}::text[], ${ids}::text[]) AS f(node_type, node_id)
      CROSS JOIN LATERAL (
        (SELECT 'out'::text AS dir, ${columns}
           FROM edges e
          WHERE e.from_type = f.node_type AND e.from_id = f.node_id
            AND e.to_type IN ('asset', ${EXTERNAL_NODE})
            AND ${TRACE_KIND_SQL} = ANY(${kinds}::text[])
          LIMIT ${TRACE_PER_NODE})
        UNION ALL
        (SELECT 'in'::text AS dir, ${columns}
           FROM edges e
          WHERE e.to_type = f.node_type AND e.to_id = f.node_id
            AND e.from_type IN ('asset', ${EXTERNAL_NODE})
            AND ${TRACE_KIND_SQL} = ANY(${kinds}::text[])
          LIMIT ${TRACE_PER_NODE})
      ) x
    `;
  }

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
   * every linked node survive deletion of the underlying asset/finding. The
   * live edge neighbourhood of real assets is layered on top for
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
    await this.inferEdgesForAssets(assetEvidence.map((e) => e.entityId));

    // Live neighbourhood of the real assets (relationships + unlinked findings).
    const base =
      assetEvidence.length > 0
        ? await this.traverse(
            assetEvidence.map((e) => ({ type: 'asset', id: e.entityId })),
            Math.min(depth, MAX_DEPTH),
            'both',
          )
        : { nodes: [], edges: [], truncated: false };

    const merged = await this.mergeCaseGraph(caseId, evidence, base);
    return this.badgeInquiryStates(caseId, merged);
  }

  /**
   * Mark which of a case's finding nodes the latest scan brought in or took
   * away, according to the inquiries driving that case.
   *
   * Scoped to the nodes already on the graph rather than to every match of
   * every linked inquiry: this is a question about one screenful, and answering
   * it by walking the corpus would cost the same as the inquiry page itself.
   *
   * A failure here badges nothing. The graph is the case's main entrance, and
   * it must still open when the matching stack cannot answer.
   */
  private async badgeInquiryStates(
    caseId: string,
    graph: GraphResponseDto,
  ): Promise<GraphResponseDto> {
    if (!this.matching) return graph;
    const findingIds = graph.nodes
      .filter((n) => n.type === 'finding')
      .map((n) => n.id);
    if (findingIds.length === 0) return graph;

    try {
      const links = await this.prisma.caseInquiry.findMany({
        where: { caseId },
        select: { inquiryId: true },
      });
      if (links.length === 0) return graph;

      const states = await this.matching.matchStatesForFindings(
        links.map((l) => l.inquiryId),
        findingIds,
      );
      if (states.size === 0) return graph;

      for (const node of graph.nodes) {
        if (node.type !== 'finding') continue;
        const state = states.get(node.id);
        // ONGOING is the unremarkable case and is left off the wire entirely,
        // so the canvas decorator only sees what it should draw.
        if (state === 'NEW' || state === 'GONE') node.matchState = state;
      }
    } catch (error) {
      this.logger.warn(
        `Inquiry states not applied to case ${caseId} graph: ${String(error)}`,
      );
    }
    return graph;
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

    // A snapshot node stands in for a row the traversal did not return, which
    // is either a deleted row or a live one past the node cap. Only a lookup
    // tells them apart, and the board draws the two very differently (a ghost
    // versus an ordinary row), so ask instead of guessing.
    const unseenAssetIds = evidence
      .filter(
        (e) => e.entityType === 'asset' && !nodes.has(key('asset', e.entityId)),
      )
      .map((e) => e.entityId);
    const unseenFindingIds = evidence.flatMap((e) =>
      e.findings
        .filter((cf) => !nodes.has(key('finding', cf.findingId)))
        .map((cf) => cf.findingId),
    );
    const [liveAssets, liveFindings] = await Promise.all([
      unseenAssetIds.length > 0
        ? this.prisma.asset.findMany({
            where: { id: { in: unseenAssetIds } },
            select: { id: true, status: true },
          })
        : Promise.resolve([] as Array<{ id: string; status: unknown }>),
      unseenFindingIds.length > 0
        ? this.prisma.finding.findMany({
            where: { id: { in: unseenFindingIds } },
            select: { id: true, status: true, severity: true },
          })
        : Promise.resolve(
            [] as Array<{ id: string; status: unknown; severity: unknown }>,
          ),
    ]);
    const liveAssetById = new Map<string, { status: unknown }>(
      liveAssets.map((a) => [a.id, a]),
    );
    const liveFindingById = new Map<
      string,
      { status: unknown; severity: unknown }
    >(liveFindings.map((f) => [f.id, f]));

    // Evidence nodes — add missing/deleted nodes, refresh labels from snapshots.
    for (const e of evidence) {
      const k = key(e.entityType, e.entityId);
      const existing = nodes.get(k);
      if (existing && !existing.missing) continue;
      const live = liveAssetById.get(e.entityId);
      nodes.set(k, {
        id: e.entityId,
        type: e.entityType,
        depth: 0,
        label: e.label ?? e.entityId,
        assetType: e.assetType ?? undefined,
        sourceType: e.sourceType ?? undefined,
        status: live ? String(live.status) : existing?.status,
        // The traversal already knows a seed it hydrated is gone; for one it
        // never reached, the lookup above decides.
        missing: existing ? true : e.entityType === 'asset' ? !live : false,
      });
    }

    // Linked finding nodes — snapshot labels survive deletion; synthesize the
    // CONTAINS edge for findings whose asset was deleted (no live edge).
    for (const e of evidence) {
      for (const cf of e.findings) {
        const k = key('finding', cf.findingId);
        const existing = nodes.get(k);
        if (!existing || existing.missing) {
          const live = liveFindingById.get(cf.findingId);
          nodes.set(k, {
            id: cf.findingId,
            type: 'finding',
            depth: 1,
            label: findingLabel(cf.label, cf.matchedContent),
            severity: live ? String(live.severity) : (cf.severity ?? undefined),
            detectorType: cf.detectorType ?? undefined,
            customDetectorName: cf.customDetectorName ?? undefined,
            matchedContent: cf.matchedContent ?? undefined,
            status: live ? String(live.status) : undefined,
            assetId: e.entityId,
            assetName: e.label ?? undefined,
            // Without this a finding whose row was deleted is drawn exactly
            // like a live one; the case board renders it as a ghost instead.
            missing: existing ? true : !live,
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
    relationClass?: string,
    fanOutCap?: number,
  ): Promise<GraphResponseDto> {
    if (seeds.length === 0) {
      return { nodes: [], edges: [], truncated: false };
    }

    const seedValues = Prisma.join(
      seeds.map((s) => Prisma.sql`(${s.type}, ${s.id})`),
    );
    // Filtering by class is what separates "what breaks if I change this" from
    // "what lives inside what". Without it a lineage walk wanders through
    // containment and reference edges and answers a different question.
    const classFilter = relationClass
      ? Prisma.sql`AND e.relation_class = ${relationClass}::"EdgeClass"`
      : Prisma.empty;
    const relFilter =
      relationTypes && relationTypes.length > 0
        ? Prisma.sql`AND e.relation_type IN (${Prisma.join(relationTypes)}) ${classFilter}`
        : classFilter;

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

    // Hub guard. A hub is drawn but not walked *through*: one GENESIS table
    // fed ~900 assets, so at depth 2 the walk left the seed, reached that
    // table and came back with the whole namespace — 200 nodes, `truncated:
    // true`, and nothing about the asset the user asked about (field report
    // P13). The seed is exempt: refusing to expand it would return it alone.
    const hubGuard =
      fanOutCap && fanOutCap > 0
        ? // Two index probes summed, not one OR: an OR over from/to cannot use
          // either of the (type, id) indexes and degrades to a scan of `edges`
          // for every node the walk visits.
          Prisma.sql`AND (
            t.depth = 0
            OR (
              (SELECT count(*) FROM edges d
                WHERE d.from_type = t.node_type AND d.from_id = t.node_id)
              + (SELECT count(*) FROM edges d
                  WHERE d.to_type = t.node_type AND d.to_id = t.node_id)
            ) <= ${fanOutCap}
          )`
        : Prisma.empty;

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
        WHERE t.depth < ${depth} ${hubGuard}
      )
      SELECT node_type, node_id, MIN(depth) AS depth
      FROM traversal
      GROUP BY node_type, node_id
      ORDER BY MIN(depth) ASC
      LIMIT ${NODE_CAP}
    `);

    const truncated = nodeRows.length >= NODE_CAP;
    // The seed itself is normally in the result, so this is only empty when the
    // traversal genuinely found nothing. Guarded because `Prisma.join([])`
    // throws rather than producing an empty IN list, which would surface as a
    // 500 on a perfectly ordinary "this node has no lineage" answer.
    if (nodeRows.length === 0) {
      return { nodes: [], edges: [], truncated: false };
    }
    const nodes = await this.hydrateNodes(nodeRows);

    const nodeTuples = Prisma.join(
      nodeRows.map((n) => Prisma.sql`(${n.node_type}, ${n.node_id})`),
    );
    const edgeRows = await this.prisma.$queryRaw<EdgeRow[]>(Prisma.sql`
      SELECT id, from_type, from_id, to_type, to_id, relation_type, confidence, origin,
             relation_class, granularity, method, field_mappings, evidence, last_seen_at
      FROM edges e
      WHERE (e.from_type, e.from_id) IN (${nodeTuples})
        AND (e.to_type, e.to_id) IN (${nodeTuples})
        ${classFilter}
    `);

    const edges: GraphEdgeDto[] = edgeRows.map(toGraphEdge);

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
          urn: true,
          // A lineage graph exists to span systems, so which system a node is
          // in is not decoration. GraphNodeDto has always declared these; only
          // the correlation path ever filled them.
          sourceId: true,
          source: { select: { name: true } },
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
      if (r.node_type === EXTERNAL_NODE) {
        // An endpoint naming an object no scan has produced yet. It has to be
        // hydrated into a real node: dropping it here while its edge still
        // ships in `edges` would leave the canvas drawing an edge to a node
        // that does not exist.
        return {
          id: r.node_id,
          type: EXTERNAL_NODE,
          depth,
          label: externalLabel(r.node_id),
          status: 'external',
          urn: r.node_id,
          missing: false,
        };
      }
      if (r.node_type === 'asset') {
        const a = assetMap.get(r.node_id);
        return {
          id: r.node_id,
          type: 'asset',
          depth,
          label: a?.name ?? '(deleted asset)',
          assetType: a?.assetType,
          sourceType: a ? String(a.sourceType) : undefined,
          sourceId: a?.sourceId ?? undefined,
          sourceName: a?.source?.name ?? undefined,
          urn: a?.urn ?? undefined,
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
