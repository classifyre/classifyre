import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { NamespaceRegistryService } from './namespace-registry.service';
import { PrismaClientManager } from '../prisma/prisma-client-manager';
import { runsBackgroundWorkers } from '../service-role';

/**
 * Default grace period between soft-deleting a workspace and dropping it for
 * good. A week is long enough to notice and undo a mistaken delete, short
 * enough that dead workspaces do not quietly own the disk — on the instance
 * that prompted this, eleven soft-deleted workspaces held 11.8 GB of a 64 GB
 * database, indexes and all.
 */
const DEFAULT_RETENTION_DAYS = 7;

/** How often to look for expired workspaces. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Delay before the first sweep, so it never competes with boot. */
const FIRST_SWEEP_DELAY_MS = 5 * 60 * 1000;

/**
 * Drops workspaces that have been in the recycle bin longer than the retention
 * window.
 *
 * Deleting a workspace is deliberately reversible-for-a-while: `remove()` only
 * flips its status and stamps `deleted_at`, keeping the schema intact so the
 * data can be recovered. Nothing used to collect them afterwards, so every
 * workspace ever deleted stayed on disk forever. This closes that loop.
 *
 * The work is genuinely destructive and cannot be undone, so it is deliberately
 * conservative: it runs only where background workers run, re-checks the
 * `deleted` status immediately before dropping anything, releases the tenant's
 * connection pool first, and logs each purge at warn level with the schema name.
 * Setting `NAMESPACE_RETENTION_DAYS=0` turns it off entirely and restores the
 * previous keep-forever behaviour.
 */
@Injectable()
export class NamespacePurgeService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(NamespacePurgeService.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly registry: NamespaceRegistryService,
    private readonly prismaManager: PrismaClientManager,
  ) {}

  /** Retention window in ms; 0 disables purging. */
  get retentionMs(): number {
    return (
      parseRetentionDays(process.env.NAMESPACE_RETENTION_DAYS) * 86_400_000
    );
  }

  onApplicationBootstrap(): void {
    // API-only pods must not purge: two replicas racing to drop the same schema
    // is pointless work, and the worker role is where destructive maintenance
    // already lives.
    if (!runsBackgroundWorkers()) return;
    if (this.retentionMs === 0) {
      this.logger.log(
        'NAMESPACE_RETENTION_DAYS=0 — soft-deleted workspaces are kept indefinitely.',
      );
      return;
    }

    const start = setTimeout(() => {
      void this.sweep();
      this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
      this.timer.unref();
    }, FIRST_SWEEP_DELAY_MS);
    start.unref();
    this.timer = start;
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Public so an operator endpoint or a test can drive it directly. */
  async sweep(): Promise<number> {
    const retentionMs = this.retentionMs;
    if (retentionMs === 0 || this.sweeping) return 0;
    this.sweeping = true;
    let purged = 0;
    try {
      const expired = await this.registry.listExpiredDeleted(retentionMs);
      for (const namespace of expired) {
        try {
          // Let anything still holding the tenant's pool finish and disconnect
          // before the schema disappears underneath it.
          await this.prismaManager.dropWhenIdle(namespace.schemaName);
          if (await this.registry.purgeDeleted(namespace.id)) purged += 1;
        } catch (error) {
          // One bad workspace must not stop the sweep; it will be retried on
          // the next pass.
          this.logger.error(
            `Failed to purge soft-deleted workspace '${namespace.slug}': ${String(error)}`,
          );
        }
      }
      if (purged > 0) {
        this.logger.warn(
          `Purged ${purged} workspace(s) soft-deleted more than ${retentionMs / 86_400_000} day(s) ago.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Soft-deleted workspace sweep failed: ${String(error)}`,
      );
    } finally {
      this.sweeping = false;
    }
    return purged;
  }
}

export function parseRetentionDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_RETENTION_DAYS;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `NAMESPACE_RETENTION_DAYS must be an integer >= 0 (got ${JSON.stringify(raw)})`,
    );
  }
  return value;
}
