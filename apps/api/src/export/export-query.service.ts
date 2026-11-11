import { Injectable } from '@nestjs/common';
import type { CsvStreamColumn } from './pg-stream.service';
import type {
  ExportAssetsQueryDto,
  ExportFindingsQueryDto,
  ExportRunnerAssetsQueryDto,
} from '../dto/export-query.dto';
import {
  ASSET_TERMS_SQL,
  FINDING_TERMS_SQL,
} from '../semantic/export-terms-sql';

export interface ExportQuery {
  sql: string;
  params: unknown[];
  columns: CsvStreamColumn[];
  filename: string;
}

/** Reusable SELECT/FROM/WHERE pieces behind the CSV builders. */
interface QueryParts {
  b: SqlParams;
  selectSql: string;
  fromSql: string;
  whereClauses: string[];
}

/**
 * Builds parameterized SQL (joins + WHERE) for the CSV exports.
 *
 * The existing search services return `Prisma.*WhereInput` objects which cannot
 * feed pg-query-stream, so the WHERE clauses are rebuilt here as parameterized
 * SQL — mirroring the filter semantics of the POST search DTOs. Array filters
 * expand to `column IN ($1::"Enum", ...)`, JSON columns are selected as `::text`,
 * and free-text search reuses the ILIKE-OR + full-text-search shape from
 * findings.service.ts.
 */
@Injectable()
export class ExportQueryService {
  private dateStamp(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // ── Findings ───────────────────────────────────────────────────────────────

  private findingsParts(filters: ExportFindingsQueryDto): QueryParts {
    const b = new SqlParams();
    const where: string[] = [];

    pushEnumArray(
      where,
      b,
      'f.detector_type',
      'DetectorType',
      filters.detectorType,
    );
    pushEnumArray(where, b, 'f.severity', 'Severity', filters.severity);
    pushEnumArray(where, b, 'f.status', 'FindingStatus', filters.status);
    pushTextArray(where, b, 'f.source_id', filters.sourceId);
    pushTextArray(where, b, 'f.custom_detector_key', filters.customDetectorKey);
    pushTextArray(where, b, 'f.finding_type', filters.findingType);
    pushTextArray(where, b, 'f.category', filters.category);

    if (
      !toBool(filters.includeResolved) &&
      !normalizeArray(filters.status).length
    ) {
      where.push(`f.status <> 'RESOLVED'`);
    }

    const search =
      typeof filters.search === 'string' ? filters.search.trim() : undefined;
    if (search) {
      where.push(this.findingSearchClause(b, search));
    }

    return {
      b,
      selectSql: FINDINGS_SELECT,
      fromSql: `FROM findings f
        JOIN assets a ON f.asset_id = a.id
        LEFT JOIN sources s ON f.source_id = s.id`,
      whereClauses: where,
    };
  }

  buildFindingsQuery(filters: ExportFindingsQueryDto): ExportQuery {
    const parts = this.findingsParts(filters);
    return {
      sql: `SELECT ${parts.selectSql} ${parts.fromSql} ${whereSql(parts.whereClauses)}
        ORDER BY f.last_detected_at DESC NULLS LAST`,
      params: parts.b.values,
      filename: `findings-${this.dateStamp()}.csv`,
      columns: FINDINGS_COLUMNS,
    };
  }

  // ── Assets (one row per asset-finding) ───────────────────────────────────────

  private assetsParts(filters: ExportAssetsQueryDto): QueryParts {
    const b = new SqlParams();
    const assetWhere: string[] = [];

    pushEnumArray(
      assetWhere,
      b,
      'a.status',
      'AssetStatus',
      filters.asset_status,
    );
    pushEnumArray(
      assetWhere,
      b,
      'a.source_type',
      'AssetType',
      filters.asset_sourceType,
    );
    if (filters.asset_sourceId) {
      assetWhere.push(`a.source_id = ${b.add(filters.asset_sourceId)}`);
    }
    const assetSearch =
      typeof filters.asset_search === 'string'
        ? filters.asset_search.trim()
        : undefined;
    if (assetSearch) {
      const p = b.add(`%${assetSearch}%`);
      assetWhere.push(
        `(a.name ILIKE ${p} OR a.external_url ILIKE ${p} OR a.hash ILIKE ${p})`,
      );
    }

    const excludeFindings = toBool(filters.excludeFindings);
    const includeWithout = toBool(filters.includeAssetsWithoutFindings);

    const findingConds: string[] = [];
    if (!excludeFindings) {
      pushEnumArray(
        findingConds,
        b,
        'f.detector_type',
        'DetectorType',
        filters.finding_detectorType,
      );
      pushEnumArray(
        findingConds,
        b,
        'f.severity',
        'Severity',
        filters.finding_severity,
      );
      pushEnumArray(
        findingConds,
        b,
        'f.status',
        'FindingStatus',
        filters.finding_status,
      );
      if (
        !toBool(filters.finding_includeResolved) &&
        !normalizeArray(filters.finding_status).length
      ) {
        findingConds.push(`f.status <> 'RESOLVED'`);
      }
    }

    let findingsJoin: string;
    let findingSelect: string;
    if (excludeFindings) {
      // No findings join — one row per asset, finding columns null.
      findingsJoin = '';
      findingSelect = `
        NULL::text AS finding_type,
        NULL::text AS detector_type,
        NULL::text AS finding_severity,
        NULL::text AS finding_status,
        NULL::numeric AS confidence,
        NULL::text AS matched_content`;
    } else {
      const onConds = ['f.asset_id = a.id', ...findingConds].join(' AND ');
      // LEFT JOIN keeps assets without matching findings (null finding columns);
      // INNER JOIN drops them.
      findingsJoin = `${includeWithout ? 'LEFT JOIN' : 'JOIN'} findings f ON ${onConds}`;
      findingSelect = `
        f.finding_type AS finding_type,
        f.detector_type AS detector_type,
        f.severity AS finding_severity,
        f.status AS finding_status,
        f.confidence AS confidence,
        f.matched_content AS matched_content`;
    }

    return {
      b,
      selectSql: `${ASSETS_SELECT}, ${findingSelect}`,
      fromSql: `FROM assets a
        ${findingsJoin}
        LEFT JOIN sources s ON a.source_id = s.id`,
      whereClauses: assetWhere,
    };
  }

  buildAssetsQuery(filters: ExportAssetsQueryDto): ExportQuery {
    const parts = this.assetsParts(filters);
    return {
      sql: `SELECT ${parts.selectSql} ${parts.fromSql} ${whereSql(parts.whereClauses)}
        ORDER BY a.last_scanned_at DESC NULLS LAST`,
      params: parts.b.values,
      filename: `assets-${this.dateStamp()}.csv`,
      columns: ASSETS_COLUMNS,
    };
  }

  // ── Runner assets ────────────────────────────────────────────────────────────

  private runnerAssetsParts(filters: ExportRunnerAssetsQueryDto): QueryParts {
    const b = new SqlParams();
    const where: string[] = [];

    where.push(`ra.runner_id = ${b.add(filters.runnerId ?? '')}`);
    pushEnumArray(where, b, 'ra.status', 'RunnerAssetStatus', filters.status);

    const search =
      typeof filters.search === 'string' ? filters.search.trim() : undefined;
    if (search) {
      const p = b.add(`%${search}%`);
      where.push(
        `(a.name ILIKE ${p} OR ra.asset_hash ILIKE ${p} OR ra.error_message ILIKE ${p})`,
      );
    }

    return {
      b,
      selectSql: RUNNER_ASSETS_SELECT,
      fromSql: `FROM runner_assets ra
        LEFT JOIN assets a ON a.runner_id = ra.runner_id AND a.hash = ra.asset_hash`,
      whereClauses: where,
    };
  }

  buildRunnerAssetsQuery(filters: ExportRunnerAssetsQueryDto): ExportQuery {
    const parts = this.runnerAssetsParts(filters);
    return {
      sql: `SELECT ${parts.selectSql} ${parts.fromSql} ${whereSql(parts.whereClauses)}
        ORDER BY ra.created_at DESC`,
      params: parts.b.values,
      filename: `runner-assets-${this.dateStamp()}.csv`,
      columns: RUNNER_ASSETS_COLUMNS,
    };
  }

  /** Mirrors the ILIKE-OR + FTS search shape used by findings.service.ts. */
  private findingSearchClause(b: SqlParams, search: string): string {
    const like = b.add(`%${search}%`);
    const term = b.add(search);
    return `(
      f.id ILIKE ${like}
      OR f.asset_id ILIKE ${like}
      OR f.source_id ILIKE ${like}
      OR f.finding_type ILIKE ${like}
      OR f.custom_detector_key ILIKE ${like}
      OR f.custom_detector_name ILIKE ${like}
      OR f.category ILIKE ${like}
      OR f.detection_identity ILIKE ${like}
      OR a.name ILIKE ${like}
      OR a.external_url ILIKE ${like}
      OR a.hash ILIKE ${like}
      OR s.name ILIKE ${like}
      OR to_tsvector('simple', f.matched_content) @@ plainto_tsquery('simple', ${term})
    )`;
  }
}

// ── Column definitions (shared by CSV headers and JSON keys) ───────────────────

const FINDINGS_SELECT = `
  f.category AS category,
  f.finding_type AS finding_type,
  a.name AS asset_name,
  a.external_url AS asset_url,
  s.name AS source_name,
  f.detector_type AS detector_type,
  f.severity AS severity,
  f.status AS status,
  f.confidence AS confidence,
  f.matched_content AS matched_content,
  f.redacted_content AS redacted_content,
  f.first_detected_at AS first_detected_at,
  f.last_detected_at AS last_detected_at,
  f.metadata::text AS metadata,
  ${FINDING_TERMS_SQL} AS terms`;

const FINDINGS_COLUMNS: CsvStreamColumn[] = [
  { key: 'category', header: 'Category' },
  { key: 'finding_type', header: 'Finding' },
  { key: 'asset_name', header: 'Asset' },
  { key: 'asset_url', header: 'Asset URL' },
  { key: 'source_name', header: 'Source' },
  { key: 'detector_type', header: 'Detector Type' },
  { key: 'severity', header: 'Severity' },
  { key: 'status', header: 'Status' },
  { key: 'confidence', header: 'Confidence' },
  { key: 'matched_content', header: 'Matched Content' },
  { key: 'redacted_content', header: 'Redacted Content' },
  { key: 'first_detected_at', header: 'First Detected' },
  { key: 'last_detected_at', header: 'Last Detected' },
  { key: 'metadata', header: 'Metadata' },
  { key: 'terms', header: 'Terms' },
];

const ASSETS_SELECT = `
  a.name AS asset_name,
  a.external_url AS asset_url,
  a.asset_type AS asset_type,
  a.source_type AS source_type,
  s.name AS source_name,
  a.status AS asset_status,
  a.last_scanned_at AS last_scanned_at,
  a.metadata::text AS metadata,
  ${ASSET_TERMS_SQL} AS terms`;

const ASSETS_COLUMNS: CsvStreamColumn[] = [
  { key: 'asset_name', header: 'Asset' },
  { key: 'asset_url', header: 'Asset URL' },
  { key: 'asset_type', header: 'Asset Type' },
  { key: 'source_type', header: 'Source Type' },
  { key: 'source_name', header: 'Source' },
  { key: 'asset_status', header: 'Asset Status' },
  { key: 'last_scanned_at', header: 'Last Scanned' },
  { key: 'finding_type', header: 'Finding' },
  { key: 'detector_type', header: 'Detector Type' },
  { key: 'finding_severity', header: 'Severity' },
  { key: 'finding_status', header: 'Finding Status' },
  { key: 'confidence', header: 'Confidence' },
  { key: 'matched_content', header: 'Matched Content' },
  { key: 'metadata', header: 'Metadata' },
  { key: 'terms', header: 'Terms' },
];

const RUNNER_ASSETS_SELECT = `
  a.name AS asset_name,
  ra.asset_hash AS asset_hash,
  a.asset_type AS asset_type,
  ra.status AS status,
  ra.findings_total AS findings_total,
  ra.started_at AS started_at,
  ra.completed_at AS completed_at,
  ra.error_message AS error_message,
  COALESCE(ra.metadata, a.metadata)::text AS metadata`;

const RUNNER_ASSETS_COLUMNS: CsvStreamColumn[] = [
  { key: 'asset_name', header: 'Asset' },
  { key: 'asset_hash', header: 'Asset Hash' },
  { key: 'asset_type', header: 'Type' },
  { key: 'status', header: 'Processing Status' },
  { key: 'findings_total', header: 'Findings Total' },
  { key: 'started_at', header: 'Started' },
  { key: 'completed_at', header: 'Completed' },
  { key: 'error_message', header: 'Error' },
  { key: 'metadata', header: 'Metadata' },
];

// ── SQL helpers ────────────────────────────────────────────────────────────────

/** Tracks ordered query params and returns `$N` placeholders. */
class SqlParams {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function whereSql(clauses: string[]): string {
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

// This app registers no global ValidationPipe, so class-transformer decorators on
// the query DTOs do not run at request time (they exist only for OpenAPI docs).
// Query params therefore arrive as raw strings (single) or string[] (repeated)
// and booleans as strings — so we normalize defensively here, mirroring
// findings.service.ts `normalizeFilterValues`.
function normalizeArray(value: unknown, uppercase = false): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const values = raw
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) => (uppercase ? item.toUpperCase() : item));
  return Array.from(new Set(values));
}

function toBool(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

// Expand array filters into `column IN ($1::"Enum", $2::"Enum", ...)` — one
// placeholder per value with an individual cast. This mirrors the proven pattern
// in cli-runner.service.ts and avoids Postgres array-literal encoding issues.
function pushEnumArray(
  where: string[],
  b: SqlParams,
  column: string,
  enumType: string,
  values?: unknown,
): void {
  const arr = normalizeArray(values, true);
  if (arr.length) {
    const placeholders = arr.map((v) => `${b.add(v)}::"${enumType}"`);
    where.push(`${column} IN (${placeholders.join(', ')})`);
  }
}

function pushTextArray(
  where: string[],
  b: SqlParams,
  column: string,
  values?: unknown,
): void {
  const arr = normalizeArray(values, false);
  if (arr.length) {
    const placeholders = arr.map((v) => b.add(v));
    where.push(`${column} IN (${placeholders.join(', ')})`);
  }
}
