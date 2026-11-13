import { BadRequestException, Injectable } from '@nestjs/common';
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
   * table its source opened is refused: close the source.
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
