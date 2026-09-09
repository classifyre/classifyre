import { BadRequestException } from '@nestjs/common';
import { NamespaceRegistryService } from './namespace-registry.service';
import { DEFAULT_CATEGORY_ID } from './namespace-registry.sql';

/**
 * Query-shaped stub: the service talks raw SQL, so the fake answers on the text
 * of the statement and records everything for the assertions below.
 */
interface RecordedQuery {
  sql: string;
  values: unknown[];
}

function buildService(options: { knownCategoryIds?: string[] } = {}) {
  const queries: RecordedQuery[] = [];
  const known = options.knownCategoryIds ?? [];

  const query = jest.fn((sql: string, values: unknown[] = []) => {
    queries.push({ sql, values });
    if (sql.includes('SELECT id FROM namespace_categories')) {
      const requested = (values[0] as string[]) ?? [];
      return Promise.resolve({
        rows: requested
          .filter((id) => known.includes(id))
          .map((id) => ({ id })),
        rowCount: 0,
      });
    }
    if (sql.includes('FROM namespace_category_members m')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (
      sql.trimStart().startsWith('SELECT') &&
      sql.includes('FROM namespaces')
    ) {
      return Promise.resolve({
        rows: [
          {
            id: 'ns-1',
            name: 'Acme',
            slug: 'acme',
            schema_name: 'ns_1',
            description: null,
            type: 'local',
            remote_url: null,
            has_thumbnail: false,
            settings: {},
            external_links: [],
            created_at: new Date(0),
            updated_at: new Date(0),
            last_opened_at: null,
          },
        ],
        rowCount: 1,
      });
    }
    if (sql.trimStart().startsWith('UPDATE namespaces')) {
      return Promise.resolve({
        rows: [
          {
            id: 'ns-1',
            name: 'Acme',
            slug: 'acme',
            schema_name: 'ns_1',
            description: null,
            type: 'local',
            remote_url: null,
            has_thumbnail: false,
            settings: {},
            external_links: JSON.parse(
              String(values.find((v) => String(v).startsWith('[{'))) || '[]',
            ),
            created_at: new Date(0),
            updated_at: new Date(0),
            last_opened_at: null,
          },
        ],
        rowCount: 1,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  });

  const service = new NamespaceRegistryService();
  // The service owns a real pg Pool built in a field initialiser; swap it for
  // the stub rather than opening a connection in a unit test.
  (service as unknown as { pool: unknown }).pool = { query, end: jest.fn() };
  return { service, queries };
}

describe('NamespaceRegistryService external links', () => {
  const originalUrl = process.env.DATABASE_URL;
  beforeAll(() => {
    process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/test';
  });
  afterAll(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it('stores links with generated ids', async () => {
    const { service, queries } = buildService();
    const updated = await service.update('ns-1', {
      externalLinks: [{ title: 'Tracker', url: 'https://example.com/board' }],
    });
    expect(updated.externalLinks).toHaveLength(1);
    expect(updated.externalLinks[0].title).toBe('Tracker');
    expect(updated.externalLinks[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(queries.some((q) => q.sql.includes('external_links = $'))).toBe(
      true,
    );
  });

  it('rejects a link that is missing either half', async () => {
    const { service } = buildService();
    await expect(
      service.update('ns-1', {
        externalLinks: [{ title: '', url: 'https://a.b' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update('ns-1', { externalLinks: [{ title: 'A', url: '  ' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a non-HTTP(S) URL — these render as target=_blank anchors', async () => {
    const { service } = buildService();
    await expect(
      service.update('ns-1', {
        externalLinks: [{ title: 'X', url: 'javascript:alert(1)' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update('ns-1', {
        externalLinks: [{ title: 'X', url: '/relative' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('NamespaceRegistryService categories', () => {
  const originalUrl = process.env.DATABASE_URL;
  beforeAll(() => {
    process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/test';
  });
  afterAll(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it('files a workspace under the default category when none is given', async () => {
    const { service, queries } = buildService();
    await service.update('ns-1', { categoryIds: [] });
    const insert = queries.find((q) =>
      q.sql.includes('INSERT INTO namespace_category_members'),
    );
    expect(insert?.values[1]).toEqual([DEFAULT_CATEGORY_ID]);
  });

  it('rejects an unknown category rather than silently dropping it', async () => {
    const { service } = buildService({ knownCategoryIds: ['cat-known'] });
    await expect(
      service.update('ns-1', { categoryIds: ['cat-known', 'cat-gone'] }),
    ).rejects.toThrow(/cat-gone/);
  });

  it('never deletes the default category — it is the fallback', async () => {
    const { service } = buildService();
    await expect(
      service.removeCategory(DEFAULT_CATEGORY_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
