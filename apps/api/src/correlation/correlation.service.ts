import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  DetectorType,
  EdgeOrigin,
  FindingStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { GraphEdgeDto, GraphNodeDto } from '../dto/graph.dto';
import { UnionFind } from '../utils/union-find';
import {
  DEFAULT_LABEL_WEIGHT,
  DUPLICATE_MIN,
  EDGE_BATCH,
  EMPTY_CONTENT_SHA256,
  FANOUT_CAP,
  IDENTICAL_GROUP_CAP,
  IDENTICAL_GROUP_PAGE,
  MAX_CLUSTER_TOP_VALUES,
  PHONETIC_FANOUT_CAP,
  PHONETIC_MIN_JW,
  RELATED_MIN,
} from './correlation.constants';
import {
  type CorrelationBatchSizes,
  computeCorrelationBatchSizes,
} from './batch-sizing';
import { CorrelationGraphCacheService } from './correlation-graph-cache.service';
import { CorrelationJobScheduler } from './correlation-job-scheduler.service';
import { CorrelationLockService } from './correlation-lock.service';
import {
  hashSet,
  jaroWinkler,
  normalizeLabel,
  normalizeValue,
  phoneticFingerprint,
  valueHash,
  weightForLabel,
} from './value-normalizer';

const ASSET_REL = 'asset';
const REL_RELATED = 'related';
const REL_DUPLICATE = 'likely_duplicate';
/**
 * Byte-identical content (equal `Asset.contentHash`). Deliberately its own
 * relation type rather than another `likely_duplicate`: "these are the same
 * bytes" is a stronger and differently-derived claim than "these findings
 * overlap enough to look like the same document", and keeping them apart means
 * the two passes cannot overwrite each other's edges (the Edge unique key
 * includes relationType).
 */
const REL_IDENTICAL = 'identical_content';

/**
 * Edges produced by the weighted-overlap scorer, and therefore wiped and
 * rewritten by it. REL_IDENTICAL is absent on purpose — it is maintained by
 * linkIdenticalContent, which has its own delete scope.
 */
const SCORED_RELATION_TYPES = [REL_RELATED, REL_DUPLICATE];

/** Edge types that make two assets members of the same identity cluster. */
const CLUSTERING_RELATION_TYPES = [REL_DUPLICATE, REL_IDENTICAL];

/** Every asset↔asset correlation edge type, for graph/similarity reads. */
export const CORRELATION_RELATION_TYPES = [
  REL_RELATED,
  REL_DUPLICATE,
  REL_IDENTICAL,
];

/** One normalized, correlatable token belonging to an asset. */
interface ValueRow {
  valueHash: string;
  label: string;
  normalizedValue: string;
}

/** Explainable similarity between two assets. */
export interface PairScore {
  weighted: number;
  jaccard: number;
  sharedCount: number;
  sharedByLabel: Record<string, number>;
  exact: boolean;
}

export interface CorrelationRunSummary {
  assetsProcessed: number;
  valuesIndexed: number;
  relatedPairs: number;
  duplicatePairs: number;
  /** Byte-identical groups linked from Asset.contentHash (findings-independent). */
  identicalGroups: number;
  /** Links written for those groups — one per member beyond the group's hub. */
  identicalPairs: number;
  clustersTouched: number;
  topMatch: {
    fromAssetId: string;
    toAssetId: string;
    weighted: number;
    reasons: string[];
  } | null;
}

const ASSET_SELECT = {
  id: true,
  name: true,
  externalUrl: true,
  assetType: true,
  sourceType: true,
  sourceId: true,
  source: { select: { name: true } },
} satisfies Prisma.AssetSelect;

/** Minimal fields needed to render an asset graph node. */
const ASSET_NODE_SELECT = {
  id: true,
  name: true,
  externalUrl: true,
  assetType: true,
  sourceType: true,
  sourceId: true,
  // The operator-facing source name, so the UI can label clusters with the
  // real source ("Enron Email Archive") instead of its connector enum.
  source: { select: { name: true } },
} satisfies Prisma.AssetSelect;

/**
 * A value to ignore when fingerprinting. `mode` decides how `value` is matched
 * against a finding's normalized value; `label` optionally scopes it (and is the
 * excluded label itself when mode === 'label').
 */
export interface ExclusionRule {
  id: string;
  mode: 'value' | 'regex' | 'label';
  label: string | null;
  value: string | null;
}

/** DB-backed tuning resolved into fast lookups for a recompute pass. */
interface ResolvedConfig {
  weightOf: (label: string) => number;
  /** Raw label → weight overrides, for pushing the weight lookup into SQL. */
  rawWeights: Record<string, number>;
  defaultWeight: number;
  relatedMin: number;
  duplicateMin: number;
  /** True when a (normalized) label/value should be ignored. */
  isExcluded: (label: string, value: string) => boolean;
}

export interface CorrelationConfigDto {
  defaultWeight: number;
  relatedMin: number;
  duplicateMin: number;
  /** Every label currently present in the index, with its effective weight. */
  labels: Array<{ label: string; weight: number; inUse: boolean }>;
  exclusions: ExclusionRule[];
}

export interface SaveCorrelationConfigInput {
  defaultWeight?: number;
  relatedMin?: number;
  duplicateMin?: number;
  labelWeights?: Record<string, number>;
  exclusions?: Array<{
    id?: string;
    mode: ExclusionRule['mode'];
    label?: string | null;
    value?: string | null;
  }>;
}

/** Pairwise asset similarity (from the asset↔asset correlation edges). */
export interface AssetSimilarity {
  fromId: string;
  toId: string;
  /** Weighted match in [0,1]. */
  weighted: number;
  relationType: string;
}

export interface CorrelationGraphResult {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  truncated: boolean;
  /** Strength of each correlated asset pair, for display + slider filtering. */
  similarities: AssetSimilarity[];
}

export interface ValueOccurrenceDto {
  label: string;
  value: string;
  valueHash: string;
  assets: Array<{
    assetId: string;
    findingId: string | null;
    name: string;
    externalUrl: string;
    assetType: string;
    sourceType: string;
    sourceId: string;
    sourceName: string;
    clusterId: string | null;
  }>;
}

export const DEFAULT_GRAPH_MAX_FAN_OUT = 10;

/**
 * Reads CORRELATION_GRAPH_MAX_FANOUT. 0 disables the filter; anything absent
 * or malformed falls back to the default rather than silently disabling it,
 * because an unfiltered graph is the failure mode, not the safe state.
 */
export function readGraphMaxFanOut(env: NodeJS.ProcessEnv): number {
  const raw = env.CORRELATION_GRAPH_MAX_FANOUT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_GRAPH_MAX_FAN_OUT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_GRAPH_MAX_FAN_OUT;
  return parsed === 0 ? Number.POSITIVE_INFINITY : parsed;
}

/**
 * Reads ASSET_MAP_NODE_CAP. Unset means unlimited — the asset map is meant to
 * show every asset in the namespace, with the clustering worker's semantic
 * zoom (already proven on the 61k-node unscoped correlation graph) absorbing
 * the density. This exists purely as an emergency override for a pathological
 * instance, not a default ceiling.
 */
export function readAssetMapNodeCap(env: NodeJS.ProcessEnv): number {
  const raw = env.ASSET_MAP_NODE_CAP;
  if (raw === undefined || raw.trim() === '') return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return Number.POSITIVE_INFINITY;
  return parsed;
}

/** Progress callback threaded into long-running recompute passes. */
type ProgressFn = (
  msg: string,
  data?: Record<string, unknown>,
) => Promise<void>;

/** Yield to the event loop so V8's GC can reclaim objects between batches. */
function yieldToGC(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Deterministic asset-correlation engine ("evidence fingerprints"). Derives
 * normalized, correlatable tokens from findings, maintains a reverse index
 * (value → assets), scores pairwise overlap (weighted + Jaccard), records
 * related/duplicate Edges, and maintains identity clusters via union-find.
 * No AI, no embeddings.
 */
@Injectable()
export class CorrelationService {
  private readonly logger = new Logger(CorrelationService.name);

  /**
   * Largest number of assets a shared value may bind before the unscoped graph
   * drops it.
   *
   * A value held by hundreds of documents — a company name, a boilerplate
   * footer, a common date — connects everything to everything and tells an
   * investigator nothing. The Fingerprints UI already knows this: it ranks
   * shared values by *ascending* fan-out, rarest first, because two documents
   * sharing one obscure account number is the finding and two hundred sharing
   * "Enron" is not.
   *
   * Those hubs are also where the payload's weight is. Measured on a real
   * corpus (11,598 clustered assets, 51,985 shared values, 288,274 edges):
   * keeping only values bound to ≤10 assets retains 92% of distinct values
   * while dropping half the edges. The graph gets smaller and more useful at
   * the same time, which is why this is a fan-out filter and not the obvious
   * `take: N` on clusters — capping by cluster size would have kept the hubs
   * and discarded the rare pairs the page ranks highest.
   *
   * Raise it (or set 0 for no filter) when a corpus genuinely needs hub values
   * in the overview.
   */
  private readonly graphMaxFanOut = readGraphMaxFanOut(process.env);
  private readonly assetMapNodeCap = readAssetMapNodeCap(process.env);
  private readonly batches: CorrelationBatchSizes;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graphCache: CorrelationGraphCacheService,
    private readonly correlationLock: CorrelationLockService,
    private readonly jobs: CorrelationJobScheduler,
  ) {
    this.batches = computeCorrelationBatchSizes();
    this.logger.log(
      `Batch sizing: memory=${this.batches.memoryMb} MB (${this.batches.memorySource}), ` +
        `findingsPage=${this.batches.findingsPage}, ` +
        `valueUpsertBatch=${this.batches.valueUpsertBatch}, ` +
        `streamPage=${this.batches.streamPage}`,
    );
  }

  // ── Recompute entry points ────────────────────────────────────────────────

  /** Correlate every asset touched by a completed runner. */
  async recomputeForRunner(
    sourceId: string,
    runnerId: string,
    onProgress?: ProgressFn,
  ): Promise<CorrelationRunSummary> {
    const touched = await this.prisma.asset.findMany({
      where: { runnerId },
      select: { id: true },
    });
    if (onProgress)
      await onProgress(`Found ${touched.length} asset(s) to fingerprint.`, {
        total: touched.length,
      });
    return this.runRecomputeAndInvalidate(`runner:${runnerId}`, () =>
      this.recompute(
        touched.map((a) => a.id),
        false,
        onProgress,
      ),
    );
  }

  /** On-demand correlation for a single asset (and its neighbourhood). */
  async recomputeForAsset(assetId: string): Promise<CorrelationRunSummary> {
    return this.runRecomputeAndInvalidate(`asset:${assetId}`, () =>
      this.recompute([assetId]),
    );
  }

  async recomputeForAssets(assetIds: string[]): Promise<CorrelationRunSummary> {
    const unique = [...new Set(assetIds)].filter(Boolean);
    return this.runRecomputeAndInvalidate(`assets:${unique.length}`, () =>
      this.recompute(unique),
    );
  }

  /**
   * Recompute correlation for every asset (e.g. after a config change).
   * Asset IDs are fetched in pages so the Node heap never holds them all at
   * once. Fingerprint rebuild is also paged with GC yields between pages.
   */
  async recomputeAll(onProgress?: ProgressFn): Promise<CorrelationRunSummary> {
    return this.runRecomputeAndInvalidate('full recompute', () =>
      this.recomputeAllUnlocked(onProgress),
    );
  }

  private async recomputeAllUnlocked(
    onProgress?: ProgressFn,
  ): Promise<CorrelationRunSummary> {
    const cfg = await this.loadConfig();
    const total = await this.prisma.asset.count();
    if (onProgress)
      await onProgress(`Full recompute: ${total} total asset(s).`, { total });

    let valuesIndexed = 0;
    let processed = 0;
    const PAGE = 200;
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.asset.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      for (const r of rows) {
        valuesIndexed += await this.rebuildAssetValues(r.id, cfg);
        await yieldToGC(); // after every asset so GC can reclaim large finding arrays
      }
      processed += rows.length;
      if (onProgress)
        await onProgress(
          `Fingerprinted ${processed}/${total} assets (${valuesIndexed} values).`,
          { processed, total, valuesIndexed },
        );
      cursor = rows.at(-1)!.id;
      if (rows.length < PAGE) break;
    }

    if (onProgress) await onProgress('Scoring all pairs…');
    // full=true: workingIds=null, touchFilter=empty — touchedIds is unused in SQL.
    const { relatedPairs, duplicatePairs, topMatch } = await this.scoreAndLink(
      [],
      cfg,
      true,
    );
    if (onProgress)
      await onProgress(
        `Pairs scored: ${relatedPairs} related, ${duplicatePairs} duplicate. Linking exact duplicates…`,
        { relatedPairs, duplicatePairs },
      );
    const identical = await this.linkIdenticalContent([], true, onProgress);
    if (onProgress) await onProgress('Rebuilding clusters…');
    const clustersTouched = await this.rebuildAllClusters(cfg);
    return {
      assetsProcessed: processed,
      valuesIndexed,
      relatedPairs,
      duplicatePairs,
      identicalGroups: identical.groups,
      identicalPairs: identical.pairs,
      clustersTouched,
      topMatch,
    };
  }

  // ── Tuning config (DB-backed, dynamic labels) ───────────────────────────────

  /** Resolve the singleton config into fast lookups, falling back to defaults. */
  private async loadConfig(): Promise<ResolvedConfig> {
    const row = await this.prisma.correlationConfig.findUnique({
      where: { id: 1 },
    });
    const weights =
      (row?.labelWeights as Record<string, number> | undefined) ?? {};
    const def = row?.defaultWeight ?? DEFAULT_LABEL_WEIGHT;
    return {
      weightOf: (label: string) => weights[normalizeLabel(label)] ?? def,
      rawWeights: weights,
      defaultWeight: def,
      relatedMin: row ? Number(row.relatedMin) : RELATED_MIN,
      duplicateMin: row ? Number(row.duplicateMin) : DUPLICATE_MIN,
      isExcluded: buildExclusionPredicate(parseExclusions(row?.exclusions)),
    };
  }

  /** Current config plus every in-use label with its effective weight. */
  async getConfig(): Promise<CorrelationConfigDto> {
    const [row, labelRows] = await Promise.all([
      this.prisma.correlationConfig.findUnique({ where: { id: 1 } }),
      this.prisma.assetCorrelationValue.findMany({
        select: { label: true },
        distinct: ['label'],
        orderBy: { label: 'asc' },
      }),
    ]);
    const weights =
      (row?.labelWeights as Record<string, number> | undefined) ?? {};
    const defaultWeight = row?.defaultWeight ?? DEFAULT_LABEL_WEIGHT;

    const inUse = new Set(labelRows.map((r) => r.label));
    // Union of in-use labels and any explicitly configured (possibly retired).
    const labels = [...new Set([...inUse, ...Object.keys(weights)])]
      .sort()
      .map((label) => ({
        label,
        weight: weights[label] ?? defaultWeight,
        inUse: inUse.has(label),
      }));

    return {
      defaultWeight,
      relatedMin: row ? Number(row.relatedMin) : RELATED_MIN,
      duplicateMin: row ? Number(row.duplicateMin) : DUPLICATE_MIN,
      labels,
      exclusions: parseExclusions(row?.exclusions),
    };
  }

  /** Append one exclusion rule (server-assigned id). Caller schedules recompute. */
  async addExclusion(
    rule: Omit<ExclusionRule, 'id'>,
  ): Promise<CorrelationConfigDto> {
    const existing = await this.prisma.correlationConfig.findUnique({
      where: { id: 1 },
    });
    const rules = parseExclusions(existing?.exclusions);
    rules.push({ ...normalizeRule(rule), id: randomUUID() });
    return this.saveConfig({ exclusions: rules });
  }

  /** Remove an exclusion rule by id. Caller schedules recompute. */
  async removeExclusion(id: string): Promise<CorrelationConfigDto> {
    const existing = await this.prisma.correlationConfig.findUnique({
      where: { id: 1 },
    });
    const rules = parseExclusions(existing?.exclusions).filter(
      (r) => r.id !== id,
    );
    return this.saveConfig({ exclusions: rules });
  }

  /** Upsert the singleton config. Does NOT recompute — the caller schedules it. */
  async saveConfig(
    input: SaveCorrelationConfigInput,
  ): Promise<CorrelationConfigDto> {
    const existing = await this.prisma.correlationConfig.findUnique({
      where: { id: 1 },
    });
    const mergedWeights: Record<string, number> = {
      ...((existing?.labelWeights as Record<string, number> | undefined) ?? {}),
      ...(input.labelWeights ?? {}),
    };
    // Drop weights equal to the default to keep the map lean.
    const defaultWeight = clampWeight(
      input.defaultWeight ?? existing?.defaultWeight ?? DEFAULT_LABEL_WEIGHT,
    );
    const labelWeights: Record<string, number> = {};
    for (const [label, w] of Object.entries(mergedWeights)) {
      const key = normalizeLabel(label);
      if (!key) continue;
      const weight = clampWeight(w);
      if (weight !== defaultWeight) labelWeights[key] = weight;
    }
    const relatedMin = clampUnit(
      input.relatedMin ??
        (existing ? Number(existing.relatedMin) : RELATED_MIN),
    );
    const duplicateMin = clampUnit(
      input.duplicateMin ??
        (existing ? Number(existing.duplicateMin) : DUPLICATE_MIN),
    );
    const exclusions = (
      input.exclusions ?? parseExclusions(existing?.exclusions)
    )
      .map((r) => ({ ...normalizeRule(r), id: r.id || randomUUID() }))
      .filter((r) => isUsableRule(r));

    await this.prisma.correlationConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        labelWeights,
        defaultWeight,
        relatedMin,
        duplicateMin,
        exclusions: exclusions,
      },
      update: {
        labelWeights,
        defaultWeight,
        relatedMin,
        duplicateMin,
        exclusions: exclusions,
      },
    });
    const config = await this.getConfig();
    await this.jobs.scheduleFull('correlation config changed');
    return config;
  }

  /**
   * Runs a correlation recompute and marks the graph snapshot stale.
   *
   * This used to rebuild and publish the whole graph inline, under the
   * correlation lock, on *every* recompute — including `recomputeForAsset`,
   * which can be one asset. A whole-graph build assembles every node and edge
   * in the namespace: on a real corpus that is 61k nodes and 272k edges and
   * over 2 GB of live JS objects, which is enough to exhaust the API's heap by
   * itself ("Ineffective mark-compacts near heap limit" at 2041 MB of a
   * 2144 MB ceiling, repeatedly, until the restart budget gave out).
   *
   * Worse, it was invisible to the coalescing added for graph refreshes: that
   * only throttles the `refreshGraph` job, and this path never enqueued one.
   * A scan ingesting steadily therefore rebuilt the entire graph per batch of
   * touched assets, with no window between rebuilds at all.
   *
   * Invalidating instead costs a version bump and a coalesced job. Reads keep
   * working throughout — a read against a stale snapshot serves the last-good
   * payload and nudges the refresh — so what this trades away is graph
   * freshness within the coalescing window, in exchange for the API surviving
   * the scan that is updating it.
   */
  private async runRecomputeAndInvalidate<T>(
    reason: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = await this.correlationLock.runExclusive(operation);
    // Outside the lock: invalidation only bumps a version and enqueues, and
    // holding the correlation lock across it would serialise callers behind
    // queue I/O for no benefit.
    await this.graphCache.invalidate(reason);
    return result;
  }

  private async recompute(
    touchedIds: string[],
    full = false,
    onProgress?: ProgressFn,
  ): Promise<CorrelationRunSummary> {
    const empty: CorrelationRunSummary = {
      assetsProcessed: 0,
      valuesIndexed: 0,
      relatedPairs: 0,
      duplicatePairs: 0,
      identicalGroups: 0,
      identicalPairs: 0,
      clustersTouched: 0,
      topMatch: null,
    };
    if (touchedIds.length === 0) return empty;

    // Load the (DB-backed, dynamic) tuning once per recompute.
    const cfg = await this.loadConfig();

    // 1. Rebuild fingerprints (reverse-index rows + signature) for each asset,
    //    skipping any values matched by exclusion rules. Yield to GC every 50
    //    assets so long scans don't accumulate unreachable objects in the heap.
    let valuesIndexed = 0;
    for (let i = 0; i < touchedIds.length; i++) {
      valuesIndexed += await this.rebuildAssetValues(touchedIds[i], cfg);
      await yieldToGC(); // after every asset so GC can reclaim large finding arrays
      if (i > 0 && i % 50 === 0 && onProgress)
        await onProgress(
          `Fingerprinted ${i + 1}/${touchedIds.length} assets (${valuesIndexed} values so far)…`,
          { processed: i + 1, total: touchedIds.length, valuesIndexed },
        );
    }

    if (onProgress)
      await onProgress('Scoring pairs…', {
        processed: touchedIds.length,
        valuesIndexed,
      });

    // 2. Score touched assets against candidates and (re)link them. Index-driven
    //    + batched so it stays bounded in memory on large datasets.
    const { relatedPairs, duplicatePairs, topMatch, affectedAssetIds } =
      await this.scoreAndLink(touchedIds, cfg, full);

    if (onProgress)
      await onProgress(
        `Pairs scored: ${relatedPairs} related, ${duplicatePairs} duplicate. Linking exact duplicates…`,
        { relatedPairs, duplicatePairs },
      );

    // 3. Exact duplicates from the content hash. Independent of findings, so it
    //    runs whatever the scorer produced — and its affected assets join the
    //    cluster reconciliation below, otherwise a group linked only by content
    //    would never be pulled into a cluster.
    const identical = await this.linkIdenticalContent(
      touchedIds,
      full,
      onProgress,
    );
    const clusterSeed = Array.from(
      new Set([...affectedAssetIds, ...identical.affectedAssetIds]),
    );

    // 4. Clusters: a full recompute rebuilds them wholesale; an incremental run
    //    reconciles only the affected components.
    const clustersTouched = full
      ? await this.rebuildAllClusters(cfg)
      : await this.reconcileClusters(clusterSeed, cfg);

    return {
      assetsProcessed: touchedIds.length,
      valuesIndexed,
      relatedPairs,
      duplicatePairs,
      identicalGroups: identical.groups,
      identicalPairs: identical.pairs,
      clustersTouched,
      topMatch,
    };
  }

  // ── Fingerprints ──────────────────────────────────────────────────────────

  /** Rebuild an asset's correlation values + signature from its findings. */
  private async rebuildAssetValues(
    assetId: string,
    cfg: ResolvedConfig,
  ): Promise<number> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, sourceId: true },
    });
    if (!asset) return 0;

    // Deduplicate by valueHash so each token is indexed once per asset.
    // Findings are fetched page-by-page (cursor on id) so we never materialise
    // a full Prisma result array for an asset with hundreds of thousands of
    // findings — that single findMany was the primary source of the 4 GB OOM.
    const rows = new Map<
      string,
      {
        findingId: string;
        label: string;
        detectorType: DetectorType;
        customDetectorKey: string | null;
        normalizedValue: string;
        phoneticHash: string | null;
      }
    >();
    let idCursor: string | null = null;
    for (;;) {
      const batch: Array<{
        id: string;
        findingType: string;
        matchedContent: string;
        detectorType: DetectorType;
        customDetectorKey: string | null;
      }> = await this.prisma.finding.findMany({
        // OPEN only. A fingerprint asserts that this asset CURRENTLY carries
        // this value; a resolved finding is not that. Without the filter, a
        // detector leaving a source config left its values correlating assets
        // forever — 74% of the correlation index on a live instance belonged
        // to assets with no open finding at all.
        where: {
          assetId,
          status: FindingStatus.OPEN,
          ...(idCursor ? { id: { gt: idCursor } } : {}),
        },
        select: {
          id: true,
          findingType: true,
          matchedContent: true,
          detectorType: true,
          customDetectorKey: true,
        },
        orderBy: { id: 'asc' },
        take: this.batches.findingsPage,
      });
      if (!batch.length) break;
      for (const f of batch) {
        const normalized = normalizeValue(f.findingType, f.matchedContent);
        if (!normalized) continue;
        const label = normalizeLabel(f.findingType);
        if (cfg.isExcluded(label, normalized)) continue;
        const hash = valueHash(f.findingType, normalized);
        if (rows.has(hash)) continue;
        rows.set(hash, {
          findingId: f.id,
          label,
          detectorType: f.detectorType,
          customDetectorKey: f.customDetectorKey ?? null,
          normalizedValue: normalized,
          phoneticHash: phoneticFingerprint(label, normalized),
        });
      }
      if (batch.length < this.batches.findingsPage) break;

      idCursor = batch.at(-1)!.id;
    }

    const componentHashes: Record<string, string[]> = {};
    for (const [hash, r] of rows) {
      (componentHashes[r.label] ??= []).push(hash);
    }
    const componentSignature: Record<string, string> = {};
    for (const [label, hashes] of Object.entries(componentHashes)) {
      componentSignature[label] = hashSet(hashes);
    }
    const allValuesHash = hashSet(rows.keys());
    const rowArray = Array.from(rows.entries());

    // Interactive transaction: delete stale values then insert new ones in
    // chunks of this.batches.valueUpsertBatch to avoid sending one massive createMany
    // payload to Postgres.
    await this.prisma.$transaction(async (tx) => {
      await tx.assetCorrelationValue.deleteMany({ where: { assetId } });
      for (let i = 0; i < rowArray.length; i += this.batches.valueUpsertBatch) {
        await tx.assetCorrelationValue.createMany({
          data: rowArray
            .slice(i, i + this.batches.valueUpsertBatch)
            .map(([hash, r]) => ({
              assetId,
              sourceId: asset.sourceId,
              findingId: r.findingId,
              label: r.label,
              detectorType: r.detectorType,
              customDetectorKey: r.customDetectorKey,
              normalizedValue: r.normalizedValue,
              valueHash: hash,
              phoneticHash: r.phoneticHash,
            })),
        });
      }
      await tx.assetSignature.upsert({
        where: { assetId },
        create: {
          assetId,
          sourceId: asset.sourceId,
          componentHashes: componentSignature,
          allValuesHash,
          valueCount: rows.size,
        },
        update: {
          componentHashes: componentSignature,
          allValuesHash,
          valueCount: rows.size,
        },
      });
    });

    return rows.size;
  }

  // ── Exact duplicates (content hash) ─────────────────────────────────────────

  /**
   * Link assets whose scanned bytes are identical, straight from
   * `Asset.contentHash`.
   *
   * This is the one duplicate signal that owes nothing to findings. The scorer
   * above derives every token from a finding, so an asset that trips no
   * detector has no tokens, scores against nothing, and cannot be a duplicate
   * of anything — two byte-identical documents full of unremarkable text were
   * simply invisible. The hash is already computed and stored by the scan
   * cache, so this costs one grouped query.
   *
   * Deliberately NOT folded into the weighted score as another token. The score
   * treats an asset's whole token set as its denominator, and its `exact`
   * shortcut (`sharedCount === nfCountA === nfCountB`) bypasses relatedMin
   * entirely — so a token that findings-free assets all share would make every
   * such pair an "exact" duplicate of every other. A separate edge type states
   * the stronger claim without touching the scorer's arithmetic.
   *
   * Groups are linked as a STAR (every member to the lowest-id member), not a
   * clique: union-find only needs a spanning tree to put the group in one
   * cluster, and a clique is O(n²) edges for no extra information — a group of
   * 200 identical files would be 19,900 rows instead of 199.
   */
  private async linkIdenticalContent(
    touchedIds: string[],
    full: boolean,
    onProgress?: ProgressFn,
  ): Promise<{ pairs: number; groups: number; affectedAssetIds: string[] }> {
    // Incremental runs only care about the groups the touched assets belong to.
    // Resolved to hashes first, because a touched asset's *partners* may be
    // untouched and must still be relinked.
    let hashScope: string[] | null = null;
    if (!full) {
      const touched = await this.prisma.asset.findMany({
        where: { id: { in: touchedIds }, contentHash: { not: null } },
        select: { contentHash: true },
        distinct: ['contentHash'],
      });
      hashScope = touched
        .map((row) => row.contentHash as string)
        .filter((hash) => hash !== EMPTY_CONTENT_SHA256);
      if (hashScope.length === 0)
        return { pairs: 0, groups: 0, affectedAssetIds: [] };
    }

    const affected = new Set<string>();
    let pairs = 0;
    let groups = 0;
    let skippedGroups = 0;
    let cursor: string | null = null;

    for (;;) {
      // Page over the duplicate groups themselves (keyset on the hash), so the
      // heap holds one page of groups rather than every duplicate in the corpus.
      const grouped = await this.prisma.asset.groupBy({
        by: ['contentHash'],
        where: {
          contentHash: {
            not: null,
            ...(hashScope ? { in: hashScope } : {}),
            ...(cursor ? { gt: cursor } : {}),
          },
          NOT: { contentHash: EMPTY_CONTENT_SHA256 },
        },
        _count: { _all: true },
        having: { contentHash: { _count: { gt: 1 } } },
        orderBy: { contentHash: 'asc' },
        take: IDENTICAL_GROUP_PAGE,
      });
      if (grouped.length === 0) break;

      for (const group of grouped) {
        const hash = group.contentHash as string;
        const size = group._count._all;
        if (size > IDENTICAL_GROUP_CAP) {
          skippedGroups++;
          continue;
        }
        const members = await this.prisma.asset.findMany({
          where: { contentHash: hash },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        if (members.length < 2) continue;

        const ids = members.map((m) => m.id);
        // Replace the whole group's edges, not just those touching the changed
        // assets: the hub is the lowest id, so an asset entering or leaving the
        // group can move it, and edges pointing at the old hub would survive.
        await this.prisma.edge.deleteMany({
          where: {
            fromType: ASSET_REL,
            toType: ASSET_REL,
            relationType: REL_IDENTICAL,
            OR: [{ fromId: { in: ids } }, { toId: { in: ids } }],
          },
        });

        const [hub, ...spokes] = ids;
        for (let i = 0; i < spokes.length; i += EDGE_BATCH) {
          await this.prisma.edge.createMany({
            data: spokes.slice(i, i + EDGE_BATCH).map((toId) => ({
              fromType: ASSET_REL,
              fromId: hub,
              toType: ASSET_REL,
              toId,
              relationType: REL_IDENTICAL,
              confidence: 1,
              origin: EdgeOrigin.INFERRED,
              metadata: {
                weighted: 1,
                contentHash: hash,
                groupSize: ids.length,
                exact: true,
                reasons: ['byte-identical content'],
              },
            })),
            skipDuplicates: true,
          });
        }

        for (const id of ids) affected.add(id);
        pairs += spokes.length;
        groups++;
      }

      cursor = grouped.at(-1)!.contentHash;
      if (grouped.length < IDENTICAL_GROUP_PAGE) break;
      await yieldToGC();
    }

    if (skippedGroups > 0) {
      this.logger.log(
        `Skipped ${skippedGroups} byte-identical group(s) larger than ` +
          `${IDENTICAL_GROUP_CAP} assets (non-discriminating).`,
      );
    }
    if (onProgress && (groups > 0 || skippedGroups > 0)) {
      await onProgress(
        `Exact duplicates: ${groups} byte-identical group(s), ${pairs} link(s).`,
        { groups, pairs, skippedGroups },
      );
    }
    return { pairs, groups, affectedAssetIds: Array.from(affected) };
  }

  // ── Scoring + linking ───────────────────────────────────────────────────────

  private async scoreAndLink(
    touchedIds: string[],
    cfg: ResolvedConfig,
    full: boolean,
  ): Promise<{
    relatedPairs: number;
    duplicatePairs: number;
    topMatch: CorrelationRunSummary['topMatch'];
    affectedAssetIds: string[];
  }> {
    // Working set = the assets we need value-vectors for. Full recompute spans
    // everything (null = no filter); an incremental run spans touched plus
    // anything sharing a value.
    const workingIds = full
      ? null
      : await this.incrementalWorkingSet(touchedIds);

    // One row per asset (weight total + value count) — never the
    // per-occurrence blowup. Safe to hold in memory at any dataset size.
    const totals = await this.loadAssetTotals(workingIds, cfg);

    // The pairwise overlap — formerly a hashOwners reverse index built in
    // Node memory, which is what actually OOM'd on a full recompute — is now
    // computed as a single INSERT ... SELECT ... GROUP BY self-join in
    // Postgres. Its intermediate state lives in the database (work_mem / temp
    // files on disk), not the API process's heap, so no value is excluded
    // from scoring and nothing is lost.
    const runId = randomUUID();
    try {
      await this.stagePairAggregates(runId, touchedIds, workingIds, cfg, full);

      // Wipe stale correlation edges (all of them on a full rebuild, else only
      // those touching the recomputed assets).
      await this.prisma.edge.deleteMany({
        where: full
          ? {
              fromType: ASSET_REL,
              toType: ASSET_REL,
              relationType: { in: SCORED_RELATION_TYPES },
            }
          : {
              fromType: ASSET_REL,
              toType: ASSET_REL,
              relationType: { in: SCORED_RELATION_TYPES },
              OR: [
                { fromId: { in: touchedIds } },
                { toId: { in: touchedIds } },
              ],
            },
      });

      let buffer: Prisma.EdgeCreateManyInput[] = [];
      let relatedPairs = 0;
      let duplicatePairs = 0;
      let topMatch: CorrelationRunSummary['topMatch'] = null;
      const affected = new Set<string>();
      const flush = async () => {
        if (buffer.length === 0) return;
        await this.prisma.edge.createMany({
          data: buffer,
          skipDuplicates: true,
        });
        buffer = [];
      };

      // Stream the staged pairs back page by page (keyset on id) — bounded
      // memory regardless of how many pairs the recompute produced.
      let cursor = -1n;
      for (;;) {
        const rows = await this.prisma.correlationPairStaging.findMany({
          where: { runId, id: { gt: cursor } },
          orderBy: { id: 'asc' },
          take: this.batches.streamPage,
        });
        if (rows.length === 0) break;

        for (const r of rows) {
          const a = totals.get(r.aId);
          const b = totals.get(r.bId);
          const sharedCount = r.sharedCount;

          // Use fanout-filtered totals so numerator and denominator use the
          // same population.
          const nfWeightA = a?.nfWeight ?? 0;
          const nfWeightB = b?.nfWeight ?? 0;
          const nfCountA = a?.nfCount ?? 0;
          const nfCountB = b?.nfCount ?? 0;
          const weightedShared = Number(r.weightedShared);

          const denom = nfWeightA + nfWeightB;
          const weighted = denom === 0 ? 0 : (2 * weightedShared) / denom;
          const union = nfCountA + nfCountB - sharedCount;
          const jaccard = union === 0 ? 0 : sharedCount / union;
          const exact =
            sharedCount > 0 &&
            sharedCount === nfCountA &&
            sharedCount === nfCountB;
          if (weighted < cfg.relatedMin && !exact) continue;

          const isDuplicate = weighted >= cfg.duplicateMin || exact;
          const byLabel = r.sharedByLabel as Record<string, number>;
          const reasons = buildReasons(byLabel, cfg.weightOf);
          buffer.push({
            fromType: ASSET_REL,
            fromId: r.aId,
            toType: ASSET_REL,
            toId: r.bId,
            relationType: isDuplicate ? REL_DUPLICATE : REL_RELATED,
            confidence: roundConfidence(weighted),
            origin: 'INFERRED',
            metadata: {
              weighted: round2(weighted),
              jaccard: round2(jaccard),
              sharedCount,
              sharedByLabel: byLabel,
              exact,
              reasons,
            },
          });
          affected.add(r.aId);
          affected.add(r.bId);
          if (isDuplicate) duplicatePairs++;
          else relatedPairs++;
          if (!topMatch || weighted > topMatch.weighted) {
            topMatch = {
              fromAssetId: r.aId,
              toAssetId: r.bId,
              weighted: round2(weighted),
              reasons,
            };
          }
          if (buffer.length >= EDGE_BATCH) await flush();
        }

        cursor = rows.at(-1)!.id;
        if (rows.length < this.batches.streamPage) break;
      }
      await flush();

      // Phase 2: phonetic-only pairs.  Processes one (label, phonetic_hash)
      // group at a time — O(PHONETIC_FANOUT_CAP²) memory per group, constant
      // total.  Groups larger than the cap are skipped (non-discriminating).
      const ph = await this.scorePhoneticCandidates(
        touchedIds,
        cfg,
        full,
        totals,
      );
      for (const id of ph.affectedAssetIds) affected.add(id);
      relatedPairs += ph.relatedPairs;
      duplicatePairs += ph.duplicatePairs;
      if (
        ph.topMatch &&
        (!topMatch || ph.topMatch.weighted > topMatch.weighted)
      )
        topMatch = ph.topMatch;

      return {
        relatedPairs,
        duplicatePairs,
        topMatch,
        affectedAssetIds: Array.from(affected),
      };
    } finally {
      // Scratch rows for this run are no longer needed either way.
      await this.prisma.correlationPairStaging.deleteMany({ where: { runId } });
    }
  }

  /**
   * Per-asset totals scoped to `assetIds` (null = all). Returns both the
   * all-values totals AND fanout-filtered totals so the scoring step can use
   * consistent populations for numerator and denominator.
   *
   * The fanout filter mirrors the one in stagePairAggregates: values shared by
   * more than FANOUT_CAP assets within the same scope are excluded from
   * sharedCount/weightedShared in the staging table, so they must also be
   * excluded from the denominator (and the `exact` check) to avoid inflating
   * the denominator and deflating similarity scores.
   */
  private async loadAssetTotals(
    assetIds: string[] | null,
    cfg: ResolvedConfig,
  ): Promise<
    Map<
      string,
      { weight: number; count: number; nfWeight: number; nfCount: number }
    >
  > {
    const weightsJson = JSON.stringify(cfg.rawWeights);
    // Two separate scope fragments are needed — one for the CTE, one for the
    // outer join — because Prisma parameterises each ${assetIds} independently.
    const scopeCte = assetIds
      ? Prisma.sql`WHERE asset_id = ANY(${assetIds})`
      : Prisma.empty;
    const scopeMain = assetIds
      ? Prisma.sql`WHERE v.asset_id = ANY(${assetIds})`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        asset_id: string;
        total_weight: string;
        value_count: bigint;
        nf_weight: string;
        nf_count: bigint;
      }>
    >(Prisma.sql`
      WITH hash_counts AS (
        SELECT value_hash, COUNT(*) AS owners
        FROM asset_correlation_values
        ${scopeCte}
        GROUP BY value_hash
      )
      SELECT v.asset_id,
             SUM(COALESCE((${weightsJson}::jsonb ->> v.label)::numeric, ${cfg.defaultWeight})) AS total_weight,
             COUNT(*) AS value_count,
             SUM(COALESCE((${weightsJson}::jsonb ->> v.label)::numeric, ${cfg.defaultWeight}))
               FILTER (WHERE hc.owners <= ${FANOUT_CAP}) AS nf_weight,
             COUNT(*) FILTER (WHERE hc.owners <= ${FANOUT_CAP}) AS nf_count
      FROM asset_correlation_values v
      JOIN hash_counts hc ON hc.value_hash = v.value_hash
      ${scopeMain}
      GROUP BY v.asset_id
    `);

    const map = new Map<
      string,
      { weight: number; count: number; nfWeight: number; nfCount: number }
    >();
    for (const r of rows) {
      map.set(r.asset_id, {
        weight: Number(r.total_weight),
        count: Number(r.value_count),
        nfWeight: Number(r.nf_weight ?? 0),
        nfCount: Number(r.nf_count ?? 0),
      });
    }
    return map;
  }

  /**
   * Compute pairwise overlap (shared count, weighted-shared sum, per-label
   * breakdown) for every asset pair in the working set as a single
   * INSERT … SELECT … GROUP BY self-join in Postgres (exact hash matches only).
   * Heavy intermediate state spills to Postgres work_mem / temp files, not the
   * API heap.  Phonetic candidates are handled separately by
   * `scorePhoneticCandidates`, which processes one phonetic group at a time so
   * memory stays O(PHONETIC_FANOUT_CAP) regardless of dataset size.
   */
  private async stagePairAggregates(
    runId: string,
    touchedIds: string[],
    workingIds: string[] | null,
    cfg: ResolvedConfig,
    full: boolean,
  ): Promise<void> {
    const weightsJson = JSON.stringify(cfg.rawWeights);
    const scope = workingIds
      ? Prisma.sql`WHERE v.asset_id = ANY(${workingIds})`
      : Prisma.empty;
    const touchFilter = full
      ? Prisma.empty
      : Prisma.sql`WHERE a.asset_id = ANY(${touchedIds}) OR b.asset_id = ANY(${touchedIds})`;

    await this.prisma.$executeRaw(Prisma.sql`
      WITH raw AS (
        SELECT v.asset_id, v.value_hash, v.label,
               COALESCE((${weightsJson}::jsonb ->> v.label)::numeric, ${cfg.defaultWeight}) AS weight
        FROM asset_correlation_values v
        ${scope}
      ),
      -- Hub values (shared by > FANOUT_CAP assets) are excluded: they are
      -- non-discriminating and would produce spurious duplicate edges.
      -- loadAssetTotals uses the same filter so numerator and denominator
      -- stay consistent.
      hash_counts AS (
        SELECT value_hash, COUNT(*) AS owners FROM raw GROUP BY value_hash
      ),
      av AS (
        SELECT raw.* FROM raw
        JOIN hash_counts hc ON hc.value_hash = raw.value_hash
        WHERE hc.owners <= ${FANOUT_CAP}
      ),
      pair_label AS (
        SELECT
          a.asset_id AS a_id,
          b.asset_id AS b_id,
          a.label    AS label,
          COUNT(*)   AS cnt,
          SUM(a.weight) AS wsum
        FROM av a
        JOIN av b ON a.value_hash = b.value_hash AND a.asset_id < b.asset_id
        ${touchFilter}
        GROUP BY a.asset_id, b.asset_id, a.label
      )
      INSERT INTO correlation_pair_staging
        (run_id, a_id, b_id, shared_count, weighted_shared, shared_by_label)
      SELECT
        ${runId},
        a_id,
        b_id,
        SUM(cnt)::int,
        SUM(wsum),
        jsonb_object_agg(label, cnt)
      FROM pair_label
      GROUP BY a_id, b_id
    `);
  }

  /**
   * Find phonetic-only pairs (no exact value_hash overlap) and score them with
   * Jaro-Winkler.  Processes one (label, phonetic_hash) group at a time so
   * memory is O(PHONETIC_FANOUT_CAP × values_per_asset) — bounded regardless
   * of dataset size.  Groups shared by more than PHONETIC_FANOUT_CAP assets are
   * skipped (non-discriminating codes like "JN" for all John/Jon/Jan documents).
   */
  private async scorePhoneticCandidates(
    touchedIds: string[],
    cfg: ResolvedConfig,
    full: boolean,
    totals: Map<
      string,
      { weight: number; count: number; nfWeight: number; nfCount: number }
    >,
  ): Promise<{
    relatedPairs: number;
    duplicatePairs: number;
    topMatch: CorrelationRunSummary['topMatch'];
    affectedAssetIds: string[];
  }> {
    const touchedSet = new Set(touchedIds);
    let relatedPairs = 0;
    let duplicatePairs = 0;
    let topMatch: CorrelationRunSummary['topMatch'] = null;
    const affected = new Set<string>();
    let buffer: Prisma.EdgeCreateManyInput[] = [];
    const flush = async () => {
      if (!buffer.length) return;
      await this.prisma.edge.createMany({ data: buffer, skipDuplicates: true });
      buffer = [];
    };

    // Find every (label, phonetic_hash) group that:
    //  • has 2..PHONETIC_FANOUT_CAP members (total, not just within working set)
    //  • contains at least one touched asset (or all, for full recompute)
    const scopeSql = full
      ? Prisma.empty
      : Prisma.sql`AND asset_id = ANY(${touchedIds})`;

    const groups = await this.prisma.$queryRaw<
      Array<{ label: string; phonetic_hash: string }>
    >(Prisma.sql`
      WITH anchor_groups AS (
        SELECT DISTINCT label, phonetic_hash
        FROM asset_correlation_values
        WHERE phonetic_hash IS NOT NULL
          ${scopeSql}
      )
      SELECT ag.label, ag.phonetic_hash
      FROM anchor_groups ag
      JOIN asset_correlation_values v
        ON v.label = ag.label AND v.phonetic_hash = ag.phonetic_hash
      WHERE v.phonetic_hash IS NOT NULL
      GROUP BY ag.label, ag.phonetic_hash
      HAVING COUNT(DISTINCT v.asset_id) BETWEEN 2 AND ${PHONETIC_FANOUT_CAP}
    `);

    for (const group of groups) {
      // All values in this phonetic group, across all member assets.
      const members = await this.prisma.assetCorrelationValue.findMany({
        where: { label: group.label, phoneticHash: group.phonetic_hash },
        select: { assetId: true, normalizedValue: true, valueHash: true },
      });

      // Map assetId → values in this (label, phonetic_hash) group.
      const byAsset = new Map<
        string,
        Array<{ normalizedValue: string; valueHash: string }>
      >();
      for (const m of members) {
        const arr = byAsset.get(m.assetId) ?? [];
        arr.push({
          normalizedValue: m.normalizedValue,
          valueHash: m.valueHash,
        });
        byAsset.set(m.assetId, arr);
      }
      const assetIds = Array.from(byAsset.keys());

      // For incremental runs, skip the entire group if it has no touched asset.
      if (!full && !assetIds.some((id) => touchedSet.has(id))) {
        await yieldToGC();
        continue;
      }

      // Load ALL value_hashes for these assets (one round-trip per group) so
      // we can detect exact overlaps and skip pairs already handled by the
      // exact staging pass — prevents double-counting.
      const hashRows = await this.prisma.assetCorrelationValue.findMany({
        where: { assetId: { in: assetIds } },
        select: { assetId: true, valueHash: true },
      });
      const hashByAsset = new Map<string, Set<string>>();
      for (const h of hashRows) {
        const s = hashByAsset.get(h.assetId) ?? new Set<string>();
        s.add(h.valueHash);
        hashByAsset.set(h.assetId, s);
      }

      const labelWeight = cfg.weightOf(group.label);

      for (let i = 0; i < assetIds.length; i++) {
        for (let j = i + 1; j < assetIds.length; j++) {
          const aId = assetIds[i];
          const bId = assetIds[j];

          // Incremental: only score pairs where at least one side is touched.
          if (!full && !touchedSet.has(aId) && !touchedSet.has(bId)) continue;

          // Skip pairs with any exact hash overlap — the exact pass handles them.
          const aH = hashByAsset.get(aId) ?? new Set<string>();
          const bH = hashByAsset.get(bId) ?? new Set<string>();
          let exactOverlap = false;
          for (const h of aH) {
            if (bH.has(h)) {
              exactOverlap = true;
              break;
            }
          }
          if (exactOverlap) continue;

          // JW-weighted contribution from this phonetic group only.
          const aVals = byAsset.get(aId) ?? [];
          const bVals = byAsset.get(bId) ?? [];
          let jwWeighted = 0;
          let matchCount = 0;
          for (const av of aVals) {
            for (const bv of bVals) {
              const jw = jaroWinkler(av.normalizedValue, bv.normalizedValue);
              if (jw >= PHONETIC_MIN_JW) {
                jwWeighted += jw * labelWeight;
                matchCount++;
              }
            }
          }
          if (jwWeighted === 0) continue;

          // Dice score: use per-asset nfWeight as denominator (consistent with
          // the exact pass).  Lazily load totals for assets outside workingIds.
          const a =
            totals.get(aId) ??
            (await this.fetchAssetTotalLazy(aId, cfg, totals));
          const b =
            totals.get(bId) ??
            (await this.fetchAssetTotalLazy(bId, cfg, totals));
          const denom = (a.nfWeight ?? 0) + (b.nfWeight ?? 0);
          const weighted = denom === 0 ? 0 : (2 * jwWeighted) / denom;
          if (weighted < cfg.relatedMin) continue;

          const isDuplicate = weighted >= cfg.duplicateMin;
          const byLabel: Record<string, number> = {
            [group.label]: matchCount,
          };
          const reasons = buildReasons(byLabel, cfg.weightOf);
          buffer.push({
            fromType: ASSET_REL,
            fromId: aId,
            toType: ASSET_REL,
            toId: bId,
            relationType: isDuplicate ? REL_DUPLICATE : REL_RELATED,
            confidence: roundConfidence(weighted),
            origin: 'INFERRED',
            metadata: {
              weighted: round2(weighted),
              jaccard: 0,
              sharedCount: matchCount,
              sharedByLabel: byLabel,
              exact: false,
              reasons,
              phoneticOnly: true,
            },
          });
          affected.add(aId);
          affected.add(bId);
          if (isDuplicate) duplicatePairs++;
          else relatedPairs++;
          if (!topMatch || weighted > topMatch.weighted)
            topMatch = {
              fromAssetId: aId,
              toAssetId: bId,
              weighted: round2(weighted),
              reasons,
            };
          if (buffer.length >= EDGE_BATCH) await flush();
        }
      }

      await yieldToGC();
    }

    await flush();
    return {
      relatedPairs,
      duplicatePairs,
      topMatch,
      affectedAssetIds: Array.from(affected),
    };
  }

  /** Load and cache per-asset totals for assets outside the precomputed set. */
  private async fetchAssetTotalLazy(
    assetId: string,
    cfg: ResolvedConfig,
    cache: Map<
      string,
      { weight: number; count: number; nfWeight: number; nfCount: number }
    >,
  ): Promise<{
    weight: number;
    count: number;
    nfWeight: number;
    nfCount: number;
  }> {
    const m = await this.loadAssetTotals([assetId], cfg);
    const data = m.get(assetId) ?? {
      weight: 0,
      count: 0,
      nfWeight: 0,
      nfCount: 0,
    };
    cache.set(assetId, data);
    return data;
  }

  /**
   * Touched assets plus every asset that shares ≥1 value with them.
   *
   * The de-duplication has to happen in SQL. Prisma's `distinct` is applied by
   * the query engine *after* the rows arrive, so `distinct: ['assetId']` over
   * a chunk of value hashes fetched every matching row and threw away the
   * duplicates in JS. With hub values — the corpus that broke this had values
   * bound to 4,872 assets apiece — one chunk of 1,000 hashes pulled **803,341
   * rows to yield 15,321 distinct assets**, a 52x amplification, and every one
   * of those rows became a UUID string on the heap.
   *
   * That is what an OOM heap snapshot of the running API was full of: 1.93
   * million UUID strings, 550 MB of the 731 MB captured, accumulated in
   * roughly twenty seconds. `SELECT DISTINCT` moves the work to Postgres,
   * which answers with the 15k rows that were actually wanted.
   */
  private async incrementalWorkingSet(touchedIds: string[]): Promise<string[]> {
    const working = new Set(touchedIds);
    for (const ids of chunk(touchedIds, 1000)) {
      const hashRows = await this.prisma.$queryRaw<
        Array<{ value_hash: string }>
      >(
        Prisma.sql`
          SELECT DISTINCT value_hash
          FROM asset_correlation_values
          WHERE asset_id IN (${Prisma.join(ids)})
        `,
      );
      const hashes = hashRows.map((r) => r.value_hash);
      for (const hChunk of chunk(hashes, 1000)) {
        if (hChunk.length === 0) continue;
        const owners = await this.prisma.$queryRaw<Array<{ asset_id: string }>>(
          Prisma.sql`
            SELECT DISTINCT asset_id
            FROM asset_correlation_values
            WHERE value_hash IN (${Prisma.join(hChunk)})
          `,
        );
        for (const o of owners) working.add(o.asset_id);
      }
    }
    return Array.from(working);
  }

  /** Rebuild every cluster from scratch (full recompute): union-find over all
   * likely-duplicate edges, streamed so memory stays bounded. */
  private async rebuildAllClusters(cfg: ResolvedConfig): Promise<number> {
    await this.prisma.assetCluster.deleteMany({});

    const uf = new UnionFind([]);
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.edge.findMany({
        where: {
          fromType: ASSET_REL,
          toType: ASSET_REL,
          relationType: { in: CLUSTERING_RELATION_TYPES },
        },
        select: { id: true, fromId: true, toId: true },
        orderBy: { id: 'asc' },
        take: this.batches.streamPage,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      for (const e of rows) uf.union(e.fromId, e.toId);
      if (rows.length < this.batches.streamPage) break;
      cursor = rows.at(-1)!.id;
    }

    const components = new Map<string, string[]>();
    for (const id of uf.ids()) {
      const root = uf.find(id);
      (components.get(root) ?? components.set(root, []).get(root)!).push(id);
    }

    let clustersTouched = 0;
    for (const members of components.values()) {
      if (members.length < 2) continue;
      const cluster = await this.prisma.assetCluster.create({ data: {} });
      await this.prisma.assetClusterMember.createMany({
        data: members.map((assetId) => ({ clusterId: cluster.id, assetId })),
        skipDuplicates: true,
      });
      await this.refreshClusterStats(cluster.id, cfg);
      clustersTouched++;
    }
    return clustersTouched;
  }

  // ── Cluster maintenance (union-find) ────────────────────────────────────────

  private async reconcileClusters(
    affectedIds: string[],
    cfg: ResolvedConfig,
  ): Promise<number> {
    if (affectedIds.length === 0) return 0;

    // Expand the working set: touched assets, anything linked to them by a
    // clustering edge (likely_duplicate or identical_content), and any
    // co-members of clusters they belong to.
    const working = new Set(affectedIds);
    const dupEdges = await this.prisma.edge.findMany({
      where: {
        fromType: ASSET_REL,
        toType: ASSET_REL,
        relationType: { in: CLUSTERING_RELATION_TYPES },
        OR: [{ fromId: { in: affectedIds } }, { toId: { in: affectedIds } }],
      },
      select: { fromId: true, toId: true },
    });
    for (const e of dupEdges) {
      working.add(e.fromId);
      working.add(e.toId);
    }
    const priorMembers = await this.prisma.assetClusterMember.findMany({
      where: { assetId: { in: Array.from(working) } },
      select: { assetId: true, clusterId: true },
    });
    const priorClusterIds = new Set(priorMembers.map((m) => m.clusterId));
    const coMembers = await this.prisma.assetClusterMember.findMany({
      where: { clusterId: { in: Array.from(priorClusterIds) } },
      select: { assetId: true },
    });
    for (const m of coMembers) working.add(m.assetId);

    const workingIds = Array.from(working);

    // Build adjacency from ALL clustering edges within the working set.
    const allDupEdges = await this.prisma.edge.findMany({
      where: {
        fromType: ASSET_REL,
        toType: ASSET_REL,
        relationType: { in: CLUSTERING_RELATION_TYPES },
        fromId: { in: workingIds },
        toId: { in: workingIds },
      },
      select: { fromId: true, toId: true },
    });

    const uf = new UnionFind(workingIds);
    for (const e of allDupEdges) uf.union(e.fromId, e.toId);

    // Group working assets into components.
    const components = new Map<string, string[]>();
    for (const id of workingIds) {
      const root = uf.find(id);
      (components.get(root) ?? components.set(root, []).get(root)!).push(id);
    }

    // Map each working asset to its existing clusterId (if any).
    const existingClusterByAsset = new Map<string, string>();
    for (const m of priorMembers)
      existingClusterByAsset.set(m.assetId, m.clusterId);

    let clustersTouched = 0;
    const affectedClusterIds = new Set<string>(priorClusterIds);

    for (const members of components.values()) {
      if (members.length < 2) {
        // No longer a cluster — detach any members that were in one.
        for (const assetId of members) {
          const cid = existingClusterByAsset.get(assetId);
          if (cid) {
            await this.prisma.assetClusterMember.deleteMany({
              where: { assetId },
            });
            affectedClusterIds.add(cid);
          }
        }
        continue;
      }

      // Reuse the existing cluster shared by the most members; else create one.
      const reuseId = pickReuseCluster(members, existingClusterByAsset);
      const clusterId =
        reuseId ?? (await this.prisma.assetCluster.create({ data: {} })).id;

      // Detach these assets from any *other* cluster, then attach to this one.
      await this.prisma.assetClusterMember.deleteMany({
        where: { assetId: { in: members }, NOT: { clusterId } },
      });
      await this.prisma.assetClusterMember.createMany({
        data: members.map((assetId) => ({ clusterId, assetId })),
        skipDuplicates: true,
      });
      affectedClusterIds.add(clusterId);
      clustersTouched++;
    }

    // Refresh stats for every cluster we may have changed; drop dead ones.
    for (const cid of affectedClusterIds) {
      await this.refreshClusterStats(cid, cfg);
    }
    return clustersTouched;
  }

  /** Recompute memberCount/sourceCount/topValues/label; delete if <2 members. */
  private async refreshClusterStats(
    clusterId: string,
    cfg: ResolvedConfig,
  ): Promise<void> {
    const members = await this.prisma.assetClusterMember.findMany({
      where: { clusterId },
      select: { assetId: true, asset: { select: { sourceId: true } } },
    });
    if (members.length < 2) {
      await this.prisma.assetCluster.delete({ where: { id: clusterId } }).catch(
        // already gone / cascade — ignore
        () => undefined,
      );
      return;
    }
    const assetIds = members.map((m) => m.assetId);
    const sourceCount = new Set(members.map((m) => m.asset.sourceId)).size;

    // Common values: tokens shared by ≥2 members, ranked by member coverage.
    const values = await this.prisma.assetCorrelationValue.findMany({
      where: { assetId: { in: assetIds } },
      select: {
        valueHash: true,
        label: true,
        normalizedValue: true,
        assetId: true,
      },
    });
    const byHash = new Map<
      string,
      { label: string; value: string; assets: Set<string> }
    >();
    for (const v of values) {
      const entry =
        byHash.get(v.valueHash) ??
        byHash
          .set(v.valueHash, {
            label: v.label,
            value: v.normalizedValue,
            assets: new Set(),
          })
          .get(v.valueHash)!;
      entry.assets.add(v.assetId);
    }
    const common = Array.from(byHash.values())
      .filter((e) => e.assets.size >= 2)
      .map((e) => ({
        label: e.label,
        value: e.value,
        count: e.assets.size,
        weight: cfg.weightOf(e.label),
      }))
      .sort((a, b) => b.count - a.count || b.weight - a.weight)
      .slice(0, MAX_CLUSTER_TOP_VALUES);

    await this.prisma.assetCluster.update({
      where: { id: clusterId },
      data: {
        memberCount: members.length,
        sourceCount,
        label: common[0]?.value ?? null,
        topValues: common.map(({ label, value, count }) => ({
          label,
          value,
          count,
        })),
      },
    });
  }

  // ── Query helpers (API / UI) ────────────────────────────────────────────────

  /**
   * The correlation graph in the shared GraphResponseDto shape (so it renders
   * with the same canvas as the case graph). Bipartite: asset nodes connected
   * through the shared finding-values that bind them — "Asset ↔ value ↔ Asset".
   * Scope is one asset's cluster (assetId) or the largest clusters instance-wide.
   */
  async buildGraph(opts?: {
    assetId?: string;
    /** Scope to clusters that touch this source; flags external members. */
    sourceId?: string;
  }): Promise<CorrelationGraphResult> {
    if (!opts?.assetId && !opts?.sourceId) {
      return this.graphCache.getOrBuild(() => this.buildGraphFromDatabase());
    }
    return this.buildGraphFromDatabase(opts);
  }

  /**
   * The unscoped graph as raw JSON text, or null when none is cached yet.
   *
   * Only for handlers that forward the body untouched — see
   * CorrelationGraphCacheService.readPayloadJson for why that matters. Anything
   * that inspects the graph should use {@link buildGraph}.
   */
  async getGraphSnapshotJson(): Promise<string | null> {
    return this.graphCache.readPayloadJson();
  }

  async refreshGraphSnapshot(): Promise<void> {
    await this.graphCache.refreshIfStale(() => this.buildGraphFromDatabase());
  }

  async invalidateGraphSnapshot(reason: string): Promise<void> {
    await this.graphCache.invalidate(reason);
  }

  async scheduleFullRecompute(reason: string, manual = false): Promise<void> {
    await this.jobs.scheduleFull(reason, manual);
  }

  private async buildGraphFromDatabase(opts?: {
    assetId?: string;
    sourceId?: string;
  }): Promise<CorrelationGraphResult> {
    const scopeSourceId = opts?.sourceId;
    const isScoped = Boolean(opts?.assetId || scopeSourceId);

    let clusterIds: string[];
    if (opts?.assetId) {
      const member = await this.prisma.assetClusterMember.findUnique({
        where: { assetId: opts.assetId },
        select: { clusterId: true },
      });
      if (!member) {
        // No cluster yet — show the asset alone so the panel isn't blank.
        const a = await this.prisma.asset.findUnique({
          where: { id: opts.assetId },
          select: ASSET_NODE_SELECT,
        });
        return {
          nodes: a ? [assetNode(a)] : [],
          edges: [],
          truncated: false,
          similarities: [],
        };
      }
      clusterIds = [member.clusterId];
    } else if (scopeSourceId) {
      // Clusters that contain at least one asset from this source.
      const rows = await this.prisma.assetClusterMember.findMany({
        where: { asset: { sourceId: scopeSourceId } },
        select: { clusterId: true },
        distinct: ['clusterId'],
      });
      clusterIds = rows.map((r) => r.clusterId);
    } else {
      // All clusters (no cap — rendering may be slow on huge graphs).
      const clusters = await this.prisma.assetCluster.findMany({
        orderBy: { memberCount: 'desc' },
        select: { id: true },
      });
      clusterIds = clusters.map((c) => c.id);
    }
    if (clusterIds.length === 0)
      return { nodes: [], edges: [], truncated: false, similarities: [] };

    const members = await this.prisma.assetClusterMember.findMany({
      where: { clusterId: { in: clusterIds } },
      select: { assetId: true },
    });
    const assetIds = members.map((m) => m.assetId);
    if (assetIds.length === 0)
      return { nodes: [], edges: [], truncated: false, similarities: [] };

    // Values are grouped and filtered by Postgres, not by us.
    //
    // Fetching every correlation-value row and grouping in JS meant holding the
    // whole table for the clustered assets in memory — 302,828 rows on the
    // corpus that broke this — only to discard most of them: singletons connect
    // nothing, and hub values are dropped by the fan-out filter anyway. Prisma
    // deserialising those rows was measured as the dominant allocation in an
    // API that died at 2 GB roughly ninety seconds after boot, with several
    // namespaces building graphs at once.
    //
    // Doing the aggregation in SQL returns only the values that become nodes,
    // already carrying their asset lists. Same graph, a fraction of the rows.
    const maxFanOut = isScoped
      ? Number.MAX_SAFE_INTEGER
      : this.graphMaxFanOut === Number.POSITIVE_INFINITY
        ? Number.MAX_SAFE_INTEGER
        : this.graphMaxFanOut;

    const [assets, grouped, hubCount] = await Promise.all([
      this.prisma.asset.findMany({
        where: { id: { in: assetIds } },
        select: ASSET_NODE_SELECT,
      }),
      this.prisma.$queryRaw<
        Array<{
          value_hash: string;
          label: string;
          value: string;
          asset_ids: string[];
        }>
      >(Prisma.sql`
        SELECT value_hash,
               MIN(label) AS label,
               MIN(normalized_value) AS value,
               ARRAY_AGG(DISTINCT asset_id) AS asset_ids
        FROM asset_correlation_values
        WHERE asset_id IN (${Prisma.join(assetIds)})
        GROUP BY value_hash
        HAVING COUNT(DISTINCT asset_id) BETWEEN 2 AND ${maxFanOut}
      `),
      // Counted rather than inferred, so `truncated` still means "hub values
      // were left out" even though they never reach this process.
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM (
          SELECT value_hash
          FROM asset_correlation_values
          WHERE asset_id IN (${Prisma.join(assetIds)})
          GROUP BY value_hash
          HAVING COUNT(DISTINCT asset_id) > ${maxFanOut}
        ) hubs
      `),
    ]);

    const byHash = new Map<
      string,
      { label: string; value: string; assetIds: string[] }
    >(
      grouped.map((row) => [
        row.value_hash,
        { label: row.label, value: row.value, assetIds: row.asset_ids },
      ]),
    );
    const droppedHubValues = Number(hubCount[0]?.count ?? 0);

    const nodes: GraphNodeDto[] = assets.map((a) =>
      assetNode(a, scopeSourceId),
    );
    const edges: GraphEdgeDto[] = [];

    // The ≥2-owner rule and the hub filter are applied by the query above, so
    // everything still here becomes a node.
    for (const [hash, info] of byHash) {
      nodes.push({
        id: hash,
        type: 'finding',
        label: info.value,
        depth: 1,
        detectorType: info.label.toUpperCase(),
      });
      for (const aId of info.assetIds) {
        edges.push({
          id: `cv:${aId}:${hash}`,
          fromType: ASSET_REL,
          fromId: aId,
          toType: 'finding',
          toId: hash,
          relationType: info.label,
          confidence: 1,
          origin: EdgeOrigin.INFERRED,
        });
      }
    }

    // Pairwise similarity strength (for display + the min-similarity slider),
    // straight from the asset↔asset correlation edges between included assets.
    const assetIdSet = new Set(assetIds);
    const simEdges = await this.prisma.edge.findMany({
      where: {
        fromType: ASSET_REL,
        toType: ASSET_REL,
        relationType: { in: CORRELATION_RELATION_TYPES },
        fromId: { in: assetIds },
        toId: { in: assetIds },
      },
      select: {
        fromId: true,
        toId: true,
        relationType: true,
        confidence: true,
        metadata: true,
      },
    });
    const similarities: AssetSimilarity[] = simEdges
      .filter((e) => assetIdSet.has(e.fromId) && assetIdSet.has(e.toId))
      .map((e) => {
        const meta = (e.metadata ?? {}) as { weighted?: number };
        return {
          fromId: e.fromId,
          toId: e.toId,
          weighted: meta.weighted ?? Number(e.confidence),
          relationType: e.relationType,
        };
      });

    return { nodes, edges, truncated: droppedHubValues > 0, similarities };
  }

  /**
   * Whole-namespace asset map: every asset, connected by both kinds of edge
   * `buildLinksGraph` draws for one source — `links` references and typed
   * SOURCE_DERIVED/MANUAL relationships — but without the source scope.
   *
   * Unbounded by default: the point of this view is to see everything, and
   * the canvas's clustering worker (semantic zoom, already proven on a
   * 61k-node unscoped correlation graph) is what keeps that renderable, not a
   * node cap. `ASSET_MAP_NODE_CAP` exists only as an emergency override for a
   * pathological instance. Ordered by most recently updated so a cap, if one
   * is set, truncates the stale tail rather than whatever a stable asset id
   * happened to sort after.
   */
  async buildAssetMapGraph(): Promise<CorrelationGraphResult> {
    const cap = this.assetMapNodeCap;
    const assets = await this.prisma.asset.findMany({
      orderBy: { updatedAt: 'desc' },
      ...(Number.isFinite(cap) ? { take: cap } : {}),
      select: { ...ASSET_NODE_SELECT, hash: true, links: true },
    });
    if (assets.length === 0)
      return { nodes: [], edges: [], truncated: false, similarities: [] };
    const truncated = Number.isFinite(cap) && assets.length >= cap;

    const nodeById = new Map<string, GraphNodeDto>();
    for (const a of assets) nodeById.set(a.id, assetNode(a));

    // Link-hash edges, scoped to this page of assets — resolving every hash
    // against the whole namespace (as buildLinksGraph does for one source)
    // would pull in assets outside the cap just to draw one reference edge.
    const linkHashes = new Set<string>();
    for (const a of assets) {
      const links = Array.isArray(a.links) ? (a.links as unknown[]) : [];
      for (const l of links) if (typeof l === 'string' && l) linkHashes.add(l);
    }
    const byHash = new Map<string, string>();
    for (const a of assets) if (a.hash) byHash.set(a.hash, a.id);

    const edges: GraphEdgeDto[] = [];
    const seen = new Set<string>();
    for (const a of assets) {
      const links = Array.isArray(a.links) ? (a.links as unknown[]) : [];
      for (const l of links) {
        if (typeof l !== 'string') continue;
        const targetId = byHash.get(l);
        if (!targetId || targetId === a.id) continue;
        const key =
          a.id < targetId ? `${a.id}|${targetId}` : `${targetId}|${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          id: `link:${key}`,
          fromType: ASSET_REL,
          fromId: a.id,
          toType: ASSET_REL,
          toId: targetId,
          relationType: 'links_to',
          confidence: 1,
          origin: EdgeOrigin.INFERRED,
          relationClass: 'REFERENCE',
        });
      }
    }

    const typed = await this.typedEdgesFor(Array.from(nodeById.keys()), nodeById);
    edges.push(...typed);

    return {
      nodes: Array.from(nodeById.values()),
      edges,
      truncated,
      similarities: [],
    };
  }

  /**
   * Asset-link graph for a source: assets connected by their `links` (each link
   * is a hash; a hash may resolve to several assets). Assets in other sources
   * are flagged external. Lone assets (no links) still render. Returns the
   * shared graph shape so it draws on the case-graph canvas.
   */
  async buildLinksGraph(sourceId: string): Promise<CorrelationGraphResult> {
    const sourceAssets = await this.prisma.asset.findMany({
      where: { sourceId },
      select: { ...ASSET_NODE_SELECT, hash: true, links: true },
    });
    if (sourceAssets.length === 0)
      return { nodes: [], edges: [], truncated: false, similarities: [] };

    // Collect every link hash referenced by this source's assets.
    const linkHashes = new Set<string>();
    for (const a of sourceAssets) {
      const links = Array.isArray(a.links) ? (a.links as unknown[]) : [];
      for (const l of links) if (typeof l === 'string' && l) linkHashes.add(l);
    }

    // Resolve link hashes → assets (may include external sources).
    const targets =
      linkHashes.size > 0
        ? await this.prisma.asset.findMany({
            where: { hash: { in: Array.from(linkHashes) } },
            select: { ...ASSET_NODE_SELECT, hash: true },
          })
        : [];
    const byHash = new Map<string, typeof targets>();
    for (const t of targets) {
      (byHash.get(t.hash) ?? byHash.set(t.hash, []).get(t.hash)!).push(t);
    }

    const nodeById = new Map<string, GraphNodeDto>();
    for (const a of sourceAssets) nodeById.set(a.id, assetNode(a, sourceId));

    const edges: GraphEdgeDto[] = [];
    const seen = new Set<string>();
    for (const a of sourceAssets) {
      const links = Array.isArray(a.links) ? (a.links as unknown[]) : [];
      for (const l of links) {
        if (typeof l !== 'string') continue;
        for (const target of byHash.get(l) ?? []) {
          if (target.id === a.id) continue;
          if (!nodeById.has(target.id)) {
            nodeById.set(target.id, assetNode(target, sourceId));
          }
          const key =
            a.id < target.id ? `${a.id}|${target.id}` : `${target.id}|${a.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({
            id: `link:${key}`,
            fromType: ASSET_REL,
            fromId: a.id,
            toType: ASSET_REL,
            toId: target.id,
            relationType: 'links_to',
            confidence: 1,
            origin: EdgeOrigin.INFERRED,
            // `links` says two assets are connected but not how, so this is a
            // reference and nothing more. A typed edge from the same pair (see
            // below) is the one that carries meaning.
            relationClass: 'REFERENCE',
          });
        }
      }
    }

    // Typed relationships the connector actually declared: lineage,
    // containment, identity. `links` cannot express any of these — it is a flat
    // list of hashes — so without this the source view can only ever show that
    // things are connected, never which way the data flows.
    const typed = await this.typedEdgesFor(
      Array.from(nodeById.keys()),
      nodeById,
      sourceId,
    );
    edges.push(...typed);

    return {
      nodes: Array.from(nodeById.values()),
      edges,
      truncated: false,
      similarities: [],
    };
  }

  /**
   * Persisted edges among a set of nodes, plus the unresolved/foreign
   * endpoints they point at.
   *
   * Two kinds of endpoint are missing from `nodeById` when this runs: an
   * `external` one names an object by platform URN that nothing has scanned
   * yet, and an `asset` one may simply belong to a source other than the one
   * this canvas is scoped to (e.g. an identity edge stitching a GISA record to
   * a Firmenbuch one). Both are hydrated into ghost/ringed nodes here rather
   * than filtered out: an edge whose far end is missing from `nodes` renders
   * as an arrow to nowhere, and quietly dropping it would hide the most
   * interesting thing on the canvas — that this source is linked to something
   * outside it.
   */
  private async typedEdgesFor(
    assetIds: string[],
    nodeById: Map<string, GraphNodeDto>,
    scopeSourceId?: string,
  ): Promise<GraphEdgeDto[]> {
    if (assetIds.length === 0) return [];
    const rows = await this.prisma.edge.findMany({
      where: {
        origin: { in: [EdgeOrigin.SOURCE_DERIVED, EdgeOrigin.MANUAL] },
        OR: [
          { fromType: ASSET_REL, fromId: { in: assetIds } },
          { toType: ASSET_REL, toId: { in: assetIds } },
        ],
      },
      take: 2000,
    });

    // Resolve every asset-typed endpoint not already on the canvas — the
    // other side of a cross-source edge — in one batched query rather than
    // per-row, then hydrate them the same way `external` endpoints are.
    const missingAssetIds = new Set<string>();
    for (const row of rows) {
      for (const [type, id] of [
        [row.fromType, row.fromId],
        [row.toType, row.toId],
      ] as const) {
        if (type === ASSET_REL && !nodeById.has(id)) missingAssetIds.add(id);
      }
    }
    if (missingAssetIds.size > 0) {
      const foreign = await this.prisma.asset.findMany({
        where: { id: { in: Array.from(missingAssetIds) } },
        select: ASSET_NODE_SELECT,
      });
      for (const a of foreign) nodeById.set(a.id, assetNode(a, scopeSourceId));
    }

    const edges: GraphEdgeDto[] = [];
    for (const row of rows) {
      for (const [type, id] of [
        [row.fromType, row.fromId],
        [row.toType, row.toId],
      ] as const) {
        if (type === 'external' && !nodeById.has(id)) {
          nodeById.set(id, {
            id,
            type: 'external',
            label: id,
            depth: 1,
            status: 'external',
            urn: id,
          });
        }
      }
      // Both ends have to be on the canvas; an asset that no longer exists
      // (deleted since the edge was written) has nothing to attach to.
      if (!nodeById.has(row.fromId) || !nodeById.has(row.toId)) continue;
      edges.push({
        id: row.id,
        fromType: row.fromType,
        fromId: row.fromId,
        toType: row.toType,
        toId: row.toId,
        relationType: row.relationType,
        confidence: Number(row.confidence),
        origin: row.origin,
        relationClass: row.relationClass,
        granularity: row.granularity,
        method: row.method,
      });
    }
    return edges;
  }

  async getValueOccurrences(args: {
    label?: string;
    value?: string;
    valueHash?: string;
  }): Promise<ValueOccurrenceDto> {
    let hash = args.valueHash;
    let label = args.label ?? '';
    let normalized = args.value ?? '';
    if (!hash) {
      if (!args.label || args.value == null) {
        return { label, value: normalized, valueHash: '', assets: [] };
      }
      const norm = normalizeValue(args.label, args.value);
      if (!norm) return { label, value: normalized, valueHash: '', assets: [] };
      normalized = norm;
      hash = valueHash(args.label, norm);
    }

    const rows = await this.prisma.assetCorrelationValue.findMany({
      where: { valueHash: hash },
      select: {
        assetId: true,
        findingId: true,
        label: true,
        detectorType: true,
        customDetectorKey: true,
        normalizedValue: true,
        asset: { select: ASSET_SELECT },
      },
    });
    if (rows[0]) {
      label = label || rows[0].label;
      normalized = normalized || rows[0].normalizedValue;
    }
    const findingByAsset = new Map(
      rows.filter((r) => r.findingId).map((r) => [r.assetId, r.findingId!]),
    );

    // Existing correlation rows predate findingId. Resolve only after this
    // value is opened in the UI, then persist the result so later opens are an
    // indexed lookup. Restrict the fallback to OPEN findings from the indexed
    // detectors before re-running normalization, avoiding an all-findings scan.
    const missingRows = rows.filter((r) => !r.findingId);
    const missingAssetIds = missingRows.map((r) => r.assetId);
    const missingAssetIdSet = new Set(missingAssetIds);
    if (missingAssetIds.length > 0 && label) {
      const detectorTypes = [
        ...new Set(
          missingRows
            .map((row) => row.detectorType)
            .filter((type) => type !== DetectorType.CUSTOM),
        ),
      ];
      const customKeys = [
        ...new Set(
          missingRows
            .map((row) => row.customDetectorKey)
            .filter((key): key is string => Boolean(key)),
        ),
      ];
      const detectorWhere: Prisma.FindingWhereInput[] = [];
      if (detectorTypes.length > 0) {
        detectorWhere.push({ detectorType: { in: detectorTypes } });
      }
      if (customKeys.length > 0) {
        detectorWhere.push({
          detectorType: DetectorType.CUSTOM,
          customDetectorKey: { in: customKeys },
        });
      }
      if (
        missingRows.some(
          (row) =>
            row.detectorType === DetectorType.CUSTOM && !row.customDetectorKey,
        )
      ) {
        detectorWhere.push({ detectorType: DetectorType.CUSTOM });
      }
      const candidates = await this.prisma.finding.findMany({
        where: {
          assetId: { in: missingAssetIds },
          status: FindingStatus.OPEN,
          OR: detectorWhere,
        },
        select: {
          id: true,
          assetId: true,
          findingType: true,
          matchedContent: true,
        },
        orderBy: { id: 'asc' },
      });
      for (const candidate of candidates) {
        if (findingByAsset.has(candidate.assetId)) continue;
        const candidateValue = normalizeValue(
          candidate.findingType,
          candidate.matchedContent,
        );
        if (
          candidateValue &&
          valueHash(candidate.findingType, candidateValue) === hash
        ) {
          findingByAsset.set(candidate.assetId, candidate.id);
        }
      }
      const resolved = [...findingByAsset.entries()].filter(([assetId]) =>
        missingAssetIdSet.has(assetId),
      );
      if (resolved.length > 0) {
        await this.prisma.$transaction(
          resolved.map(([assetId, findingId]) =>
            this.prisma.assetCorrelationValue.updateMany({
              where: { assetId, valueHash: hash, findingId: null },
              data: { findingId },
            }),
          ),
        );
      }
    }
    const clusterByAsset = await this.clusterIdsFor(rows.map((r) => r.assetId));
    return {
      label,
      value: normalized,
      valueHash: hash,
      assets: rows.map((r) => ({
        assetId: r.asset.id,
        findingId: findingByAsset.get(r.assetId) ?? null,
        name: r.asset.name,
        externalUrl: r.asset.externalUrl,
        assetType: r.asset.assetType,
        sourceType: r.asset.sourceType,
        sourceId: r.asset.sourceId,
        sourceName: r.asset.source?.name ?? '',
        clusterId: clusterByAsset.get(r.assetId) ?? null,
      })),
    };
  }

  /** Of the given asset ids, those that actually exist. For case actions. */
  async existingAssetIds(assetIds: string[]): Promise<string[]> {
    if (assetIds.length === 0) return [];
    const rows = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Finding ids belonging to the given assets (bounded), for case actions. */
  async findingIdsForAssets(assetIds: string[], cap = 2000): Promise<string[]> {
    if (assetIds.length === 0) return [];
    const rows = await this.prisma.finding.findMany({
      where: { assetId: { in: assetIds } },
      select: { id: true },
      take: cap,
    });
    return rows.map((r) => r.id);
  }

  private async clusterIdsFor(
    assetIds: string[],
  ): Promise<Map<string, string>> {
    if (assetIds.length === 0) return new Map();
    const members = await this.prisma.assetClusterMember.findMany({
      where: { assetId: { in: assetIds } },
      select: { assetId: true, clusterId: true },
    });
    return new Map(members.map((m) => [m.assetId, m.clusterId]));
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** A weight lookup; defaults to the static map when no DB config is threaded. */
type WeightOf = (label: string) => number;

/** Weighted-Dice + Jaccard over two assets' normalized value sets. */
export function scorePair(
  aRows: ValueRow[],
  bRows: ValueRow[],
  weightOf: WeightOf = weightForLabel,
): PairScore {
  const aByHash = new Map(aRows.map((r) => [r.valueHash, r.label]));
  const bSet = new Set(bRows.map((r) => r.valueHash));

  let weightedShared = 0;
  let sharedCount = 0;
  const sharedByLabel: Record<string, number> = {};
  for (const [hash, label] of aByHash) {
    if (!bSet.has(hash)) continue;
    sharedCount++;
    weightedShared += weightOf(label);
    sharedByLabel[label] = (sharedByLabel[label] ?? 0) + 1;
  }

  const weightedTotalA = aRows.reduce((s, r) => s + weightOf(r.label), 0);
  const weightedTotalB = bRows.reduce((s, r) => s + weightOf(r.label), 0);
  const denom = weightedTotalA + weightedTotalB;
  const weighted = denom === 0 ? 0 : (2 * weightedShared) / denom;

  const union = new Set([...aByHash.keys(), ...bSet]).size;
  const jaccard = union === 0 ? 0 : sharedCount / union;

  // "Exact" when both assets carry the same non-empty value set.
  const exact =
    sharedCount > 0 &&
    sharedCount === aByHash.size &&
    sharedCount === bSet.size;

  return { weighted, jaccard, sharedCount, sharedByLabel, exact };
}

function buildReasons(
  sharedByLabel: Record<string, number>,
  weightOf: WeightOf = weightForLabel,
): string[] {
  return Object.entries(sharedByLabel)
    .sort((a, b) => b[1] - a[1] || weightOf(b[0]) - weightOf(a[0]))
    .map(([label, count]) => `${count} shared ${pluralizeLabel(label, count)}`);
}

function pluralizeLabel(label: string, count: number): string {
  const human = label.replace(/_/g, ' ');
  if (count === 1) return human;
  if (human.endsWith('s')) return human;
  return `${human}s`;
}

function pickReuseCluster(
  members: string[],
  existingClusterByAsset: Map<string, string>,
): string | null {
  const counts = new Map<string, number>();
  for (const id of members) {
    const cid = existingClusterByAsset.get(id);
    if (cid) counts.set(cid, (counts.get(cid) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [cid, count] of counts) {
    if (count > bestCount) {
      best = cid;
      bestCount = count;
    }
  }
  return best;
}

/** Map an asset row to a graph node (matches the case-graph node shape). */
function assetNode(
  a: {
    id: string;
    name: string;
    externalUrl: string;
    assetType: string;
    sourceType: string;
    sourceId: string;
    source?: { name: string } | null;
  },
  scopeSourceId?: string,
): GraphNodeDto {
  return {
    id: a.id,
    type: ASSET_REL,
    label: a.name || a.externalUrl || a.id,
    depth: 0,
    assetType: a.assetType,
    sourceType: a.sourceType,
    sourceId: a.sourceId,
    sourceName: a.source?.name || undefined,
    // Flag assets outside the scoping source so the UI can mark/expand them.
    status:
      scopeSourceId && a.sourceId !== scopeSourceId ? 'external' : undefined,
  };
}

// ── Exclusion rules ──────────────────────────────────────────────────────────

/** Parse the JSONB exclusions column into typed rules (defensive). */
function parseExclusions(raw: unknown): ExclusionRule[] {
  if (!Array.isArray(raw)) return [];
  const out: ExclusionRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const mode = o.mode;
    if (mode !== 'value' && mode !== 'regex' && mode !== 'label') continue;
    out.push({
      id: typeof o.id === 'string' ? o.id : randomUUID(),
      mode,
      label: typeof o.label === 'string' ? o.label : null,
      value: typeof o.value === 'string' ? o.value : null,
    });
  }
  return out;
}

/** Normalize a rule's label/value to match how the engine stores tokens. */
function normalizeRule(rule: {
  mode: ExclusionRule['mode'];
  label?: string | null;
  value?: string | null;
}): {
  mode: ExclusionRule['mode'];
  label: string | null;
  value: string | null;
} {
  const label = rule.label ? normalizeLabel(rule.label) : null;
  if (rule.mode === 'label') return { mode: 'label', label, value: null };
  if (rule.mode === 'regex')
    return { mode: 'regex', label, value: (rule.value ?? '').trim() || null };
  // exact value: compared case-insensitively against the normalized value.
  return {
    mode: 'value',
    label,
    value: (rule.value ?? '').trim().toLowerCase() || null,
  };
}

function isUsableRule(r: ExclusionRule): boolean {
  if (r.mode === 'label') return !!r.label;
  if (r.mode === 'regex') {
    if (!r.value) return false;
    try {
      new RegExp(r.value);
      return true;
    } catch {
      return false;
    }
  }
  return !!r.value;
}

/** Compile rules into a fast (label, value) → excluded? predicate. */
function buildExclusionPredicate(
  rules: ExclusionRule[],
): (label: string, value: string) => boolean {
  const labelSet = new Set<string>();
  const exact: Array<{ label: string | null; value: string }> = [];
  const regexes: Array<{ label: string | null; re: RegExp }> = [];
  for (const r of rules) {
    if (!isUsableRule(r)) continue;
    if (r.mode === 'label' && r.label) labelSet.add(r.label);
    else if (r.mode === 'value' && r.value)
      exact.push({ label: r.label, value: r.value });
    else if (r.mode === 'regex' && r.value) {
      try {
        regexes.push({ label: r.label, re: new RegExp(r.value, 'i') });
      } catch {
        // skip invalid pattern
      }
    }
  }
  if (labelSet.size === 0 && exact.length === 0 && regexes.length === 0)
    return () => false;
  return (label: string, value: string) => {
    if (labelSet.has(label)) return true;
    for (const e of exact)
      if ((e.label === null || e.label === label) && e.value === value)
        return true;
    for (const rx of regexes)
      if ((rx.label === null || rx.label === label) && rx.re.test(value))
        return true;
    return false;
  };
}

/** Weights are small positive integers. */
function clampWeight(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_LABEL_WEIGHT;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Thresholds live in [0,1], two decimals. */
function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Clamp + round to fit Decimal(3,2) in [0,1]. */
function roundConfidence(n: number): number {
  return Math.min(1, Math.max(0, round2(n)));
}

/** Split an array into fixed-size chunks (bounds IN-query parameter counts). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
