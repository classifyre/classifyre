import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import {
  featureOffMessage,
  type FeatureDisabledMode,
} from '../maintenance/workspace-features.constants';
import { normalizeLabel } from '../correlation/value-normalizer';
import type { EntityLabelConfig, NameLabelType } from './entity-labels';

/** Same staleness bound as the duplicate-detection switch, for the same reason. */
const SWITCH_CACHE_MS = 5_000;

export interface EntitySwitchState {
  enabled: boolean;
  /** How it was turned off: results kept or deleted. Null while on. */
  disabledMode: FeatureDisabledMode | null;
  changedAt: Date | null;
}

interface CachedConfig {
  state: EntitySwitchState;
  labels: EntityLabelConfig;
  syncedLabels: string[];
}

const DEFAULTS: CachedConfig = {
  state: { enabled: true, disabledMode: null, changedAt: null },
  labels: { nameLabels: {}, identifierLabels: [] },
  syncedLabels: [],
};

/** Refusal for entity work while the feature is off (a 409, like duplicates). */
export class EntitiesOffException extends ConflictException {
  constructor() {
    super(featureOffMessage('entities'));
  }
}

const NAME_TYPES: readonly NameLabelType[] = [
  'PERSON',
  'ORGANIZATION',
  'LOCATION',
  'ANY',
];

/**
 * The Entities feature switch and its label configuration, on the
 * `entity_config` singleton so both travel with a workspace export.
 *
 * A missing row means on with the shipped labels: that is what a new workspace
 * gets, while the migration wrote an "off" row into every workspace that
 * already held data. Reads are cached per schema for a few seconds, because
 * the API and the workers are separate processes and each learns of a flip by
 * reading.
 */
@Injectable()
export class EntitySwitchService {
  private readonly logger = new Logger(EntitySwitchService.name);
  private readonly cache = new Map<
    string,
    { config: CachedConfig; at: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  private schemaKey(): string {
    return this.cls?.get<string>(CLS_SCHEMA) ?? '__default__';
  }

  private async config(maxAgeMs = SWITCH_CACHE_MS): Promise<CachedConfig> {
    const key = this.schemaKey();
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at <= maxAgeMs) return cached.config;

    let config = DEFAULTS;
    try {
      const row = await this.prisma.entityConfig.findUnique({
        where: { id: 1 },
      });
      if (row) {
        config = {
          state: {
            enabled: row.enabled,
            disabledMode: row.enabled
              ? null
              : row.disabledMode === 'deleted'
                ? 'deleted'
                : 'kept',
            changedAt: row.enabledChangedAt ?? null,
          },
          labels: {
            nameLabels: parseNameLabels(row.nameLabels),
            identifierLabels: row.identifierLabels.map(normalizeLabel),
          },
          syncedLabels: row.syncedLabels,
        };
      }
    } catch (error) {
      // Unreadable (a namespace whose migrations have not run yet): entities
      // cannot work there either, so read as off rather than index for nobody.
      this.logger.debug(
        `Entities switch unreadable for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      config = {
        ...DEFAULTS,
        state: { enabled: false, disabledMode: 'kept', changedAt: null },
      };
    }
    this.cache.set(key, { config, at: Date.now() });
    return config;
  }

  async state(maxAgeMs = SWITCH_CACHE_MS): Promise<EntitySwitchState> {
    return (await this.config(maxAgeMs)).state;
  }

  async isEnabled(): Promise<boolean> {
    return (await this.state()).enabled;
  }

  /** Throw {@link EntitiesOffException} while the feature is off. */
  async assertEnabled(): Promise<void> {
    if (!(await this.isEnabled())) throw new EntitiesOffException();
  }

  async labels(): Promise<EntityLabelConfig> {
    return (await this.config()).labels;
  }

  async syncedLabels(): Promise<string[]> {
    return (await this.config(0)).syncedLabels;
  }

  /**
   * Flip the switch. Only the feature service calls this: turning entities on
   * or off also holds or releases their queues and schedules the catch-up.
   */
  async set(
    enabled: boolean,
    mode: FeatureDisabledMode | null,
  ): Promise<EntitySwitchState> {
    const disabledMode = enabled ? null : (mode ?? 'kept');
    const before = await this.state(0);
    const changedAt =
      before.enabled !== enabled ? new Date() : before.changedAt;
    await this.prisma.entityConfig.upsert({
      where: { id: 1 },
      create: { id: 1, enabled, disabledMode, enabledChangedAt: changedAt },
      update: { enabled, disabledMode, enabledChangedAt: changedAt },
    });
    this.invalidate();
    return { enabled, disabledMode, changedAt };
  }

  /** Replace the label configuration. Returns what was stored. */
  async saveLabels(input: {
    nameLabels?: Record<string, string>;
    identifierLabels?: string[];
  }): Promise<EntityLabelConfig> {
    const current = await this.labels();
    const nameLabels =
      input.nameLabels === undefined
        ? current.nameLabels
        : parseNameLabels(input.nameLabels);
    const identifierLabels =
      input.identifierLabels === undefined
        ? current.identifierLabels
        : [...new Set(input.identifierLabels.map(normalizeLabel))].filter(
            Boolean,
          );
    await this.prisma.entityConfig.upsert({
      where: { id: 1 },
      create: { id: 1, nameLabels, identifierLabels },
      update: { nameLabels, identifierLabels },
    });
    this.invalidate();
    return { nameLabels, identifierLabels };
  }

  /** A label an operator filed an identifier under takes part from then on. */
  async rememberIdentifierLabel(rawLabel: string): Promise<void> {
    const label = normalizeLabel(rawLabel);
    const current = await this.labels();
    if (!label || current.identifierLabels.includes(label)) return;
    await this.saveLabels({
      identifierLabels: [...current.identifierLabels, label],
    });
  }

  async markSynced(labels: string[]): Promise<void> {
    await this.prisma.entityConfig.upsert({
      where: { id: 1 },
      create: { id: 1, syncedLabels: labels },
      update: { syncedLabels: labels },
    });
    this.invalidate();
  }

  async markRecounted(): Promise<void> {
    await this.prisma.entityConfig.upsert({
      where: { id: 1 },
      create: { id: 1, recountedAt: new Date() },
      update: { recountedAt: new Date() },
    });
  }

  invalidate(): void {
    this.cache.delete(this.schemaKey());
  }
}

function parseNameLabels(raw: unknown): Record<string, NameLabelType> {
  const out: Record<string, NameLabelType> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [label, type] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeLabel(label);
    // "OTHER" is how the settings form says "a name of any kind".
    const value = type === 'OTHER' ? 'ANY' : type;
    if (key && NAME_TYPES.includes(value as NameLabelType)) {
      out[key] = value as NameLabelType;
    }
  }
  return out;
}
