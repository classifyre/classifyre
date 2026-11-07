import { BadRequestException } from '@nestjs/common';
import { LOCAL_TENANT_ID } from '../identity/tenancy.sql';
import { NamespaceRegistryService } from './namespace-registry.service';
import { workspaceScopeSql } from './workspace-scope';

/** docs/prd/TEN §6: the two sign-in modes never see each other's workspaces. */
describe('workspace scope', () => {
  const original = process.env.IAM_ENABLED;
  const originalUrl = process.env.DATABASE_URL;
  beforeAll(() => {
    process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/test';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.IAM_ENABLED;
    else process.env.IAM_ENABLED = original;
  });
  afterAll(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
  });

  function registry() {
    const queries: string[] = [];
    const service = new NamespaceRegistryService();
    (service as unknown as { pool: unknown }).pool = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      end: jest.fn(),
    };
    return { service, queries };
  }

  it('is only local without sign-in, only real tenants with it', () => {
    expect(workspaceScopeSql('tenant_id', {})).toBe(
      `tenant_id = '${LOCAL_TENANT_ID}'`,
    );
    expect(workspaceScopeSql('n.tenant_id', { IAM_ENABLED: 'true' })).toBe(
      `n.tenant_id <> '${LOCAL_TENANT_ID}'`,
    );
  });

  it.each([
    ['off', undefined, `tenant_id = '${LOCAL_TENANT_ID}'`],
    ['on', 'true', `tenant_id <> '${LOCAL_TENANT_ID}'`],
  ])(
    'with sign-in %s, listing, opening and resolving all carry it',
    async (_mode, iam, predicate) => {
      if (iam) process.env.IAM_ENABLED = iam;
      else delete process.env.IAM_ENABLED;
      const { service, queries } = registry();

      await service.list();
      await expect(service.get('ns-1')).rejects.toThrow('Unknown namespace');
      expect(await service.resolve('finance')).toBeNull();
      expect(await service.isPaused('ns-1')).toBe(false);

      const reads = queries.filter((sql) => sql.includes('FROM namespaces'));
      expect(reads).toHaveLength(4);
      for (const sql of reads) expect(sql).toContain(predicate);
    },
  );

  it('with sign-in, never creates a workspace outside a tenant', async () => {
    process.env.IAM_ENABLED = 'true';
    const { service, queries } = registry();
    await expect(service.create({ name: 'Finance' })).rejects.toThrow(
      BadRequestException,
    );
    expect(queries).toHaveLength(0);
  });
});
