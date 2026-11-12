import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { assetResource } from '../identity/audit-resources';
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
}

export interface SourceCoverageRow {
  sourceId: string;
  name: string;
  assets: number;
  owned: number;
  active: number;
}

export interface GovernFirstRow {
  assetId: string;
  name: string;
  sourceId: string;
  sourceName: string;
  reads: number;
  readers: number;
}

export interface GovernanceSummary {
  days: number;
  totals: { assets: number; owned: number; active: number };
  sources: SourceCoverageRow[];
  governFirst: GovernFirstRow[];
  mine: { owned: number; stewarded: number };
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
      { day: Date; actor: string | null; operation: string; count: bigint }[]
    >`
      SELECT date_trunc('day', occurred_at) AS day, actor, operation,
             count(*) AS count
        FROM audit_events
       WHERE resources @> ARRAY[${tag}]::text[]
         AND (operation = ${READ} OR operation LIKE ${`${EXPORT_PREFIX}%`})
         AND occurred_at >= ${since}
       GROUP BY 1, 2, 3`;

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
      const actorKey = row.actor ?? '';
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
    };
  }

  async summary(
    person: GovernancePerson | null,
    days = 30,
  ): Promise<GovernanceSummary> {
    const span = Math.min(Math.max(Math.trunc(days) || 30, 1), MAX_DAYS);
    const since = new Date(Date.now() - span * 86_400_000);
    // Owned: the asset's own open owner, or its source's.
    const sources = await this.prisma.$queryRaw<
      {
        source_id: string;
        name: string;
        assets: bigint;
        owned: bigint;
        active: bigint;
      }[]
    >`
      WITH owners AS (
        SELECT scope_type, scope_id FROM governance_roles
         WHERE role = 'OWNER' AND date_out IS NULL
      ), live AS (
        SELECT a.id, a.source_id,
               (EXISTS (SELECT 1 FROM owners o WHERE o.scope_type = 'ASSET' AND o.scope_id = a.id)
                OR EXISTS (SELECT 1 FROM owners o WHERE o.scope_type = 'SOURCE' AND o.scope_id = a.source_id)) AS owned
          FROM assets a
         WHERE a.status <> 'DELETED'
      )
      SELECT s.id AS source_id, s.name,
             count(l.id) AS assets,
             count(l.id) FILTER (WHERE l.owned) AS owned,
             count(l.id) FILTER (WHERE l.owned AND g.status = 'ACTIVE') AS active
        FROM sources s
        LEFT JOIN live l ON l.source_id = s.id
        LEFT JOIN asset_governance g ON g.asset_id = l.id
       GROUP BY s.id, s.name
       ORDER BY s.name`;

    const governFirst = await this.prisma.$queryRaw<
      {
        asset_id: string;
        name: string;
        source_id: string;
        source_name: string;
        reads: bigint;
        readers: bigint;
      }[]
    >`
      SELECT a.id AS asset_id, a.name, s.id AS source_id, s.name AS source_name,
             count(e.id) AS reads, count(DISTINCT e.actor) AS readers
        FROM audit_events e
        JOIN assets a ON a.id = e.entity_id
        JOIN sources s ON s.id = a.source_id
       WHERE e.entity_type = 'asset'
         AND (e.operation = ${READ} OR e.operation LIKE ${`${EXPORT_PREFIX}%`})
         AND e.occurred_at >= ${since}
         AND a.status <> 'DELETED'
         AND NOT EXISTS (
           SELECT 1 FROM governance_roles r
            WHERE r.role = 'OWNER' AND r.date_out IS NULL
              AND ((r.scope_type = 'ASSET' AND r.scope_id = a.id)
                OR (r.scope_type = 'SOURCE' AND r.scope_id = a.source_id)))
       GROUP BY a.id, a.name, s.id, s.name
       ORDER BY reads DESC, a.name
       LIMIT 10`;

    const refs = person
      ? [person.actorRef, ...person.groupIds.map((id) => `group:${id}`)]
      : [];
    const [owned, stewarded] = person
      ? await Promise.all([
          this.prisma.governanceRole.count({
            where: {
              role: 'OWNER',
              dateOut: null,
              principalRef: person.actorRef,
            },
          }),
          this.prisma.governanceRole.count({
            where: {
              role: 'STEWARD',
              dateOut: null,
              principalRef: { in: refs },
            },
          }),
        ])
      : [0, 0];

    const rows = sources.map((row) => ({
      sourceId: row.source_id,
      name: row.name,
      assets: Number(row.assets),
      owned: Number(row.owned),
      active: Number(row.active),
    }));
    return {
      days: span,
      totals: rows.reduce(
        (sum, row) => ({
          assets: sum.assets + row.assets,
          owned: sum.owned + row.owned,
          active: sum.active + row.active,
        }),
        { assets: 0, owned: 0, active: 0 },
      ),
      sources: rows,
      governFirst: governFirst.map((row) => ({
        assetId: row.asset_id,
        name: row.name,
        sourceId: row.source_id,
        sourceName: row.source_name,
        reads: Number(row.reads),
        readers: Number(row.readers),
      })),
      mine: { owned, stewarded },
    };
  }
}
