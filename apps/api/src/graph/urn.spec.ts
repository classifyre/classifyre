import {
  buildUrn,
  formatUrn,
  looksLikeUrn,
  normalizeUrn,
  parseUrn,
  tryNormalizeUrn,
  UrnError,
} from './urn';

/**
 * The mirror of `apps/cli/tests/test_urn.py`. Every case here exists in that
 * file too — normalization only works if both languages fold identically, and a
 * change made on one side and not the other produces lineage edges that never
 * stitch. That failure is invisible in production (a missing arrow, not an
 * error), so it is pinned in both places instead.
 */

const urn = (platform: string, authority: string, ...path: string[]): string =>
  formatUrn(buildUrn(platform, authority, ...path));

const snowflake = (a: string, d: string, s: string, t: string) =>
  urn('snowflake', a, d, s, t);
const postgres = (
  host: string,
  port: number | null,
  d: string,
  s: string,
  t: string,
) => urn('postgres', port ? `${host}:${port}` : host, d, s, t);

describe('URN case folding', () => {
  it('folds Snowflake identifiers up', () => {
    // Snowflake upper-cases unquoted identifiers, so a connector reading
    // lowercase config and one reading the catalog must still agree.
    expect(snowflake('acme', 'prod', 'public', 'orders')).toBe(
      snowflake('ACME', 'PROD', 'PUBLIC', 'ORDERS'),
    );
    expect(snowflake('AcMe', 'prod', 'public', 'orders')).toBe(
      'snowflake://acme/PROD/PUBLIC/ORDERS',
    );
  });

  it('folds Postgres identifiers down', () => {
    expect(postgres('DB.example.com', 5432, 'App', 'Public', 'Orders')).toBe(
      'postgres://db.example.com/app/public/orders',
    );
  });

  it('keeps an object-store key byte-exact', () => {
    // The bucket is case-insensitive; the key after it is not, and folding it
    // would merge two genuinely different objects.
    expect(urn('s3', 'MyBucket', 'raw', '2024', 'Orders.csv')).toBe(
      's3://mybucket/raw/2024/Orders.csv',
    );
  });
});

describe('URN authority normalization', () => {
  it('drops an explicitly written default port', () => {
    // One connector reads the port from config, another takes the driver
    // default and writes nothing. Without this they never stitch.
    expect(postgres('db', 5432, 'app', 'public', 'orders')).toBe(
      postgres('db', null, 'app', 'public', 'orders'),
    );
  });

  it('keeps a non-default port', () => {
    expect(postgres('db', 5433, 'app', 'public', 'orders')).toContain('5433');
  });

  it('converges platform aliases', () => {
    expect(normalizeUrn('s3a://bucket/key.csv')).toBe(
      normalizeUrn('s3://bucket/key.csv'),
    );
    expect(normalizeUrn('S3N://bucket/key.csv')).toBe('s3://bucket/key.csv');
    expect(normalizeUrn('postgresql://db/app/public/t')).toBe(
      'postgres://db/app/public/t',
    );
  });
});

describe('URN parsing', () => {
  it('round-trips through normalization', () => {
    const built = snowflake('acme', 'prod', 'public', 'orders');
    expect(formatUrn(parseUrn(built))).toBe(built);
  });

  it('normalizes a hand-written URN', () => {
    // A URN typed into a notebook is held to the same rules as one a connector
    // built, so authored lineage stitches too.
    expect(normalizeUrn('SNOWFLAKE://Acme/prod/public/orders')).toBe(
      snowflake('acme', 'prod', 'public', 'orders'),
    );
  });

  it('survives a segment containing the separator', () => {
    const value = formatUrn(buildUrn('custom', 'host', 'weird/name'));
    expect(parseUrn(value).path).toEqual(['weird/name']);
  });

  it('drops empty segments rather than rejecting them', () => {
    // Callers assemble these from optional catalog/schema parts; a missing
    // middle should shorten the name rather than abort a scan.
    expect(urn('hive', 'host', 'db', '', 'table')).toBe('hive://host/db/table');
  });

  it.each(['', 'no-scheme', '://authority'])(
    'raises on unparseable input: %s',
    (bad) => {
      expect(() => parseUrn(bad)).toThrow(UrnError);
    },
  );

  it('returns null instead of throwing on the ingest path', () => {
    // Ingest reads URNs written by connectors we do not control, including
    // user-authored notebooks. One malformed string costs that edge, not the
    // whole batch.
    expect(tryNormalizeUrn('nonsense')).toBeNull();
    expect(tryNormalizeUrn(null)).toBeNull();
    expect(tryNormalizeUrn('s3a://b/k')).toBe('s3://b/k');
  });
});

describe('distinct things stay distinct', () => {
  it('does not collide different databases', () => {
    expect(snowflake('a', 'prod', 'public', 'orders')).not.toBe(
      snowflake('a', 'dev', 'public', 'orders'),
    );
  });

  it('is conservative about unknown platforms', () => {
    expect(urn('weirddb', 'HOST', 'Schema', 'Table')).toBe(
      'weirddb://host/Schema/Table',
    );
  });
});

describe('looksLikeUrn', () => {
  it('separates a URN endpoint from a UUID endpoint', () => {
    // This is what tells an `external` edge endpoint from a resolved one.
    expect(looksLikeUrn('snowflake://acme/PROD/PUBLIC/ORDERS')).toBe(true);
    expect(looksLikeUrn('3f2b1c4e-0000-4000-8000-000000000000')).toBe(false);
    expect(looksLikeUrn(null)).toBe(false);
  });
});
