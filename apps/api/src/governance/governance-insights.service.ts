import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { answerableScopes } from './governance-filter';
import { qualityScore } from './quality-rules';
import { assetResource } from '../identity/audit-resources';
import { personOf } from '../identity/actor-ref';
import type { GovernancePerson } from './governance-rules';

const READ = 'query-runs.read-table';
const EXPORT_PREFIX = 'query-runs.export-table.';
const MAX_DAYS = 365;

export interface AssetUsage {
  days: number;
  reads: number;
  exports: number;
  readers: number;
  perDay: { day: string; reads: number; exports: number }[];
  topReaders: { actorRef: string; reads: number; exports: number }[];
  exportsByFormat: { format: string; count: number }[];
  /** Reads and exports by how they came: the app, MCP, a SQL connection. */
  byChannel: { channel: string; reads: number; exports: number }[];
}

export type DashboardScope = 'mine' | 'all';

export interface DashboardQuery {
  scope?: unknown;
  days?: unknown;
  sourceId?: unknown;
}

export interface SourceCoverageRow {
  sourceId: string;
  name: string;
  assets: number;
  owned: number;
  certified: number;
}

export interface DashboardAssetRow {
  assetId: string;
  name: string;
  sourceId: string;
  sourceName: string;
}

export interface GovernanceDashboard {
  scope: DashboardScope;
  days: number;
  totals: {
    assets: number;
    governed: number;
    certified: number;
    failing: number;
    score: number | null;
  };
  quality: {
    perDay: { day: string; passed: number; failed: number }[];
    dimensions: { dimension: string; rules: number; score: number | null }[];
  };
  failing: (DashboardAssetRow & {
    failing: number;
    severity: string;
  })[];
  incomplete: (DashboardAssetRow & { missing: string[] })[];
  incompleteCount: number;
  governFirst: (DashboardAssetRow & { reads: number; readers: number })[];
  coverage: SourceCoverageRow[];
}

export interface GovernanceUsage {
  scope: DashboardScope;
  days: number;
  sort: 'used' | 'rising';
  reads: number;
  exports: number;
  previous: number;
  perDay: { day: string; reads: number; exports: number }[];
  top: (DashboardAssetRow & {
    reads: number;
    exports: number;
    readers: number;
    previous: number;
  })[];
}

export interface AssetsOverview {
  raw: { total: number; new: number; updated: number };
  governance: {
    governed: number;
    ungoverned: number;
    certified: number;
    failing: number;
  };
  shared: { total: number; certified: number };
}

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

function span(days: unknown): number {
  return Math.min(Math.max(Math.trunc(Number(days)) || 30, 1), MAX_DAYS);
}

/** The calendar days of the period, oldest first (`YYYY-MM-DD`, UTC). */
function periodDays(days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Who uses an asset, and how far a workspace is governed (GOV §5.3, §5.7):
 * read-only aggregates over the audit trail and the governance rows. The
 * table reads come from DQ's per-table audit events (R6), so JDBC/ODBC
 * (DQ phase 5) shows here once it writes the same events.
 */
@Injectable()
export class GovernanceInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async usage(assetId: string, days = 30): Promise<AssetUsage> {
    const span = Math.min(Math.max(Math.trunc(days) || 30, 1), MAX_DAYS);
    const since = new Date(Date.now() - span * 86_400_000);
    const tag = assetResource(assetId);
    const rows = await this.prisma.$queryRaw<
      {
        day: Date;
        actor: string | null;
        channel: string;
        operation: string;
        via_dataset: boolean;
        count: bigint;
      }[]
    >`
      SELECT date_trunc('day', occurred_at) AS day, actor, channel, operation,
             EXISTS (SELECT 1 FROM unnest(resources) AS r WHERE r LIKE 'dataset:%')
               AS via_dataset,
             count(*) AS count
        FROM audit_events
       WHERE resources @> ARRAY[${tag}]::text[]
         AND (operation = ${READ} OR operation LIKE ${`${EXPORT_PREFIX}%`})
         AND occurred_at >= ${since}
       GROUP BY 1, 2, 3, 4, 5`;
    const channels = new Map<string, { reads: number; exports: number }>();

    const perDay = new Map<string, { reads: number; exports: number }>();
    const perActor = new Map<string, { reads: number; exports: number }>();
    const formats = new Map<string, number>();
    let reads = 0;
    let exports = 0;
    for (const row of rows) {
      const count = Number(row.count);
      const isExport = row.operation.startsWith(EXPORT_PREFIX);
      const day = row.day.toISOString().slice(0, 10);
      const dayEntry = perDay.get(day) ?? { reads: 0, exports: 0 };
      // A reader is a person, however they read: the app, an MCP token, a
      // SQL connection (`user:x@sql:c` counts as `user:x`).
      const actorKey = personOf(row.actor) ?? '';
      // Reads that reached this table through a shared dataset (DQ §5.12)
      // count as their own channel, whichever way the dataset was read.
      const channelKey = row.via_dataset ? 'dataset' : row.channel;
      const channelEntry = channels.get(channelKey) ?? {
        reads: 0,
        exports: 0,
      };
      if (row.operation.startsWith(EXPORT_PREFIX))
        channelEntry.exports += count;
      else channelEntry.reads += count;
      channels.set(channelKey, channelEntry);
      const actorEntry = perActor.get(actorKey) ?? { reads: 0, exports: 0 };
      if (isExport) {
        exports += count;
        dayEntry.exports += count;
        actorEntry.exports += count;
        const format = row.operation.slice(EXPORT_PREFIX.length);
        formats.set(format, (formats.get(format) ?? 0) + count);
      } else {
        reads += count;
        dayEntry.reads += count;
        actorEntry.reads += count;
      }
      perDay.set(day, dayEntry);
      perActor.set(actorKey, actorEntry);
    }
    const days_: AssetUsage['perDay'] = [];
    for (let i = span - 1; i >= 0; i -= 1) {
      const day = new Date(Date.now() - i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      days_.push({ day, ...(perDay.get(day) ?? { reads: 0, exports: 0 }) });
    }
    return {
      days: span,
      reads,
      exports,
      readers: [...perActor.keys()].filter(Boolean).length,
      perDay: days_,
      topReaders: [...perActor.entries()]
        .filter(([actorRef]) => actorRef)
        .map(([actorRef, entry]) => ({ actorRef, ...entry }))
        .sort((a, b) => b.reads + b.exports - (a.reads + a.exports))
        .slice(0, 5),
      exportsByFormat: [...formats.entries()]
        .map(([format, count]) => ({ format, count }))
        .sort((a, b) => b.count - a.count),
      byChannel: [...channels.entries()]
        .map(([channel, entry]) => ({ channel, ...entry }))
        .sort((a, b) => b.reads + b.exports - (a.reads + a.exports)),
    };
  }

  /** Who asked for *Mine* and has nothing to answer for gets *All*. */
  private async scopeSql(
    person: GovernancePerson | null,
    query: DashboardQuery,
  ): Promise<{ scope: DashboardScope; where: Prisma.Sql }> {
    const clauses: Prisma.Sql[] = [Prisma.sql`a.status <> 'DELETED'`];
    let scope: DashboardScope = query.scope === 'mine' ? 'mine' : 'all';
    if (scope === 'mine') {
      const mine = await answerableScopes(this.prisma, person);
      if (!mine.assetIds.length && !mine.sourceIds.length) scope = 'all';
      else
        clauses.push(
          Prisma.sql`(a.id = ANY(${mine.assetIds}::text[]) OR a.source_id = ANY(${mine.sourceIds}::text[]))`,
        );
    }
    if (typeof query.sourceId === 'string' && query.sourceId.trim()) {
      clauses.push(Prisma.sql`a.source_id = ${query.sourceId.trim()}`);
    }
    return { scope, where: Prisma.join(clauses, ' AND ') };
  }

  /**
   * The Governance tab of the assets page (GOV §5.7): what is governed, how
   * good it is, what needs someone, for the person's own assets or all.
   */
  async dashboard(
    person: GovernancePerson | null,
    query: DashboardQuery,
  ): Promise<GovernanceDashboard> {
    const days = span(query.days);
    const since = new Date(Date.now() - days * 86_400_000);
    const { scope, where } = await this.scopeSql(person, query);
    const scoped = Prisma.sql`
      owners AS (
        SELECT scope_type, scope_id FROM governance_roles
         WHERE role = 'OWNER' AND date_out IS NULL
      ), failing AS (
        SELECT asset_id, count(*) AS failing,
               max(CASE severity WHEN 'CRITICAL' THEN 5 WHEN 'HIGH' THEN 4
                     WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 2 ELSE 1 END) AS rank
          FROM findings
         WHERE detector_type = 'QUALITY' AND status = 'OPEN'
         GROUP BY asset_id
      ), scoped AS (
        SELECT a.id, a.name, a.source_id,
               (EXISTS (SELECT 1 FROM owners o WHERE o.scope_type = 'ASSET' AND o.scope_id = a.id)
                OR EXISTS (SELECT 1 FROM owners o WHERE o.scope_type = 'SOURCE' AND o.scope_id = a.source_id)) AS owned
          FROM assets a
         WHERE ${where}
      )`;

    const [coverage, failing, incomplete, governFirst, latest, perDay] =
      await Promise.all([
        this.prisma.$queryRaw<
          {
            source_id: string;
            name: string;
            assets: bigint;
            owned: bigint;
            certified: bigint;
            failing: bigint;
          }[]
        >`
          WITH ${scoped}
          SELECT s.id AS source_id, s.name,
                 count(l.id) AS assets,
                 count(l.id) FILTER (WHERE l.owned) AS owned,
                 count(l.id) FILTER (WHERE l.owned AND g.status = 'ACTIVE') AS certified,
                 count(f.asset_id) AS failing
            FROM scoped l
            JOIN sources s ON s.id = l.source_id
            LEFT JOIN asset_governance g ON g.asset_id = l.id
            LEFT JOIN failing f ON f.asset_id = l.id
           GROUP BY s.id, s.name
           ORDER BY count(l.id) DESC, s.name`,
        this.prisma.$queryRaw<
          {
            asset_id: string;
            name: string;
            source_id: string;
            source_name: string;
            failing: bigint;
            rank: number;
          }[]
        >`
          WITH ${scoped}
          SELECT l.id AS asset_id, l.name, s.id AS source_id, s.name AS source_name,
                 f.failing, f.rank
            FROM scoped l
            JOIN failing f ON f.asset_id = l.id
            JOIN sources s ON s.id = l.source_id
           ORDER BY f.rank DESC, f.failing DESC, l.name
           LIMIT 5`,
        this.prisma.$queryRaw<
          {
            asset_id: string;
            name: string;
            source_id: string;
            source_name: string;
            no_steward: boolean;
            no_description: boolean;
            not_certified: boolean;
            total: bigint;
          }[]
        >`
          WITH ${scoped}, gaps AS (
            SELECT l.id, l.name, l.source_id,
                   NOT EXISTS (
                     SELECT 1 FROM governance_roles r
                      WHERE r.role = 'STEWARD' AND r.date_out IS NULL
                        AND ((r.scope_type = 'ASSET' AND r.scope_id = l.id)
                          OR (r.scope_type = 'SOURCE' AND r.scope_id = l.source_id))
                   ) AS no_steward,
                   COALESCE(btrim(g.description), '') = '' AS no_description,
                   COALESCE(g.status::text, 'DRAFT') = 'DRAFT' AS not_certified
              FROM scoped l
              LEFT JOIN asset_governance g ON g.asset_id = l.id
             WHERE l.owned
          )
          SELECT gp.id AS asset_id, gp.name, s.id AS source_id, s.name AS source_name,
                 gp.no_steward, gp.no_description, gp.not_certified,
                 count(*) OVER () AS total
            FROM gaps gp
            JOIN sources s ON s.id = gp.source_id
           WHERE gp.no_steward OR gp.no_description OR gp.not_certified
           ORDER BY (gp.no_steward::int + gp.no_description::int + gp.not_certified::int) DESC, gp.name
           LIMIT 5`,
        this.prisma.$queryRaw<
          {
            asset_id: string;
            name: string;
            source_id: string;
            source_name: string;
            reads: bigint;
            readers: bigint;
          }[]
        >`
          WITH ${scoped}
          SELECT l.id AS asset_id, l.name, s.id AS source_id, s.name AS source_name,
                 count(e.id) AS reads,
                 count(DISTINCT split_part(e.actor, '@', 1)) AS readers
            FROM audit_events e
            JOIN scoped l ON l.id = e.entity_id AND NOT l.owned
            JOIN sources s ON s.id = l.source_id
           WHERE e.entity_type = 'asset'
             AND (e.operation = ${READ} OR e.operation LIKE ${`${EXPORT_PREFIX}%`})
             AND e.occurred_at >= ${since}
           GROUP BY l.id, l.name, s.id, s.name
           ORDER BY reads DESC, l.name
           LIMIT 5`,
        // The latest result of every enabled rule in scope: score and dimensions.
        this.prisma.$queryRaw<
          { dimension: string; severity: string; passed: boolean | null }[]
        >`
          WITH ${scoped}
          SELECT r.dimension, r.severity,
                 CASE WHEN q.error IS NULL THEN q.passed END AS passed
            FROM quality_rules r
            JOIN scoped l ON l.id = r.asset_id
            LEFT JOIN LATERAL (
              SELECT passed, error FROM quality_results
               WHERE rule_id = r.id ORDER BY evaluated_at DESC LIMIT 1
            ) q ON true
           WHERE r.enabled`,
        this.prisma.$queryRaw<{ day: Date; passed: bigint; failed: bigint }[]>`
          WITH ${scoped}
          SELECT date_trunc('day', q.evaluated_at) AS day,
                 count(*) FILTER (WHERE q.error IS NULL AND q.passed) AS passed,
                 count(*) FILTER (WHERE q.error IS NULL AND NOT q.passed) AS failed
            FROM quality_results q
            JOIN quality_rules r ON r.id = q.rule_id
            JOIN scoped l ON l.id = r.asset_id
           WHERE q.evaluated_at >= ${since}
           GROUP BY 1`,
      ]);

    const coverageRows = coverage.map((row) => ({
      sourceId: row.source_id,
      name: row.name,
      assets: Number(row.assets),
      owned: Number(row.owned),
      certified: Number(row.certified),
    }));
    const dimensions = new Map<
      string,
      { severity: string; passed: boolean | null }[]
    >();
    for (const rule of latest) {
      const list = dimensions.get(rule.dimension) ?? [];
      list.push(rule);
      dimensions.set(rule.dimension, list);
    }
    const daily = new Map(
      perDay.map((row) => [
        row.day.toISOString().slice(0, 10),
        { passed: Number(row.passed), failed: Number(row.failed) },
      ]),
    );
    const asRow = (row: {
      asset_id: string;
      name: string;
      source_id: string;
      source_name: string;
    }): DashboardAssetRow => ({
      assetId: row.asset_id,
      name: row.name,
      sourceId: row.source_id,
      sourceName: row.source_name,
    });

    return {
      scope,
      days,
      totals: {
        assets: coverageRows.reduce((sum, row) => sum + row.assets, 0),
        governed: coverageRows.reduce((sum, row) => sum + row.owned, 0),
        certified: coverageRows.reduce((sum, row) => sum + row.certified, 0),
        failing: coverage.reduce((sum, row) => sum + Number(row.failing), 0),
        score: qualityScore(latest),
      },
      quality: {
        perDay: periodDays(days).map((day) => ({
          day,
          ...(daily.get(day) ?? { passed: 0, failed: 0 }),
        })),
        dimensions: [...dimensions.entries()]
          .map(([dimension, rules]) => ({
            dimension,
            rules: rules.length,
            score: qualityScore(rules),
          }))
          .sort((a, b) => a.dimension.localeCompare(b.dimension)),
      },
      failing: failing.map((row) => ({
        ...asRow(row),
        failing: Number(row.failing),
        severity:
          Object.entries(SEVERITY_RANK).find(
            ([, rank]) => rank === Number(row.rank),
          )?.[0] ?? 'INFO',
      })),
      incomplete: incomplete.map((row) => ({
        ...asRow(row),
        missing: [
          ...(row.no_steward ? ['steward'] : []),
          ...(row.no_description ? ['description'] : []),
          ...(row.not_certified ? ['certification'] : []),
        ],
      })),
      incompleteCount: Number(incomplete[0]?.total ?? 0),
      governFirst: governFirst.map((row) => ({
        ...asRow(row),
        reads: Number(row.reads),
        readers: Number(row.readers),
      })),
      coverage: coverageRows,
    };
  }

  /**
   * Table reads and exports in the period, per day and for the top assets,
   * with the period before it: *rising* ranks by growth over that, which is
   * where usage spiked.
   */
  async workspaceUsage(
    person: GovernancePerson | null,
    query: DashboardQuery & { sort?: unknown; limit?: unknown },
  ): Promise<GovernanceUsage> {
    const days = span(query.days);
    const sort = query.sort === 'rising' ? 'rising' : 'used';
    const limit = Math.min(
      Math.max(Math.trunc(Number(query.limit)) || 10, 1),
      50,
    );
    const since = new Date(Date.now() - days * 86_400_000);
    const before = new Date(Date.now() - 2 * days * 86_400_000);
    const { scope, where } = await this.scopeSql(person, query);
    const events = Prisma.sql`
      events AS (
        SELECT e.entity_id AS asset_id, e.occurred_at, e.actor,
               e.operation LIKE ${`${EXPORT_PREFIX}%`} AS is_export,
               e.occurred_at >= ${since} AS current
          FROM audit_events e
          JOIN assets a ON a.id = e.entity_id
         WHERE e.entity_type = 'asset'
           AND (e.operation = ${READ} OR e.operation LIKE ${`${EXPORT_PREFIX}%`})
           AND e.occurred_at >= ${before}
           AND ${where}
      )`;
    const order =
      sort === 'rising'
        ? Prisma.sql`(t.reads + t.exports - t.previous) DESC, t.reads + t.exports DESC`
        : Prisma.sql`t.reads + t.exports DESC, t.readers DESC`;
    const [perDay, top] = await Promise.all([
      this.prisma.$queryRaw<
        { day: Date | null; reads: bigint; exports: bigint; current: boolean }[]
      >`
        WITH ${events}
        SELECT CASE WHEN current THEN date_trunc('day', occurred_at) END AS day,
               count(*) FILTER (WHERE NOT is_export) AS reads,
               count(*) FILTER (WHERE is_export) AS exports,
               current
          FROM events
         GROUP BY 1, current`,
      this.prisma.$queryRaw<
        {
          asset_id: string;
          name: string;
          source_id: string;
          source_name: string;
          reads: bigint;
          exports: bigint;
          readers: bigint;
          previous: bigint;
        }[]
      >`
        WITH ${events}, totals AS (
          SELECT asset_id,
                 count(*) FILTER (WHERE current AND NOT is_export) AS reads,
                 count(*) FILTER (WHERE current AND is_export) AS exports,
                 count(DISTINCT split_part(actor, '@', 1)) FILTER (WHERE current) AS readers,
                 count(*) FILTER (WHERE NOT current) AS previous
            FROM events
           GROUP BY asset_id
        )
        SELECT t.asset_id, a.name, s.id AS source_id, s.name AS source_name,
               t.reads, t.exports, t.readers, t.previous
          FROM totals t
          JOIN assets a ON a.id = t.asset_id
          JOIN sources s ON s.id = a.source_id
         WHERE t.reads + t.exports > 0
           ${sort === 'rising' ? Prisma.sql`AND t.reads + t.exports > t.previous` : Prisma.empty}
         ORDER BY ${order}, a.name
         LIMIT ${limit}`,
    ]);
    const daily = new Map<string, { reads: number; exports: number }>();
    let reads = 0;
    let exports = 0;
    let previous = 0;
    for (const row of perDay) {
      if (!row.current || !row.day) {
        previous += Number(row.reads) + Number(row.exports);
        continue;
      }
      reads += Number(row.reads);
      exports += Number(row.exports);
      daily.set(row.day.toISOString().slice(0, 10), {
        reads: Number(row.reads),
        exports: Number(row.exports),
      });
    }
    return {
      scope,
      days,
      sort,
      reads,
      exports,
      previous,
      perDay: periodDays(days).map((day) => ({
        day,
        ...(daily.get(day) ?? { reads: 0, exports: 0 }),
      })),
      top: top.map((row) => ({
        assetId: row.asset_id,
        name: row.name,
        sourceId: row.source_id,
        sourceName: row.source_name,
        reads: Number(row.reads),
        exports: Number(row.exports),
        readers: Number(row.readers),
        previous: Number(row.previous),
      })),
    };
  }

  /** The three cards of the assets page: raw, governed, shared. */
  async overview(): Promise<AssetsOverview> {
    const [row] = await this.prisma.$queryRaw<
      {
        raw_total: bigint;
        raw_new: bigint;
        raw_updated: bigint;
        governed: bigint;
        ungoverned: bigint;
        certified: bigint;
        failing: bigint;
        shared_total: bigint;
        shared_certified: bigint;
      }[]
    >`
      WITH owners AS (
        SELECT scope_type, scope_id FROM governance_roles
         WHERE role = 'OWNER' AND date_out IS NULL
      ), failing AS (
        SELECT DISTINCT asset_id FROM findings
         WHERE detector_type = 'QUALITY' AND status = 'OPEN'
      ), live AS (
        SELECT a.id, a.status, a.source_type::text = 'SHARED_DATASET' AS shared,
               (EXISTS (SELECT 1 FROM owners o WHERE o.scope_type = 'ASSET' AND o.scope_id = a.id)
                OR EXISTS (SELECT 1 FROM owners o WHERE o.scope_type = 'SOURCE' AND o.scope_id = a.source_id)) AS owned,
               g.status::text AS lifecycle,
               f.asset_id IS NOT NULL AS failing
          FROM assets a
          LEFT JOIN asset_governance g ON g.asset_id = a.id
          LEFT JOIN failing f ON f.asset_id = a.id
      )
      SELECT count(*) FILTER (WHERE NOT shared) AS raw_total,
             count(*) FILTER (WHERE NOT shared AND status = 'NEW') AS raw_new,
             count(*) FILTER (WHERE NOT shared AND status = 'UPDATED') AS raw_updated,
             count(*) FILTER (WHERE status <> 'DELETED' AND owned) AS governed,
             count(*) FILTER (WHERE status <> 'DELETED' AND NOT owned) AS ungoverned,
             count(*) FILTER (WHERE status <> 'DELETED' AND owned AND lifecycle = 'ACTIVE') AS certified,
             count(*) FILTER (WHERE status <> 'DELETED' AND failing) AS failing,
             count(*) FILTER (WHERE shared AND status <> 'DELETED') AS shared_total,
             count(*) FILTER (WHERE shared AND status <> 'DELETED' AND lifecycle = 'ACTIVE') AS shared_certified
        FROM live`;
    const n = (value: bigint | undefined) => Number(value ?? 0);
    return {
      raw: {
        total: n(row?.raw_total),
        new: n(row?.raw_new),
        updated: n(row?.raw_updated),
      },
      governance: {
        governed: n(row?.governed),
        ungoverned: n(row?.ungoverned),
        certified: n(row?.certified),
        failing: n(row?.failing),
      },
      shared: {
        total: n(row?.shared_total),
        certified: n(row?.shared_certified),
      },
    };
  }
}
