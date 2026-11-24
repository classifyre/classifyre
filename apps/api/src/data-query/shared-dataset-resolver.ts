import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { ActorContextService } from '../identity/actor-context.service';
import { IDENTITY } from '../identity/identity.tokens';
import type { IdentityService } from '../identity/identity.service';
import {
  QueryCatalogService,
  type CatalogSource,
  type CatalogTable,
  type QueryCatalog,
} from './query-catalog.service';
import { groupPrincipal, type DataPrincipal } from './data-principal';
import { parseDatasetColumns } from './dataset-floor';
import {
  CLS_CONNECTION_SCOPE,
  openAndUnblocked,
  type ConnectionScope,
} from './connection-scope';

/** Why a shared dataset cannot be read right now (DQ §5.12). */
export interface DatasetRefusal {
  code:
    | 'dataset_not_found'
    | 'dataset_retired'
    | 'dataset_blocked'
    | 'dataset_inputs_unavailable'
    | 'dataset_inputs_closed';
  message: string;
}

/** One input of a dataset, as the job reads it: the owning group's view. */
export interface DatasetInput {
  source: CatalogSource;
  table: CatalogTable;
}

export interface ResolvedDataset {
  assetId: string;
  sql: string;
  /** Output columns recorded when it was saved (any other is hidden). */
  columns: string[];
  inputs: DatasetInput[];
}

/** Told when a dataset's owning group has lost an input (to notify once). */
export type UnavailableListener = (event: {
  assetId: string;
  owningGroupId: string;
  reason: string;
}) => Promise<void> | void;

/**
 * Expands shared datasets for a read (docs/prd/DQ-data-query.md §5.12): its
 * SQL and its inputs as its owning group may read them — the group's grants,
 * masks and row filters, worked out again on every read. A retired or
 * blocked dataset, or one whose group no longer reads an input, is refused.
 * Over a SQL connection every input must itself be open to connections and
 * not blocked for this one: a connection never reaches a table its owner
 * kept closed, through a dataset or otherwise.
 */
@Injectable()
export class SharedDatasetResolver {
  private readonly logger = new Logger(SharedDatasetResolver.name);
  private readonly listeners: UnavailableListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: QueryCatalogService,
    private readonly actors: ActorContextService,
    @Inject(IDENTITY) private readonly identity: IdentityService,
    @Optional() private readonly cls?: ClsService,
  ) {}

  /** The SQL connection this read comes through, if any. */
  private connection(): ConnectionScope | undefined {
    return this.cls?.isActive()
      ? this.cls.get<ConnectionScope | undefined>(CLS_CONNECTION_SCOPE)
      : undefined;
  }

  onUnavailable(listener: UnavailableListener): void {
    this.listeners.push(listener);
  }

  /** A group's rights in the current workspace, or null when it has none. */
  async principalForGroup(groupId: string): Promise<DataPrincipal | null> {
    const workspaceId = this.actors.workspaceId();
    if (!workspaceId) return null;
    const access = await this.identity.groupAccessIn(groupId, workspaceId);
    if (!access) return null;
    return groupPrincipal({ groupId, ...access });
  }

  /** The catalog as a group sees it (null when the group is gone). */
  async catalogForGroup(groupId: string): Promise<QueryCatalog | null> {
    const principal = await this.principalForGroup(groupId);
    return principal ? this.catalog.catalog(principal) : null;
  }

  async resolve(
    assetIds: readonly string[],
  ): Promise<{ datasets: ResolvedDataset[] } | { refused: DatasetRefusal }> {
    if (!assetIds.length) return { datasets: [] };
    const rows = await this.prisma.sharedDataset.findMany({
      where: { assetId: { in: [...assetIds] } },
      include: {
        blocks: { where: { liftedAt: null }, select: { id: true } },
        asset: {
          select: { name: true, governance: { select: { status: true } } },
        },
      },
    });
    const byId = new Map(rows.map((row) => [row.assetId, row]));
    const groupCatalogs = new Map<string, QueryCatalog | null>();
    const connection = this.connection();
    const out: ResolvedDataset[] = [];
    for (const assetId of assetIds) {
      const row = byId.get(assetId);
      if (!row) {
        return {
          refused: {
            code: 'dataset_not_found',
            message: 'This shared dataset has no definition.',
          },
        };
      }
      const name = `shared.${row.domain}.${row.name}`;
      if (row.asset.governance?.status === 'RETIRED') {
        return {
          refused: {
            code: 'dataset_retired',
            message: `${name} is retired and no longer shared.`,
          },
        };
      }
      if (row.blocks.length) {
        return {
          refused: {
            code: 'dataset_blocked',
            message: `${name} is blocked by an owner of one of the tables it reads.`,
          },
        };
      }
      if (!groupCatalogs.has(row.owningGroupId)) {
        groupCatalogs.set(
          row.owningGroupId,
          await this.catalogForGroup(row.owningGroupId),
        );
      }
      const catalog = groupCatalogs.get(row.owningGroupId) ?? null;
      const inputs: DatasetInput[] = [];
      const missing: string[] = [];
      for (const inputId of row.inputs) {
        const found = catalog ? findTable(catalog, inputId) : null;
        if (found && found.table.canQuery && found.table.location) {
          inputs.push(found);
        } else {
          missing.push(found?.table.sqlName ?? inputId);
        }
      }
      if (!catalog || missing.length) {
        const reason = !catalog
          ? 'Its owning group no longer exists in this workspace.'
          : `Its owning group can no longer query ${missing.join(', ')}.`;
        await this.markUnavailable(
          row.assetId,
          row.owningGroupId,
          row.unavailableAt,
          reason,
        );
        return {
          refused: {
            code: 'dataset_inputs_unavailable',
            message: `${name} cannot be read: ${reason}`,
          },
        };
      }
      const closed = connection
        ? inputs.filter(({ table }) => !openAndUnblocked(connection, table))
        : [];
      if (closed.length) {
        const names = closed.map(({ table }) => table.sqlName).join(', ');
        return {
          refused: {
            code: 'dataset_inputs_closed',
            message: `${name} cannot be read over SQL connections: ${names} ${closed.length === 1 ? 'is' : 'are'} not open to them.`,
          },
        };
      }
      if (row.unavailableAt) {
        await this.prisma.sharedDataset
          .update({
            where: { assetId: row.assetId },
            data: { unavailableAt: null, unavailableWhy: null },
          })
          .catch(() => undefined);
      }
      out.push({
        assetId: row.assetId,
        sql: row.sql,
        columns: parseDatasetColumns(row.columns).map((c) => c.name),
        inputs,
      });
    }
    return { datasets: out };
  }

  private async markUnavailable(
    assetId: string,
    owningGroupId: string,
    since: Date | null,
    reason: string,
  ): Promise<void> {
    if (since) return; // told already, until a read succeeds again
    await this.prisma.sharedDataset
      .update({
        where: { assetId },
        data: { unavailableAt: new Date(), unavailableWhy: reason },
      })
      .catch(() => undefined);
    for (const listener of this.listeners) {
      try {
        await listener({ assetId, owningGroupId, reason });
      } catch (error) {
        this.logger.warn(
          `Could not report shared dataset ${assetId} unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

function findTable(
  catalog: QueryCatalog,
  assetId: string,
): DatasetInput | null {
  for (const source of catalog.sources) {
    const table = source.tables.find((t) => t.assetId === assetId);
    if (table) return { source, table };
  }
  return null;
}
