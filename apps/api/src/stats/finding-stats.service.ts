import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

/**
 * Filter keys the rollup grain can answer without touching `findings`.
 *
 * `status` handling is explicit rather than derived from an `includeResolved`
 * flag on purpose: the two callers disagree about what "not resolved" means.
 * The discovery overview counts only OPEN findings, while the findings search
 * counts everything except RESOLVED (so FALSE_POSITIVE and IGNORED are still
 * in). Folding both into one boolean here silently under-counted the search
 * total by every ignored and false-positive finding.
 */
export interface RollupFilter {
  sourceId?: string[];
  detectorType?: string[];
  severity?: string[];
  /** Exact statuses to include. Wins over {@link excludeStatuses}. */
  status?: string[];
  /** Statuses to exclude when `status` is not given. */
  excludeStatuses?: string[];
}

export interface RollupSeverityStatusRow {
  severity: string;
  status: string;
  count: number;
}

export interface RollupActivity {
  today: number;
  week: number;
  month: number;
}

export interface RollupTopAsset {
  assetId: string;
  totalFindings: number;
  lastDetectedAt: Date | null;
  severityCounts: Record<string, number>;
}

export interface RollupTimelinePoint {
  day: Date;
  severity: string;
  status: string;
  count: number;
}

export interface FindingStatsFreshness {
  refreshedAt: Date | null;
  durationMs: number | null;
  totalFindings: number;
  isBuilt: boolean;
}

const SINGLETON = 'singleton';

/**
 * Builds and reads the finding rollups.
 *
 * The build is deliberately expressed as raw SQL rather than a read-then-write
 * loop: the whole point is that the aggregation never leaves Postgres. An
 * earlier version of the charts endpoint streamed 3.18M rows into Node purely
 * to increment counters, which is the mistake this service exists to avoid
 * repeating at a larger scale.
 */
@Injectable()
export class FindingStatsService {
  private readonly logger = new Logger(FindingStatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Build ─────────────────────────────────────────────────────────────────

  /**
   * Recompute every day. Costs one full pass over `findings` (19.5 s measured
   * on 5.17M rows), so it is reserved for the first build, an explicit user
   * refresh, and mutations whose affected days cannot be determined cheaply.
   */
  async rebuildAll(): Promise<number> {
    const started = Date.now();

    await this.prisma.$executeRaw`DELETE FROM finding_stats_daily`;
    await this.prisma.$executeRaw`DELETE FROM finding_stats_asset_daily`;
    await this.prisma.$executeRaw`
      INSERT INTO finding_stats_daily (day, severity, status, detector_type, source_id, count)
      SELECT detected_at::date, severity, status, detector_type, source_id, COUNT(*)::int
      FROM findings
      GROUP BY 1, 2, 3, 4, 5`;
    await this.prisma.$executeRaw`
      INSERT INTO finding_stats_asset_daily (day, asset_id, severity, status, count, last_detected_at)
      SELECT detected_at::date, asset_id, severity, status, COUNT(*)::int, MAX(detected_at)
      FROM findings
      GROUP BY 1, 2, 3, 4`;
    await this.prisma.$executeRaw`DELETE FROM finding_stats_dirty_days`;

    const total = await this.markBuilt(started);
    this.logger.log(
      `Rebuilt finding rollups in ${Date.now() - started} ms (${total} findings).`,
    );
    return total;
  }

  /**
   * Recompute only the days currently marked dirty.
   *
   * The dirty rows are claimed with `DELETE ... RETURNING` so that a write
   * landing mid-refresh re-marks its day and is picked up by the next run
   * rather than being silently swallowed by this one.
   */
  async refreshDirtyDays(): Promise<{ days: number; total: number }> {
    const started = Date.now();
    const claimed = await this.prisma.$queryRaw<Array<{ day: Date }>>`
      DELETE FROM finding_stats_dirty_days RETURNING day`;

    if (claimed.length === 0) {
      // Nothing to recompute. Deliberately does NOT stamp the state: marking a
      // rollup "refreshed" for doing no work would advertise an empty or stale
      // one as current, and on a workspace that has never built would flip
      // isBuilt with zero rows in the table — the dashboard would then report
      // no findings instead of falling back to the live queries.
      return { days: 0, total: 0 };
    }

    const days = claimed.map((row) => row.day);
    await this.prisma.$executeRaw`
      DELETE FROM finding_stats_daily WHERE day = ANY(${days}::date[])`;
    await this.prisma.$executeRaw`
      DELETE FROM finding_stats_asset_daily WHERE day = ANY(${days}::date[])`;

    // One half-open range per day, never an expression over the column.
    //
    // `WHERE detected_at::date = ANY(...)` reads naturally and is a trap: any
    // function applied to the column makes the predicate unsargable, so
    // Postgres cannot use findings_detected_at_idx and sequentially scans the
    // whole table for what should be a single day. Measured on the 5.17M-row
    // workspace, that mistake cost 50 s and 63 s for the two statements —
    // slower than the full rebuild it was meant to avoid.
    for (const day of days) {
      const start = new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
      );
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);

      await this.prisma.$executeRaw`
        INSERT INTO finding_stats_daily (day, severity, status, detector_type, source_id, count)
        SELECT detected_at::date, severity, status, detector_type, source_id, COUNT(*)::int
        FROM findings
        WHERE detected_at >= ${start} AND detected_at < ${end}
        GROUP BY 1, 2, 3, 4, 5`;
      await this.prisma.$executeRaw`
        INSERT INTO finding_stats_asset_daily (day, asset_id, severity, status, count, last_detected_at)
        SELECT detected_at::date, asset_id, severity, status, COUNT(*)::int, MAX(detected_at)
        FROM findings
        WHERE detected_at >= ${start} AND detected_at < ${end}
        GROUP BY 1, 2, 3, 4`;
    }

    const total = await this.markBuilt(started);
    this.logger.log(
      `Refreshed ${days.length} finding rollup day(s) in ${Date.now() - started} ms.`,
    );
    return { days: days.length, total };
  }

  /**
   * Mark the days covering `dates` as needing recomputation. Cheap enough
   * (`ON CONFLICT DO NOTHING` on a table of at most a few rows) to call from
   * any write path, including per-batch during ingest.
   */
  async markDaysDirty(dates: Array<Date | null | undefined>): Promise<void> {
    const days = [
      ...new Set(
        dates
          .filter((date): date is Date => date instanceof Date)
          .map((date) => date.toISOString().slice(0, 10)),
      ),
    ];
    if (days.length === 0) return;
    await this.prisma.$executeRaw`
      INSERT INTO finding_stats_dirty_days (day)
      SELECT unnest(${days}::date[])
      ON CONFLICT (day) DO NOTHING`;
  }

  private async markBuilt(started: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(SUM(count), 0)::bigint AS total FROM finding_stats_daily`;
    const total = Number(rows[0]?.total ?? 0);
    await this.prisma.$executeRaw`
      INSERT INTO finding_stats_state (id, refreshed_at, duration_ms, total_findings, is_built, updated_at)
      VALUES (${SINGLETON}, NOW(), ${Date.now() - started}, ${total}, true, NOW())
      ON CONFLICT (id) DO UPDATE SET
        refreshed_at = EXCLUDED.refreshed_at,
        duration_ms = EXCLUDED.duration_ms,
        total_findings = EXCLUDED.total_findings,
        is_built = true,
        updated_at = NOW()`;
    return total;
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async getFreshness(): Promise<FindingStatsFreshness> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        refreshed_at: Date | null;
        duration_ms: number | null;
        total_findings: number;
        is_built: boolean;
      }>
    >`SELECT refreshed_at, duration_ms, total_findings, is_built
      FROM finding_stats_state WHERE id = ${SINGLETON}`;
    const row = rows[0];
    return {
      refreshedAt: row?.refreshed_at ?? null,
      durationMs: row?.duration_ms ?? null,
      totalFindings: Number(row?.total_findings ?? 0),
      isBuilt: row?.is_built ?? false,
    };
  }

  /** True when the rollup has been built at least once and can be trusted. */
  async isUsable(): Promise<boolean> {
    return (await this.getFreshness()).isBuilt;
  }

  /**
   * Whether `filters` only constrains columns present in the rollup grain.
   * Anything else (free-text search, asset, custom detector, date bounds other
   * than the window) has to run live.
   */
  canServe(filters: Record<string, unknown> | undefined): boolean {
    if (!filters) return true;
    const servable = new Set([
      'sourceId',
      'detectorType',
      'severity',
      'status',
      'includeResolved',
    ]);
    return Object.entries(filters).every(([key, value]) => {
      if (value === undefined || value === null) return true;
      if (Array.isArray(value) && value.length === 0) return true;
      return servable.has(key);
    });
  }

  private whereFrom(filters: RollupFilter | undefined, since?: Date) {
    const clauses: Prisma.Sql[] = [];
    if (since) clauses.push(Prisma.sql`day >= ${since}::date`);
    if (filters?.sourceId?.length) {
      clauses.push(Prisma.sql`source_id = ANY(${filters.sourceId}::text[])`);
    }
    if (filters?.detectorType?.length) {
      clauses.push(
        Prisma.sql`detector_type::text = ANY(${filters.detectorType}::text[])`,
      );
    }
    if (filters?.severity?.length) {
      clauses.push(
        Prisma.sql`severity::text = ANY(${filters.severity}::text[])`,
      );
    }
    if (filters?.status?.length) {
      clauses.push(Prisma.sql`status::text = ANY(${filters.status}::text[])`);
    } else if (filters?.excludeStatuses?.length) {
      clauses.push(
        Prisma.sql`NOT (status::text = ANY(${filters.excludeStatuses}::text[]))`,
      );
    }
    return clauses.length
      ? Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}`
      : Prisma.empty;
  }

  async severityStatusTotals(
    since: Date,
    filters?: RollupFilter,
  ): Promise<RollupSeverityStatusRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ severity: string; status: string; count: bigint }>
    >(Prisma.sql`
      SELECT severity::text AS severity, status::text AS status, SUM(count)::bigint AS count
      FROM finding_stats_daily
      ${this.whereFrom(filters, since)}
      GROUP BY 1, 2`);
    return rows.map((row) => ({
      severity: row.severity,
      status: row.status,
      count: Number(row.count),
    }));
  }

  /**
   * today / week / month in a single pass.
   *
   * These were three separate `count(*)` statements costing 11.2 s combined,
   * each scanning the same rows for a different boundary. Postgres computes all
   * three from one scan with `FILTER`, and against the rollup that scan is 739
   * rows.
   */
  async activity(
    todayStart: Date,
    weekStart: Date,
    monthStart: Date,
    filters?: RollupFilter,
  ): Promise<RollupActivity> {
    const rows = await this.prisma.$queryRaw<
      Array<{ today: bigint | null; week: bigint | null; month: bigint | null }>
    >(Prisma.sql`
      SELECT
        SUM(count) FILTER (WHERE day >= ${todayStart}::date)::bigint AS today,
        SUM(count) FILTER (WHERE day >= ${weekStart}::date)::bigint AS week,
        SUM(count) FILTER (WHERE day >= ${monthStart}::date)::bigint AS month
      FROM finding_stats_daily
      ${this.whereFrom(filters)}`);
    const row = rows[0];
    return {
      today: Number(row?.today ?? 0),
      week: Number(row?.week ?? 0),
      month: Number(row?.month ?? 0),
    };
  }

  async topAssets(since: Date, limit: number): Promise<RollupTopAsset[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        asset_id: string;
        total: bigint;
        last_at: Date | null;
        severity: string;
        sev_count: bigint;
      }>
    >(Prisma.sql`
      WITH ranked AS (
        SELECT asset_id, SUM(count)::bigint AS total, MAX(last_detected_at) AS last_at
        FROM finding_stats_asset_daily
        WHERE day >= ${since}::date AND status = 'OPEN'
        GROUP BY asset_id
        ORDER BY total DESC
        LIMIT ${limit}
      )
      SELECT r.asset_id, r.total, r.last_at,
             s.severity::text AS severity, SUM(s.count)::bigint AS sev_count
      FROM ranked r
      JOIN finding_stats_asset_daily s
        ON s.asset_id = r.asset_id AND s.day >= ${since}::date AND s.status = 'OPEN'
      GROUP BY r.asset_id, r.total, r.last_at, s.severity`);

    const byAsset = new Map<string, RollupTopAsset>();
    for (const row of rows) {
      const entry = byAsset.get(row.asset_id) ?? {
        assetId: row.asset_id,
        totalFindings: Number(row.total),
        lastDetectedAt: row.last_at,
        severityCounts: {},
      };
      entry.severityCounts[row.severity] = Number(row.sev_count);
      byAsset.set(row.asset_id, entry);
    }
    return [...byAsset.values()].sort(
      (a, b) => b.totalFindings - a.totalFindings,
    );
  }

  async timeline(
    since: Date,
    filters?: RollupFilter,
  ): Promise<RollupTimelinePoint[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; severity: string; status: string; count: bigint }>
    >(Prisma.sql`
      SELECT day, severity::text AS severity, status::text AS status, SUM(count)::bigint AS count
      FROM finding_stats_daily
      ${this.whereFrom(filters, since)}
      GROUP BY 1, 2, 3
      ORDER BY 1`);
    return rows.map((row) => ({
      day: row.day,
      severity: row.severity,
      status: row.status,
      count: Number(row.count),
    }));
  }

  /** Exact total for a rollup-servable filter, or null when it cannot serve. */
  async totalFor(filters?: RollupFilter): Promise<number | null> {
    if (!(await this.isUsable())) return null;
    const rows = await this.prisma.$queryRaw<Array<{ total: bigint | null }>>(
      Prisma.sql`
        SELECT SUM(count)::bigint AS total
        FROM finding_stats_daily
        ${this.whereFrom(filters)}`,
    );
    return Number(rows[0]?.total ?? 0);
  }
}
