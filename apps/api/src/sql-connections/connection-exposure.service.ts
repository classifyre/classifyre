import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ActorContextService } from '../identity/actor-context.service';
import { AuditTrailService } from '../identity/audit-trail.service';
import {
  DATA_RESOURCE,
  assetResource,
  sourceResource,
} from '../identity/audit-resources';
import { GovernanceService } from '../governance/governance.service';
import { QueryCatalogService } from '../data-query/query-catalog.service';
import type { ScopeIds } from '../data-query/connection-scope';
import { ConnectionRightsService } from './connection-rights.service';
import { splitScoped } from './connection-scope-rules';
import type {
  DataConnectionExposureDto,
  DataConnectionExposureItemDto,
  DataConnectionReachableSourceDto,
  DataConnectionScopeItemDto,
} from './data-connection.dto';

/**
 * Lifecycles in which a shared dataset no longer holds its tables open to SQL
 * connections: deprecating (or retiring) it comes before closing them.
 */
const WINDING_DOWN = new Set(['DEPRECATED', 'RETIRED']);

/**
 * What SQL connections may reach at all (docs/prd/DQ §5.7, opt-in): sources
 * and tables opened by whoever governs them, what a person may put in a
 * connection, and the names connections and audit rows show.
 */
@Injectable()
export class ConnectionExposureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ActorContextService,
    private readonly audit: AuditTrailService,
    private readonly governance: GovernanceService,
    private readonly catalog: QueryCatalogService,
    private readonly rights: ConnectionRightsService,
  ) {}

  /** Every opened source and table. */
  async open(): Promise<ScopeIds> {
    return splitScoped(await this.prisma.dataConnectionExposure.findMany());
  }

  /** Is a table or source open to connections, and by whom (itself or its source)? */
  async exposureOf(
    type: 'asset' | 'source',
    id: string,
    sourceId: string,
  ): Promise<DataConnectionExposureDto> {
    const rows = await this.prisma.dataConnectionExposure.findMany({
      where: {
        OR: [
          ...(type === 'asset'
            ? [{ scopeType: 'ASSET' as const, scopeId: id }]
            : []),
          { scopeType: 'SOURCE' as const, scopeId: sourceId },
        ],
      },
    });
    const own = rows.find(
      (r) =>
        r.scopeType === (type === 'asset' ? 'ASSET' : 'SOURCE') &&
        r.scopeId === id,
    );
    const viaSource =
      type === 'asset'
        ? rows.find((r) => r.scopeType === 'SOURCE' && r.scopeId === sourceId)
        : undefined;
    const effective = own ?? viaSource;
    return {
      open: Boolean(effective),
      inheritedFromSource: !own && Boolean(viaSource),
      openedBy: effective?.openedBy ?? null,
      openedAt: effective?.openedAt ?? null,
    };
  }

  /**
   * Opens or closes a table or source to SQL connections. Who governs it
   * decides: `asset.govern`, its owner or steward, or a manager. Closing a
   * table its source opened is refused: close the source. A table a draft or
   * active shared dataset open to connections reads stays open until that
   * dataset is deprecated, retired or closed itself; a dataset opens only once
   * its tables are open (DQ §5.12).
   */
  async setExposure(
    type: 'asset' | 'source',
    id: string,
    open: boolean,
  ): Promise<DataConnectionExposureDto> {
    const scopeType = type === 'asset' ? 'ASSET' : 'SOURCE';
    const governed = await this.governance.mayGovernScope({
      scopeType,
      scopeId: id,
    });
    if (!governed.allowed && !(await this.rights.canManage())) {
      this.rights.refuse('asset.govern');
    }
    const before = await this.exposureOf(type, id, governed.sourceId);
    if (open && !before.open && type === 'asset') {
      await this.assertDatasetInputsOpen(id);
    }
    if (!open && before.open && !before.inheritedFromSource) {
      await this.assertNoLiveDatasetReads(type, id);
    }
    if (open) {
      await this.prisma.dataConnectionExposure.upsert({
        where: { scopeType_scopeId: { scopeType, scopeId: id } },
        create: {
          scopeType,
          scopeId: id,
          openedBy: this.actors.current().ref ?? null,
        },
        update: {},
      });
    } else {
      if (before.inheritedFromSource) {
        throw new BadRequestException(
          'Its source is open to SQL connections: close the source, or block this table for single connections.',
        );
      }
      await this.prisma.dataConnectionExposure.deleteMany({
        where: { scopeType, scopeId: id },
      });
    }
    const after = await this.exposureOf(type, id, governed.sourceId);
    if (before.open !== after.open) {
      void this.audit.record({
        actor: this.actors.current(),
        channel: 'rest',
        capability: 'asset.govern',
        operation: open ? 'data-connections.open' : 'data-connections.close',
        entityType: type,
        entityId: id,
        entityName: governed.name,
        resources: [
          DATA_RESOURCE,
          ...(type === 'asset'
            ? [assetResource(id), sourceResource(governed.sourceId)]
            : [sourceResource(id)]),
        ],
        fields: ['sqlConnections'],
        changes: [
          {
            field: 'SQL connections',
            from: before.open ? 'open' : 'closed',
            to: after.open ? 'open' : 'closed',
          },
        ],
      });
    }
    return after;
  }

  /**
   * Closing a table, or a source with tables not opened on their own, is
   * refused while a draft or active shared dataset open to SQL connections
   * reads one of them: it would go on reading the table over connections.
   */
  private async assertNoLiveDatasetReads(
    type: 'asset' | 'source',
    id: string,
  ): Promise<void> {
    const datasets = await this.prisma.sharedDataset.findMany({
      where: type === 'asset' ? { inputs: { has: id } } : undefined,
      select: {
        assetId: true,
        domain: true,
        name: true,
        inputs: true,
        asset: {
          select: {
            sourceId: true,
            governance: { select: { status: true } },
          },
        },
      },
    });
    const live = datasets.filter(
      (d) => !WINDING_DOWN.has(d.asset.governance?.status ?? 'DRAFT'),
    );
    if (!live.length) return;
    const open = await this.open();
    let reading = live.filter(
      (d) =>
        open.assetIds.includes(d.assetId) ||
        open.sourceIds.includes(d.asset.sourceId),
    );
    if (type === 'source' && reading.length) {
      const closing = new Set(
        (
          await this.prisma.asset.findMany({
            where: {
              id: { in: [...new Set(reading.flatMap((d) => d.inputs))] },
              sourceId: id,
            },
            select: { id: true },
          })
        )
          .map((a) => a.id)
          .filter((assetId) => !open.assetIds.includes(assetId)),
      );
      reading = reading.filter((d) => d.inputs.some((i) => closing.has(i)));
    }
    if (!reading.length) return;
    const names = reading.map((d) => `shared.${d.domain}.${d.name}`);
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'DATASETS_READ_TABLE',
      message: `Shared datasets open to SQL connections read ${type === 'asset' ? 'this table' : 'tables of this source'}: ${names.join(', ')}. Deprecate or retire them, or close them to SQL connections, first.`,
      datasets: reading.map((d) => ({
        assetId: d.assetId,
        sqlName: `shared.${d.domain}.${d.name}`,
      })),
    });
  }

  /** A shared dataset opens to SQL connections only once all its tables are open. */
  private async assertDatasetInputsOpen(assetId: string): Promise<void> {
    const dataset = await this.prisma.sharedDataset.findUnique({
      where: { assetId },
      select: { inputs: true },
    });
    if (!dataset?.inputs.length) return;
    const [open, inputs] = await Promise.all([
      this.open(),
      this.prisma.asset.findMany({
        where: { id: { in: dataset.inputs } },
        select: { id: true, sourceId: true },
      }),
    ]);
    const closedIds = dataset.inputs.filter((inputId) => {
      const input = inputs.find((a) => a.id === inputId);
      return !(
        open.assetIds.includes(inputId) ||
        (input && open.sourceIds.includes(input.sourceId))
      );
    });
    if (!closedIds.length) return;
    const names = await this.names({ sourceIds: [], assetIds: closedIds });
    const list = closedIds.map((inputId) => {
      const item = names.get(`asset:${inputId}`);
      return item?.sqlName ?? item?.name ?? inputId;
    });
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'DATASET_INPUTS_CLOSED',
      message: `Its tables must be open to SQL connections first: ${list.join(', ')}.`,
    });
  }

  /** Everything open to SQL connections, for Settings. */
  async listExposures(): Promise<DataConnectionExposureItemDto[]> {
    const rows = await this.prisma.dataConnectionExposure.findMany({
      orderBy: { openedAt: 'desc' },
    });
    const names = await this.names(splitScoped(rows));
    return rows.flatMap((r) => {
      const type = r.scopeType === 'ASSET' ? 'asset' : 'source';
      const item = names.get(`${type}:${r.scopeId}`);
      return item
        ? [{ ...item, openedBy: r.openedBy, openedAt: r.openedAt }]
        : [];
    });
  }

  /**
   * What the caller may put in a connection: the sources and tables they may
   * query that are open to SQL connections.
   */
  async reachable(): Promise<DataConnectionReachableSourceDto[]> {
    const [catalog, open] = await Promise.all([
      this.catalog.catalog(),
      this.open(),
    ]);
    const openSources = new Set(open.sourceIds);
    const openAssets = new Set(open.assetIds);
    return catalog.sources
      .map((source) => ({
        id: source.id,
        name: source.name,
        sqlName: source.sqlName,
        open: openSources.has(source.id),
        tables: source.tables
          .filter(
            (t) =>
              t.canQuery &&
              (openSources.has(source.id) || openAssets.has(t.assetId)),
          )
          .map((t) => ({ id: t.assetId, name: t.name, sqlName: t.sqlName })),
      }))
      .filter((source) => source.tables.length > 0);
  }

  /**
   * A named scope (sources or tables) must exist and be open to SQL
   * connections; for one's own connection the caller must also be able to
   * query it. A scope naming nothing is decided by the caller's rights, not
   * here.
   */
  async assertNamedScope(
    scope: ScopeIds,
    options: { mustQuery: boolean },
  ): Promise<void> {
    const [open, assets, sources] = await Promise.all([
      this.open(),
      this.prisma.asset.findMany({
        where: { id: { in: scope.assetIds } },
        select: { id: true, sourceId: true, name: true },
      }),
      this.prisma.source.findMany({
        where: { id: { in: scope.sourceIds } },
        select: { id: true, name: true },
      }),
    ]);
    if (
      assets.length !== scope.assetIds.length ||
      sources.length !== scope.sourceIds.length
    ) {
      throw new BadRequestException(
        'A source or table in the scope does not exist.',
      );
    }
    const openSources = new Set(open.sourceIds);
    const openAssets = new Set(open.assetIds);
    const closed = [
      ...sources.filter((s) => !openSources.has(s.id)).map((s) => s.name),
      ...assets
        .filter((a) => !openAssets.has(a.id) && !openSources.has(a.sourceId))
        .map((a) => a.name),
    ];
    if (closed.length) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'SCOPE_NOT_OPEN',
        message: `Not open to SQL connections: ${closed.join(', ')}. Its owner, a steward or an admin opens it on its Governance tab.`,
      });
    }
    if (!options.mustQuery) return;
    const reachable = new Set(
      (await this.reachable()).flatMap((s) => [
        `source:${s.id}`,
        ...s.tables.map((t) => `asset:${t.id}`),
      ]),
    );
    const unreadable = [
      ...sources.filter((s) => !reachable.has(`source:${s.id}`)),
      ...assets.filter((a) => !reachable.has(`asset:${a.id}`)),
    ].map((item) => item.name);
    if (unreadable.length) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'SCOPE_NOT_OPEN',
        message: `You cannot query ${[...new Set(unreadable)].join(', ')}.`,
      });
    }
  }

  /** Names (and SQL names for tables) of sources and tables, keyed `type:id`. */
  async names(
    scope: ScopeIds,
  ): Promise<Map<string, DataConnectionScopeItemDto>> {
    const [sources, assets, tables] = await Promise.all([
      scope.sourceIds.length
        ? this.prisma.source.findMany({
            where: { id: { in: scope.sourceIds } },
            select: { id: true, name: true },
          })
        : [],
      scope.assetIds.length
        ? this.prisma.asset.findMany({
            where: { id: { in: scope.assetIds } },
            select: { id: true, name: true },
          })
        : [],
      scope.assetIds.length
        ? this.catalog.tables().then((cached) => cached.tables)
        : Promise.resolve([] as { assetId: string; sqlName: string }[]),
    ]);
    const sqlNames = new Map<string, string>(
      tables.map((t) => [t.assetId, t.sqlName]),
    );
    const out = new Map<string, DataConnectionScopeItemDto>();
    for (const source of sources) {
      out.set(`source:${source.id}`, {
        type: 'source',
        id: source.id,
        name: source.name,
      });
    }
    for (const asset of assets) {
      const sqlName = sqlNames.get(asset.id);
      out.set(`asset:${asset.id}`, {
        type: 'asset',
        id: asset.id,
        name: asset.name,
        ...(sqlName ? { sqlName } : {}),
      });
    }
    return out;
  }
}
