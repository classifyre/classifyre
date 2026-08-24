/**
 * Platform-qualified names, so two connectors can name the same object.
 *
 * The mirror of `apps/cli/src/utils/urn.py`. The two must agree character for
 * character: a URN built by a Tableau scan in Python and one resolved here
 * against `assets.urn` only stitch if both folded the identifiers the same way.
 * `urn.spec.ts` and `tests/test_urn.py` pin the same table of cases in each
 * language, so a change to one that is not made to the other fails a test
 * rather than quietly producing lineage edges that never resolve.
 *
 * An asset's `hash` is scoped to the connector that produced it. A URN is
 * derived only from what the *platform* calls the object, which is the whole
 * point: a Tableau workbook names a Snowflake table it has never scanned.
 */

export class UrnError extends Error {}

type CasePolicy = 'upper' | 'lower' | 'preserve';

interface PlatformRules {
  /** The account / host / workspace / bucket. */
  authorityCase: CasePolicy;
  /** Everything after it. Folds differently from the authority more often than not. */
  pathCase: CasePolicy;
  defaultPort?: number;
}

const PLATFORMS: Record<string, PlatformRules> = {
  // Warehouses that fold unquoted identifiers to UPPER.
  snowflake: { authorityCase: 'lower', pathCase: 'upper' },
  oracle: { authorityCase: 'lower', pathCase: 'upper', defaultPort: 1521 },

  // Engines that fold to lower, or match case-insensitively.
  postgres: { authorityCase: 'lower', pathCase: 'lower', defaultPort: 5432 },
  mysql: { authorityCase: 'lower', pathCase: 'lower', defaultPort: 3306 },
  mssql: { authorityCase: 'lower', pathCase: 'lower', defaultPort: 1433 },
  databricks: { authorityCase: 'lower', pathCase: 'lower' },
  hive: { authorityCase: 'lower', pathCase: 'lower', defaultPort: 10000 },
  iceberg: { authorityCase: 'lower', pathCase: 'lower' },
  delta: { authorityCase: 'lower', pathCase: 'lower' },
  sqlite: { authorityCase: 'lower', pathCase: 'lower' },

  // Object stores and the rest: the path is byte-exact.
  s3: { authorityCase: 'lower', pathCase: 'preserve' },
  gcs: { authorityCase: 'lower', pathCase: 'preserve' },
  abfss: { authorityCase: 'lower', pathCase: 'preserve' },
  bigquery: { authorityCase: 'lower', pathCase: 'preserve' },
  tableau: { authorityCase: 'lower', pathCase: 'preserve' },
  powerbi: { authorityCase: 'lower', pathCase: 'preserve' },
  kafka: { authorityCase: 'lower', pathCase: 'preserve' },
  file: { authorityCase: 'lower', pathCase: 'preserve' },
};

const ALIASES: Record<string, string> = {
  s3a: 's3',
  s3n: 's3',
  gs: 'gcs',
  azure: 'abfss',
  abfs: 'abfss',
  wasbs: 'abfss',
  postgresql: 'postgres',
  mariadb: 'mysql',
  sqlserver: 'mssql',
};

/** Conservative fallback: never merges two objects that are actually distinct. */
const DEFAULT_RULES: PlatformRules = {
  authorityCase: 'lower',
  pathCase: 'preserve',
};

function fold(value: string, policy: CasePolicy): string {
  if (policy === 'upper') return value.toUpperCase();
  if (policy === 'lower') return value.toLowerCase();
  return value;
}

/**
 * Escape only what would break parsing: the separator and the escape itself.
 *
 * Deliberately not `encodeURIComponent`. An S3 key is the common case and
 * percent-encoding every space in it would produce URNs nobody can read in a
 * graph label, for no gain — these strings are compared, not fetched.
 */
function encodeSegment(segment: string): string {
  return segment.replace(/%/g, '%25').replace(/\//g, '%2F');
}

function decodeSegment(segment: string): string {
  return segment.replace(/%2F/gi, '/').replace(/%25/g, '%');
}

export interface ParsedUrn {
  platform: string;
  authority: string;
  path: string[];
}

function stripDefaultPort(authority: string, defaultPort?: number): string {
  if (defaultPort === undefined) return authority;
  const suffix = `:${defaultPort}`;
  return authority.endsWith(suffix)
    ? authority.slice(0, -suffix.length)
    : authority;
}

/** Build and normalize a URN from its parts. Empty segments are dropped. */
export function buildUrn(
  platform: string,
  authority: string,
  ...path: (string | null | undefined)[]
): ParsedUrn {
  const rawPlatform = (platform ?? '').trim().toLowerCase();
  if (!rawPlatform) throw new UrnError('URN platform is required');
  const name = ALIASES[rawPlatform] ?? rawPlatform;
  const rules = PLATFORMS[name] ?? DEFAULT_RULES;

  let auth = fold((authority ?? '').trim(), rules.authorityCase);
  if (!auth)
    throw new UrnError(`URN authority is required (platform '${name}')`);
  auth = stripDefaultPort(auth, rules.defaultPort);

  const segments = path
    .map((part) =>
      part == null
        ? ''
        : String(part)
            .trim()
            .replace(/^\/+|\/+$/g, ''),
    )
    .filter((part) => part.length > 0)
    .map((part) => fold(part, rules.pathCase));

  return { platform: name, authority: auth, path: segments };
}

export function formatUrn(urn: ParsedUrn): string {
  const tail = urn.path.map(encodeSegment).join('/');
  return tail
    ? `${urn.platform}://${urn.authority}/${tail}`
    : `${urn.platform}://${urn.authority}`;
}

/**
 * Parse a URN string, applying the same folding a builder would.
 *
 * Parsing normalizes, so a URN that arrives from a connector, a notebook or a
 * config file is held to the same rules as one this process built.
 */
export function parseUrn(value: string): ParsedUrn {
  const raw = (value ?? '').trim();
  const marker = raw.indexOf('://');
  if (marker < 0) {
    throw new UrnError(
      `Not a URN (expected 'platform://authority/...'): '${raw}'`,
    );
  }
  const platform = raw.slice(0, marker);
  const rest = raw.slice(marker + 3);
  const slash = rest.indexOf('/');
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const tail = slash < 0 ? '' : rest.slice(slash + 1);
  const segments = tail ? tail.split('/').map(decodeSegment) : [];
  return buildUrn(platform, authority, ...segments);
}

/** Canonical string form, for comparison and storage. */
export function normalizeUrn(value: string): string {
  return formatUrn(parseUrn(value));
}

/**
 * Normalize without throwing.
 *
 * Ingest reads URNs written by connectors we do not control, including
 * user-authored notebooks. One malformed string should cost that edge, not the
 * whole batch.
 */
export function tryNormalizeUrn(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    return normalizeUrn(value);
  } catch {
    return null;
  }
}

/** True when an entity id is a URN rather than a UUID (see the `external` node kind). */
export function looksLikeUrn(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.includes('://');
}
