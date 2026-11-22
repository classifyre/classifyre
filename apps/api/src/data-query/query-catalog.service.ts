import {
  governedDataScope,
  ownerDataScope,
} from '../governance/governance-filter';
import { CLS_PERSON, type ClsPerson } from '../identity/iam-access-policy';
import {
  deriveClassification,
  type Classification,
  type ColumnFindingGroup,
} from '../governance/governance-rules';
import {
  columnsAsSeen,
  effectiveColumnPolicy,
  toColumnMask,
  type ColumnMask,
  type ColumnPolicy,
  type MaskedColumn,
} from './column-masks';
import { clearScopeFor, readsInClear, type ClearScope } from './clear-scope';
import type { DataPrincipal } from './data-principal';
import {
  rowFilterAsSeen,
  rowFilterFor,
  selectsEveryRow,
  type RowFilter,
} from './row-filters';
import { personOf } from '../identity/actor-ref';
import {
  columnFloors,
  datasetColumnPolicy,
  parseDatasetColumns,
  stricterClassification,
  stricterPolicy,
  type ColumnFloor,
  type DatasetColumn,
  type FloorInputs,
} from './dataset-floor';
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
  joinsDatabasesInSchema,
  TABLE_SHAPED_ASSET_KINDS,
  tableAddress,
  uniqueSourceSqlName,
  type TableLocation,
} from './sql-names';
import {
  CLS_CONNECTION_SCOPE,
  connectionAllows,
  type ConnectionScope,
} from './connection-scope';

export interface CatalogTable {
  assetId: string;
  sourceId: string;
  /** The asset's own name, as the rest of the app shows it. */
  name: string;
  schema: string;
  table: string;
  /** `<source>.<schema>.<table>`: what to type. */
  sqlName: string;
  /** As the person sees them: masked ones marked, hidden ones gone. */
  columns: MaskedColumn[];
  /** DuckDB can read it at all. */
  queryable: boolean;
  /** This person may query it (and the workspace answers SQL). */
  canQuery: boolean;
  reason?: string;
  location: TableLocation | null;
  /** Columns governance hides from this person (DQ §5.8), by count. */
  hiddenColumns?: number;
  /**
   * The masked and hidden columns the query job applies for this person;
   * absent when they read the table in clear. Never sent to the browser.
   */
  masks?: ColumnMask[];
  /**
   * The rows this person reads (DQ §5.10): absent when they read every row
   * (no filtering on the table, or they answer for it). Only the rules for
   * them, never another group's.
   */
  rowFilter?: RowFilter;
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

interface CachedClassifications {
  at: number;
  /** asset id → column → what its open findings classify it as. */
  byAsset: Map<string, Map<string, Classification>>;
}

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
  private readonly classified = new Map<string, CachedClassifications>();

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
    if (schema) {
      this.cache.delete(schema);
      this.classified.delete(schema);
    }
  }

  private schema(): string | undefined {
    return this.cls.isActive() ? this.cls.get<string>(CLS_SCHEMA) : undefined;
  }

  /**
   * The current request's person as a {@link DataPrincipal}: their
   * capabilities and resource grants in this workspace, their groups.
   */
  async requestPrincipal(): Promise<DataPrincipal> {
    const actor = this.actors.current();
    const capabilities = await this.policy.capabilities(actor);
    const person = this.cls.isActive()
      ? (this.cls.get<ClsPerson | undefined>(CLS_PERSON) ?? null)
      : null;
    return {
      ownerRef: personOf(actor.ref),
      person,
      capabilities,
      resourceGrants: (capability) =>
        this.policy.resourceGrants?.(capability) ?? {
          sourceIds: [],
          assetIds: [],
        },
    };
  }

  /** Who may query what: everything, or the sources and tables granted. */
  async scope(principal?: DataPrincipal): Promise<{
    all: boolean;
    sourceIds: ReadonlySet<string>;
    assetIds: ReadonlySet<string>;
    seeLocked: boolean;
  }> {
    const p = principal ?? (await this.requestPrincipal());
    const grants = p.resourceGrants('data.query');
    const all = p.capabilities.has('data.query');
    // An owner reads the tables they own (GOV R3), without a grant.
    const owned = all
      ? { sourceIds: [], assetIds: [] }
      : await ownerDataScope(this.prisma, p.ownerRef);
    return {
      all,
      sourceIds: new Set([...grants.sourceIds, ...owned.sourceIds]),
      assetIds: new Set([...grants.assetIds, ...owned.assetIds]),
      seeLocked: p.capabilities.has('asset.view'),
    };
  }

  /**
   * Who reads masked and hidden columns in clear (DQ §5.8): `data.unmask` on
   * the workspace (a role), on a source or table (an unmasked Data reader
   * grant), and the owners and stewards of what they govern.
   */
  async clearScope(principal?: DataPrincipal): Promise<ClearScope> {
    return clearScopeFor(
      this.prisma,
      principal ?? (await this.requestPrincipal()),
    );
  }

  /**
   * asset id → the rows the principal reads of each filtered table
   * (DQ §5.10); tables not in the map show every row. Read every time, like
   * the masks: a rule a steward removes stops applying at once. The tables
   * and sources the principal owns or stewards are left out: they see it all.
   */
  async rowFilters(principal?: DataPrincipal): Promise<Map<string, RowFilter>> {
    const policies = await this.prisma.assetRowPolicy.findMany({
      select: {
        assetId: true,
        asset: { select: { sourceId: true } },
        rules: { select: { principalRef: true, conditions: true } },
      },
    });
    const out = new Map<string, RowFilter>();
    if (!policies.length) return out;
    const person = principal
      ? principal.person
      : this.cls.isActive()
        ? (this.cls.get<ClsPerson | undefined>(CLS_PERSON) ?? null)
        : null;
    const governed = await governedDataScope(this.prisma, person);
    const everyRow = {
      sourceIds: new Set(governed.sourceIds),
      assetIds: new Set(governed.assetIds),
    };
    for (const policy of policies) {
      if (
        everyRow.assetIds.has(policy.assetId) ||
        everyRow.sourceIds.has(policy.asset.sourceId)
      ) {
        continue;
      }
      const filter = rowFilterFor(policy.rules, person?.groupIds ?? []);
      if (selectsEveryRow(filter)) continue;
      out.set(policy.assetId, filter);
    }
    return out;
  }

  /**
   * asset id → its masked and hidden columns, for people who do not read it
   * in clear. Stewards' settings are read every time (a column they hide is
   * hidden at once); what findings classify is reused like the table list.
   */
  async columnMasks(): Promise<Map<string, ColumnMask[]>> {
    const [derived, notes, datasets] = await Promise.all([
      this.derivedClassifications(),
      this.prisma.assetColumnAnnotation.findMany({
        where: {
          OR: [
            { access: { not: null } },
            { maskKind: { not: null } },
            { classification: { not: null } },
          ],
        },
        select: {
          assetId: true,
          columnName: true,
          access: true,
          maskKind: true,
          classification: true,
        },
      }),
      this.prisma.sharedDataset.findMany({
        select: { assetId: true, inputs: true, columns: true },
      }),
    ]);
    const out = new Map<string, ColumnMask[]>();
    const add = (assetId: string, mask: ColumnMask | null) => {
      if (!mask) return;
      const list = out.get(assetId) ?? [];
      list.push(mask);
      out.set(assetId, list);
    };
    const datasetIds = new Set(datasets.map((d) => d.assetId));
    const noted = new Set<string>();
    const noteOf = new Map<string, (typeof notes)[number]>();
    for (const note of notes) {
      noteOf.set(`${note.assetId}\u0000${note.columnName}`, note);
      // A shared dataset's columns follow their floor, below.
      if (datasetIds.has(note.assetId)) continue;
      noted.add(`${note.assetId}\u0000${note.columnName}`);
      const policy = effectiveColumnPolicy({
        access: note.access,
        maskKind: note.maskKind,
        classification:
          note.classification ??
          derived.get(note.assetId)?.get(note.columnName) ??
          null,
      });
      add(note.assetId, toColumnMask(note.columnName, policy));
    }
    for (const [assetId, columns] of derived) {
      if (datasetIds.has(assetId)) continue;
      for (const [column, classification] of columns) {
        if (noted.has(`${assetId}\u0000${column}`)) continue;
        const policy = effectiveColumnPolicy({
          access: null,
          maskKind: null,
          classification,
        });
        add(assetId, toColumnMask(column, policy));
      }
    }
    // DQ §5.12: a shared dataset's columns inherit their inputs' strictest
    // classification as a floor; its own settings can only add to it.
    const index = floorIndex(derived, notes, (await this.tables()).tables);
    for (const dataset of datasets) {
      const floors = columnFloors(
        parseDatasetColumns(dataset.columns),
        index(dataset.inputs),
      );
      for (const [column, { floor, policy: floorPolicy }] of floors) {
        const note = noteOf.get(`${dataset.assetId}\u0000${column}`);
        const policy = datasetColumnPolicy({
          floor,
          floorPolicy,
          access: note?.access,
          maskKind: note?.maskKind,
          classification: note?.classification,
        });
        add(dataset.assetId, toColumnMask(column, policy));
      }
    }
    return out;
  }

  /**
   * A shared dataset's output columns with their floor (DQ §5.12): the
   * strictest classification of the input columns each comes from, and
   * which ones. For governance and the dataset's pages.
   */
  async datasetFloors(assetId: string): Promise<Map<string, ColumnFloor>> {
    const dataset = await this.prisma.sharedDataset.findUnique({
      where: { assetId },
      select: { inputs: true, columns: true },
    });
    if (!dataset) return new Map();
    return this.floorsOf(parseDatasetColumns(dataset.columns), dataset.inputs);
  }

  /** Floors for dataset columns over these inputs (also before saving one). */
  async floorsOf(
    columns: readonly DatasetColumn[],
    inputIds: readonly string[],
  ): Promise<Map<string, ColumnFloor>> {
    const [derived, notes, cached] = await Promise.all([
      this.derivedClassifications(),
      this.prisma.assetColumnAnnotation.findMany({
        where: {
          assetId: { in: [...inputIds] },
          OR: [
            { access: { not: null } },
            { maskKind: { not: null } },
            { classification: { not: null } },
          ],
        },
        select: {
          assetId: true,
          columnName: true,
          access: true,
          maskKind: true,
          classification: true,
        },
      }),
      this.tables(),
    ]);
    return columnFloors(
      columns,
      floorIndex(derived, notes, cached.tables)(inputIds),
    );
  }

  /** Each column's effective classification on these tables (a steward's, else derived). */
  async classificationsOf(
    assetIds: readonly string[],
  ): Promise<Map<string, Map<string, Classification>>> {
    const [derived, notes] = await Promise.all([
      this.derivedClassifications(),
      this.prisma.assetColumnAnnotation.findMany({
        where: {
          assetId: { in: [...assetIds] },
          classification: { not: null },
        },
        select: { assetId: true, columnName: true, classification: true },
      }),
    ]);
    const out = new Map<string, Map<string, Classification>>();
    for (const assetId of assetIds) {
      const map = new Map<string, Classification>(derived.get(assetId) ?? []);
      out.set(assetId, map);
    }
    for (const note of notes) {
      if (!note.classification) continue;
      out
        .get(note.assetId)
        ?.set(note.columnName, note.classification as Classification);
    }
    return out;
  }

  /**
   * What open PII and secret findings classify, per table column (GOV §5.1),
   * and what a notebook declares its SQL tables' columns hold (QC §5.8).
   */
  private async derivedClassifications(): Promise<
    Map<string, Map<string, Classification>>
  > {
    const key = this.schema() ?? '';
    const hit = this.classified.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.byAsset;
    const rows = await this.prisma.$queryRaw<
      {
        asset_id: string;
        column: string;
        detector_type: string;
        finding_type: string;
      }[]
    >`
      SELECT asset_id,
             metadata->>'tabular_column_name' AS column,
             detector_type::text AS detector_type,
             finding_type
        FROM findings
       WHERE status = 'OPEN'
         AND detector_type::text IN ('PII', 'SECRETS')
         AND metadata ? 'tabular_column_name'
       GROUP BY 1, 2, 3, 4`;
    const groups = new Map<string, Map<string, ColumnFindingGroup[]>>();
    for (const row of rows) {
      if (!row.column) continue;
      const columns = groups.get(row.asset_id) ?? new Map();
      const list = columns.get(row.column) ?? [];
      list.push({
        detectorType: row.detector_type,
        findingType: row.finding_type,
        count: 1,
        maxSeverity: 'INFO',
      });
      columns.set(row.column, list);
      groups.set(row.asset_id, columns);
    }
    const byAsset = new Map<string, Map<string, Classification>>();
    const put = (assetId: string, column: string, value: string | null) => {
      const map = byAsset.get(assetId) ?? new Map<string, Classification>();
      const stricter = stricterClassification(map.get(column), value);
      if (!stricter) return;
      map.set(column, stricter);
      byAsset.set(assetId, map);
    };
    for (const [assetId, columns] of groups) {
      for (const [column, list] of columns) {
        put(assetId, column, deriveClassification(list));
      }
    }
    // A custom source's SQL tables (QC §5.8): their rows are read by queries,
    // never scanned, so no finding classifies them; what the notebook's
    // tables() declares a column holds does instead, as a floor findings
    // can only raise.
    const declared = await this.prisma.asset.findMany({
      where: {
        // Indexed columns narrow it to custom sources' tables before the
        // metadata is read (assets_source_type_idx, assets_asset_type_idx).
        sourceType: 'CUSTOM',
        assetType: 'table',
        metadata: { path: ['query'], equals: 'scan' },
        status: { not: 'DELETED' },
      },
      select: { id: true, metadata: true },
    });
    for (const asset of declared) {
      const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
      const columns = Array.isArray(metadata.columns) ? metadata.columns : [];
      for (const column of columns) {
        if (!column || typeof column !== 'object') continue;
        const { name, classification } = column as Record<string, unknown>;
        if (typeof name !== 'string' || typeof classification !== 'string') {
          continue;
        }
        put(asset.id, name, classification);
      }
    }
    this.classified.set(key, { at: Date.now(), byAsset });
    return byAsset;
  }

  /**
   * What a principal may query, as they see it. Without one, the request's
   * person (through their SQL connection's scope, if any); with one — a
   * shared dataset's owning group — exactly that principal's rights.
   */
  async catalog(principal?: DataPrincipal): Promise<QueryCatalog> {
    const p = principal ?? (await this.requestPrincipal());
    const [settings, scope, cached, clear, masks, rows] = await Promise.all([
      this.settings(),
      this.scope(p),
      this.tables(),
      this.clearScope(p),
      this.columnMasks(),
      this.rowFilters(p),
    ]);
    const sources = new Map<string, CatalogSource>();
    for (const source of cached.sources) {
      sources.set(source.id, { ...source, tables: [] });
    }
    const connection =
      !principal && this.cls.isActive()
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
      // DQ §5.8: hidden columns leave the list, masked ones say so; the
      // job gets the same masks, so what the list shows is what runs.
      const tableMasks = masks.get(table.assetId) ?? [];
      const inClear = readsInClear(clear, table);
      const seen = columnsAsSeen(table.columns, tableMasks, inClear);
      sources.get(table.sourceId)?.tables.push({
        ...table,
        columns: seen.columns,
        canQuery: table.queryable && granted,
        ...(reason ? { reason } : {}),
        ...(seen.hidden ? { hiddenColumns: seen.hidden } : {}),
        ...(!inClear && tableMasks.length ? { masks: tableMasks } : {}),
        ...(rows.has(table.assetId)
          ? { rowFilter: rows.get(table.assetId) }
          : {}),
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

  /**
   * The catalog as a person's browser gets it: the columns already say what
   * is masked and hidden ones are counted, so the job's mask list (which
   * names hidden columns) stays on the server, and row filters are told
   * without the hidden columns they test.
   */
  async publicCatalog(): Promise<QueryCatalog> {
    const catalog = await this.catalog();
    return {
      ...catalog,
      sources: catalog.sources.map((source) => ({
        ...source,
        tables: source.tables.map(({ masks, ...table }) =>
          table.rowFilter
            ? { ...table, rowFilter: rowFilterAsSeen(table.rowFilter, masks) }
            : table,
        ),
      })),
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
        assetType: { in: [...TABLE_SHAPED_ASSET_KINDS, 'file'] },
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
          joinsDatabasesInSchema(type) && databases.size > 1,
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

function columnsOf(metadata: Record<string, unknown>): MaskedColumn[] {
  const columns = metadata.columns;
  if (!Array.isArray(columns)) return [];
  const out: MaskedColumn[] = [];
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

/**
 * How a dataset's inputs are looked up for its floor (§5.12): each column's
 * effective classification (a steward's, else what findings derive), the
 * policies stewards set, and which columns each input has. Column names
 * are matched without case: lineage lowercases them, scans keep theirs.
 */
function floorIndex(
  derived: Map<string, Map<string, Classification>>,
  notes: readonly {
    assetId: string;
    columnName: string;
    classification: string | null;
    access?: string | null;
    maskKind?: string | null;
  }[],
  tables: readonly { assetId: string; columns: { name: string }[] }[],
) {
  const key = (assetId: string, column: string) =>
    `${assetId}\u0000${column.toLowerCase()}`;
  const classOf = new Map<string, string>();
  const policyOf = new Map<string, ColumnPolicy>();
  const columnsOf = new Map<string, Set<string>>();
  const add = (assetId: string, column: string) => {
    const set = columnsOf.get(assetId) ?? new Set<string>();
    set.add(column.toLowerCase());
    columnsOf.set(assetId, set);
  };
  for (const table of tables) {
    for (const column of table.columns) add(table.assetId, column.name);
  }
  for (const [assetId, columns] of derived) {
    for (const [column, value] of columns) {
      add(assetId, column);
      if (!classOf.has(key(assetId, column)))
        classOf.set(key(assetId, column), value);
    }
  }
  for (const note of notes) {
    add(note.assetId, note.columnName);
    // A steward's classification wins over what findings derive.
    if (note.classification)
      classOf.set(key(note.assetId, note.columnName), note.classification);
    if (note.access || note.maskKind) {
      policyOf.set(
        key(note.assetId, note.columnName),
        effectiveColumnPolicy({
          access: note.access,
          maskKind: note.maskKind,
          classification: null,
        }),
      );
    }
  }
  const classify = (assetId: string, column: string) =>
    classOf.get(key(assetId, column)) ?? null;
  return (assetIds: readonly string[]): FloorInputs => {
    let strictest: Classification | null = null;
    let strictestPolicy: ColumnPolicy | null = null;
    for (const assetId of assetIds) {
      for (const column of columnsOf.get(assetId) ?? []) {
        strictest = stricterClassification(
          strictest,
          classify(assetId, column),
        );
        const own = policyOf.get(key(assetId, column));
        if (own)
          strictestPolicy = strictestPolicy
            ? stricterPolicy(strictestPolicy, own)
            : own;
      }
    }
    return {
      classify,
      strictest,
      policyOf: (assetId, column) => policyOf.get(key(assetId, column)) ?? null,
      strictestPolicy,
      // An input whose columns are not known (not scanned yet) cannot say.
      known: (assetId, column) =>
        columnsOf.get(assetId)?.has(column.toLowerCase()) ?? false,
    };
  };
}
