import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RunnerStatus } from '@prisma/client';

import type { PrismaService } from '../prisma.service';

/**
 * What every read a running notebook makes has in common: a RUNNING run, a
 * page cap, a keyset cursor, a statement timeout. No call budget — a notebook
 * pages as far as it needs — but nothing is ever returned unpaged.
 */
export const QUERY_MAX_LIMIT = 5000;
export const QUERY_DEFAULT_LIMIT = 1000;
/**
 * Long enough for a cohort over the largest source measured (110k records,
 * 2.8 s with the anti-join), short enough that a bad query cannot hold a
 * connection for the rest of the run. Spelled out again in the SET statement.
 */
export const QUERY_STATEMENT_TIMEOUT = '15s';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RunnerRef = { id: string; status: RunnerStatus; sourceId: string };

/**
 * The run behind a request. Only a RUNNING run may read, so a finished job's
 * credentials cannot be replayed to read the namespace later.
 */
export async function requireRunningRunner(
  prisma: PrismaService,
  runnerId: string,
  verb = 'read',
): Promise<RunnerRef> {
  const runner = await prisma.runner.findUnique({
    where: { id: runnerId },
    select: { id: true, status: true, sourceId: true },
  });
  if (!runner) throw new NotFoundException(`Runner ${runnerId} not found`);
  if (runner.status !== RunnerStatus.RUNNING) {
    throw new ConflictException(
      `The namespace can be ${verb} only while the run is RUNNING (it is ${runner.status}).`,
    );
  }
  return runner;
}

export function raw(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export function parseLimit(value: unknown): number {
  const limit =
    value === undefined || value === null ? QUERY_DEFAULT_LIMIT : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > QUERY_MAX_LIMIT) {
    throw new BadRequestException(
      `limit must be an integer from 1 to ${QUERY_MAX_LIMIT}.`,
    );
  }
  return limit;
}

/**
 * Row ids are uuids, compared as `id > $cursor`: anything else dies in
 * Postgres as 22P02 (a 500), so reject it here as a 400.
 */
export function parseIdCursor(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new BadRequestException(
      'cursor must be the nextCursor of a previous page.',
    );
  }
  return value;
}

/** A list of short strings, or null when the caller did not ask for one. */
export function stringList(
  value: unknown,
  name: string,
  max = 100,
): string[] | null {
  if (value === undefined || value === null) return null;
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((item) => typeof item !== 'string' || item.length > 200)
  ) {
    throw new BadRequestException(
      `${name} must be a list of at most ${max} strings.`,
    );
  }
  return [...new Set(value as string[])];
}

export function upperList(
  value: unknown,
  name: string,
  allowed: readonly string[],
): string[] | null {
  const list = stringList(value, name);
  if (!list) return null;
  const upper = list.map((item) => item.toUpperCase());
  const invalid = upper.filter((item) => !allowed.includes(item));
  if (invalid.length > 0) {
    throw new BadRequestException(
      `${name} is one of ${allowed.join(', ')}; got ${invalid.join(', ')}.`,
    );
  }
  return upper;
}

function isStatementTimeout(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`
      : String(error);
  return text.includes('57014') || /statement timeout/i.test(text);
}

/**
 * One bounded read. `tuning` runs inside the transaction, for a query shape
 * that needs a planner setting (see the asset anti-join).
 */
export async function boundedRead<T>(
  prisma: PrismaService,
  read: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { tuning?: (tx: Prisma.TransactionClient) => Promise<void> } = {},
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // SET takes no bind parameters, hence a literal (see the constant).
        await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
        await options.tuning?.(tx);
        return read(tx);
      },
      // Above the statement timeout, so Postgres reports a slow query as a
      // timeout instead of Prisma closing the transaction first (P2028).
      { timeout: 20_000, maxWait: 5_000 },
    );
  } catch (error) {
    if (isStatementTimeout(error)) {
      throw new BadRequestException(
        `The query ran past ${QUERY_STATEMENT_TIMEOUT}. Narrow it: add filters or lower the limit.`,
      );
    }
    throw error;
  }
}

/** Finding filters shared by the findings read and the assets-with-findings filter. */
export interface FindingFilter {
  detectorType: string[] | null;
  customDetectorKey: string[] | null;
  findingType: string[] | null;
  severity: string[] | null;
  status: string[];
  assertedBySourceId: string[] | null;
  sourceId: string[] | null;
  assetId: string[] | null;
}

const FINDING_STATUSES = ['OPEN', 'FALSE_POSITIVE', 'RESOLVED', 'IGNORED'];
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export function parseFindingFilter(value: unknown): FindingFilter {
  const f = raw(value);
  return {
    detectorType:
      stringList(f.detectorType, 'detectorType')?.map((item) =>
        item.toUpperCase(),
      ) ?? null,
    customDetectorKey: stringList(f.customDetectorKey, 'customDetectorKey'),
    findingType: stringList(f.findingType, 'findingType'),
    severity: upperList(f.severity, 'severity', SEVERITIES),
    // A finding someone ruled on is not "found" any more: OPEN unless asked.
    status: upperList(f.status, 'status', FINDING_STATUSES) ?? ['OPEN'],
    assertedBySourceId: stringList(f.assertedBySourceId, 'assertedBySourceId'),
    sourceId: stringList(f.sourceId, 'sourceId'),
    assetId: stringList(f.assetId, 'assetId'),
  };
}

/** WHERE conditions on `findings f` for a parsed filter. */
export function findingConditions(filter: FindingFilter): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`f.status::text = ANY(${filter.status}::text[])`,
  ];
  if (filter.detectorType) {
    conditions.push(
      Prisma.sql`f.detector_type::text = ANY(${filter.detectorType}::text[])`,
    );
  }
  if (filter.customDetectorKey) {
    conditions.push(
      Prisma.sql`f.custom_detector_key = ANY(${filter.customDetectorKey}::text[])`,
    );
  }
  if (filter.findingType) {
    conditions.push(
      Prisma.sql`f.finding_type = ANY(${filter.findingType}::text[])`,
    );
  }
  if (filter.severity) {
    conditions.push(
      Prisma.sql`f.severity::text = ANY(${filter.severity}::text[])`,
    );
  }
  if (filter.assertedBySourceId) {
    conditions.push(
      Prisma.sql`f.asserted_by_source_id = ANY(${filter.assertedBySourceId}::text[])`,
    );
  }
  if (filter.sourceId) {
    conditions.push(Prisma.sql`f.source_id = ANY(${filter.sourceId}::text[])`);
  }
  if (filter.assetId) {
    conditions.push(Prisma.sql`f.asset_id = ANY(${filter.assetId}::text[])`);
  }
  return conditions;
}
