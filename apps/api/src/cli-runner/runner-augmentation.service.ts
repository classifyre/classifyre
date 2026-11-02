import { BadRequestException, Injectable } from '@nestjs/common';

import { GraphService } from '../graph.service';
import { tryNormalizeUrn } from '../graph/urn';
import { PrismaService } from '../prisma.service';
import { generateDetectionIdentity } from '../utils/detection-identity';
import {
  QUERY_MAX_LIMIT,
  raw,
  requireRunningRunner,
} from './runner-query-common';

/** Writes per call. A notebook batches; the cap keeps one request bounded. */
export const AUGMENTATION_MAX_BATCH = QUERY_MAX_LIMIT;

/** Most severe last, so a higher index is a higher severity. */
const SEVERITY_ASC = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export interface AugmentationTagInput {
  assetId: string;
  key: string;
  value: string;
  severity?: string | null;
}

export interface AugmentationEdgeInput {
  fromId?: string;
  toId?: string;
  fromUrn?: string;
  toUrn?: string;
  relationType: string;
  relationClass?: string;
  method?: string;
  confidence?: number;
  evidence?: Record<string, unknown>;
}

export interface AugmentationResult {
  written: number;
  /** Rows a connector, a person or another source already owns; left alone. */
  skipped?: number;
  /** Rows that could not be placed, e.g. an asset linked to itself. */
  dropped?: number;
}

export interface AugmentationFinishResult {
  retiredTags: number;
  retiredEdges: number;
}

/**
 * What a running notebook may WRITE onto assets of other sources: tags
 * (findings of a Tag detector) and links (edges, glossary links among them).
 *
 * Every row carries its author — the notebook's source and run — so the
 * author's next complete run retires exactly what it stopped asserting
 * (`finish`) and nothing a connector, a person or another source wrote. The
 * author comes from the run the request is made for, never from the body.
 */
@Injectable()
export class RunnerAugmentationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
  ) {}

  async tags(runnerId: string, body: unknown): Promise<AugmentationResult> {
    const runner = await requireRunningRunner(this.prisma, runnerId, 'written');
    const list = batch(raw(body).tags, 'tags');
    if (list.length === 0) return { written: 0 };

    const tags = list.map(parseTag);
    const keys = [...new Set(tags.map((tag) => tag.key))];
    const detectors = await this.prisma.customDetector.findMany({
      where: { key: { in: keys }, isActive: true },
      select: { id: true, key: true, name: true, pipelineSchema: true },
    });
    const byKey = new Map(
      detectors
        .filter((d) => schemaOf(d.pipelineSchema).type === 'TAG')
        .map((d) => [d.key, d]),
    );
    const unknown = keys.filter((key) => !byKey.has(key));
    if (unknown.length > 0) {
      const valid = await this.prisma.customDetector.findMany({
        where: {
          isActive: true,
          pipelineSchema: { path: ['type'], equals: 'TAG' },
        },
        select: { key: true },
        take: 50,
      });
      throw new BadRequestException(
        `No active Tag detector with key ${unknown.map((k) => JSON.stringify(k)).join(', ')}. ` +
          `Tag detectors: ${valid.map((d) => d.key).join(', ') || '(none)'}.`,
      );
    }

    const assetIds = [...new Set(tags.map((tag) => tag.assetId))];
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, sourceId: true },
    });
    const sourceOf = new Map(assets.map((asset) => [asset.id, asset.sourceId]));
    const missing = assetIds.filter((id) => !sourceOf.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `No such asset in this namespace: ${missing.slice(0, 5).join(', ')}.`,
      );
    }
    const own = assetIds.filter((id) => sourceOf.get(id) === runner.sourceId);
    if (own.length > 0) {
      throw new BadRequestException(
        `ctx.tag() is for assets of other sources; ${own.slice(0, 5).join(', ')} belong to this source. Put those in Asset(tags=...).`,
      );
    }

    // One finding per (asset, tag key, author): a changed value updates it,
    // so two sources tagging the same key never collapse into one row.
    const now = new Date();
    const rows = tags.map((tag) => {
      const detector = byKey.get(tag.key)!;
      const schema = schemaOf(detector.pipelineSchema);
      const label = (schema.label || detector.name || detector.key).trim();
      const ceiling = severityName(schema.severity) ?? 'MEDIUM';
      const asked = tag.severity ? severityName(tag.severity) : null;
      const applied =
        asked && SEVERITY_ASC.indexOf(asked) <= SEVERITY_ASC.indexOf(ceiling)
          ? asked
          : ceiling;
      const lowered = Boolean(tag.severity) && applied !== asked;
      const findingType = `tag:${label}`;
      return {
        tag,
        detector,
        findingType,
        applied,
        identity: generateDetectionIdentity({
          assetId: tag.assetId,
          detectorType: 'CUSTOM',
          findingType,
          matchedContent: tag.value,
          customDetectorKey: tag.key,
          identityKey: `asserted:${runner.sourceId}`,
        }),
        metadata: {
          runner: 'TAG',
          label,
          tag_key: tag.key,
          tag_value: tag.value,
          asserted_by_source_id: runner.sourceId,
          ...(applied !== ceiling
            ? { tag_severity: applied.toLowerCase() }
            : {}),
          ...(lowered
            ? { tag_severity_requested: String(tag.severity).toUpperCase() }
            : {}),
        },
      };
    });

    await this.prisma.$transaction(
      async (tx) => {
        for (const row of rows) {
          const common = {
            severity: row.applied as never,
            matchedContent: row.tag.value,
            metadata: row.metadata,
            runnerId: null,
            assertedByRunnerId: runner.id,
            lastDetectedAt: now,
            customDetectorId: row.detector.id,
            customDetectorName: row.detector.name,
          };
          await tx.finding.upsert({
            where: { detectionIdentity: row.identity },
            create: {
              ...common,
              detectionIdentity: row.identity,
              assetId: row.tag.assetId,
              sourceId: sourceOf.get(row.tag.assetId)!,
              assertedBySourceId: runner.sourceId,
              detectorType: 'CUSTOM',
              findingType: row.findingType,
              category: 'CLASSIFICATION',
              confidence: 1,
              customDetectorKey: row.tag.key,
              detectedAt: now,
              firstDetectedAt: now,
            },
            // A person's ruling on a tag (resolved, false positive) stands; a
            // re-assertion refreshes the value and the run, not the status.
            update: common,
          });
        }
      },
      { timeout: 55_000, maxWait: 5_000 },
    );
    return { written: rows.length };
  }

  async edges(runnerId: string, body: unknown): Promise<AugmentationResult> {
    const runner = await requireRunningRunner(this.prisma, runnerId, 'written');
    const list = batch(raw(body).edges, 'edges');
    if (list.length === 0) return { written: 0 };
    const edges = list.map(parseEdge);
    // A URN that cannot be read would be dropped by the graph and look, in the
    // counts, like a row someone else owns. Say so up front instead.
    const badUrns = edges
      .flatMap((e) => [e.fromUrn, e.toUrn])
      .filter((urn): urn is string => Boolean(urn) && !tryNormalizeUrn(urn));
    if (badUrns.length > 0) {
      throw new BadRequestException(
        `Not a valid URN: ${[...new Set(badUrns)].slice(0, 5).join(', ')}. Use an asset's urn, or term://glossary/<key>.`,
      );
    }

    const ids = [
      ...new Set(
        edges
          .flatMap((e) => [e.fromId, e.toId])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (ids.length > 0) {
      const found = await this.prisma.asset.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const have = new Set(found.map((asset) => asset.id));
      const missing = ids.filter((id) => !have.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `No such asset in this namespace: ${missing.slice(0, 5).join(', ')}.`,
        );
      }
    }

    const result = await this.graph.upsertEdges(
      {
        sourceId: runner.sourceId,
        edges: edges.map((e) => ({
          fromType: 'asset',
          toType: 'asset',
          ...e,
        })),
      },
      { sourceId: runner.sourceId, runnerId: runner.id },
    );
    return {
      written: result.upserted,
      // Rows another owner holds: sent, valid, and left as they were.
      skipped: Math.max(
        0,
        edges.length - result.upserted - (result.dropped ?? 0),
      ),
      // Rows the graph could not place (an asset linked to itself).
      dropped: result.dropped ?? 0,
    };
  }

  /**
   * End of an augmentation: retire what this source asserted in an earlier run
   * and did not assert in this one. Called by the CLI only after the notebook
   * finished without error, abort or partial coverage — an interrupted run
   * says nothing about what should still hold.
   */
  async finish(runnerId: string): Promise<AugmentationFinishResult> {
    const runner = await requireRunningRunner(this.prisma, runnerId, 'written');
    const tags = await this.prisma.$executeRaw`
      UPDATE findings
         SET status = 'RESOLVED'::"FindingStatus",
             resolved_at = now(),
             resolution_reason = 'No longer asserted by the source that tagged it',
             updated_at = now()
       WHERE asserted_by_source_id = ${runner.sourceId}
         AND asserted_by_runner_id <> ${runner.id}
         AND status = 'OPEN'::"FindingStatus"`;
    const edges = await this.prisma.$executeRaw`
      DELETE FROM edges
       WHERE asserted_by_source_id = ${runner.sourceId}
         AND asserted_by_runner_id <> ${runner.id}
         AND origin <> 'MANUAL'::"EdgeOrigin"`;
    return { retiredTags: tags, retiredEdges: edges };
  }
}

function batch(value: unknown, name: string): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > AUGMENTATION_MAX_BATCH) {
    throw new BadRequestException(
      `${name} must be a list of at most ${AUGMENTATION_MAX_BATCH} items; send more in further calls.`,
    );
  }
  return value.map((item) => raw(item));
}

function str(value: unknown, name: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new BadRequestException(
      `${name} must be non-empty text of at most ${max} characters.`,
    );
  }
  return value.trim();
}

function parseTag(item: Record<string, unknown>): AugmentationTagInput {
  return {
    assetId: str(item.assetId, 'tags[].assetId', 64),
    key: str(item.key, 'tags[].key', 200),
    value: str(item.value, 'tags[].value'),
    severity:
      item.severity === undefined || item.severity === null
        ? null
        : str(item.severity, 'tags[].severity', 20),
  };
}

function parseEdge(item: Record<string, unknown>): AugmentationEdgeInput {
  const edge: AugmentationEdgeInput = {
    relationType: str(
      item.relationType,
      'edges[].relationType',
      50,
    ).toUpperCase(),
  };
  for (const name of ['fromId', 'toId', 'fromUrn', 'toUrn'] as const) {
    if (item[name] !== undefined && item[name] !== null)
      edge[name] = str(item[name], `edges[].${name}`);
  }
  if (!edge.fromId && !edge.fromUrn)
    throw new BadRequestException('Every edge needs a fromId or fromUrn.');
  if (!edge.toId && !edge.toUrn)
    throw new BadRequestException('Every edge needs a toId or toUrn.');
  if (typeof item.relationClass === 'string')
    edge.relationClass = item.relationClass;
  if (typeof item.method === 'string') edge.method = item.method;
  if (typeof item.confidence === 'number') edge.confidence = item.confidence;
  if (item.evidence && typeof item.evidence === 'object')
    edge.evidence = item.evidence as Record<string, unknown>;
  return edge;
}

function schemaOf(value: unknown): {
  type?: string;
  label?: string;
  severity?: string;
} {
  const schema = raw(value);
  return {
    type:
      typeof schema.type === 'string' ? schema.type.toUpperCase() : undefined,
    label: typeof schema.label === 'string' ? schema.label : undefined,
    severity: typeof schema.severity === 'string' ? schema.severity : undefined,
  };
}

function severityName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().toUpperCase();
  return SEVERITY_ASC.includes(name) ? name : null;
}
