import { ownerDataScope } from '../governance/governance-filter';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { ACCESS_POLICY, type AccessPolicy } from '../identity/access-policy';
import { ActorContextService } from '../identity/actor-context.service';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import {
  QUERYABLE_SOURCE_TYPES,
  assignTableNames,
  isTableShaped,
  tableAddress,
  uniqueSourceSqlName,
  type TableLocation,
} from './sql-names';
import {
  CLS_CONNECTION_SCOPE,
  connectionAllows,
  type ConnectionScope,
} from './connection-scope';

export interface CatalogColumn {
  name: string;
  type: string;
}

export interface CatalogTable {
  assetId: string;
  sourceId: string;
  /** The asset's own name, as the rest of the app shows it. */
  name: string;
  schema: string;
  table: string;
  /** `<source>.<schema>.<table>`: what to type. */
  sqlName: string;
  columns: CatalogColumn[];
  /** DuckDB can read it at all. */
  queryable: boolean;
  /** This person may query it (and the workspace answers SQL). */
  canQuery: boolean;
  reason?: string;
  location: TableLocation | null;
}

export interface CatalogSource {
  id: string;
  name: string;
  type: string;
  sqlName: string;
  queryable: boolean;
  tables: CatalogTable[];
}

export interface QueryCatalog {
  /** Every table of the workspace, by role; false when only some are granted. */
  canQueryAll: boolean;
  limits: { maxRows: number; timeoutSeconds: number; exportMaxRows: number };
  sources: CatalogSource[];
}

export interface QuerySettings {
  maxRows: number;
  timeoutSeconds: number;
  exportMaxRows: number;
  updatedBy: string | null;
  updatedAt: Date | null;
}

interface CachedTables {
  at: number;
  sources: Omit<CatalogSource, 'tables'>[];
  tables: Omit<CatalogTable, 'canQuery'>[];
}

/** How long the table list of one workspace is reused (it changes with scans). */
const CACHE_MS = 30_000;

/**
 * What a person can query in the current workspace (docs/prd/DQ-data-query.md §4).
 *
 * The table list is built from assets once per workspace and reused for a
 * short while; who can query what is decided per request, from the
 * capability set (a role on the whole workspace) and the grants on single
 * sources and tables.
 */
@Injectable()
export class QueryCatalogService {
  private readonly logger = new Logger(QueryCatalogService.name);
  private readonly cache = new Map<string, CachedTables>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly actors: ActorContextService,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
  ) {}

  async settings(): Promise<QuerySettings> {
    const row = await this.prisma.dataQuerySettings.findUnique({
      where: { id: 'default' },
    });
    return {
      maxRows: row?.maxRows ?? 10_000,
      timeoutSeconds: row?.timeoutSeconds ?? 120,
      exportMaxRows: row?.exportMaxRows ?? 1_000_000,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async updateSettings(input: {
    maxRows?: number;
    timeoutSeconds?: number;
    exportMaxRows?: number;
  }): Promise<QuerySettings> {
    const data = {
      ...(typeof input.maxRows === 'number'
        ? { maxRows: Math.min(Math.max(Math.trunc(input.maxRows), 1), 100_000) }
        : {}),
      ...(typeof input.timeoutSeconds === 'number'
        ? {
            timeoutSeconds: Math.min(
              Math.max(Math.trunc(input.timeoutSeconds), 5),
              900,
            ),
          }
        : {}),
      ...(typeof input.exportMaxRows === 'number'
        ? {
            exportMaxRows: Math.min(
              Math.max(Math.trunc(input.exportMaxRows), 1),
              10_000_000,
            ),
          }
        : {}),
      updatedBy: this.actors.current().ref ?? null,
    };
    await this.prisma.dataQuerySettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });
    return this.settings();
  }

  /** Forget the cached table list, e.g. after a source was renamed. */
  invalidate(): void {
    const schema = this.schema();
    if (schema) this.cache.delete(schema);
  }

  private schema(): string | undefined {
    return this.cls.isActive() ? this.cls.get<string>(CLS_SCHEMA) : undefined;
  }

  /** Who may query what: everything, or the sources and tables granted. */
  async scope(): Promise<{
    all: boolean;
    sourceIds: ReadonlySet<string>;
    assetIds: ReadonlySet<string>;
    seeLocked: boolean;
  }> {
    const actor = this.actors.current();
    const capabilities = await this.policy.capabilities(actor);
    const grants = this.policy.resourceGrants?.('data.query') ?? {
      sourceIds: [],
      assetIds: [],
    };
    const all = capabilities.has('data.query');
    // An owner reads the tables they own (GOV R3), without a grant.
    const owned = all
      ? { sourceIds: [], assetIds: [] }
      : await ownerDataScope(
          this.prisma,
          actor.id?.startsWith('user:') ? actor.id : actor.ref,
        );
    return {
      all,
      sourceIds: new Set([...grants.sourceIds, ...owned.sourceIds]),
      assetIds: new Set([...grants.assetIds, ...owned.assetIds]),
      seeLocked: capabilities.has('asset.view'),
    };
  }

  async catalog(): Promise<QueryCatalog> {
    const [settings, scope, cached] = await Promise.all([
      this.settings(),
      this.scope(),
      this.tables(),
    ]);
    const sources = new Map<string, CatalogSource>();
    for (const source of cached.sources) {
      sources.set(source.id, { ...source, tables: [] });
    }
    const connection = this.cls.isActive()
      ? this.cls.get<ConnectionScope | undefined>(CLS_CONNECTION_SCOPE)
      : undefined;
    for (const table of cached.tables) {
      // Through a SQL connection only what it opens shows at all: a BI tool
      // has no use for locked tables, and blocked ones are not its business.
      if (connection && !connectionAllows(connection, table)) continue;
      const granted =
        scope.all ||
        scope.sourceIds.has(table.sourceId) ||
        scope.assetIds.has(table.assetId);
      if (!granted && (connection || !scope.seeLocked)) continue;
      // R4: say why a visible table cannot be queried — unreadable by the
      // engine, or locked for lack of a grant.
      const reason = table.queryable
        ? granted
          ? undefined
          : 'You need the Data reader role on this table or its source to query it.'
        : table.reason;
      sources.get(table.sourceId)?.tables.push({
        ...table,
        canQuery: table.queryable && granted,
        ...(reason ? { reason } : {}),
      });
    }
    return {
      canQueryAll: scope.all,
      limits: {
        maxRows: settings.maxRows,
        timeoutSeconds: settings.timeoutSeconds,
        exportMaxRows: settings.exportMaxRows,
      },
      sources: [...sources.values()].filter((source) => source.tables.length),
    };
  }

  /** Every table-shaped asset of the workspace, named for SQL. */
  async tables(): Promise<CachedTables> {
    const key = this.schema() ?? '';
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit;

    const sourceRows = await this.prisma.source.findMany({
      select: { id: true, name: true, type: true, sqlName: true },
      orderBy: { name: 'asc' },
    });
    await this.assignSourceNames(sourceRows);

    const queryableIds = sourceRows
      .filter((source) => QUERYABLE_SOURCE_TYPES.has(String(source.type)))
      .map((source) => source.id);
    const assets = await this.prisma.asset.findMany({
      where: {
        sourceId: { in: sourceRows.map((source) => source.id) },
        assetType: { in: ['table', 'file'] },
        status: { not: 'DELETED' },
      },
      select: {
        id: true,
        name: true,
        sourceId: true,
        assetType: true,
        metadata: true,
      },
    });

    const typeOf = new Map(sourceRows.map((s) => [s.id, String(s.type)]));
    const bySource = new Map<string, typeof assets>();
    for (const asset of assets) {
      const type = typeOf.get(asset.sourceId) ?? '';
      const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
      if (!isTableShaped(type, asset.assetType, metadata, asset.name)) continue;
      const list = bySource.get(asset.sourceId) ?? [];
      list.push(asset);
      bySource.set(asset.sourceId, list);
    }

    const tables: Omit<CatalogTable, 'canQuery'>[] = [];
    for (const source of sourceRows) {
      const list = bySource.get(source.id) ?? [];
      if (!list.length) continue;
      const type = String(source.type);
      // Catalog-per-database sources: PostgreSQL's databases, Databricks'
      // catalogs, an ODBC driver's catalogs. More than one and the database
      // joins the schema name.
      const databases = new Set(
        list
          .map((a) => (a.metadata as Record<string, unknown> | null)?.database)
          .filter((d): d is string => typeof d === 'string'),
      );
      const addressed = list.map((asset) => ({
        asset,
        address: tableAddress(
          type,
          asset.assetType,
          asset.name,
          (asset.metadata ?? {}) as Record<string, unknown>,
          (type === 'POSTGRESQL' || type === 'DATABRICKS' || type === 'ODBC') &&
            databases.size > 1,
        ),
      }));
      const names = assignTableNames(
        addressed.map(({ asset, address }) => ({
          id: asset.id,
          schema: address.schema,
          table: address.table,
        })),
      );
      const sourceQueryable = QUERYABLE_SOURCE_TYPES.has(type);
      for (const { asset, address } of addressed) {
        const name = names.get(asset.id)!;
        const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
        const queryable = sourceQueryable && address.location !== null;
        tables.push({
          assetId: asset.id,
          sourceId: source.id,
          name: asset.name,
          schema: name.schema,
          table: name.table,
          sqlName: `${source.sqlName}.${name.schema}.${name.table}`,
          columns: columnsOf(metadata),
          queryable,
          ...(queryable
            ? {}
            : {
                reason: sourceQueryable
                  ? address.reason
                  : 'Sources of this type cannot be queried with SQL yet.',
              }),
          location: address.location,
        });
      }
    }
    tables.sort((a, b) => a.sqlName.localeCompare(b.sqlName));

    const entry: CachedTables = {
      at: Date.now(),
      sources: sourceRows.map((source) => ({
        id: source.id,
        name: source.name,
        type: String(source.type),
        sqlName: source.sqlName!,
        queryable: queryableIds.includes(source.id),
      })),
      tables,
    };
    this.cache.set(key, entry);
    return entry;
  }

  /** Give every source a SQL name the first time it is needed, and keep it. */
  private async assignSourceNames(
    sources: { id: string; name: string; sqlName: string | null }[],
  ): Promise<void> {
    const taken = new Set(
      sources.map((s) => s.sqlName).filter((n): n is string => Boolean(n)),
    );
    for (const source of sources) {
      if (source.sqlName) continue;
      const sqlName = uniqueSourceSqlName(source.name, taken);
      try {
        await this.prisma.source.update({
          where: { id: source.id },
          data: { sqlName },
        });
        source.sqlName = sqlName;
        taken.add(sqlName);
      } catch (error) {
        // Another request named it at the same moment: read what it chose.
        const row = await this.prisma.source.findUnique({
          where: { id: source.id },
          select: { sqlName: true },
        });
        if (!row?.sqlName) throw error;
        this.logger.debug(`Source ${source.id} was named concurrently`);
        source.sqlName = row.sqlName;
        taken.add(row.sqlName);
      }
    }
  }
}

function columnsOf(metadata: Record<string, unknown>): CatalogColumn[] {
  const columns = metadata.columns;
  if (!Array.isArray(columns)) return [];
  const out: CatalogColumn[] = [];
  for (const column of columns) {
    if (typeof column === 'string') {
      out.push({ name: column, type: '' });
    } else if (column && typeof column === 'object') {
      const { name, type } = column as Record<string, unknown>;
      if (typeof name === 'string' && name) {
        out.push({ name, type: typeof type === 'string' ? type : '' });
      }
    }
  }
  return out;
}
