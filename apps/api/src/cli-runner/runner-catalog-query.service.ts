import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';
import {
  boundedRead,
  findingConditions,
  parseFindingFilter,
  parseIdCursor,
  parseLimit,
  raw,
  requireRunningRunner,
  stringList,
  upperList,
} from './runner-query-common';

export interface RunnerSourceItem {
  id: string;
  name: string;
  type: string;
  description: string | null;
  /** Status of the source's latest run, or null when it never ran. */
  runnerStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunnerFindingItem {
  id: string;
  assetId: string;
  sourceId: string;
  detectorType: string;
  customDetectorKey: string | null;
  customDetectorName: string | null;
  findingType: string;
  category: string;
  severity: string;
  status: string;
  confidence: number;
  /** The redacted text when there is one; never the raw match. */
  content: string | null;
  metadata: Record<string, unknown> | null;
  assertedBySourceId: string | null;
  firstDetectedAt: string | null;
  lastDetectedAt: string | null;
}

export interface RunnerDetectorItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  type: string;
  isActive: boolean;
  version: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const RUNNER_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'WARNING',
  'ERROR',
  'STOPPED',
];

/**
 * The rest of what a running notebook may read of its namespace: which
 * sources exist, which findings were raised, which detectors raised them.
 *
 * Every field is selected by name. A source's configuration (credentials,
 * notebook code, variables) and a detector's pipeline (code, secrets) are not
 * on any row here and cannot be added by a filter; that is the whole of the
 * rule that a notebook never reads another source's secrets.
 */
@Injectable()
export class RunnerCatalogQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async sources(
    runnerId: string,
    body: unknown,
  ): Promise<Page<RunnerSourceItem>> {
    const input = raw(body);
    await requireRunningRunner(this.prisma, runnerId);
    const limit = parseLimit(input.limit);
    const cursor = parseIdCursor(input.cursor);
    const types = stringList(input.type, 'type')?.map((t) => t.toUpperCase());
    const statuses = upperList(input.status, 'status', RUNNER_STATUSES);
    let search: string | null = null;
    if (input.search !== undefined && input.search !== null) {
      if (typeof input.search !== 'string' || input.search.length > 200) {
        throw new BadRequestException(
          'search must be text of at most 200 characters.',
        );
      }
      search = input.search.trim() || null;
    }

    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (cursor) conditions.push(Prisma.sql`s.id > ${cursor}`);
    if (types?.length)
      conditions.push(Prisma.sql`s.type::text = ANY(${types}::text[])`);
    if (search) {
      conditions.push(
        Prisma.sql`s.name ILIKE ${'%' + search.replace(/[\\%_]/g, (c) => `\\${c}`) + '%'}`,
      );
    }
    if (statuses?.length) {
      conditions.push(Prisma.sql`lr.status::text = ANY(${statuses}::text[])`);
    }

    const rows = await boundedRead(
      this.prisma,
      (tx) =>
        tx.$queryRaw<
          Array<
            Omit<RunnerSourceItem, 'createdAt' | 'updatedAt'> & {
              createdAt: Date;
              updatedAt: Date;
            }
          >
        >`
        SELECT s.id, s.name, s.type::text AS type, s.description,
               lr.status::text AS "runnerStatus",
               s.created_at AS "createdAt", s.updated_at AS "updatedAt"
        FROM sources s
        LEFT JOIN LATERAL (
          SELECT r.status FROM runners r
          WHERE r.source_id = s.id ORDER BY r.started_at DESC NULLS LAST LIMIT 1
        ) lr ON TRUE
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY s.id
        LIMIT ${limit + 1}
      `,
    );
    return pageOf(rows, limit, (row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async findings(
    runnerId: string,
    body: unknown,
  ): Promise<Page<RunnerFindingItem>> {
    const input = raw(body);
    await requireRunningRunner(this.prisma, runnerId);
    const limit = parseLimit(input.limit);
    const cursor = parseIdCursor(input.cursor);
    const filter = parseFindingFilter(input);
    const conditions = findingConditions(filter);
    if (cursor) conditions.push(Prisma.sql`f.id > ${cursor}`);

    const rows = await boundedRead(
      this.prisma,
      (tx) =>
        tx.$queryRaw<
          Array<
            Omit<
              RunnerFindingItem,
              'firstDetectedAt' | 'lastDetectedAt' | 'confidence'
            > & {
              confidence: Prisma.Decimal;
              firstDetectedAt: Date | null;
              lastDetectedAt: Date | null;
            }
          >
        >`
        SELECT f.id, f.asset_id AS "assetId", f.source_id AS "sourceId",
               f.detector_type::text AS "detectorType",
               f.custom_detector_key AS "customDetectorKey",
               f.custom_detector_name AS "customDetectorName",
               f.finding_type AS "findingType", f.category,
               f.severity::text AS severity, f.status::text AS status,
               f.confidence, f.redacted_content AS content, f.metadata,
               f.asserted_by_source_id AS "assertedBySourceId",
               f.first_detected_at AS "firstDetectedAt",
               f.last_detected_at AS "lastDetectedAt"
        FROM findings f
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY f.id
        LIMIT ${limit + 1}
      `,
    );
    return pageOf(rows, limit, (row) => ({
      ...row,
      confidence: Number(row.confidence),
      firstDetectedAt: row.firstDetectedAt?.toISOString() ?? null,
      lastDetectedAt: row.lastDetectedAt?.toISOString() ?? null,
    }));
  }

  async detectors(
    runnerId: string,
    body: unknown,
  ): Promise<Page<RunnerDetectorItem>> {
    const input = raw(body);
    await requireRunningRunner(this.prisma, runnerId);
    const limit = parseLimit(input.limit);
    const cursor = parseIdCursor(input.cursor);
    const types = stringList(input.type, 'type')?.map((t) => t.toUpperCase());
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (cursor) conditions.push(Prisma.sql`d.id > ${cursor}`);
    if (types?.length) {
      conditions.push(
        Prisma.sql`upper(coalesce(d.pipeline_schema->>'type', 'GLINER2')) = ANY(${types}::text[])`,
      );
    }
    if (input.includeInactive !== true)
      conditions.push(Prisma.sql`d.is_active`);

    // The pipeline schema is read for its type only; it never leaves the query.
    const rows = await boundedRead(
      this.prisma,
      (tx) =>
        tx.$queryRaw<RunnerDetectorItem[]>`
        SELECT d.id, d.key, d.name, d.description,
               upper(coalesce(d.pipeline_schema->>'type', 'GLINER2')) AS type,
               d.is_active AS "isActive", d.version
        FROM custom_detectors d
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY d.id
        LIMIT ${limit + 1}
      `,
    );
    return pageOf(rows, limit, (row) => row);
  }
}

function pageOf<R extends { id: string }, T>(
  rows: R[],
  limit: number,
  shape: (row: R) => T,
): Page<T> {
  const page = rows.slice(0, limit);
  return {
    items: page.map(shape),
    nextCursor:
      rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}
