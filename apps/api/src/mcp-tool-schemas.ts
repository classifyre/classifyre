/**
 * Reusable, richly-described zod shapes for MCP tool inputs whose filter/page
 * arguments would otherwise be opaque `object` blobs. Keeping them here (rather
 * than inline in the factory) makes the search tools self-documenting for MCP
 * clients and AI agents — every field carries a description that flows into
 * `tools/list` and the settings UI. Field names and enum values mirror the real
 * request DTOs the services consume; do not drift from them.
 */
import * as z from 'zod';

const severityEnum = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
const findingStatusEnum = z.enum([
  'OPEN',
  'FALSE_POSITIVE',
  'RESOLVED',
  'IGNORED',
]);
const detectorTypeEnum = z.enum([
  'SECRETS',
  'PII',
  'YARA',
  'BROKEN_LINKS',
  'CODE_SECURITY',
  'CUSTOM',
]);
const runnerStatusEnum = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'WARNING',
  'ERROR',
]);
const triggerTypeEnum = z.enum([
  'MANUAL',
  'SCHEDULED',
  'WEBHOOK',
  'API',
  'AUTOPILOT',
]);
const assetStatusEnum = z.enum(['NEW', 'UPDATED', 'UNCHANGED', 'DELETED']);
const sortOrderEnum = z.enum(['ASC', 'DESC']);

const isoDate = (context: string) =>
  z
    .string()
    .optional()
    .describe(`ISO-8601 timestamp. ${context}`);

// ── Findings ────────────────────────────────────────────────────────────────

export const searchFindingsFilters = z
  .object({
    search: z
      .string()
      .max(200)
      .optional()
      .describe(
        'Case-insensitive text search across finding fields and related asset/source names.',
      ),
    sourceId: z
      .array(z.string())
      .optional()
      .describe('Restrict to these source UUIDs.'),
    assetId: z
      .array(z.string())
      .optional()
      .describe('Restrict to these asset UUIDs.'),
    runnerId: z
      .array(z.string())
      .optional()
      .describe('Restrict to findings produced by these run (runner) UUIDs.'),
    detectorType: z
      .array(detectorTypeEnum)
      .optional()
      .describe(
        'Restrict to these built-in detector types. Use CUSTOM for custom detectors (optionally narrow with customDetectorKey).',
      ),
    customDetectorKey: z
      .array(z.string())
      .optional()
      .describe('Restrict to findings from these custom detector keys.'),
    findingType: z
      .array(z.string())
      .optional()
      .describe(
        'Restrict to these finding type identifiers (e.g. specific secret or PII types).',
      ),
    category: z
      .array(z.string())
      .optional()
      .describe('Restrict to these finding categories.'),
    severity: z
      .array(severityEnum)
      .optional()
      .describe('Restrict to these severities.'),
    status: z
      .array(findingStatusEnum)
      .optional()
      .describe(
        'Restrict to these statuses. RESOLVED/IGNORED are excluded by default unless includeResolved is true.',
      ),
    includeResolved: z
      .boolean()
      .optional()
      .describe('Include RESOLVED and IGNORED findings. Defaults to false.'),
    firstDetectedAfter: isoDate('Only findings first detected at or after this.'),
    lastDetectedBefore: isoDate('Only findings last detected at or before this.'),
  })
  .describe('Finding filters. Omit entirely to match all findings.');

export const searchFindingsPage = z
  .object({
    skip: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Number of results to skip (offset). Defaults to 0.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Max results to return (1–200). Defaults to 50.'),
  })
  .describe('Pagination.');

// ── Sources ─────────────────────────────────────────────────────────────────

export const searchSourcesFilters = z
  .object({
    search: z
      .string()
      .optional()
      .describe('Filter by source name (case-insensitive contains).'),
    type: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by source type id (e.g. POSTGRESQL, CONFLUENCE). See list_source_types.',
      ),
    status: z
      .array(runnerStatusEnum)
      .optional()
      .describe('Filter by the status of each source’s latest run.'),
  })
  .describe('Source filters. Omit entirely to match all sources.');

export const searchSourcesPage = z
  .object({
    skip: z.number().int().min(0).optional().describe('Offset. Defaults to 0.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Max results (1–200). Defaults to 25.'),
    sortBy: z
      .enum([
        'NAME',
        'TYPE',
        'STATUS',
        'CREATED_AT',
        'UPDATED_AT',
        'LAST_RUN_AT',
      ])
      .optional()
      .describe('Sort field. Defaults to CREATED_AT.'),
    sortOrder: sortOrderEnum.optional().describe('Defaults to DESC.'),
  })
  .describe('Pagination and sorting.');

// ── Runs ────────────────────────────────────────────────────────────────────

export const searchRunsFilters = z
  .object({
    search: z
      .string()
      .max(200)
      .optional()
      .describe(
        'Case-insensitive text search across runner id, source name/type, triggeredBy, and error message.',
      ),
    sourceId: z
      .array(z.string())
      .optional()
      .describe('Restrict to these source UUIDs.'),
    sourceType: z
      .array(z.string())
      .optional()
      .describe('Restrict to these source type ids. See list_source_types.'),
    status: z
      .array(runnerStatusEnum)
      .optional()
      .describe('Restrict to runs in these statuses.'),
    triggerType: z
      .array(triggerTypeEnum)
      .optional()
      .describe('Restrict to runs started by these trigger types.'),
    triggeredBy: z
      .array(z.string())
      .optional()
      .describe('Restrict to runs started by these actors.'),
    triggeredAfter: isoDate('Only runs triggered at or after this.'),
    triggeredBefore: isoDate('Only runs triggered at or before this.'),
  })
  .describe('Run (runner) filters. Omit entirely to match all runs.');

export const searchRunsPage = z
  .object({
    skip: z.number().int().min(0).optional().describe('Offset. Defaults to 0.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Max results (1–200). Defaults to 50.'),
    sortBy: z
      .enum([
        'TRIGGERED_AT',
        'STATUS',
        'SOURCE_NAME',
        'DURATION_MS',
        'TOTAL_FINDINGS',
      ])
      .optional()
      .describe('Sort field. Defaults to TRIGGERED_AT.'),
    sortOrder: sortOrderEnum.optional().describe('Defaults to DESC.'),
  })
  .describe('Pagination and sorting.');

// ── Assets ──────────────────────────────────────────────────────────────────

export const searchAssetsAssetFilters = z
  .object({
    search: z
      .string()
      .optional()
      .describe('Filter by asset name (case-insensitive contains).'),
    sourceId: z.string().optional().describe('Restrict to a single source UUID.'),
    runnerId: z.string().optional().describe('Restrict to a single run UUID.'),
    status: z
      .array(assetStatusEnum)
      .optional()
      .describe('Restrict to assets in these ingestion statuses.'),
    sourceTypes: z
      .array(z.string())
      .optional()
      .describe('Restrict to these source type ids. See list_source_types.'),
  })
  .describe('Asset-level filters. Omit entirely to match all assets.');

export const searchAssetsFindingFilters = z
  .object({
    detectorType: z
      .array(detectorTypeEnum)
      .optional()
      .describe('Only assets with findings from these detector types.'),
    customDetectorKey: z
      .array(z.string())
      .optional()
      .describe('Only assets with findings from these custom detector keys.'),
    runnerId: z
      .array(z.string())
      .optional()
      .describe('Only findings produced by these run UUIDs.'),
    findingType: z
      .array(z.string())
      .optional()
      .describe('Only assets with these finding types.'),
    category: z
      .array(z.string())
      .optional()
      .describe('Only assets with findings in these categories.'),
    severity: z
      .array(severityEnum)
      .optional()
      .describe('Only assets with findings of these severities.'),
    status: z
      .array(findingStatusEnum)
      .optional()
      .describe('Only assets with findings in these statuses.'),
    includeResolved: z
      .boolean()
      .optional()
      .describe('Include RESOLVED/IGNORED findings when matching. Default false.'),
  })
  .describe(
    'Finding-level filters — narrow assets by the findings attached to them. Omit to ignore findings when filtering.',
  );

export const searchAssetsPage = z
  .object({
    skip: z.number().int().min(0).optional().describe('Offset. Defaults to 0.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Max results (1–200). Defaults to 50.'),
    sortBy: z
      .enum([
        'NAME',
        'SOURCE_ID',
        'ASSET_TYPE',
        'STATUS',
        'LAST_SCANNED_AT',
        'UPDATED_AT',
        'CREATED_AT',
      ])
      .optional()
      .describe('Sort field. Defaults to LAST_SCANNED_AT.'),
    sortOrder: sortOrderEnum.optional().describe('Defaults to DESC.'),
  })
  .describe('Pagination and sorting.');

export const searchAssetsOptions = z
  .object({
    excludeFindings: z
      .boolean()
      .optional()
      .describe(
        'Skip the findings join and return assets with empty findings arrays. Default false.',
      ),
    includeAssetsWithoutFindings: z
      .boolean()
      .optional()
      .describe(
        'Include assets even if they have no findings matching the finding filters. Default false.',
      ),
  })
  .describe('Result-shaping options.');
