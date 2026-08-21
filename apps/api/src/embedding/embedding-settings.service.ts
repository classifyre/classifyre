import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import { AiProviderConfigService } from '../ai-provider-config.service';
import {
  EmbeddingConfigService,
  type EmbeddingProviderKind,
} from './embedding-config.service';

/**
 * The fields that define a vector coordinate system.
 *
 * Two vectors are only comparable when every one of these matches: a cosine
 * distance between a MiniLM vector and an OpenAI vector is a number with no
 * meaning. EmbeddingSpace's unique tuple is exactly this list, which is why
 * changing any of them cannot be a live edit — the stored corpus has to be
 * rebuilt in the new system before it can be searched again.
 */
export const SPACE_DEFINING_FIELDS = [
  'provider',
  'model',
  'revision',
  'dimensions',
  'pooling',
  'normalize',
] as const;

export type SpaceDefiningField = (typeof SPACE_DEFINING_FIELDS)[number];

/** Everything the embedding subsystem needs, after overrides are applied. */
export interface ResolvedEmbeddingConfig {
  enabled: boolean;
  provider: EmbeddingProviderKind;
  model: string;
  revision: string;
  dimensions: number;
  pooling: string;
  normalize: boolean;
  batchSize: number;
  queueBatchSize: number;
  queueHighWaterMark: number;
  workerConcurrency: number;
  maxParallelCalls: number;
  intraOpThreads: number;
  dtype: string;
  device: string;
  cacheDir: string;
  localModelPath?: string;
  allowRemoteModels: boolean;
  retrySeconds: number;
  autoBackfill: boolean;
  hnswM: number;
  hnswEfConstruction: number;
  hnswEfSearch: number;
  /** Remote provider endpoint, resolved from the bound AI provider or env. */
  baseUrl?: string;
  apiKey?: string;
  aiProviderConfigId?: string | null;
}

/** One knob as the settings page shows it: what it is now, and what it would be. */
export interface EffectiveField<T> {
  value: T;
  deploymentDefault: T;
  overridden: boolean;
}

const ALLOWED_POOLING = ['mean', 'cls', 'none'] as const;
const ALLOWED_DTYPE = ['fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4'] as const;
const ALLOWED_DEVICE = ['cpu', 'gpu', 'webgpu', 'wasm', 'auto'] as const;

/**
 * The deployment configuration as a resolved config, with no overrides.
 *
 * Exported because services that can be constructed without the settings
 * service (unit tests do exactly this) still need a complete configuration to
 * read, and it must be the same shape the resolver produces.
 */
export function resolvedFromEnv(
  d: EmbeddingConfigService,
): ResolvedEmbeddingConfig {
  return {
    enabled: d.enabled,
    provider: d.provider,
    model: d.model,
    revision: d.revision,
    dimensions: d.dimensions,
    pooling: d.pooling,
    normalize: d.normalize,
    batchSize: d.batchSize,
    queueBatchSize: d.queueBatchSize,
    queueHighWaterMark: d.queueHighWaterMark,
    workerConcurrency: d.workerConcurrency,
    maxParallelCalls: d.maxParallelCalls,
    intraOpThreads: d.intraOpThreads,
    dtype: d.dtype,
    device: d.device,
    cacheDir: d.cacheDir,
    localModelPath: d.localModelPath,
    allowRemoteModels: d.allowRemoteModels,
    retrySeconds: d.retrySeconds,
    autoBackfill: d.autoBackfill,
    hnswM: d.hnswM,
    hnswEfConstruction: d.hnswEfConstruction,
    hnswEfSearch: d.hnswEfSearch,
    baseUrl: d.baseUrl,
    apiKey: d.apiKey,
    aiProviderConfigId: null,
  };
}

/**
 * Resolves the embedding configuration for the current workspace.
 *
 * Layering, lowest priority first:
 *
 *  1. **Deployment defaults** — Helm values on Kubernetes, the bundled desktop
 *     defaults, both arriving as environment variables and read through
 *     {@link EmbeddingConfigService}. This is what an operator gets without
 *     touching anything, and what the settings page shows as "default".
 *  2. **Workspace overrides** — the `embedding_settings` singleton in this
 *     namespace's schema. Null columns inherit, so an override is genuinely
 *     per-field rather than all-or-nothing.
 *
 * The result is cached per schema because it is read on hot paths (every
 * similarity query interpolates `dimensions` and `hnswEfSearch` into SQL) and
 * a database round trip per query would be absurd. The cache is dropped
 * whenever the settings change, and settings changes are rare by nature — the
 * expensive ones force a corpus rebuild.
 */
@Injectable()
export class EmbeddingSettingsService {
  private readonly logger = new Logger(EmbeddingSettingsService.name);
  private readonly cache = new Map<string, ResolvedEmbeddingConfig>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly defaults: EmbeddingConfigService,
    private readonly aiProviders: AiProviderConfigService,
    private readonly cls: ClsService,
  ) {}

  private schemaKey(): string {
    return this.cls?.get<string>(CLS_SCHEMA) ?? '__default__';
  }

  /** The deployment's own configuration, with no workspace overrides applied. */
  deploymentDefaults(): ResolvedEmbeddingConfig {
    return resolvedFromEnv(this.defaults);
  }

  /** The stored override row, or null when this workspace never changed anything. */
  async overrides() {
    return this.prisma.embeddingSettings.findUnique({ where: { id: 1 } });
  }

  /**
   * Effective configuration for the current workspace.
   *
   * Never throws on a bad stored value: a workspace that somehow holds an
   * invalid override must still be able to serve (and to be fixed from the
   * settings page), so an unusable field falls back to the deployment default
   * with a warning rather than taking the subsystem down.
   */
  async resolve(): Promise<ResolvedEmbeddingConfig> {
    const key = this.schemaKey();
    const cached = this.cache.get(key);
    if (cached) return cached;

    const base = this.deploymentDefaults();
    let row: Awaited<ReturnType<typeof this.overrides>> = null;
    try {
      row = await this.overrides();
    } catch (error) {
      // The table is missing until this namespace's migrations have run —
      // during that window the deployment defaults are exactly right.
      this.logger.debug(
        `No embedding overrides readable for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const resolved: ResolvedEmbeddingConfig = { ...base };
    if (row) {
      const pick = <K extends keyof ResolvedEmbeddingConfig>(
        field: K,
        value: ResolvedEmbeddingConfig[K] | null | undefined,
      ) => {
        if (value !== null && value !== undefined) resolved[field] = value;
      };
      pick('enabled', row.enabled);
      pick('provider', row.provider as EmbeddingProviderKind | null);
      pick('model', row.model);
      pick('revision', row.revision);
      pick('dimensions', row.dimensions);
      pick('pooling', row.pooling);
      pick('normalize', row.normalize);
      pick('batchSize', row.batchSize);
      pick('workerConcurrency', row.workerConcurrency);
      pick('maxParallelCalls', row.maxParallelCalls);
      pick('intraOpThreads', row.intraOpThreads);
      pick('dtype', row.dtype);
      pick('device', row.device);
      pick('autoBackfill', row.autoBackfill);
      pick('hnswM', row.hnswM);
      pick('hnswEfConstruction', row.hnswEfConstruction);
      pick('hnswEfSearch', row.hnswEfSearch);
      resolved.aiProviderConfigId = row.aiProviderConfigId;

      // A bound AI provider supplies the endpoint and the key, so the remote
      // credential lives in one place (encrypted) instead of being re-entered
      // per subsystem.
      if (row.aiProviderConfigId) {
        try {
          const runtime = await this.aiProviders.getRuntimeConfig(
            row.aiProviderConfigId,
          );
          resolved.baseUrl = runtime.baseUrl ?? resolved.baseUrl;
          resolved.apiKey = runtime.apiKey ?? resolved.apiKey;
        } catch (error) {
          this.logger.warn(
            `Embedding AI provider ${row.aiProviderConfigId} could not be resolved: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    this.cache.set(key, resolved);
    return resolved;
  }

  /**
   * Last resolved configuration, for callers that cannot await.
   *
   * Similarity SQL interpolates `dimensions` and `hnswEfSearch` inside an
   * already-open transaction; making those paths async to re-read a value that
   * changes maybe twice a year would be the wrong trade. Every such caller
   * runs after {@link resolve} has been awaited during runtime setup, so the
   * fallback to deployment defaults is a safety net, not the normal path.
   */
  cached(): ResolvedEmbeddingConfig {
    return this.cache.get(this.schemaKey()) ?? this.deploymentDefaults();
  }

  /** Drop the cached resolution so the next read reloads from the database. */
  invalidate(schema?: string): void {
    if (schema) this.cache.delete(schema);
    else this.cache.delete(this.schemaKey());
  }

  clearForSchema(schema: string): void {
    this.cache.delete(schema);
  }

  /**
   * Applies an override patch.
   *
   * Returns whether the change altered the space definition, which is what the
   * caller needs in order to decide between "nothing to do" and "purge the
   * corpus and re-embed it". Undefined fields are left alone; explicit nulls
   * clear an override back to the deployment default, which is how the UI's
   * "reset to default" works.
   */
  async update(patch: EmbeddingSettingsPatch): Promise<{
    requiresRebuild: boolean;
    changedFields: string[];
  }> {
    const before = await this.resolve();
    this.validate(patch);

    const data = { ...patch };
    await this.prisma.embeddingSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
    this.invalidate();
    const after = await this.resolve();

    const changedFields = (
      Object.keys(after) as (keyof ResolvedEmbeddingConfig)[]
    ).filter((field) => field !== 'apiKey' && before[field] !== after[field]);

    // Turning embeddings off is a rebuild too: the vectors have to go, and
    // turning them back on has to start from an empty corpus rather than a
    // corpus frozen halfway through whatever was running when it stopped.
    const requiresRebuild =
      changedFields.some((field) =>
        (SPACE_DEFINING_FIELDS as readonly string[]).includes(field),
      ) || before.enabled !== after.enabled;

    return { requiresRebuild, changedFields: changedFields.map(String) };
  }

  private validate(patch: EmbeddingSettingsPatch): void {
    const fail = (message: string): never => {
      throw new BadRequestException(message);
    };
    const range = (
      name: keyof EmbeddingSettingsPatch,
      min: number,
      max: number,
    ) => {
      const value = patch[name];
      if (value === undefined || value === null) return;
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        fail(`${String(name)} must be an integer`);
      }
      if ((value as number) < min || (value as number) > max) {
        fail(`${String(name)} must be between ${min} and ${max}`);
      }
    };

    if (
      patch.provider != null &&
      patch.provider !== 'transformers-js' &&
      patch.provider !== 'openai-compatible'
    ) {
      fail('provider must be transformers-js or openai-compatible');
    }
    if (
      patch.pooling != null &&
      !ALLOWED_POOLING.includes(patch.pooling as never)
    ) {
      fail(`pooling must be one of ${ALLOWED_POOLING.join(', ')}`);
    }
    if (patch.dtype != null && !ALLOWED_DTYPE.includes(patch.dtype as never)) {
      fail(`dtype must be one of ${ALLOWED_DTYPE.join(', ')}`);
    }
    if (
      patch.device != null &&
      !ALLOWED_DEVICE.includes(patch.device as never)
    ) {
      fail(`device must be one of ${ALLOWED_DEVICE.join(', ')}`);
    }
    if (patch.model != null && !patch.model.trim()) {
      fail('model must not be empty');
    }
    // pgvector's HNSW implementation indexes at most 2000 dimensions, so a
    // larger model would store vectors that can never be searched.
    range('dimensions', 1, 2000);
    range('batchSize', 1, 256);
    range('workerConcurrency', 1, 32);
    range('maxParallelCalls', 1, 32);
    range('intraOpThreads', 1, 16);
    range('hnswM', 2, 100);
    range('hnswEfConstruction', 4, 2000);
    range('hnswEfSearch', 1, 2000);

    if (
      patch.provider === 'openai-compatible' &&
      patch.aiProviderConfigId === null
    ) {
      fail(
        'A remote embedding provider needs an AI provider to supply its endpoint and key',
      );
    }
  }
}

/** Null clears an override; undefined leaves it untouched. */
export interface EmbeddingSettingsPatch {
  enabled?: boolean | null;
  provider?: string | null;
  model?: string | null;
  revision?: string | null;
  dimensions?: number | null;
  pooling?: string | null;
  normalize?: boolean | null;
  aiProviderConfigId?: string | null;
  batchSize?: number | null;
  workerConcurrency?: number | null;
  maxParallelCalls?: number | null;
  intraOpThreads?: number | null;
  dtype?: string | null;
  device?: string | null;
  autoBackfill?: boolean | null;
  hnswM?: number | null;
  hnswEfConstruction?: number | null;
  hnswEfSearch?: number | null;
}
